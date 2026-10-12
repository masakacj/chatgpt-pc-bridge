// On-demand maintenance resource; no polling, login access or user-tab reload.
// This optional office deployment helper is NOT the Bridge runtime transport.
(() => {
  const controller='hkpkilpjbeneliaiafdbkaomedgkkcmi';
  const bootId=crypto.randomUUID();
  globalThis.backgroundReloadBootId=bootId;
  const notify=message=>chrome.runtime.sendMessage(controller,message);
  if(typeof document!=='undefined') {
    const nonce=location.hash.slice(1);
    if(!/^[0-9a-f-]{36}$/.test(nonce))return;
    void (async()=>{
      try {
        const ready=await notify({type:'BACKGROUND_RELOAD_READY',nonce,version:chrome.runtime.getManifest().version});
        if(!ready?.ok)throw Error(ready?.error||'maintenance_not_authorized');
        let prepared;
        try {prepared=await chrome.runtime.sendMessage({type:'BACKGROUND_RELOAD_PREPARE'});}catch (_){}
        if(!prepared?.ok) {
          // One-time upgrade of the explicitly allowlisted pre-maintenance version.
          // Never bypass an actual busy response or use this for same-version reloads.
          if(prepared||!ready.bootstrap)throw Error(prepared?.error||'maintenance_handler_not_installed');
        }
        const commit=await notify({type:'BACKGROUND_RELOAD_COMMIT',nonce,bootId:prepared?.bootId||null});
        if(!commit?.ok)throw Error(commit?.error||'maintenance_not_authorized');
        chrome.runtime.reload();
      } catch(error) {
        await chrome.runtime.sendMessage({type:'BACKGROUND_RELOAD_CANCEL'}).catch(()=>{});
        await notify({type:'BACKGROUND_RELOAD_FAILED',nonce,error:String(error.message||error)}).catch(()=>{});
      }
    })();
    return;
  }
  // Only a NEW worker can complete the two-phase handshake. A repeated reload
  // of the same version is distinguished by its fresh worker boot id.
  // Chrome may close extension-owned tabs as part of runtime.reload(). The
  // controller retains the operation; only this exact worker URL can confirm it.
  void notify({type:'BACKGROUND_RELOAD_COMPLETE',bootId,version:chrome.runtime.getManifest().version}).catch(()=>{});
})();
