// PC extension-only state/recovery policy. No DOM, credentials, fetch or timers.
export const PC_RESILIENCE_VERSION = '1.1.2';
export const STATE_PREFIX = 'pc-state-v1:';
export const BUDGET_PREFIX = 'pc-recovery-v1:';
export const RECOVERY_WINDOW = 5 * 60 * 1000;
export const MAX_RECOVERY_ATTEMPTS = 2;
export const MAX_STATE_AGE = 30 * 86400000;
const ID = /^[A-Za-z0-9_-]{12,80}$/;
const STATES = new Set(['running','waiting','completed','error','stopped','uncertain']);
const READ_STATES = new Set(['read','unread']);
export const validId = id => typeof id === 'string' && ID.test(id);
export function conversationId(url) {
  try {
    const u = new URL(url);
    return u.origin === 'https://chatgpt.com'
      ? u.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]{12,80})(?:\/|$)/)?.[1] || null : null;
  } catch { return null; }
}
export function conversationReadId(url, method = 'GET') {
  if (method !== 'GET') return null;
  try {
    const u = new URL(url);
    if (u.origin !== 'https://chatgpt.com') return null;
    // Match only saved-conversation GETs, never generation or tool endpoints.
    return u.pathname.match(/^\/backend-api\/(?:f\/)?conversations?\/([A-Za-z0-9_-]{12,80})\/?$/)?.[1] || null;
  } catch { return null; }
}
export function classifyFailure(status, error = '') {
  if ([401,403].includes(status)) return 'auth';
  if (status === 429) return 'rate_limit';
  if ([404,410].includes(status)) return 'not_found';
  if ([408,425,500,502,503,504].includes(status)) return 'transient_http';
  if (error === 'net::ERR_ABORTED') return 'aborted';
  if (error === 'net::ERR_INTERNET_DISCONNECTED') return 'offline';
  if (/CERT_|SSL_|BLOCKED_BY_CLIENT|ACCESS_DENIED/.test(error)) return 'blocked';
  if (/TIMED_OUT|CONNECTION_(CLOSED|RESET|ABORTED)|NETWORK_CHANGED|HTTP2_PROTOCOL_ERROR|QUIC_PROTOCOL_ERROR|NAME_NOT_RESOLVED/.test(error)) return 'transient_network';
  return status >= 400 || error ? 'other' : null;
}
export function sanitizeRecord(record, now = Date.now()) {
  if (!record || !STATES.has(record.status)) return null;
  const at = Number(record.at);
  if (!Number.isFinite(at) || at <= 0 || at > now + 60000 || now - at > MAX_STATE_AGE) return null;
  return {
    status: record.status,
    at,
    verifiedAt: Math.max(0, Math.min(at, Number(record.verifiedAt) || 0)),
    turnKey: typeof record.turnKey === 'string' ? record.turnKey.slice(0,160) : null,
    readState: READ_STATES.has(record.readState) ? record.readState : 'unknown',
    source: record.source === 'native' ? 'native' : record.source === 'sidebar' ? 'sidebar' : record.source === 'submit' ? 'submit' : 'imported'
  };
}
export function displayState(record, now = Date.now()) {
  if (!record) return null;
  if (['running','waiting'].includes(record.status) && now - (record.verifiedAt || record.at) > 90000) return 'uncertain';
  if (record.status === 'completed' && record.readState === 'unread') return 'completed_unread';
  if (record.status === 'completed' && record.readState === 'read') return 'completed_read';
  if (record.status === 'uncertain' && record.readState === 'unread') return 'unread_unverified';
  return record.status;
}
export function nextRecord(previous, observation, now = Date.now()) {
  if (!observation || !validId(observation.id)) return previous || null;
  let status = null;
  let readState = previous?.readState || 'unknown';
  const sidebar = observation.kind === 'sidebar';
  if (observation.kind === 'submit') {
    status = 'running'; readState = 'unknown';
  } else if (observation.kind === 'stop') {
    status = 'stopped';
  } else if (sidebar) {
    // Only positive native signals. The ABSENCE of a spinner or dot cannot
    // prove that a task has completed or has been read.
    if (observation.nativeRunning === true) {
      status = 'running'; readState = 'unknown';
    }
    if (observation.nativeUnread === true) {
      readState = 'unread';
      // A previously verified running task changed from the official spinner
      // to the official unread-result dot. Unlike a dot alone, this is a
      // trustworthy completion transition for the tracked task. Never use
      // it to override waiting-for-approval or an explicit error.
      if (observation.nativeRunning === false &&
          ['running','completed'].includes(previous?.status)) status = 'completed';
    }
    // Read acknowledgment is allowed only after a previous native unread dot,
    // with a readable current answer; never infer it from sidebar hydration.
    if (observation.nativeRead === true && previous?.readState === 'unread' &&
        previous?.status === 'completed' && observation.answerReady === true) readState = 'read';
  } else if (observation.currentTurn !== false && observation.nativeState === 'waiting') {
    status = 'waiting';
  } else if (observation.currentTurn !== false && observation.nativeState === 'running') {
    status = 'running'; readState = 'unknown';
  } else if (observation.currentTurn !== false && observation.nativeState === 'error') {
    status = 'error';
  } else if (observation.currentTurn !== false && observation.nativeState === 'stopped') {
    status = 'stopped';
  } else if (observation.currentTurn !== false && observation.nativeState === 'complete' &&
             observation.answerReady === true && observation.loadError !== true) {
    // Never treat the prior assistant answer as completion immediately on Send.
    if (previous?.source === 'submit' && previous.turnKey === observation.turnKey &&
        now - previous.at < 120000) return previous;
    status = 'completed';
  }
  if (!sidebar && observation.nativeUnread === true) readState = 'unread';
  if (!sidebar && status === 'completed' && observation.nativeRead === true) readState = 'read';
  // No native status, and no change in official unread indicator: keep the
  // last verified state. Blank/failed hydration never manufactures completion.
  if (!status && readState === (previous?.readState || 'unknown')) return previous || null;
  const finalStatus = status || previous?.status || 'uncertain';
  const turnKey = sidebar ? (previous?.turnKey || null) :
    typeof observation.turnKey === 'string' ? observation.turnKey.slice(0,160) : null;
  if (previous?.status === finalStatus && previous.readState === readState &&
      previous.turnKey === turnKey && now - previous.at < (finalStatus === 'running' ? 20000 : 300000))
    return previous;
  const changedStatus = status && status !== previous?.status;
  return {
    status: finalStatus, readState, at: now,
    verifiedAt: observation.kind === 'submit' ? 0 :
      (status ? now : previous?.verifiedAt || 0),
    turnKey,
    source: status ? (sidebar ? 'sidebar' : observation.kind === 'submit' ? 'submit' : 'native') :
      previous?.source || 'sidebar'
  };
}
export function retryDecision({failure, snapshot, budget, busy = false, now = Date.now()}) {
  if (busy) return {allow:false, reason:'workflow_busy'};
  if (!failure || !['transient_http','transient_network'].includes(failure.kind)) return {allow:false, reason:failure?.kind || 'no_network_evidence'};
  if (now - failure.at > 45000 || now < failure.at) return {allow:false, reason:'old_failure'};
  if (!snapshot || snapshot.id !== failure.id || !snapshot.loadError || !snapshot.visible) return {allow:false, reason:'not_failed_visible_chat'};
  if (snapshot.hasDraft || snapshot.running || snapshot.waiting || snapshot.hasAnswer || snapshot.recoveryCanceled) return {allow:false, reason:'interactive_or_answer_present'};
  const attempts = budget && now - budget.windowAt < RECOVERY_WINDOW ? Number(budget.attempts) || 0 : 0;
  if (attempts >= MAX_RECOVERY_ATTEMPTS) return {allow:false, reason:'retry_budget_exhausted'};
  if (snapshot.canRetry !== true) return {allow:false, reason:'no_safe_native_retry'};
  return {allow:true, delayMs: attempts === 0 ? 1600 : 4200, attempts:attempts+1,
    windowAt:attempts ? budget.windowAt : now, reason:'retry_read_only_conversation'};
}
