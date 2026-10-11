// Extracted from deployed companion 0.3.2. Legacy diagnostic/editor probes are excluded.
import {readSidebar,expandSidebarProject,openSidebarChat} from './mobile-sidebar.js';
export function startMobileStructure({send,isBusy=()=>false}) {
 const sessions=new Map(),catalogues=new Map();let serial=Promise.resolve();
 const queue=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p};
 const chat=url=>{try{const u=new URL(url);return u.origin==='https://chatgpt.com'?u.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1]||null:null}catch{return null}};
 const call=async(tabId,b)=>{const r=await chrome.tabs.sendMessage(tabId,{...b,type:'mobile_content'});if(!r?.ok)throw Error(r?.error||'page_not_ready');return r.result};
 async function library(preferred){
  const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
  const tab=tabs.find(t=>t.id===preferred)||tabs.find(t=>t.active)||tabs[0];
  if(!tab)return {sourceTabId:null,projects:[],chats:[],tabs:[],partial:true,sidebarAvailable:false};
  const captured=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:readSidebar}))[0]?.result;
  if(!captured)throw Error('sidebar_unavailable');
  const keys=captured.chats.map(c=>'pc-state-v1:'+c.id),states=keys.length?await chrome.storage.local.get(keys):{};
  for(const c of captured.chats){const r=states['pc-state-v1:'+c.id];c.status=r?.status||'unknown';c.readState=r?.readState||'unknown';c.tabId=tabs.find(t=>chat(t.url)===c.id)?.id||null}
  catalogues.set(tab.id,{at:Date.now(),chats:captured.chats,projects:captured.projects});
  return {...captured,sourceTabId:tab.id,tabs:tabs.filter(t=>chat(t.url)).map(t=>({tabId:t.id,title:(t.title||'ChatGPT').slice(0,200),conversationId:chat(t.url),active:t.active}))};
 }
 async function navigate(b){
  if(isBusy())throw Error('workflow_busy');
  if(!Number.isFinite(b.deadline)||b.deadline<Date.now())throw Error('command_expired');
  const known=catalogues.get(b.tabId);
  if(!known||Date.now()-known.at>600000)throw Error('sidebar_refresh_required');
  if(b.action==='project'){
   if(!known.projects.some(p=>p.id===b.projectId))throw Error('project_not_visible');
   const r=(await chrome.scripting.executeScript({target:{tabId:b.tabId},func:expandSidebarProject,args:[{projectId:b.projectId,more:b.more===true}]}))[0]?.result;
   if(!r?.ok)throw Error(r?.error||'project_not_visible');
   return library(b.tabId);
  }
  const target=known.chats.find(c=>c.id===b.conversationId);
  if(!target)throw Error('conversation_not_visible');
  const existing=(await chrome.tabs.query({url:'https://chatgpt.com/*'})).find(t=>chat(t.url)===target.id);
  if(existing)return {tab:{tabId:existing.id,title:target.title,conversationId:target.id,active:existing.active}};
  if(b.preserveSource===true){
   const saved=(await chrome.storage.local.get('mobile.readerTab.v1'))['mobile.readerTab.v1'];
   let own=Number.isInteger(saved)?await chrome.tabs.get(saved).catch(()=>null):null;
   let safe=false;
   if(own&&chat(own.url)){
    safe=(await chrome.scripting.executeScript({target:{tabId:own.id},func:()=>{
     const e=document.querySelector('#prompt-textarea,textarea[name="prompt"],main [contenteditable="true"]');
     if(!e||(e.value||e.innerText||e.textContent||'').trim())return false;
     const states=[...document.querySelectorAll('main [data-talvt-turn-state]')];
     const raw=states.at(-1)?.getAttribute('data-talvt-turn-state');
     if(['in_progress','running','streaming','waiting_user','waiting_for_user'].includes(raw))return false;
     return ![...document.querySelectorAll('main button')].some(n=>n.getClientRects().length&&(/^(?:Stop|Stop generating|停止|停止生成)$/.test(n.getAttribute('aria-label')||'')||n.closest('[data-testid*="approval" i],[data-testid*="permission" i]')));
    }}).catch(()=>[]))[0]?.result===true;
   }
   const url='https://chatgpt.com'+target.path;
   const opened=safe?await chrome.tabs.update(own.id,{url}):await chrome.tabs.create({url,active:false});
   await chrome.storage.local.set({'mobile.readerTab.v1':opened.id});
   return {tab:{tabId:opened.id,title:target.title,conversationId:target.id,active:opened.active},sourcePreserved:true};
  }
  const result=(await chrome.scripting.executeScript({target:{tabId:b.tabId},func:openSidebarChat,args:[{path:target.path,conversationId:target.id}]}))[0]?.result;
  if(!result?.ok)throw Error(result?.error||'navigation_not_confirmed');
  const until=Math.min(b.deadline,Date.now()+8000);
  while(Date.now()<until){
   const t=await chrome.tabs.get(b.tabId);
   if(chat(t.url)===target.id)return {tab:{tabId:t.id,title:target.title,conversationId:target.id,active:t.active}};
   await new Promise(r=>setTimeout(r,120));
  }
  throw Error('navigation_not_confirmed');
 }
 async function execute(b){
  if(b.action==='catalog')return library(b.tabId);
  if(['open','project'].includes(b.action))return navigate(b);
  if(b.action==='list'){
   const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
   return {tabs:tabs.filter(t=>chat(t.url)).map(t=>({tabId:t.id,title:(t.title||'ChatGPT').slice(0,200),conversationId:chat(t.url),active:t.active}))};
  }
  if(b.action==='audit')return {version:'0.3.2',sessions:sessions.size,protocol:1};
  if(!Number.isInteger(b.tabId))throw Error('invalid_tab');
  const tab=await chrome.tabs.get(b.tabId),id=chat(tab.url)||chat(tab.pendingUrl);
  if(!id)throw Error('not_chatgpt_conversation');
  if(b.action==='subscribe'){
   if(typeof b.sessionId!=='string'||b.sessionId.length>80)throw Error('invalid_session');
   if(isBusy())throw Error('workflow_busy');
   if([...sessions.values()].some(s=>s.tabId===b.tabId&&s.id!==b.sessionId&&s.expiresAt>Date.now()))throw Error('tab_already_paired');
   let ready=false;const until=Date.now()+6500;
   while(Date.now()<until){
    const current=await chrome.tabs.get(b.tabId);if((chat(current.url)||chat(current.pendingUrl))!==id)throw Error('pc_route_changed');
    ready=(await chrome.scripting.executeScript({target:{tabId:b.tabId},func:()=>location.origin==='https://chatgpt.com'&&document.readyState!=='loading'&&Boolean(document.querySelector('main'))}).catch(()=>[]))[0]?.result===true;
    if(ready)break;await new Promise(r=>setTimeout(r,120));
   }
   if(!ready)throw Error('page_not_ready');
   await chrome.scripting.executeScript({target:{tabId:b.tabId},files:['mobile-presentation.js','mobile-structure-content.js']});
   const expiresAt=Math.min(Date.now()+90000,Number(b.expiresAt)||0);
   const s={id:b.sessionId,tabId:b.tabId,conversationId:id,expiresAt,readOnly:b.readOnly===true};sessions.set(s.id,s);
   try{const result=await call(b.tabId,{...b,expiresAt});if(result?.snapshot?.conversationId!==id)throw Error('pc_route_changed');return result}catch(e){sessions.delete(s.id);throw e}
  }
  const session=sessions.get(b.sessionId);
  if(!session||session.tabId!==b.tabId||session.conversationId!==id)throw Error('session_or_route_changed');
  if(b.action==='unsubscribe'){sessions.delete(b.sessionId);return call(b.tabId,b)}
  if(b.action==='renew'){session.expiresAt=Math.min(Date.now()+90000,Number(b.expiresAt)||0);return call(b.tabId,{...b,expiresAt:session.expiresAt})}
  if(['history','refresh'].includes(b.action))return call(b.tabId,b);
  if(!['draft','send','interact'].includes(b.action)||session.expiresAt<Date.now()||session.readOnly)throw Error('not_writable');
  if(isBusy()&&b.action!=='interact')throw Error('workflow_busy');
  if(!Number.isFinite(b.deadline)||b.deadline<Date.now())throw Error('command_expired');
  if(b.conversationId!==id||typeof b.commandId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(b.commandId))throw Error('invalid_command');
  if(['send','interact'].includes(b.action)){
   const key=(b.action==='send'?'mobile-send-v1:':'mobile-interact-v1:')+b.commandId;
   const stored=(await chrome.storage.local.get(key))[key];
   if(stored)return stored.result||{status:b.action==='send'?'sent_unconfirmed':'interaction_unconfirmed'};
   await chrome.storage.local.set({[key]:{at:Date.now(),state:'reserved'}});
   try{
    const result=await call(b.tabId,b);
    await chrome.storage.local.set({[key]:{at:Date.now(),state:'done',result}});
    return result;
   }catch(e){await chrome.storage.local.set({[key]:{at:Date.now(),state:'unknown'}});throw e;}
  }
  return call(b.tabId,b);
 }
 function handle(b){
  if(b?.type!=='mobile_command')return false;
  queue(()=>execute(b)).then(result=>{if(b.requestId)send({type:'mobile_result',requestId:b.requestId,ok:true,result})},e=>{if(b.requestId)send({type:'mobile_result',requestId:b.requestId,ok:false,error:e.message||'mobile_error'})});
  return true;
 }
 chrome.runtime.onMessage.addListener((b,sender)=>{
  if(b?.type!=='mobile_capture'||sender.id!==chrome.runtime.id||sender.frameId!==0)return;
  const s=sessions.get(b.sessionId);
  if(!s||sender.tab?.id!==s.tabId||s.expiresAt<Date.now()||b.snapshot?.conversationId!==s.conversationId)return;
  send({type:'mobile_snapshot',sessionId:s.id,tabId:s.tabId,snapshot:b.snapshot});
 });
 chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(!change.url&&change.status!=='loading')return;
  for(const s of sessions.values())if(s.tabId===tabId&&(change.status==='loading'||chat(change.url)!==s.conversationId)){
   call(tabId,{action:'unsubscribe',sessionId:s.id}).catch(()=>{});
   send({type:'mobile_snapshot',sessionId:s.id,tabId,snapshot:{schema:1,conversationId:'route-changed',messages:[]}});
   sessions.delete(s.id);
  }
 });
 chrome.tabs.onRemoved.addListener(tabId=>{for(const s of sessions.values())if(s.tabId===tabId){send({type:'mobile_snapshot',sessionId:s.id,tabId,snapshot:{schema:1,conversationId:'tab-closed',messages:[]}});sessions.delete(s.id)}});
 function disconnected(){
  for(const s of sessions.values())call(s.tabId,{action:'unsubscribe',sessionId:s.id}).catch(()=>{});
  sessions.clear();catalogues.clear();
 }
 return {handle,disconnected,audit:()=>({version:'0.3.2',sessions:sessions.size})};
}
