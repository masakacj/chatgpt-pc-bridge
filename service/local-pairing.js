import express from 'express';

const HTML=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatGPT PC Bridge 配对</title><link rel="stylesheet" href="/local/pair.css"><main><h1>ChatGPT PC Bridge</h1><p>手机与选定的 PC ChatGPT 标签页共用对话。此配对页仅能在本机打开。</p><label>手机服务地址<input readonly value="https://chatgpt-pc.781751.xyz:58443"></label><button id="reveal">显示手机配对密钥</button><label>手机配对密钥<input id="key" readonly type="password" autocomplete="off"></label><button id="copy" disabled>复制密钥</button><p id="status" role="status">点击后，将密钥填入 iOS 客户端的连接设置。</p><p>原编排器继续独立运行。手机输入只在点击发送后提交，不会回填 PC 草稿。</p></main><script src="/local/pair.js"></script></html>`;
const CSS=':root{color-scheme:light dark;font:16px system-ui}main{max-width:650px;margin:48px auto;padding:20px}p{line-height:1.6;opacity:.8}label{display:block;margin:20px 0}input{box-sizing:border-box;width:100%;padding:12px;margin-top:8px;font:inherit;border:1px solid #888;border-radius:8px}button{padding:10px 16px;margin-right:8px;font:inherit;border:1px solid #888;border-radius:8px;cursor:pointer}';
const JS="const key=document.querySelector('#key'),status=document.querySelector('#status'),copy=document.querySelector('#copy');document.querySelector('#reveal').onclick=async()=>{try{const r=await fetch('/local/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reveal:true})});if(!r.ok)throw Error('配对信息读取失败');const j=await r.json();key.value=j.token;key.type='text';copy.disabled=false;status.textContent='仅向你自己的设备提供此密钥。';}catch(e){status.textContent=e.message;}};copy.onclick=async()=>{try{await navigator.clipboard.writeText(key.value);status.textContent='已复制';}catch{key.select();document.execCommand('copy');status.textContent='已复制';}};";

/** Adds only explicit, same-origin loopback pairing. Public proxy still allows /v1/ only. */
export function installLocalPairing(app, getToken, getStatus=()=>({ok:true})) {
 const local=(req,res,next)=>{
  const address=req.socket.remoteAddress||'',host=req.headers.host||'',port=req.socket.localPort;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)||![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return res.status(403).json({error:'local_pairing_only'});
  res.set('Cache-Control','no-store');res.set('X-Frame-Options','DENY');res.set('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  next();
 };
 app.get('/local/status',local,(_req,res)=>res.json(getStatus()));
 app.get('/local/pair',local,(_req,res)=>res.type('html').send(HTML));
 app.get('/local/pair.js',local,(_req,res)=>res.type('js').send(JS));
 app.get('/local/pair.css',local,(_req,res)=>res.type('css').send(CSS));
 app.post('/local/setup',local,express.json({limit:'2kb'}),(req,res)=>{
  if(req.headers.origin!==`http://${req.headers.host}`||req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'same_origin_required'});
  if(req.body?.reveal!==true)return res.status(400).json({error:'explicit_reveal_required'});
  res.json({protocol:1,token:getToken()});
 });
}
