"""Real MV3 shared-tab workflow with deterministic official-UI fixtures only."""
from pathlib import Path
import json,os,subprocess,tempfile,time,urllib.request,urllib.error,uuid,hashlib
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222';C='33333333-3333-4333-8333-333333333333';P='g-p-aaaaaaaaaaaaaaaa'
HTML='''<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif}textarea{width:400px;height:70px}button{min-height:32px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}[role=dialog]{position:fixed;inset:10%;background:white;border:1px solid;padding:20px}</style></head><body>
<aside><button aria-label="搜索" onclick="searchOpen()">搜索</button><button aria-label="新聊天" onclick="show('/')">新聊天</button><div><div role="button" aria-expanded="false" data-app-action-sidebar-project-id="g-p-aaaaaaaaaaaaaaaa" data-app-action-sidebar-project-label="Project Alpha" onclick="this.setAttribute('aria-expanded','true')">Project Alpha</div><button aria-label="在 Project Alpha 中开启新聊天" onclick="show('/g/g-p-aaaaaaaaaaaaaaaa')">项目新建</button></div><a href="/c/11111111-1111-4111-8111-111111111111" onclick="event.preventDefault();show(this.pathname)">First chat</a></aside>
<main><div class="transcriptContent"></div><form onsubmit="return false"><textarea id="prompt-textarea"></textarea><button type="button" aria-label="发送提示" onclick="sendMessage()">发送</button></form></main>
<script>
window.clicks=0;window.approvals=0;window.created=0;
function show(path){history.pushState({},'',path);document.querySelector('[role=dialog]')?.remove();document.querySelector('textarea').value='';document.title=path.includes('/c/')?'Chat '+path.split('/').at(-1):'New chat';const id=path.split('/').at(-1);document.querySelector('.transcriptContent').innerHTML=path.includes('/c/')?'<article data-turn-key="'+id+'-old" data-talvt-turn-state="complete"><div data-message-author-role="user" data-message-id="u-'+id+'">Question '+id+'</div><h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div><div class="MarkdownRoot-native"><p>Answer '+id+'</p></div></div><section data-testid="reasoning"><div class="DilResponseRoot">HIDDEN_THOUGHT</div></section></article>':'';}
function searchOpen(){if(document.querySelector('[role=dialog]'))return;const d=document.createElement('section');d.setAttribute('role','dialog');d.innerHTML='<input role="combobox" placeholder="Search chats"><div class="results"></div>';d.querySelector('input').oninput=()=>{d.querySelector('.results').innerHTML='<a href="/c/22222222-2222-4222-8222-222222222222">Older chat outside sidebar</a><a href="/c/33333333-3333-4333-8333-333333333333">Archived search fixture</a>';for(const a of d.querySelectorAll('a'))a.onclick=e=>{e.preventDefault();show(a.pathname);};};document.body.appendChild(d);}
function sendMessage(){const e=document.querySelector('textarea'),value=e.value;if(!value)return;window.clicks++;if(!location.pathname.includes('/c/')){window.created++;const id='dddddddd-dddd-4ddd-8ddd-'+String(window.created).padStart(12,'0');const assigned=(location.pathname==='/'?'':location.pathname)+'/c/'+id;setTimeout(()=>history.pushState({},'',assigned),350);}const t=document.createElement('article');t.dataset.turnKey='sent-'+window.clicks;t.dataset.talvtTurnState='in_progress';const u=document.createElement('div');u.dataset.messageAuthorRole='user';u.dataset.messageId='sent-user-'+window.clicks;u.textContent=value;t.appendChild(u);const a=document.createElement('div');a.dataset.messageAuthorRole='assistant';a.dataset.messageId='sent-answer-'+window.clicks;a.innerHTML='<div class="DilResponseRoot"><p>Generating</p></div>';t.appendChild(a);document.querySelector('.transcriptContent').appendChild(t);e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>{a.querySelector('p').textContent='Reply: '+value;t.dataset.talvtTurnState='complete';},350);}
show(location.pathname);
</script></body></html>'''

