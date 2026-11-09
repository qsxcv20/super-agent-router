# Changelog

本文件记录 super-agent-router 插件包的版本变更。
格式参考 Keep a Changelog，版本号遵循语义化版本。

## [0.4.0] - 2026-11-09

本次升级修正了「派工发生在父会话、工具执行发生在子会话」这一事实与 v0.3.x 授权模型之间的错配。
v0.3.x 按 session_id 查台账，而台账记的是「发起方」会话，结果是两头都错：
worker 在子会话里查不到自己的 scope（越界管控对真正需要约束的人完全失效），
Router 在父会话里查得到（被自己派出去的 worker 锁死）。

### 变更 1：guard 只约束被派工的子代理，不再约束 Router 父会话

**改了什么**

- `plugin/scripts/guard.mjs`：新增分水岭判定 —— 工具调用载荷里没有 `agent_type` 字段就不是子代理会话，直接放行，不再查台账、不再套 scope。
- 父会话（Router 自己）的任何读写都不再受 worker 的 scope 约束。

**为什么**

Router 是派工方，也是回收结果、跑验收、做复盘的人。它必须能读写 worker scope 之外的文件
（比如汇总各 worker 的产出、读用户指定的其它目录）。
v0.3.x 把 Router 和 worker 用同一个 session_id 索引同一张表，等于用 worker 的边界去限制 Router，
Router 会被自己派出去的 worker 锁死 —— 表现为「派完第一个工，Router 后续连自己的收尾文件都写不了」。

**怎么验证**

- 仓库回归：`node .superagent/chain-test.mjs` 第 9 组断言「Router 会话不被 worker scope 约束」
  （父会话写 `config/prod.yaml` 不被拦），同时断言 worker 写自己 scope 外文件仍被拦、写 scope 内文件放行。
- 仓库回归：`node .superagent/scope-test.mjs` 第 1 组断言 Router 父会话读写任意路径都不被拦。
- 人工确认：在同一个会话里先派一个带 SCOPE 的工，再让主会话改一个 scope 外的文件 —— v0.3.x 会被拦，v0.4.0 不会。

### 变更 2：guard 的 scope 改为从子会话自己的 transcript 里的派工原文解析

**改了什么**

- `plugin/scripts/lib.mjs` 新增 `readBriefFromTranscript()`：读取子会话自己的 transcript，
  从前若干条 user 消息里解析出 `PARENT SESSION`、`agentName` 与 `SCOPE` 白名单。
- `plugin/scripts/guard.mjs`：先用台账里已有的 `bindings` 绑定；没有绑定时，从自己的 transcript
  解析 brief 得到 scope，建立绑定并写回台账（避免每次工具调用都重解析 transcript）。
- 解析不到边界时放行 —— 平台原生 Team 的 agent 不带本插件的 brief，不该被本插件的规则误伤。

**为什么**

派工原文就是 Router 亲手写下的白名单，是 scope 的权威来源。
v0.3.x 靠 session_id 猜测「我这次是哪次派工的 worker」，在父子会话分离的情况下根本猜不中。
改成从子会话自己的 transcript 读派工原文后，判定不再依赖 id 关联和时序启发式。

**怎么验证**

- 仓库回归：`node .superagent/e2e-test.mjs` 第 3 组构造子会话 transcript，断言
  worker scope 内放行、scope 外 deny、bash 里藏 scope 外路径 deny。
- 仓库回归：`node .superagent/chain-test.mjs` 第 9 组断言 worker 写 scope 外文件被拦。
- 人工确认：派一个带 SCOPE 的工，让 worker 改一个 scope 外的文件 —— 应被拦并给出
  「本次派工声明的 SCOPE 为 [...]」的提示。

### 变更 3：dispatch 新增两道组队闸门

**改了什么**

- `plugin/scripts/dispatch.mjs` 新增闸门二：本次派工的 SCOPE 不得与本会话**仍在飞的**派工重叠，
  重叠即拒绝并列出冲突路径。
- `plugin/scripts/dispatch.mjs` 新增闸门三：单会话派工数设上限 —— 并发在飞上限 6 个、累计上限 30 个，
  超限即拒绝。
