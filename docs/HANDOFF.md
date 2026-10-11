# PC Bridge 开发交接

## 最新范围纠正：只剥离桥接，不迁走编排器执行器（2026-10-11）

用户明确纠正：**“为什么会影响编排器？只是要剥离桥接的部分。”**

之前把任务扩大为“以一个新扩展替换原 executor，再把编排器接成 optional adapter”，是助手划错拆分边界，**不是用户要求，也不是桥接独立化的必要条件**。取消该 adapter 工作及“所有功能必须共用同一扩展 ID”的限制。本文本节优先于旧迁移计划与旧 M3/M4 描述。

### 保留与迁出

| 保留在 Orchestrator，不替换 | 迁到独立 PC Bridge |
|---|---|
| 原 Chrome executor 扩展、原 ID、原存储 | 单独的桥接扩展及其独立 ID |
| 3210 管理服务、原 `/executor` 通信 | 手机 `/v1/` 服务及独立3211进程 |
| 工作流、任务队列、执行、结果收集、原归档/删除流程 | 手机配对、消息/历史/项目读取、手机明确触发的发送和交互 |
| 现有 PC resilience 状态增强与安全读取恢复 | 桥接自己的设置、连接及发送回执 |

修正后是**两个职责不同的扩展并存**，而非把同一套桥接运行两遍。原 executor 继续执行原工作流，新 Bridge 只服务手机桥接。生产切换时，只移除或停用旧工程的 mobile bridge 初始化/消息处理和内嵌3211监听；不搬走或重构编排器其余逻辑。

新旧同时操作同一个目标对话时，只做必要的占用/生成/审批/输入检查，优先复用现有 busy 信号或桥接专用标签；不引入完整 executor adapter 或分布式锁框架。原扩展的状态/存储留在原处，新桥接只读取它需要的目标页快照；确实需要跨扩展元数据时再加小型只读接口。

### 对当前开发版的具体调整

独立服务、直连通道、配置页和桥接提取代码继续复用，不推倒重写。但已有0.1.0开发包仍默认加载复制的 PC resilience 模块，并使用旧 `__ORCH_MOBILE_*` 命名，**不可原样与旧插件并装**。下一步仅精简这些重复注册、隔离 bridge 命名，并在原插件停用旧 mobile 处理后验证共存。

旧 executor ID 与非桥接状态不用迁移。独立服务继续保留手机配对和服务端命令日志；新扩展只核对/迁移必要的 mobile Send/interaction 防重预约，未确认的旧命令不重发。这不是要求迁移整个 Chrome 扩展存储。

**本次只纠正范围和 handoff，未改运行代码、未切换生产、未宣称两个扩展共存已测试。** 以下测试结果仅对应之前的0.1.0隔离原型，不等于修正范围后的生产共存验收。

## 实际代码与继续入口

- 独立项目：mcpoffice `D:\workspace\py\chatgpt-pc-bridge`，workspace `ws_53924e782d`。
- 本地交接：`docs/HANDOFF.md`；机器可读记录：`DEVELOPMENT_STATUS.json`。
- 原编排器保留：`D:\workspace\py\chatgpt-orchestrator`，workspace `ws_1936350011`。
- 本 GitHub 仓库已初始化，上一轮完整源码尚未上传。实际实现及完整构建产物在独立工作区；继续开发前按实际文件核对，不重建项目。

## 第一轮已有实现（0.1.0开发版，未生产部署）

1. `service/mobile-bridge.js`：提出 `/v1/` 鉴权、会话、历史、draft/send/interact 和持久回执服务，保持旧手机客户端协议。
2. `service/standalone.js`、`service/server.js`：独立 Node 进程、loopback 监听、`/bridge` 扩展专用 WebSocket，不经 Orchestrator `3210/executor`。
3. `extension/background.js`、`bridge-connection.js`：真实 MV3 后台、连接及重连、无发送重放队列。复制的 PC resilience 注册需按本次范围纠正移除，新插件只保留 bridge。
4. `extension/options.*`：设置本机服务、扩展连接 Key 和连接状态。
5. 构建、语法检查、测试、ZIP/CRC/SHA 打包及 CI 配置。初始 `source-imports.json` 按固定 SHA 只读复用旧模块，发布完整源码时需纳入所需的 bridge 文件，不再扩张到整套 executor。

## 第一轮实测记录（历史结果）

| 项目 | 结果 | 范围 |
|---|---|---|
| Node 合并回归 | 37/37通过 | 29项原协议/状态＋8项独立服务 |
| 移动端 Chromium MV3 回归 | 23/23通过 | 模拟页面中的提取、侧栏、编辑器、IME、交互、历史、单次发送 |
| 实际新独立扩展＋独立服务 | 6/6通过 | 使用真实 manifest/background/options 的隔离测试 |
| JavaScript 检查 | 22个文件通过 | 语法与独立核心通信路径 |
| 原生状态 Chromium 全量回归 | 未完成 | 90秒工具超时，不能当作本轮通过 |

新独立链路验证了读取 → 写测试文本 → Send仅点击一次 → 收到回复，重复 commandId不重复发送；35秒MV3空闲窗口后仍可读取；独立服务重启后配对/回执保留。临时Profile与本地HTML测试页面，1条模拟消息，0条真实用户消息。原生产编排器未为该测试停机。

## 第一轮开发包（历史，不是修正后的可并装版本）

`D:\workspace\py\chatgpt-pc-bridge\dist\ChatGPT-PC-Bridge-0.1.0-dev.zip`

84,632字节，38文件，ZIP CRC通过；SHA256 `acdc4f3ca1323fb5ce0e5e714389f8903c9667713ea9245ae53b87e0c28a8d34`。无node_modules、用户Key、命令日志或Profile。不可将此旧包宣称为bridge-only共存正式版。

## 下一步（已替换错误的 adapter 前置任务）

1. 在现有独立工作区精简为bridge-only：去掉重复PC resilience内容注册，隔离旧mobile globals，保留已经跑通的独立服务/连接/提取；完成所需源码发布。
2. 原工程只停用旧mobile初始化、转发与3211监听，原executor/3210/任务逻辑不动。准备新Bridge独立ID的手机桥接预约/回执衔接，不迁移原executor身份。
3. 做有针对性的共存回归：原编排工作流仍能运行、新Bridge读取和明确发送正常、同一对话不会互相覆盖或重复发送、手机配对与旧回执不丢。再执行受控切换。
4. 接续iOS0.7手机独立草稿、仅发送时提交、历史检索、普通和项目新建、官方式原生布局。此轮仍无iOS源码修改或新IPA。

生产上次复核为1个executor、`pc-extension-v43-mobile-controls`、0个运行工作流；这是上一轮观察，不是本次新增现场验收。没有因为本次文档纠正而重载扩展、重启Chrome、改网络或用户数据。

记录每轮实际代码、准确测试、commit/包、是否部署和下一步；不要为桥接拆分重构整个编排器，也不要重新展开已经取消的“optional executor adapter”任务。
