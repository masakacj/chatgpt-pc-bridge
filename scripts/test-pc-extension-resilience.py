"""Actual MV3 Chromium regression with isolated profile + synthetic pages.
No real account, ChatGPT requests, production extension reload, or credentials.
Builds only disposable test artifacts; production modules are copied unchanged.
"""
from __future__ import annotations
import json, tempfile, shutil, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
C='33333333-3333-4333-8333-333333333333'
D='44444444-4444-4444-8444-444444444444'
E='55555555-5555-4555-8555-555555555555'
F='66666666-6666-4666-8666-666666666666'
G='77777777-7777-4777-8777-777777777777'
H='88888888-8888-4888-8888-888888888888'
I='99999999-9999-4999-8999-999999999999'
J='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
K='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
L='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
M='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
N='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
O='ffffffff-ffff-4fff-8fff-ffffffffffff'
counts={}
scenario={A:'running', B:'complete',C:'once503',D:'always503',E:'auth',F:'draft',G:'rateLimit',H:'bare503',I:'portal503',J:'nativeUnread',K:'nativeRunning',L:'nativeError',M:'cancelledThinkError',N:'cancelledByUser',O:'cancelledQuotedUser'}

def html(chat=None):
    def row(i):
        link=f'<a href="/c/{i}" id="chat-{i}"'+(' aria-current="page"' if i==chat else '')+'>Synthetic chat</a>'
        if i not in [J,K,L]:
            return link
        native_dot='<span class="absolute inset-0 rounded-full bg-info-solid"></span>' if (i==J and scenario[J]=='nativeUnread') or (i==K and scenario[K]=='nativeUnreadTransition') else ''
        native_spinner='<div class="motion-safe:animate-spin"><svg></svg></div>' if i==K and scenario[K]=='nativeRunning' else ''
        return f'<div class="group relative cursor-interaction" id="row-{i}"><div>{link}</div>{native_dot}{native_spinner}</div>'
    nav='<nav>'+''.join(row(i) for i in [A,B,C,D,E,F,G,H,I,J,K,L,M,N,O])+'</nav>'
    mode=scenario.get(chat)
    if chat and mode in ['running','complete','nativeUnread','nativeRead','nativeRunning','nativeError']:
        state='in_progress' if mode in ['running','nativeRunning'] else 'failed' if mode=='nativeError' else 'complete'
        body=f'<div class="transcriptContent"><div data-turn-key="{chat}-turn" data-talvt-turn-state="{state}"><div class="DilResponseRoot">Preserved final answer text</div></div></div>'
        code=''
    elif chat and mode in ['cancelledThinkError','cancelledByUser','cancelledQuotedUser']:
        # Actual native failure: a cancelled final turn, no assistant role,
        # and the official leaf label "无法思考". Do not resend the prompt.
        issue='<div class="native-failure"><span>无法思考</span></div>' if mode=='cancelledThinkError' else ''
        user='<div data-conversation-role="user"><span>无法思考</span></div>' if mode=='cancelledQuotedUser' else '<div>User prompt already sent</div>'
        body=f'<div class="transcriptContent"><div data-turn-key="{chat}-turn" data-talvt-turn-state="cancelled">{user}{issue}</div></div>'
        code=''
    elif chat:
        body='<div class="transcriptContent"></div><textarea id="prompt-textarea">'+('unsent private draft' if mode=='draft' else '')+'</textarea>'
        panelAttrs = "panel.setAttribute('role','alert');panel.dataset.testid='conversation-error';" if mode!='bare503' else ''
        errorText = 'Could not load this ChatGPT conversation' if mode=='bare503' else 'Unable to load GPT conversation' if mode=='portal503' else 'Unable to load conversation'
        panelParent = 'document.body' if mode=='portal503' else 'root'
        code=f'''let attempts=0;window.__fixtureClicks=0;
        async function readChat() {{
          const r=await fetch('/backend-api/conversations/{chat}');
          const root=document.querySelector('main');
          if(!r.ok){{
            let panel=document.getElementById('load-error');
            if(!panel){{panel=document.createElement('div');panel.id='load-error';{panelAttrs}panel.innerHTML='{errorText} <button id="native-load-retry">Retry</button>';{panelParent}.appendChild(panel);}}
            panel.querySelector('button').onclick=()=>{{window.__fixtureClicks++;readChat();}};
          }}else{{
            document.getElementById('load-error')?.remove();
            root.querySelector('.transcriptContent').innerHTML='<div data-turn-key="{chat}-turn" data-talvt-turn-state="complete"><div class="DilResponseRoot">Successfully recovered original saved answer.</div></div>';
          }}
        }}
        setTimeout(readChat,700);'''
    else:
        body='<p>Home - no conversation</p>';code=''
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>body{{font:14px system-ui}}nav a{{display:block;min-height:22px}}main{{min-height:400px}}[role=alert]{{padding:10px}}button{{min-width:80px;min-height:30px}}</style></head><body><div id="nav-mount"></div><main>{body}</main><script>setTimeout(()=>{{document.getElementById('nav-mount').innerHTML={json.dumps(nav)}}},3200);{code}</script></body></html>'''

def run():
    results=[]
    with tempfile.TemporaryDirectory(prefix='pc-extension-e2e-') as temp:
        temp=Path(temp);ext=temp/'extension';ext.mkdir();profile=temp/'profile'
        for name in ['pc-resilience-core.js','pc-resilience-background.js','pc-resilience-content.js']:
            shutil.copy2(ROOT/'extension'/name,ext/name)
        (ext/'manifest.json').write_text(json.dumps({
          'manifest_version':3,'name':'Isolated PC resilience regression','version':'1.0.0',
          'permissions':['storage','tabs','scripting','webRequest'],
          'host_permissions':['https://chatgpt.com/*'],
          'background':{'service_worker':'test-worker.js','type':'module'},
          'content_scripts':[{'matches':['https://chatgpt.com/*'],'js':['pc-resilience-content.js'],'run_at':'document_idle'}]
        }),encoding='utf-8')
        (ext/'test-worker.js').write_text("import {startPcResilience} from './pc-resilience-background.js';globalThis.busy=false;globalThis.pcTest=startPcResilience({isBusy:()=>globalThis.busy});",encoding='utf-8')
        with sync_playwright() as p:
            def start():
                ctx=p.chromium.launch_persistent_context(str(profile),channel='chromium',headless=True,
                  args=['--disable-extensions-except='+str(ext),'--load-extension='+str(ext)],
                  ignore_default_args=['--disable-extensions'])
                def handler(route):
                    url=route.request.url
                    if url.startswith('https://chatgpt.com/backend-api/conversations/'):
                        id=url.rsplit('/',1)[-1];counts[id]=counts.get(id,0)+1
                        mode=scenario.get(id)
                        code=429 if mode=='rateLimit' else 503 if mode in ['always503','draft'] or (mode in ['once503','bare503','portal503'] and counts[id]==1) else 401 if mode=='auth' else 200
                        route.fulfill(status=code,content_type='application/json',body=json.dumps({'ok':code==200}))
                    elif url.startswith('https://chatgpt.com/'):
                        chat=url.split('/c/',1)[1].split('?')[0] if '/c/' in url else None
                        route.fulfill(status=200,content_type='text/html',body=html(chat))
                    else:route.abort()
                ctx.route('**/*',handler)
                worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker',timeout=20000)
                return ctx,worker
            ctx,worker=start()
            def page(url):
                page=ctx.new_page();page.goto(url,wait_until='domcontentloaded');return page
            def badge(pg,id,state):
                pg.wait_for_function("([id,state])=>document.getElementById('chat-'+id)?.getAttribute('data-orch-pc-state')===state",arg=[id,state],timeout=14000)
            a=page('https://chatgpt.com/c/'+A);badge(a,A,'running');a.close()
            b=page('https://chatgpt.com/c/'+B);badge(b,B,'completed');b.close()
            home=page('https://chatgpt.com/');badge(home,A,'running');badge(home,B,'completed')
            results.append({'case':'close_tab_late_sidebar','pass':True,'runningRestored':True,'completedRestored':True})
            # Same document / History API routing must validate current tab URL,
            # not sender.url from the original document creation.
            home.evaluate("id => {history.pushState({},'', '/c/'+id);document.querySelector('main').innerHTML='<div class=transcriptContent><div data-turn-key=spa-fresh data-talvt-turn-state=complete><div class=DilResponseRoot>New complete SPA answer.</div></div></div>';dispatchEvent(new PopStateEvent('popstate'));}",B)
            home.wait_for_timeout(1200)
            saved=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",B)
            assert saved['pc-state-v1:'+B]['turnKey']=='spa-fresh',saved
            results.append({'case':'spa_state_current_route','pass':True})
            home.close();ctx.close()
            ctx,worker=start()
            home=page('https://chatgpt.com/');badge(home,A,'running');badge(home,B,'completed')
            results.append({'case':'full_browser_restart','pass':True,'storage':'chrome.storage.local'})
            home.close()
            b=page('https://chatgpt.com/c/'+B);badge(b,B,'completed')
            # Once finite hydration checks expire, a native turn transition
            # still needs to update badges without user Send or idle polling.
            b.wait_for_timeout(67500)
            b.evaluate("() => document.querySelector('[data-talvt-turn-state]').setAttribute('data-talvt-turn-state','in_progress')")
            badge(b,B,'running')
            b.evaluate("() => document.querySelector('[data-talvt-turn-state]').setAttribute('data-talvt-turn-state','complete')")
            badge(b,B,'completed')
            results.append({'case':'native_transition_after_idle_window','pass':True,'idlePolling':False})
            b.close()
            c=page('https://chatgpt.com/c/'+C)
            try:
                badge(c,C,'completed')
            except Exception:
                print(json.dumps({'diagnostic':'network-retry','audit':worker.evaluate('() => pcTest.audit()'),'requests':counts,'clicks':c.evaluate('window.__fixtureClicks'),'htmlError':c.locator('[role=alert]').count()}))
                raise
            clicked=c.evaluate('window.__fixtureClicks')
            assert clicked==1,(clicked,counts)
            results.append({'case':'503_then_success','pass':True,'nativeRetryClicks':clicked,'readRequests':counts.get(C)})
            c.close()
            d=page('https://chatgpt.com/c/'+D)
            d.wait_for_timeout(11000)
            clicks=d.evaluate('window.__fixtureClicks')
            assert clicks==2,(clicks,counts)
            d.reload();d.wait_for_timeout(5000)
            assert d.evaluate('window.__fixtureClicks')==0
            results.append({'case':'persistent_retry_budget','pass':True,'attemptsBeforeReload':clicks,'attemptsAfterReload':0})
            d.close()
            for id,name in [(E,'auth_not_retried'),(F,'unsent_draft_preserved'),(G,'http429_never_auto_retried')]:
                pg=page('https://chatgpt.com/c/'+id);pg.wait_for_timeout(4200)
                assert pg.evaluate('window.__fixtureClicks')==0
                if id==F: assert pg.locator('#prompt-textarea').input_value()=='unsent private draft'
                results.append({'case':name,'pass':True,'nativeRetryClicks':0});pg.close()
            h=page('https://chatgpt.com/c/'+H)
            badge(h,H,'completed')
            assert h.evaluate('window.__fixtureClicks')==1
            results.append({'case':'plain_native_load_error_without_alert_wrapper','pass':True,'nativeRetryClicks':1})
            h.close()
            i=page('https://chatgpt.com/c/'+I)
            badge(i,I,'completed')
            assert i.evaluate('window.__fixtureClicks')==1
            results.append({'case':'portaled_native_load_error_outside_main','pass':True,'nativeRetryClicks':1})
            i.close()
            # Native row badges live OUTSIDE the link itself. They are source
            # signals for persistence, not our own completion/read guesses.
            home=page('https://chatgpt.com/')
            home.wait_for_timeout(4500)
            savedJ=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",J)['pc-state-v1:'+J]
            savedK=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",K)['pc-state-v1:'+K]
            assert savedJ['readState']=='unread' and savedJ['status']=='uncertain',(savedJ,savedK)
            assert savedK['status']=='running',(savedJ,savedK)
            assert home.evaluate("id => document.getElementById('chat-'+id).hasAttribute('data-orch-pc-state')",J)==False
            assert home.evaluate("id => document.getElementById('chat-'+id).hasAttribute('data-orch-pc-state')",K)==False
            results.append({'case':'native_sidebar_spinner_unread_dot_captured_without_duplicate_labels','pass':True})
            # Native spinner -> native blue dot: a tracked running task has
            # now completed while backgrounded, without opening that chat.
            home.evaluate("id => {const row=document.getElementById('row-'+id);row.querySelector('[class*=animate-spin]').remove();const dot=document.createElement('span');dot.className='absolute inset-0 rounded-full bg-info-solid';row.append(dot);}",K)
            home.wait_for_timeout(900)
            savedK=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",K)['pc-state-v1:'+K]
            assert savedK['status']=='completed' and savedK['readState']=='unread',savedK
            assert home.evaluate("id => document.getElementById('chat-'+id).hasAttribute('data-orch-pc-state')",K)==False
            scenario[K]='nativeUnreadTransition'
            results.append({'case':'native_spinner_to_unread_dot_completes_tracked_background_task','pass':True})
            home.close()
            j=page('https://chatgpt.com/c/'+J)
            j.wait_for_timeout(4700)
            savedJ=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",J)['pc-state-v1:'+J]
            assert savedJ['status']=='completed' and savedJ['readState']=='unread',savedJ
            j.evaluate("() => {document.querySelector('#row-"+J+" .bg-info-solid').remove();document.dispatchEvent(new Event('visibilitychange'));}")
            badge(j,J,'completed_read')
            savedJ=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",J)['pc-state-v1:'+J]
            assert savedJ['readState']=='read',savedJ
            scenario[J]='nativeRead'
            j.close()
            home=page('https://chatgpt.com/')
            badge(home,J,'completed_read')
            results.append({'case':'native_completed_unread_read_and_reopen_restore','pass':True})
            home.close()
            l=page('https://chatgpt.com/c/'+L)
            badge(l,L,'error')
            results.append({'case':'native_explicit_error_state','pass':True})
            l.close()
            for id,expected,name in [
                (M,'error','native_cancelled_with_visible_think_error'),
                (N,'stopped','ordinary_native_cancelled_is_not_error'),
                (O,'stopped','quoted_user_error_text_cannot_create_error')
            ]:
                pg=page('https://chatgpt.com/c/'+id)
                badge(pg,id,expected)
                results.append({'case':name,'pass':True,'status':expected})
                pg.close()
            # A full Chromium process restart must keep read, unread and error
            # together. The restart is ONLY in this isolated synthetic profile.
            ctx.close()
            ctx,worker=start()
            home=page('https://chatgpt.com/')
            badge(home,J,'completed_read')
            badge(home,L,'error')
            badge(home,M,'error')
            badge(home,N,'stopped')
            home.wait_for_timeout(450)
            savedK=worker.evaluate("id => chrome.storage.local.get('pc-state-v1:'+id)",K)['pc-state-v1:'+K]
            assert savedK['status']=='completed' and savedK['readState']=='unread',savedK
            results.append({'case':'native_read_unread_and_error_survive_full_browser_restart','pass':True})
            home.close()
            # Service-worker state and lifetime-independent storage proof.
            audit=worker.evaluate('() => pcTest.audit()')
            assert audit['recordCount']>=3,audit
            ctx.close()
    print(json.dumps({'pass':True,'engine':'real Chromium MV3 extension','cases':results,'audit':audit},ensure_ascii=False))

if __name__=='__main__':run()