- `plugin/scripts/lib.mjs` 新增 `scopeClash()` / `scopeOverlaps()` / `activeDispatches()` /
  `totalDispatches()` 与 `MAX_ACTIVE_DISPATCHES` / `MAX_TOTAL_DISPATCHES` / `DISPATCH_TTL_MS` 常量。
- 重叠判定只算**写冲突**：两个 worker 同时写同一处才会互相覆盖，读范围天然重叠（都要读邻近文件）不算冲突。
  目录 scope 与其下文件算重叠。

**为什么**

两个 worker 同时写同一处，后写的会覆盖先写的，而且验收时无法判断哪份改动是有效的 ——
冲突应该在组队阶段就拦下，而不是等验收时才发现。
派工数失控通常意味着任务没拆干净，或者在用派工代替思考，所以也要有上限。
只算写冲突是因为读重叠是组队协作的正常形态，按读重叠拦会把正常并行也杀掉。

**怎么验证**

- 仓库回归：`node .superagent/chain-test.mjs` 第 6 组断言 scope 重叠的派工被拒（「组队冲突」）、
  不重叠的 scope 可以派工；第 7 组断言目录 scope 与其下文件也算重叠；第 8 组断言单会话派工数超限被拒且提示指向「上限」。
- 人工确认：在同一会话里派两个 SCOPE 相同的工 —— 第二个应被拒并列出冲突路径。

### 变更 4：watchdog 新增在飞派工名额回收，worker 结束即归还名额

**改了什么**

- `plugin/scripts/watchdog.mjs`（SubagentStop）：worker 结束时把对应派工记录标记为 `done`，
  其占用的「在飞派工」名额随即归还。
- 优先用台账里该子会话的 `bindings` 拿到 `dispatch_id`；
  worker 若一次工具调用都没发生过（没有绑定记录），兜底从它自己的 transcript 解析 brief 反查派工记录。
- 回收失败被 try/catch 包住，不影响 watchdog 本职的交付判定。

**为什么**

v0.3.x 的「在飞派工」只增不减。并发上限和 scope 重叠检测都建立在「在飞」这个状态上，
名额不回收的话，worker 早就结束了但名额还被占着 —— 同一个会话用着用着就把自己锁死了。
回收是让闸门能长期生效的前提。

**怎么验证**

- 仓库回归：`node .superagent/chain-test.mjs` 第 10 组：worker 跑完后，对同一 scope 再次派工
  应被放行（不再被判为「重叠」）。
- 人工确认：连续用同一个 SCOPE 派同一个工两轮（第一轮 worker 正常结束），第二轮不应被「组队冲突」拒绝。

### 变更 5：台账结构拆成 dispatches（父会话维度）与 bindings（子会话维度）两层

**改了什么**

- `plugin/scripts/lib.mjs`：台账文件结构从单层 `{ dispatches: [] }` 变为 `{ dispatches: [], bindings: [] }`。
  - `dispatches[]` —— 派工记录，父会话维度。字段含 `dispatch_id`、`parent_session_id`、`turn_id`、
    `agent`、`scope`、`state`（`active` | `done`）。
  - `bindings[]` —— 子会话绑定，子会话维度。字段含 `session_id`、`parent_session_id`、`agent`、
    `scope`、`dispatch_id`。
- 旧台账自动迁移：历史记录缺 `parent_session_id` 的，一律落到 `state: 'done'` 并标记 `legacy: true`，
  不会让会话被历史派工永久锁死。
- 台账文件位置不变：`${PLUGIN_DATA}/dispatches.json`（插件包只读区之外，跨会话持久）。

**为什么**

「派工」和「执行」是两类事件，发生在两个不同的会话上，用一张表记必然混淆语义 ——
这正是 v0.3.x 两个方向同时出错的根因。
拆成两层后：派工侧按父会话聚合（用于组队闸门），执行侧按子会话绑定（用于越界判定），各归其位。
旧记录强制置为 done，是为了不让一次历史派工把会话锁死。

**怎么验证**

- 仓库回归：`node .superagent/e2e-test.mjs` 第 2 组断言派工记录带 `dispatch_id`，
  且按 `parent_session_id` 能查到记录（v0.3.x 用的是 `session_id` 字段）。
