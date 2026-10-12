"""Read-only-content R2 acceptance on the recorded development tab.
Uses official search/navigation only; sends no messages or approval clicks.
Private IDs/results live under excluded var/stage. Public output is counts only.
"""
from pathlib import Path
import argparse,hashlib,json,time,urllib.request,urllib.error,urllib.parse,uuid
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=13213);parser.add_argument('--query',default='ChatGPT');parser.add_argument('--pages',type=int,default=3);parser.add_argument('--search-only',action='store_true');parser.add_argument('--fresh-tab',action='store_true');args=parser.parse_args()
folder=ROOT/'var/stage';state=json.loads((folder/'r1-r2-evidence.json').read_text(encoding='utf8'))
key=json.loads((folder/'pairing.json').read_text(encoding='utf-8-sig'))['token'];base=f'http://127.0.0.1:{args.port}'
def req(route,body=None,method=None):
    r=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
    try:
        with urllib.request.urlopen(r,timeout=27) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:return error.code,json.load(error)
def checked(route,body=None,method=None):
    code,result=req(route,body,method)
    if code!=200:raise RuntimeError(f'{route.split("?")[0]}:{code}:{result.get("error")}')
    return result
allowed={state['baselineConversation']}|{x.get('conversationId') for x in state['operations'].values() if x.get('conversationId')}
tabs=checked('/v1/tabs?shared=1')['tabs']
target=next((t for t in tabs if t['tabId']==state['tabId'] and t['conversationId'] in allowed),None) or next((t for t in tabs if t['conversationId'] in allowed),None)
previous_tab_ids={t['tabId'] for t in tabs}
if args.fresh_tab:target=None
if target is None:
    # Reopen only an already observed development conversation, never hijack
    # whatever conversation the user has since selected in the previous tab.
    request=urllib.request.Request('http://127.0.0.1:3210/api/debug/probe-chat',data=json.dumps({'chatUrl':'https://chatgpt.com/c/'+state['baselineConversation'],'needle':'BRIDGE_OK','settleMs':500,'keepOpen':True,'destructiveTest':False,'productionRuntime':False}).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=10) as response:opened=json.load(response)
    assert opened.get('ok'),'Recorded test conversation could not be opened'
    for _ in range(35):
        time.sleep(.4);tabs=checked('/v1/tabs?shared=1')['tabs'];target=next((t for t in tabs if t['conversationId']==state['baselineConversation'] and (not args.fresh_tab or t['tabId'] not in previous_tab_ids)),None)
        if target:break
assert target,'Recorded owned development tab is not available'
tab=target['tabId'];original=target['conversationId'];before_tabs={t['tabId'] for t in tabs}
session=checked('/v1/sessions',{'tabId':tab,'followTab':True,'clientId':'r2-boundary-acceptance'})['sessionId'];prefix='/v1/sessions/'+session
report={'checkedAt':time.time(),'tabId':tab,'realUserMessagesSent':0,'source':'actual_official_UI','checks':[]}
def save():
    out=folder/'r2-boundaries.json';tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(report),encoding='utf8');tmp.replace(out)
def emit(name,**values):
    result={'check':name,**values};report['checks'].append(result);save();print(json.dumps(result,ensure_ascii=False),flush=True)
def fresh(expected=None):
    for _ in range(70):
        result=checked(prefix+'?after=-1');s=result.get('snapshot')
        if s and s['status']!='loading' and (expected is None or s['conversationId']==expected):return s
        time.sleep(.15)
    raise RuntimeError('current_page_not_ready')
def action(kind,**values):
    s=fresh();return checked(prefix+'/actions',{'action':kind,'commandId':str(uuid.uuid4()),'documentId':s['documentId'],**values})
