# PC Bridge — implementation handoff, iteration 1

## LATEST TAB POLICY — phone and PC share one bound tab (2026-10-11)

User permits phone and PC operations on the SAME Chrome tab. Adopt shared-tab mode as the default; the previous assistant suggestion to mandate a dedicated/background reader tab is superseded. This is a requirement/handoff update only, not an implemented or deployed feature.

- Bind one user-selected existing ChatGPT tab (offer the current ChatGPT tab initially). Phone conversation selection and ordinary/project new-chat actions navigate that SAME tab through the official UI; do not automatically create a reader tab or switch binding to another already-open tab containing the target. A new chat's permanent ID is confirmed after the first actual send, not fabricated.
- Navigation inside the bound PC tab updates the native phone view and read subscription to its new conversation. Do not treat all PC route changes as permanent disconnects, and do not restore the old conversation over the user's new PC choice. Merely activating another Chrome tab does not change the binding.
- Phone text stays local per conversation and is written to PC ONLY after explicit phone Send. PC unsent editor text never fills the phone composer. PC sent messages and replies do sync as history. Save phone draft A when moving to B; an old response/Send callback cannot overwrite B or send A's text there.
- Use existing document/conversation checks and a brief actionable message for a PC draft/IME/active send conflict. Do not silently overwrite PC edits, invent background-tab fallback, add an executor adapter or a distributed locking framework. Closing the bound tab prompts for a new binding; do not pick an unrelated tab silently.
- Focused acceptance: phone A->B visibly changes the same PC tab; PC B->C updates phone; other Chrome tab activation does not hijack it; per-chat phone drafts survive; PC unsent text never propagates; a route change racing with Send does not send in the wrong chat or replay.

Current0.1.0 code still invalidates subscriptions on route change and supports preserveSource reader-tab creation; implement the rules above before claiming shared-tab bidirectional navigation works. Retain the bridge-only scope correction below.

## SCOPE CORRECTION — user: only extract the bridge (2026-10-11)

The user clarified: **do not migrate, replace or make an adapter out of the Orchestrator executor. Only extract the mobile/PC bridge.** The earlier single-production-extension/keep-the-old-ID-for-Bridge assumption was an assistant scope error, not a user requirement. It is superseded.

Keep Orchestrator's existing extension, ID, task execution/queues, archive/delete, 3210 and `/executor` intact. Keep its existing PC resilience/state enhancement in place; do not duplicate that unrelated module in the new bridge. The independent Bridge extension gets its own ID and owns only paired message/history/project reads, explicit mobile actions, connection settings and independent3211 service. Two different-purpose extensions are permitted. What must not coexist is TWO active copies of mobile bridge handlers, duplicate status observers, or TWO writers owning the same3211/journal.

At cutover remove/disable only the old mobile initialization/handlers and the embedded3211 listener. Retain all original orchestration code and service. The existing0.1.0 development package still includes copied resilience content and shared legacy `__ORCH_MOBILE_*` globals; slim that package and isolate bridge namespaces before co-installation. New extension storage is separate: migrate ONLY mobile Send/interaction reservations needed to reconcile pending receipts, retain server pairing/journal, and leave old executor storage/ID untouched. Existing task ownership/running/approval/draft checks need a small coordination check when both target the same tab, not a rewritten executor or universal adapter framework.

**This turn corrects scope and handoff only; no new production deployment, code change or coexistence test is claimed.** Previous test counts below describe the0.1.0 isolated prototype, not the corrected two-extension installation.

Date: 2026-10-11. Development version: **0.1.0**. This is implemented and locally tested, **not a production deployment or an iOS release**.

## Where to continue

- PC development: `D:\workspace\py\chatgpt-pc-bridge`, mcpoffice workspace `ws_53924e782d`.
- Existing production: `D:\workspace\py\chatgpt-orchestrator`, workspace `ws_1936350011`. Do not continue core Bridge development there.
- GitHub repository: `masakacj/chatgpt-pc-bridge` now exists and has been initialized. **Full source publication is not complete yet**; the independent local workspace and complete development ZIP are the actual implementation at this milestone. Do not claim the remote repository can already build from a clean clone.
- Original cross-platform requirements remain in `masakacj/chatgpt-web/docs/IOS_070_NATIVE_UX_PARITY_HANDOFF.md` and `docs/PC_CHROME_BRIDGE_DECOUPLING_HANDOFF.md`.

## Implemented

