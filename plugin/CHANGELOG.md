# Changelog

本文件记录 super-agent-router 插件包的版本变更。
格式参考 Keep a Changelog，版本号遵循语义化版本。

## [0.5.5] - 2026-11-10

本版把 v0.5.4 独立验收（`docs/audit/verification-v054.md`，VERDICT: FAIL）暴露的六条缺陷逐条修掉，
并把「权限等级 tier + 越界自动审核」这套机制的**边界写清楚**。

一句话：**权威面脚本列为父会话专属（主防线）**，批准人必须是真实父会话 id（纵深防御），
权限等级按派工时快照，文档里按现状不成立的断言改成与契约 S13.5 一致的诚实措辞。

### 变更 1：权威面脚本列为**父会话专属**（F1 主防线）

**改了什么**

- `plugin/scripts/guard.mjs`：bash 通道新增判定 —— 子代理上下文（载荷带 `agent_type`）里
  执行插件安装目录下的**权威面脚本**（`scope-amend.mjs` 提权与批准、`release-slot.mjs` 释放名额、
  `record-gate.mjs` 写履历、`lessons-gate.mjs` 写错题本、`roster.mjs` 登记成员）一律拒绝；
  父会话不受影响（父会话载荷没有 `agent_type`）。
  匹配按**插件根目录下的具体文件**（`path.resolve` 后的绝对路径），不按脚本名裸匹配 ——
  工作区里的同名副本是普通文件，不误拦；`~` / `$HOME` / `%USERPROFILE%` 展开后再比对。
- `plugin/scripts/scope-amend.mjs`：`--grant` / `--deny` / `--dispatch --add` 的 `--approver`
  必须是该派工的 `parent_session_id`；`--tier` 的 `--approver` 必须是派工台账里存在过的父会话 id。
  `--list` 的待审清单直接给出 `parent_session_id`，父会话照抄即可。
- `plugin/scripts/session-start.mjs`：注入文案不再教 `--approver router`，
  改为「批准人必须是真实父会话 id」（待审清单 `--list` 直接给出该值）。

**为什么**

独立验收在沙箱里端到端跑通：worker 用 bash 执行 admin CLI 给自己提权到 full、
并自批准自己的越界请求（请求号还是护栏的拦截文案直接印出来的）。
根因是 admin CLI 无调用者身份校验，而护栏不把权威面脚本当父会话专属工具。

**诚实边界**：`--approver` 校验是**纵深防御**，不是主防线 —— worker 的派工原文里就带着
`PARENT SESSION:`，所以它挡不住蓄意自提权；主防线是护栏那条「父会话专属」判定。
复制脚本改名再跑、或用内联代码直接写文件，都不在判定范围内（hook 是护栏不是沙箱，S13.5）。
工作区里的同名副本按设计**不拦**（它不是运行时加载的权威入口），
但若那份副本能写同一个 `roster.json`，仍是一条提权路径 —— 由上面两层纵深防御削弱，不是零。

**怎么验证**

- `tests/guard-test.mjs` 新增 4 条：子代理执行权威面脚本被拒 / 父会话执行同一脚本不受这条规则拦 /
  工作区里的同名副本不被误拦 / 同名副本照常按 scope 判定放行。
- `tests/scope-amend-test.mjs`：`--grant` / `--dispatch --add` / `--tier` 三处批准人校验，
  `--list` 给出父会话 id。
- 变异检验（`docs/audit/.tmp-fix/mutation-check.mjs`）：回退权威面脚本判定与批准人校验，
  对应新断言分别变红 —— 新断言不是恒绿空断言。

### 变更 2：两条扩权路径同口径 + 台账迁移不再伪造「已完成」（F2 / RG-03）

**改了什么**

- `plugin/scripts/lib.mjs`：`grantScopeRequest()` 补派工状态检查 ——
  对已结束（done/aborted）的派工批准请求**拒绝**，文案与「直接加条目」分支一致。
- `plugin/scripts/lib.mjs`：台账的 legacy 迁移**不再把 `active` 提升成 `done`** ——
  以前补字段时无条件写 `state='done'`，等于替一个还没结束的派工伪造「已完成」，
  record-gate 的履历真实性判据因此被绕过。迁移只补缺失的字段。

**为什么**

- F2：只查一条路径，口径就会分裂 —— 「批准必须落在仍在飞的派工上」这条硬规矩
  在 `--dispatch --add` 上成立、在 `--grant` 上不成立，等于没有规矩。
- RG-03：迁移把 `active` 写成 `done`，是替一个**还没结束**的派工盖上「已完成」的章；
  record-gate 判「验收方真实存在」的依据正是台账里那条 `state='done'` 的记录，
  伪造状态等于伪造验收凭据。

**怎么验证**

- `tests/scope-amend-test.mjs` 新增 6 条：`--grant` 对已结束派工被拒（done/aborted 各三条）、
  与「直接加条目」文案同口径、请求保持 pending；legacy 迁移保持 `active`、
  无状态旧行仍落 `done`（保留防锁死语义）。
- 变异检验：回退 `--grant` 状态检查变红 6 条；回退 legacy 迁移变红「legacy 行仍是 active」。

### 变更 3：full 等级命中私有目录的文案不再误诊（F3）

**改了什么**

- `plugin/scripts/guard.mjs`：越界诊断按目标分型 —— 私有状态目录（`.superagent/`）与工作区外
  两种文案分开。私有目录说「在编排层私有状态目录内，full 等级也不放行」，**不打印批准提示**
  （那种批准永远不生效：写模式对私有目录一律不授写权），免得把父会话引去做无效批准。

**为什么**

原文案说的是「在工作区之外」，而目标是工作区**之内**的 `.superagent/` —— 诊断结论错了，
排查会从「权限不够」被引到「路径不对」，方向整个反了。
那句批准提示更糟：它给出的批准命令**永远不会生效**，
父会话照着做一遍发现还是拦，等于白跑一趟，还以为机制坏了。

**怎么验证**

- `tests/scope-amend-test.mjs`：full 等级命中私有目录的文案不含「工作区之外」与批准提示，
  且点明私有状态目录。
- 变异检验：回退文案分型变红 2 条。

### 变更 4：权限等级按派工时快照

**改了什么**

- `plugin/scripts/dispatch.mjs`：派工记录写入 `tier` 快照；
- `plugin/scripts/guard.mjs`：子会话绑定继承派工那一刻的等级，不再每次工具调用重读名录 ——
  会话中途的等级变更对**已在飞**的会话不生效（下一个派工才按新等级生效）。

**为什么**

等级是派工时刻的授权事实，不是一个持续生效的开关。
如果在会话中途把成员的等级改掉，这个**已经在飞**的会话会立刻跟着变 ——
那么「谁在什么时候被授权了什么」就没法复盘了，
审计留痕（`changes.log`）记的是提权时刻，而实际生效范围却变了，两边对不上。
按派工时快照，授权事实与派工记录绑在一起，一一对应。

**怎么验证**

- `tests/scope-amend-test.mjs`：派工记录带等级快照、会话中途提权对在飞会话无效、
  重新派工后按新等级。
- 变异检验：回退快照逻辑变红「会话中途提权对已在飞的会话不生效」。

### 变更 5：护栏第二道防线按形态判 + 私有记忆目录扩权当场白拒（D-58）

**改了什么**

- `plugin/scripts/guard.mjs`：第二道防线从「路径前缀命中就拒绝建立边界」改成
  「只有**目录条目**（会按读模式展开成整棵子树）才拒绝」。精确文件条目不展开，不触发这道防线。
- `plugin/scripts/lib.mjs`：判据收进共享函数（`PRIVATE_MEMORY_DIRS` / `isPrivateMemoryEntry()` /
  `expandsPrivateMemoryTree()`），派工闸门 1b、护栏第二道防线、范围层、扩权入口四处共用同一处判定。
- `plugin/scripts/scope-amend.mjs`：给私有记忆目录扩权**当场拒**，并指出契约通道
  （让 Router 转写进 brief），不再造一条永远不生效的死条目。

**为什么**

管理员批准了「精确读某个私有记忆文件」，落地却是一条**永远不生效**的死条目：
worker 拿到的是「边界建不起来」，它的工具调用全线被拦 ——
批准人的动作与实际效果完全脱节，而且机制不吭声。
把「不生效」从静默变成当场说清的白拒，批准的人立刻知道该改走哪条路。

**怎么验证**

- `tests/guard-test.mjs`：精确文件条目不触发第二道防线（worker 不卡死）、
  目录条目仍然拒绝建立边界。
- `tests/scope-amend-test.mjs`：`--grant` / `--dispatch --add` 给私有记忆目录扩权被拒。
- 变异检验：回退第二道防线的形态判、回退私有记忆死条目拦截，各有一条对应断言变红。

### 变更 6：文档与代码口径对齐（F4）

**改了什么**

- `references/contract.md`（S13.2 / S13.3 / S13.5）、`README.md`、`references/scope.md`、
  `scope-amend.mjs` 头部：删掉「worker 无权改自己的等级」这类**按现状不成立**的断言，
  改成与 S13.5 一致的诚实措辞（机制做什么 / 机制不做什么）；
  `full` 的例外由三条改为四条（补上「写冲突检测仍按声明的 SCOPE 比对」）。
- 旧的「484 条断言」补注口径（发布时 484；补 D-42/D-43 后 487），不再与同文件的另一个数打架。

