import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {createStandaloneBridge,PRODUCTION_EXTENSION} from '../service/standalone.js';

const SNAP={schema:1,documentId:'fixture-document',conversationId:'11111111-1111-4111-8111-111111111111',messages:[{id:'a1',role:'assistant',text:'fixture answer'}],draft:'',draftHash:'empty',status:'completed'};
async function fixture(t,options={}){
 const directory=options.directory||await fs.mkdtemp(path.join(os.tmpdir(),'bridge-unit-'));
 const service=await createStandaloneBridge({directory,timeoutMs:100,...options});
 const address=await service.listen(0,'127.0.0.1');
 const base='http://127.0.0.1:'+address.port;
 const phone=service.setup().token;
 const ipc=JSON.parse(await fs.readFile(path.join(directory,'extension-auth.json'),'utf8')).token;
 let stopped=false;
 const close=async()=>{if(!stopped){stopped=true;await service.close();}};
 t.after(close);
 async function req(route,body,headers={}){
  const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+phone,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
  return {code:r.status,body:await r.json()};
 }
 return {directory,service,base,phone,ipc,close,req};
}
async function peer(t,f,handle){
 const ws=new WebSocket(f.base.replace('http:','ws:')+'/bridge',{origin:'chrome-extension://'+PRODUCTION_EXTENSION});
 ws.on('error',()=>{});t.after(()=>ws.terminate());await once(ws,'open');
 const ready=once(ws,'message');ws.send(JSON.stringify({type:'bridge_hello',protocol:1,token:f.ipc,version:'unit'}));
 assert.equal(JSON.parse((await ready)[0]).type,'bridge_ready');
 ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='mobile_command')return;const result=handle?.(msg);if(result!==undefined&&msg.requestId)ws.send(JSON.stringify({type:'mobile_result',requestId:msg.requestId,ok:true,result}));});
 return ws;
}
const reply=msg=>msg.action==='list'?{tabs:[{tabId:3,conversationId:SNAP.conversationId}]}:msg.action==='subscribe'||msg.action==='refresh'?{snapshot:SNAP}:{ok:true};

test('standalone authenticated HTTP works without an executor; unavailable extension fails promptly',async t=>{
 const f=await fixture(t);
 assert.equal((await f.req('/v1/health')).code,200);
 assert.equal((await f.req('/v1/health',null,{Authorization:''})).code,401);
 assert.equal((await f.req('/v1/health',null,{Origin:'https://example.invalid'})).code,403);
 assert.equal((await f.req('/api/workflows/run')).code,404);
 assert.equal((await f.req('/v1/tabs')).body.error,'pc_offline');
 assert.equal(f.service.health().extensionConnected,false);
});
test('WebSocket upgrade rejects browser origins before accepting any token',async t=>{
 const f=await fixture(t);const ws=new WebSocket(f.base.replace('http:','ws:')+'/bridge',{origin:'https://chatgpt.com'});
 ws.on('error',()=>{});t.after(()=>ws.terminate());
 const code=await new Promise(resolve=>ws.on('unexpected-response',(_q,r)=>{resolve(r.statusCode);r.resume();ws.terminate();}));
 assert.equal(code,403);assert.equal(f.service.health().extensionConnected,false);
});
test('phone pairing token cannot authenticate as the extension',async t=>{
 const f=await fixture(t);const ws=new WebSocket(f.base.replace('http:','ws:')+'/bridge',{origin:'chrome-extension://'+PRODUCTION_EXTENSION});
 ws.on('error',()=>{});t.after(()=>ws.terminate());await once(ws,'open');
 const closed=once(ws,'close');ws.send(JSON.stringify({type:'bridge_hello',protocol:1,token:f.phone}));
 assert.equal((await closed)[0],1008);assert.equal(f.service.health().extensionConnected,false);
});
test('independent socket routes real HTTP reads and rejects a second live executor',async t=>{
 const f=await fixture(t);await peer(t,f,reply);
 assert.equal((await f.req('/v1/tabs')).body.tabs[0].tabId,3);
 const session=await f.req('/v1/sessions',{tabId:3});assert.equal(session.body.snapshot.messages[0].text,'fixture answer');
 const ws=new WebSocket(f.base.replace('http:','ws:')+'/bridge',{origin:'chrome-extension://'+PRODUCTION_EXTENSION});
 ws.on('error',()=>{});t.after(()=>ws.terminate());await once(ws,'open');
 const closed=once(ws,'close');ws.send(JSON.stringify({type:'bridge_hello',protocol:1,token:f.ipc}));
 assert.equal((await closed)[0],1008);assert.equal((await f.req('/v1/tabs')).code,200);
});
test('Send passes once across the independent HTTP-WebSocket link; receipt survives service restart',async t=>{
 const f=await fixture(t);let sends=0;
 await peer(t,f,msg=>{if(msg.action==='send'){sends++;return {status:'sent_confirmed',messageId:'user-one'};}return reply(msg);});
 const session=await f.req('/v1/sessions',{tabId:3});
 const command={commandId:randomUUID(),action:'send',documentId:SNAP.documentId,baseDraftHash:'empty',text:'one deliberate test send'};
 const route='/v1/sessions/'+session.body.sessionId+'/commands';
 const responses=await Promise.all([f.req(route,command),f.req(route,command)]);assert(responses.every(r=>r.code===200));
 assert.equal(sends,1);assert.equal((await f.req('/v1/commands/'+command.commandId)).body.result.status,'sent_confirmed');
 await f.close();const again=await fixture(t,{directory:f.directory});
 assert.equal(again.phone,f.phone);assert.equal(again.ipc,f.ipc);
 assert.equal((await again.req('/v1/commands/'+command.commandId)).body.result.status,'sent_confirmed');
 assert.equal(again.service.health().extensionConnected,false);
});
test('lost Send response remains unknown after restart, with no write replay',async t=>{
 const f=await fixture(t);let sends=0;
 await peer(t,f,msg=>{if(msg.action==='send'){sends++;return undefined;}return reply(msg);});
 const session=await f.req('/v1/sessions',{tabId:3});
 const command={commandId:randomUUID(),action:'send',documentId:SNAP.documentId,baseDraftHash:'empty',text:'unknown result'};
 const route='/v1/sessions/'+session.body.sessionId+'/commands';
 assert.equal((await f.req(route,command)).code,504);
 assert.equal((await f.req(route,command)).body.state,'unknown');assert.equal(sends,1);
 await f.close();const again=await fixture(t,{directory:f.directory});
 assert.equal((await again.req('/v1/commands/'+command.commandId)).body.state,'unknown');assert.equal(sends,1);
});
test('worker disconnect invalidates the old document instead of sending to a replacement',async t=>{
 const f=await fixture(t);const ws=await peer(t,f,reply);
 const s=(await f.req('/v1/sessions',{tabId:3})).body;
 ws.close();await once(ws,'close');await new Promise(r=>setTimeout(r,10));
 assert.equal((await f.req('/v1/sessions/'+s.sessionId)).body.routeChanged,true);
});
test('malformed private journal is not silently reset on extraction/startup',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-invalid-'));
 await fs.writeFile(path.join(directory,'commands.json'),'{broken');
 await assert.rejects(()=>createStandaloneBridge({directory}),/invalid_private_state/);
 assert.equal(await fs.readFile(path.join(directory,'commands.json'),'utf8'),'{broken');
 await fs.rm(directory,{recursive:true,force:true});
});
