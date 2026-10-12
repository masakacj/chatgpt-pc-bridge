"""Exercise search-modal accessibility, empty and paginated results with the actual Bridge."""
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('shared',ROOT/'scripts/test-shared-tab.py')
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
EXTRA=r'''
window.searchBoundaryFixture=true;
function closeSearch(){document.querySelector('[role=dialog]')?.remove();document.querySelector('main').removeAttribute('aria-hidden');}
const oldShow=show;show=path=>{closeSearch();oldShow(path)};
searchOpen=()=>{
 if(document.querySelector('[role=dialog]'))return;
 const d=document.createElement('section');d.setAttribute('role','dialog');
 d.innerHTML='<button aria-label="Close search">Close</button><input role="combobox" placeholder="Search chats"><div class="results"></div>';
 d.querySelector('button').onclick=closeSearch;d.onkeydown=e=>{if(e.key==='Escape')closeSearch()};
 const output=d.querySelector('.results');let pending;
 const links=(extra=false)=>{output.innerHTML='<a href="/c/22222222-2222-4222-8222-222222222222">Older chat outside sidebar</a>'+(extra?'<a href="/c/33333333-3333-4333-8333-333333333333">Second page</a>':'');for(const a of output.querySelectorAll('a'))a.onclick=e=>{e.preventDefault();show(a.pathname)}};
 d.querySelector('input').oninput=e=>{
  clearTimeout(pending);output.setAttribute('aria-busy','true');const q=e.target.value;
  pending=setTimeout(()=>{
   output.removeAttribute('aria-busy');
   if(q.startsWith('NO_RESULT')){output.textContent='No results';return;}
   links(q!=='PAGINATED');
   if(q==='PAGINATED'){const more=document.createElement('button');more.textContent='Load more';more.onclick=()=>{output.setAttribute('aria-busy','true');setTimeout(()=>{output.removeAttribute('aria-busy');links(true)},250)};output.append(more)}
  },300);
 };
 document.querySelector('main').setAttribute('aria-hidden','true');document.body.append(d);
};
'''
shared.HTML=shared.HTML.replace('</script></body></html>',EXTRA+'\n</script></body></html>')
if __name__=='__main__':shared.run()
