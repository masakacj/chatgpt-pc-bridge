// Small standalone transport: one socket, one heartbeat, no command replay queue.
export function startBridgeConnection({handle,disconnected}) {
  let socket=null,ready=false,retry=null,heartbeat=null,attempt=0,lastError='not_configured';
  function send(message){if(!ready||socket?.readyState!==WebSocket.OPEN)return false;socket.send(JSON.stringify(message));return true;}
  function clear(){clearTimeout(retry);clearInterval(heartbeat);retry=null;heartbeat=null;}
  async function connect(){
    if(socket&&(socket.readyState===0||socket.readyState===1))return;
    const {bridgeConnection:config}=await chrome.storage.local.get('bridgeConnection');
    if(!config?.token)return;
    let u;try{u=new URL(config.url)}catch{lastError='invalid_url';return;}
    if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.pathname!=='/bridge'||u.search||u.hash||u.username||u.password||!u.port){lastError='invalid_url';return;}
    if(!/^[A-Za-z0-9_-]{43}$/.test(config.token)){lastError='invalid_key';return;}
    const current=new WebSocket(u.href);socket=current;ready=false;
    const helloTimer=setTimeout(()=>{if(!ready&&socket===current)current.close()},4000);
    current.onopen=()=>current.send(JSON.stringify({type:'bridge_hello',protocol:1,token:config.token,version:chrome.runtime.getManifest().version}));
    current.onmessage=e=>{
      if(socket!==current)return;
      let m;try{m=JSON.parse(e.data)}catch{return;}
      if(m.type==='bridge_ready'){
        clearTimeout(helloTimer);ready=true;attempt=0;lastError=null;
        // Chrome's documented MV3 WebSocket sample uses a 20-second heartbeat.
        clearInterval(heartbeat);heartbeat=setInterval(()=>send({type:'bridge_ping'}),20000);
      }else if(ready&&m.type==='mobile_command')handle(m);
    };
    current.onerror=()=>{lastError='service_unavailable'};
    current.onclose=e=>{
      clearTimeout(helloTimer);if(socket!==current)return;
      ready=false;socket=null;clear();disconnected();
      if(e.code===1008){lastError=e.reason||'connection_denied';return;}
      const delays=[1000,2000,4000,8000,15000];
      retry=setTimeout(connect,delays[Math.min(attempt++,delays.length-1)]);
    };
  }
  async function reconfigure(){
    clear();const old=socket;socket=null;ready=false;old?.close();disconnected();attempt=0;lastError=null;
    await connect();
  }
  chrome.alarms.onAlarm.addListener(a=>{if(a.name==='bridge-reconnect'&&!lastError?.includes('authentication'))connect()});
  chrome.runtime.onStartup.addListener(connect);
  chrome.alarms.create('bridge-reconnect',{periodInMinutes:0.5});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.bridgeConnection)reconfigure()});
  connect();
  return {send,reconfigure,audit:()=>({ready,lastError,transport:'standalone-websocket',queuedWrites:0})};
}
