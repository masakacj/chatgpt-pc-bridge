// Native-phone mirror of one bound official page. No ChatGPT API calls.
(() => {
 'use strict';
 if(location.origin!=='https://chatgpt.com'||window!==top)return;
 if(globalThis.__CGPT_SHARED_PAGE__?.version==='0.2.2-r1.5')return;
 globalThis.__CGPT_SHARED_PAGE__?.destroy?.();
 const p=globalThis.__CGPT_BRIDGE_PRESENTATION__;if(!p)return;
 const ids=new WeakMap(),commands=new Map(),known=new Map();
 const idFor=n=>{if(!ids.has(n))ids.set(n,crypto.randomUUID());return ids.get(n)};
 const transcript=()=>[...document.querySelectorAll('main [class*="transcriptContent"]')].find(p.visible)||[...document.querySelectorAll('main')].find(p.visible)||null;
 const turns=()=>[...transcript()?.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"],article[data-scroll-anchor]')||[]];
 const turnID=n=>n?.getAttribute('data-turn-key')||n?.getAttribute('data-testid')||(n?idFor(n):null);
 const conversation=()=>location.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1]||'';
 const project=()=>location.pathname.match(/^\/g\/(g-p-[A-Za-z0-9_-]+)/)?.[1]||null;
 // The home/new-chat SPA keeps an older composer mounted but hidden.
 // Query all matching editors and choose the actual visible editable surface.
 const editor=()=>[...document.querySelectorAll('#prompt-textarea,textarea[name="prompt"],main [contenteditable="true"]')].find(e=>p.visible(e)&&!e.disabled&&!e.readOnly&&(e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement||e.isContentEditable))||null;
 const text=n=>(n?.innerText??n?.textContent??'').replace(/\r\n/g,'\n').trimEnd();
 function editableText(e){
  if(!e)return '';
  if(e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement)return e.value;
  // ProseMirror represents a typed newline as adjacent paragraphs. innerText
  // inserts an extra visual blank line between <p> elements, unlike the prompt
  // actually submitted. Read paragraph boundaries once, preserving empty ones.
  const blocks=[...e.children];
  if(blocks.length&&blocks.every(n=>n.matches('p,div'))){
   const plain=n=>[...n.childNodes].map(c=>c.nodeType===Node.TEXT_NODE?c.nodeValue:c.nodeType!==Node.ELEMENT_NODE?'':c.tagName==='BR'?(c.classList.contains('ProseMirror-trailingBreak')?'':'\n'):plain(c)).join('');
   return blocks.map(plain).join('\n').replace(/\r\n/g,'\n').trimEnd();
  }
  return text(e);
 }
 const draft=()=>editableText(editor());
 const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const label=b=>(b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent||'').trim();
 const nav=()=>[...document.querySelectorAll('aside,nav,[data-testid="sidebar"]')].find(n=>n.querySelector('a[href*="/c/"],[data-app-action-sidebar-project-id]'));
 let session=null,expiry=0,route=location.pathname,documentId=crypto.randomUUID(),previousTurn=null,routePending=false;
 let composing=false,pcEditRevision=0,timer=null,lease=null,observer=null,tailObserver=null,watchedRoot=null,watchedTail=[],lastHash='',publishing=false,reschedule=false,requestedProject=null;
 let actions=p.createActions(documentId,turnID,conversation),lastQuery='';
 function scope(){const e=editor();if(!e)return document.createElement('div');const form=e.closest('form,[data-composer-body]');if(form)return form;let n=e.parentElement;for(let i=0;n&&n!==document.body&&i<9;i++,n=n.parentElement)if(n.querySelector('button')&&!n.querySelector('[data-turn-key]'))return n;return document.createElement('div')}
 function sendButton(){return [...scope().querySelectorAll('button')].find(b=>p.visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&!/stop|停止|voice|听写|聽寫|dictat|mic/i.test(label(b))&&(/^(?:Send(?: prompt| message)?|发送(?:提示|消息)?|傳送(?:提示|訊息)?)(?:\s*[（(][^）)]*[）)])?$/i.test(label(b))||b.getAttribute('data-testid')==='send-button'||b.id==='composer-submit-button'))||null}
 function state(){
  const tail=turns().at(-1),signals=tail?.querySelectorAll('[data-talvt-turn-state]')||[];
  const raw=tail?.getAttribute('data-talvt-turn-state')||signals[signals.length-1]?.getAttribute('data-talvt-turn-state');
  if(['error','failed'].includes(raw))return 'error';
  if(['cancelled','canceled','stopped'].includes(raw))return [...tail.querySelectorAll('span,[role="alert"]')].some(n=>p.visible(n)&&!n.closest('[data-conversation-role="user"],[data-message-author-role="user"],.bg-user-message,[class~="group/user-message"]')&&/^(?:无法思考|Unable to think|Something went wrong)$/.test(text(n).trim()))?'error':'stopped';
  if(!editor())return 'loading';
  if(['waiting_user','waiting_for_user'].includes(raw)||actions.collect(tail).length)return 'waiting';
  const stop=[...scope().querySelectorAll('button')].some(b=>p.visible(b)&&(/^(?:停止|停止生成|Stop|Stop generating)$/i.test(label(b))||b.getAttribute('data-testid')==='stop-button'));
  return stop||['in_progress','running','streaming'].includes(raw)?'running':['complete','completed'].includes(raw)?'completed':'idle';
 }
 function page(before){const all=turns(),index=before?all.findIndex(n=>turnID(n)===before):all.length;if(index<0)throw Error('history_cursor_expired');const selected=all.slice(Math.max(0,index-24),index).filter(n=>!n.parentElement?.closest('[data-turn-key],[data-testid^="conversation-turn-"],article[data-scroll-anchor]')).slice(-12);return {turns:selected,hasMore:selected.length>0&&all.indexOf(selected[0])>0}}
 function messages(before){
  const out=[];
  for(const turn of page(before).turns){
   const roles=[...turn.querySelectorAll('[data-message-author-role],[data-conversation-role]')].filter(n=>!p.excluded(n)&&!n.matches('h1,h2,h3,h4,h5,h6,.sr-only')&&['user','assistant'].includes(n.getAttribute('data-message-author-role')||n.getAttribute('data-conversation-role')));
   if(!roles.length&&turn.matches('[data-message-author-role],[data-conversation-role]'))roles.push(turn);
   const candidates=[...roles,...[...turn.querySelectorAll('[class*="DilResponseRoot"]')].filter(n=>!p.excluded(n)&&!roles.some(r=>r.contains(n)))],hints=new Map();
   // Verified official user markup (2026-10-12): semantic bubble classes,
   // no role attribute or message ID. Read the bubble, not its toolbar/group.
   for(const bubble of turn.querySelectorAll('.bg-user-message.text-user-message')){
    if(!bubble.closest('[class~="group/user-message"]')||p.excluded(bubble)||roles.some(r=>r.contains(bubble))||bubble.closest('[data-message-author-role="assistant"],[data-conversation-role="assistant"]'))continue;
    candidates.push(bubble);hints.set(bubble,'user');
   }
   const roleIndex={user:0,assistant:0};
   for(const heading of turn.querySelectorAll('h4[data-conversation-role="assistant"],.sr-only[data-conversation-role="assistant"]')){
    const body=heading.nextElementSibling;if(!body)continue;
    const roots=body.matches('[class*="MarkdownRoot"],.markdown')?[body]:[...body.querySelectorAll('[class*="DilResponseRoot"],[class*="MarkdownRoot"],.markdown')];
    for(const n of roots)if(!p.excluded(n)&&!roles.some(r=>r.contains(n))&&!n.closest('[data-testid*="activity" i],[data-testid*="reasoning" i]')){candidates.push(n);hints.set(n,'assistant')}
   }
   for(const heading of turn.querySelectorAll('h4[data-conversation-role="user"],.sr-only[data-conversation-role="user"]')){const body=heading.nextElementSibling;if(body&&!roles.some(r=>r.contains(body))&&!body.matches('button,form,input,textarea')&&!body.querySelector('[class*="DilResponseRoot"]')){candidates.push(body);hints.set(body,'user')}}
   for(const n of [...new Set(candidates)].filter((n,i,a)=>!a.some(r=>r!==n&&r.contains(n))).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1)){
    if(p.excluded(n))continue;
    const role=hints.get(n)||n.getAttribute('data-message-author-role')||n.getAttribute('data-conversation-role')||'assistant';
    const body=role==='user'?n:[...n.querySelectorAll('[class*="DilResponseRoot"],[class*="MarkdownRoot"],.markdown,[data-markdown-text-style]')].find(r=>!p.excluded(r)&&p.cleanText(r))||n;
    const full=p.cleanText(body),value=full.slice(0,48000);if(!value)continue;
    const blocks=[];
    for(const e of [...body.querySelectorAll('h1,h2,h3,p,pre,table,li,blockquote,a')].filter(n=>!n.parentElement?.closest('pre,table,li,blockquote')&&(!n.matches('a')||!n.parentElement?.closest('p,h1,h2,h3'))).slice(0,120)){
     if(p.excluded(e))continue;const value=p.cleanText(e).slice(0,12000);if(value)blocks.push({kind:e.matches('pre')?'code':e.matches('table')?'table':e.matches('h1,h2,h3')?'heading':e.matches('li')?'list':'text',text:value});
    }
    if(blocks.map(b=>b.text).join('').replace(/\s+/g,'')!==full.replace(/\s+/g,''))blocks.length=0;
    const links=[...body.querySelectorAll('a[href]')].filter(n=>!p.excluded(n)).slice(0,50).flatMap(a=>{try{const u=new URL(a.getAttribute('href'),location.href);return ['https:','http:'].includes(u.protocol)?[{title:text(a).slice(0,200),url:u.href}]:[]}catch{return []}});
    // Stable across DOM replacement: an old identical bubble must not turn
    // into a "newly sent" message merely because React replaced its element.
    const stableID=turnID(turn)+':'+role+':'+(roleIndex[role]||0);roleIndex[role]=(roleIndex[role]||0)+1;
    out.push({id:n.getAttribute('data-message-id')||n.getAttribute('data-dil-message-id')||stableID,turnId:turnID(turn),role,text:value,blocks:blocks.length?blocks:[{kind:'text',text:value}],links,truncated:full.length>48000});
   }
  }
  const limited=out.slice(-24);while(limited.length>1&&JSON.stringify(limited).length>160000)limited.shift();return limited;
 }
 function updateRoute(){
  if(route!==location.pathname){const oldConversation=route.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1]||'';previousTurn=watchedTail.at(-1)?turnID(watchedTail.at(-1)):null;route=location.pathname;documentId=crypto.randomUUID();routePending=Boolean(oldConversation&&conversation()&&oldConversation!==conversation());actions=p.createActions(documentId,turnID,conversation);lastHash=''}
  if(routePending){const latest=turnID(turns().at(-1));if(!conversation()||latest&&latest!==previousTurn)routePending=false;}
 }
 async function snapshot(){
  updateRoute();const currentDoc=documentId,value=draft(),all=routePending||!conversation()?[]:messages();
  const status=routePending?'loading':state(),interactions=routePending?[]:actions.collect(turns().at(-1));
  const projectId=requestedProject&&project()?.startsWith(requestedProject)?requestedProject:project();
  const snap={schema:1,sharedTab:true,documentId:currentDoc,conversationId:conversation(),route:location.pathname,projectId,temporary:!conversation(),title:conversation()?document.title.replace(/\s*[-–]\s*ChatGPT$/,'').slice(0,200):'新聊天',messages:all,status,
   draft:'',draftHash:await sha(value),pcDraftOccupied:Boolean(value.trim()),composing,canSend:Boolean(editor())&&!composing&&!value.trim()&&!['running','waiting','loading'].includes(status),
   responsePhase:interactions.length?'waiting':status==='running'?(all.some(m=>m.role==='assistant'&&m.turnId===turnID(turns().at(-1)))?'responding':'thinking'):status,interactions,
   historyCursor:all[0]?.turnId||null,hasOlder:!routePending&&Boolean(conversation())&&page().hasMore,historyPartial:true,unsupportedTools:Boolean(transcript()?.querySelector('iframe'))};
  return snap;
 }
 function bind(){
  const root=transcript();if(root!==watchedRoot){observer?.disconnect();watchedRoot=root;observer=new MutationObserver(schedule);if(root)observer.observe(root,{childList:true,subtree:false});if(root?.parentElement)observer.observe(root.parentElement,{childList:true,subtree:false})}
  const tail=turns().slice(-2),composer=editor()?.closest('form,[data-composer-body]')||editor()?.parentElement;
  if(tail.length===watchedTail.length&&tail.every((n,i)=>n===watchedTail[i])&&tailObserver)return;
  tailObserver?.disconnect();watchedTail=tail;tailObserver=new MutationObserver(schedule);
  for(const n of tail)tailObserver.observe(n,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-talvt-turn-state']});
  if(composer)tailObserver.observe(composer,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','disabled','aria-disabled']});
  const content=transcript();if(content)tailObserver.observe(content,{childList:true,subtree:false});
 }
 function schedule(){if(!session||expiry<Date.now()||timer)return;timer=setTimeout(()=>{timer=null;publish()},160)}
 async function publish(){if(!session||expiry<Date.now())return stop();if(publishing){reschedule=true;return}publishing=true;try{const active=session,snap=await snapshot();bind();const hash=await sha(JSON.stringify(snap));if(active!==session)return;if(hash!==lastHash){lastHash=hash;await chrome.runtime.sendMessage({type:'shared_capture',sessionId:active,snapshot:snap})}}catch{}finally{publishing=false;if(reschedule){reschedule=false;schedule()}}}
 function stop(){session=null;clearTimeout(timer);clearTimeout(lease);timer=null;observer?.disconnect();tailObserver?.disconnect();watchedRoot=null;watchedTail=[];tailObserver=null}
 function arm(){clearTimeout(lease);lease=setTimeout(stop,Math.max(0,expiry-Date.now()+50))}
 function routeCheck(b){updateRoute();if(!session||b.sessionId!==session||expiry<Date.now())throw Error('session_expired');if(b.documentId!==documentId||b.conversationId!==conversation())throw Error('pc_route_changed');if(!Number.isFinite(b.deadline)||Date.now()>b.deadline)throw Error('command_expired')}
 function inputValue(e,value){
  e.focus({preventScroll:true});
  if(e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement){const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));}
  else{const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);if(!document.execCommand('insertText',false,value))throw Error('native_editor_rejected')}
 }
 async function composeSend(b){
  let clicked=false,wroteEditor=null,editRevision=pcEditRevision;
  try{
   routeCheck(b);if(composing)throw Error('pc_composing');if(b.projectId&&!project()?.startsWith(b.projectId))throw Error('project_context_changed');if(['running','waiting','loading'].includes(state())||routePending)throw Error('pc_busy_or_approval');
   const before=draft();if(before.trim())throw Error('pc_draft_conflict');if(!editor())throw Error('editor_unavailable');
   if(await sha(before)!==b.baseDraftHash||draft()!==before)throw Error('draft_conflict');routeCheck(b);
   if(typeof b.text!=='string'||!b.text.trim()||b.text.length>16000)throw Error('invalid_text');
   wroteEditor=editor();inputValue(wroteEditor,b.text);editRevision=pcEditRevision;await pause(120);routeCheck(b);if(draft()!==b.text)throw Error('draft_conflict');
   const until=Math.min(b.deadline,Date.now()+1800);let button;
   while(!(button=sendButton())&&Date.now()<until){if(composing||draft()!==b.text)throw Error('draft_conflict');await pause(80);routeCheck(b)}
   if(!button||!button.isConnected)throw Error('send_unavailable');routeCheck(b);if(draft()!==b.text)throw Error('draft_conflict');
   const existing=new Set(messages().filter(m=>m.role==='user').map(m=>m.id)),wasNew=!conversation(),expectedProject=b.projectId||null;
   clicked=true;button.click();
   const limit=Date.now()+6500;
   while(Date.now()<limit){
    await pause(150);updateRoute();if(!wasNew&&conversation()!==b.conversationId)break;
    const accepted=messages().find(m=>m.role==='user'&&!existing.has(m.id)&&m.text.trim()===b.text.trim());
    if(accepted&&conversation()){
     schedule();if(expectedProject&&!project()?.startsWith(expectedProject))return {status:'sent_unconfirmed',error:'project_membership_unconfirmed',conversationId:conversation(),messageId:accepted.id};
     return {status:'sent_confirmed',conversationId:conversation(),projectId:expectedProject||project(),documentId,messageId:accepted.id};
    }
   }
   schedule();return {status:'sent_unconfirmed',documentId,conversationId:conversation()};
  }catch(e){
   // A proven pre-click failure may undo only this command's unchanged editor
   // insertion. Real PC typing or navigation always wins; no post-click rollback.
   if(!clicked&&wroteEditor&&wroteEditor===editor()&&pcEditRevision===editRevision&&!composing&&b.documentId===documentId&&b.conversationId===conversation()&&draft()===b.text){try{inputValue(wroteEditor,'')}catch{}}
   schedule();return {status:clicked?'sent_unconfirmed':'not_sent',error:e.message||'send_failed',documentId}
  }
 }
 function linkEntries(root,source){
  const list=[];for(const a of [...root.querySelectorAll('a[href]')].slice(0,1200)){
   let u;try{u=new URL(a.href,location.href)}catch{continue}if(u.origin!==location.origin)continue;
   const match=u.pathname.match(/^(?:\/g\/(g-p-[A-Za-z0-9_-]+))?\/c\/([A-Za-z0-9_-]{12,80})\/?$/);if(!match)continue;
   const item={id:match[2],title:(text(a).trim()||'未命名对话').slice(0,180),projectId:match[1]||null,path:u.pathname,current:conversation()===match[2],status:'unknown',readState:'unknown',source};
   known.set(item.id,{...item,query:lastQuery});if(!list.some(c=>c.id===item.id))list.push(item);
  }return list;
 }
 function catalog(){
  const root=nav(),projects=[];if(root)for(const row of [...root.querySelectorAll('[data-app-action-sidebar-project-id]')].slice(0,150)){
   const id=row.getAttribute('data-app-action-sidebar-project-id');if(!/^g-p-[A-Za-z0-9_-]{12,100}$/.test(id||''))continue;
   projects.push({id,title:(row.getAttribute('data-app-action-sidebar-project-label')||text(row)).trim().slice(0,160),collapsed:row.getAttribute('aria-expanded')==='false'||row.getAttribute('data-app-action-sidebar-project-collapsed')==='true',hasMore:[...row.parentElement.querySelectorAll('button')].some(b=>/^(?:展开显示|显示更多|加载更多|Show more|Load more)$/i.test(label(b)))});
  }
  return {projects,chats:root?linkEntries(root,'sidebar'):[],partial:true,sidebarAvailable:Boolean(root),source:'official_sidebar'};
 }
 async function search(b){
  const query=String(b.query||'').trim();if(!query||query.length>200)throw Error('invalid_query');
  let dialog=[...document.querySelectorAll('[role="dialog"],[role="search"],[cmdk-root]')].find(p.visible);
  let input=dialog?.querySelector('input[role="combobox"],input[type="search"],input[placeholder],input');
  if(!input){
   const button=[...(nav()||document).querySelectorAll('button,[role="button"]')].find(n=>p.visible(n)&&/^(?:搜索|搜尋|搜索聊天|搜尋聊天|Search|Search chats)$/i.test(label(n)));
   if(!button)throw Error('official_search_unavailable');button.click();
   for(let i=0;i<25&&!input;i++){await pause(80);dialog=[...document.querySelectorAll('[role="dialog"],[role="search"],[cmdk-root]')].find(p.visible);input=dialog?.querySelector('input[role="combobox"],input[type="search"],input[placeholder],input')}
  }
  if(!input)throw Error('official_search_unavailable');
  if(!b.more||query!==lastQuery){inputValue(input,query);lastQuery=query;await pause(500)}
  else{const more=[...dialog.querySelectorAll('button')].find(n=>p.visible(n)&&/^(?:加载更多|显示更多|Show more|Load more)$/i.test(label(n)));if(more)more.click();else{const scroller=[...dialog.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+30&&/(auto|scroll)/.test(getComputedStyle(n).overflowY));if(scroller)scroller.scrollTop=scroller.scrollHeight;}await pause(400)}
  let items=[],prior='',stable=0;
  for(let i=0;i<20;i++){items=linkEntries(dialog,'official_search');const value=items.map(x=>x.id).join('|');if(value===prior)stable++;else stable=0;prior=value;if(items.length&&stable>=2)break;await pause(120)}
  const loading=Boolean(dialog.querySelector('[role="progressbar"],[aria-busy="true"]'));
  const empty=/没有找到|未找到|无结果|沒有結果|No results|No conversations found/i.test(dialog.textContent||'');
  const moreButton=[...dialog.querySelectorAll('button')].find(n=>p.visible(n)&&!n.disabled&&/^(?:加载更多|显示更多|Show more|Load more)$/i.test(label(n)));
  const scrollable=[...dialog.querySelectorAll('*')].find(n=>n.clientHeight>0&&n.scrollHeight>n.clientHeight+30&&/(auto|scroll)/.test(getComputedStyle(n).overflowY));
  const hasMore=Boolean(moreButton||scrollable&&scrollable.scrollTop+scrollable.clientHeight<scrollable.scrollHeight-3);
  return {projects:catalog().projects,chats:items,partial:true,sidebarAvailable:true,source:'official_search',query,loading,emptyConfirmed:!loading&&empty,hasMore};
 }
 async function navigation(b){
  routeCheck(b);if(composing)throw Error('pc_composing');if(draft().trim())throw Error('pc_draft_blocks_navigation');
  const old=route,oldTurn=turnID(turns().at(-1));let control;
  if(b.action==='open'){
   const entry=known.get(b.targetConversationId);if(!entry)throw Error('conversation_not_observed');
   if(entry.id===conversation())return {snapshot:await snapshot()};
   control=[...document.querySelectorAll('a[href]')].find(a=>{try{return new URL(a.href,location.href).pathname===entry.path}catch{return false}});
   if(control)control.click();else location.assign(entry.path); // Only previously observed official link, never caller URL.
  }else if(b.action==='new'){
   if(b.projectId){
    const row=[...document.querySelectorAll('[data-app-action-sidebar-project-id]')].find(n=>n.getAttribute('data-app-action-sidebar-project-id')===b.projectId);if(!row)throw Error('project_not_observed');
    const title=row.getAttribute('data-app-action-sidebar-project-label')||text(row).trim();
    control=[...row.parentElement.querySelectorAll('button')].find(n=>/新聊天|New chat/i.test(label(n))&&label(n).includes(title));requestedProject=b.projectId;
   }else{control=[...(nav()||document).querySelectorAll('button,a,[role="button"]')].find(n=>p.visible(n)&&/^(?:新聊天|新對話|New chat)$/i.test(label(n)));requestedProject=null;}
   if(!control)throw Error('new_chat_control_unavailable');control.click();
  }else if(b.action==='project'){
   const row=[...document.querySelectorAll('[data-app-action-sidebar-project-id]')].find(n=>n.getAttribute('data-app-action-sidebar-project-id')===b.projectId);if(!row)throw Error('project_not_observed');
   if(row.getAttribute('aria-expanded')==='false'||row.getAttribute('data-app-action-sidebar-project-collapsed')==='true')row.click();
   else if(b.more){const more=[...row.parentElement.querySelectorAll('button')].find(n=>/^(?:展开显示|显示更多|加载更多|Show more|Load more)$/i.test(label(n)));if(more)more.click();}
   await pause(500);return catalog();
  }else throw Error('unknown_action');
  for(let i=0;i<50;i++){await pause(100);if(location.pathname!==old||turnID(turns().at(-1))!==oldTurn||b.action==='new'&&!conversation())break;}
  updateRoute();if(route===old&&b.action==='new'){documentId=crypto.randomUUID();actions=p.createActions(documentId,turnID,conversation);routePending=false;}
  if(b.action==='open'&&conversation()!==b.targetConversationId)throw Error('navigation_not_confirmed');
  if(b.action==='new'&&b.projectId&&!project()?.startsWith(b.projectId))throw Error('project_navigation_unconfirmed');
  schedule();return {snapshot:await snapshot()};
 }
 async function request(b){
  if(b.action==='subscribe'){session=b.sessionId;expiry=b.expiresAt;arm();updateRoute();bind();for(const ms of [100,450,1200,3000])setTimeout(schedule,ms);return {snapshot:await snapshot()};}
  if(b.action==='unsubscribe'){if(session===b.sessionId)stop();return {ok:true}}
  if(b.action==='renew'){if(session===b.sessionId){expiry=b.expiresAt;arm()}return {ok:true}}
  if(!session||b.sessionId!==session||expiry<Date.now())throw Error('session_expired');
  if(b.action==='refresh'){updateRoute();bind();return {snapshot:await snapshot()}}
  if(b.action==='catalog')return catalog();
  if(b.action==='search')return search(b);
  if(['open','new','project'].includes(b.action))return navigation(b);
  if(b.action==='history'){routeCheck(b);const part=page(b.before),items=messages(b.before);return {schema:1,documentId,conversationId:conversation(),messages:items,cursor:items[0]?.turnId||null,hasMore:part.hasMore,source:'pc_loaded_history'}}
  if(commands.has(b.commandId))return commands.get(b.commandId);
  if(b.action==='compose'){
   const work=composeSend(b);commands.set(b.commandId,work);return work;
  }
  if(b.action==='interact'){routeCheck(b);const result=actions.activate(b,turns().at(-1));commands.set(b.commandId,result);schedule();return result;}
  throw Error('unknown_action');
 }
 const onMessage=(b,sender,reply)=>{if(b?.type!=='shared_page'||sender.id!==chrome.runtime.id)return;request(b).then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message||'page_failure'}));return true};
 const input=e=>{if(e.target===editor()||editor()?.contains(e.target)){if(e.isTrusted)pcEditRevision++;schedule()}};
 const compStart=e=>{if(e.target===editor()||editor()?.contains(e.target)){composing=true;schedule()}};
 const compEnd=()=>{composing=false;schedule()};
 function destroy(){stop();chrome.runtime.onMessage.removeListener(onMessage);document.removeEventListener('input',input,true);document.removeEventListener('compositionstart',compStart,true);document.removeEventListener('compositionend',compEnd,true)}
 chrome.runtime.onMessage.addListener(onMessage);document.addEventListener('input',input,true);document.addEventListener('compositionstart',compStart,true);document.addEventListener('compositionend',compEnd,true);
 globalThis.__CGPT_SHARED_PAGE__={version:'0.2.2-r1.5',snapshot,destroy};
})();
