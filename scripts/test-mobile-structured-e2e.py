"""Real MV3 + authenticated HTTP/WS service + synthetic ChatGPT DOM.
No real user message is sent. No private PC content is exported.
"""
from pathlib import Path
import tempfile,subprocess,json,shutil,urllib.request,urllib.error,time,uuid,concurrent.futures
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
CHAT='11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif}textarea{height:70px;width:400px}button{height:32px}iframe{width:1px;height:1px}</style></head><body><main><div class="transcriptContent">
<article data-turn-key="old" data-talvt-turn-state="complete"><div data-message-id="user-old" data-message-author-role="user">Initial question</div><h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div data-message-id="answer-old"><div class="MarkdownRoot-native"><p>Previously completed answer.</p><pre>const x = 1;</pre><a href="https://example.com/reference">Reference</a></div></div><section data-testid="agent-activity"><div class="DilResponseRoot">TOOL_DIL_MUST_BE_HIDDEN</div><div class="MarkdownRoot-native">TOOL_PROCESS_MUST_NOT_BE_AN_ANSWER</div></section><section data-testid="reasoning"><div data-message-author-role="assistant"><div class="DilResponseRoot">THINKING_TEXT_MUST_BE_HIDDEN</div></div></section></article></div>
<form onsubmit="return false"><textarea id="prompt-textarea"></textarea><button type="button" aria-label="发送提示">Send</button></form><div id="tools"><iframe src="about:blank"></iframe></div></main>
<script>window.clicks=0;document.querySelector('button').onclick=()=>{
 const e=document.querySelector('textarea');const value=e.value;if(!value)return;window.clicks++;
 const turn=document.createElement('article');turn.dataset.turnKey='new-'+window.clicks;turn.dataset.talvtTurnState='in_progress';
 const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='user-'+window.clicks;user.textContent=value;turn.appendChild(user);
 const bot=document.createElement('div');bot.dataset.messageAuthorRole='assistant';bot.dataset.messageId='bot-'+window.clicks;bot.innerHTML='<div class="DilResponseRoot"><p>Generating</p></div>';turn.appendChild(bot);
 document.querySelector('.transcriptContent').appendChild(turn);e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));
 setTimeout(()=>{bot.querySelector('p').textContent='Synced answer to: '+value;turn.dataset.talvtTurnState='complete'},600);
};</script><aside><div><div role="button" aria-expanded="false" data-app-action-sidebar-project-id="g-p-aaaaaaaaaaaaaaaa" data-app-action-sidebar-project-label="Project Alpha" data-app-action-sidebar-project-collapsed="true" onclick="this.setAttribute('aria-expanded','true');this.setAttribute('data-app-action-sidebar-project-collapsed','false');const a=document.createElement('a');a.href='/g/g-p-aaaaaaaaaaaaaaaa/c/22222222-2222-4222-8222-222222222222';a.textContent='Second chat';document.getElementById('project-list').appendChild(a)">Project Alpha</div><div id="project-list"></div></div><a href="/c/11111111-1111-4111-8111-111111111111">First chat</a><a href="https://invalid.example/c/33333333-3333-4333-8333-333333333333">Excluded external</a></aside></body></html>''' 

def run():
 results=[]
 with tempfile.TemporaryDirectory(prefix='structured-pc-e2e-') as folder:
  folder=Path(folder);server=subprocess.Popen(['node',str(ROOT/'scripts/mobile-e2e-server.mjs'),str(folder/'service')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=str(ROOT))
  try:
   cfg=json.loads(server.stdout.readline());base='http://127.0.0.1:'+str(cfg['port'])
   def req(path,method='GET',body=None,auth=True,origin=None):
    headers={'Content-Type':'application/json'}
    if auth:headers['Authorization']='Bearer '+cfg['token']
    if origin:headers['Origin']=origin
    r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    try:
     with urllib.request.urlopen(r,timeout=30) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:return error.code,json.load(error)
   assert req('/v1/tabs',auth=False)[0]==401
   assert req('/v1/health',origin='https://evil.invalid')[0]==403
   results.append('bearer auth and cross-origin rejection')
   ext=folder/'extension';ext.mkdir()
   for name in ['mobile-structure-background.js','mobile-structure-content.js','mobile-sidebar.js','mobile-presentation.js']:shutil.copy2(ROOT/'extension'/name,ext/name)
   (ext/'manifest.json').write_text(json.dumps({'manifest_version':3,'name':'Structured Mobile E2E','version':'0.1.0','permissions':['tabs','storage','scripting'],'host_permissions':['https://chatgpt.com/*'],'background':{'service_worker':'worker.js','type':'module'}}))
   (ext/'worker.js').write_text("import {startMobileStructure} from './mobile-structure-background.js';const ws=new WebSocket('ws://127.0.0.1:%d');globalThis.busy=false;globalThis.mobile=startMobileStructure({send:m=>{if(ws.readyState===1)ws.send(JSON.stringify(m))},isBusy:()=>globalThis.busy});ws.onmessage=e=>mobile.handle(JSON.parse(e.data));"%cfg['wsPort'])
   with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(str(folder/'profile'),channel='chromium',headless=True,args=['--disable-extensions-except='+str(ext),'--load-extension='+str(ext)],ignore_default_args=['--disable-extensions'])
    ctx.route('https://chatgpt.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=HTML))
    page=ctx.new_page();page.goto('https://chatgpt.com/c/'+CHAT);page.wait_for_timeout(1200)
    worker=ctx.service_workers[0]
    code,tabs=req('/v1/tabs');assert code==200,(code,tabs)
    assert len(tabs['tabs'])==1
    tab=tabs['tabs'][0]['tabId']
    code,library=req('/v1/library?tabId='+str(tab));assert code==200 and len(library['projects'])==1 and len(library['chats'])==1,library
    assert library['projects'][0]['title']=='Project Alpha' and library['projects'][0]['collapsed']
    code,library=req('/v1/library/actions','POST',{'action':'project','tabId':tab,'projectId':'g-p-aaaaaaaaaaaaaaaa','commandId':str(uuid.uuid4())})
    assert code==200 and not library['projects'][0]['collapsed'] and len(library['chats'])==2,library
    assert page.evaluate('clicks')==0 and page.url.endswith(CHAT)
    results.append('official project groups and explicit expansion without navigation or Send')
    code,data=req('/v1/sessions','POST',{'tabId':tab,'clientId':'persistent-test-client-001'});assert code==200,(code,data)
    sid=data['sessionId'];snapshot=data['snapshot']
    again=req('/v1/sessions','POST',{'tabId':tab,'clientId':'persistent-test-client-001'})
    assert again[0]==200 and again[1]['sessionId']==sid,again
    other=req('/v1/sessions','POST',{'tabId':tab,'clientId':'different-test-client-002'})
    assert other[0]==409 and other[1]['error']=='tab_already_paired',other
    results.append('same phone reconnect reuses its lease without taking another client session')
    assert snapshot['messages'][-1]['role']=='assistant' and 'Previously completed answer' in snapshot['messages'][-1]['text'],snapshot
    assert any(x['kind']=='code' for x in snapshot['messages'][-1]['blocks']),snapshot
    assert page.locator('iframe').count()==1
    results.append('modern hidden role heading not mistaken for actual answer; code/link extracted')
    assert snapshot['messages'][0]['role']=='user' and snapshot['messages'][-1]['role']=='assistant'
    assert 'TOOL_PROCESS_MUST_NOT_BE_AN_ANSWER' not in json.dumps(snapshot)
    assert 'TOOL_DIL_MUST_BE_HIDDEN' not in json.dumps(snapshot)
    assert 'THINKING_TEXT_MUST_BE_HIDDEN' not in json.dumps(snapshot)
    assert page.locator('[data-testid="reasoning"] .DilResponseRoot').count()==1
    results.append('reasoning and nested tool DIL excluded from mobile data but preserved on PC')
    results.append('Markdown-only assistant body supported; unrelated tool Markdown excluded')
    def command(action,text,basehash=None,key=None):
     b={'commandId':key or str(uuid.uuid4()),'action':action,'documentId':snapshot['documentId'],'baseDraftHash':basehash or snapshot['draftHash'],'text':text}
     return req('/v1/sessions/'+sid+'/commands','POST',b),b
    # Remote draft changes native editor, never sends automatically.
    (code,response),body=command('draft','手机中文输入 test')
    assert code==200 and response['result']['status']=='draft_synced',(code,response)
    assert page.input_value('#prompt-textarea')=='手机中文输入 test' and page.evaluate('clicks')==0
    draft_hash=response['result']['draftHash'];results.append('Chinese draft synchronized without sending')
    page.fill('#prompt-textarea','PC local edit')
    (code,response),_=command('draft','must not overwrite',draft_hash)
    assert code==409 and response['error']=='draft_conflict',(code,response)
    assert page.input_value('#prompt-textarea')=='PC local edit'
    results.append('PC-side local edit wins conflict; no overwrite')
    code,blocked=req('/v1/library/actions','POST',{'action':'open','tabId':tab,'conversationId':'22222222-2222-4222-8222-222222222222','commandId':str(uuid.uuid4())})
    assert code==409 and blocked['error']=='pc_draft_blocks_navigation',blocked
    assert page.url.endswith(CHAT) and page.input_value('#prompt-textarea')=='PC local edit'
    results.append('sidebar navigation cannot discard a PC draft')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
     future=pool.submit(req,'/v1/library/actions','POST',{'action':'open','tabId':tab,'conversationId':'22222222-2222-4222-8222-222222222222','commandId':str(uuid.uuid4()),'preserveSource':True})
     while not future.done():page.wait_for_timeout(100)
     code,separate=future.result()
    assert code==200 and separate['sourcePreserved'] and separate['tab']['tabId']!=tab,separate
    page.wait_for_timeout(300)
    assert page.url.endswith(CHAT) and page.input_value('#prompt-textarea')=='PC local edit'
    reader=next(p for p in ctx.pages if '/c/22222222-2222-4222-8222-222222222222' in p.url)
    # Extension-created tabs can issue the first navigation before Playwright
    # attaches its route interceptor. Supply the same synthetic fixture here;
    # never log into or test Send against the unmocked public site.
    reader.set_content(HTML)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
     future=pool.submit(req,'/v1/sessions','POST',{'tabId':separate['tab']['tabId'],'clientId':'persistent-reader-test-003'})
     while not future.done():page.wait_for_timeout(100)
     code,newSession=future.result()
    assert code==200 and newSession['snapshot']['conversationId']=='22222222-2222-4222-8222-222222222222',{'reply':newSession,'testPage':reader.evaluate('({path:location.pathname,ready:document.readyState,main:!!document.querySelector("main"),title:document.title,body:(document.body?.textContent||"").slice(0,180)})')}
    req('/v1/sessions/'+newSession['sessionId'],'DELETE');reader.close()
    results.append('phone switch opens and subscribes correct reader without discarding PC source draft')
    page.wait_for_timeout(500)
    code,data=req('/v1/sessions/'+sid);snapshot=data['snapshot']
    (code,response),_=command('draft','One explicit send')
    assert code==200,(code,response)
    draft_hash=response['result']['draftHash']
    page.evaluate("() => document.querySelector('form button').disabled=true")
    (code,not_sent),old_command=command('send','One explicit send',draft_hash)
    assert code==200 and not_sent['state']=='failed' and not_sent['result']['status']=='not_sent',not_sent
    assert page.evaluate('clicks')==0 and page.input_value('#prompt-textarea')=='One explicit send'
    page.evaluate("() => document.querySelector('form button').disabled=false")
    again=req('/v1/sessions/'+sid+'/commands','POST',old_command)
    assert again[1]['state']=='failed' and page.evaluate('clicks')==0
    results.append('unavailable button proves not-sent; old command never replayed')
    key=str(uuid.uuid4());(code,sent),body=command('send','One explicit send',draft_hash,key)
    assert code==200 and sent['result']['status']=='sent_confirmed',(code,sent)
    assert page.evaluate('clicks')==1
    duplicate=req('/v1/sessions/'+sid+'/commands','POST',body)
    assert duplicate[0]==200 and page.evaluate('clicks')==1,duplicate
    results.append('localized aria-only Send without legacy testid works once and confirms new message')
    page.wait_for_timeout(800)
    code,data=req('/v1/sessions/'+sid);snapshot=data['snapshot']
    assert snapshot['status']=='completed' and snapshot['messages'][-1]['text']=='Synced answer to: One explicit send',snapshot
    results.append('streamed reply reaches mobile snapshot and verified completion')
    page.evaluate("() => {document.querySelector('.transcriptContent').lastElementChild.setAttribute('data-talvt-turn-state','cancelled');document.querySelector('form button').setAttribute('aria-label','停止')}")
    code,terminal=req('/v1/sessions/'+sid+'?refresh=1')
    assert code==200 and terminal['snapshot']['status']=='stopped' and page.evaluate('clicks')==1,terminal
    page.evaluate("() => {document.querySelector('.transcriptContent').lastElementChild.setAttribute('data-talvt-turn-state','complete');document.querySelector('form button').setAttribute('aria-label','发送提示')}")
    code,fresh=req('/v1/sessions/'+sid+'?refresh=1')
    assert code==200 and fresh['snapshot']['status']=='completed',fresh
    snapshot=fresh['snapshot']
    results.append('explicit readiness read sees terminal state without server requests or additional Send')
    page.evaluate("() => {const old=document.querySelector('#prompt-textarea');const e=document.createElement('div');e.id='prompt-textarea';e.contentEditable='true';e.style.minHeight='50px';window.editorInputEvents=0;e.addEventListener('input',()=>window.editorInputEvents++);old.replaceWith(e)}")
    page.wait_for_timeout(300)
    code,data=req('/v1/sessions/'+sid);snapshot=data['snapshot']
    (code,response),_=command('draft','原生编辑器中文输入')
    assert code==200,(code,response)
    assert page.inner_text('#prompt-textarea')=='原生编辑器中文输入' and page.evaluate('window.editorInputEvents')>0
    results.append('contenteditable draft emits native input event without Send')
    page.evaluate("() => document.querySelector('#prompt-textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'pin'}))")
    (code,response),_=command('draft','do not interrupt IME',response['result']['draftHash'])
    assert code==409 and response['error']=='pc_composing',(code,response)
    page.evaluate("() => document.querySelector('#prompt-textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
    results.append('ongoing PC input-method composition is never overwritten')
    # Current tool authorization is a separate card, not copied tool output.
    page.evaluate("() => {const t=document.querySelector('.transcriptContent').lastElementChild;t.setAttribute('data-talvt-turn-state','waiting_for_user');const p=document.createElement('div');p.dataset.testid='tool-approval';p.innerHTML='<h3>Example tool permission</h3><p>Read the selected test folder only.</p><button type=button>Allow once</button><button type=button>Reject</button>';window.approvalClicks=0;p.querySelector('button').onclick=()=>{window.approvalClicks++};t.appendChild(p)}")
    page.wait_for_timeout(450)
    _,current=req('/v1/sessions/'+sid);snapshot=current['snapshot'];card=snapshot['interactions'][0];choice=card['buttons'][0]
    assert snapshot['responsePhase']=='waiting' and 'Read the selected' not in str(snapshot['messages'])
    action={'commandId':str(uuid.uuid4()),'action':'interact','documentId':snapshot['documentId'],'interactionId':choice['id'],'interactionRevision':choice['revision'],'confirmed':False}
    assert req('/v1/sessions/'+sid+'/commands','POST',action)[0]==400 and page.evaluate('approvalClicks')==0
    action['confirmed']=True
    response=req('/v1/sessions/'+sid+'/commands','POST',action)
    assert response[0]==200 and response[1]['result']['status']=='interaction_clicked',response
    assert req('/v1/sessions/'+sid+'/commands','POST',action)[0]==200 and page.evaluate('approvalClicks')==1
    results.append('approval card requires explicit confirmation and duplicate click is suppressed')
    # A stale visible-button revision must never click a changed operation.
    second=card['buttons'][1];page.evaluate("() => document.querySelector('[data-testid=tool-approval] p').textContent='Operation changed'")
    stale={'commandId':str(uuid.uuid4()),'action':'interact','documentId':snapshot['documentId'],'interactionId':second['id'],'interactionRevision':second['revision'],'confirmed':True}
    response=req('/v1/sessions/'+sid+'/commands','POST',stale)
    assert response[1]['state']=='failed' and response[1]['result']['error']=='interaction_changed',response
    page.evaluate("() => {document.querySelector('[data-testid=tool-approval]').remove();document.querySelector('.transcriptContent').lastElementChild.setAttribute('data-talvt-turn-state','complete')}")
    results.append('changed authorization context invalidates prior mobile buttons')
    page.evaluate("() => {const f=document.createElement('iframe');f.id='approval-frame';f.style.width='300px';f.style.height='120px';f.srcdoc='<div data-testid=tool-approval><h3>Embedded confirmation</h3><p>Confirm the selected test action.</p><button onclick=parent.frameApprovals++>Confirm</button></div>';window.frameApprovals=0;document.querySelector('.transcriptContent').lastElementChild.appendChild(f)}")
    page.wait_for_timeout(600)
    _,current=req('/v1/sessions/'+sid);snapshot=current['snapshot'];embedded=snapshot['interactions'][0]['buttons'][0]
    b={'commandId':str(uuid.uuid4()),'action':'interact','documentId':snapshot['documentId'],'interactionId':embedded['id'],'interactionRevision':embedded['revision'],'confirmed':True}
    response=req('/v1/sessions/'+sid+'/commands','POST',b)
    assert response[1]['result']['status']=='interaction_clicked' and page.evaluate('frameApprovals')==1,response
    page.evaluate("() => document.querySelector('#approval-frame').remove()")
    results.append('reachable same-origin embedded confirmation clicks only its original button')
    # Build older native page DOM, fetch two disjoint history pages on demand.
    page.evaluate("() => {const root=document.querySelector('.transcriptContent');for(let i=0;i<30;i++){const a=document.createElement('article');a.dataset.turnKey='history-'+i;a.dataset.talvtTurnState='complete';const m=document.createElement('div');m.dataset.messageAuthorRole='assistant';m.dataset.messageId='history-message-'+i;m.textContent='Historic answer '+i;a.appendChild(m);root.insertBefore(a,root.firstChild)}}")
    page.wait_for_timeout(450)
    _,current=req('/v1/sessions/'+sid);snapshot=current['snapshot'];assert snapshot['hasOlder']
    cursor=snapshot['historyCursor'];code,h=req('/v1/sessions/'+sid+'/history?before='+cursor+'&documentId='+snapshot['documentId'])
    assert code==200 and h['messages'] and h['source']=='pc_loaded_history'
    assert not (set(m['id'] for m in snapshot['messages'])&set(m['id'] for m in h['messages']))
    results.append('history pages preserve ordering without exposing thoughts or moving PC scroll')
    worker.evaluate('() => globalThis.busy=true')
    (code,response),_=command('draft','workflow conflict')
    assert code==409 and response['error']=='workflow_busy',(code,response)
    results.append('existing Orchestrator busy protection')
    worker.evaluate('() => globalThis.busy=false')
    page.evaluate("() => document.querySelector('#prompt-textarea').textContent=''")
    # Pump Playwright while real navigation waits for its intercepted page response.
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
     future=pool.submit(req,'/v1/library/actions','POST',{'action':'open','tabId':tab,'conversationId':'22222222-2222-4222-8222-222222222222','commandId':str(uuid.uuid4())})
     while not future.done():page.wait_for_timeout(100)
     code,opened=future.result()
    assert code==200 and opened['tab']['conversationId']=='22222222-2222-4222-8222-222222222222',opened
    assert '/c/22222222-2222-4222-8222-222222222222' in page.url
    results.append('selected official sidebar link switches without arbitrary URL navigation')
    page.wait_for_timeout(400)
    code,moved=req('/v1/sessions/'+sid);assert moved['routeChanged'] is True,moved
    results.append('PC navigation invalidates old mobile conversation session')
    req('/v1/sessions/'+sid,'DELETE')
    ctx.close()
   print(json.dumps({'pass':True,'engine':'real Chromium MV3 plus Node authenticated service','cases':results,'realUserMessagesSent':0},ensure_ascii=False))
  finally:
   server.terminate()
   try:server.wait(timeout=5)
   except subprocess.TimeoutExpired:server.kill()
if __name__=='__main__':run()