**为什么**

「worker 无权改自己的等级」这句话按现状**不成立** —— hook 是护栏不是沙箱。
一条自己站不住的断言留在文档里，读者要么不信文档，要么被误导去依赖一条不存在的保证；
两种都比一开始就说清楚更坏。契约是单一事实源，文档里的断言必须站得住。

**怎么验证**

- 人工对照：`references/contract.md` S13.3 / S13.5 与 `references/scope.md` 的
  「诚实边界」「四条例外」两段，逐句读得通、与代码现状一致。

### 变更 7：部署与副本一致性核对（F5）

**改了什么**

- 重跑部署（`node tools/deploy-plugin.mjs`），并逐文件 sha256 比对仓库 `plugin/`
  与安装目录 `~/.minimax/plugins/super-agent-router`：修复时点为 28 个文件、0 处不同。

**为什么**

v0.5.4 独立验收查出：安装副本与运行时缓存树里的 CHANGELOG 落后于仓库副本 ——
脚本逐文件一致，对外口径却不一致。
「仓库改好了」不等于「用户装到的是改好的」；发布前必须两侧对齐。

**怎么验证**

- 逐文件 sha256 比对（仓库 ↔ 安装副本），差异数必须为 0。
- **发布时实测：28 对 28 文件，0 处差异** —— 部署完成后两侧逐字节一致。
  （本条目初稿时安装副本尚落后于仓库，差异 10 处 —— 那是「另一名成员的改动」与
  「本版文件尚未部署」两件事叠在一起，不是内容不一致；部署后归零。）
  逐项差异清单与处置见 `docs/audit/release-v055.md`。

### 变更 8：台账与报告入库

**改了什么**

- `docs/audit/defect-ledger.md`：新增 **D-44 ~ D-62 共 19 条**（总计 66 条）。
  本轮新增来自四处独立来源：v0.5.4 独立验收的 F1~F5、B 路错题本专项报告的 RG-01~RG-09、
  本轮实测的 D-58（护栏两层判定口径不一致），以及记录闸门修复过程中实测发现的 D-59~D-62
  （Windows 并发写路径上的四个新缺陷）。
  原报告编号前缀保留在各条目的「来源」行，台账号统一分配。
- 四份专项/验收报告入库 `docs/audit/`：
  `context-sharing.md`（A 路）、`lessons-persistence-and-isolation.md`（B 路）、
  `member-persistence.md`（C 路）、`verification-v054.md`（v0.5.4 独立验收，VERDICT: FAIL）。
- 本版三份报告入库：`docs/audit/fix-f1-f5-rg03.md`（F1~F5 + RG-03 + D-58 定向修复）、
  `docs/audit/fix-rg01-09.md`（记录闸门与统计口径定向修复）、
  `docs/audit/release-v055.md`（本版发布报告）。

**怎么验证**

- `docs/audit/defect-ledger.md` 的索引表里 D-44 ~ D-62 逐条可查，
  每条带「来源 / 严重度 / 归属层」；文件顶部「条目统计」行与实际条数一致。
- 修复报告与验收报告的编号前缀（F# / RG#）与台账「来源」行一一对应。

### 变更 9：记录闸门与统计口径补齐（写入者身份 / 段首定位 / 并发写 / 归因 / 私有账闸门 / 取样名额 / 名录去重）

**改了什么**

- `plugin/scripts/lessons.mjs`：新增 `resolveWriter(payload)` 作为**写入者身份的唯一事实源** ——
  载荷必须带 `session_id`，闸门拿它去派工台账查绑定：
  成员子会话只许写**自己**的账（`agent_key` 与 `agent` 两个别名都算同一个成员，承接 D-12），
  父会话可给本项目任意成员记账，**两者都查不到即 fail-closed 不放行**。
  同时新增 `locateRecordsSection()` / `countRecordsInSection()` / `appendRecordsEntry()`，
  写入端与读取端**共用同一处段首定位**（行首锚定，标题由常量拼出，不留第二份字面串）。
- `plugin/scripts/lessons-gate.mjs` / `record-gate.mjs`：接入身份校验；
  段首、段尾、计数、插入全部改走共用的定位函数，删掉 `record-gate.mjs` 自带的子串匹配与另一套段尾定位；
  条目内新增「写入者 / 会话 id / 时间戳」行（身份校验管「能不能写」，条目内记的是「谁写的」——
  事后审计要查的是后者）；归因判定从只查 `cause`+`rule` 扩到**逐字段**覆盖
  `symptom`/`cause`/`rule`/`next_time`，语序枚举扩到 10 条，**豁免逐字段生效**。
- `plugin/scripts/lessons.mjs`：新增 `withFileLock()`（跨进程互斥锁）与 `writeFileLocked()`
  （锁内重读 → 构造 → 临时文件 → 原子 `rename` → **落盘回读校验** → 不一致即**回滚**）；
  三条写入路径（成员错题本、Router 私有账、履历）全部改走它，
  **条数上限与编号序列判定移进锁内**（锁外判会被并发写入一起放行）。
- `plugin/scripts/lessons-gate.mjs`：新增 `--router` 私有账写入闸门，**独立成路**
  （不复用成员校验链 —— 私有账是契约 S1 的 7 字段格式，混在成员链里必然被拒，
  S9 的「改为记进 `_router.md`」就会永远走不到），四道校验：写入者身份、S1 七字段齐全、
  编号不跳号不重号、上限 50 + 留痕。
- `plugin/scripts/records.mjs`：新增导出 `SUMMARY_MAX_MEMBERS = MAX_ROSTER`，
  CLI 默认参数与注入层同源；摘要返回值新增 `duplicateNames` 披露字段。
- `plugin/scripts/roster.mjs`：新增 `dedupeByName()` 与 `duplicateNames()`，
  名录按 name 去重**并显式报出重名异常**（不静默去重 —— 静默去重会让「名录被人手改过」这件事消失）。
- `plugin/scripts/lessons.mjs`：三态读取（`no-file` / `empty` / `unreadable` / `entries`），
  **「有条目却抽不出规则」是异常态，不谎报成「还没栽过跟头」**。
- 契约与文档：`plugin/skills/super-agent-router/references/records.md` 写入闸门补 `session_id`
  要求与身份判据、条目格式补「写入者」行；`gate.mjs` / `session-start.mjs` 的取样名额改为引用
  `SUMMARY_MAX_MEMBERS`，`dispatch.mjs` 的教训注入改用 `lessonsStatusLine(name)`。

**为什么**

错题本与履历是 Router 做路由匹配、派工时前置参考的**依据** ——
「谁在写」不校验，就能写进兄弟成员的账（冒名记账）；
「写到哪一段」两套口径，就会写进去却读不出来（**静默丢失**，读取端表现为「本来就没有」）；
「并发怎么落盘」无锁无原子替换，就会静默丢条目，**而每次写入都返回 `ok:true`** ——
调用方以为记上了，实际没有。
取样名额两处口径不一致（CLI 8 vs 注入层 12）与名录重名不去重，
会让同一个成员在摘要里出现两次、或让排位靠后的成员结构性不可见。
这四个问题都在**同一条写入链上**，一次补齐比分开修便宜。

**怎么验证**

- 新增回归断言 **54 条**（以 `be9caa3` 为基线、同一口径实测：lessons-test 19→52、
  records-test 30→46、roster-test 18→23）。
- 并发断言用**真并发**（异步 `spawn`；`spawnSync` 包在 Promise 里仍是串行，去掉写锁照样绿），
  且**多轮跑**：错题本 12 并发 × 3 轮、履历 16 并发 × 3 轮
  （丢条目是概率性的 —— 单轮绿红各出现过一次）；
  断言把「明确失败」与「静默丢失」**分开记**，红的时候能直接看出是哪一类。
- 变异检验 **12 个变异体**（`docs/audit/.tmp-gate2/mutation-check.mjs`）逐一把修复整段回退，
  对应的新断言全部变红 —— 新断言不是恒绿空断言。
- 回归：仓库副本与安装副本**各跑十一套，0 FAIL**，两侧逐项相同。

### 变更 10：修并发写时实测发现的四个新缺陷（D-59 ~ D-62，全在 Windows 并发写路径上）

**改了什么**

- **D-59**：`plugin/scripts/lessons.mjs` 的原子替换加重试 —— Windows 上 `rename` 覆盖**正被其它进程打开**
  的目标文件会报 `EPERM`（读句柄未共享删除），那条记录**根本没落盘**而旧实现返回「成功」。
  改为最多重试 40 次（退避 25ms + 10ms/次，总窗口约 8.8s，覆盖 `EPERM`/`EBUSY`/`EACCES`），
  且**临时文件只写一次** —— 每次重试都重写临时文件会多触发一次杀毒软件扫描，
  而扫描正是 `EPERM` 的来源。
  （Linux 上 rename 覆盖总是成功，这个坑**只在 Windows 显形**。）
- **D-60**：落盘回读校验失败时**加回滚** —— 校验只是「发现覆盖」，不是「避免覆盖」；
  不回滚的话，那一次失败写入就把前序所有条目一起抹掉。
  回滚后失败的那次写入对文件**没有副作用**，调用方看到 `ok:false` 就知道这条没记上，可以重试。