def run():
 results=[]
 with tempfile.TemporaryDirectory(prefix='shared-tab-') as tmp:
  folder=Path(tmp);service=None
  with sync_playwright() as p:
   ext=ROOT/'extension'
   ctx=p.chromium.launch_persistent_context(str(folder/'profile'),channel='chromium',headless=True,args=['--disable-extensions-except='+str(ext),'--load-extension='+str(ext)],ignore_default_args=['--disable-extensions'])
   try:
    worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
    env={**os.environ,'BRIDGE_DATA_DIR':str(folder/'service'),'BRIDGE_PORT':'0','BRIDGE_EXTENSION_IDS':eid}
    service=subprocess.Popen(['node',str(ROOT/'service/server.js')],env=env,cwd=str(ROOT),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    line=service.stdout.readline();assert line,'service startup failed';started=json.loads(line);base='http://127.0.0.1:'+str(started['port'])
    token=json.loads((folder/'service/pairing.json').read_text())['token'];ipc=json.loads((folder/'service/extension-auth.json').read_text())['token']
    ctx.route('https://chatgpt.com/**',lambda r:r.fulfill(status=200,content_type='text/html',body=HTML))
    page=ctx.new_page();page.goto('https://chatgpt.com/c/'+A)
    options=ctx.new_page();options.goto('chrome-extension://'+eid+'/options.html');options.locator('#url').fill(base.replace('http:','ws:')+'/bridge');options.locator('#token').fill(ipc);options.locator('button[type=submit]').click()
    for _ in range(40):
     options.locator('#refresh').click()
     if options.locator('#status').inner_text().startswith('已连接'):break
     page.wait_for_timeout(150)
    def req(path,body=None,method=None):
     r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
     try:
      with urllib.request.urlopen(r,timeout=25) as response:return response.status,json.load(response)
     except urllib.error.HTTPError as error:return error.code,json.load(error)
    code,tabs=req('/v1/tabs?shared=1');assert code==200,(code,tabs);tab=tabs['tabs'][0]['tabId']
    code,envelope=req('/v1/sessions',{'tabId':tab,'followTab':True,'clientId':'shared-phone-fixture-001'});assert code==200,(code,envelope);sid=envelope['sessionId'];prefix='/v1/sessions/'+sid
    snap=envelope['snapshot'];assert snap['sharedTab'] and snap['conversationId']==A and snap['draft']==''
    assert 'HIDDEN_THOUGHT' not in json.dumps(snap)
    def fresh(expected=None):
     for _ in range(60):
      code,r=req(prefix+'?after=-1');s=r.get('snapshot')
      if code==200 and s and (expected is None or s['conversationId']==expected) and s['status']!='loading':
       page.wait_for_timeout(50) # Pump Playwright's events after blocking urllib calls.
       return s
      page.wait_for_timeout(120)
     raise AssertionError(('snapshot not ready',code,{k:v for k,v in r.items() if k!='snapshot'}))
    def action(kind,**kwargs):
     s=fresh();return req(prefix+'/actions',{'commandId':str(uuid.uuid4()),'action':kind,'documentId':s['documentId'],**kwargs})
    def compose(value,s=None,key=None):
     s=s or fresh();b={'commandId':key or str(uuid.uuid4()),'action':'compose','documentId':s['documentId'],'baseDraftHash':s['draftHash'],'text':value,'projectId':s.get('projectId')};return req(prefix+'/commands',b),b
    results.append('bind a single existing tab; snapshot excludes PC draft text and reasoning')
    if page.evaluate('Boolean(window.searchBoundaryFixture)'):
     page.evaluate("()=>{window.savedTranscript=document.querySelector('.transcriptContent').innerHTML;document.querySelector('.transcriptContent').innerHTML='';}")
     code,hydrating=req(prefix+'?refresh=1');assert code==200 and hydrating['snapshot']['status']=='loading' and not hydrating['snapshot']['canSend']
     page.evaluate("()=>{document.querySelector('.transcriptContent').innerHTML=window.savedTranscript;}")
     code,restored=req(prefix+'?refresh=1');assert code==200 and restored['snapshot']['messages']
     results.append('known conversation with unhydrated body stays loading instead of falsely reporting idle')
    if page.evaluate('Boolean(window.modernUserFixture)'):
     user=next(m for m in snap['messages'] if m['role']=='user')
     assert user['text']=='Question '+A and 'Copy user message' not in user['text']
     page.evaluate("""()=>{const first=document.querySelector('.bg-user-message');first.replaceWith(first.cloneNode(true));const hidden=document.createElement('div');hidden.hidden=true;hidden.innerHTML='<div class="group/user-message"><div class="bg-user-message text-user-message">HIDDEN_USER_BRANCH</div></div>';document.querySelector('article').append(hidden);} """)
     code,repainted=req(prefix+'?refresh=1');assert code==200
     assert [m['id'] for m in repainted['snapshot']['messages'] if m['role']=='user']==[user['id']]
     assert 'HIDDEN_USER_BRANCH' not in json.dumps(repainted['snapshot'])
     results.append('observed roleless bubble excludes toolbar/hidden branches and keeps identity after React-style replacement')
     page.evaluate("""()=>{window.realSend=sendMessage;window.repaintOnlyClicks=0;sendMessage=()=>{window.repaintOnlyClicks++;const bubble=document.querySelector('.bg-user-message');bubble.replaceWith(bubble.cloneNode(true));document.querySelector('textarea').value='';};}""")
     (code,unconfirmed),same=compose(user['text'],repainted['snapshot'])
     assert code==200 and unconfirmed['result']['status']=='sent_unconfirmed',(code,unconfirmed)
     req(prefix+'/commands',same);assert page.evaluate('repaintOnlyClicks')==1
     page.evaluate('()=>{sendMessage=window.realSend;}')
     results.append('old identical user text remount is not mistaken for a newly accepted Send and is never replayed')
     page.evaluate("""()=>{window.savedTextArea=document.querySelector('main textarea');const rich=document.createElement('div');rich.id='prompt-textarea';rich.contentEditable='true';rich.className='ProseMirror';rich.innerHTML='<p>第一行</p><p>第二行</p><p><br class="ProseMirror-trailingBreak"></p><p>第四行</p>';window.savedTextArea.replaceWith(rich);}""")
     code,rich=req(prefix+'?refresh=1');assert code==200
     assert rich['snapshot']['draftHash']==hashlib.sha256('第一行\n第二行\n\n第四行'.encode()).hexdigest()
     assert rich['snapshot']['draft']=='' and rich['snapshot']['pcDraftOccupied']
     page.evaluate("()=>document.querySelector('main .ProseMirror').replaceWith(window.savedTextArea)")
     results.append('visible ProseMirror paragraph boundaries preserve typed newlines without including the hidden old composer')
    page.fill('textarea','PC private unsent text');page.wait_for_timeout(300);s=fresh();assert s['draft']=='' and s['pcDraftOccupied']
    (code,rejected),_=compose('do not overwrite',s);assert code==200 and rejected['result']['status']=='not_sent' and page.input_value('textarea')=='PC private unsent text'
    page.fill('textarea','');page.wait_for_timeout(300);s=fresh();assert not s['pcDraftOccupied']
    mismatch={'commandId':str(uuid.uuid4()),'action':'compose','documentId':s['documentId'],'baseDraftHash':s['draftHash'],'text':'wrong project must not send','projectId':P}
    code,rejected=req(prefix+'/commands',mismatch);assert code==200 and rejected['result']['status']=='not_sent' and rejected['result']['error']=='project_context_changed'
    assert page.input_value('textarea')=='' and page.evaluate('clicks')==0
    results.append('project mismatch is rejected before any editor write or Send click')
    page.locator('button[aria-label="发送提示"]').evaluate('(b)=>b.disabled=true')
    (code,failed),_=compose('button unavailable',fresh());assert code==200 and failed['result']['status']=='not_sent',(code,failed)
    page.wait_for_timeout(100);assert page.input_value('textarea')=='' and page.evaluate('clicks')==0
    page.locator('button[aria-label="发送提示"]').evaluate('(b)=>b.disabled=false');page.wait_for_timeout(300)
    results.append('proven pre-click failure restores only the unchanged bridge insertion, permitting a deliberate retry')
    s=fresh()
    (code,sent),body=compose('手机只点一次发送',s);assert code==200 and sent['result']['status']=='sent_confirmed',(code,sent)
    code,dup=req(prefix+'/commands',body);assert code==200 and page.evaluate('clicks')==1
    page.wait_for_timeout(600);assert '手机只点一次发送' in fresh()['messages'][-1]['text']
    results.append('single compose POST fills and sends once; PC draft conflict stays on PC; duplicate command does not replay')
    original=fresh();code,library=action('catalog');assert code==200 and B not in [x['id'] for x in library['chats']]
    if page.evaluate('Boolean(window.searchBoundaryFixture)'):
     page.evaluate('()=>searchOpen()')
     code,pc_search=req(prefix+'?refresh=1');assert code==200 and pc_search['snapshot']['messages'] and pc_search['snapshot'].get('searchActive')
     results.append('PC-opened search dialog also preserves the previously mirrored conversation')
    code,search=action('search',query='Older chat');assert code==200 and B in [x['id'] for x in search['chats']],(code,search)
    assert search['hasMore'] is False,'A fully visible finite result set must not offer endless Load more'
    results.append('official search finds a conversation absent from the loaded sidebar')
    if page.evaluate('Boolean(window.searchBoundaryFixture)'):
     preserved=fresh(A);assert preserved['messages'] and preserved.get('searchActive') and not preserved['canSend']
     results.append('search modal aria-hiding main does not blank the mirrored conversation')
     code,empty=action('search',query='NO_RESULT_1');assert code==200 and empty['chats']==[] and empty['emptyConfirmed'] and not empty['loading'] and not empty['hasMore'],(code,empty)
     code,paged=action('search',query='PAGINATED');assert code==200 and len(paged['chats'])==1 and paged['hasMore'],(code,paged)
     code,more=action('search',query='PAGINATED',more=True);assert code==200 and len(more['chats'])==2 and not more['hasMore'],(code,more)
     results.append('official Load more adds results and correctly reaches the end')
     code,empty=action('search',query='NO_RESULT_2');assert code==200 and empty['chats']==[] and empty['emptyConfirmed'] and not empty['hasMore'],(code,empty)
     results.append('a new empty query never returns stale results from the preceding query')
     code,search=action('search',query='Older chat');assert code==200 and B in [x['id'] for x in search['chats']]
    code,opened=action('open',targetConversationId=B);assert code==200,(code,opened)
    s=fresh(B);assert page.url.endswith(B),('bound page',page.url,s['route']);assert len(req('/v1/tabs?shared=1')[1]['tabs'])==1
    results.append('phone selection navigates the SAME bound PC tab without opening a reader tab')
    page.evaluate("p=>show('/c/'+p)",C);s=fresh(C)
    assert s['documentId']!=original['documentId']
    other=ctx.new_page();other.goto('https://chatgpt.com/c/'+A);other.bring_to_front();page.wait_for_timeout(400);assert fresh()['conversationId']==C
    results.append('PC route changes follow on phone; activating another Chrome tab does not change binding')
    (code,stale),_=compose('stale A draft must never send in C',original)
    assert code==200 and stale['result']['status']=='not_sent' and page.evaluate('clicks')==1,(code,stale)
    results.append('stale-document Send is refused rather than written into another conversation')
    code,new=action('new');assert code==200,(code,new);s=fresh('');assert s['temporary'] and page.url=='https://chatgpt.com/'
    (code,first),_=compose('普通新聊天首条',s);assert code==200 and first['result']['status']=='sent_confirmed',(code,first)
    assert first['result']['conversationId'];fresh(first['result']['conversationId']);assert page.url.endswith(first['result']['conversationId']);page.wait_for_timeout(500)
    results.append('new ordinary chat first Send binds the real conversation ID with one click')
    code,new=action('new',projectId=P);assert code==200,(code,new);s=fresh('');assert s['projectId']==P
    (code,first),_=compose('项目聊天首条',s);assert code==200 and first['result']['status']=='sent_confirmed' and first['result']['projectId']==P,(code,first)
    fresh(first['result']['conversationId']);assert page.url.startswith('https://chatgpt.com/g/'+P+'/c/');page.wait_for_timeout(600)
    results.append('project new-chat uses its official button and verifies first-Send project membership')
    page.evaluate("""()=>{const t=document.querySelector('article:last-child'),panel=document.createElement('section');panel.dataset.testid='tool-confirmation';panel.innerHTML='<h3>Test approval</h3><p>Explicit test only</p><button type="button">Allow once</button>';panel.querySelector('button').onclick=()=>{window.approvals++;panel.remove()};t.appendChild(panel)}""")
    page.wait_for_timeout(400);s=fresh();card=s['interactions'][0];button=card['buttons'][0]
    b={'commandId':str(uuid.uuid4()),'action':'interact','documentId':s['documentId'],'interactionId':button['id'],'interactionRevision':button['revision'],'confirmed':True}
    code,result=req(prefix+'/commands',b);assert code==200 and result['result']['status']=='interaction_clicked',(code,result)
    req(prefix+'/commands',b);assert page.evaluate('approvals')==1
    results.append('explicit interaction card maps to one original button click')
    count=page.evaluate('clicks');assert count==3
    prior=fresh();page.reload();reloaded=fresh(prior['conversationId']);assert reloaded['documentId']!=prior['documentId'] and page.evaluate('clicks')==0
    results.append('bound-page reload reattaches the same conversation without replaying prior commands')
    page.close();time.sleep(.3);code,closed=req(prefix+'?after=-1');assert code==200 and closed['tabClosed'] and closed['snapshot'] is None,(code,closed)
    results.append('closing bound tab asks for re-selection; no automatic fallback to another tab')
    print(json.dumps({'pass':True,'cases':results,'count':len(results),'fixtureSendClicks':count,'realUserMessagesSent':0,'modernUserMarkup':page.is_closed() and 'modernUserFixture' in HTML},ensure_ascii=False))
   finally:
    if service and service.poll() is None:service.terminate();service.wait(timeout=10)
    ctx.close()

if __name__=='__main__':run()
