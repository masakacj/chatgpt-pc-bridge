const form=document.querySelector('#config'),status=document.querySelector('#status');
document.querySelector('#extension').textContent=chrome.runtime.id;
chrome.storage.local.get('bridgeConnection').then(({bridgeConnection:c})=>{if(c){form.url.value=c.url;form.token.value=c.token;}});
async function refresh(){
  const state=await chrome.runtime.sendMessage({type:'bridge_audit'});
  status.textContent=state?.ready?'已连接独立 Bridge Service':('未连接：'+(state?.lastError||'连接中'));
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const u=new URL(form.url.value.trim()),token=form.token.value.trim();
    if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.pathname!=='/bridge'||!u.port||u.search||u.hash||u.username||u.password)throw Error('仅支持本机 ws://127.0.0.1:端口/bridge');
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('扩展连接密钥格式不正确');
    await chrome.storage.local.set({bridgeConnection:{url:u.href,token}});
    status.textContent='连接中';setTimeout(refresh,800);
  }catch(e){status.textContent=e.message;}
});
document.querySelector('#refresh').onclick=refresh;
refresh();