- **D-61**：抢锁判据改为 `EEXIST` / `EPERM` **一律当作「暂时拿不到」继续等** ——
  Windows 上锁文件已存在且正被打开时，CreateFile 报 `ERROR_SHARING_VIOLATION`，
  Node 映射成 `EPERM` 而非 `EEXIST`，于是并发写会随机报「获取写锁失败」，
  **锁机制本身是对的却被误判成失败**。
  不再用 `existsSync` 去区分「占用」与「权限问题」—— 第一版修法就是这么写的，仍然偶发失败：
  杀软扫描时文件被标记 delete-pending，路径已解析不到，`existsSync` 返回 false 而 `openSync` 报 `EPERM`。
- **D-62**：锁等待超时 15s → **60s**，偷锁阈值 60s → **180s** ——
  持有者遇到 rename `EPERM` 时会在临界区里重试约 9s，16 个写入方排队时最后一个要等 15 × 9s，
  15s 超时会把它们**误判成失败**。偷锁阈值必须**大于**等待超时，
  否则会把「还在用的锁」当陈旧锁偷走，两个写入方同时进临界区。

**为什么**

这四条在台账里原本**不存在** —— 它们是「把并发写真正修对」时才暴露出来的。
旧口径之所以能长期「看起来是好的」，恰恰是因为它**每次都返回成功**：
丢条目、抹掉前序条目、抢锁误判失败，全都藏在 `ok:true` 后面，没人看见。
并发路径上的缺陷只有真并发才测得出来 —— 这也是变更 9 里断言必须用异步 `spawn`、
且必须多轮跑的原因（单轮绿红各出现过一次，概率性缺陷的单轮观察是噪声）。

**怎么验证**

- **诚实说明覆盖范围**：这四条**没有各自专门的变异体** —— 12 个变异体覆盖的是
  D-49 / D-51 / D-52 / D-53 / D-55 / D-56 / D-57。
  D-59 与 D-60 的修复代码在 `writeFileLocked` 段内、D-61 与 D-62 在 `withFileLock` 段内，
  而 M4 / M12 回退的是**整个 `writeFileLocked`**（含写锁、rename 重试与回滚），
  所以这四条被 M4 / M12 **连带回退**，并发断言随即变红 ——
  但这是「被整段回退连带覆盖」，**不是逐条变异证明**。
- 并发断言在真并发 + 多轮下稳定检出：回退写锁实现后，
  **最少落盘条数从 12 条 / 16 条掉到个位数**（本次实测：错题本侧 3 条、履历侧 2 条；
  这个数每次跑都不同，是概率性的）—— 检出从「碰巧绿」变成稳定红。
- 失败原因探针把「明确失败数」与「首条失败原因」打出来，
  三种失败原因（断言设计错误 / 锁 `EPERM` / rename `EPERM`）修法完全不同，
  **不看清就是在猜** —— D-59 与 D-61 正是这样定位到的。
- 回归：仓库副本与安装副本各跑十一套，0 FAIL。

### 怎么验证（总体）

- `node tools/run-tests.mjs --all --root <repo>/plugin --repo <repo>`（仓库副本）与
  `node tools/run-tests.mjs --all --repo <repo>`（安装副本）：
  **两侧各跑十一套，全部 0 FAIL，逐项相同**（本条发布时的实测）。
  本轮改动直接涉及的五套 —— `guard-test`、`scope-amend-test`、`lessons-test`、
  `records-test`、`roster-test` —— 均 0 FAIL。
- **全量断言总数以发布前最后一次实测为准** —— 断言条数随套件增删变动，
  钉死一个数会被下一个人立刻推翻。本条目不写总数。
- 变异检验共 **20 个变异体**逐一回退本版修复，对应的新断言全部变红 ——
  新断言不是恒绿空断言：
  8 个（`docs/audit/.tmp-fix/mutation-check.mjs`，F1~F5 + RG-03 + D-58）、
  12 个（`docs/audit/.tmp-gate2/mutation-check.mjs`，记录闸门四口径 + Windows 并发写四缺陷）。
- 包内自洽性：manifest 与 `hooks.json` 引用的脚本逐个存在、版本号与本条一致、
  README 的命令与脚本真实支持的开关一致 —— 逐条结果见 `docs/audit/release-v055.md`。

## [0.5.4] - 2026-11-10

本版给子代理**权限自动审核**与**权限等级**：撞墙自动记账、父会话一键批准；
成员等级可提到「项目内全权」，人人平等、提权在管理员手里。

### 变更 1：权限自动审核 —— 越界请求自动记账，一键批准

**改了什么**

- `plugin/scripts/guard.mjs`：新增 `denyOutOfScope()` —— 越界被拒时**自动**把「谁想访问什么、被拒了什么」
  记进台账 `scope_requests[]`，并给出可复制的 `--grant` 命令；
  同一目标重复撞墙只记一条（`hits` 累加），不把待审清单淹掉。
- `plugin/scripts/lib.mjs`：新增 `recordScopeRequest()` / `grantScopeRequest()` / `denyScopeRequest()`；
  台账新增 `scope_requests` 段，待审条目上限 50 条（只增不减的池子会变垃圾堆）。
- `plugin/scripts/scope-amend.mjs`（新增）：`--list` 看待审清单、`--grant` / `--deny` 批准或拒绝、
  `--dispatch --add` 直接给仍在飞的派工加条目。
- 契约新增 **S13.1 / S13.2**。

**为什么**

本轮实测三次撞墙：两名专项成员与验收方都被 scope 墙拦住，父会话要靠 task_append 人工补口径才救回来。
原来的恢复手段只有「改 brief 重新派工」（重开一次派工、浪费名额与上下文）或「等 worker 自己汇报」。
现在越界请求自动进待审清单，父会话一条命令就能批。

**怎么验证**

- 新增 `tests/scope-amend-test.mjs`：撞墙→记账、清单可见、批准后当场放行、
  **批准读不等于批准写**、拒绝后仍拦、对已结束的派工扩权被拒、同一目标重复撞墙只记一条。

### 变更 2：权限等级 tier —— 「全部」这一级，人人都能用

**改了什么**

- `plugin/scripts/lib.mjs`：新增 `memberTier()` / `readRoster()` / `withinWorkspace()`；
  权限等级声明在项目级 `.superagent/roster.json` 的成员条目上（`scoped` 默认 / `full`）。
- `plugin/scripts/guard.mjs`：full 等级成员在**项目工作区内自由读写**，不必逐路径枚举白名单。
- `plugin/scripts/scope-amend.mjs`：`--tiers` 看等级、`--tier full|scoped --agent <名> --approver <人>`
  授予 / 收回；写进 roster.json 并留痕 `.superagent/changes.log`。
- `plugin/scripts/session-start.mjs`：注入权限等级说明，并列出当前 full 成员
  （Router 得知道谁能在项目内自由干活，否则提权了也不会被派上活）。
- 契约新增 **S13.3**。

**为什么**

逐路径白名单对「派一个大活」太琐碎，而「限制得太死」的代价是真实的 —— 本轮多名子代理反复撞墙，
验收方被拦，产出做不完。但放开不能变成「谁都能给自己放行」：让被约束者自己决定边界等于拆掉授权模型。
所以自动的是**发现与记账**，批准权始终在管理员手里；**每个成员都平等**，任何人可被提权，
但提权动作不在被约束者手里。

**full 不等于无限权限**（三条照旧生效）

1. `.superagent/` 编排层私有状态目录除外 —— 那是成员互相篡位、自己给自己提权的战场；
2. 工作区之外的路径仍拦，仍自动记账待审；
3. 账号级 / 对外不可逆动作（删成员、改成员、部署、发布）照旧硬拦。

**怎么验证**

- `tests/scope-amend-test.mjs`：scoped 白名单外仍拦、提权后项目内读/写/新文件放行、
  工作区外仍拦且记账带 tier、账号级动作仍硬拦、`.superagent/` 写仍拦（相对路径与绝对路径各一条）、
  提权写进 roster、收回后恢复拦截、对名录外成员提权被拒。

### 变更 3：派工闸门 1c —— SCOPE 里的 .superagent/ 分三种形态判

**改了什么**

- `plugin/scripts/dispatch.mjs`：新增闸门 1c —— 目录条目拒派、可写条目拒派、
  只读文件条目允许但**精确生效**；私有记忆目录（lessons / methods）一律拒派（闸门 1b）。
- `plugin/scripts/lib.mjs`：新增共享判定 `touchesSuperagentPath()`（guard 与 dispatch 共用同一处）；
  `inScope` 的读模式遇 `.superagent/` 条目**跳过树根展开**（精确生效），
  写模式对 `.superagent/` 条目一律不授写权。
- `plugin/scripts/guard.mjs`：加第二道防线 —— worker 的边界若直接从 transcript 的 brief 建起来
  （不经 dispatch），brief 里含私有记忆目录时**直接拒绝建立边界**。

**为什么**

D-31 只封了 `lessons/` 与 `methods/` 两个目录，但同一个漏洞在别的条目上照样成立：
读模式下**文件条目的读范围是它所在的整个目录**，所以 `ro: .superagent/roster.json` 这一条的读范围
也是整个 `.superagent/` —— 能读到兄弟成员的错题本全文与方法论全文。
写权限更糟：那份名录存着权限等级，能改它就是自己给自己提权。

一刀切拒派也不对 —— 那会把「读编排层状态文件（名录 / 审计日志）」也堵死，
而**独立验收方必须能读到并运行测试套件**才谈得上验收。所以按条目形态分判：
能精确读到的那一个文件放行，会展开成整棵树的拒派。

