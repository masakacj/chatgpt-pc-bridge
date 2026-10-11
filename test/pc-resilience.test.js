import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {conversationId,conversationReadId,classifyFailure,displayState,nextRecord,retryDecision,sanitizeRecord} from '../extension/pc-resilience-core.js';
const id='11111111-1111-4111-8111-111111111111';
const at=1791600000000;
const ready={id,nativeState:'complete',answerReady:true,currentTurn:true,turnKey:'new'};
const snapshot={id,loadError:true,visible:true,canRetry:true,hasDraft:false,running:false,waiting:false,hasAnswer:false};
const failure={id,at:at-100,kind:'transient_http'};
test('exact authenticated saved-chat GET only, never generation or tool writes',()=>{
  assert.equal(conversationId('https://chatgpt.com/g/project/c/'+id),id);
  assert.equal(conversationId('https://evil.invalid/c/'+id),null);
  assert.equal(conversationReadId('https://chatgpt.com/backend-api/conversations/'+id),id);
  assert.equal(conversationReadId('https://chatgpt.com/backend-api/f/conversation/'+id),id);
  assert.equal(conversationReadId('https://chatgpt.com/backend-api/conversation/'+id,'POST'),null);
  assert.equal(conversationReadId('https://chatgpt.com/backend-api/conversation/'+id+'/messages'),null);
});
test('failed/empty/old-route hydration cannot overwrite completed state',()=>{
  const previous={status:'completed',at,verifiedAt:at,turnKey:'old',source:'native'};
  assert.equal(nextRecord(previous,{id,loadError:true},at+10),previous);
  assert.equal(nextRecord(previous,{...ready,answerReady:false},at+10),previous);
  assert.equal(nextRecord(previous,{...ready,currentTurn:false},at+10),previous);
});
test('completion, active and waiting have explicit native evidence',()=>{
  const completed=nextRecord(null,ready,at);
  assert.equal(completed.status,'completed');
  assert.equal(nextRecord(null,{id,nativeState:'running'},at).status,'running');
  assert.equal(nextRecord(null,{id,nativeState:'waiting'},at).status,'waiting');
  assert.equal(nextRecord(null,{id,nativeState:null},at),null);
});
test('submitting a new prompt cannot complete against the previous answer',()=>{
  const submitted=nextRecord(null,{id,kind:'submit',turnKey:'old'},at);
  assert.equal(nextRecord(submitted,{...ready,turnKey:'old'},at+3000),submitted);
  assert.equal(nextRecord(submitted,ready,at+3000).status,'completed');
});
test('stale active record is honest uncertainty, completed survives restart',()=>{
  assert.equal(displayState({status:'running',at:at-100000},at),'uncertain');
  assert.equal(displayState({status:'completed',at:at-100000},at),'completed');
  const clean=sanitizeRecord({status:'completed',at,source:'native',body:'private',cookie:'secret'},at);
  assert.ok(!('body' in clean));assert.ok(!('cookie' in clean));
  assert.equal(sanitizeRecord({status:'invented',at},at),null);
});
test('retry needs matching fresh transient GET error AND visible empty native load-error UI',()=>{
  assert.equal(retryDecision({failure,snapshot,now:at}).allow,true);
  for(const change of [{loadError:false},{visible:false},{id:'22222222-2222-4222-8222-222222222222'},{canRetry:false}])
    assert.equal(retryDecision({failure,snapshot:{...snapshot,...change},now:at}).allow,false);
  assert.equal(retryDecision({snapshot,now:at}).allow,false);
  assert.equal(retryDecision({failure:{...failure,at:at-50000},snapshot,now:at}).allow,false);
});
test('never retry with drafts, generation, MCP approval, answer, user cancellation, busy workflow',()=>{
  for(const key of ['hasDraft','running','waiting','hasAnswer','recoveryCanceled'])
    assert.equal(retryDecision({failure,snapshot:{...snapshot,[key]:true},now:at}).allow,false,key);
  assert.equal(retryDecision({failure,snapshot,busy:true,now:at}).allow,false);
});
test('auth, rate-limit, missing, TLS, offline and aborted are not automatically retried',()=>{
  for(const [status,error] of [[401,''],[403,''],[429,''],[404,''],[0,'net::ERR_CERT_DATE_INVALID'],[0,'net::ERR_INTERNET_DISCONNECTED'],[0,'net::ERR_ABORTED']]) {
    const kind=classifyFailure(status,error);
    assert.equal(retryDecision({failure:{...failure,kind},snapshot,now:at}).allow,false,kind);
  }
  assert.equal(classifyFailure(503),'transient_http');
  assert.equal(classifyFailure(0,'net::ERR_CONNECTION_RESET'),'transient_network');
});
test('durable retry budget caps two attempts across page/worker restarts',()=>{
  const first=retryDecision({failure,snapshot,now:at});
  const second=retryDecision({failure,snapshot,budget:{attempts:first.attempts,windowAt:first.windowAt},now:at+100});
  assert.equal(second.attempts,2);
  const rehydratedBudget=JSON.parse(JSON.stringify({attempts:2,windowAt:first.windowAt}));
  assert.equal(retryDecision({failure,snapshot,budget:rehydratedBudget,now:at+5000}).allow,false);
});
test('native sidebar running and unread are independent official signals',()=>{
  const running=nextRecord(null,{id,kind:'sidebar',nativeRunning:true},at);
  assert.equal(running.status,'running');
  const unreadWhileRunning=nextRecord(running,{id,kind:'sidebar',nativeUnread:true},at+100);
  assert.equal(unreadWhileRunning.status,'running');
  assert.equal(unreadWhileRunning.readState,'unread');
  const nativeTransition=nextRecord(running,
    {id,kind:'sidebar',nativeUnread:true,nativeRunning:false},at+200);
  assert.equal(displayState(nativeTransition,at+200),'completed_unread');
  // A blue dot alone proves unread activity, NOT that the current turn finished.
  const nativeUnread=nextRecord(null,{id,kind:'sidebar',nativeUnread:true},at);
  assert.equal(nativeUnread.status,'uncertain');
  assert.equal(displayState(nativeUnread,at),'unread_unverified');
  const completed=nextRecord(null,ready,at);
  assert.equal(displayState(nextRecord(completed,{id,kind:'sidebar',nativeUnread:true},at+1),at+1),'completed_unread');
  assert.equal(nextRecord(completed,{id,kind:'sidebar',nativeUnread:false},at+2),completed);
});
test('completed read/unread persists and official completion/read evidence takes priority',()=>{
  const completedUnread=nextRecord(nextRecord(null,ready,at),
    {id,kind:'sidebar',nativeUnread:true},at+100);
  const completedRead=nextRecord(completedUnread,{...ready,nativeRead:true},at+200);
  assert.equal(displayState(completedRead,at+200),'completed_read');
  const restored=sanitizeRecord(JSON.parse(JSON.stringify(completedRead)),at+400);
  assert.equal(displayState(restored,at+400),'completed_read');
  const newSubmit=nextRecord(completedRead,{id,kind:'submit',turnKey:'newer'},at+500);
  assert.equal(newSubmit.status,'running');
  assert.equal(newSubmit.readState,'unknown');
  assert.equal(nextRecord(newSubmit,{id,kind:'sidebar',nativeRunning:false},at+600),newSubmit);
});
test('only explicit native failure changes task state to error',()=>{
  const completed=nextRecord(null,ready,at);
  assert.equal(nextRecord(completed,{id,loadError:true},at+500),completed);
  const failed=nextRecord(completed,{id,nativeState:'error',currentTurn:true},at+600);
  assert.equal(displayState(failed,at+600),'error');
  assert.equal(nextRecord(failed,{...ready,turnKey:'retry-done'},at+1000).status,'completed');
});
test('native cancellation is terminal without manufacturing completion',()=>{
  const running=nextRecord(null,{id,nativeState:'running',currentTurn:true,turnKey:'original'},at);
  const failed=nextRecord(running,{id,nativeState:'error',currentTurn:true,turnKey:'cancelled'},at+1200);
  assert.equal(failed.status,'error');
  const stopped=nextRecord(running,{id,nativeState:'stopped',currentTurn:true,turnKey:'cancelled'},at+1200);
  assert.equal(stopped.status,'stopped');
  assert.equal(nextRecord(running,{id,nativeState:'stopped',currentTurn:false},at+1200),running);
  assert.equal(nextRecord(failed,{id,nativeState:null,answerReady:false},at+1500),failed);
});
test('production content leaves native history/network/layout untouched and has no idle interval',()=>{
  const code=fs.readFileSync(new URL('../extension/pc-resilience-content.js',import.meta.url),'utf8');
  for(const pattern of [/replaceChildren\(/,/\.innerHTML\s*=/,/fetch\(/,/XMLHttpRequest/,/scrollIntoView/,/scrollTo\(/,/setInterval\(/,/location\.reload/,/localStorage\.clear/]) assert.doesNotMatch(code,pattern);
  assert.equal((code.match(/new MutationObserver\(/g)||[]).length,2);
  assert.match(code,/observer\.observe\(sidebar/);
  assert.match(code,/nativeObserver\.observe\(list,\{childList:true,subtree:false\}\)/);
  assert.match(code,/attributeFilter:\['data-talvt-turn-state'\],subtree:false/);
  const background=fs.readFileSync(new URL('../extension/pc-resilience-background.js',import.meta.url),'utf8');
  assert.doesNotMatch(background,/webRequestBlocking|requestHeaders|responseHeaders|tabs\.reload|cookies\./);
});
