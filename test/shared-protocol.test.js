import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMobileBridge} from '../service/mobile-bridge.js';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const snapshot=(id=A,epoch=0)=>({schema:1,sharedTab:true,documentId:'doc-'+id,conversationId:id,route:'/c/'+id,bindingRevision:epoch,messages:[{id:'a-'+id,role:'assistant',text:'Fixture answer'}],draft:'PRIVATE_PC_DRAFT',draftHash:'fixture-hash',pcDraftOccupied:true,status:'completed'});
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shared-protocol-'));
 let service,answer=snapshot(),dropCompose=false;
 const sent=[];
 service=await createMobileBridge({directory,timeoutMs:50,send:msg=>{
  sent.push(msg);
  if(!msg.requestId)return true;
  if(dropCompose&&msg.action==='compose')return true;
  const result=['subscribe','refresh'].includes(msg.action)?{snapshot:{...answer}}:msg.action==='shared_list'?{tabs:[{tabId:7,conversationId:answer.conversationId}]}:msg.action==='compose'?{status:'sent_confirmed',conversationId:answer.conversationId}:msg.action==='catalog'?{projects:[],chats:[]}:{ok:true};
  setTimeout(()=>service.receive({type:'mobile_result',requestId:msg.requestId,ok:true,result}),2);return true;
 }});
 const address=await service.listen(0,'127.0.0.1');
 t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+address.port;
 async function req(route,body){
  const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+service.setup().token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {code:r.status,body:await r.json()};
 }
 async function bind(extra={}){return (await req('/v1/sessions',{tabId:7,clientId:'shared-protocol-client',followTab:true,...extra})).body;}
 return {service,sent,req,bind,setSnapshot:s=>{answer=s;},dropCompose:()=>{dropCompose=true;}};
}

