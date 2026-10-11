// Chrome extension content module. NOT a userscript; no Tampermonkey path.
(() => {
  'use strict';
  const VERSION = '1.1.2';
  const GLOBAL = '__ORCH_PC_RESILIENCE__';
  if (location.origin !== 'https://chatgpt.com' || window !== window.top || !globalThis.chrome?.runtime?.id) return;
  if (globalThis[GLOBAL]?.version === VERSION) return;
  // Retire a previous isolated context left by an unpacked-extension reload.
  window.dispatchEvent(new Event('orch-pc-extension-retire'));
  globalThis[GLOBAL]?.destroy?.();
  const PREFIX = 'pc-state-v1:';
  const ATTR = 'data-orch-pc-state';
  const STYLE = 'orchestrator-pc-status-style';
  const states = new Map();
  const links = new Map();
  const nativeMarkers = new Map();
  const timers = new Set();
  let destroyed = false, sidebar = null, observer = null, sidebarTimer = 0;
  let nativeObserver = null, nativeList = null, nativeStateNode = null, nativeEventTimer = 0;
  let current = null, priorTurnKey = null, lastTurnKey = null;
  let activeTimer = 0, submitUntil = 0, canceledRecovery = false, failure = null;
  let checks = 0, retries = 0, storageReady = false, booted = false, bootAttempts = 0;
  const chatId = (href = location.href) => {
    try {
      const u = new URL(href,location.origin);
      return u.origin === location.origin ? u.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1] || null : null;
    } catch { return null; }
  };
  const later = (fn, ms) => {
    const timer = setTimeout(() => {timers.delete(timer); if (!destroyed) fn();},ms);
    timers.add(timer); return timer;
  };
  const send = message => {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch { return Promise.resolve(null); }
  };
  const visible = el => {
    if (!(el instanceof HTMLElement) || el.closest('[hidden],[aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  function stateLabel(record) {
    if (!record) return null;
    if (['running','waiting'].includes(record.status) && Date.now()-(record.verifiedAt||record.at) > 90000) return 'uncertain';
    if (record.status === 'completed' && record.readState === 'unread') return 'completed_unread';
    if (record.status === 'completed' && record.readState === 'read') return 'completed_read';
    if (record.status === 'uncertain' && record.readState === 'unread') return 'unread_unverified';
    return record.status;
  }
  function officialMarker(a) {
    // The native ChatGPT dot/spinner is OUTSIDE the <a>, inside its conversation
    // row. This structure was verified on the user's current Chrome build.
    let row=a?.parentElement;
    for(let depth=0;row&&depth<5;depth++,row=row.parentElement) {
      if (row.classList?.contains('group') && row.classList.contains('cursor-interaction')) break;
    }
    if (!row || !row.classList?.contains('cursor-interaction')) return null;
    return {
      running: Boolean(row.querySelector('[class*="animate-spin"]')),
      unread: Boolean(row.querySelector('span.rounded-full.bg-info-solid')),
      selected: a.getAttribute('aria-current')==='page' || row.getAttribute('aria-current')==='page'
    };
  }
  function paint(id) {
    const value = stateLabel(states.get(id));
    for (const a of links.get(id) || []) {
      if (!a.isConnected) continue;
      const native=officialMarker(a);
      // Never duplicate native spinner/unread blue dot with our text badge.
      const shown = native?.running ||
        (native?.unread && !['waiting','error'].includes(value)) ? null : value;
      if (shown && a.getAttribute(ATTR) !== shown) a.setAttribute(ATTR,shown);
      else if (!shown) a.removeAttribute(ATTR);
    }
  }
  function attachSidebar() {
    if (destroyed) return;
    const candidates = [...document.querySelectorAll('nav,aside,[data-testid="sidebar"]')];
    const next = candidates.find(x => x.querySelector('a[href*="/c/"]')) || null;
    if (!next) return;
    if (next !== sidebar || !observer) {
      observer?.disconnect(); sidebar = next;
      observer = new MutationObserver(mutations => {
        const signal='a[href*="/c/"],span.bg-info-solid,[class*="animate-spin"]';
        if (!mutations.some(m => m.type === 'attributes' ||
          [...m.addedNodes,...m.removedNodes].some(n => n.nodeType===1 &&
            (n.matches?.(signal) || n.querySelector?.(signal))))) return;
        if (sidebarTimer) return;
        sidebarTimer = later(() => {sidebarTimer=0;reconcile();},120);
      });
      observer.observe(sidebar,{childList:true,subtree:true,attributes:true,attributeFilter:['href','data-conversation-id']});
    }
    reconcile();
  }
  function reconcile() {
    if (!sidebar?.isConnected) return;
    links.clear();
    for (const a of sidebar.querySelectorAll('a[href*="/c/"]')) {
      const id = chatId(a.href);
      if (!id) continue;
      if (!links.has(id)) links.set(id,new Set());
      links.get(id).add(a);
    }
    // Collect ONLY positive native row badges, not guesses from missing
    // spinners/dots. Send changed signals as one small storage update.
    const changed=[];
    const seen=new Map();
    for(const [id,anchors] of links) {
      let marker='plain';
      for(const a of anchors) {
        const native=officialMarker(a);
        if(native?.running) {marker='running';break;}
        if(native?.unread) marker='unread';
      }
      seen.set(id,marker);
      if(nativeMarkers.get(id)===marker) continue;
      if(marker==='running') changed.push({id,kind:'sidebar',nativeRunning:true});
      if(marker==='unread') changed.push({id,kind:'sidebar',nativeUnread:true,nativeRunning:false});
    }
    nativeMarkers.clear();
    for(const [id,marker] of seen) nativeMarkers.set(id,marker);
    if(changed.length && storageReady && document.visibilityState==='visible')
      send({type:'pc_resilience_sidebar_observe',items:changed});
    for (const id of links.keys()) paint(id);
  }
  function bindNativeState() {
    // Observe ONLY the current turn's state attribute and direct sibling-list
    // changes. Never observe arbitrary transcript subtree content mutations.
    const root=document.querySelector('main [class*="transcriptContent"]') || document.querySelector('main');
    if (!root) return;
    const turns=root.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"]');
    const last=turns.length?turns[turns.length-1]:null;
    const nested=last?.querySelectorAll('[data-talvt-turn-state]')||[];
    const stateNode=last?.hasAttribute('data-talvt-turn-state')?last:nested[nested.length-1]||null;
    const list=last?.parentElement||root;
    if (nativeObserver && list===nativeList && stateNode===nativeStateNode) return;
    nativeObserver?.disconnect();nativeList=list;nativeStateNode=stateNode;
    if (!nativeObserver) nativeObserver=new MutationObserver(() => {
      if (nativeEventTimer || destroyed || !current) return;
      nativeEventTimer=later(()=>{nativeEventTimer=0;bindNativeState();check();},180);
    });
    nativeObserver.observe(list,{childList:true,subtree:false});
    if (stateNode && stateNode!==list) nativeObserver.observe(stateNode,{attributes:true,attributeFilter:['data-talvt-turn-state'],subtree:false});
  }
  function snapshot(updateTracking = true) {
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    const transcript = main?.querySelector('[class*="transcriptContent"]') || main;
    const turns = transcript?.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"]') || [];
    const last = turns.length ? turns[turns.length-1] : null;
    const stateNodes = last?.querySelectorAll('[data-talvt-turn-state]') || [];
    const stateNode = last?.hasAttribute('data-talvt-turn-state') ? last : stateNodes[stateNodes.length-1] || null;
    const raw = stateNode?.getAttribute('data-talvt-turn-state') || null;
    const turnKey = last?.getAttribute('data-turn-key') || last?.getAttribute('data-testid') || null;
    const roots = last?.querySelectorAll('[class*="DilResponseRoot"],[data-dil-message-id],[class*="MarkdownRoot"],[data-message-author-role="assistant"]') || [];
    const hasAnswer = [...roots].some(n => (n.textContent||'').trim().length > 0);
    const currentTurn = !(priorTurnKey && turnKey === priorTurnKey);
    if (updateTracking && current && turnKey && currentTurn) {priorTurnKey=null;lastTurnKey=turnKey;}
    const waiting = ['waiting_user','waiting_for_user'].includes(raw) || Boolean(last && [...last.querySelectorAll('[data-testid*="approval" i] button,[data-testid*="permission" i] button,button[aria-label*="Approve" i],button[aria-label*="授权"]')].some(visible));
    const running = ['running','in_progress','streaming'].includes(raw) || Boolean(!raw && main && [...main.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="Stop generating" i],button[aria-label*="停止生成"]')].some(visible));
    const fields = [...document.querySelectorAll('#prompt-textarea,main textarea,main [contenteditable="true"]')];
    const hasDraft = fields.some(n => ((n.value || n.textContent || '').trim().length > 0));
    const error = findLoadError(main);
    const activeLinks=links.get(current);
    const nativeBadge=activeLinks ? [...activeLinks].map(officialMarker).find(x => x?.selected) || null : null;
    const complete=['complete','completed'].includes(raw);
    // The native response can end with "cancelled" and a visible "无法思考"
    // banner, even though no assistant role/answer is mounted. It is a real
    // failed answer, not an unfinished spinner. Ordinary user cancellation
    // (without this explicit native error label) is "stopped", NOT an error.
    let nativeCancellation=null;
    if (['cancelled','canceled'].includes(raw)) {
      const nativeErrorLabel=last && [...last.querySelectorAll('span,div,p,small,strong,[role="status"]')]
        .some(node=>{
          const s=(node.textContent||'').trim();
          return s.length<=70 &&
            /^(?:无法思考|无法继续思考|思考失败|could(?: not|n't) think|unable to think|thinking failed|failed to think)$/i.test(s) &&
            ![...node.children].some(child=>(child.textContent||'').trim()===s) &&
            !node.closest('[data-conversation-role="user"],[data-message-author-role="user"]') &&
            node.getClientRects().length>0;
        });
      nativeCancellation=nativeErrorLabel?'error':'stopped';
    }
    return {
      id:current,kind:'native',turnKey,currentTurn,
      nativeState:waiting?'waiting':running?'running':
        ['error','failed','errored'].includes(raw) || (error && !turns.length) ? 'error':
        nativeCancellation || (complete?'complete':null),
      answerReady:hasAnswer,hasAnswer,running,waiting,hasDraft,
      nativeUnread:nativeBadge?.unread===true,
      nativeRead:complete && hasAnswer && document.visibilityState==='visible' &&
        nativeBadge?.selected===true && nativeBadge.unread===false,
      loadError:Boolean(error),canRetry:Boolean(error?.button),
      visible:document.visibilityState==='visible',
      recoveryCanceled:canceledRecovery || submitUntil>Date.now()
    };
  }
  function findLoadError(main) {
    if (!main) return null;
    const loadMessage = /(?:unable|failed|could not|couldn.t)\s+(?:to\s+)?load\s+(?:(?:this|the)\s+)?(?:(?:chatgpt|gpt)\s+)?(?:conversation|chat)|(?:对话|会话).{0,12}加载失败|(?:无法|未能)加载.{0,8}(?:对话|会话)|error loading (?:(?:this|the)\s+)?(?:(?:chatgpt|gpt)\s+)?(?:conversation|chat)/i;
    const retryButton = root => [...root.querySelectorAll('button')].find(b => visible(b) && !b.disabled &&
      /^(?:retry|try again|reload|重试|重新加载|再试一次)$/i.test((b.textContent || b.getAttribute('aria-label') || '').trim()));
    const noTurns = !main.querySelector('[data-turn-key],[data-testid^="conversation-turn-"]');
    // When the whole conversation failed to hydrate, the native alert can
    // be portaled outside <main>. Never scan portal alerts if turns exist.
    const panels = (noTurns?document:main).querySelectorAll('[data-testid*="conversation-error" i],[data-testid*="error-boundary" i],[role="alert"]');
    for (const panel of panels) {
      if (!visible(panel) || panel.closest('[data-turn-key],[data-testid^="conversation-turn-"]')) continue;
      const text = (panel.textContent || '').trim().slice(0,1200);
      const named = /conversation-error|error-boundary/i.test(panel.getAttribute('data-testid')||'');
      if (!loadMessage.test(text) && !(named && /something went wrong|出错|发生错误|try again/i.test(text))) continue;
      return {panel,button:retryButton(panel)||null};
    }
    // The native router may render a plain full-page load failure without
    // alert/test-id wrappers. Only accept it with ZERO existing turns and an
    // explicit conversation-load error; never mistake a tool error for this.
    if (!noTurns) return null;
    const body = (main.textContent || '').trim();
    if (body.length > 800 || !loadMessage.test(body)) return null;
    return {panel:main,button:retryButton(main)||null};
  }
  async function check() {
    if (destroyed || !current || !storageReady) return;
    checks++;
    bindNativeState();
    const value = snapshot();
    await send({type:'pc_resilience_observe',observation:value});
    if (value.loadError && failure?.id === current) {
      await send({type:'pc_resilience_recovery',snapshot:value});
    }
    if ((value.running && value.currentTurn) || submitUntil>Date.now()) watchActive();
  }
  function watchActive() {
    if (activeTimer || destroyed) return;
    activeTimer = later(() => {activeTimer=0;check();},document.hidden?6000:2500);
  }
  function route(force = false) {
    const id = chatId();
    if (!force && id === current) {attachSidebar();return;}
    if (id !== current) {
      priorTurnKey = current ? lastTurnKey : null; current=id;
      canceledRecovery=false; failure=null; submitUntil=0;
      clearTimeout(activeTimer); timers.delete(activeTimer); activeTimer=0;
      nativeObserver?.disconnect();nativeList=null;nativeStateNode=null;
    }
    // Bounded retries handle very late original-page hydration. They do not
    // stay alive polling an idle page, nor watch the transcript subtree.
    for (const delay of [0,450,1600,4500,10000,20000,45000,65000]) {
      later(() => {if (current===id) {attachSidebar();check();}},delay);
    }
  }
  async function migrateLegacy() {
    const items = [];
    for (const key of ['cgpt-lite-states-v1','cgpt-safari-conversation-state-v1']) {
      try {
        const old = JSON.parse(localStorage.getItem(key) || '{}');
        for (const [id,value] of Object.entries(old).slice(0,300)) {
          if (!value) continue;
          const status = ({completed_read:'completed',completed_unread:'completed',waiting_user:'waiting',settling:'uncertain'})[value.status] || value.status;
          items.push({id,record:{status,at:Number(value.at||value.updatedAt)||0,source:'imported'}});
        }
      } catch { /* storage unavailable: preserve and continue natively */ }
    }
    if (!items.length) return;
    const result = await send({type:'pc_resilience_import',items});
    if (result?.ok) {
      // Only obsolete optimizer state keys after durable migration. Never
      // clear authentication, cookies, IndexedDB or ChatGPT site caches.
      localStorage.removeItem('cgpt-lite-states-v1');
      localStorage.removeItem('cgpt-safari-conversation-state-v1');
    }
  }
  async function boot() {
    if (booted || bootAttempts >= 4) return; booted=true;bootAttempts++;
    await migrateLegacy();
    const response = await send({type:'pc_resilience_boot'});
    if (!response?.ok) {booted=false;later(boot,1200);return;}
    for (const [id,record] of Object.entries(response.states||{})) states.set(id,record);
    storageReady=true;failure=response.failure||null;
    route(true);
  }
  function onClick(event) {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    const button = el.closest('button');
    if (button?.matches('[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="发送消息"]') && !button.disabled) submit();
    if (button?.matches('[data-testid="stop-button"]')) {submitUntil=0;if(current) send({type:'pc_resilience_observe',observation:{id:current,kind:'stop'}});}
    if (el.closest('a[href*="/c/"],button[data-testid*="sidebar" i],button[aria-label*="sidebar" i],button[aria-label*="侧栏"],button[aria-label*="侧边栏"]')) {
      for (const ms of [0,200,800,2400]) later(()=>{route();attachSidebar();check();},ms);
    }
  }
  function submit() {
    if (!current) {later(()=>route(),800);return;}
    const value=snapshot();
    submitUntil=Date.now()+30000;canceledRecovery=true;
    send({type:'pc_resilience_observe',observation:{...value,kind:'submit'}});
    watchActive();
  }
  function onSubmit(event) {
    if (event.target instanceof HTMLFormElement && event.target.querySelector('#prompt-textarea,textarea[name="prompt"],[contenteditable="true"]')) submit();
  }
  function onInput(event) {
    if (event.target instanceof Element && event.target.closest('#prompt-textarea,textarea[name="prompt"],[contenteditable="true"]')) canceledRecovery=true;
  }
  function onStorage(changes,area) {
    if (area !== 'local') return;
    for (const [key,change] of Object.entries(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      const id=key.slice(PREFIX.length);
      if (change.newValue) states.set(id,change.newValue);else states.delete(id);
      paint(id);
    }
  }
  function audit() {
    const snap=snapshot(false);
    return {version:VERSION,storageReady,routeKind:current?'conversation':'home',
      stateCount:states.size,sidebarChatCount:links.size,checks,retries,
      nativeStateWatch:Boolean(nativeObserver && nativeList?.isConnected),
      currentStatus:stateLabel(states.get(current)),nativeState:snap.nativeState,
      loadError:snap.loadError,canRetry:snap.canRetry,hasAnswer:snap.hasAnswer,
      hasDraft:snap.hasDraft,waiting:snap.waiting,
      completedUnread:[...states.values()].filter(x=>x.status==='completed'&&x.readState==='unread').length,
      completedRead:[...states.values()].filter(x=>x.status==='completed'&&x.readState==='read').length,
      officialSpinnerRows:[...nativeMarkers.values()].filter(x=>x==='running').length,
      officialUnreadRows:[...nativeMarkers.values()].filter(x=>x==='unread').length,
      recentReadFailure:failure && Date.now()-failure.at<120000 ? failure.kind : null,
      legacyLite:document.documentElement.getAttribute('data-cgpt-lite-version'),
      legacyUnified:document.documentElement.getAttribute('data-cgpt-runtime-version')};
  }
  function onMessage(message,sender,reply) {
    if (message?.type==='pc_resilience_audit') {reply(audit());return;}
    if (message?.type==='pc_resilience_route') route();
    if (message?.type==='pc_resilience_wake') {route();attachSidebar();check();}
    if (message?.type==='pc_resilience_network' && message.id===chatId()) {
      if (current!==message.id) route();
      failure=message.ok?null:message.failure;
      // HTTP 429/auth/missing cannot be auto-retried. Avoid five needless
      // DOM checks per native background refresh while the site is limited.
      const recoverable=['transient_http','transient_network'].includes(failure?.kind);
      for (const delay of recoverable?[0,300,1200,3500,7000]:[1200])
        later(()=>{attachSidebar();check();},delay);
    }
    if (message?.type==='pc_resilience_retry') {
      const value=snapshot();
      const allowed=message.id===current && current===chatId() && value.visible && value.loadError && !value.hasDraft && !value.running && !value.waiting && !value.hasAnswer && !value.recoveryCanceled;
      const button=allowed?findLoadError(document.querySelector('main')||document.querySelector('[role="main"]'))?.button:null;
      if (button) {retries++;button.click();for(const ms of [400,1600,5000])later(check,ms);}
      reply({clicked:Boolean(button)});return;
    }
  }
  function onVisible() {if(!document.hidden){route();attachSidebar();check();}}
  function destroy() {
    destroyed=true;observer?.disconnect();nativeObserver?.disconnect();
    timers.forEach(clearTimeout);timers.clear();
    document.removeEventListener('click',onClick,true);
    document.removeEventListener('input',onInput,true);
    document.removeEventListener('submit',onSubmit,true);
    document.removeEventListener('visibilitychange',onVisible);
    window.removeEventListener('popstate',onVisible);
    window.removeEventListener('orch-pc-extension-retire',destroy);
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onStorage);
    document.getElementById(STYLE)?.remove();
    for(const items of links.values())for(const a of items)a.removeAttribute(ATTR);
    document.documentElement.removeAttribute('data-orch-pc-version');
  }
  document.documentElement.setAttribute('data-orch-pc-version',VERSION);
  document.getElementById(STYLE)?.remove();
  const style=document.createElement('style');style.id=STYLE;
  style.textContent=`nav a[${ATTR}]::after,aside a[${ATTR}]::after,[data-testid="sidebar"] a[${ATTR}]::after{font:10px/1.5 system-ui;margin-left:5px;opacity:.75;pointer-events:none;white-space:nowrap}a[${ATTR}="running"]::after{content:"进行中"}a[${ATTR}="completed"]::after{content:"已完成"}a[${ATTR}="completed_unread"]::after{content:"已完成·未读"}a[${ATTR}="completed_read"]::after{content:"已完成·已读"}a[${ATTR}="unread_unverified"]::after{content:"未读·待确认"}a[${ATTR}="error"]::after{content:"错误"}a[${ATTR}="waiting"]::after{content:"等待操作"}a[${ATTR}="uncertain"]::after{content:"待同步"}a[${ATTR}="stopped"]::after{content:"已停止"}`;
  (document.head||document.documentElement).appendChild(style);
  globalThis[GLOBAL]={version:VERSION,destroy,audit};
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener('click',onClick,true);
  document.addEventListener('submit',onSubmit,true);
  document.addEventListener('input',onInput,true);
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('popstate',onVisible);
  window.addEventListener('orch-pc-extension-retire',destroy);
  boot();
})();
