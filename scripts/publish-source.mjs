// Optional source publisher on a host with an already authenticated GitHub CLI.
// No credential extraction, token copying, runtime-data access or forced ref updates.
import {execFileSync} from 'node:child_process';
import {sources} from './sources.mjs';
const repo='masakacj/chatgpt-pc-bridge';
function api(endpoint,method='GET',body){
 const args=['api',endpoint,'--method',method];if(body)args.push('--input','-');
 try{return JSON.parse(execFileSync('gh',args,{encoding:'utf8',input:body?JSON.stringify(body):undefined,stdio:['pipe','pipe','pipe'],timeout:60000}));}
 catch{throw Error('authenticated_github_cli_required_or_request_failed');}
}
const info=api('repos/'+repo),branch=info.default_branch||'main';
const ref=api('repos/'+repo+'/git/ref/heads/'+branch);
const parent=api('repos/'+repo+'/git/commits/'+ref.object.sha);
const inventory=await sources();
const tree=api('repos/'+repo+'/git/trees','POST',{base_tree:parent.tree.sha,tree:[...inventory].map(([p,b])=>({path:p,mode:'100644',type:'blob',content:b.toString('utf8')}))});
if(tree.sha===parent.tree.sha)console.log(JSON.stringify({repository:repo,branch,unchanged:true,commit:ref.object.sha}));
else{
 const commit=api('repos/'+repo+'/git/commits','POST',{message:process.argv.slice(2).join(' ')||'feat: extract independently tested PC Bridge source',tree:tree.sha,parents:[ref.object.sha]});
 api('repos/'+repo+'/git/refs/heads/'+branch,'PATCH',{sha:commit.sha,force:false});
 console.log(JSON.stringify({repository:repo,branch,commit:commit.sha,files:inventory.size}));
}
