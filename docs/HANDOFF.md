# PC Bridge / 原生 iOS — 当前开发交接

## MCP恢复后最新进度：0.2.5（2026-10-12）

**先读 `docs/RECOVERY_025_HANDOFF.md`。** 本轮保留0.2.4后台重载，新增首次连接搜索态恢复、整页刷新后的已观察路由保留与导航交接等待；53项Node、18项搜索、16项现代DOM、7项新历史恢复、4项共存本地通过。45轮/90条**模拟且已加载**消息分3页无漏重。真实项目旧聊天读出10条且一次同页返回通过；后一次出现PC草稿时未覆盖/强制返回。真实更早历史/归档范围仍未完整验收。

Windows独立看护脚本已实现并在临时13214验证5/5，测试子进程强制终止后约2.6秒恢复，配对与unknown回执保持，临时任务清理完成。正式3211未切换，原executor/3210未改；本轮没有重签或正式推广iOS。详细测试范围、初次恢复测试失败及修复、构建去除旧工程可变依赖的说明都在新handoff。准确提交/CI在发布完成后记录。


## 2026-10-12 后台重载增量（最新本地部署）

扩展现已 **0.2.4**，仍连接测试13213；原Node服务仍0.2.3，未重启、未切正式3211、未修改iOS。完整维护交接：`../igg-workflow/docs/BACKGROUND_RELOAD_HANDOFF.md`（相对项目根目录）。本轮源码未推送GitHub；下方0.2.3的受测SHA/CI只代表上轮，不能当作0.2.4发布证据。

新增扩展自有后台维护页+worker新bootId确认，忙碌会话/命令拒绝，准备后阻止新命令，无发送重放。office发布使用 `node scripts/update-staged-runtime.mjs 13213` 自动完成后台重载；`--stage-only`仅复制。旧 `run-desktop-step.ps1/desktop-bridge.ps1 -Step reload` 也已改走后台，不打开设置页或交互计划任务。仅此本机维护动作复用原扩展的白名单控制入口，Bridge运行/构建及手机传输仍独立，不移动executor或重做编排器。

已实际验证：升级请求probe-1791773269095-d3qgzb；正常同版本重载probe-1791773304776-ujwnuy。两次均新worker确认、版本0.2.4、WebSocket重连、活动标签360804308保持、后台维护页关闭；未刷新用户页。后台维护可能短暂出现一个未激活标签，不宣称零标签实现。

本轮PC53/53 Node、32份JS检查、通用后台维护8/8真实隔离MV3通过。R2/R3/R4/R5/R6业务验收状态不因维护升级自动完成。运行回退位于 `var/rollback/runtime-1791773268521`，原私有配对、回执未动。

---

最终固化：Bridge0.2.3受测代码 **0cad1dca9df3055473c7a21e0343f7fefa01282b**；CI **38192992421** 的Node22/Node24/browser全部success。58份源码Git blob清单和远端一致，19份runtime与源码差异0；清单SHA256 `0bf5fe4c84dd58ea41dff14c4d1a7e46f45665fcac786c4cac0685ba79dcf9bd`。GitHub最新交接文档提交 **6156cf94a3dd62143da8cc9d1e15d8f8af8d28b0**（仅元数据，不替代代码SHA）。本地/CI搜索边界最终18/18，其他本轮测试49/49、16/16、4/4。正式3211未迁移，候选签名成功但真机尚未验收。

更新：2026-10-12，本轮继续 R2 / R3。**Bridge 0.2.3 已在测试通道运行；iOS 0.7.0 Build1 已生成签名候选包，未推广正式 latest。R2 全范围和 R4/R5/R6 尚未完成。** 仍按 `docs/NEXT_DEVELOPMENT_PLAN_20261012.md` 执行。

## 产品边界

原生 SwiftUI 手机端，结构化镜像一个明确绑定的 PC ChatGPT 标签页。手机切换／新建操作同一页；PC 页内导航时手机跟随；切其他浏览器标签不改变绑定。手机草稿按对话独立，只在发送时提交，PC 未发送文字不回填。

只拆桥接。原 Orchestrator executor、原 ID/存储、3210、任务队列和 PC 状态增强保留。独立 Bridge ID 为 `heamldipoecpedbnoffiaadjkdagbmoc`。不做 executor adapter，不替换原扩展，不默认另开专用后台镜像标签。

## 本轮 R2 修改

`extension/shared-page.js` 的搜索/加载边界已增量修复：

- 官方搜索弹层会把底下的正文设为 aria-hidden。保留当前已捕获的会话内容，不把搜索中的正文误报为空白/加载失败；PC 先打开搜索的场景也复用同一路径。
- 将后台标签中容易被节流的连续定时等待，改成搜索弹层范围内的 MutationObserver 和有上限的等待；不存在常驻全正文扫描。
- 明确区分 loading、emptyConfirmed、hasMore；新查询不能返回旧查询结果。点击官网更多入口后重新确认是否还有更多。
- 从搜索结果导航时保留原生链接点击；其他导航先关闭搜索，再检查 PC 草稿。对话路由变化会清掉旧搜索快照，不能复用前一对话内容。
- 已有 conversationId 但正文尚未加载时不再报告 idle/canSend；继续显示 loading。
- 服务默认允许的扩展 ID 改为独立 Bridge ID，而不是原编排器 ID；显式环境配置仍可用于隔离测试。

