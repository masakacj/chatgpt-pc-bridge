"""Focused live acceptance using only our previously recorded development chats.
No business-chat selection, private content printing, or automatic Send replay.
Evidence/command IDs are kept under the excluded private var directory.
"""
from pathlib import Path
import argparse,json,urllib.request,urllib.error,time,uuid,hashlib

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--step',choices=['recorded','existing','ordinary','project','search'],default='recorded')
parser.add_argument('--port',type=int,default=13213)
parser.add_argument('--retry-proven-not-sent',action='store_true')
parser.add_argument('--use-restored-context',action='store_true')
parser.add_argument('--case',default='')
args=parser.parse_args()
assert not args.case or args.case.replace('-','').isalnum()
case_key=args.step+('-'+args.case if args.case else '')
folder=ROOT/'var/stage'
prior=json.loads((folder/'live-acceptance.json').read_text(encoding='utf-8-sig'))
old_id=prior['operations']['ordinary']['conversationId']
assert old_id,'An observed development conversation must be recorded first'
token=json.loads((folder/'pairing.json').read_text(encoding='utf-8-sig'))['token']
base=f'http://127.0.0.1:{args.port}'
evidence_path=folder/'r1-r2-evidence.json'
evidence=json.loads(evidence_path.read_text()) if evidence_path.exists() else {'baselineConversation':old_id,'operations':{}}
assert evidence['baselineConversation']==old_id

def save():
    temp=evidence_path.with_suffix('.tmp');temp.write_text(json.dumps(evidence),encoding='utf8');temp.replace(evidence_path)
def req(route,body=None,method=None):
    request=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
    try:
        with urllib.request.urlopen(request,timeout=25) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:return error.code,json.load(error)
def report(value):print(json.dumps(value,ensure_ascii=False))

code,tabs=req('/v1/tabs?shared=1');assert code==200
allowed={old_id}|{op.get('conversationId') for op in evidence['operations'].values() if op.get('conversationId')}
owned_empty=bool(evidence.get('failedAttempts')) or any(op.get('status')=='not_sent' for op in evidence['operations'].values())
selected=None if args.use_restored_context else next((tab for tab in tabs['tabs'] if tab['tabId']==evidence.get('tabId') and (tab['conversationId'] in allowed or owned_empty and not tab['conversationId'])),None)
if selected is None:selected=next((tab for tab in tabs['tabs'] if tab['conversationId']==old_id),None)
assert selected,'Restore the recorded test URL in a development tab; do not use an unrelated chat'
tab=selected['tabId'];evidence['tabId']=tab;save()
code,envelope=req('/v1/sessions',{'tabId':tab,'followTab':True,'readOnly':args.step=='recorded','clientId':'r1-r2-owned-test-acceptance'})
assert code==200,(code,envelope.get('error'))
sid=envelope['sessionId'];prefix='/v1/sessions/'+sid

def fresh():
    for _ in range(45):
        code,envelope=req(prefix+'?after=-1');snapshot=envelope.get('snapshot')
        if code==200 and snapshot and snapshot['status']!='loading':return snapshot
        time.sleep(.2)
    raise RuntimeError('owned_test_page_not_ready')
def action(kind,**fields):
    snapshot=fresh()
    code,result=req(prefix+'/actions',{'action':kind,'commandId':str(uuid.uuid4()),'documentId':snapshot['documentId'],**fields})
    if code!=200:raise RuntimeError(f'{kind}:{code}:{result.get("error")}')
    return result

