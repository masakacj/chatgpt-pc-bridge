"""Actual MV3 + service: initial search overlay, complete loaded-history paging,
and remembered official routes across full reload. Synthetic pages only.
"""
from pathlib import Path
import importlib.util,json,os,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse,uuid
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('search_fixture',ROOT/'scripts/test-search-boundaries.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
HTML=fixture.shared.HTML
A=fixture.shared.A;B=fixture.shared.B

def run():
 results=[]
 with tempfile.TemporaryDirectory(prefix='bridge-history-recovery-') as temp:
  folder=Path(temp);service=None
  with sync_playwright() as p:
   extension=ROOT/'extension'
   ctx=p.chromium.launch_persistent_context(str(folder/'profile'),channel='chromium',headless=True,args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],ignore_default_args=['--disable-extensions'])
   try:
    worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
    service=subprocess.Popen(['node',str(ROOT/'service/server.js')],cwd=str(ROOT),env={**os.environ,'BRIDGE_PORT':'0','BRIDGE_DATA_DIR':str(folder/'state'),'BRIDGE_EXTENSION_IDS':eid},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    started=json.loads(service.stdout.readline());base='http://127.0.0.1:'+str(started['port'])
    phone=json.loads((folder/'state/pairing.json').read_text())['token'];ipc=json.loads((folder/'state/extension-auth.json').read_text())['token']
    # Configure only this fresh, isolated extension, with local test credentials.
    worker.evaluate('(config)=>chrome.storage.local.set({bridgeConnection:config})',{'url':base.replace('http:','ws:')+'/bridge','token':ipc})
    ctx.route('https://chatgpt.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=HTML))
    page=ctx.new_page();page.goto('https://chatgpt.com/c/'+A)
    def req(route,body=None,method=None):
     r=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+phone,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
     try:
      with urllib.request.urlopen(r,timeout=23) as response:return response.status,json.load(response)
     except urllib.error.HTTPError as e:return e.code,json.load(e)
    for _ in range(40):
     code,tabs=req('/v1/tabs?shared=1')
     if code==200:break
     page.wait_for_timeout(100)
    assert code==200,(code,tabs);tab=tabs['tabs'][0]['tabId']
    page.evaluate("""()=>{const old=document.createElement('main');old.hidden=true;old.innerHTML='<div class="transcriptContent"><article data-turn-key="old"><div data-message-author-role="user">STALE_HIDDEN_CHAT</div></article></div>';document.body.prepend(old);searchOpen();}""")
    code,session=req('/v1/sessions',{'tabId':tab,'followTab':True,'clientId':'history-recovery-client'});assert code==200,(code,session)
    sid=session['sessionId'];prefix='/v1/sessions/'+sid;snap=session['snapshot']
    assert len(snap['messages'])==2 and snap['searchActive'] and not snap['canSend'] and snap['status']=='searching',snap
    assert 'STALE_HIDDEN_CHAT' not in json.dumps(snap) and 'HIDDEN_THOUGHT' not in json.dumps(snap)
    results.append('first subscription into an already open official search reads only the current transcript')
    code,blocked=req(prefix+'/commands',{'action':'compose','commandId':str(uuid.uuid4()),'documentId':snap['documentId'],'baseDraftHash':snap['draftHash'],'text':'must not fill hidden composer'})
    assert code==200 and blocked['result']['status']=='not_sent' and page.evaluate('clicks')==0
    results.append('initial search context never enables a hidden-editor Send')
    page.evaluate('()=>closeSearch()');code,view=req(prefix+'?refresh=1');assert code==200 and view['snapshot']['messages'] and not view['snapshot'].get('searchActive')
    results.append('closing the initial search recovers normal chat without rebinding')
    page.evaluate("""()=>{const root=document.querySelector('main:not([hidden]) .transcriptContent');root.replaceChildren();for(let i=0;i<45;i++){const t=document.createElement('article');t.dataset.turnKey='h'+String(i).padStart(3,'0');t.dataset.talvtTurnState='complete';t.innerHTML='<div data-message-author-role="user" data-message-id="u'+i+'">Question '+i+'</div><div data-message-author-role="assistant" data-message-id="a'+i+'"><p>Answer '+i+'</p></div>';root.append(t)}}""")
    code,view=req(prefix+'?refresh=1');assert code==200;snap=view['snapshot'];messages=snap['messages'];seen={m['id'] for m in messages};cursor=snap['historyCursor'];more=snap['hasOlder'];pages=0
    while more and pages<10:
     q=urllib.parse.urlencode({'before':cursor,'documentId':snap['documentId']});code,older=req(prefix+'/history?'+q);assert code==200,(code,older)
     assert older['documentId']==snap['documentId'] and older['conversationId']==A
     ids={m['id'] for m in older['messages']};assert ids and not seen.intersection(ids)
     assert older['cursor']!=cursor;seen.update(ids);messages=older['messages']+messages;cursor=older['cursor'];more=older['hasMore'];pages+=1
    assert len(messages)==90 and not more and pages==3,(len(messages),more,pages)
    assert [m['id'] for m in messages]==[x for i in range(45) for x in ('u'+str(i),'a'+str(i))]
    results.append('45 loaded turns paginate into all 90 messages in order with zero gaps/duplicates and a real end')
    code,bad=req(prefix+'/history?'+urllib.parse.urlencode({'before':'missing-cursor','documentId':snap['documentId']}));assert code==409 and bad['error']=='history_cursor_expired'
    results.append('expired history cursor is an explicit error rather than a successful empty page')
    page.reload();page.wait_for_timeout(350)
    def fresh(expected):
     for _ in range(55):
      code,v=req(prefix+'?after=-1');s=v.get('snapshot')
      if code==200 and s and s['conversationId']==expected and s['status']!='loading':return s
      page.wait_for_timeout(100)
     raise AssertionError('bound document did not settle')
    current=fresh(A)
    def action(kind,**fields):
     return req(prefix+'/actions',{'action':kind,'commandId':str(uuid.uuid4()),'documentId':current['documentId'],**fields})
    code,search=action('search',query='older');assert code==200 and B in [c['id'] for c in search['chats']]
    code,result=action('open',targetConversationId=B);assert code==200,(code,result);current=fresh(B)
    page.reload();page.wait_for_timeout(300);current=fresh(B)
    code,result=action('open',targetConversationId=A);assert code==200,(code,result);current=fresh(A)
    results.append('full document reload preserves already observed current and searched routes for same-tab return')
    code,result=action('open',targetConversationId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');assert code==409 and result['error']=='conversation_not_observed'
    assert len(req('/v1/tabs?shared=1')[1]['tabs'])==1 and page.evaluate('clicks')==0
    results.append('unobserved target is still rejected; no additional tab or message created')
    req(prefix,method='DELETE')
    print(json.dumps({'pass':True,'count':len(results),'cases':results,'loadedHistoryMessages':90,'historyRequests':pages,'realUserMessagesSent':0},ensure_ascii=False))
   finally:
    if service and service.poll() is None:service.terminate();service.wait(timeout=10)
    ctx.close()
if __name__=='__main__':run()
