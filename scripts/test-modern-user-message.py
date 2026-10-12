"""Run the real shared-tab MV3 suite against the observed roleless user bubble.
All bodies are synthetic. This changes fixture HTML in memory, never project code.
"""
from pathlib import Path
import importlib.util

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('modern_shared_fixture',ROOT/'scripts/test-shared-tab.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

# Observed structure: group/user-message -> bg-user-message.text-user-message
# -> nested wrappers -> .text-size-chat.whitespace-pre-wrap. Toolbar is outside
# the bubble. There is no user role attribute and no data-message-id.
ADAPTER=r'''
function modernizeUsers(){
 for(const user of document.querySelectorAll('[data-message-author-role="user"]')){
  const outer=document.createElement('div');outer.className='group/user-message flex flex-col items-end gap-2';
  const group=document.createElement('div');group.className='group/user-message flex w-full flex-col gap-1 items-end';
  const bubble=document.createElement('div');bubble.className='bg-user-message text-user-message rounded-2xl relative text-start';
  const content=document.createElement('div');content.className='text-size-chat whitespace-pre-wrap';content.textContent=user.textContent;
  const wrapper=document.createElement('div');wrapper.append(content);bubble.append(wrapper);group.append(bubble);
  const tools=document.createElement('div');tools.innerHTML='<button type="button">Copy user message</button><button type="button">Edit message</button>';group.append(tools);
  outer.append(group);user.replaceWith(outer);
 }
 window.modernUserFixture=true;
}
const priorShow=show;show=function(path){priorShow(path);modernizeUsers()};
const priorSend=sendMessage;sendMessage=function(){priorSend();modernizeUsers()};
'''
assert fixture.HTML.count('show(location.pathname);')==1
fixture.HTML=fixture.HTML.replace('show(location.pathname);',ADAPTER+'\nshow(location.pathname);')
# A hidden old ProseMirror appears first in DOM on the current official home.
fixture.HTML=fixture.HTML.replace('<main>','<div hidden><div id="prompt-textarea" class="ProseMirror" contenteditable="true" data-hidden-old-editor="1">HIDDEN_PC_DRAFT_MUST_STAY</div><button type="button">Hidden send</button></div><main>',1)
fixture.HTML=fixture.HTML.replace('class="transcriptContent"','class="transcriptContent live-fixture"')
fixture.HTML=fixture.HTML.replace("document.querySelector('.transcriptContent')","document.querySelector('.transcriptContent.live-fixture')")
fixture.HTML=fixture.HTML.replace('<main>','<main><section hidden><div class="transcriptContent"><div data-turn-key="cached-old-turn" data-talvt-turn-state="complete"><div data-message-author-role="user">STALE_CACHED_CHAT_MUST_NOT_MIRROR</div><div data-message-author-role="assistant">STALE_CACHED_ANSWER</div></div></div></section>',1)
if __name__=='__main__':fixture.run()
