# PC Bridge / 原生 iOS — 当前开发交接

更新：2026-10-12。**Bridge0.2.3源码、运行文件和CI已核对；iOS0.7.0 Build1已生成签名候选包。正式3211未切换，正式安装中心仍是0.6.0 Build221，真机未验收。** 后续继续 `docs/NEXT_DEVELOPMENT_PLAN_20261012.md`，不要把候选包当作正式发布。

## 范围不变

原生SwiftUI镜像一个明确绑定的PC ChatGPT标签页；手机导航同页，PC页内导航手机跟随，切其他浏览器标签不改绑定。手机草稿按对话独立，仅点击发送才提交，PC未发送文字不回填。

只拆桥接，不替换原Orchestrator executor、ID/存储、3210、队列或PC状态增强。新Bridge独立ID `heamldipoecpedbnoffiaadjkdagbmoc`，没有executor adapter前置任务，不要求专用后台镜像标签。

## 本轮代码与运行证据

PC仓库 `masakacj/chatgpt-pc-bridge`，准确受测代码 **0cad1dca9df3055473c7a21e0343f7fefa01282b**，版本 **0.2.3**。

Actions **38192992421**：Node22、Node24、browser三个job全部success。browser实际执行独立链路、旧协议、共享标签页、新用户气泡、搜索边界和共存测试，再打包。此后的handoff文档提交不改变受测代码。

58个源码文件的Git blob清单摘要与该提交完全一致；已安装runtime19个文件与源码一致，差异0。源码清单SHA256：`0bf5fe4c84dd58ea41dff14c4d1a7e46f45665fcac786c4cac0685ba79dcf9bd`。私有var、密钥、journal、浏览器资料没有进入发布源码。

本地：mcpoffice `D:\workspace\py\chatgpt-pc-bridge`，workspace `ws_53924e782d`。安装 `runtime/extension`，服务仍是测试端口 **13213**。最后核对：pid28544、version0.2.3、extensionConnected=true、sessions0、pending0、journalCount9。

原3210：1个 `pc-extension-v43-mobile-controls` executor、runs0，保持正常；本轮未重载或改造原执行器。**正式3211及旧mobile入口尚未迁移。**

## R2新增修复

`shared-page.js` 已修复搜索弹层和加载边界：

- 官网搜索会把底下正文aria-hidden；保留已捕获的当前会话，不发送虚假的空正文。覆盖手机打开搜索和PC先打开搜索两种路径。
- 用搜索区域MutationObserver与有上限的等待替换容易受后台节流影响的连续定时轮询，不做常驻全正文扫描。
- 分清loading/emptyConfirmed/hasMore；新空查询不能返回上一轮结果；更多结果到末尾后停止提供“更多”。
- 搜索结果仍通过原生链接导航；其他导航先关闭搜索并检查PC草稿。对话路由变化清掉搜索缓存，避免跨聊天复用。
- 已有会话ID但正文尚未加载时继续报告loading，不提前报告idle/canSend。
- 服务默认允许的扩展ID改为独立Bridge的ID，而不是原编排器ID。

本轮本地及CI：**49/49 Node、18/18搜索边界MV3、16/16现代用户气泡/隐藏DOM回归、4/4原状态共存专项**通过，30个JS检查通过。CI还通过原13项共享标签页及旧兼容链路。共存专项不等于所有业务工作流重跑。

真实官网最终搜索复测：**无结果0条 → Wake on LAN结果4条 → 再次无结果0条**；空查询均emptyConfirmed=true、loading=false、hasMore=false，回到原开发会话。**本轮真实消息提交0次。** 该次浏览器标签总集合有变化，不把“全部标签数量不变”算作通过。

R2仍有待验收项：实际项目旧聊天/长历史连续分页、归档范围、所有分页结束边界、复杂交互、首次连接时搜索弹层已打开的完整恢复。此前项目旧聊天检查出现正文尚未加载却idle、返回时page_loading，代码和模拟回归已补，但不能把0条消息/0页当成真实历史验收通过。

前轮R1已通过的现有中文多行、普通首发、项目首发仍保留其证据：每项sent_confirmed且用户消息/回复各1条。旧sent_unconfirmed不重放、不擅自改成功。私有证据仍在 `var/stage/r1-r2-evidence.json`，本轮边界记录在 `var/stage/r2-boundaries.json`。

## R3签名候选包

**ChatGPT Web iOS0.7.0，Build1**，Bundle ID `com.masakacj.chatgptweb`。

候选ID：`d029f722-9ee4-452a-ab84-947c59c263d9`。
安装页：https://ipa.78175132.xyz/candidate/d029f722-9ee4-452a-ab84-947c59c263d9
元数据：https://ipa.78175132.xyz/api/v1/apps/chatgpt-web/candidate

候选源码：**ca6a2e0a57cc28beaf361c00abe36fbdb1ddcc7c**，`masakacj/chatgpt-web` 分支 `feature/shared-tab-native-070-20261011`。
工作流 `.github/workflows/shared-tab-candidate.yml`，Actions **38191446488全部success**。
签名IPA SHA256：`4716f4eb5d938dc6715bccaaed5619097be1f5bd6726dae11da1046eabfd8caf`。

工作流核对App/资源/测试输入与此前实际受测 `b33b1d99f9c240261ae2983ecefa583c64e2363a` 完全一致，复用其8/8模拟器证据；不宣称本轮重跑8/8。本轮重跑24项草稿断言、Release设备编译、远端签名和GET校验：manifest、IPA ZIP CRC、Bundle/Version/Build、主App与嵌套扩展签名/Profile存在。签名验证元数据已在内存读回，未把IPA写到MCP工作区。

**可安装候选不等于真实iPhone验收，更不代表现有手机通道已升级。** 当前正式PC3211仍为旧服务，候选App可能要求更新Bridge；应在R4切换及R5真机验证后再正式推广。

## 签名服务改造与保存

新增 `/api/v1/sign?channel=candidate`，只允许本项目固定候选分支/工作流。候选记录与stable latest/history分开；10/10候选权限、保留和不覆盖stable测试通过。已部署且通过实际签名，签名前后正式latest逐值一致。没有修改证书密钥、其他App或dylib发布路径。

签名服务：mcpdebian `/home/devspace/ipa-signer`，workspace `ws_3a9515d2c0`；线上 `/opt/ipa-signer`。
准确源码保存在私有 `masakacj/laocai-manager` 分支 `feature/ipa-native-candidate-20261012`，提交 **c5b9b7b652a944925659cdd674137fc941071c15**，路径 `infra/ipa-signer/`。该服务原部署源码与main基线不同，因此保存隔离分支，不覆盖或自动合并main。详见该目录 `CANDIDATE_HANDOFF.md` 和测试/部署脚本。

候选通道不自动推广。R6的正式推广需要在真机验收后明确执行，不能调用默认稳定签名接口来替代候选测试。

## 接续顺序

R0/R1已验收；R2进行中；R3签名候选子项完成、整体验证进行中；R4/R5/R6未完成。

继续补真实旧项目聊天/长历史和初始搜索态恢复，再仅停用旧mobile入口/转发/3211并迁移独立正式服务、原手机配对和所有回执，保留executor/3210。验证开机、异常退出恢复及回滚，然后使用本次候选做实际iPhone验收，最后推广正式latest。

不要重复开发候选签名通道、重写已通过的用户消息解析，或重新引入编排器迁移。全计划仍未完成。