try:
    initial=fresh(original);assert not initial['pcDraftOccupied'],'Do not navigate over a PC draft'
    catalog=action('catalog');assert original in {c['id'] for c in catalog['chats']},'Return target must be observed in official sidebar'
    query='__BRIDGE_NO_RESULT_'+uuid.uuid4().hex+'__'
    empty=action('search',query=query)
    emit('empty_search',count=len(empty.get('chats',[])),loading=empty.get('loading'),emptyConfirmed=empty.get('emptyConfirmed'),hasMore=empty.get('hasMore'),source=empty.get('source'))
    results=action('search',query=args.query);all_items={x['id']:x for x in results.get('chats',[])}
    emit('search_initial',count=len(all_items),loading=results.get('loading'),emptyConfirmed=results.get('emptyConfirmed'),hasMore=results.get('hasMore'),source=results.get('source'))
    for page in range(min(5,max(0,args.pages))):
        if not results.get('hasMore'):break
        prev=set(all_items);results=action('search',query=args.query,more=True);all_items.update({x['id']:x for x in results.get('chats',[])})
        emit('search_more',page=page+1,pageCount=len(results.get('chats',[])),newUnique=len(set(all_items)-prev),totalUnique=len(all_items),hasMore=results.get('hasMore'),loading=results.get('loading'))
        if prev==set(all_items) and not results.get('loading'):break
    # A second zero-result query must not return stale hits from the previous query.
    empty2=action('search',query=query+'2')
    emit('search_after_results_empty',count=len(empty2.get('chats',[])),loading=empty2.get('loading'),emptyConfirmed=empty2.get('emptyConfirmed'),hasMore=empty2.get('hasMore'))
    if args.search_only:raise SystemExit(0)
    catalog=action('catalog')
    project=next((p for p in catalog.get('projects',[]) if 'chatgpt' in p['title'].lower().replace(' ','')),None)
    if project:
        expanded=action('project',projectId=project['id']);choices=[c for c in expanded.get('chats',[]) if (c.get('projectId') or '').startswith(project['id']) and c['id']!=original]
        selected=next((c for c in choices if '脚本' in c['title'] or '优化' in c['title']),choices[-1] if choices else None)
        if selected:
            action('open',targetConversationId=selected['id']);s=fresh(selected['id'])
            emit('project_older_chat',sameTab=True,projectMatches=bool((s.get('projectId') or '').startswith(project['id'])),messageCount=len(s['messages']),status=s['status'],pcDraftOccupied=s['pcDraftOccupied'])
            seen={m['id'] for m in s['messages']};cursor=s.get('historyCursor');has_more=s.get('hasOlder');seen_cursors=set();pages=0
            while has_more and cursor and cursor not in seen_cursors and pages<5:
                seen_cursors.add(cursor);q=urllib.parse.urlencode({'before':cursor,'documentId':s['documentId']})
                code,result=req(prefix+'/history?'+q)
                if code!=200:
                    emit('history_page',page=pages+1,http=code,error=result.get('error'));break
                items=result['messages'];overlap=len(seen&{m['id'] for m in items});seen.update(m['id'] for m in items)
                emit('history_page',page=pages+1,http=200,count=len(items),duplicateMessages=overlap,documentMatches=result['documentId']==s['documentId'],conversationMatches=result['conversationId']==s['conversationId'],hasMore=result['hasMore'],cursorAdvanced=result.get('cursor')!=cursor)
                pages+=1;cursor=result.get('cursor');has_more=result.get('hasMore')
            emit('history_summary',pages=pages,totalUniqueMessages=len(seen),hasMore=bool(has_more),sourceLimitedToLoadedWebHistory=True)
        else:emit('project_older_chat',available=False)
    else:emit('project_older_chat',projectAvailable=False)
finally:
    try:
        now=fresh()
        if now['conversationId']!=original and not now['pcDraftOccupied']:
            action('open',targetConversationId=original)
        restored=fresh(original)
        after={t['tabId'] for t in checked('/v1/tabs?shared=1')['tabs']}
        report['restoredOriginal']=restored['conversationId']==original;report['tabSetUnchanged']=after==before_tabs;report['completedAt']=time.time();save()
        print(json.dumps({'restoredOriginal':report['restoredOriginal'],'tabSetUnchanged':report['tabSetUnchanged'],'realUserMessagesSent':0}),flush=True)
    finally:req(prefix,method='DELETE')
