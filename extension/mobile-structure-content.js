// Opt-in session-only extractor/controller for the native mobile companion.
// Does not run until the existing extension injects it for a paired session.
(() => {
 'use strict';
 if(location.origin!=='https://chatgpt.com'||window!==top||!chrome?.runtime?.id)return;
 if(globalThis.__ORCH_MOBILE_STRUCTURE__?.version==='0.3.2')return;
 const presentation=globalThis.__ORCH_MOBILE_PRESENTATION__;
 if(!presentation)return;
 globalThis.__ORCH_MOBILE_STRUCTURE__?.destroy?.();
 globalThis.__ORCH_MOBILE_STRUCTURE__?.stop?.();
 const documentId=crypto.randomUUID(),encoder=new TextEncoder();
 let session=null,expiry=0,rootObserver=null,textObserver=null,root=null,lastRoots=[],timer=0,leaseTimer=0;
 let composing=false,hash='',inFlight=false,pending=false,captureCount=0;
 let composerObserver=null,composerRoot=null;
 const ids=new WeakMap(),commands=new Map();
 const idFor=n=>{if(!ids.has(n))ids.set(n,crypto.randomUUID());return ids.get(n)};
 const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const conversationId=()=>location.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1]||null;
 const text=n=>(n?.innerText??n?.textContent??'').replace(/\r\n/g,'\n').trimEnd();
 const editor=()=>document.querySelector('#prompt-textarea,textarea[name="prompt"],main [contenteditable="true"]');
 const draft=()=>{const n=editor();return n instanceof HTMLTextAreaElement?n.value:text(n)};
 const visible=n=>n instanceof HTMLElement&&n.getClientRects().length>0&&!n.closest('[hidden],[aria-hidden="true"]');
 const safeURL=raw=>{try{const u=new URL(raw,location.href);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}};
 const turnList=()=>[...(document.querySelector('main [class*="transcriptContent"]')||document.querySelector('main'))?.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"],article[data-scroll-anchor]')||[]];
 const turnID=n=>n?.getAttribute('data-turn-key')||n?.getAttribute('data-testid')||(n?idFor(n):null);
 const actions=presentation.createActions(documentId,turnID,conversationId);
 function pageTurns(before=null){
  const all=turnList();
  const index=before?all.findIndex(n=>turnID(n)===before):all.length;
  if(index<0)throw Error('history_cursor_expired');
  // Live rendering only inspects the last bounded candidates; walking an
  // older page is performed solely for an explicit history request.
  const turns=all.slice(Math.max(0,index-24),index).filter(n=>!n.parentElement?.closest('[data-turn-key],[data-testid^="conversation-turn-"],article[data-scroll-anchor]')).slice(-12);
  return {turns,hasMore:turns.length>0&&all.indexOf(turns[0])>0};
 }
 function messages(before=null){
  const turns=pageTurns(before).turns,out=[];
  for(const turn of turns){
   const roles=[...turn.querySelectorAll('[data-message-author-role],[data-conversation-role]')].filter(n=>!presentation.excluded(n)&&!n.matches('h1,h2,h3,h4,h5,h6,.sr-only')&&['user','assistant'].includes(n.getAttribute('data-message-author-role')||n.getAttribute('data-conversation-role')));
   if(!roles.length&&turn.matches('[data-message-author-role],[data-conversation-role]'))roles.push(turn);
   const candidates=[...roles,...[...turn.querySelectorAll('[class*="DilResponseRoot"]')].filter(n=>!presentation.excluded(n)&&!roles.some(p=>p.contains(n)))];
   const hints=new Map();
   // Current official pages sometimes render MarkdownRoot without DIL.
   // Associate it with the explicit assistant heading's next sibling only;
   // arbitrary tool/activity Markdown elsewhere is not an assistant answer.
   for(const heading of turn.querySelectorAll('h4[data-conversation-role="assistant"],.sr-only[data-conversation-role="assistant"]')){
    const body=heading.nextElementSibling;if(!body)continue;
    const roots=body.matches('[class*="MarkdownRoot"],.markdown')?[body]:[...body.querySelectorAll('[class*="DilResponseRoot"],[class*="MarkdownRoot"],.markdown')];
    for(const node of roots)if(!presentation.excluded(node)&&!roles.some(p=>p.contains(node))&&!node.closest('[data-testid*="activity" i],[data-testid*="reasoning" i]')){candidates.push(node);hints.set(node,'assistant')}
   }
   for(const heading of turn.querySelectorAll('h4[data-conversation-role="user"],.sr-only[data-conversation-role="user"]')){
    const body=heading.nextElementSibling;
    if(body&&!roles.some(p=>p.contains(body))&&!body.matches('button,form,input,textarea')&&!body.querySelector('[class*="DilResponseRoot"]')){candidates.push(body);hints.set(body,'user')}
   }
   for(const node of [...new Set(candidates)].filter((n,i,a)=>!a.some(p=>p!==n&&p.contains(n))).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1)){ 
    const role=hints.get(node)||node.getAttribute('data-message-author-role')||node.getAttribute('data-conversation-role')||'assistant';
    if(presentation.excluded(node))continue;
    const candidates=[...node.querySelectorAll('[class*="DilResponseRoot"],[class*="MarkdownRoot"],.markdown,[data-markdown-text-style]')].filter(n=>!presentation.excluded(n));
    const body=candidates.find(n=>presentation.cleanText(n))||node;
    const fullText=presentation.cleanText(body),bodyText=fullText.slice(0,48000);if(!bodyText)continue;
    const blocks=[];
    for(const el of [...body.querySelectorAll('h1,h2,h3,p,pre,table,li,blockquote,a')].filter(n=>!n.parentElement?.closest('pre,table,li,blockquote')&&(!n.matches('a')||!n.parentElement?.closest('p,h1,h2,h3'))).slice(0,120)){
     const kind=el.matches('pre')?'code':el.matches('table')?'table':el.matches('h1,h2,h3')?'heading':el.matches('li')?'list':'text';
     if(presentation.excluded(el))continue;
     const t=presentation.cleanText(el).slice(0,12000);if(t)blocks.push({kind,text:t});
    }
    const links=[...body.querySelectorAll('a[href]')].filter(n=>!presentation.excluded(n)).slice(0,50).map(a=>({title:text(a).slice(0,200),url:safeURL(a.getAttribute('href'))})).filter(x=>x.url);
    // Structured formatting may miss a site's unwrapped text nodes. Fall
    // back to the complete sanitized body rather than omit any answer text.
    if(blocks.map(b=>b.text).join('').replace(/\s+/g,'')!==fullText.replace(/\s+/g,''))blocks.length=0;
    out.push({id:node.getAttribute('data-message-id')||node.getAttribute('data-dil-message-id')||idFor(node),turnId:turnID(turn),role,text:bodyText,blocks:blocks.length?blocks:[{kind:'text',text:bodyText}],links,truncated:fullText.length>48000});
   }
  }
  const limited=out.slice(-24);
  for(const m of limited)if(JSON.stringify(m).length>70000)m.blocks=[{kind:'text',text:m.text}];
  while(limited.length>1&&JSON.stringify(limited).length>160000)limited.shift();
  return limited;
 }
 function state(){
  const turn=turnList().at(-1),signals=turn?.querySelectorAll('[data-talvt-turn-state]')||[];
  const raw=turn?.getAttribute('data-talvt-turn-state')||signals[signals.length-1]?.getAttribute('data-talvt-turn-state');
  const stop=[...composerScope().querySelectorAll('button')].some(n=>visible(n)&&(/^(?:停止|停止生成|Stop|Stop generating)$/i.test(n.getAttribute('aria-label')||'')||n.getAttribute('data-testid')==='stop-button'));
  const awaiting=['waiting_user','waiting_for_user'].includes(raw)||Boolean(turn&&[...turn.querySelectorAll('[data-testid*="approval" i] button,[data-testid*="permission" i] button')].some(visible));
  if(['error','failed'].includes(raw))return 'error';
  if(['cancelled','canceled','stopped'].includes(raw))return 'stopped';
  if(!editor())return 'loading';
  return awaiting?'waiting':stop||['in_progress','running','streaming'].includes(raw)?'running':['complete','completed'].includes(raw)?'completed':'unknown';
 }
 async function snapshot(){
  const value=draft(),navGuard=globalThis.__ORCH_MOBILE_NAV_GUARD__;
  const last=turnList().at(-1)?.getAttribute('data-turn-key')||null;
  const awaitingRoute=navGuard?.to===conversationId()&&(!last||last===navGuard.oldKey);
  if(navGuard&&!awaitingRoute)delete globalThis.__ORCH_MOBILE_NAV_GUARD__;
  const all=awaitingRoute?[]:messages(),nativeStatus=awaitingRoute?'loading':state();
  const status=nativeStatus==='completed'&&!all.some(m=>m.role==='assistant')?'unknown':nativeStatus;
  const interactions=awaitingRoute?[]:actions.collect(turnList().at(-1));
  const latest=turnID(turnList().at(-1)),hasCurrentReply=all.some(m=>m.role==='assistant'&&m.turnId===latest);
  const responsePhase=interactions.length?'waiting':status==='running'?(hasCurrentReply?'responding':'thinking'):status;
  return {schema:1,extractorVersion:'0.3.2',responsePhase,interactions,historyCursor:all[0]?.turnId||turnID(pageTurns().turns[0]),hasOlder:pageTurns().hasMore,documentId,conversationId:conversationId()||'',title:document.title.replace(/\s*[-–]\s*ChatGPT$/,'').slice(0,200),
   messages:all,status,draft:value,draftHash:await sha(value),canSend:Boolean(sendButton())&&!['running','waiting','loading'].includes(status)&&!composing,
   composing,unsupportedTools:document.querySelectorAll('main iframe').length>0,historyPartial:true};
 }
 function composerScope(){
  const e=editor();if(!e)return document.createElement('div');
  const form=e.closest('form,[data-composer-body]');if(form)return form;
  let p=e.parentElement;for(let i=0;p&&p!==document.body&&i<8;i++,p=p.parentElement){
   if(p.querySelector('button')&&!p.querySelector('[data-turn-key],[data-testid^="conversation-turn-"]'))return p;
  }
  return document.createElement('div');
 }
 function sendButton(){
  const names=/^(?:Send(?: prompt| message)?|发送(?:提示|消息)?|傳送(?:提示|訊息)?)(?:\s*[（(][^）)]*[）)])?$/i;
  return [...composerScope().querySelectorAll('button')].find(n=>{
   if(!visible(n)||n.disabled||n.getAttribute('aria-disabled')==='true')return false;
   const a=(n.getAttribute('aria-label')||n.getAttribute('title')||'').trim();
   if(/stop|停止|听写|聽寫|voice|dictat|mic/i.test(a))return false;
   return names.test(a)||n.getAttribute('data-testid')==='send-button'||n.id==='composer-submit-button';
  })||null;
 }
 function bind(){
  const scope=editor()?composerScope():null;
  if(scope!==composerRoot){
   composerObserver?.disconnect();composerRoot=scope;
   if(scope){composerObserver=new MutationObserver(()=>schedule());composerObserver.observe(scope,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','aria-disabled','disabled','data-testid']})}
  }
  const next=document.querySelector('main [class*="transcriptContent"]')||document.querySelector('main');
  if(next&&next!==root){rootObserver?.disconnect();root=next;rootObserver=new MutationObserver(()=>schedule());rootObserver.observe(root,{childList:true,subtree:false})}
  const last=turnList().slice(-2);if(last.length===lastRoots.length&&last.every((n,i)=>n===lastRoots[i]))return;
  textObserver?.disconnect();lastRoots=last;textObserver=new MutationObserver(()=>schedule());
  // Bounded last-two-turn observation, never the entire history tree.
  for(const node of last)textObserver.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-talvt-turn-state']});
 }
 function schedule(){if(!session||expiry<Date.now()||timer)return;timer=setTimeout(()=>{timer=0;publish()},250)}
 async function publish(){
  if(!session||expiry<Date.now())return stop();
  if(inFlight){pending=true;return}inFlight=true;
  const active=session;
  try{bind();const snap=await snapshot();if(active!==session)return;const next=await sha(JSON.stringify(snap));
   if(next!==hash){hash=next;captureCount++;await chrome.runtime.sendMessage({type:'mobile_capture',sessionId:session.id,snapshot:snap})}
  }catch{}finally{inFlight=false;if(pending){pending=false;schedule()}}
 }
 function arm(){clearTimeout(leaseTimer);leaseTimer=setTimeout(()=>stop(),Math.max(0,expiry-Date.now()+50))}
 function stop(){composerObserver?.disconnect();composerRoot=null;document.removeEventListener('load',frameLoaded,true);session=null;rootObserver?.disconnect();textObserver?.disconnect();root=null;lastRoots=[];clearTimeout(timer);timer=0;clearTimeout(leaseTimer);document.removeEventListener('input',input,true);document.removeEventListener('compositionstart',compStart,true);document.removeEventListener('compositionend',compEnd,true)}
 async function guard(b){
  if(!Number.isFinite(b.deadline)||b.deadline<Date.now())throw Error('command_expired');
  if(!session||session.id!==b.sessionId||expiry<Date.now()||session.readOnly)throw Error('session_not_writable');
  if(b.documentId!==documentId||b.conversationId!==conversationId())throw Error('pc_route_changed');
  if(composing)throw Error('pc_composing');
  const ng=globalThis.__ORCH_MOBILE_NAV_GUARD__,lk=turnList().at(-1)?.getAttribute('data-turn-key');
  if(ng?.to===conversationId()&&(!lk||lk===ng.oldKey))throw Error('conversation_loading');
  if(['running','waiting'].includes(state()))throw Error('pc_busy_or_approval');
  if(typeof b.text!=='string'||b.text.length>16000||await sha(draft())!==b.baseDraftHash)throw Error('draft_conflict');
  if(!editor())throw Error('editor_unavailable');
 }
 async function apply(b){
  await guard(b);
  const e=editor(),before=draft();
  // Atomic compare immediately before touching the real editor. Local input
  // wins if the PC changed it while the hash check was outstanding.
  if(await sha(before)!==b.baseDraftHash||draft()!==before)throw Error('draft_conflict');
  if(b.deadline<Date.now())throw Error('command_expired');
  e.focus({preventScroll:true});
  if(e instanceof HTMLTextAreaElement){
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(e,b.text);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:b.text}));
  }else{
    const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand('insertText',false,b.text))throw Error('native_editor_rejected');
  }
  await new Promise(r=>setTimeout(r,120));
  if(draft()!==b.text)throw Error('native_editor_not_confirmed');
  schedule();return {status:'draft_synced',draftHash:await sha(draft()),documentId};
 }
 async function send(b){
  let button;
  try{
   await guard(b);if(draft()!==b.text||!b.text.trim())throw Error('draft_not_synced');
   // React may enable the native button one frame after the editor ack.
   // This is bounded DOM readiness, not a server retry or duplicate Send.
   const until=Math.min(b.deadline,Date.now()+1600);
   while(!(button=sendButton())&&Date.now()<until){
    if(composing||['running','waiting'].includes(state())||draft()!==b.text)throw Error('draft_or_state_changed');
    await new Promise(r=>setTimeout(r,100));
   }
   await guard(b);
   if(draft()!==b.text)throw Error('draft_conflict');
   if(b.deadline<Date.now())throw Error('command_expired');
   if(!button||!button.isConnected||button!==sendButton())throw Error('send_unavailable');
  }catch(e){return {status:'not_sent',error:e.message||'send_unavailable',documentId}}
  const before=new Set(messages().filter(m=>m.role==='user').map(m=>m.id));
  // Everything above can prove zero clicks. Anything after this point must
  // remain unknown on failure; the durable reservation is never replayed.
  button.click();
  const until=Date.now()+6500;
  while(Date.now()<until){
    await new Promise(r=>setTimeout(r,200));
    if(conversationId()!==b.conversationId)break;
    const accepted=messages().find(m=>m.role==='user'&&!before.has(m.id)&&m.text.trim()===b.text.trim());
    if(accepted){schedule();return {status:'sent_confirmed',messageId:accepted.id,documentId}}
  }
  schedule();return {status:'sent_unconfirmed',documentId}; // NEVER re-click.
 }
 const onMessage=(b,_sender,reply)=>{
  if(b?.type!=='mobile_content')return;
  (async()=>{
   if(b.action==='subscribe'){
    if(session&&session.id!==b.sessionId&&expiry>Date.now())throw Error('tab_already_paired');
    session={id:b.sessionId,readOnly:b.readOnly===true};expiry=b.expiresAt;hash='';
    document.addEventListener('input',input,true);document.addEventListener('compositionstart',compStart,true);document.addEventListener('compositionend',compEnd,true);
    document.addEventListener('load',frameLoaded,true);
    arm();bind();
    const snap=await snapshot();schedule();
    const activeSession=session;for(const delay of [450,1600,4500])setTimeout(()=>{if(session===activeSession)schedule()},delay);
    return {snapshot:snap};
   }
   if(b.action==='renew'){if(session?.id===b.sessionId){expiry=b.expiresAt;arm()}return {ok:true}}
   if(b.action==='unsubscribe'){if(session?.id===b.sessionId)stop();return {ok:true}}
   if(b.action==='audit')return {active:Boolean(session),version:'0.3.2',captureCount,leased:expiry>Date.now()};
   if(b.action==='refresh'){
    if(!session||session.id!==b.sessionId||expiry<Date.now()||b.conversationId!==conversationId())throw Error('session_or_route_changed');
    bind();return {snapshot:await snapshot()};
   }
   if(b.action==='history'){
    if(!session||session.id!==b.sessionId||expiry<Date.now()||b.documentId!==documentId||b.conversationId!==conversationId())throw Error('session_or_route_changed');
    const page=pageTurns(b.before),items=messages(b.before);
    return {schema:1,documentId,conversationId:conversationId(),messages:items,cursor:items[0]?.turnId||turnID(page.turns[0]),hasMore:page.hasMore,source:'pc_loaded_history'};
   }
   if(b.action==='interact'){
    if(!session||session.id!==b.sessionId||session.readOnly||expiry<Date.now()||!Number.isFinite(b.deadline)||b.deadline<Date.now())return {status:'not_acted',error:'session_not_writable'};
    if(commands.has(b.commandId))return commands.get(b.commandId);
    const result=actions.activate(b,turnList().at(-1));commands.set(b.commandId,result);schedule();return result;
   }
   if(['draft','send'].includes(b.action)){
    if(commands.has(b.commandId))return commands.get(b.commandId);
    const work=b.action==='draft'?apply(b):send(b);commands.set(b.commandId,work);return await work;
   }
   throw Error('unknown_action');
  })().then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message||'content_failure'}));
  return true;
 };
 const frameLoaded=e=>{if(e.target?.tagName==='IFRAME'&&turnList().at(-1)?.contains(e.target))schedule()};
 const input=e=>{if(e.target===editor()||editor()?.contains(e.target))schedule()};
 const compStart=e=>{if(e.target===editor()||editor()?.contains(e.target)){composing=true;schedule()}};
 const compEnd=()=>{composing=false;schedule()};
 function destroy(){stop();commands.clear();chrome.runtime.onMessage.removeListener(onMessage);document.removeEventListener('input',input,true);document.removeEventListener('compositionstart',compStart,true);document.removeEventListener('compositionend',compEnd,true)}
 chrome.runtime.onMessage.addListener(onMessage);
 globalThis.__ORCH_MOBILE_STRUCTURE__={version:'0.3.2',snapshot,stop,destroy};
})();