**怎么验证**

- `tests/scope-amend-test.mjs`：目录条目被拒 / 可写条目被拒 / 私有记忆目录被拒 /
  只读单文件条目可派且**读兄弟成员的错题本仍被拦** / brief 直接塞私有目录时 guard 拒绝建边界。

### 变更 3b：验收方实测当场抓出的两处判定缺陷

**改了什么**

- `plugin/scripts/lib.mjs`：新增 `isPrivateMemoryPath()` ——
  **私有记忆路径（`.superagent/lessons/`、`.superagent/methods/`）除精确文件通道（mode=exact）外，
  任何 scope 条目都不授予**（D-42）。
- `plugin/scripts/lib.mjs`：`inScope` 的条目侧改为**同时按绝对式与相对工作区的相对式**比对，
  并补「条目就是工作区根本身」这一情形（D-43）。

**为什么**

这两条都是本轮独立验收方**在真实派工里撞出来的**，不是读代码想出来的：

- **D-42**：派工闸门 1c 判的是「条目路径本身碰没碰 `.superagent/`」，
  但读模式对**目录条目**会展开整棵树 —— 一条 `ro: <工作区根>/` 的路径本身不碰 `.superagent/`，
  闸门无从拦起，可它的读范围**连带把兄弟成员的错题本也放开了**。
  **堵入口不够，读范围本身也要判。**
- **D-43**：契约 S2 写着「绝对路径先折算成相对工作区的相对路径，两种写法都能命中」，
  但以前只有「目标写相对路径」这一半成立 —— SCOPE 写绝对路径时，worker 用相对路径调用全程被误拦。
  根因是**归一化只做了一端**：目标侧折算了，条目侧没有。

**怎么验证**

- `tests/scope-amend-test.mjs` 新增 3 条：覆盖工作区的目录条目**可派**、但**读不到兄弟成员的错题本**、
  同时**仍能读工作区里的普通文件**；十一套 487 条断言全绿。

### 变更 4：编排层教训回流 + 私有记忆目录拒派（v0.5.3 之后补上的三条）

- **D-32** `plugin/scripts/lessons.mjs` 新增 `readRouterLessons()`，`session-start.mjs` 注入
  「【编排层自己的历史教训】」—— 契约 S9 与 review.md 早就写着「由 SessionStart 注入 Router 上下文」，
  代码从未实现。Router 的私有账用了 S1 的七字段模板，不能复用抽「- **规则**：」的那条正则。
- **D-31** `dispatch.mjs` 闸门 1b：SCOPE 不得覆盖 `.superagent/lessons/` 与 `.superagent/methods/`。
- **D-33** `references/scope.md` 更正：「实战记录注入给 worker」与代码不符 ——
  履历是匹配时给 Router 的参考，不进 worker。

### 变更 5：测试套件搬家 + 验收壳进仓库

**改了什么**

- 十一套回归从 `.superagent/` 移到 `tests/`。理由：`.superagent/` 是**成员的私有记忆目录**
  （方法论 / 错题本 / 名录 / 审计日志），而测试套件是**项目资产**。
  两者混在一处，导致「谁读得到什么」这条边界说不清 —— 现在私有目录封死，项目资产走正常 scope。
- 验收壳从临时目录收进仓库：`tools/run-tests.mjs`（自动发现 `tests/*-test.mjs`）。
  理由：验收壳是证据链的一环。放在 temp 里的壳，「谁在什么口径下跑的、跑的是哪几套」
  第三方无法复核 —— 而「十一套回归 0 FAIL」这句话本身就是要被独立验收的断言。

**怎么验证**

- `node tools/run-tests.mjs --all --root <repo>/plugin --repo <repo>` → 十一套 484 条断言 0 FAIL
  （这是 v0.5.4 **发布时**的数；补 D-42 / D-43 之后是 487 条，见变更 3b）；
  `node tools/run-tests.mjs --all --repo <repo>` → 安装副本同样 0 FAIL。

### 变更 6：文档与台账

- 缺陷台账补 D-31 ~ D-36；C 路成员审计（`docs/audit/member-persistence.md`）的
  MP-01 / MP-02 / MP-03 / MP-A1 / MP-A2 入账为 D-37 ~ D-41（未修复项标注待修）。
- `references/contract.md` 新增 S13；README 新增「权限等级」「子代理撞墙了怎么办」两节。

## [0.5.3] - 2026-11-10

本版给**主 agent 定位**：它是管理层，不是执行层。

### 变更 1：SessionStart 注入写明主 agent 的管理层定位（契约 S12）

**改了什么**

- `plugin/scripts/session-start.mjs`：注入里新增「你的定位是**管理层，不是干活的**」判断顺序 ——
  已有专项成员 `owns` 这件事就派工、主 agent 不亲自上手；无专精成员但有方法论要求，
  先现场配置成员（方法论文件 → 建成员 → 登记 roster）再派工；只有单点小改才自己直做。
- 注入里补**分工边界**：意图理解 / 拆解 / 组队 / 整合 / 给用户结论归主 agent；
  具体实现 / 批量取证 / 独立验收**不归**它（worker 自述完成不算完成）。
- 注入里补**成员记忆共享但隔离**：教训、履历、方法论各归各的，派工只注入目标成员自己的历史；
  发现串味（别人的教训进了别人的 brief、两个成员抢同一个 `owns`、有人改了别人的记录）
  按缺陷处理并改归属映射。
- 契约新增 **S12**；`plugin.json` 描述同步。

**为什么**

要求是「对话开始的主 agent 要尽可能作为管理层、不做苦力」，而这条指令需要落在主 agent 的提示词里。
本机主 agent（内置 `mavis`）是**内置模板**，`mavis agent update` 直接返回
「Built-in Agent templates are immutable.」—— 提示词本身不可改（原文已备份到
`docs/audit/main-agent-system-prompt.before-2026-11-10.md`）。

真正能在「对话开始」注入到主 agent 的、已装且每次会话都生效的位置，是**插件的 SessionStart 注入**，
所以把这条定位写进注入，并落成契约 S12 + 回归断言。
（原文备份保留，便于将来内置模板开放编辑时直接套用。）

**怎么验证**

- 新增 `tests/hooks-test.mjs` 断言：注入必须含「管理层」「有就派工」「分工边界」「独立验收」
  「共享但隔离」「单点小改」，且「不预置成员」与「管理层定位」必须**同时出现** ——
  两者是分开的两件事（不预置成员 ≠ 有成员也不派），不能互相打架。
- 回归十套，仓库副本与安装副本均 0 FAIL。

### 变更 2：独立验收发现逐条修复（VERDICT FAIL → 修完）

独立验收判 **FAIL**，给了 7 条发现；本版逐条修完：

| # | 发现 | 修法 |
|---|---|---|
| F1 | `plugin/scripts/lib.mjs` 里仍把已证伪的「平台不对 run_code 容器派发 PreToolUse」当作**现行事实**陈述，且与 `guard.mjs` 的正确措辞自相矛盾 | 照 guard.mjs 的现成措辞改写为「派发不是平台恒定行为，随会话而变 ⇒ 复合层只能当纵深防御的加成」，并注明 D-26 原结论已被证伪、勿再写回 |
| F2 | README 排查第 10 条的命令原样复制**跑不通** —— PowerShell 的原生参数解析会吃掉 JSON 里的双引号（`{"id":"a"}` → `{"id:a}`，非法 JSON） | `release-slot.mjs` 新增**开关形式** `--dispatch / --parent / --agent / --reason / --data-dir / --all`（不含引号，跨 shell 一致）；README / 契约 / CHANGELOG 全部改用开关形式；JSON 形式仍兼容，但不再作为文档推荐写法 |
| F3 | `docs/audit/d27-acceptance.md` 的变异阈值写虚了（M1 ≥15、M2 ≥15） | 按实测改真：M1 ≥10（实测 13）、M2 **≥1**（实测 1）、M3 ≥3（实测 5）；写清「M2 只有 1 条」的原因（23 条里只有 1 条走信号词+动作词路径，其余靠意图词路径，长度门槛对它们不是闸门），并提醒「断言变红 ≠ 覆盖面大」 |
| F4 | D-29 的修复在 `PLUGIN_DATA` **带尾斜杠**时失效（正则锚末尾被打破 → 又多套一层） | 判定改用 `path.basename` 比对（会忽略末尾分隔符）；新增回归断言覆盖尾斜杠形态 |
| F5 | `plugin.json` 描述漏了 D-29 / D-30 | 补齐 |
| F6 | D-28 的「done/aborted 不动」不变量其实由上游过滤器保证，不是 `markDispatchAborted` 自身 | 非缺陷，已在台账注明；不变量仍有两层保护 |
| F7 | 主 agent system prompt 备份是未跟踪文件 | 已入库 |

### 变更 3：思维导图去版本化

按独立验收的建议，思维导图不再按版本号命名，也不再写任何**必然漂移**的字段
（版本号、Hook 规则条数、契约条款编号）：

- 改名 `docs/插件架构说明.html`，只保留结构性内容（授权模型四层语义、五段闭环、触发三档、六条硬规矩）。
- 版本相关的一切指向 `plugin/CHANGELOG.md` 与 `references/contract.md`。
- 在册成员一节改为「形态示例」，并注明实际名单以 `.superagent/roster.json` 为准。
- 两份更旧的同名产物（v0.4.0 版、链路图）一并归入回收站。