## 本轮实际测试与限制

本地：49/49 Node，30 个 JS 语法/结构检查，18/18 新搜索边界 MV3，16/16 新官网用户气泡/隐藏 DOM 回归，4/4 原状态模块共存专项通过。搜索边界包括空结果、旧查询结果清除、更多结果结束、搜索弹层正文保留、PC 主动打开搜索、加载未完成不误报空闲。

真实官网：使用已记录开发会话，不向业务聊天写入。最新独立搜索复测为 **无结果0条 → Wake on LAN结果4条 → 再次无结果0条**；空结果均 emptyConfirmed=true、loading=false、hasMore=false，返回原开发会话，**本轮真实消息提交0次**。该次浏览器标签总集合有变化，未将“所有标签数量完全不变”算作通过。

真实项目旧聊天/长历史连续性本轮仍未通过完整验收：一次检查命中正文尚未加载、误报idle；已补代码及模拟回归。后续检查仍需要真实连续分页、完整加载、返回原会话的证据，不能把0条消息/0页算通过。归档范围、全部分页边界、复杂交互及首次连接时搜索弹层已打开的完整恢复仍需补验。

前轮 R1 结果继续有效，不重做/重发：现有中文多行、普通新建首发、项目内首发均曾 sent_confirmed，对应用户消息与回复各1条。旧 sent_unconfirmed 记录保留。前轮 R0 受测代码 c9c6676ca878dd10f15ac4911fdb62929aad0683 / CI38189275456；本轮代码/CI以上方最终固化记录为准，不把旧CI当本轮证据。

## R3：签名候选包已产出

**ChatGPT Web iOS 0.7.0 / Build1**，Bundle ID `com.masakacj.chatgptweb`。

候选ID：`d029f722-9ee4-452a-ab84-947c59c263d9`。
安装页：https://ipa.78175132.xyz/candidate/d029f722-9ee4-452a-ab84-947c59c263d9
元数据：https://ipa.78175132.xyz/api/v1/apps/chatgpt-web/candidate

候选工作流：`masakacj/chatgpt-web/.github/workflows/shared-tab-candidate.yml`。
分支：`feature/shared-tab-native-070-20261011`。
准确候选源码提交：`ca6a2e0a57cc28beaf361c00abe36fbdb1ddcc7c`。
成功 Actions run：`38191446488`。
签名IPA SHA256：`4716f4eb5d938dc6715bccaaed5619097be1f5bd6726dae11da1046eabfd8caf`。

工作流核对 App/资源/测试输入与此前实际受测 `b33b1d99f9c240261ae2983ecefa583c64e2363a` 完全一致，因此复用其8/8模拟器结果，不宣称本轮又跑8/8。本轮重新执行24项草稿断言、Release设备目标编译、远端签名、GET manifest和IPA；验证ZIP CRC、Bundle/Version/Build、主App及内嵌扩展签名/Profile存在。产物元数据已在内存读回；未向MCP目录写IPA。

**候选可安装不等于真机验收完成。正式PC3211尚未切换，新App目前不能被称为现有手机通道的已完成正式升级。** 签名候选与正式推广已经分开，后续R4/R5通过后再推进R6。

## 签名服务最小改造与源码

现有服务新增 `POST /api/v1/sign?channel=candidate`，只允许本项目固定候选分支/工作流。候选记录存于独立 candidates/candidate 字段，不修改正式 latest/history，也不影响FileMann/Laocai/dylib。

候选权限/保留/查找/不修改stable等10/10单元测试通过，已部署。正式latest在签名前后逐值一致，仍为 **0.6.0 Build221**。未改证书/配对密钥或现有正式签名权限。

源码项目：mcpdebian `/home/devspace/ipa-signer`，workspace `ws_3a9515d2c0`；线上 `/opt/ipa-signer`。
源码保存在私有 `masakacj/laocai-manager` 分支 `feature/ipa-native-candidate-20261012`，提交 **c5b9b7b652a944925659cdd674137fc941071c15**，路径 `infra/ipa-signer/`。原已部署服务与其main基线不同，故保存隔离分支，没有覆盖main或未经核对合并。详细说明 `CANDIDATE_HANDOFF.md`。

## 运行与下一步

PC独立项目：mcpoffice `D:\workspace\py\chatgpt-pc-bridge`，workspace `ws_53924e782d`，安装路径 `runtime/extension`，版本0.2.3；仍是测试端口13213。原3210正常，正式3211未切换，旧mobile入口尚未停用。

R0/R1前轮已验收；R2进行中；R3签名候选子项已完成、整体验证仍进行中；R4/R5/R6未完成。

下一步先补真实项目旧聊天/历史连续性及首次连接搜索态恢复，再执行R4：仅停旧mobile入口/转发/3211，迁移正式配对与回执，保留原executor/3210，验证常驻/异常恢复及回退。R5使用本次签名候选在实际iPhone验收，R6才推广正式latest。不要重复开发候选签名通道或重做已验收的用户消息提取。
