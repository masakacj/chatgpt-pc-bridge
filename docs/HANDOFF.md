# PC Bridge / Native iOS — current handoff

Updated 2026-10-12, R0/R1 implementation. Read `docs/NEXT_DEVELOPMENT_PLAN_20261012.md` for the remaining R0–R6 plan. This file supersedes the old 0.1.0 planning notes. **Bridge development version 0.2.2; production 3211 and signed iOS release are not switched.**

## Fixed scope

The SwiftUI phone app mirrors structured content/actions from one user-bound PC ChatGPT tab. Phone navigation uses that same tab, PC navigation in it updates the phone, and selecting another browser tab does not change the binding. Phone drafts are per conversation and submit only on explicit Send; PC unsent text is not echoed to the phone.

Keep the original Orchestrator executor/ID, 3210, workflow queue and PC state/recovery modules. The independent Bridge owns only mobile functionality and has its own extension ID. No executor adapter/replacement and no mandatory background reader tab.

## Current development and runtime

- mcpoffice workspace `ws_53924e782d`: `D:\workspace\py\chatgpt-pc-bridge`.
- Installed Bridge ID `heamldipoecpedbnoffiaadjkdagbmoc`, path `runtime/extension`, version 0.2.2.
- Staged independent service: `127.0.0.1:13213`; private state `var/stage`. Final production 3211 is still owned by the old mobile service.
- Source files, generated dist, installed runtime and private var are distinct. `scripts/update-staged-runtime.mjs` backs up and updates only the independent runtime at an idle boundary; it never modifies Orchestrator or pairing/journals.
- Original executor was repeatedly verified online, one v43 executor and zero workflow runs. It was not reloaded, replaced or refactored for these changes.

## R1 fixes and real evidence

1. The current official user bubble has `.bg-user-message.text-user-message` inside `group/user-message`, without a user role attribute or message ID. Added the narrowly observed selector; exclude hidden branches and toolbars. Stable per-turn/role IDs prevent a React remount of an identical old message from confirming a new Send.
2. Official SPA navigation retains hidden old composers AND hidden old transcript containers. Both editor selection and transcript selection now target the visible surface, instead of taking the first DOM match. This also prevents old messages from appearing under a new conversation ID.
3. ProseMirror paragraph boundaries are read as typed newlines. Previously `innerText` added visual blank lines and caused a false draft conflict on multiline text. Empty paragraphs are preserved; PC draft text is still not transmitted to the phone.
4. Removed the attempted tab-activation workaround after identifying hidden elements as the real issue. No automatic tab/window focus change was added to ordinary Bridge operations.
5. Search `hasMore` now derives from an actual enabled native more button or remaining scrollable content, not merely from the existence of results.

**Real official-page checks completed in owned development chats:**
- Read the old recorded test conversation: one matching user message and one assistant reply are now extracted. Its old `sent_unconfirmed` receipt was left intact; the message was never replayed.
- New multiline message in the recorded existing chat: `sent_confirmed`, one matching user message and one corresponding reply, same bound tab.
- New ordinary chat (`ordinary-visible-root` case): `sent_confirmed`, real conversation ID, one matching user message and one reply, same bound tab.
- New chat under the observed development project (`project-visible-root` case): `sent_confirmed`, correct project ID, one matching user message and one reply, same bound tab.

Earlier attempts in this iteration failed BEFORE Send while adapting the hidden composer/newline behavior; only explicitly verified `not_sent` cases were retried with new command IDs. One pre-fix ordinary-chat command was sent but returned unconfirmed while the hidden old transcript was selected; its command was not replayed. Later acceptance used separately labeled new cases. Do not clear these journal entries or relabel old unknown results without their own evidence.

The test runner's initial short reply observation can end before the model finishes; subsequent checks used receipt/snapshot GETs only. The three accepted cases above were finally verified with both roles present. Private detailed evidence is `var/stage/r1-r2-evidence.json`; never publish its complete conversation IDs or content. The fixed-string local test-draft cleanup pages were one-off development helpers and are excluded from source exports and removed from installed runtime updates.

## Tests and publication

Recorded local checks for this implementation: Node 49/49; original shared-tab MV3 13/13; observed roleless-user/hidden-composer/hidden-transcript/paragraph fixture 16/16; original-state coexistence 4/4. Re-run the final source inventory before recording a new source CI result.

Source export now includes Windows PowerShell deployment scripts and excludes var/runtime/private data. The public repository already contained the prior full extraction (`4403027299a8499989cc87b3cbd4b189ec51d168`), but that old CI does not certify this implementation. **R0 latest source publication/clean-checkout CI is being finalized; append the exact resulting commit and run below after verification.** Canonical remote files include all imported modules, so a clean clone does not need an Orchestrator directory.

## R2 and later still pending

The real official search opens and returns results, but the first broad query did not establish retrieval of a history item outside the loaded sidebar. Full-history coverage, archived/older project results, native pagination/end-of-results and additional real same-tab navigation acceptance remain open. Do not claim all history is supported from the fixture or the small live result set.

The native iOS candidate remains the previously tested branch `feature/shared-tab-native-070-20261011`, actual tested SHA `b33b1d99f9c240261ae2983ecefa583c64e2363a`, run `38153702824`: 8/8 Simulator UI, 24 draft assertions and Release device-target compile. No iOS code was changed during this PC-only repair; those are prior results, not a new run or actual iPhone acceptance. Last verified install-center baseline was 0.6.0 Build221; recheck before publishing.

Next: finish source/CI traceability; continue R2 real history/search/navigation acceptance; prepare a signed candidate without promoting latest; retire ONLY old mobile handlers/3211 and cut over the independent service with old pairing/journals preserved; test startup/crash recovery; actual iPhone acceptance; then formal promotion. Do not claim all phases complete.