**理由**：一份自称权威、实际每次升版都会漂的文档，比没有更危险 ——
它会把「随会话而变」这类事实固化成「平台恒定性质」（D-26 就是这么发生的）。

## [0.5.2] - 2026-11-10

本版补一个**机制自带入口**：派工被取消后，把并发名额还回来。

### 变更 1：新增 `scripts/release-slot.mjs`（D-28）

**改了什么**

- 新增 `scripts/release-slot.mjs`：显式释放仍在飞的派工名额。
  用法：`node scripts/release-slot.mjs --dispatch dsp_xxx --reason parent_cancelled`，
  或 `--parent mvs_xxx` 释放该父会话下全部在飞派工（开关形式不含引号，跨 shell 一致；
  JSON 形式仍兼容，但 PowerShell 会吃掉其中的双引号 —— 独立验收 F2 实测）。
- 只把 `state=active` 的记录翻成 `aborted`；`done` / `aborted` 的记录一个字节都不动。
- 目标 id 不存在、或台账读不出来时**报错退出**，不静默「假装释放成功」。
- 契约新增 **S6.2 第 5 条**：取消场景由发起方显式释放。
- README 新增排查第 10 条「派工被取消后，名额没还回来？」，含可直接复制的命令。

**为什么**

派工被父会话 `task_stop` 取消、或子会话异常退出时，**不会触发 SubagentStop**。
而名额回收的三条路里：正常结束不覆盖、TTL 兜底要等满 2 小时、读时自愈同样以 TTL 为准 ——
于是这条记录一直占着并发名额（上限 6 个）到 TTL 结束。
表现为「机制突然不让我派工了」，但报的是「在飞派工已达上限」，完全不指向真正原因。

本轮实测就是这样撞上的：派工 `dsp_mwab22ks_4iccn9` 被取消后，父会话只能靠**一次性临时脚本**
手工改台账才把名额拿回来 —— `markDispatchAborted` 虽然已导出，但没有任何 CLI / 文档告诉调用方怎么用。
**机制没有入口，纪律就落不了地。**

也顺手把一条走不通的路写进契约，免得下次再去试：台账条目里**没有子会话 id**，
所以「自动探测子会话是否还活着」不可行；能自动拿到的只有终止事件，而取消场景下没有终止事件。

**怎么验证**

- 新增常驻回归 `tests/dispatch-release-test.mjs`（24 条断言）：
  缺 payload / 非法 JSON / 台账读不出来 → 报错退出；释放单条 → state、end_reason、ended_at 落盘；
  done / aborted 记录不动；未知 id → 报错且在飞数不变；按父会话批量释放；按成员收窄；
  `--data-dir` 与 `PLUGIN_DATA` 两种入口；写回不丢字段；
  **安全属性**：worker 通过 bash 通道调释放入口被 scope 拦下（对照组：写自己 scope 内文件放行，
  证明边界确实建立了），台账未被 worker 改动。
- 回归从九套变十套，仓库副本与安装副本均 0 FAIL。

### 变更 2：更正一处长期传播的数字错误

hooks.json 实际是 **4 类事件 / 7 条规则**（SessionStart、UserPromptSubmit、PreToolUse ×4 matcher、SubagentStop），
但「5 类」这个说法在思维导图、`context-flow.md`、`verification-v050.md`、缺陷台账四处传了一整轮。
四处已统一更正为「4 类事件 / 7 条规则」。

### 变更 3：留痕路径更正（D-29）

`writeGateTrace` 原来无条件把痕迹写到 `PLUGIN_DATA/hooks/super-agent-router/gate-trace.jsonl`，
但运行时 PLUGIN_DATA **本身就是** `.../plugin-data/hooks/super-agent-router` —— 再拼一层就落到多套一层的怪路径。
痕迹**确实写了**，但按文档给的路径去找**找不到文件** —— 排查「为什么 gate 从不命中」的人会扑空。
**留痕存在却不可发现，等于半个静默失效。**

现在按目录名判断：PLUGIN_DATA 已是本插件目录时直接写进去，否则才补一层。
新增回归断言挂在 `tests/e2e-test.mjs`（痕迹必须落在 PLUGIN_DATA 下一层，且不得产生多套一层的怪目录）。

### 变更 4：变异自检套件并发安全（D-30）

`tests/d27-mut-test.mjs` 的 `copyPlugin()` 用**固定**临时目录名，拷贝前先清空 ——
两个实例并发跑时，后一个把前一个正在用的副本删掉重拷，前一个的 e2e 读到半拷状态，
「基线副本全绿」于是报**假红**（本轮实测命中：报红的三条是 watchdog 断言，跟 D-27 毫无关系）。

**会给假 FAIL 的测试比没有测试更危险** —— 它教人忽略红灯。
现在改用 `fs.mkdtempSync` 生成独立目录，退出时统一回收；并发双跑实测均全绿。

### 变更 5：思维导图升到 v0.5.1 并修正

`docs/super-agent-router-v0.5.1-思维导图.html`：版本号、S1~S11、触发语义、
复合层「派发随会话而变」的更正（见 0.5.1 的 D-26 翻案），并补上 v0.5.1 的两张变更卡。

## [0.5.1] - 2026-11-10

本版修两件事：**主动触发漏判 83%**，以及**一条上一版自己写错、已写进契约的平台事实**。

### 变更 1：主动触发粗筛重做（D-27）

**改了什么**

- plugin/scripts/lib.mjs 新增导出的 judgeTriggerIntent()：命中判定从 gate.mjs 抽出来，
  回归可以 import 后直接喂样本断言。
- 意图词表补口语动词短语：拆一下 / 拆解 / 分头做 / 分一下工 / 谁负责 / 派谁 / 各做各的 /
  放到后台 / 复审 / 评审 / 两个人 / 一前一后，外加机制自指（主动触发 / 触发机制）与
  多项请求（还有其他的 / 另外 / 顺便）。
- 删掉 prompt.length > 40 硬门槛，改成「信号词 + 邻近动作词」（窗口 12 字符）。
  「同时 / 多个 / 分别 / 各自 / 一起」单独出现不算意图，「并行」还要求带动作后缀。
- plugin/scripts/gate.mjs 改用严格解析；载荷解析失败或 prompt 字段缺失时写一条痕迹到
  PLUGIN_DATA 目录下的 gate-trace.jsonl，不再静默退出。
- 未命中时**条件式**兜底：仅当「roster 存在 + 有专项成员 + 该成员有实战记录」时注入一行提示，
  否则 0 字节输出。

**为什么**

v0.5.0 的粗筛只有名词化/书面说法（派工 / 组队 / 分工 / 验收 / 复盘），漏掉全部口语说法；
而 prompt.length > 40 这个门槛把信号词彻底废掉 —— 中文口语指令通常只有 3~12 字。
实测 23 条应命中的编排请求**漏了 19 条（83%）**，而用户本轮那句
「好像还有点问题就是主动触发还有其他的你看看」（21 字）本身就是漏判样本。

反过来，直接去掉长度门槛会让「同时打开这两个文件」「批量导入」「分别说明」这类普通句子误触发 ——
所以信号词必须与动作词邻近同现。**漏放与误伤是同一枚硬币**，两边都得堵。

**怎么验证**

- 语料：23 条编排意图（必须全命中）+ 6 条单点动作 + 7 条伪信号（必须全不命中），
  判据与语料见 docs/audit/d27-acceptance.md。
- 四组变异自检：回退词表 / 恢复长度门槛 / 去掉动作性限定 / 常真桩对照 —— 每组都必须让断言变红。
- 八套回归对仓库副本与安装副本均 0 FAIL。

**行为变更**：编排类口语请求现在会被识别并展开编排流程（以前多数被静默跳过）；
在「有专项成员且有实战记录」的工作区里，非编排请求会多出一行兜底提示。

### 变更 2：更正一条写错的平台事实（D-26）

**改了什么**

- references/contract.md 的 S3「容器调用的派发事实」整段重写；
  references/scope.md 复合工具章节的运行时事实注、scripts/guard.mjs 里的注释同步更正。

**为什么**

v0.5.0 写进契约与 README 的「平台不对 run_code 这类容器调用派发 PreToolUse」**是错的**。
同一份纯计算容器代码：2026-11-10 10:22 的子会话**没被派发**（日志探针：同会话的 read 有条目、
外层 run_code 无条目），14:29 与 15:10 的子会话**被派发并当场 DENY**（金丝雀复测）。
结论只能是「**派发随会话而变**」，不是平台恒定性质。

逐棵核对 67 棵 hook 缓存树：run_code 是 2026-11-10 08:19 才进 PreToolUse matcher 的，
11/9 物化的 60 棵树全部没有它，11/10 08:11 之后物化的树全部有。

**处置不变，但理由改对**：危险操作与作用域的判定仍必须落在内层通道（尤其 bash）——
理由不再是「平台不派发所以没办法」，而是「派发不可靠，不能当唯一防线」。
复合层从「预留防线」改称「**纵深防御的加成**」。

## [0.5.0] - 2026-11-10

本版把编排机制里的「静默失效」关掉了。