try:
    snapshot=fresh();assert snapshot['conversationId'] in allowed or owned_empty and not snapshot['conversationId']
    if args.step=='recorded':
        expected='PC Bridge 普通聊天原生镜像验收。请仅回复 BRIDGE_OK，不调用工具。'
        users=[m for m in snapshot['messages'] if m['role']=='user' and m['text'].strip()==expected]
        replies=[m for m in snapshot['messages'] if m['role']=='assistant' and 'BRIDGE_OK' in m['text']]
        code,receipt=req('/v1/commands/'+prior['operations']['ordinary']['commandId'])
        evidence['recorded']={'userMessages':len(users),'assistantReplies':len(replies),'bothRoles':bool(users and replies),'receiptHTTP':code,'oldReceiptStatus':receipt.get('result',{}).get('status'),'observedAt':time.time(),'replayed':False}
        save();report({'step':'recorded','tabId':tab,**evidence['recorded']})
        assert len(users)==1 and replies,'Both roles must be extracted from the actual official page'
    elif args.step=='search':
        baseline=next((op for key,op in reversed(list(evidence['operations'].items())) if key.startswith('ordinary') and op.get('confirmed')),None)
        assert baseline,'ordinary acceptance first'
        catalog=action('catalog');result=action('search',query='PC Bridge')
        ids=[item['id'] for item in result.get('chats',[])]
        own=baseline['conversationId']
        data={'source':result.get('source'),'results':len(ids),'foundOwnNewTest':own in ids,'hasMore':result.get('hasMore'),'partial':result.get('partial'),'loading':result.get('loading'),'emptyConfirmed':result.get('emptyConfirmed'),'outsideLoadedSidebar':len(set(ids)-{x['id'] for x in catalog.get('chats',[])})}
        evidence['search']=data;save();report({'step':'search',**data})
    else:
        previous=evidence['operations'].get(case_key)
        if previous:
            code,receipt=req('/v1/commands/'+previous['commandId'])
            report({'step':args.step,'existingCommand':True,'receiptHTTP':code,'state':receipt.get('state'),'status':receipt.get('result',{}).get('status'),'replayed':False})
            if receipt.get('result',{}).get('status')=='sent_confirmed':
                current=fresh();expected='PC Bridge 0.2.2 '+('项目' if args.step=='project' else '现有聊天' if args.step=='existing' else '用户消息')+'提取验收'+(' ['+args.case+']' if args.case else '')+'\n请仅回复 BRIDGE_R1_OK，不调用工具。'
                users=[m for m in current['messages'] if m['role']=='user' and m['text'].strip()==expected]
                replies=[m for m in current['messages'] if m['role']=='assistant' and 'BRIDGE_R1_OK' in m['text']]
                previous.update({'userMessages':len(users),'assistantReplies':len(replies),'bothRoles':bool(users and replies),'sameBoundTab':current['conversationId']==previous['conversationId']});save()
                report({'step':args.step,'readOnlyVerification':True,'userMessages':len(users),'assistantReplies':len(replies),'bothRoles':previous['bothRoles'],'sameBoundTab':previous['sameBoundTab']})
            if not args.retry_proven_not_sent:raise SystemExit(0)
            assert code==200 and receipt.get('state')=='failed' and receipt.get('result',{}).get('status')=='not_sent','Only proven pre-click failures permit a new explicit test command'
            evidence.setdefault('failedAttempts',[]).append(previous);del evidence['operations'][case_key];save()
        project_id=None
        if args.step=='project':
            assert any(evidence['operations'].get(k,{}).get('confirmed') for k in ['ordinary','existing']),'confirmed baseline acceptance first'
            library=action('catalog')
            target=next((project for project in library.get('projects',[]) if 'chatgpt' in project['title'].lower().replace(' ','')),None)
            assert target,'Development project must be observed in the official sidebar'
            project_id=target['id']
        if args.step!='existing':
            evidence['preparedNew']={'tabId':tab,'projectId':project_id,'step':args.step,'at':time.time()};save()
            action('new',**({'projectId':project_id} if project_id else {}))
        snapshot=fresh();assert not snapshot['pcDraftOccupied']
        assert snapshot['conversationId']==old_id if args.step=='existing' else not snapshot['conversationId']
        assert project_id is None or snapshot['projectId']==project_id
        command_id=str(uuid.uuid4())
        prompt='PC Bridge 0.2.2 '+('项目' if project_id else '现有聊天' if args.step=='existing' else '用户消息')+'提取验收'+(' ['+args.case+']' if args.case else '')+'\n请仅回复 BRIDGE_R1_OK，不调用工具。'
        command={'action':'compose','commandId':command_id,'documentId':snapshot['documentId'],'baseDraftHash':snapshot['draftHash'],'text':prompt}
        if project_id:command['projectId']=project_id
        op={'commandId':command_id,'projectId':project_id,'reserved':True,'at':time.time()};evidence['operations'][case_key]=op;save()
        code,result=req(prefix+'/commands',command)
        receipt=result.get('result') or {}
        op.update({'http':code,'state':result.get('state'),'status':receipt.get('status'),'error':receipt.get('error') or result.get('error'),'conversationId':receipt.get('conversationId'),'confirmed':receipt.get('status')=='sent_confirmed'});save()
        report({'step':args.step,'http':code,'state':op['state'],'status':op['status'],'error':op['error'],'conversationAssigned':bool(op['conversationId']),'projectConfirmed':receipt.get('projectId')==project_id if project_id else None,'submittedCommands':1,'replayed':False})
        if op['confirmed']:
            for _ in range(35):
                time.sleep(.35);current=fresh()
                users=[m for m in current['messages'] if m['role']=='user' and m['text'].strip()==prompt]
                replies=[m for m in current['messages'] if m['role']=='assistant' and 'BRIDGE_R1_OK' in m['text']]
                if users and replies:
                    op.update({'userMessages':len(users),'assistantReplies':len(replies),'bothRoles':True,'sameBoundTab':True});save()
                    report({'step':args.step,'userMessages':len(users),'assistantReplies':len(replies),'bothRoles':True,'sameBoundTab':True});break
            if op.get('bothRoles'):assert op['userMessages']==1,'One explicit test Send must produce exactly one matching user message'
            else:report({'step':args.step,'sendConfirmed':True,'replyPending':True,'nextCheckReadOnly':True,'replayed':False})
finally:
    req(prefix,method='DELETE')
