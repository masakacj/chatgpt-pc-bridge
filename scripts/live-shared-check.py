"""Read-only checks of the installed Bridge against actual Chrome pages.
Private keys and message bodies stay in this process. No Send or navigation.
"""
from pathlib import Path
import argparse,json,urllib.request,urllib.error,hashlib,uuid
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=13213);p.add_argument('--data',default=str(ROOT/'var/stage'));p.add_argument('--tab',type=int);p.add_argument('--test-proof',action='store_true');args=p.parse_args()
token=json.loads((Path(args.data)/'pairing.json').read_text(encoding='utf-8-sig'))['token'];base=f'http://127.0.0.1:{args.port}'
def req(route,body=None,method=None):
 request=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(request,timeout=25) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
code,tabs=req('/v1/tabs?shared=1');assert code==200,(code,tabs)
print(json.dumps({'tabs':[{'tabId':t['tabId'],'active':t['active'],'hasConversation':bool(t['conversationId']),'titleChars':len(t['title'])} for t in tabs['tabs']]}))
if args.tab is not None:
 code,s=req('/v1/sessions',{'tabId':args.tab,'followTab':True,'readOnly':True,'clientId':'bridge-readonly-live-check'});assert code==200,(code,s)
 sid=s['sessionId']
 try:
  snap=s['snapshot'];assert snap['sharedTab'] and snap['draft']==''
  code,lib=req(f'/v1/sessions/{sid}/actions',{'commandId':str(uuid.uuid4()),'action':'catalog'});assert code==200,(code,lib)
  if args.test_proof:
   record=json.loads((Path(args.data)/'live-acceptance.json').read_text());assert record['tabId']==args.tab
   print(json.dumps({'testProof':[{'role':m['role'],'chars':len(m['text']),'hasBridgePrompt':'PC Bridge' in m['text'],'hasExpectedReply':'BRIDGE_OK' in m['text'],'sha256':hashlib.sha256(m['text'].encode()).hexdigest()[:12]} for m in snap['messages']],'matchesRecordedConversation':snap['conversationId'] in [x.get('conversationId') for x in record['operations'].values()]}))
  print(json.dumps({'realRead':True,'tabId':args.tab,'status':snap['status'],'messageCount':len(snap['messages']),'messageChars':sum(len(m['text']) for m in snap['messages']),'conversationHash':hashlib.sha256(snap['conversationId'].encode()).hexdigest()[:12],'pcDraftOccupied':snap['pcDraftOccupied'],'draftTextRedacted':snap['draft']=='','projects':len(lib['projects']),'loadedChats':len(lib['chats']),'partial':lib.get('partial'),'realUserMessagesSent':0}))
 finally:req(f'/v1/sessions/{sid}',method='DELETE')
