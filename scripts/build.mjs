// A normal build: only dist/ artifacts are written; project source stays untouched.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,sources} from './sources.mjs';
const output=path.join(ROOT,'dist','bridge');
const inventory=await sources();
await fs.rm(output,{recursive:true,force:true});
for(const [name,data]of inventory){
  const target=path.join(output,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);
}
const hashes=Object.fromEntries([...inventory].map(([p,b])=>[p,createHash('sha256').update(b).digest('hex')]));
await fs.writeFile(path.join(output,'BUILD.json'),JSON.stringify({version:'0.1.0',files:hashes},null,2));
console.log(JSON.stringify({event:'built',version:'0.1.0',files:inventory.size,output}));
