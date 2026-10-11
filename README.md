# ChatGPT PC Bridge

Independent Chrome MV3 extension and local Node companion service. Development version 0.1.0; **not installed into the user's production Chrome and not an iOS release**.

## Implemented

The extension connects directly to this service's `/bridge` WebSocket. The existing `/v1/` mobile protocol, durable command receipts, selected-tab extraction, loaded sidebar/history, native conversation state and limited read-recovery are retained. The standalone service and actual extension have been exercised together in isolated Chromium, including one Send, duplicate suppression, the MV3 idle window and service process restart. No Orchestrator process, executor socket, login copy or real account is used by that test.

Orchestrator's optional executor adapter and production migration are **not yet implemented**. Do not load this extension alongside the existing production executor. Full-account history search, new/project chat creation and iOS 0.7.0 remain separate next milestones.

## Development

Node 22+ and Python with Playwright Chromium are required. Install dependencies with `npm ci`, then `npm test`. `npm run build` creates a complete `dist/bridge` development bundle; `npm run test:browser` tests the actual standalone extension. `npm run test:legacy` runs the unchanged 23-case browser protocol regression, and `npm run test:resilience` runs the slower native-state browser regression. `npm run package` creates a source/runtime ZIP and SHA-256 in `dist`.

The complete development ZIP contains all source modules. Full GitHub source import is still pending at this milestone. The initial mcpoffice extraction workspace uses `source-imports.json` solely to import SHA-pinned, read-only baseline modules into build outputs. These exact modules must be vendored when publishing the source, so that a future clean clone needs no Orchestrator directory. The built runtime does not fetch Orchestrator modules.

## Local service

`npm start` listens on `127.0.0.1:3211`. `BRIDGE_PORT`, `BRIDGE_DATA_DIR` and `BRIDGE_EXTENSION_IDS` configure an isolated test instance. The data directory holds private `pairing.json` (phone key), `extension-auth.json` (extension-only key) and `commands.json` (receipts). They are excluded from source and packages.

Load `dist/bridge/extension` only into an isolated development Profile. Its options page displays the ID to allow through `BRIDGE_EXTENSION_IDS`; enter the local `ws://127.0.0.1:PORT/bridge` URL and the extension-only key. Do not change the user's installed unpacked extension path or ID during development. The service's public reverse proxy must expose `/v1/` only, never `/bridge` or an administration endpoint.

The first version accepts the previous `draft` then `send` protocol for compatibility. The user's next iOS iteration requires phone-local drafting and a single explicit compose/send operation; that change is not claimed complete here.

See [docs/HANDOFF.md](docs/HANDOFF.md) for exact implemented/tested/deployed distinctions and the next executable steps.
