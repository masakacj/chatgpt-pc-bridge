// Update only this project's staged runtime, while its own subscriptions are idle.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from './sources.mjs';
const port=Number(process.argv[2]||13213);
const status=await(await fetch(`http://127.0.0.1:${port}/local/status`,{signal:AbortSignal.timeout(3000)})).json();
if(status.sessions||status.pending)throw Error('bridge_sessions_not_idle');
const from=path.join(ROOT,'dist','bridge'),to=path.join(ROOT,'runtime');
const backup=path.join(ROOT,'var','rollback','runtime-'+Date.now());
await fs.mkdir(path.dirname(backup),{recursive:true});await fs.cp(to,backup,{recursive:true});
const hashes={};
// Retire the two one-off local test pages; they are not part of the product.
for(const name of ['acceptance-tools.html','acceptance-tools.js'])await fs.rm(path.join(to,'extension',name),{force:true});
for(const dir of ['extension','service']){
 for(const name of await fs.readdir(path.join(from,dir))){
  if(dir==='extension'&&name.startsWith('pc-resilience-'))continue;
  const source=path.join(from,dir,name);if(!(await fs.stat(source)).isFile())continue;
  const data=await fs.readFile(source),dest=path.join(to,dir,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest+'.tmp',data);await fs.rename(dest+'.tmp',dest);hashes[dir+'/'+name]=createHash('sha256').update(data).digest('hex');
 }
}
for(const name of ['package.json','package-lock.json']){const data=await fs.readFile(path.join(from,name));await fs.writeFile(path.join(to,name),data);hashes[name]=createHash('sha256').update(data).digest('hex');}
const version=JSON.parse(await fs.readFile(path.join(to,'package.json'),'utf8')).version;
await fs.writeFile(path.join(to,'RUNTIME_BUILD.json'),JSON.stringify({version,files:hashes},null,2));
console.log(JSON.stringify({runtimeUpdated:true,backup,files:Object.keys(hashes).length,version,orchestratorChanged:false,privateStateChanged:false}));