- 人工确认：检查 `${PLUGIN_DATA}/dispatches.json`，应能看到 `dispatches` 与 `bindings` 两个数组，
  `dispatches` 里每条有 `parent_session_id`，worker 跑过一次之后 `bindings` 里出现对应 `session_id`。

### 验收后修补（独立验收查出的问题）

本轮发布走完了「派工 → 独立验收」闭环，验收中查出的问题当场修掉，都属于 0.4.0 的一部分。

**改了什么**

- 部署改为**全量同步**（仓库侧 `tools/deploy-plugin.mjs`）：早期版本只同步 4 个脚本与 hooks.json，
  清单文件 `.minimax-plugin/plugin.json` 永远停在旧版本 —— 机制生效了，但「版本身份」没发布出去，
  用户在安装目录看到的仍是 0.3.2。现在仓库 plugin/ 里有什么，安装目录里就是什么。
- `gate.mjs` 的意图粗筛补上「拆给」：README 给用户的示例句「帮我把这个需求拆给合适的成员」
  实测命中不了，用户按文档操作会误判 Hook 没装上。
- `guard.mjs` 的危险操作补上 `miniapp` 键（原先只有 `miniapp_publish`），
  `hooks.json` 的 matcher 两种写法都覆盖。
- `watchdog.mjs` 的「声称产出的文件必须真实存在」判定收窄到**带产出动词的句子**：
  交付报告里遍布「引用 / 核对 / 读过」的路径，那些不是声称产出。
  原实现会把正常的验收报告误判成「声称产出但文件不存在」，连续拦两次。
- README 的危险操作措辞改为「子代理会话里一律拦；Router 父会话不拦」，避免被读成无条件拦截。
- scope 解析现在接受**带盘符的绝对路径**（`C:/...`）：装到工作区之外的目录也能声明边界。
  此前 `PATH_LIKE` 不接受盘符，这类路径连写进 scope 都不行。

**为什么**

这五条里有三条是「文档或发布承诺了，但实现没兑现」：发布版本号没落地、示例句打不中、
危险工具名对不上。剩下两条是判定过宽造成的误伤 —— 误伤本身不危险，
但它会让 worker 反复改写交付说明，把真正该看的内容淹掉。

**怎么验证**

- 仓库回归：chain-test 新增第 13 组（`miniapp` / `miniapp_publish` 两种工具名都被拦）
  与第 14 组（报告里引用到的路径不被当成产出）。
- 仓库回归：chain-test 第 11 组（worker 能读自己的方法论文件）——
  方法论是「把一件事做到精」的载体，它必须可读，否则整套机制是断的。
- 人工确认：`node tools/deploy-plugin.mjs` 输出最后一行是 `INSTALLED_VERSION=0.4.0`。
- 人工确认：README 第 2 步的示例句「帮我把这个需求拆给合适的成员」实测能触发
  `[super-agent-router] 本轮按编排流程处理。`

### 兼容性与升级注意

- 插件包版本从 0.3.2 升到 0.4.0；`plugin/.minimax-plugin/plugin.json` 的 `version` 已同步。
- **Hook 按会话激活**：安装或升级之后必须新开一个会话，旧的会话不会重新注入协议。
  在旧会话里看不到新行为，不一定是没生效，先新开会话再判断。
- 本次不改动 Hook 的判定事件与响应契约。`plugin/hooks/hooks.json` 只改了危险工具的
  matcher（补上 `miniapp_publish`），事件名与响应结构未变，
  现有 `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `SubagentStop` 接线方式照旧。
- 旧的 `dispatches.json` 无需手工迁移，程序读取时自动处理。

## [0.3.2] - 2026-11-09

- 派工缺 SCOPE 直接拒绝（此前无白名单 = 无边界，授权模型被绕开）。
- 派工台账去重键改为 session + turn + agent（此前覆盖前一条，前 worker 的 scope 丢失）。
- watchdog 增加文件存在性校验，堵住编造产出。

## [0.3.0]

- 引入实战记录（履历）机制：验收通过后由 `record-gate.mjs` 写入，`verified_by` 不能是执行者自己。

## [0.2.0]

- 插件包成型：hook 接线、skill 与 references 拆分、错题本与实战记录分离到项目层。

## [0.1.0]

- 初始版本。
