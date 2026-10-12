// Build/deployment artifact staging. Never edits the Orchestrator or private data.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from './sources.mjs';
const build=path.join(ROOT,'dist','bridge'),runtime=path.join(ROOT,'runtime');
const manifest=JSON.parse(await fs.readFile(path.join(build,'extension','manifest.json'),'utf8'));
if((manifest.content_scripts||[]).some(c=>(c.js||[]).some(x=>x.includes('pc-resilience'))))throw Error('duplicate_state_registration');
const folders=['extension','service'];const files=['package.json','package-lock.json'];
const entries=[];
for(const dir of folders)for(const name of await fs.readdir(path.join(build,dir))){
 if(dir==='extension'&&name.startsWith('pc-resilience-'))continue; // Historical test fixtures are not runtime features.
 entries.push(path.posix.join(dir,name));
}
entries.push(...files);
const staged=runtime+'.stage';await fs.rm(staged,{recursive:true,force:true});await fs.mkdir(staged,{recursive:true});
const hashes={};
for(const name of entries){const source=path.join(build,name);if(!(await fs.stat(source)).isFile())continue;const bytes=await fs.readFile(source);const dest=path.join(staged,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);hashes[name]=createHash('sha256').update(bytes).digest('hex');}
await fs.writeFile(path.join(staged,'RUNTIME_BUILD.json'),JSON.stringify({version:manifest.version,files:hashes},null,2));
try{await fs.access(runtime);throw Error('runtime_exists_use_controlled_upgrade');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.rename(staged,runtime);
console.log(JSON.stringify({runtime,version:manifest.version,files:Object.keys(hashes).length,orchestratorChanged:false,privateStateCopied:false}));
