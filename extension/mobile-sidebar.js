// Official DOM adapter; functions stay self-contained for executeScript.
export function readSidebar() {
  const nav=[...document.querySelectorAll('aside,nav,[data-testid="sidebar"]')].find(n=>n.querySelector('a[href*="/c/"],[data-app-action-sidebar-project-id]'));
  const chats=new Map(),projects=new Map();
  const projectSel='[data-app-action-sidebar-project-id]';
  const more=b=>/^(?:展开显示|显示更多|加载更多|Show more|Load more)$/i.test((b.textContent||'').trim());
  if(!nav)return {projects:[],chats:[],partial:true,sidebarAvailable:false};
  for(const row of [...nav.querySelectorAll(projectSel)].slice(0,150)){
    const id=row.getAttribute('data-app-action-sidebar-project-id');if(!/^g-p-[A-Za-z0-9_-]{12,100}$/.test(id||''))continue;
    projects.set(id,{id,title:(row.getAttribute('data-app-action-sidebar-project-label')||row.textContent||'项目').trim().slice(0,160),
      collapsed:row.getAttribute('data-app-action-sidebar-project-collapsed')==='true'||row.getAttribute('aria-expanded')==='false',
      hasMore:[...row.parentElement.querySelectorAll('button')].some(more)});
  }
  for(const a of [...nav.querySelectorAll('a[href]')].slice(0,600)){
    let u;try{u=new URL(a.href,location.origin)}catch{continue}
    if(u.origin!=='https://chatgpt.com')continue;
    const m=u.pathname.match(/^(?:\/g\/(g-p-[A-Za-z0-9_-]+))?\/c\/([A-Za-z0-9_-]{12,80})\/?$/);
    if(!m)continue;
    const id=m[2],projectId=m[1]||null;
    if(chats.has(id))continue;
    if(projectId&&!projects.has(projectId))projects.set(projectId,{id:projectId,title:'其他项目',collapsed:false,hasMore:false});
    chats.set(id,{id,title:(a.textContent||'未命名对话').trim().slice(0,180),projectId,path:u.pathname,current:a.getAttribute('aria-current')==='page'});
  }
  return {projects:[...projects.values()],chats:[...chats.values()],partial:true,sidebarAvailable:true};
}
export async function expandSidebarProject(request) {
  const nav=[...document.querySelectorAll('aside,nav,[data-testid="sidebar"]')].find(n=>n.querySelector('[data-app-action-sidebar-project-id]'));
  const row=nav&&[...nav.querySelectorAll('[data-app-action-sidebar-project-id]')].find(n=>n.getAttribute('data-app-action-sidebar-project-id')===request.projectId);
  if(!row)return {ok:false,error:'project_not_visible'};
  const closed=row.getAttribute('aria-expanded')==='false'||row.getAttribute('data-app-action-sidebar-project-collapsed')==='true';
  if(closed)row.click();
  else if(request.more){
    const button=[...row.parentElement.querySelectorAll('button')].find(b=>!b.disabled&&/^(?:展开显示|显示更多|加载更多|Show more|Load more)$/i.test((b.textContent||'').trim()));
    if(!button)return {ok:false,error:'no_more_visible'};
    button.click();
  }
  await new Promise(r=>setTimeout(r,650));
  return {ok:true};
}
export function openSidebarChat(request) {
  const nav=[...document.querySelectorAll('aside,nav,[data-testid="sidebar"]')].find(n=>n.querySelector('a[href*="/c/"]'));
  if(!nav)return {ok:false,error:'sidebar_unavailable'};
  const a=[...nav.querySelectorAll('a[href]')].find(n=>{
    try{const u=new URL(n.href,location.origin);return u.origin===location.origin&&u.pathname===request.path}catch{return false}
  });
  if(!a)return {ok:false,error:'conversation_not_visible'};
  const e=document.querySelector('#prompt-textarea,textarea[name="prompt"],main [contenteditable="true"]');
  if((e?.value||e?.innerText||e?.textContent||'').trim())return {ok:false,error:'pc_draft_blocks_navigation'};
  if(document.querySelector('main [data-testid*="approval" i] button,main [data-testid*="permission" i] button'))return {ok:false,error:'pc_approval_blocks_navigation'};
  const turns=document.querySelectorAll('main [data-turn-key]');
  const oldKey=turns[turns.length-1]?.getAttribute('data-turn-key')||null;
  globalThis.__ORCH_MOBILE_NAV_GUARD__={to:request.conversationId,oldKey,at:Date.now()};
  a.click();return {ok:true};
}
