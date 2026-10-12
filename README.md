# ChatGPT PC Bridge

Independent Chrome MV3 bridge and local Node companion service. Current development version **0.2.3**. The installed extension runs against a staged loopback service; this is **not a new iOS release or a completed production cutover**. Read [docs/HANDOFF.md](docs/HANDOFF.md) for exact live status and [the R0–R6 plan](docs/NEXT_DEVELOPMENT_PLAN_20261012.md) for remaining work.

## Scope

The native iPhone app and PC share one explicitly bound ChatGPT tab. Phone navigation changes that same page; PC navigation within it updates the phone. Selecting another browser tab does not change the binding. Phone drafts stay local until an explicit compose/send command; PC unsent editor text is not returned in shared snapshots.

The original Orchestrator executor, its extension ID, workflow queue, 3210 service and PC state/recovery modules stay in their original project. This extension owns only the mobile bridge and its service. There is **no executor-adapter migration** and no requirement to replace the original extension. Historical state-module files in the test source are not loaded by this extension or staged into its runtime.

## Build and tests

Use Node 22+ and Python with Playwright Chromium. `npm ci --ignore-scripts`, `npm test`, and `npm run check` build and check the complete source inventory. Additional focused suites are `npm run test:shared`, `npm run test:search`, `npm run test:modern-user`, `npm run test:coexistence`, `npm run test:browser`, and `npm run test:legacy`. `npm run package` creates a ZIP and SHA-256 under `dist/`.

The published repository contains the extracted modules and does not need an Orchestrator checkout to build. `source-imports.json` records one-time SHA-pinned provenance for the original extraction workspace; when local canonical files exist, those files take precedence. CI checks a clean checkout, not a deployment folder. Export includes PowerShell deployment scripts, but excludes `var/`, `runtime/`, credentials, journals, browser profiles and diagnostic artifacts.

## Local service and installation

`npm start` listens on `127.0.0.1:3211`. Configure `BRIDGE_PORT`, `BRIDGE_DATA_DIR`, and `BRIDGE_EXTENSION_IDS` for a staged instance. Private `pairing.json` is the phone key, `extension-auth.json` is the distinct extension connection key, and `commands.json` preserves once-only command receipts. Never replace the existing phone pairing with a test key during cutover.

The extension options page accepts the local `ws://127.0.0.1:PORT/bridge` endpoint and extension key. The installed path is stable: `runtime/extension`; changing it can change the unpacked extension ID. The public reverse proxy continues to expose only `/v1/`, not the extension WebSocket or local setup pages. `http://127.0.0.1:PORT/local/pair` provides explicit same-origin phone-key reveal, and `/local/status` contains operational status without keys.

The service keeps the previous draft/send protocol for old-client compatibility. The new shared-tab client explicitly negotiates `shared-tab-v1`, binds with `followTab: true`, and submits a single `compose` command. Unknown or unconfirmed commands are looked up, never automatically replayed.

## Development focus

0.2.3 adds bounded search-result waits, empty/pagination handling and preservation of the conversation while official search hides its transcript. A separately signed iOS 0.7.0 Build1 candidate exists; stable latest and production3211 remain unchanged. See the current handoff before installation or cutover.

0.2.2 added support for the actual roleless `.bg-user-message.text-user-message` markup, stabilizes message identities across DOM replacement, skips hidden stale composers and reads ProseMirror paragraph breaks as typed newlines. Regression fixtures contain synthetic text only. Real-web acceptance and release status must be recorded separately from fixture/CI success.
