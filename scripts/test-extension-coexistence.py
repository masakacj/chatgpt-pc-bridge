"""Two different-purpose extensions in one isolated Chrome profile.
The original state module remains untouched; the new actual Bridge is injected
beside it. This is not a claim that every Orchestrator workflow is re-executed.
"""
from pathlib import Path
import importlib.util,json,os,shutil,subprocess,tempfile,urllib.request,urllib.error,uuid
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('shared_fixture',ROOT/'scripts/test-shared-tab.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def run():
 results=[]
 with tempfile.TemporaryDirectory(prefix='bridge-coexistence-') as tmp:
  folder=Path(tmp);old=folder/'old-extension';old.mkdir();service=None
  for name in ['pc-resilience-core.js','pc-resilience-background.js','pc-resilience-content.js']:shutil.copy2(ROOT/'extension'/name,old/name)
  (old/'old-worker.js').write_text("import{startPcResilience}from'./pc-resilience-background.js';globalThis.originalState=startPcResilience();",encoding='utf8')
  (old/'manifest.json').write_text(json.dumps({'manifest_version':3,'name':'Original state preservation fixture','version':'1.0.0','permissions':['storage','tabs','scripting','webRequest'],'host_permissions':['https://chatgpt.com/*'],'background':{'service_worker':'old-worker.js','type':'module'},'content_scripts':[{'matches':['https://chatgpt.com/*'],'js':['pc-resilience-content.js'],'run_at':'document_idle'}]}),encoding='utf8')
  new=ROOT/'extension';manifest=json.loads((new/'manifest.json').read_text())
  assert not any('pc-resilience-content.js' in c.get('js',[]) for c in manifest.get('content_scripts',[]))
  with sync_playwright() as p:
   paths=str(old)+','+str(new)
   ctx=p.chromium.launch_persistent_context(str(folder/'profile'),channel='chromium',headless=True,args=['--disable-extensions-except='+paths,'--load-extension='+paths],ignore_default_args=['--disable-extensions'])
   try:
    while len(ctx.service_workers)<2:ctx.wait_for_event('serviceworker',timeout=15000)
    oldworker=next(w for w in ctx.service_workers if w.url.endswith('/old-worker.js'))
    newworker=next(w for w in ctx.service_workers if w.url.endswith('/background.js'))
    eid=newworker.url.split('/')[2];assert eid!=oldworker.url.split('/')[2]
    env={**os.environ,'BRIDGE_DATA_DIR':str(folder/'service'),'BRIDGE_PORT':'0','BRIDGE_EXTENSION_IDS':eid}
    service=subprocess.Popen(['node',str(ROOT/'service/server.js')],env=env,cwd=str(ROOT),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    started=json.loads(service.stdout.readline());base='http://127.0.0.1:'+str(started['port'])
    token=json.loads((folder/'service/pairing.json').read_text())['token'];ipc=json.loads((folder/'service/extension-auth.json').read_text())['token']
    ctx.route('https://chatgpt.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=fixture.HTML))
    page=ctx.new_page();page.goto('https://chatgpt.com/c/'+fixture.A);page.wait_for_timeout(2400)
    before=oldworker.evaluate('()=>originalState.audit()');assert before['recordCount']>=1,before
    page.evaluate("()=>{window.bridgeRetireEvents=0;document.addEventListener('__ORCH_PC_RETIRE_RUNTIME_V1__',()=>window.bridgeRetireEvents++);}")
    options=ctx.new_page();options.goto('chrome-extension://'+eid+'/options.html');options.locator('#url').fill(base.replace('http:','ws:')+'/bridge');options.locator('#token').fill(ipc);options.locator('button[type=submit]').click()
    for _ in range(35):
     options.locator('#refresh').click()
     if options.locator('#status').inner_text().startswith('已连接'):break
     page.wait_for_timeout(150)
    def req(path,body=None,method=None):
     r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
     try:
      with urllib.request.urlopen(r,timeout=20) as response:return response.status,json.load(response)
     except urllib.error.HTTPError as e:return e.code,json.load(e)
    code,tabs=req('/v1/tabs?shared=1');assert code==200
    tab=tabs['tabs'][0]['tabId'];code,s=req('/v1/sessions',{'tabId':tab,'followTab':True,'clientId':'coexistence-phone'});assert code==200,(code,s)
    sid=s['sessionId'];page.bring_to_front();page.wait_for_timeout(500)
    after=oldworker.evaluate('()=>originalState.audit()')
    assert after['recordCount']>=before['recordCount'] and after['extensionId']==before['extensionId']
    assert any(not x.get('unavailable') for x in after['pages']),after
    assert page.evaluate('bridgeRetireEvents')==0
    results.append('original extension ID, stored state and live page observer survive new bridge subscription')
    count=newworker.evaluate("async()=>Object.keys(await chrome.storage.local.get(null)).filter(k=>k.startsWith('pc-state-v1:')).length")
    assert count==0
    results.append('new bridge does not duplicate or take ownership of original PC state storage')
    page.evaluate("()=>document.querySelector('article:last-child').setAttribute('data-talvt-turn-state','in_progress')");page.wait_for_timeout(500)
    code,r=req('/v1/sessions/'+sid+'?refresh=1');assert code==200
    snap=r['snapshot'];command={'commandId':str(uuid.uuid4()),'action':'compose','documentId':snap['documentId'],'baseDraftHash':snap['draftHash'],'text':'must not interrupt active PC generation'}
    code,blocked=req('/v1/sessions/'+sid+'/commands',command)
    assert code==200 and blocked['result']['status']=='not_sent' and page.evaluate('clicks')==0,(code,blocked)
    assert page.input_value('textarea')==''
    results.append('bridge does not write or send into a currently generating PC conversation')
    req('/v1/sessions/'+sid,method='DELETE')
    page.evaluate("()=>document.querySelector('article:last-child').setAttribute('data-talvt-turn-state','complete')");page.wait_for_timeout(500)
    final=oldworker.evaluate('()=>originalState.audit()');assert final['recordCount']>=before['recordCount']
    assert any(not x.get('unavailable') for x in final['pages']);assert page.evaluate('bridgeRetireEvents')==0
    results.append('unsubscribing the bridge leaves original state observation running')
    print(json.dumps({'pass':True,'cases':results,'count':len(results),'realUserMessagesSent':0,'originalExecutorSourceChanged':False},ensure_ascii=False))
   finally:
    if service and service.poll() is None:service.terminate();service.wait(timeout=10)
    ctx.close()

if __name__=='__main__':run()
