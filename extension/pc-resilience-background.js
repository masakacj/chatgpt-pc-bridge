import {
  PC_RESILIENCE_VERSION, STATE_PREFIX, BUDGET_PREFIX, validId,
  conversationId, conversationReadId, classifyFailure, sanitizeRecord,
  nextRecord, retryDecision, MAX_STATE_AGE
} from './pc-resilience-core.js';

// Integrated into the EXISTING executor. Nothing here submits a prompt, opens
// worker chats, changes network requests, or touches history/attachments/MCP.
export function startPcResilience({isBusy = () => false} = {}) {
  let serial = Promise.resolve();
  const recentFailure = new Map();
  const tabRoute = new Map();
  const scheduled = new Map();
  const stats = {reads:0, failures:0, unrelatedFailures:0, retries:0, imports:0, observations:0, nativeSidebarSignals:0};
  const eventLog = [];
  const enqueue = fn => {
    const task = serial.then(fn);
    serial = task.catch(() => {});
    return task;
  };
  const safeSend = (tabId, message) => chrome.tabs.sendMessage(tabId, message).catch(() => null);
  const log = event => {
    eventLog.push({...event, at:Date.now()});
    if (eventLog.length > 50) eventLog.shift();
    // Failure categories and elapsed data only. No URLs, IDs, text or tokens.
    chrome.storage.session?.set({pcResilienceEvents:eventLog}).catch(() => {});
  };
  async function records() {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    return Object.fromEntries(Object.entries(all)
      .filter(([key,value]) => key.startsWith(STATE_PREFIX) && validId(key.slice(STATE_PREFIX.length)) && sanitizeRecord(value,now))
      .map(([key,value]) => [key.slice(STATE_PREFIX.length),sanitizeRecord(value,now)]));
  }
  async function acceptObservation(message, sender) {
    // sender.url can remain the document's ORIGINAL URL after SPA routing.
    // Validate against the current browser tab URL, not its initial document.
    const tab = await chrome.tabs.get(sender.tab.id);
    const id = conversationId(tab.url);
    if (!id || id !== message.observation?.id) return {ok:false,reason:'route_mismatch'};
    const key = STATE_PREFIX + id;
    const old = (await chrome.storage.local.get(key))[key];
    const next = nextRecord(old, message.observation);
    if (next && next !== old) await chrome.storage.local.set({[key]:next});
    stats.observations++;
    return {ok:true,record:next};
  }
  async function acceptSidebarSignals(message, sender) {
    const items = Array.isArray(message.items) ? message.items.slice(0,150) : [];
    const accepted = items.filter(x => validId(x?.id) && x.kind === 'sidebar' &&
      (x.nativeRunning === true || x.nativeUnread === true || x.nativeRead === true));
    if (!accepted.length) return {ok:true,count:0};
    const tab = await chrome.tabs.get(sender.tab.id);
    const activeId = conversationId(tab.url);
    const keys = [...new Set(accepted.map(x => STATE_PREFIX+x.id))];
    const old = await chrome.storage.local.get(keys);
    const updates = {};
    for (const item of accepted) {
      // The read transition is restricted to the CURRENT, hydrated native
      // conversation. Other sidebar rows may only supply positive badges.
      if (item.nativeRead === true && (item.id !== activeId || item.answerReady !== true)) continue;
      const key = STATE_PREFIX+item.id;
      const previous = updates[key] || old[key] || null;
      const next = nextRecord(previous,item);
      if (next && next !== previous) updates[key] = next;
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    stats.nativeSidebarSignals += Object.keys(updates).length;
    return {ok:true,count:Object.keys(updates).length};
  }
  async function importLegacy(items) {
    if (!Array.isArray(items)) return {ok:false};
    const existing = await records();
    const updates = {};
    for (const item of items.slice(0,300)) {
      if (!validId(item?.id)) continue;
      const record = sanitizeRecord(item.record);
      if (!record || existing[item.id]?.at >= record.at) continue;
      updates[STATE_PREFIX+item.id] = {...record,source:'imported'};
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    stats.imports += Object.keys(updates).length;
    return {ok:true,count:Object.keys(updates).length};
  }
  async function requestRecovery(message, sender) {
    const tabId = sender.tab.id;
    const liveTab = await chrome.tabs.get(tabId);
    const id = conversationId(liveTab.url);
    if (!id || message.snapshot?.id !== id) return {ok:false,reason:'route_mismatch'};
    const failure = recentFailure.get(tabId);
    // A response from an old document can't authorize Retry in a new one.
    if (failure?.documentId && sender.documentId && failure.documentId !== sender.documentId) return {ok:false,reason:'different_document'};
    if (scheduled.has(tabId)) return {ok:true,reason:'already_scheduled'};
    const key = BUDGET_PREFIX + id;
    const oldBudget = (await chrome.storage.local.get(key))[key];
    const decision = retryDecision({failure,snapshot:message.snapshot,budget:oldBudget,busy:isBusy()});
    if (!decision.allow) return {ok:true,reason:decision.reason};
    // Reserve BEFORE scheduling: survives refresh/browser/service-worker restart.
    await chrome.storage.local.set({[key]:{attempts:decision.attempts,windowAt:decision.windowAt}});
    const timer = setTimeout(async () => {
      scheduled.delete(tabId);
      try {
        const tab = await chrome.tabs.get(tabId);
        const currentFailure = recentFailure.get(tabId);
        if (isBusy() || conversationId(tab.url) !== id || currentFailure !== failure) return;
        const response = await safeSend(tabId,{
          type:'pc_resilience_retry', id,
          documentId:sender.documentId || null,
          failureAt:failure.at
        });
        if (response?.clicked === true) {
          stats.retries++;
          log({kind:'native_load_retry',attempt:decision.attempts});
        }
      } catch { /* Closed/replaced tab: no reopening or duplicate work. */ }
    }, decision.delayMs);
    scheduled.set(tabId,timer);
    return {ok:true,scheduled:true,delayMs:decision.delayMs,attempt:decision.attempts};
  }
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (!message?.type?.startsWith('pc_resilience_')) return;
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !/^https:\/\/chatgpt\.com\//.test(sender.url || sender.tab.url || '')) {
      reply({ok:false}); return false;
    }
    enqueue(async () => {
      if (message.type === 'pc_resilience_boot') {
        tabRoute.set(sender.tab.id, conversationId(sender.tab.url || sender.url));
        return {ok:true,version:PC_RESILIENCE_VERSION,states:await records(),failure:recentFailure.get(sender.tab.id)||null};
      }
      if (message.type === 'pc_resilience_observe') return acceptObservation(message,sender);
      if (message.type === 'pc_resilience_sidebar_observe') return acceptSidebarSignals(message,sender);
      if (message.type === 'pc_resilience_import') return importLegacy(message.items);
      if (message.type === 'pc_resilience_recovery') return requestRecovery(message,sender);
      return {ok:false};
    }).then(reply, () => reply({ok:false,error:'extension_storage_unavailable'}));
    return true;
  });
  function networkComplete(details, error = '') {
    if (details.tabId < 0 || details.frameId !== 0) return;
    const id = conversationReadId(details.url,details.method);
    if (!id) return;
    const kind = classifyFailure(details.statusCode || 0,error);
    const knownRoute = tabRoute.has(details.tabId);
    const routeMatches = !knownRoute || tabRoute.get(details.tabId) === id;
    stats.reads++;
    if (!kind) {
      // A sidebar prefetch for another conversation cannot clear the error
      // evidence for the tab's currently visible conversation.
      if (recentFailure.get(details.tabId)?.id === id) recentFailure.delete(details.tabId);
      if (routeMatches) safeSend(details.tabId,{type:'pc_resilience_network',id,ok:true});
      return;
    }
    if (kind === 'aborted') return;
    if (!routeMatches) {
      stats.unrelatedFailures++;
      log({kind:'other_conversation_get_failed',category:kind,code:details.statusCode||0});
      return;
    }
    const failure = {id,kind,at:Date.now(),code:details.statusCode||0,documentId:details.documentId||null};
    recentFailure.set(details.tabId,failure);
    stats.failures++;
    const initiator = details.initiator || '';
    const origin = initiator.startsWith('chrome-extension://') ? 'extension' :
      initiator.startsWith('https://chatgpt.com') ? 'web_app' : 'unknown';
    // Only categories; never store conversation IDs, URLs, text or headers.
    log({kind:'conversation_get_failed',category:kind,code:failure.code,
      routeConfirmed:knownRoute,origin});
    safeSend(details.tabId,{type:'pc_resilience_network',id,ok:false,failure});
  }
  const filter = {urls:['https://chatgpt.com/backend-api/*'],types:['xmlhttprequest']};
  // Passive observation ONLY: never request headers/body, return blocking
  // decisions, rewrite credentials, or replay generation/tool requests.
  chrome.webRequest?.onCompleted.addListener(details => networkComplete(details),filter);
  chrome.webRequest?.onErrorOccurred.addListener(details => networkComplete(details,details.error||''),filter);
  chrome.tabs.onUpdated.addListener((tabId,change,tab) => {
    if (!/^https:\/\/chatgpt\.com\//.test(tab.url || '')) return;
    if (change.url) {
      tabRoute.set(tabId,conversationId(change.url));
      if (scheduled.has(tabId)) clearTimeout(scheduled.get(tabId));
      scheduled.delete(tabId);
      safeSend(tabId,{type:'pc_resilience_route'});
    }
    if (change.status === 'complete') safeSend(tabId,{type:'pc_resilience_route'});
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    clearTimeout(scheduled.get(tabId)); scheduled.delete(tabId);
    tabRoute.delete(tabId); recentFailure.delete(tabId);
  });
  chrome.tabs.onActivated.addListener(({tabId}) => safeSend(tabId,{type:'pc_resilience_wake'}));
  async function reinject() {
    const tabs = await chrome.tabs.query({url:'https://chatgpt.com/*'});
    const result = [];
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:['pc-resilience-content.js']});
        const status = await safeSend(tab.id,{type:'pc_resilience_audit'});
        result.push({ok:Boolean(status),...(status||{})});
      } catch { result.push({ok:false,error:'tab_not_ready'}); }
    }
    return result;
  }
  async function audit() {
    await serial;
    const saved = await records();
    const categories = {};
    for (const rec of Object.values(saved)) categories[rec.status] = (categories[rec.status]||0)+1;
    const pages = [];
    for (const tab of await chrome.tabs.query({url:'https://chatgpt.com/*'})) {
      pages.push(await safeSend(tab.id,{type:'pc_resilience_audit'}) || {unavailable:true});
    }
    return {version:PC_RESILIENCE_VERSION,extensionId:chrome.runtime.id,
      manifestVersion:chrome.runtime.getManifest().version,
      storage:'chrome.storage.local',networkObserver:Boolean(chrome.webRequest),
      recordCount:Object.keys(saved).length,categories,stats:{...stats},events:[...eventLog],pages};
  }
  // Bounded retention and migration metadata. Never clear ChatGPT website data.
  enqueue(async () => {
    const all = await chrome.storage.local.get(null);
    const expired = Object.keys(all).filter(k => k.startsWith(STATE_PREFIX) && (!sanitizeRecord(all[k]) || Date.now()-all[k].at > MAX_STATE_AGE));
    if (expired.length) await chrome.storage.local.remove(expired);
    await chrome.storage.local.set({pcExtensionOnlyPolicy:{version:1,legacyUserscriptsRetired:true,at:Date.now()}});
  });
  return {audit,reinject};
}
