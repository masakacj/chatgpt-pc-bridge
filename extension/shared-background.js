// Shared-tab bindings survive conversation changes; browser-tab focus is irrelevant.
export function startSharedBridge({send}) {
 const sessions=new Map();
 const urlInfo=url=>{try{const u=new URL(url);if(u.origin!=='https://chatgpt.com')return null;return {route:u.pathname,conversationId:u.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1]||''}}catch{return null}};
 const call=async(s,payload)=>{const r=await chrome.tabs.sendMessage(s.tabId,{...payload,type:'shared_page',sessionId:s.id});if(!r?.ok)throw Error(r?.error||'page_not_ready');return r.result};
 function forward(s,snapshot){if(!snapshot)return;send({type:'mobile_snapshot',sessionId:s.id,tabId:s.tabId,snapshot:{...snapshot,bindingRevision:s.epoch}})}
 async function attach(s){
  if(s.attaching)return s.attaching;
  const epoch=s.epoch;
  const task=(async()=>{
   const tab=await chrome.tabs.get(s.tabId);if(!urlInfo(tab.url||tab.pendingUrl))throw Error('not_chatgpt_tab');
   await chrome.scripting.executeScript({target:{tabId:s.tabId},files:['presentation.js','shared-page.js']});
   const result=await call(s,{action:'subscribe',expiresAt:s.expiresAt});
   const current=await chrome.tabs.get(s.tabId);
   if(epoch!==s.epoch||result.snapshot.route!==urlInfo(current.url)?.route)throw Error('pc_route_changed');
   result.snapshot={...result.snapshot,bindingRevision:epoch};s.documentId=result.snapshot.documentId;s.ready=true;forward(s,result.snapshot);return result;
  })();
  s.attaching=task;
  try{return await task}finally{if(s.attaching===task)s.attaching=null;}
 }
 async function pageReady(s){
  for(let i=0;i<40;i++){if(!sessions.has(s.id))throw Error('session_expired');try{return await attach(s)}catch(e){if(['not_chatgpt_tab','No tab with id'].some(x=>e.message.includes(x)))throw e;await new Promise(r=>setTimeout(r,150))}}
  throw Error('page_not_ready');
 }
 async function execute(b){
  if(b.action==='shared_list'){
   const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
   return {tabs:tabs.map(t=>({tabId:t.id,title:(t.title||'ChatGPT').slice(0,200),conversationId:urlInfo(t.url)?.conversationId||'',active:t.active}))};
  }
  if(b.action==='subscribe'){
   if(!Number.isInteger(b.tabId))throw Error('invalid_tab');
   if([...sessions.values()].some(s=>s.tabId===b.tabId&&s.id!==b.sessionId&&s.expiresAt>Date.now()))throw Error('tab_already_paired');
   const s={id:b.sessionId,tabId:b.tabId,expiresAt:Math.min(Date.now()+90000,b.expiresAt),readOnly:b.readOnly===true,ready:false,epoch:0,chain:Promise.resolve()};sessions.set(s.id,s);
   try{return await pageReady(s)}catch(e){sessions.delete(s.id);throw e;}
  }
  const s=sessions.get(b.sessionId);if(!s||s.tabId!==b.tabId)throw Error('session_expired');
  if(b.action==='unsubscribe'){sessions.delete(s.id);await call(s,{action:'unsubscribe'}).catch(()=>{});return {ok:true};}
  if(b.action==='renew'){s.expiresAt=Math.min(Date.now()+90000,b.expiresAt);if(s.ready)await call(s,{action:'renew',expiresAt:s.expiresAt}).catch(()=>{});return {ok:true};}
  if(s.expiresAt<Date.now())throw Error('session_expired');
  if(b.action==='refresh')return pageReady(s);
  const write=['compose','interact'].includes(b.action),navigation=['open','new','project'].includes(b.action);
  if(write&&(!s.ready||s.attaching)){
   try{await pageReady(s)}catch{return {status:b.action==='compose'?'not_sent':'not_acted',error:'page_loading'}}
  }
  if(!s.ready||s.attaching){if(write)return {status:b.action==='compose'?'not_sent':'not_acted',error:'page_loading'};throw Error('page_loading');}
  if((write||navigation)&&s.readOnly)throw Error('read_only');
  if((write||navigation)&&(!Number.isFinite(b.deadline)||Date.now()>b.deadline))throw Error('command_expired');
  let result;
  if(write){
   const prefix=b.action==='compose'?'mobile-send-v1:':'mobile-interact-v1:',key=prefix+b.commandId;
   const existing=(await chrome.storage.local.get(key))[key];if(existing)return existing.result||{status:b.action==='compose'?'sent_unconfirmed':'interaction_unconfirmed'};
   await chrome.storage.local.set({[key]:{at:Date.now(),state:'reserved'}});
   try{result=await call(s,b);await chrome.storage.local.set({[key]:{at:Date.now(),state:'done',result}});return result}
   catch(e){await chrome.storage.local.set({[key]:{at:Date.now(),state:'unknown'}});throw e;}
  }
  try{result=await call(s,b);}catch(e){
   if(!navigation)throw e;
   const tab=await chrome.tabs.get(s.tabId),current=urlInfo(tab.url||tab.pendingUrl);
   const reached=b.action==='open'?current?.conversationId===b.targetConversationId:b.action==='new'?current&&current.conversationId===''&&(!b.projectId||current.route.startsWith('/g/'+b.projectId)):false;
   if(!reached)throw e;return pageReady(s);
  }
  if(result?.snapshot){result.snapshot={...result.snapshot,bindingRevision:s.epoch};forward(s,result.snapshot);}return result;
 }
 function handle(b){
  if(b?.type!=='mobile_command')return false;
  if(!(b.action==='shared_list'||b.action==='subscribe'&&b.followTab===true||sessions.has(b.sessionId)))return false;
  const s=sessions.get(b.sessionId);
  const run=()=>execute(b);
  // Only mutations serialize per binding. Reads never wait for unrelated workflows.
  const mutate=['compose','interact','open','new','project','search'].includes(b.action);
  const task=mutate&&s?(s.chain=s.chain.catch(()=>{}).then(run)):run();
  task.then(result=>{if(b.requestId)send({type:'mobile_result',requestId:b.requestId,ok:true,result})},e=>{if(b.requestId)send({type:'mobile_result',requestId:b.requestId,ok:false,error:/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'page_unavailable'})});return true;
 }
 chrome.runtime.onMessage.addListener((b,sender)=>{
  if(b?.type!=='shared_capture'||sender.id!==chrome.runtime.id||sender.frameId!==0)return;
  const s=sessions.get(b.sessionId);if(!s||sender.tab?.id!==s.tabId||!s.ready||s.attaching||s.expiresAt<Date.now())return;
  chrome.tabs.get(s.tabId).then(tab=>{if(b.snapshot?.route===urlInfo(tab.url)?.route)forward(s,b.snapshot)}).catch(()=>{});
 });
 chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(!change.url&&!['loading','complete'].includes(change.status))return;
  for(const s of sessions.values())if(s.tabId===tabId){
   if(change.url||change.status==='loading'){s.epoch++;s.ready=false;send({type:'mobile_tab_changed',sessionId:s.id,tabId,bindingRevision:s.epoch,closed:false});}
   if(change.url||change.status==='complete')pageReady(s).catch(()=>{});
  }
 });
 chrome.tabs.onRemoved.addListener(tabId=>{for(const s of sessions.values())if(s.tabId===tabId){sessions.delete(s.id);send({type:'mobile_tab_changed',sessionId:s.id,tabId,closed:true})}});
 function disconnected(){for(const s of sessions.values())call(s,{action:'unsubscribe'}).catch(()=>{});sessions.clear();}
 return {handle,disconnected,audit:()=>({version:'0.2.2',sharedSessions:sessions.size})};
}