v0.4.0 把越界管控接到了子会话上，但判定链路上仍留着几处「算不出来就放行」的默认分支：
边界解析不出来、工具名没登记、路径 token 认不出、派工的 SCOPE 条目写不进去、工具载荷解析坏掉 ——
这些场合旧实现一律 `process.exit(0)`（放行）。静默放行比误拦危险得多：误拦会被看见并修，
静默放行不会被看见，等于那一整段管控凭空消失。

v0.5.0 把判据写成一份契约（`plugin/skills/super-agent-router/references/contract.md`，S1~S10），
机制代码按契约实现，brief / 模板 / 验收标准一律**引用**契约，不再各自复述（复述即漂移）。

本版含**破坏性行为变更**，见文末「破坏性变更与升级前检查」。

### 变更 1：scope 支持只读条目 `ro:`

**改了什么**

- `plugin/scripts/lib.mjs` 新增 `READONLY_PREFIX = 'ro:'` 与 `splitScopeEntry()`：SCOPE 条目拆成
  「可写条目」与「只读条目」两种形态，只读条目统一存成 `ro: <路径>` 字符串 —— 不引入第二套结构，
  免得出现「一处认为只读、另一处认为可写」的口径漂移。
- `inScope()` 的写判定遇到 `ro:` 条目直接跳过：只读条目**永不**授予写权限。
- `scopeClash()` 只比较可写条目：两个 worker 都只读同一个目录，不构成写冲突。
- SCOPE 行解析接受 `ro: path`（前缀独立成词）与 `ro:path`（连写）两种写法。
- `plugin/scripts/dispatch.mjs` 的拒绝提示补上只读写法示例。

**为什么**

「能读」与「能写」是两种权限，混在同一条路径列表里没法表达。
以前想让成员「看这个目录但不许改」，只能给整个目录写权限 —— 成员就此拿到了改权限。
只读条目不进写冲突检测也是配套的：两个人都只读同一处，本来就不该拦。

**怎么验证**

- 代码位置：`plugin/scripts/lib.mjs` 的 `splitScopeEntry()` / `inScope()`（写判定分支）/ `scopeClash()`。
- 人工确认：派一个 `SCOPE: ro: plugin/scripts/, docs/audit/report.md` 的工 ——
  读 `plugin/scripts/guard.mjs` 放行，写同一个文件被拦，写 `docs/audit/report.md` 放行。
- 仓库回归：`node tests/scope-test.mjs`（本版同步更新）。

### 变更 2：通道语义分离，bash 按命令意图分流

**改了什么**

- `plugin/scripts/lib.mjs` 新增通道判定的四件套：`splitCommandTokens()` / `isPathToken()` /
  `extractPathTokens()` / `isReadOnlyCommand()`，另有 `extractWriteTargets()` / `hasWriteVerb()`
  用来识别写命令的目标。
- `plugin/scripts/guard.mjs` 的 bash 分支改为**按命令意图分流**：命中只读命令白名单
  （`cat` `head` `tail` `less` `more` `ls` `dir` `grep` `rg` `find` `type` `stat` `wc` `which`
  `node --version` `git status` `git log` `git diff` `git show`）的按**读**判定，其余按**写**判定。
- 路径 token 的定义收紧为三条之一：含路径分隔符、以 `.` 开头的点目录、含已知文件扩展名。
  `console.log`、`JSON.stringify`、`v0.4.0` 这类带点的标识符**不再**被当成路径。
- 目录型目标能被识别：`rm -rf config`、`.git`、`node_modules` 这类不带扩展名的目标，
  由「动词 + 参数」这一层兜住（`extractWriteTargets()`）。

**为什么**

旧实现只有一个判定口径：有路径就按写判。结果两头都错 ——
`cat src/x.ts` 被当成写操作（读文件被拦），而 `rm -rf config` 反而因为 `config` 不像路径而被漏掉。
把「这条命令想干什么」和「这个 token 是不是路径」拆开，两个问题各自用各自的口径解决。

**怎么验证**

- 代码位置：`plugin/scripts/lib.mjs` 的 `isPathToken()`（三条判定规则逐条可见）/ `isReadOnlyCommand()`
  （白名单）/ `extractWriteTargets()`；`plugin/scripts/guard.mjs` 的 `targetsOf()` 里 bash 分支。
- 人工确认：worker 执行 `cat plugin/scripts/guard.mjs`（白名单内）应放行；
  执行 `cat ../../outside.md` 应被拦；执行 `rm -rf some-dir` 应按写判定而不是被当成「无路径」放行。
- 仓库回归：`node tests/guard-test.mjs`（本版同步更新）。

### 变更 3：glob / grep 改按「有效检索根」判定

**改了什么**

- `plugin/scripts/guard.mjs` 新增 `globRoot()`：显式 `path` 优先，缺省用当前工作区。
  glob / grep / search 的判定对象改成这个有效检索根，**不再是 pattern 本身**。

**为什么**

旧实现拿 pattern 当判定对象，同一个 pattern 在不同 `path` 下会得到相反结论，
而 `path` 指向目录时反而被拦。判定对象应该是「这次检索实际发生在哪里」。

**怎么验证**

- 代码位置：`plugin/scripts/guard.mjs` 的 `globRoot()` 与 `targetsOf()` 里 glob/grep 分支
  （`targets: [globRoot()]`）。
- 人工确认：worker 用 `grep` 在 scope 条目所在目录树内检索应放行；
  同一 pattern 改成在目录树外检索应被拦。
- 仓库回归：`node tests/scope-test.mjs`、`node tests/guard-test.mjs`（本版同步更新）。

### 变更 4：brief 解析兼容两种 transcript 变体，并按语义定位

**改了什么**

- `plugin/scripts/lib.mjs` 的 `readBriefFromTranscript()` 现在同时认两种变体：
  `compatible`（`type:"user"` + `message.content[].type:"text"`）与
  `codex`（`type:"response_item"` + `payload.role:"user"` + `payload.content[].type:"input_text"`）。
- 定位 brief 的方式从固定行号改为**按语义定位**：从文件开头逐行扫描，
  扫到第一条含 `SCOPE:` 的 user 消息为止。原先的 `slice(0, 8)` 固定窗口已删除 ——
  会话前置消息条数不固定，扫前几行等于赌。

**为什么**

以前只认 `compatible` 一种变体，遇到另一种形状的 transcript 时解析恒为 null，
整个越界管控直接失效；固定 8 行窗口则是另一条随机失效路径 ——
会话前面多几条消息，brief 就落在窗口外。

**怎么验证**

- 代码位置：`plugin/scripts/lib.mjs` 的 `userMessageText()`（两种变体的形状分支）与
  `readBriefFromTranscript()`（语义定位的扫描循环）。
- 人工确认：在一个前置消息超过 8 条的会话里派工，worker 仍能正确取到 scope（不再被拦成「无白名单」）。
- 仓库回归：`node tests/e2e-test.mjs`（本版同步更新）。

### 变更 5：解析不到边界 = 拒绝，不再放行（破坏性变更）

**改了什么**

- `plugin/scripts/guard.mjs`：brief 解析失败（变体不认识 / 没找到含 `SCOPE:` 的 user 消息 /
  transcript 读不到）时**拒绝**，拒绝理由写清具体是哪一种失败。
- 同理：台账不可读、绑定的 scope 为空、工具载荷解析坏掉 —— 一律拒绝。
- 旧实现这些场合都是 `process.exit(0)`（放行）。

**为什么**

解析不到边界 = 边界不存在。此时放行等于这个 worker 整段不受越界管控，而且不报错、不留痕 ——
管控「看起来在工作」，实际已经不在了。

**怎么验证**

- 代码位置：`plugin/scripts/guard.mjs` 中 `if (!brief.ok) deny(...)` 与
  `if (!binding || !scope.length) deny(...)` 两处（对照 diff 可见旧代码此处为 `process.exit(0)`）。
- 人工确认：派一个 SCOPE 行写不规范的工，worker 的工具调用应被明确拒绝并给出失败原因，
  而不是无声通过。
- 仓库回归：`node tests/guard-test.mjs`（本版同步更新）。

### 变更 6：危险操作改按「工具名 + 参数」二维判定

**改了什么**

- `plugin/scripts/guard.mjs` 新增 `dangerousByArgs()`：同一工具名、参数不同，后果完全不同 ——
  `mavis` 工具的 `command` 为 `agent delete` / `agent update` 时拦截；
  `miniapp` 的 `action` 为 `publish` 时拦截。
- 新增 `dangerousInCode()`：复合调用（`run_code`）内部点名危险工具时同样拦截。
- `plugin/hooks/hooks.json` 的 `PreToolUse` 写类 matcher 由 `write|edit|multiedit|notebookedit|bash`
  扩为 `write|edit|multiedit|notebookedit|bash|run_code|mavis` ——
  `mavis` 与 `run_code` 此前不在 matcher 里，这两类调用根本没进过 guard。
- `plugin/scripts/lib.mjs` 新增 `DANGEROUS_COMMAND`：对外可见的不可逆命令
  （`git push`、`gh pr create`、`npm publish`、`docker push`、`terraform apply`、`kubectl apply` 等）
  在 bash 通道按写判定且额外拦截。

**为什么**

以前只按工具名等值匹配。`mavis` 的 `command` 参数空间里就有 `agent delete` / `agent update`，
因为工具名不是 `mavis_agent_delete` 而整条绕过。删除成员、改成员配置属于账号级不可逆操作，
必须由用户亲自发起。

**怎么验证**

