"""Load the actual standalone extension/service in isolated Chromium.
All ChatGPT pages are local deterministic fixtures; no real account or sends.
"""
from pathlib import Path
import importlib.util,json,os,subprocess,tempfile,time,urllib.request,urllib.error,uuid
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('legacy_fixture',ROOT/'scripts/test-mobile-structured-e2e.py')
legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)


def run():
 results=[]
 with tempfile.TemporaryDirectory(prefix='bridge-standalone-browser-') as tmp:
  folder=Path(tmp);service=None
  with sync_playwright() as p:
   ext=ROOT/'extension'
   ctx=p.chromium.launch_persistent_context(str(folder/'profile'),channel='chromium',headless=True,args=['--disable-extensions-except='+str(ext),'--load-extension='+str(ext)],ignore_default_args=['--disable-extensions'])
   try:
    worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    extension_id=worker.url.split('/')[2]
    def start(port=0):
     env={**os.environ,'BRIDGE_DATA_DIR':str(folder/'service'),'BRIDGE_PORT':str(port),'BRIDGE_EXTENSION_IDS':extension_id}
     proc=subprocess.Popen(['node',str(ROOT/'service/server.js')],env=env,cwd=str(ROOT),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
     line=proc.stdout.readline()
     if not line: raise AssertionError('standalone service failed: '+proc.stderr.read()[-500:])
     return proc,json.loads(line)
    service,started=start();base='http://127.0.0.1:'+str(started['port'])
    token=json.loads((folder/'service/pairing.json').read_text())['token']
    ipc=json.loads((folder/'service/extension-auth.json').read_text())['token']
    ctx.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=legacy.HTML))
    page=ctx.new_page();page.goto('https://chatgpt.com/c/'+legacy.CHAT)
    options=ctx.new_page();options.goto('chrome-extension://'+extension_id+'/options.html')
    options.locator('#url').fill(base.replace('http:','ws:')+'/bridge')
    options.locator('#token').fill(ipc);options.locator('button[type=submit]').click()
    def req(route,body=None):
     r=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST' if body is not None else 'GET')
     try:
      with urllib.request.urlopen(r,timeout=25) as response:return response.status,json.load(response)
     except urllib.error.HTTPError as error:return error.code,json.load(error)
    def wait_ready():
     for _ in range(40):
      options.locator('#refresh').click()
      if options.locator('#status').inner_text().startswith('已连接'):return
      page.wait_for_timeout(250)
     raise AssertionError('actual extension did not connect: '+options.locator('#status').inner_text())
    wait_ready();results.append('actual extension settings and authenticated independent WebSocket connect')
    code,tabs=req('/v1/tabs');assert code==200 and len(tabs['tabs'])==1,(code,tabs)
    tab=tabs['tabs'][0]['tabId']
    code,lib=req('/v1/library?tabId='+str(tab));assert code==200 and len(lib['projects'])==1
    code,session=req('/v1/sessions',{'tabId':tab,'clientId':'independent-browser-phone-01'});assert code==200,(code,session)
    sid=session['sessionId'];snap=session['snapshot'];doc=snap['documentId']
    assert 'Previously completed answer' in snap['messages'][-1]['text']
    assert 'TOOL_PROCESS_MUST_NOT_BE_AN_ANSWER' not in json.dumps(snap)
    assert page.locator('iframe').count()==1 and page.input_value('#prompt-textarea')==''
    results.append('actual standalone extractor reads sidebar and answer without changing editor or tool DOM')
    text='独立扩展一次发送测试'
    draft={'commandId':str(uuid.uuid4()),'action':'draft','documentId':doc,'baseDraftHash':snap['draftHash'],'text':text}
    code,synced=req('/v1/sessions/'+sid+'/commands',draft);assert code==200,(code,synced)
    assert page.evaluate('clicks')==0
    command={**draft,'commandId':str(uuid.uuid4()),'action':'send','baseDraftHash':synced['result']['draftHash']}
    code,sent=req('/v1/sessions/'+sid+'/commands',command);assert code==200 and sent['result']['status']=='sent_confirmed',(code,sent)
    code,dup=req('/v1/sessions/'+sid+'/commands',command);assert code==200 and page.evaluate('clicks')==1,(code,dup)
    page.wait_for_timeout(1000)
    code,reply=req('/v1/sessions/'+sid+'?refresh=1');assert code==200 and text in reply['snapshot']['messages'][-1]['text']
    results.append('actual worker plus independent service writes editor and clicks Send exactly once')
    # Real MV3 lifecycle: keep the same subscription alive beyond the idle window.
    page.wait_for_timeout(35000)
    code,alive=req('/v1/sessions/'+sid+'?refresh=1');assert code==200 and alive['snapshot']['documentId']==doc,(code,alive)
    assert page.evaluate('clicks')==1
    results.append('35-second real MV3 idle-window survival without reconnecting or replaying Send')
    service.terminate();service.wait(timeout=10)
    service,again=start(started['port']);assert again['port']==started['port']
    wait_ready()
    assert json.loads((folder/'service/pairing.json').read_text())['token']==token
    code,receipt=req('/v1/commands/'+command['commandId']);assert code==200 and receipt['result']['status']=='sent_confirmed'
    code,new=req('/v1/sessions',{'tabId':tab,'clientId':'independent-browser-phone-01'});assert code==200,(code,new)
    assert page.evaluate('clicks')==1
    results.append('independent service process restart preserves pairing/receipt and reconnects without another Send')
    assert all('3210/executor' not in (ROOT/x).read_text(encoding='utf8') for x in ['extension/background.js','extension/bridge-connection.js','service/standalone.js','service/server.js'])
    results.append('tested service and actual extension have no Orchestrator transport/import dependency')
    print(json.dumps({'pass':True,'cases':results,'count':len(results),'engine':'actual standalone MV3 and independent Node process','fixtureMessages':1,'realUserMessagesSent':0},ensure_ascii=False))
   finally:
    if service is not None and service.poll() is None:
     service.terminate();service.wait(timeout=10)
    ctx.close()

if __name__=='__main__':run()
