import './background-reload.js';
import {startMobileStructure} from './mobile-structure-background.js';
import {startSharedBridge} from './shared-background.js';
import {startBridgeConnection} from './bridge-connection.js';

// Bridge only. The original Orchestrator executor and PC resilience stay in
// their own extension; this extension does not load duplicate status observers.
let connection,maintenancePending=false;
const inFlightCommands=new Set();
const send=message=>{if(message.type==='mobile_result')inFlightCommands.delete(message.requestId);return connection?.send(message)===true;};
const legacy=startMobileStructure({send});
const shared=startSharedBridge({send});
connection=startBridgeConnection({handle:message=>{
  if(maintenancePending){if(message.requestId)send({type:'mobile_result',requestId:message.requestId,ok:false,error:'extension_maintenance'});return;}
  if(message.requestId)inFlightCommands.add(message.requestId);
  if(!(shared.handle(message)||legacy.handle(message)))inFlightCommands.delete(message.requestId);
},disconnected:()=>{shared.disconnected();legacy.disconnected();}});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('background-reload.html')+'#'))return;
  if(message?.type==='BACKGROUND_RELOAD_CANCEL'){maintenancePending=false;reply({ok:true});return;}
  if(message?.type!=='BACKGROUND_RELOAD_PREPARE')return;
  if(inFlightCommands.size||shared.audit().sharedSessions||legacy.audit().sessions){reply({ok:false,error:'bridge_sessions_or_commands_busy'});return;}
  maintenancePending=true;
  setTimeout(()=>{maintenancePending=false;},30000);
  reply({ok:true,bootId:globalThis.backgroundReloadBootId});
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('options.html'))return;
  if(message?.type==='bridge_audit')reply({version:chrome.runtime.getManifest().version,...connection.audit(),mobile:shared.audit(),legacy:legacy.audit()});
});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