1. `service/mobile-bridge.js`: extracted existing authenticated `/v1/` service with matching session, navigation, history, draft/send/interaction and receipt semantics. Added a server handle and disconnect invalidation for an independent transport. Malformed private JSON now fails instead of silently losing pairing or Send reservations.
2. `service/standalone.js` and `server.js`: independent loopback Node service, `/bridge` WebSocket with extension-origin and distinct extension-key authentication, one connected executor, CLI configuration and process lifecycle. There is no import, request or fallback to Orchestrator's `3210/executor`.
3. `extension/background.js` and `bridge-connection.js`: real standalone MV3 worker, direct service connection, bounded reconnection, 20-second transport heartbeat, no write replay queue. Existing mobile controller and native state modules are reused, not redesigned.
4. `extension/options.*`: local service/key configuration and connection status; no website credentials. Development manifest excludes legacy debugger and GitHub runtime-download permissions.
5. `source-imports.json`: SHA-pinned read-only extraction inputs for unchanged existing modules and regression fixtures. `scripts/build.mjs` assembles a complete runnable **dist artifact**, never overwrites the old production sources. The published source must vendor these exact files before claiming independent clean-clone builds.
6. Standalone HTTP/WebSocket tests, actual standalone-extension browser test, reusable old regression suites, syntax/architecture checks, package ZIP/CRC/SHA tooling, and a prepared CI workflow. CI configuration is written but no successful GitHub CI run is claimed.

## Tests actually observed

| Suite | Result | Meaning |
|---|---|---|
| Existing protocol + native-state Node tests | 29/29 PASS | Selected extracted modules; not all Orchestrator workflow tests |
| New independent service transport tests | 8/8 PASS | Authentication, second-executor rejection, HTTP/WS reads, one Send, persisted receipt/unknown result, restart and private-state failure |
| Existing real Chromium MV3 + Node regression | 23/23 PASS | Local synthetic page; editor, sidebar, source-preserving navigation, history, IME, approval and Send guards |
| Actual new standalone extension + independent service | 6/6 PASS | Real options/worker/HTTP/WS/extractor/editor/reply, duplicate suppression, 35-second MV3 idle window, process restart with receipt/pairing retained |
| Older full native-state Chromium suite | NOT COMPLETE | Tool invocation reached its 90-second timeout; do not report the previous historical 19/19 as this iteration's result. Re-run with a sufficient timeout before production cutover. |

The actual new-worker test launches the independent service on a temporary loopback port and a fresh isolated Chromium Profile. All ChatGPT URLs are fulfilled with local fixture HTML. It performs **one fixture Send and zero real user/account Sends**. The test does not stop the production Orchestrator; independence is established by the isolated service entrypoint and worker having no Orchestrator transport/import path.

Commands: `npm test`, `npm run check`, `npm run test:browser`, `npm run test:legacy`, `npm run test:resilience`, `npm run package`.

## Production unchanged

At the initial live check: `/api/health` reported one production executor `pc-extension-v43-mobile-controls`, zero Orchestrator runs. This iteration does not overwrite/reload the installed extension, stop its server, change the production extension ID, copy pairing/journal data, change NPM/WireGuard/DNS, navigate user chats or publish an IPA. The new Bridge must NOT replace the production executor at all. The previously proposed executor adapter is canceled by the scope correction. Deploy a separate bridge-only extension after disabling the old mobile handlers and validating coexistence; preserve the original executor.

## Source/publication status

The first Windows source-publish attempt had no available authenticated GitHub CLI/credential session. An existing authenticated GitHub CLI was identified on mcpdebian; credentials were not copied to Windows or committed. The repository was verified and initialized via the GitHub connector. **Only repository initialization and handoff publication are claimed here; complete source import remains pending.**

The development ZIP contains the full extracted source and tests (without runtime state or node_modules), and its `.sha256` sits beside it under `dist/`. Do not create another repository or redo dependency discovery. Use the existing repository and prepared source inventory; preserve the exact tested contents. Publishing and deployment are separate steps.

## Next shortest path

1. Finish complete GitHub source import, verify source hashes/build from the independent repository, and run the prepared CI. Keep the existing local implementation; do not reconstruct it from chat prose.
2. Slim the new extension to mobile bridge functions only; remove duplicate PC resilience initialization/content registration, separate legacy mobile globals, and retain the existing executor in its original project. No Orchestrator adapter work.
3. Stage the independent bridge extension with its own ID and independent3211 service. Disable ONLY the old mobile handlers/listener; keep Orchestrator3210 and executor unchanged. Preserve the server pairing/journal and reconcile mobile-only extension reservations. Test original workflow operation alongside bridge reads/explicit sends, including same-tab contention. Do not migrate the old executor ID/state.
4. Continue iOS 0.7.0: phone-only drafts and explicit compose/send; global history via verified official UI; ordinary/project new chat; official-like native layout and keyboard behavior. **These new iOS features have not been implemented in this iteration.**

Do not duplicate the work above or repeat legacy full-system audits before editing a small changed module. Keep handoff updates factual: changed files, exact tests, commit/ZIP, deployed yes/no and next step. Keep the essential protections against duplicate Send, wrong-chat writes and data loss, without adding speculative layers.
