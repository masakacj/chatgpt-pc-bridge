// Package the allowlisted source inventory for GitHub publication; no runtime data.
import fs from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ROOT,sources} from './sources.mjs';
const entries=await sources();
const payload=Buffer.from(JSON.stringify(Object.fromEntries([...entries].map(([p,b])=>[p,b.toString('utf8')]))));
const archive=gzipSync(payload);const target=path.join(ROOT,'dist','pc-bridge-source.json.gz');
await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,archive);
console.log(JSON.stringify({file:target,bytes:archive.length,files:entries.size,sha256:createHash('sha256').update(archive).digest('hex')}));