- 代码位置：`plugin/scripts/guard.mjs` 的 `dangerousByArgs()` / `dangerousInCode()` 与
  `DANGEROUS` 表；`plugin/hooks/hooks.json` 的 `PreToolUse` 第二个 matcher。
- 人工确认：在 worker 会话里执行 `mavis` 的 `command = "agent delete ..."`，应被拦；
  执行 `git push`，应被拦。
- 注意：`hooks.json` 的 matcher 变更**必须新开会话才生效**，旧会话里这两类调用仍不受 guard 约束。
- 仓库回归：`node tests/hooks-test.mjs`（本版同步更新）。

### 变更 7：未登记的文件类工具名一律按写判定

**改了什么**

- `plugin/scripts/guard.mjs` 新增 `toolKind()`：已登记工具按名分流
  （写类含 `write` `edit` `multiedit` `notebookedit` `bash` `apply_patch` `patch`；
  读类含 `read` `glob` `grep` `list` `search` `notebookread`）；
  明确不碰工作区文件的工具（`web_search` `web_fetch` `task` `think` `todo` `self_reminder`
  `tool_search` `skill` `ask_user`）不参与判定；
  **剩下的、名字长得像文件类工具的未登记工具，一律按写判定**。
- 取不到目标路径时一律拒绝（写类工具拿不到路径，说明载荷形状变了或工具坏了）。

**为什么**

兜底表以前是空的 —— 护栏在最外层开了一道没规则的口子：
一个新出现的文件类工具名不匹配任何已知名单时，旧实现 `process.exit(0)` 直接放行。
「不认识」不等于「安全」。

**怎么验证**

- 代码位置：`plugin/scripts/guard.mjs` 的 `toolKind()` 与 `FILE_TOOL_HINT` 正则。
- 人工确认：worker 调一个未登记但名字像文件操作的工具（如 `my_file_writer`）应被按写判定处理，
  而不是直接放行。
- 仓库回归：`node tests/guard-test.mjs`（本版同步更新）。

### 变更 8：派工去重键不再只依赖 `turn_id`

**改了什么**

- `plugin/scripts/dispatch.mjs`：去重键由「父会话 + agent + turn_id」改为
  「父会话 + agent + (`turn_id` || `tool_use_id`)」。
- 命中已有记录时**只覆盖完全相同的那一条**（原地覆盖，保留 `dispatch_id`）。
- `turn_id` 与 `tool_use_id` 都拿不到时不去重：宁可多一条记录，也绝不抹掉别的记录。

**为什么**

旧实现只用 `turn_id`。载荷缺该字段时它是空串，而「空串 === 空串」对**所有**历史记录成立 ——
同一父会话里前一个 worker 的整条记录被抹掉，它的 scope 从台账消失，
写冲突检测与名额统计同时失真。

**怎么验证**

- 代码位置：`plugin/scripts/dispatch.mjs` 的 `turnKey` 计算与 `existing` 查找分支
  （对照 diff 可见旧代码的过滤条件会整条抹除记录）。
- 人工确认：连续派两个 worker 给不同成员，检查台账里两条记录都在，前一个的 scope 没有消失。
- 仓库回归：`node tests/chain-test.mjs`（本版同步更新）。

### 变更 9：在飞名额回收三条路 + 累计派工额度持久化

**改了什么**

- `plugin/scripts/lib.mjs` 新增 `reapExpiredDispatches()`：超过 TTL 仍停在 `active` 的记录判死
  （`state: 'aborted'`，带 `end_reason`）。
- `activeDispatches()` / `activeDispatchesAll()` 在**读取时**顺带把超龄记录判死并落盘（读时自愈）。
- `plugin/scripts/dispatch.mjs` 与 `plugin/scripts/watchdog.mjs` 都在判定前先做 TTL 兜底并写盘。
- 已判死的记录**不复活**：`markDispatchDone()` / `markDispatchAborted()` 都不会改写非 `active` 记录的状态。
- 累计派工额度改用持久化计数器（`ledger.counters`），不再靠扫台账统计 ——
  台账截断到 200 条之后，扫出来的累计数会偏低，30 条上限会形同虚设。

**为什么**

以前只有「worker 正常结束就回收」这一条路。派工被取消、被中断、子会话异常退出时，
名额在 TTL 内不会被回收 —— 冲突检测与名额统计只增不减，最后把会话自己锁死。

**怎么验证**

- 代码位置：`plugin/scripts/lib.mjs` 的 `reapExpiredDispatches()` / `markDispatchAborted()` /
  `markDispatchDone()` / `dispatchedTotal()` / `bumpDispatchCounter()`。
- 人工确认：派一个工后中断该 worker（或让子会话异常退出），
  检查台账里该记录最终不再是 `active`（判死或已回收）。
- 仓库回归：`node tests/chain-test.mjs`（本版同步更新）。

### 变更 10：履历的验收方必须真实存在

**改了什么**

- `plugin/scripts/record-gate.mjs`：写入实战记录时，`verified_by` 必须能在派工台账里找到一条
  `agent == verified_by` 且 `state == 'done'` 的记录，否则拒绝写入。
- 台账为空或不可用时也拒绝 —— 没有台账凭据就没有「确实有人验过」的证据。
- 校验**只发生在写入时**：历史履历里那些验收方已不在台账中的条目照常读得出、照常注入，
  闸门不回写、不删除、不重算已有条目。

**为什么**

旧校验只有一条「验收人不能是执行人自己」。任何人都能填一个陌生名字写履历，
而履历会被注入给 Router 当匹配依据 —— 一次伪造就能影响路由。

**怎么验证**

- 代码位置：`plugin/scripts/record-gate.mjs` 的 `verified_by` 校验分支（台账 `state == 'done'` 判定）。
- 人工确认：用一个从未派过工的验收方名字写履历，应被拒绝；
  用确实跑过并已回收为 `done` 的验收方名字，应写入成功。
- 仓库回归：`node tests/records-test.mjs`（本版同步更新）。

### 变更 11：错题本归因按多语序枚举，编排层的锅不进成员账

**改了什么**

- `plugin/scripts/lessons-gate.mjs`：归因公平判定从**按词匹配**改为**按语序枚举** ——
  「派工 brief 有误」「派工给错」「Router 给错」「给错的 brief」「brief 给错」「brief 有误」
  「Router 的锅」「编排层的锅」「上游给错」「需求本身自相矛盾」，逐条正则 + 可读标签，
  命中即拦，并在报错里报出命中的是哪条语序。
- 两条豁免保留：否定语境（成员在澄清自己背锅）、以及「宾语是成员自己的产物 + brief 处在执行语境」
  （成员认错，不拦）。
- 成员的错题本闸门拒绝 `agent` 以 `_` 开头 —— `_router` 是 Router 自己的错题本，
  用契约 S1 的 7 字段模板，不接受成员格式。
- `plugin/skills/super-agent-router/SKILL.md` 与 `references/review.md` 写明分工：
  成员的执行失误记成员账，编排层的错记进 `.superagent/lessons/_router.md`。

**为什么**

按词匹配拦不住语序变化 —— 「给错的 brief」里根本没有「brief 给错」这个子串，换个语序就漏进去；
而 brief / 派工 / Router 这些词在**成员认错**时同样会出现，按词拦就是把认错也一起拦了。

**怎么验证**

- 代码位置：`plugin/scripts/lessons-gate.mjs` 的 `ROUTER_FAULT_PATTERNS` 数组与 `routerFaultLabel()`。
- 人工确认：用「给错的 brief」作为根因写成员错题本，应被拒绝并指出命中语序；
  用「按 brief 做了但没回显口径」作为根因，应允许写入。
- 仓库回归：`node tests/lessons-test.mjs`（本版同步更新）。

### 变更 12：记录摘要取样不再按名录顺序截断，并披露「已显示 N / 共 M」

**改了什么**

- `plugin/scripts/records.mjs` 新增 `summarizeRecordsDetailed()`：先把**有记录的成员全部收齐**
  （不再按名录顺序提前 break），按「成果条数降序 → 同条数按名字升序」排序后取前 N 名，
  并把被省略的成员显式披露（`totalMembers` / `shownMembers` / `omitted` / `truncated`）。
- `plugin/scripts/gate.mjs` 与 `plugin/scripts/session-start.mjs` 的取样名额统一为 12，
  与名录上限（`MAX_ROSTER = 12`）一致 —— 名录上限 12 时不可能有成员被名额挤掉。
- 两处注入文本都会写明「已显示 N / 共 M 个有记录的成员」，被省略时列出被省略的成员。
- `plugin/scripts/roster.mjs` 的名录顺序固定为**名字升序**，并在注释里写明：
  顺序只能是登记顺序，不能当优先级用。

**为什么**

旧口径是沿名录顺序遍历、凑满名额就 break。排在名录第 7 位以后的成员**结构性不可见** ——
不是因为战绩不够，而是因为在名录里排得靠后。而且静默截断让注入文本读起来像全集，
那是在骗 Router。

**怎么验证**

- 代码位置：`plugin/scripts/records.mjs` 的 `summarizeRecordsDetailed()`；
  `plugin/scripts/gate.mjs` / `plugin/scripts/session-start.mjs` 里的「已显示 N / 共 M」输出行。
- 人工确认：新会话第一轮的注入文本里应能看到「已显示 N / 共 M 个有记录的成员」这一行。
- 仓库回归：`node tests/records-test.mjs`、`node tests/roster-test.mjs`（本版同步更新）。

