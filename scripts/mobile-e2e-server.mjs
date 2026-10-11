// Isolated test server, NOT a second production workflow.
import {WebSocketServer} from 'ws';
import {createMobileBridge} from '../src/mobile-bridge.js';
const wss=new WebSocketServer({host:'127.0.0.1',port:0});
await new Promise(r=>wss.once('listening',r));let peer;
const bridge=await createMobileBridge({directory:process.argv[2],send:msg=>{if(peer?.readyState===1){peer.send(JSON.stringify(msg));return true}return false},timeoutMs:10000});
wss.on('connection',ws=>{peer=ws;ws.on('message',data=>{try{bridge.receive(JSON.parse(data))}catch{}})});
const a=await bridge.listen(0);
// Printed only into the private subprocess pipe consumed by the test harness.
console.log(JSON.stringify({port:a.port,wsPort:wss.address().port,token:bridge.setup().token}));
process.on('SIGTERM',async()=>{await bridge.close();wss.close();process.exit(0)});
