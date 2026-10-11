// Source inventory for a reproducible one-time extraction. Never mutates sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
const allowedRoots=['extension','service','src','test','scripts','docs','.github'];
const allowedFiles=['package.json','package-lock.json','.gitignore','README.md','AGENTS.md','source-imports.json'];
export async function sources(){
  const found=new Map();
  async function walk(dir){
    for(const entry of await fs.readdir(path.join(ROOT,dir),{withFileTypes:true}).catch(()=>[])){
      const p=path.posix.join(dir,entry.name);
      if(entry.isDirectory()&&entry.name!=='__pycache__')await walk(p);
      else if(entry.isFile()&&/\.(js|mjs|json|py|html|css|md|yml|yaml)$/.test(p))found.set(p,await fs.readFile(path.join(ROOT,p)));
    }
  }
  for(const dir of allowedRoots)await walk(dir);
  for(const name of allowedFiles){try{found.set(name,await fs.readFile(path.join(ROOT,name)))}catch(e){if(e.code!=='ENOENT')throw e}}
  const imports=JSON.parse(await fs.readFile(path.join(ROOT,'source-imports.json'),'utf8'));
  for(const [name,hash]of Object.entries(imports.files)){
    if(found.has(name))continue; // A canonical clone already includes the imported source.
    const data=await fs.readFile(path.resolve(ROOT,imports.sourceRoot,name));
    if(createHash('sha256').update(data).digest('hex')!==hash)throw Error('import_changed:'+name);
    found.set(name,data);
  }
  return new Map([...found].sort(([a],[b])=>a.localeCompare(b)));
}