### 变更 13：成员的教训直接注入 worker 上下文

**改了什么**

- `plugin/scripts/guard.mjs`：worker 建立绑定时，把台账里该成员的错题本条目直接作为
  `additionalContext` 注入 worker 自己的上下文（此前只挂在父会话的注入文本上）。
- `plugin/scripts/dispatch.mjs`：派工台账保存该成员的教训条目，供 guard 读取。
- 教训为空时**显式说明「0 条」**，并区分两种情况 ——
  「该成员暂无错题本」（还没栽过跟头）与「错题本没送达」（链路故障）处理方式完全不同。

**为什么**

以前教训只挂在父会话的注入文本上，子会话永远收不到，除非 Router 手工抄进 brief ——
那不是机制保障，是靠自觉。

**怎么验证**

- 代码位置：`plugin/scripts/guard.mjs` 的 `injected` 变量与 `allow(injected)` 调用点；
  `plugin/scripts/dispatch.mjs` 派工时写台账的 `lessons` / `lesson_count` 字段。
- 人工确认：给一个错题本里有条目的成员派工，worker 上下文里应能看到该成员的历史教训。
- 仓库回归：`node tests/chain-test.mjs`（本版同步更新）。

### 变更 14：watchdog 按契约校验产出条目

**改了什么**

- `plugin/scripts/lib.mjs` 新增 `validateEntryOutput()` 与 `ENTRY_FIELDS`：
  「缺陷清单 / 验收结论 / 复盘记录」类产出的编号前缀是否一致、序号是否从 01 递增不跳号、
  每条 7 个字段是否齐备且独立成行、「条目统计」行是否与实际条数与状态计数自洽。
- `plugin/scripts/watchdog.mjs`：校验不通过时**一次性说清缺哪一项**（缺哪个字段 / 哪个编号跳号 /
  统计行对不上），让 worker 一次补齐，而不是反复小修小补。
- 没有条目型产出时不适用该校验（否则每次普通交付都会被拦）。

**为什么**

产出格式不统一时，验收方要逐条人工核对格式，worker 要来回返工。
把契约做成程序层校验，格式问题在结束时一次说清。

**怎么验证**

- 代码位置：`plugin/scripts/lib.mjs` 的 `ENTRY_FIELDS` 与 `validateEntryOutput()`；
  `plugin/scripts/watchdog.mjs` 里的 `entryCheck` 分支。
- 人工确认：worker 交付一份缺字段的条目型产出，应被 block 并明确指出缺哪一项。
- 仓库回归：`node tests/e2e-test.mjs`（本版同步更新）。

### 变更 15：派工闸门不再静默丢弃解析不出的 SCOPE 条目

**改了什么**

- `plugin/scripts/dispatch.mjs`：SCOPE 行里有「长得像路径却解析不出来」的条目时**拒绝派工**，
  并列出无法解析的条目。
- 工具载荷解析失败时**拒绝派工**（此前解析失败会返回空对象，派工无法登记却继续放行）。
- 台账不可读时**拒绝派工** —— 台账读不出来就没法做冲突与名额判定。
- `plugin/scripts/guard.mjs`：载荷解析失败时拒绝（此前解析失败取不到 `agent_type`，
  被当成父会话放行）。

**为什么**

白名单漏收 = 判定范围比派工意图窄 = 窄掉的部分等于无人看管。
这类失败必须在上报时就被看见，而不是默默生效。

**怎么验证**

- 代码位置：`plugin/scripts/dispatch.mjs` 的 `scopeDetail.rejected` 分支与 `parsed.ok` 分支；
  `plugin/scripts/guard.mjs` 的 `parsed.ok` 分支。
- 人工确认：派一个 SCOPE 里写了明显不像路径的条目的工，应被拒绝并指出哪个条目解析不出来。
- 仓库回归：`node tests/scope-test.mjs`（本版同步更新）。

### 变更 16：watchdog 的产出校验改按「可核验的具体物」判定

**改了什么**

- `plugin/scripts/watchdog.mjs`：证据判定由关键词匹配改为具体物匹配 ——
  真实存在的路径、带行号的引用、围栏里的命令输出才算证据；
  「测试通过」「运行过了」这类描述词不算证据。
- 「引用」与「产出」分开：交付说明里被参考 / 引用 / 核对到的路径不参与存在性校验
  （此前一句「改动 X，参考 Y」会把 Y 也当成声称产出，合规交付被误拦）。
- 声称产出的文件按绝对路径判存在，盘符路径（`C:/...`）不再被拼成工作区路径。
- 条款引用（`契约 S2.2`）与纯版本号（`0.4.0`）不再被当成声称产出的文件。

**为什么**

旧实现命中「测试」两个字就放行，「搞定了，测试通过」能完全绕过完成度校验；
另一头，判定过宽又把正常验收报告里的引用路径当成「声称产出但不存在」，连续拦两次。
两类误判都会把 worker 逼到反复改写交付说明，把真正该看的内容淹掉。

**怎么验证**

- 代码位置：`plugin/scripts/watchdog.mjs` 的 `evidenceFound()` / `claimedPaths()` /
  `stripReferenceClauses()`。
- 人工确认：交付文本写「测试通过」且无具体路径时应被拦；
  写「改动 plugin/scripts/guard.mjs，参考 plugin/README.md」不应被误拦。
- 仓库回归：`node tests/e2e-test.mjs`（本版同步更新）。

### 变更 17：新增 `references/contract.md` —— 契约单一事实源

**改了什么**

- 新增 `plugin/skills/super-agent-router/references/contract.md`（S1~S10）：
  条目模板（7 字段）、编号命名空间、scope 语义、通道语义、brief 解析规则、工具分流与危险操作、
  派工台账口径、记录闸门、收尾契约校验、归因与缺陷台账引用。
- `plugin/skills/super-agent-router/SKILL.md`、`references/brief.md`、`references/scope.md`、
  `references/review.md` 改为**引用**契约，不再各自复述字段与规则。

**为什么**

同一个规则在四个文件里各写一遍，迟早漂移 —— 实际发生过给两个 worker 的模板是 6 字段、
给 verifier 的是 7 字段，验收反过来判产出「字段模板不一致」。

**怎么验证**

- 代码位置：`plugin/skills/super-agent-router/references/contract.md`（全文）；
  `SKILL.md` 与 `references/brief.md` 里的「见 contract.md」引用句。
- 人工确认：改契约里的一个字段定义，brief.md / scope.md / review.md 里不应再出现该字段的复述。

### 破坏性变更与升级前检查

以下四项会改变现有用法。**升级前请逐条检查**，否则会出现「以前能跑、升级后被拦」的情况。

1. **brief 解析不到边界 = 拒绝**（变更 5）。
   旧 brief 写法若解析不出 SCOPE，worker 会被拒绝操作，不再是无声放行。
   - 升级前检查：所有在用的派工 brief 是否都含一行可解析的 `SCOPE:` 路径清单；
     路径条目必须是规范路径（不能是「不要动生产配置」这类否定式表述）。
2. **通道判定变严**（变更 2 / 3 / 7）。
   bash 现在按命令意图分流，glob/grep 改按有效检索根判定，未登记的文件类工具名一律按写判定。
   - 升级前检查：worker 脚本里是否有依赖「bash 里带点的东西不算路径」的写法；
     是否有对目录树外做 glob/grep 的步骤需要补进 scope。
3. **履历的验收方必须真实存在**（变更 10）。
   `verified_by` 必须在派工台账里有 `state == 'done'` 的记录才能写入。
   - 升级前检查：现有的履历写入流程是否走真实派工验收；
     填陌生名字写履历的写法从本版起会被拒绝（历史条目不受影响，仍可读）。
4. **编排层归因不再能写进成员错题本**（变更 11）。
   - 升级前检查：成员错题本里若有「Router 给错的 brief」这类归因，迁到
     `.superagent/lessons/_router.md`（该文件用契约 S1 的 7 字段模板）。

另外一条**运行时要求**：`plugin/hooks/hooks.json` 的 `PreToolUse` matcher 本版新增了
`run_code|mavis`，**必须新开会话才生效**。旧会话里 `mavis` 与 `run_code` 两类调用仍不进 guard。

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

- 仓库回归：`node tests/chain-test.mjs` 第 9 组断言「Router 会话不被 worker scope 约束」
  （父会话写 `config/prod.yaml` 不被拦），同时断言 worker 写自己 scope 外文件仍被拦、写 scope 内文件放行。
- 仓库回归：`node tests/scope-test.mjs` 第 1 组断言 Router 父会话读写任意路径都不被拦。
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

- 仓库回归：`node tests/e2e-test.mjs` 第 3 组构造子会话 transcript，断言
  worker scope 内放行、scope 外 deny、bash 里藏 scope 外路径 deny。
- 仓库回归：`node tests/chain-test.mjs` 第 9 组断言 worker 写 scope 外文件被拦。
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

- 仓库回归：`node tests/chain-test.mjs` 第 6 组断言 scope 重叠的派工被拒（「组队冲突」）、
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

- 仓库回归：`node tests/chain-test.mjs` 第 10 组：worker 跑完后，对同一 scope 再次派工
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

- 仓库回归：`node tests/e2e-test.mjs` 第 2 组断言派工记录带 `dispatch_id`，
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
