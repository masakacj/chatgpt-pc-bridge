import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function fixture(){
 const handlers=[],sent=[],state={shared:0,legacy:0,handled:0};let connection;
 const id='a'.repeat(32),url=`chrome-extension://${id}/background-reload.html#12345678-1234-1234-1234-123456789012`;
 const chrome={runtime:{id,getURL:p=>`chrome-extension://${id}/${p}`,onMessage:{addListener:f=>handlers.push(f)}},action:{onClicked:{addListener(){}}}};
 const ctx=vm.createContext({chrome,backgroundReloadBootId:'test-boot',Set,setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref();return t;},startMobileStructure:()=>({handle:()=>true,disconnected(){},audit:()=>({sessions:state.legacy})}),startSharedBridge:()=>({handle:()=>{state.handled++;return true;},disconnected(){},audit:()=>({sharedSessions:state.shared})}),startBridgeConnection:config=>{connection=config;return {send:m=>{sent.push(m);return true;},audit:()=>({ready:true})};}});
 vm.runInContext(source,ctx);
 const message=(type,sender={id,url})=>{let reply;for(const handler of handlers)handler({type},sender,r=>{reply=r;});return reply;};
 return {state,sent,ctx,connection,message,id,url};
}
test('maintenance is limited to the same extension maintenance resource',()=>{
 const f=fixture();assert.equal(f.message('BACKGROUND_RELOAD_PREPARE',{id:f.id,url:'https://chatgpt.com/'}),undefined);
 assert.equal(vm.runInContext('maintenancePending',f.ctx),false);
});
test('active shared or legacy mobile sessions cannot be reloaded',()=>{
 const f=fixture();f.state.shared=1;assert.equal(f.message('BACKGROUND_RELOAD_PREPARE').ok,false);
 f.state.shared=0;f.state.legacy=1;assert.equal(f.message('BACKGROUND_RELOAD_PREPARE').ok,false);
});
test('in-flight commands block reload even before a subscription exists',()=>{
 const f=fixture();f.connection.handle({type:'mobile_command',requestId:'r1',action:'shared_list'});
 assert.equal(f.message('BACKGROUND_RELOAD_PREPARE').ok,false);
 vm.runInContext("send({type:'mobile_result',requestId:'r1',ok:true})",f.ctx);
 assert.equal(f.message('BACKGROUND_RELOAD_PREPARE').ok,true);
});
test('prepared maintenance gates new commands without invoking page handlers',()=>{
 const f=fixture();assert.equal(f.message('BACKGROUND_RELOAD_PREPARE').bootId,'test-boot');
 f.connection.handle({type:'mobile_command',requestId:'new',action:'compose'});
 assert.equal(f.state.handled,0);assert.equal(f.sent[0].error,'extension_maintenance');
 assert.equal(f.message('BACKGROUND_RELOAD_CANCEL').ok,true);
 f.connection.handle({type:'mobile_command',requestId:'after',action:'shared_list'});assert.equal(f.state.handled,1);
});
