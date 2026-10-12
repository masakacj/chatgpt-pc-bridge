// Extracted from Orchestrator 0.5.4. Protocol/schema and receipt semantics are retained.
// Standalone lifecycle and WebSocket transport live in standalone.js, not here.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

const digest=x=>createHash('sha256').update(x).digest('hex');
const opaque=()=>randomBytes(24).toString('base64url');
const commandID=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(x);
const fail=(code,status=409)=>Object.assign(new Error(code),{status});
async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch(e) { if(e.code==='ENOENT') return null; throw new Error('invalid_private_state',{cause:e}); }
}
export async function createMobileBridge({directory,send,isBusy=()=>false,timeoutMs=15000,now=()=>Date.now(),configureLocalApp}) {
  await fs.mkdir(directory,{recursive:true});
  const configPath=path.join(directory,'pairing.json'),journalPath=path.join(directory,'commands.json');
  let config=await readJSON(configPath);
  if(config&&!/^[A-Za-z0-9_-]{43}$/.test(config.token||'')) throw Error('invalid_pairing_file');
  if(!config) {
    config={version:1,token:randomBytes(32).toString('base64url'),createdAt:now()};
    await fs.writeFile(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
  }
  const sessions=new Map(),pending=new Map();
  let journal=(await readJSON(journalPath))||{};
  if(typeof journal!=='object'||Array.isArray(journal))throw Error('invalid_command_journal');
  for(const value of Object.values(journal)){
    if(value.state==='reserved')value.state='unknown';
    // v0.2.0 threw page_loading only before forwarding compose to the page.
    // Retain the ID/hash but report the proven zero-click result correctly.
    if(value.action==='compose'&&value.state==='unknown'&&value.result?.error==='page_loading'){
      value.state='failed';value.result={...value.result,status:'not_sent',proof:'pre_dispatch_binding_loading'};
    }
    if(value.action==='send'&&value.state==='unknown'&&value.result?.error==='send_unavailable'){
      value.state='failed';value.result={...value.result,status:'not_sent',proof:'pre_click_button_missing'};
    }
  }
  let serial=Promise.resolve();
  const lock=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p};
  async function persist(){
    await fs.writeFile(journalPath+'.tmp',JSON.stringify(journal),{mode:0o600});
    await fs.rename(journalPath+'.tmp',journalPath);
  }
  await persist();
  function rpc(action,payload={},session=null) {
    if(pending.size>=20)throw fail('busy',429);
    const requestId=opaque();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(fail('pc_result_unknown',504))},timeoutMs);
      pending.set(requestId,{resolve,reject,timer,session});
      if(!send({type:'mobile_command',requestId,action,...payload})){
        clearTimeout(timer);pending.delete(requestId);reject(fail('pc_offline',503));
      }
    });
  }
  function receive(message) {
    if(message?.type==='mobile_result') {
      const p=pending.get(message.requestId);if(!p)return true;
      clearTimeout(p.timer);pending.delete(message.requestId);
      message.ok?p.resolve(message.result):p.reject(fail(/^[a-z0-9_]{1,80}$/.test(message.error||'')?message.error:'pc_operation_failed'));
      return true;
    }
    if(message?.type==='mobile_tab_changed') {
      const s=sessions.get(message.sessionId);if(!s||!s.followTab||message.tabId!==s.tabId)return true;
      s.routeChanged=true;s.tabClosed=message.closed===true;s.bindingRevision=Math.max(s.bindingRevision||0,message.bindingRevision||0);s.snapshot=null;s.hash='';s.revision++;notify(s);return true;
    }
    if(message?.type==='mobile_snapshot') {
      const s=sessions.get(message.sessionId);
      if(!s||s.expiresAt<now()||message.tabId!==s.tabId)return true;
      const snap=message.snapshot;
      if(!snap||snap.schema!==1||typeof snap.conversationId!=='string'||!Array.isArray(snap.messages)||snap.messages.length>24)return true;
      if(s.conversationId&&s.conversationId!==snap.conversationId&&!s.followTab){s.routeChanged=true;notify(s);return true}
      if(Buffer.byteLength(JSON.stringify(snap))>600000)return true;
      if(s.followTab){if(Number.isFinite(snap.bindingRevision)&&snap.bindingRevision<(s.bindingRevision||0))return true;if(Number.isFinite(snap.bindingRevision))s.bindingRevision=snap.bindingRevision;snap.draft='';s.routeChanged=false;s.tabClosed=false;}
      s.conversationId=snap.conversationId;
      const hash=digest(JSON.stringify(snap));
      if(hash!==s.hash){s.hash=hash;s.snapshot=snap;s.revision++;s.capturedAt=now();notify(s)}
      return true;
    }
    return false;
  }
  function view(s){return {ok:true,sessionId:s.id,tabId:s.tabId,followTab:!!s.followTab,tabClosed:!!s.tabClosed,revision:s.revision,capturedAt:s.capturedAt||0,routeChanged:!!s.routeChanged,snapshot:s.snapshot||null}}
  function notify(s){for(const done of s.waiters)done();s.waiters.clear()}
  const app=express();app.disable('x-powered-by');
  if(configureLocalApp)configureLocalApp(app,()=>config.token);
  app.use((req,res,next)=>{
    res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
    if(req.headers.origin)return res.status(403).json({error:'browser_origin_not_allowed'});
    const given=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1]||'';
    if(!given||!timingSafeEqual(Buffer.from(given),Buffer.from(config.token)))return res.status(401).json({error:'pairing_required'});
    next();
  });
  app.use(express.json({limit:'128kb'}));
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  function get(req){const s=sessions.get(req.params.id);if(!s||s.expiresAt<now())throw fail('session_expired',410);return s}
  function touch(s){s.expiresAt=now()+90000;send({type:'mobile_command',action:'renew',sessionId:s.id,tabId:s.tabId,expiresAt:s.expiresAt})}
  app.get('/v1/health',(_req,res)=>res.json({ok:true,protocol:1,mode:'structured-pc',sessions:sessions.size,capabilities:['shared-tab-v1','compose-on-send','local-phone-drafts','official-search','new-chat','project-new-chat']}));
  app.get('/v1/tabs',wrap(async(req,res)=>res.json({ok:true,...await rpc(req.query.shared==='1'?'shared_list':'list')})));
  app.get('/v1/library',wrap(async(req,res)=>{
    const tabId=req.query.tabId===undefined?undefined:Number(req.query.tabId);
    if(tabId!==undefined&&(!Number.isInteger(tabId)||tabId<0))throw fail('invalid_tab',400);
    res.json({ok:true,...await rpc('catalog',{tabId})});
  }));
  app.post('/v1/library/actions',wrap(async(req,res)=>{
    const b=req.body;
    if(!Number.isInteger(b?.tabId)||b.tabId<0||!['open','project'].includes(b.action)||!commandID(b.commandId))throw fail('invalid_command',400);
    if(isBusy())throw fail('workflow_busy');
    if(b.action==='open'&&!/^[A-Za-z0-9_-]{12,80}$/.test(b.conversationId||''))throw fail('invalid_conversation',400);
    if(b.action==='project'&&!/^g-p-[A-Za-z0-9_-]{12,100}$/.test(b.projectId||''))throw fail('invalid_project',400);
    const result=await rpc(b.action,{tabId:b.tabId,conversationId:b.conversationId,projectId:b.projectId,more:b.more===true,preserveSource:b.preserveSource===true,deadline:now()+10000});
    res.json({ok:true,...result});
  }));
  app.post('/v1/sessions',wrap(async(req,res)=>{
    const tabId=req.body?.tabId;if(!Number.isInteger(tabId)||tabId<0)throw fail('invalid_tab',400);
    const clientId=typeof req.body?.clientId==='string'&&commandID(req.body.clientId)?req.body.clientId:null;
    const live=[...sessions.values()].find(s=>s.tabId===tabId&&s.expiresAt>now());
    if(live){
      if(clientId&&live.clientId===clientId&&live.readOnly===(req.body?.readOnly===true)&&!!live.followTab===(req.body?.followTab===true)&&!live.routeChanged){
        touch(live);const fresh=await rpc('refresh',{sessionId:live.id,tabId,conversationId:live.conversationId},live);
        if(fresh?.snapshot)receive({type:'mobile_snapshot',sessionId:live.id,tabId,snapshot:fresh.snapshot});
        return res.json(view(live));
      }
      throw fail('tab_already_paired');
    }
    if(sessions.size>=4)throw fail('session_limit',429);
    const id=opaque(),s={id,tabId,clientId,revision:0,expiresAt:now()+90000,waiters:new Set(),readOnly:req.body?.readOnly===true,followTab:req.body?.followTab===true};sessions.set(id,s);
    try{const result=await rpc('subscribe',{sessionId:id,tabId,expiresAt:s.expiresAt,readOnly:s.readOnly,followTab:s.followTab});
      if(result?.snapshot)receive({type:'mobile_snapshot',sessionId:id,tabId,snapshot:result.snapshot});
      res.json(view(s));
    }catch(e){sessions.delete(id);throw e}
  }));
  app.get('/v1/sessions/:id',wrap(async(req,res)=>{
    const s=get(req);touch(s);
    if(s.followTab&&s.needsAttach&&!s.tabClosed){const result=await rpc('subscribe',{sessionId:s.id,tabId:s.tabId,followTab:true,readOnly:s.readOnly,expiresAt:s.expiresAt},s);if(result?.snapshot)receive({type:'mobile_snapshot',sessionId:s.id,tabId:s.tabId,snapshot:result.snapshot});s.needsAttach=false;}
    if(req.query.refresh==='1'){
      if(s.routeChanged)throw fail('pc_route_changed');
      const result=await rpc('refresh',{sessionId:s.id,tabId:s.tabId,conversationId:s.conversationId},s);
      if(result?.snapshot)receive({type:'mobile_snapshot',sessionId:s.id,tabId:s.tabId,snapshot:result.snapshot});
      return res.json(view(s));
    }
    const after=Number(req.query.after);
    if(s.revision!==after||s.routeChanged)return res.json(view(s));
    if(s.waiters.size>=2)throw fail('too_many_waiters',429);
    await new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);s.waiters.delete(finish);resolve()};
      const timer=setTimeout(finish,20000);s.waiters.add(finish);res.on('close',finish);
    });
    if(!res.destroyed)res.json(view(s));
  }));
  app.delete('/v1/sessions/:id',wrap(async(req,res)=>{
    const s=get(req);sessions.delete(s.id);send({type:'mobile_command',action:'unsubscribe',sessionId:s.id,tabId:s.tabId});notify(s);res.json({ok:true});
  }));
  app.get('/v1/sessions/:id/history',wrap(async(req,res)=>{
    const s=get(req);if(s.routeChanged)throw fail('pc_route_changed');
    const before=String(req.query.before||''),documentId=String(req.query.documentId||'');
    if(!before||before.length>200||!documentId||documentId.length>100)throw fail('invalid_history_cursor',400);
    touch(s);
    const result=await rpc('history',{sessionId:s.id,tabId:s.tabId,conversationId:s.conversationId,documentId,before,deadline:now()+10000},s);
    res.json({ok:true,...result});
  }));
  app.post('/v1/sessions/:id/actions',wrap(async(req,res)=>{
    const s=get(req),b=req.body;
    if(!s.followTab||!commandID(b?.commandId)||!['catalog','search','open','new','project'].includes(b.action))throw fail('invalid_command',400);
    if(s.tabClosed)throw fail('tab_closed');
    if(s.readOnly&&['open','new','project'].includes(b.action))throw fail('read_only');
    if(['open','new','project'].includes(b.action)&&(typeof b.documentId!=='string'||b.documentId!==s.snapshot?.documentId))throw fail('pc_route_changed');
    if(b.action==='search'&&(typeof b.query!=='string'||!b.query.trim()||b.query.length>200))throw fail('invalid_query',400);
    if(b.action==='open'&&!/^[A-Za-z0-9_-]{12,80}$/.test(b.targetConversationId||''))throw fail('invalid_conversation',400);
    if(b.projectId&&!/^g-p-[A-Za-z0-9_-]{12,100}$/.test(b.projectId))throw fail('invalid_project',400);
    touch(s);
    const result=await rpc(b.action,{sessionId:s.id,tabId:s.tabId,commandId:b.commandId,documentId:b.documentId,conversationId:s.conversationId||'',targetConversationId:b.targetConversationId,projectId:b.projectId,query:b.query,more:b.more===true,deadline:now()+10000},s);
    if(result?.snapshot)receive({type:'mobile_snapshot',sessionId:s.id,tabId:s.tabId,snapshot:result.snapshot});
    res.json({ok:true,...result});
  }));
  app.post('/v1/sessions/:id/commands',wrap(async(req,res)=>{
    const s=get(req),b=req.body;
    if(s.readOnly)throw fail('read_only');
    if(s.routeChanged)throw fail('pc_route_changed');
    if(!commandID(b?.commandId)||!['draft','send','interact','compose'].includes(b.action)||typeof b.documentId!=='string')throw fail('invalid_command',400);
    if(b.action==='compose'&&!s.followTab)throw fail('shared_session_required',400);
    if(b.action==='interact'){
      if(!commandID(b.interactionId)||!commandID(b.interactionRevision)||b.confirmed!==true)throw fail('interaction_confirmation_required',400);
    }else if(typeof b.baseDraftHash!=='string'||typeof b.text!=='string'||b.text.length>16000)throw fail('invalid_command',400);
    if(['send','compose'].includes(b.action)&&!b.text.trim())throw fail('empty_message',400);
    const key=b.commandId;
    const hash=digest(JSON.stringify({sessionId:s.id,action:b.action,text:b.text,documentId:b.documentId,baseDraftHash:b.baseDraftHash,interactionId:b.interactionId,interactionRevision:b.interactionRevision,confirmed:b.confirmed,...(b.action==='compose'?{projectId:b.projectId||null}: {})}));
    let cached=await lock(async()=>{
      if(journal[key]){if(journal[key].hash!==hash)throw fail('command_id_conflict');return journal[key]}
      if(isBusy()&&b.action!=='interact')throw fail('workflow_busy');
      if(Object.keys(journal).length>=10000)throw fail('command_journal_full',503);
      journal[key]={hash,at:now(),state:'reserved',action:b.action};await persist();return null;
    });
    if(cached)return res.json({ok:cached.state==='done',commandId:key,state:cached.state,result:cached.result||null});
    touch(s);
    try{
      const result=await rpc(b.action,{sessionId:s.id,tabId:s.tabId,conversationId:s.conversationId,commandId:key,documentId:b.documentId,baseDraftHash:b.baseDraftHash,text:b.text,projectId:b.projectId||null,interactionId:b.interactionId,interactionRevision:b.interactionRevision,confirmed:b.confirmed,deadline:now()+Math.min(10000,timeoutMs)},s);
      const state=['not_sent','not_acted'].includes(result?.status)?'failed':'done';
      await lock(async()=>{journal[key]={...journal[key],state,result};await persist()});
      res.json({ok:state==='done',commandId:key,state,result});
    }catch(e){
      await lock(async()=>{journal[key]={...journal[key],state:['send','interact','compose'].includes(b.action)||e.status===504?'unknown':'failed',result:{error:e.message}};await persist()});
      throw e;
    }
  }));
  app.get('/v1/commands/:id',(req,res)=>{
    const c=journal[req.params.id];if(!c)return res.status(404).json({error:'unknown_command'});
    res.json({ok:true,commandId:req.params.id,state:c.state,result:c.result||null});
  });
  app.use((_req,res)=>res.status(404).json({error:'not_found'}));
  app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.status?e.message:'internal_error'}));
  const server=http.createServer(app);
  const sweeper=setInterval(()=>{
    for(const s of sessions.values())if(s.expiresAt<now()){sessions.delete(s.id);send({type:'mobile_command',action:'unsubscribe',sessionId:s.id,tabId:s.tabId});notify(s)}
  },30000);sweeper.unref();
  return {
    app,server,receive,setup:()=>({protocol:1,token:config.token,port:3211,security:'HTTPS reverse proxy required outside loopback'}),
    stats:()=>({sessions:sessions.size,pending:pending.size,journalCount:Object.keys(journal).length}),
    // Old documents cannot receive commands after a worker/transport replacement.
    disconnected:()=>{for(const s of sessions.values()){s.routeChanged=true;s.needsAttach=!!s.followTab;if(s.followTab){s.snapshot=null;s.hash='';s.revision++;}notify(s)}}, 
    listen:(port=3211,host='127.0.0.1')=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve(server.address()))}),
    close:async()=>{clearInterval(sweeper);for(const p of pending.values()){clearTimeout(p.timer);p.reject(fail('shutdown',503))}for(const s of sessions.values())notify(s);server.closeAllConnections();await new Promise(r=>server.close(r))}
  };
}
