"""Deliberate, once-only production UI acceptance in the owned test tab.
Never selects or writes a business conversation. IDs/keys/bodies are not printed.
A reserved Send is only looked up on subsequent invocations, never replayed.
"""
from pathlib import Path
import argparse,json,urllib.request,urllib.error,time,uuid,hashlib
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--tab',type=int,required=True);p.add_argument('--port',type=int,default=13213);p.add_argument('--data',default=str(ROOT/'var/stage'));p.add_argument('--step',choices=['ordinary','project','catalog','search'],default='catalog');p.add_argument('--retry-proven-not-sent',action='store_true');args=p.parse_args()
folder=Path(args.data);token=json.loads((folder/'pairing.json').read_text(encoding='utf-8-sig'))['token'];base=f'http://127.0.0.1:{args.port}';statefile=folder/'live-acceptance.json'
state=json.loads(statefile.read_text()) if statefile.exists() else {'tabId':args.tab,'operations':{}}
assert state['tabId']==args.tab,'Only the recorded owned test tab is permitted'
def save():
 temp=statefile.with_suffix('.tmp');temp.write_text(json.dumps(state),encoding='utf8');temp.replace(statefile)
def req(route,body=None,method=None):
 request=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(request,timeout=25) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
code,envelope=req('/v1/sessions',{'tabId':args.tab,'followTab':True,'clientId':'deliberate-bridge-ui-acceptance'});assert code==200,(code,envelope.get('error'))
sid=envelope['sessionId'];prefix='/v1/sessions/'+sid
try:
 def fresh():
  for _ in range(40):
   code,r=req(prefix+'?after=-1');snap=r.get('snapshot')
   if code==200 and snap and snap['status']!='loading':return snap
   time.sleep(.2)
  raise RuntimeError('test_page_not_ready')
 def action(kind,**fields):
  s=fresh();code,r=req(prefix+'/actions',{'commandId':str(uuid.uuid4()),'action':kind,'documentId':s['documentId'],**fields})
  if code!=200:raise RuntimeError(f'{kind}:{code}:{r.get("error")}')
  return r
 snap=fresh();assert snap['draft']==''
 library=action('catalog');projects=library.get('projects',[])
 if args.step=='catalog':
  print(json.dumps({'realPage':True,'status':snap['status'],'newChat':not bool(snap['conversationId']),'pcDraftOccupied':snap['pcDraftOccupied'],'projectCount':len(projects),'loadedChatCount':len(library.get('chats',[])),'testProjectAvailable':any('chatgpt' in x['title'].lower().replace(' ','') for x in projects)}));save()
 elif args.step=='search':
  assert 'ordinary' in state['operations'] and state['operations']['ordinary'].get('confirmed'),'Complete ordinary acceptance first'
  result=action('search',query='PC Bridge')
  ids=[x['id'] for x in result.get('chats',[])];expected=state['operations']['ordinary']['conversationId']
  print(json.dumps({'officialSearch':result.get('source'),'results':len(ids),'foundOwnTestConversation':expected in ids,'partial':result.get('partial'),'loading':result.get('loading'),'emptyConfirmed':result.get('emptyConfirmed')}))
  state['search']={'results':len(ids),'foundOwnTestConversation':expected in ids,'source':result.get('source')};save()
 else:
  previous=state['operations'].get(args.step)
  if previous:
   code,receipt=req('/v1/commands/'+previous['commandId']);print(json.dumps({'step':args.step,'existingCommand':True,'receiptHTTP':code,'state':receipt.get('state'),'status':receipt.get('result',{}).get('status'),'replayed':False}))
   if not args.retry_proven_not_sent:raise SystemExit(0)
   assert code==200 and receipt.get('state')=='failed' and receipt.get('result',{}).get('status')=='not_sent','Retry only after proven zero-click result'
   state.setdefault('failedAttempts',[]).append(previous);del state['operations'][args.step];save()
  if args.step=='ordinary':
   assert not snap['conversationId'],'First ordinary test must start on the owned empty page'
   action('new');project_id=None
  else:
   assert state['operations'].get('ordinary',{}).get('confirmed'),'Ordinary test must be confirmed'
   assert snap['conversationId']==state['operations']['ordinary']['conversationId'],'Do not move an unrelated conversation'
   target=next((x for x in projects if 'chatgpt' in x['title'].lower().replace(' ','')),None)
   assert target,'Known ChatGPT development project is not visible'
   project_id=target['id'];action('new',projectId=project_id)
  snap=fresh();assert not snap['conversationId'] and not snap['pcDraftOccupied'],'New test context must be empty'
  command_id=str(uuid.uuid4())
  prompt='PC Bridge '+('项目' if args.step=='project' else '普通聊天')+'原生镜像验收。请仅回复 BRIDGE_OK，不调用工具。'
  body={'commandId':command_id,'action':'compose','documentId':snap['documentId'],'baseDraftHash':snap['draftHash'],'text':prompt}
  if project_id:body['projectId']=project_id
  state['operations'][args.step]={'commandId':command_id,'reserved':True,'at':time.time(),'projectId':project_id};save()
  code,result=req(prefix+'/commands',body);receipt=result.get('result',{})
  op=state['operations'][args.step];op.update({'http':code,'state':result.get('state'),'status':receipt.get('status'),'error':receipt.get('error') or result.get('error'),'conversationId':receipt.get('conversationId'),'confirmed':receipt.get('status')=='sent_confirmed'});save()
  print(json.dumps({'step':args.step,'sendHTTP':code,'state':result.get('state'),'status':receipt.get('status'),'error':receipt.get('error'),'actualConversationAssigned':bool(receipt.get('conversationId')),'projectConfirmed':receipt.get('projectId')==project_id if project_id else None,'submittedCommands':1,'confirmedUserMessages':int(op['confirmed']),'noReplay':True}))
  if op['confirmed']:
   for _ in range(35):
    time.sleep(.4);s=fresh()
    if s['status'] not in ['running','loading'] and any(m['role']=='assistant' and 'BRIDGE_OK' in m['text'] for m in s['messages']):
     op['replyObserved']=True;save();print(json.dumps({'step':args.step,'replyObserved':True,'status':s['status'],'boundTabUnchanged':True}));break
finally:req(prefix,method='DELETE')