test('known pre-dispatch page_loading receipt is corrected without losing its reservation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shared-old-loading-'));
 const id=randomUUID();await fs.writeFile(path.join(directory,'commands.json'),JSON.stringify({[id]:{hash:'same-reservation',state:'unknown',action:'compose',result:{error:'page_loading'}}}));
 let dispatches=0;const service=await createMobileBridge({directory,send:()=>{dispatches++;return false}});
 t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});
 const address=await service.listen(0,'127.0.0.1');
 const r=await fetch('http://127.0.0.1:'+address.port+'/v1/commands/'+id,{headers:{Authorization:'Bearer '+service.setup().token}});
 const result=await r.json();assert.equal(result.state,'failed');assert.equal(result.result.status,'not_sent');assert.equal(dispatches,0);
 const stored=JSON.parse(await fs.readFile(path.join(directory,'commands.json'),'utf8'));assert.equal(stored[id].hash,'same-reservation');
});
test('shared capability and tab discovery are explicit; old client route remains separate',async t=>{
 const f=await fixture(t);
 assert((await f.req('/v1/health')).body.capabilities.includes('compose-on-send'));
 assert.equal((await f.req('/v1/tabs?shared=1')).body.tabs[0].tabId,7);
 assert.equal(f.sent.at(-1).action,'shared_list');
 await f.req('/v1/tabs');assert.equal(f.sent.at(-1).action,'list');
});
test('shared server redacts PC editor text independently of native client parsing',async t=>{
 const f=await fixture(t);const s=await f.bind();
 assert.equal(s.snapshot.draft,'');assert.equal(s.snapshot.pcDraftOccupied,true);
 assert.equal(s.followTab,true);assert.equal(s.tabId,7);
 assert.equal(f.sent.find(m=>m.action==='subscribe').followTab,true);
});
test('shared navigation clears old transcript and rejects late snapshots from prior navigation epoch',async t=>{
 const f=await fixture(t);const s=await f.bind();
 f.service.receive({type:'mobile_tab_changed',sessionId:s.sessionId,tabId:7,bindingRevision:2,closed:false});
 let next=(await f.req('/v1/sessions/'+s.sessionId+'?after=-1')).body;
 assert.equal(next.snapshot,null);assert.equal(next.routeChanged,true);
 f.service.receive({type:'mobile_snapshot',sessionId:s.sessionId,tabId:7,snapshot:snapshot(A,1)});
 next=(await f.req('/v1/sessions/'+s.sessionId+'?after=-1')).body;assert.equal(next.snapshot,null);
 f.service.receive({type:'mobile_snapshot',sessionId:s.sessionId,tabId:7,snapshot:snapshot(B,2)});
 next=(await f.req('/v1/sessions/'+s.sessionId+'?after=-1')).body;
 assert.equal(next.snapshot.conversationId,B);assert.equal(next.routeChanged,false);assert.equal(next.snapshot.draft,'');
 assert.equal(next.sessionId,s.sessionId);
});
test('a capture from a different Chrome tab cannot hijack a binding',async t=>{
 const f=await fixture(t);const s=await f.bind();
 f.service.receive({type:'mobile_snapshot',sessionId:s.sessionId,tabId:99,snapshot:snapshot(B,9)});
 const next=(await f.req('/v1/sessions/'+s.sessionId+'?after=-1')).body;assert.equal(next.snapshot.conversationId,A);
 f.service.receive({type:'mobile_tab_changed',sessionId:s.sessionId,tabId:7,closed:true});
 const closed=(await f.req('/v1/sessions/'+s.sessionId+'?after=-1')).body;
 assert.equal(closed.tabClosed,true);assert.equal(closed.snapshot,null);
});
test('shared reconnect reads current PC route rather than restoring old conversation',async t=>{
 const f=await fixture(t);const s=await f.bind();f.service.disconnected();f.setSnapshot(snapshot(B,0));
 const next=(await f.req('/v1/sessions/'+s.sessionId+'?after=-1')).body;
 assert.equal(next.snapshot.conversationId,B);assert.equal(next.sessionId,s.sessionId);
 assert.equal(f.sent.filter(m=>m.action==='subscribe').length,2);
 assert.equal(f.sent.filter(m=>m.action==='open'||m.action==='compose').length,0);
});
test('read-only shared sessions cannot create chats or compose/send',async t=>{
 const f=await fixture(t);const s=await f.bind({readOnly:true});
 const action={commandId:randomUUID(),action:'new',documentId:s.snapshot.documentId};
 assert.equal((await f.req('/v1/sessions/'+s.sessionId+'/actions',action)).body.error,'read_only');
 assert.equal((await f.req('/v1/sessions/'+s.sessionId+'/commands',{commandId:randomUUID(),action:'compose',documentId:s.snapshot.documentId,baseDraftHash:'fixture-hash',text:'must not send'})).body.error,'read_only');
 assert.equal(f.sent.filter(m=>m.action==='new'||m.action==='compose').length,0);
});
test('compose is one durable command and repeated HTTP submission never creates a second click',async t=>{
 const f=await fixture(t);const s=await f.bind();
 const command={commandId:randomUUID(),action:'compose',documentId:s.snapshot.documentId,baseDraftHash:'fixture-hash',text:'single message',projectId:'g-p-aaaaaaaaaaaaaaaa'};
 const route='/v1/sessions/'+s.sessionId+'/commands';
 const responses=await Promise.all([f.req(route,command),f.req(route,command)]);
 assert(responses.every(x=>x.code===200));assert.equal(f.sent.filter(m=>m.action==='compose').length,1);
 assert.equal(f.sent.find(m=>m.action==='compose').projectId,'g-p-aaaaaaaaaaaaaaaa');
 assert.equal((await f.req('/v1/commands/'+command.commandId)).body.result.status,'sent_confirmed');
 assert.equal(f.sent.filter(m=>m.action==='draft').length,0);
});
test('lost compose result is queryable and never replayed',async t=>{
 const f=await fixture(t);const s=await f.bind();f.dropCompose();
 const command={commandId:randomUUID(),action:'compose',documentId:s.snapshot.documentId,baseDraftHash:'fixture-hash',text:'uncertain'};
 const route='/v1/sessions/'+s.sessionId+'/commands';
 assert.equal((await f.req(route,command)).code,504);
 assert.equal((await f.req(route,command)).body.state,'unknown');
 assert.equal((await f.req('/v1/commands/'+command.commandId)).body.state,'unknown');
 assert.equal(f.sent.filter(m=>m.action==='compose').length,1);
});
test('shared action contract refuses malformed targets, long queries and arbitrary URLs',async t=>{
 const f=await fixture(t);const s=await f.bind();const route='/v1/sessions/'+s.sessionId+'/actions';
 for(const command of [{action:'open',targetConversationId:'https://evil.invalid'},{action:'search',query:'x'.repeat(201)},{action:'new',projectId:'arbitrary'}]){
  const r=await f.req(route,{commandId:randomUUID(),documentId:s.snapshot.documentId,...command});assert.equal(r.code,400);
 }
 assert.equal(f.sent.filter(m=>['open','search','new'].includes(m.action)).length,0);
});
