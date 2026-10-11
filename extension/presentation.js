// Shared-tab bridge presentation. Read-only extraction; no transcript mutation.
(() => {
 'use strict';
 const OMIT='[data-testid*="reasoning" i],[data-testid*="thinking" i],[data-testid*="activity" i],[data-message-author-role="tool"],[data-conversation-role="tool"],[data-message-channel="analysis"],[data-channel="analysis"],[data-message-channel="commentary"],[data-channel="commentary"],[class*="group/activity"],[class*="group/mcp-app"],[class*="Thinking" i],[class*="Reasoning" i],[class*="Thoughts" i],iframe,script,style,button,[role="button"],input,textarea,select,.sr-only,[hidden],[aria-hidden="true"]';
 const PANELS='[data-testid*="approval" i],[data-testid*="permission" i],[data-testid*="tool-confirmation" i],[data-tool-interaction],[data-app-action-approval]';
 const names=/^(?:Allow(?: once| access)?|Approve(?: once)?|Reject|Deny|Confirm|Cancel|Continue|允许(?:本次|一次|访问)?|允許(?:本次|一次|存取)?|批准(?:一次)?|确认|確認|取消|拒绝|拒絕|继续|繼續)$/i;
 const visible=n=>n?.nodeType===1&&n.isConnected&&n.getClientRects().length>0&&!n.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(n).visibility!=='hidden';
 function cleanText(node){
  let count=0;
  function walk(n){
   if(++count>40000)return '';
   if(n.nodeType===Node.TEXT_NODE)return n.nodeValue||'';
   if(n.nodeType!==Node.ELEMENT_NODE||n.matches(OMIT)||n.matches(PANELS))return '';
   if(n.tagName==='BR')return '\n';
   const value=[...n.childNodes].map(walk).join('');
   return /^(?:P|DIV|H[1-6]|LI|PRE|TR|BLOCKQUOTE)$/.test(n.tagName)?value+'\n':value;
  }
  return walk(node).replace(/\n{3,}/g,'\n\n').trimEnd();
 }
 function excluded(node){return Boolean(node.closest(OMIT+','+PANELS))}
 function createActions(documentId,getTurnKey,getConversation){
  let entries=new Map();const ids=new WeakMap(),versions=new WeakMap(),used=new Set();
  const idFor=b=>{if(!ids.has(b))ids.set(b,crypto.randomUUID());return ids.get(b)};
  function collect(turn){
   const next=new Map(),cards=[];
   if(!turn){entries=next;return cards}
   const contexts=[{root:turn,frame:null}];
   for(const frame of [...turn.querySelectorAll('iframe')].filter(visible).slice(0,4)){
    try{if(frame.contentDocument?.body)contexts.push({root:frame.contentDocument.body,frame})}catch{}
   }
   const panels=contexts.flatMap(c=>[...c.root.querySelectorAll(PANELS)].filter((n,i,a)=>!a.some(p=>p!==n&&p.contains(n))).map(panel=>({panel,frame:c.frame}))).slice(0,6);
   for(const {panel,frame} of panels){
    if(!visible(panel))continue;
    const labelNode=panel.querySelector('[data-approval-description],[data-permission-description],h1,h2,h3,h4,[role="heading"]');
    const title=(labelNode?.textContent||panel.getAttribute('aria-label')||'需要你的确认').trim().slice(0,200);
    const paragraphs=[...panel.querySelectorAll('p,[data-approval-description],[data-permission-description]')].filter(n=>!n.closest('[data-testid*="reasoning" i],[data-testid*="thinking" i]'));
    const raw=paragraphs.map(n=>(n.textContent||'').trim()).filter(Boolean).join('\n');
    const summary=raw.slice(0,1600),complete=raw.length<=1600,buttons=[];
    for(const button of [...panel.querySelectorAll('button')].slice(0,12)){
     const label=(button.getAttribute('aria-label')||button.textContent||'').trim();
     if(!visible(button)||!names.test(label)||button.type==='submit'&&button.form?.querySelector('#prompt-textarea'))continue;
     const id=idFor(button),fingerprint=JSON.stringify({title,summary,label,turn:getTurnKey(turn),conversation:getConversation()});
     const old=versions.get(button),revision=old?.fingerprint===fingerprint?old.revision:crypto.randomUUID();
     versions.set(button,{fingerprint,revision});
     const disabled=button.disabled||button.getAttribute('aria-disabled')==='true'||used.has(id)||!complete;
     next.set(id,{button,panel,frame,turn,revision});buttons.push({id,label,revision,disabled,requiresConfirmation:true});
    }
    if(buttons.length)cards.push({id:idFor(panel),title,summary,buttons});
   }
   entries=next;return cards;
  }
  function activate(request,currentTurn){
   collect(currentTurn);const item=entries.get(request.interactionId);
   if(request.documentId!==documentId||request.conversationId!==getConversation()||request.confirmed!==true)return {status:'not_acted',error:'interaction_confirmation_required'};
   if(!item||item.revision!==request.interactionRevision||item.turn!==currentTurn||!visible(item.button)||item.button.disabled||item.button.getAttribute('aria-disabled')==='true'||used.has(request.interactionId))return {status:'not_acted',error:'interaction_changed'};
   if(item.frame&&(!visible(item.frame)||!currentTurn.contains(item.frame)||item.button.ownerDocument!==item.frame.contentDocument))return {status:'not_acted',error:'interaction_changed'};
   const offered=collect(currentTurn).flatMap(c=>c.buttons).find(b=>b.id===request.interactionId);
   if(!offered||offered.disabled)return {status:'not_acted',error:'interaction_changed'};
   used.add(request.interactionId);item.button.click();return {status:'interaction_clicked',interactionId:request.interactionId};
  }
  return {collect,activate};
 }
 globalThis.__CGPT_BRIDGE_PRESENTATION__={excluded,cleanText,createActions,visible};
})();
