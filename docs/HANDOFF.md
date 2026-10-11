# PC Bridge 开发交接 — 第一轮实现

更新：2026-10-11。开发版 **0.1.0**。**已实现并完成隔离测试；未切换生产扩展/服务，未发布 iOS 新版。**

## 实际代码与继续入口

- 独立 PC 项目：`D:\workspace\py\chatgpt-pc-bridge`，mcpoffice workspace `ws_53924e782d`。
- 本地完整交接：`docs/HANDOFF.md`；机器可读状态、包校验：`DEVELOPMENT_STATUS.json`。
- 生产仍在 `D:\workspace\py\chatgpt-orchestrator`，workspace `ws_1936350011`。
- 本 GitHub 仓库已初始化，**完整源码尚未上传**，不能把当前远端克隆当成可构建版本。完整实现及已组装源码在上述独立工作区和开发 ZIP 中，下一轮直接接续，不重写。

## 已落地

1. `service/mobile-bridge.js`：迁出原有 `/v1/` 鉴权、会话、历史、draft/send/interact、持久回执服务，保持现有客户端协议。读取损坏的配对/回执文件时不再默默重置。
2. `service/standalone.js`、`service/server.js`：独立 Node 进程和 loopback 监听，新增 `/bridge` 专用 WebSocket。扩展直接连接，不再经过 Orchestrator 的 `3210/executor`。手机配对 Key 和扩展连接 Key 分开，限制扩展来源、保留单一连接。
3. `extension/background.js`、`bridge-connection.js`：真实独立 MV3 后台、连接/重连、空闲保活，无自动重放发送队列。沿用原生状态恢复和既有移动端提取/发送模块。
4. `extension/options.*`：可用的配置界面，显示扩展 ID，保存本机服务地址及扩展连接 Key，显示连接状态。
5. 构建、语法检查、测试、ZIP/CRC/SHA 打包及 CI 配置已写好。首次提取用 `source-imports.json` 按固定 SHA 只读复用旧项目的未改模块；构建输出包含完整源码。**远端源码发布时需把这些文件一并纳入，才能完成源码层的彻底独立。**

## 已观察到的验证

| 项目 | 结果 | 范围 |
|---|---|---|
| Node 合并回归 | **37/37 通过** | 29 项原协议/状态 + 8 项独立服务 |
| 旧移动端 Chromium MV3 回归 | **23/23 通过** | 提取、侧栏、编辑器、IME、交互、历史及单次发送 |
| 实际新独立扩展 + 独立服务 | **6/6 通过** | 使用真实 manifest/background/options，不是替代测试 worker |
| JavaScript 语法/结构检查 | **22 个文件通过** | 核心路径不依赖 Orchestrator；包内无私有运行数据 |
| 较长的原生状态 Chromium 全量回归 | **本轮未完成** | 90 秒工具超时，不把历史 19/19 当成本轮通过 |

新独立链路实测：配置连接 → 读取对话/项目 → 写入测试文本 → 原生按钮只点击一次 → 收到回复；重复 commandId 不再发送；跨过 **35 秒 MV3 空闲窗口**保持会话；重启独立服务后配对及已发送回执保留，重连不重复发消息。

这些浏览器操作均在独立临时 Profile、由本地 HTML 代替的 ChatGPT 测试页面中执行。实际新链路测试发送 **1 条模拟消息、0 条真实用户消息**。未使用或复制用户 ChatGPT 登录凭据。生产 Orchestrator 没有为了测试被停止；独立性由实际独立入口/直连通道和代码依赖检查验证。

## 本轮开发包

`D:\workspace\py\chatgpt-pc-bridge\dist\ChatGPT-PC-Bridge-0.1.0-dev.zip`

- 84,632 字节，38 个文件，ZIP CRC 通过。
- SHA-256：`acdc4f3ca1323fb5ce0e5e714389f8903c9667713ea9245ae53b87e0c28a8d34`。
- 包含完整独立运行源码和测试，不含 node_modules、用户配对 Key、命令日志或浏览器 Profile。
- 开发包不是生产发行，不应直接与用户现有扩展并装。

## 尚未完成 / 不得混淆

**M1 已有独立工作区和构建产物，但完整 GitHub 源码发布待完成；M2 独立运行及隔离验证已完成；M3–M6 未完成。**

Orchestrator 可选 executor adapter 尚未接入，所以不能把当前开发扩展替换到生产环境，否则会缺失原编排任务能力。生产目录/扩展 ID/3211 所有权/配对及回执迁移没有执行。独立服务的 Windows 常驻部署及真实 iPhone 联调也未完成。

iOS 0.7.0 的手机独立草稿、仅点击发送才提交、任意历史搜索、普通/项目新建聊天和原生界面改造，**本轮没有修改或发布**。当前独立服务保留旧 draft/send 两步协议做兼容验收，不代表新一次性 compose/send 功能已完成。

生产复核：`/api/health` 仍为 **1 个 executor、pc-extension-v43-mobile-controls、0 个运行工作流**。未重载/重装生产扩展、重启 Chrome、改 NPM/WireGuard/DNS、清理用户数据或重放消息。

## 下一轮按最短路径继续

1. 将完整本地源码和固定 SHA 模块上传到本仓库，验证独立克隆构建。不要再创建另一个仓库或重做依赖发现。本机 Windows 缺可用的 GitHub CLI 认证，mcpdebian 已有已登录的 `gh`；不复制令牌到 Windows。当前只完成仓库初始化和文档提交。
2. 基于原 executor 提出可选 Orchestrator adapter，复用已有 busy/命令状态；先用同一扩展内的明确占用判断，不增加分布式锁框架。
3. 通过回归后再执行同扩展 ID、单一服务监听的受控迁移。安装路径可暂留原位置作为部署落地点，源码由独立项目维护，避免无必要的身份迁移。
4. 接续 iOS v0.7.0 的一次性发送协议、官网 UI 历史检索与新建/项目新建，以及原生布局和键盘行为。

命令：`npm test`、`npm run check`、`npm run test:browser`、`npm run test:legacy`、`npm run test:resilience`、`npm run package`。每轮仅记录实际修改、准确测试结果、包/commit、是否部署和下一步，避免将计划、源码落地、测试通过、生产发布混为一谈。
