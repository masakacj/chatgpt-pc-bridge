import {startMobileStructure} from './mobile-structure-background.js';
import {startSharedBridge} from './shared-background.js';
import {startBridgeConnection} from './bridge-connection.js';

// Bridge only. The original Orchestrator executor and PC resilience stay in
// their own extension; this extension does not load duplicate status observers.
let connection;
const send=message=>connection?.send(message)===true;
const legacy=startMobileStructure({send});
const shared=startSharedBridge({send});
connection=startBridgeConnection({handle:message=>shared.handle(message)||legacy.handle(message),disconnected:()=>{shared.disconnected();legacy.disconnected();}});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('options.html'))return;
  if(message?.type==='bridge_audit')reply({version:chrome.runtime.getManifest().version,...connection.audit(),mobile:shared.audit()});
});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
