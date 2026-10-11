import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStandaloneBridge,PRODUCTION_EXTENSION} from './standalone.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.resolve(process.env.BRIDGE_DATA_DIR||path.join(root,'data'));
const port=Number(process.env.BRIDGE_PORT||3211);
const extensionIds=(process.env.BRIDGE_EXTENSION_IDS||PRODUCTION_EXTENSION).split(',').filter(Boolean);
if(!Number.isInteger(port)||port<0||port>65535)throw Error('invalid_port');
let service;
try {
  service=await createStandaloneBridge({directory,extensionIds});
  const address=await service.listen(port,'127.0.0.1');
  console.log(JSON.stringify({event:'listening',version:'0.1.0',address:address.address,port:address.port,pid:process.pid}));
} catch(e) {
  console.error(JSON.stringify({event:'startup_failed',code:e.code||e.message}));
  if(service)await service.close();
  process.exitCode=1;
}
let stopping=false;
async function stop(){if(stopping||!service)return;stopping=true;await service.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
