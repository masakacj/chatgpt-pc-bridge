import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ROOT} from './sources.mjs';
const root=path.join(ROOT,'dist','bridge');
let checked=0;
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else if(/\.(mjs|js)$/.test(f)){execFileSync(process.execPath,['--check',f],{stdio:'pipe'});checked++;}}}
await walk(root);
const m=JSON.parse(await fs.readFile(path.join(root,'extension','manifest.json'),'utf8'));
assert.equal(m.version,JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
for(const f of [m.background.service_worker,m.options_page,...(m.content_scripts||[]).flatMap(c=>c.js)])await fs.access(path.join(root,'extension',f));
for(const f of ['extension/background.js','extension/bridge-connection.js','service/standalone.js','service/server.js'])assert(!(await fs.readFile(path.join(root,f),'utf8')).includes('3210/executor'));
for(const f of ['pairing.json','commands.json','extension-auth.json']){try{await fs.access(path.join(root,'data',f));assert.fail('private_data_in_build')}catch(e){if(e.code!=='ENOENT')throw e}}
console.log(JSON.stringify({pass:true,javascriptFiles:checked,standaloneTransport:true,privateRuntimeFilesPackaged:false}));
