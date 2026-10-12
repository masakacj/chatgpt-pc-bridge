# ChatGPT PC Bridge development

Read `docs/HANDOFF.md` and `docs/NEXT_DEVELOPMENT_PLAN_20261012.md` first. They replace obsolete 0.1.0 planning notes. Current development: 0.2.2 on staged loopback13213; production3211 and the signed iOS release are not cut over.

R1 implementation now reads the actual roleless official user bubble, skips hidden old editors and transcripts, preserves ProseMirror typed paragraph breaks, and uses stable message identities. Real owned-test cases for existing-chat Send, ordinary first Send and project first Send returned sent_confirmed and were checked for one matching user message plus one reply. Original unknown receipts were NOT replayed or rewritten. R0 latest source/CI traceability and R2 broader official history/search/navigation acceptance must be checked against the latest handoff, not assumed from prior runs.

Keep scope small: extract only the bridge. Original Orchestrator executor, ID/storage,3210,/executor,queue/workflows and PC resilience remain in the original project. New Bridge has its own ID heamldipoecpedbnoffiaadjkdagbmoc. No executor adapter, no replacement of the original extension, no duplicate status observers.

Phone and PC share one explicitly bound tab. Phone navigation operates that tab; PC page navigation updates the phone; merely selecting another browser tab does not rebind. Drafts stay local per conversation until explicit Send; PC unsent text is not returned. No mandatory dedicated/background reader tab and no automatic focus workaround.

Use existing mcpoffice workspace ws_53924e782d at D:\workspace\py\chatgpt-pc-bridge. Source, dist, runtime and private var are separate. Never publish var/runtime, keys, journals, profiles or actual chat bodies. Source exports include .ps1 deployment tools and all pinned imported source; a canonical clone must build without the old Orchestrator directory. The source-imports manifest is provenance/fallback for the initial extraction workspace only.

Use DevSpace edit/write for source changes. Tests/builds may generate dist and private test artifacts. Reuse the validated source transfer/publisher; do not extract/copy account credentials. For staged runtime updates use the existing tested script at an idle boundary and reload ONLY this Bridge extension, not the old executor or user Chrome.

Run focused tests for actual changes, not all iOS builds for PC-only fixes. Keep essential duplicate/wrong-chat/user-data protections but avoid speculative frameworks. Live acceptance sends only clearly labeled development messages in the owned test context. Unknown commands are only read back; a retry of a proven pre-click failure is a new explicit test, never replay.

iOS source stays in GitHub, branch feature/shared-tab-native-070-20261011. Do not create another iOS checkout or write IPA files to MCP workspaces. Prior accepted SHA b33b1d99f9c240261ae2983ecefa583c64e2363a passed8/8 Simulator,24 draft assertions and device compile; this is not physical-iPhone/signing evidence. R3 signed candidate must precede R5 device tests, without replacing public latest. Track exact source commit, runtime hash, actual tests and next step in handoff.
