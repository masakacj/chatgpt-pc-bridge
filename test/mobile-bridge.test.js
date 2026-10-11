import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createMobileBridge} from '../src/mobile-bridge.js';

async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-policy-'));
 let service,busy=false,hang=false,notSent=false,sends=0;
 const messages=[];
 const send=msg=>{
  messages.push(msg);
  if(msg.action==='send')sends++;
  if(hang&&['send','interact'].includes(msg.action))return true;
  if(!msg.requestId)return true;
  const result=msg.action==='list'?{tabs:[]}:
   msg.action==='subscribe'?{snapshot:{schema:1,conversationId:'11111111-1111-4111-8111-111111111111',documentId:'doc',messages:[],draft:'',draftHash:'hash'}}:
   msg.action==='send'?(notSent?{status:'not_sent',error:'send_unavailable'}:{status:'sent_confirmed',messageId:'m1'}):msg.action==='interact'?{status:'interaction_clicked'}:{status:'draft_synced',draftHash:'new',documentId:'doc'};
  setTimeout(()=>service.receive({type:'mobile_result',requestId:msg.requestId,ok:true,result}),5);
  return true;
 };
 service=await createMobileBridge({directory,send,isBusy:()=>busy,timeoutMs:50,...options});
 const address=await service.listen(0);const base=`http://127.0.0.1:${address.port}`,token=service.setup().token;
 const req=async(url,method='GET',body,headers={})=>{
  const r=await fetch(base+url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
 };
 t.after(async()=>{await service.close();await fs.rm(directory,{force:true,recursive:true})});
 return {req,service,directory,token,busy:v=>busy=v,hang:v=>hang=v,notSent:v=>notSent=v,sends:()=>sends,messages};
}
const command=(id='abcdefghijklmnop1')=>({commandId:id,action:'send',documentId:'doc',baseDraftHash:'hash',text:'Explicit mobile text'});
test('mobile API rejects absent auth, browser origin, and unrelated admin paths',async t=>{
 const f=await fixture(t);
 assert.equal((await f.req('/v1/health','GET',null,{authorization:''})).status,401);
 assert.equal((await f.req('/v1/health','GET',null,{origin:'https://evil.invalid'})).status,403);
 assert.equal((await f.req('/api/workflows/run')).status,404);
 assert.equal((await f.req('/v1/health')).data.protocol,1);
});
test('paired session scoped to one chosen tab and read-only blocks commands',async t=>{
 const f=await fixture(t);
 const made=await f.req('/v1/sessions','POST',{tabId:3,readOnly:true});
 assert.equal(made.status,200);
 assert.equal((await f.req(`/v1/sessions/${made.data.sessionId}/commands`,'POST',command())).status,409);
 assert.equal(f.sends(),0);
 assert.equal((await f.req('/v1/sessions','POST',{tabId:3})).data.error,'tab_already_paired');
});
test('duplicate concurrent Send is executed once and recorded before dispatch',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;
 const results=await Promise.all([f.req(`/v1/sessions/${s}/commands`,'POST',command()),f.req(`/v1/sessions/${s}/commands`,'POST',command())]);
 assert.equal(f.sends(),1);
 assert.ok(results.some(r=>r.data.state==='done'));
 const journal=JSON.parse(await fs.readFile(path.join(f.directory,'commands.json'),'utf8'));
 assert.equal(journal.abcdefghijklmnop1.state,'done');
 assert.ok(!JSON.stringify(journal).includes('Explicit mobile text'));
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',{...command(),text:'different'})).data.error,'command_id_conflict');
});
test('lost send receipt remains unknown; same command cannot be replayed',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;f.hang(true);
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',command())).status,504);
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',command())).data.state,'unknown');
 assert.equal(f.sends(),1);
 assert.equal((await f.req('/v1/commands/abcdefghijklmnop1')).data.state,'unknown');
});
test('busy workflow blocks mobile writes and changed route invalidates snapshot',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;f.busy(true);
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',command())).data.error,'workflow_busy');
 f.service.receive({type:'mobile_snapshot',sessionId:s,tabId:3,snapshot:{schema:1,conversationId:'different-chat',messages:[]}});
 assert.equal((await f.req(`/v1/sessions/${s}`)).data.routeChanged,true);
 assert.equal(f.sends(),0);
});
test('proven pre-click failure is a durable failed receipt, not an ambiguous retry',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;f.notSent(true);
 const r=await f.req(`/v1/sessions/${s}/commands`,'POST',command());
 assert.equal(r.status,200);assert.equal(r.data.state,'failed');assert.equal(r.data.result.status,'not_sent');
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',command())).data.state,'failed');
 assert.equal(f.sends(),1);
});
test('legacy button-missing receipt is corrected without discarding or replaying reservation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-legacy-'));
 await fs.writeFile(path.join(directory,'commands.json'),JSON.stringify({abcdefghijklmnop1:{action:'send',state:'unknown',at:1,hash:'h',result:{error:'send_unavailable'}}}));
 let dispatch=0;const service=await createMobileBridge({directory,send:()=>{dispatch++;return false}});
 t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true})});
 await service.listen(0);
 const saved=JSON.parse(await fs.readFile(path.join(directory,'commands.json'),'utf8'));
 assert.equal(saved.abcdefghijklmnop1.state,'failed');assert.equal(saved.abcdefghijklmnop1.hash,'h');assert.equal(dispatch,0);
});
test('sidebar API still requires auth and refuses arbitrary actions/URLs',async t=>{
 const f=await fixture(t);
 assert.equal((await f.req('/v1/library','GET',null,{authorization:''})).status,401);
 assert.equal((await f.req('/v1/library/actions','POST',{action:'delete',tabId:3,commandId:'abcdefghijklmnop2'})).status,400);
 assert.equal((await f.req('/v1/library/actions','POST',{action:'open',tabId:3,commandId:'abcdefghijklmnop2',conversationId:'https://evil.invalid'})).status,400);
});
test('explicit interaction is confirmed once, durably reserved and not a repeated Send',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;
 const b={commandId:'interaction-command-1',action:'interact',documentId:'doc',interactionId:'interaction-button-1',interactionRevision:'revision-1234567890',confirmed:false};
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',b)).status,400);
 b.confirmed=true;f.busy(true);
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',b)).data.result.status,'interaction_clicked');
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',b)).data.state,'done');
 assert.equal(f.messages.filter(m=>m.action==='interact').length,1);assert.equal(f.sends(),0);
});
test('unknown interaction receipt cannot replay a prior authorization click',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;f.hang(true);
 const b={commandId:'interaction-command-2',action:'interact',documentId:'doc',interactionId:'interaction-button-2',interactionRevision:'revision-1234567890',confirmed:true};
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',b)).status,504);
 assert.equal((await f.req(`/v1/sessions/${s}/commands`,'POST',b)).data.state,'unknown');
 assert.equal(f.messages.filter(m=>m.action==='interact').length,1);
});
test('history requires a live paired session and a bounded cursor',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3,readOnly:true})).data.sessionId;
 assert.equal((await f.req(`/v1/sessions/${s}/history`)).status,400);
 assert.equal((await f.req('/v1/sessions/missing/history?before=x&documentId=d')).status,410);
 assert.equal((await f.req(`/v1/sessions/${s}/history?before=turn-old&documentId=doc`)).status,200);
 assert.equal(f.sends(),0);
});
test('same client reconnect reclaims only its matching session and cannot upgrade read-only',async t=>{
 const f=await fixture(t);const b={tabId:3,clientId:'client-persistent-001',readOnly:true};
 const first=await f.req('/v1/sessions','POST',b);const resumed=await f.req('/v1/sessions','POST',b);
 assert.equal(resumed.status,200);assert.equal(resumed.data.sessionId,first.data.sessionId);
 assert.equal((await f.req('/v1/sessions','POST',{...b,readOnly:false})).status,409);
 assert.equal((await f.req('/v1/sessions','POST',{...b,clientId:'client-different-002'})).status,409);
 assert.equal(f.messages.filter(m=>m.action==='refresh').length,1);assert.equal(f.sends(),0);
});
test('explicit snapshot freshness is read-only and never dispatches a Send',async t=>{
 const f=await fixture(t);const s=(await f.req('/v1/sessions','POST',{tabId:3})).data.sessionId;
 assert.equal((await f.req(`/v1/sessions/${s}?refresh=1`)).status,200);
 assert.equal(f.messages.filter(m=>m.action==='refresh').length,1);assert.equal(f.sends(),0);
 assert.equal((await f.req('/v1/sessions/missing?refresh=1')).status,410);
});
test('new native client can explicitly preserve source during known-chat navigation',async t=>{
 const f=await fixture(t);
 const r=await f.req('/v1/library/actions','POST',{action:'open',tabId:3,conversationId:'11111111-1111-4111-8111-111111111111',commandId:'navigation-test-001',preserveSource:true});
 assert.equal(r.status,200);
 const m=f.messages.find(m=>m.action==='open');assert.equal(m.preserveSource,true);assert.equal(f.sends(),0);
});
test('feature has no idle full-history polling, credential scraping or generation API',async()=>{
 const s=await fs.readFile(new URL('../extension/mobile-structure-content.js',import.meta.url),'utf8');
 assert.doesNotMatch(s,/setInterval\(|fetch\(|XMLHttpRequest|cookie|localStorage|location\.reload|\.removeChild\(/);
 assert.match(s,/last-two-turn/);
 assert.match(s,/baseDraftHash/);
 assert.match(s,/sent_unconfirmed/);
});
