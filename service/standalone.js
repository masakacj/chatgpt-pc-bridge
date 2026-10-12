import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {createMobileBridge} from './mobile-bridge.js';
import {installLocalPairing} from './local-pairing.js';

export const VERSION='0.2.3';
export const PRODUCTION_EXTENSION='heamldipoecpedbnoffiaadjkdagbmoc';
const local=address=>address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';
const sameKey=(a,b)=>typeof a==='string'&&/^[A-Za-z0-9_-]{43}$/.test(a)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

/** The only dependency is the Chrome extension; no import/request to Orchestrator. */
export async function createStandaloneBridge({directory,extensionIds=[PRODUCTION_EXTENSION],timeoutMs=15000}) {
  if(!extensionIds.length||extensionIds.some(id=>!/^[a-p]{32}$/.test(id))) throw Error('invalid_extension_ids');
  await fs.mkdir(directory,{recursive:true});
  const ipcPath=path.join(directory,'extension-auth.json');
  let ipc;
  try { ipc=JSON.parse(await fs.readFile(ipcPath,'utf8')); }
  catch(e) { if(e.code!=='ENOENT')throw Error('invalid_extension_auth'); }
  if(!ipc){ipc={token:randomBytes(32).toString('base64url')};await fs.writeFile(ipcPath,JSON.stringify(ipc),{mode:0o600,flag:'wx'});}
  if(!/^[A-Za-z0-9_-]{43}$/.test(ipc.token||''))throw Error('invalid_extension_auth');

  let peer=null,peerMeta=null,closing=false;
  const bridge=await createMobileBridge({directory,timeoutMs,
    configureLocalApp:(app,getToken)=>installLocalPairing(app,getToken,()=>({ok:true,pid:process.pid,version:VERSION,extensionConnected:peer?.readyState===WebSocket.OPEN,extension:peerMeta,...bridge.stats()})),
    send:message=>{if(peer?.readyState!==WebSocket.OPEN)return false;peer.send(JSON.stringify(message));return true;}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:650000});
  const origins=new Set(extensionIds.map(id=>'chrome-extension://'+id));
  bridge.server.on('upgrade',(req,socket,head)=>{
    // Phone/NPM callers cannot impersonate an extension, even with the phone key.
    if(req.url!=='/bridge'||!local(req.socket.remoteAddress)||!origins.has(req.headers.origin)){
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
    }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',(ws,req)=>{
    let authenticated=false;
    const deadline=setTimeout(()=>ws.close(1008,'handshake_required'),3000);
    ws.on('error',()=>{});
    ws.on('message',raw=>{
      let msg;try{msg=JSON.parse(raw);}catch{ws.close(1008,'invalid_message');return;}
      if(!authenticated){
        if(msg?.type!=='bridge_hello'||msg.protocol!==1||!sameKey(msg.token,ipc.token)){
          ws.close(1008,'authentication_failed');return;
        }
        if(peer&&peer.readyState===WebSocket.OPEN){ws.close(1008,'extension_already_connected');return;}
        authenticated=true;clearTimeout(deadline);peer=ws;
        peerMeta={extensionId:req.headers.origin.slice(19),version:String(msg.version||'').slice(0,40),connectedAt:Date.now()};
        ws.send(JSON.stringify({type:'bridge_ready',protocol:1,serviceVersion:VERSION}));return;
      }
      if(ws!==peer)return;
      if(msg.type==='bridge_ping'){ws.send(JSON.stringify({type:'bridge_pong'}));return;}
      if(['mobile_result','mobile_snapshot','mobile_tab_changed'].includes(msg.type))bridge.receive(msg);
    });
    ws.on('close',()=>{clearTimeout(deadline);if(peer===ws){peer=null;peerMeta=null;if(!closing)bridge.disconnected();}});
  });
  return {
    ...bridge,
    health:()=>({version:VERSION,extensionConnected:peer?.readyState===WebSocket.OPEN,extension:peerMeta,...bridge.stats()}),
    close:async()=>{closing=true;for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await bridge.close();}
  };
}
