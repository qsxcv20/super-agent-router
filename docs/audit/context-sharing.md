# 上下文注入与传递链路追踪（context-sharing）

覆盖范围：`plugin/hooks/hooks.json` 接线表、`plugin/scripts/session-start.mjs`、`plugin/scripts/gate.mjs`、`plugin/scripts/dispatch.mjs`、`plugin/scripts/guard.mjs`、`plugin/scripts/lib.mjs`、`plugin/scripts/lessons.mjs`、`plugin/scripts/records.mjs`、`plugin/scripts/roster.mjs`、`plugin/scripts/watchdog.mjs`，以及 `.superagent/roster.json`、`.superagent/lessons/`（3 份）、`.superagent/methods/`（4 份专项方法论）、`plugin/skills/super-agent-router/references/`（8 份）、`plugin/README.md`。真实会话样本：本会话（`mvs_c679482b2b5d459db60cbff1b78cb5aa`，成员 `sa-context-trace`）与兄弟成员会话（`mvs_3aabaac7506c4fc09b96178c28bde15e` = `sa-orchestration-audit`、`mvs_ad1e8dcca08144408e1341ebb56de0d3` = `sa-gate-integrity`），经 `mavis_session_messages` 逐条翻页读取。

一句话结论：**注入层是隔离的（按成员文件名逐个取，不串味），读取层不是隔离的**——`ro:` 目录型 SCOPE 条目把整个 `.superagent/lessons/`、`.superagent/methods/` 目录树开放给成员，实测本单成员读到了兄弟成员 `sa-orchestration-audit` 的错题本规则全文与 Router 私有账 `_router.md`（94 行）；另有一处「文档声称已注入、代码从未注入」：Router 自己的错题本从未到达 Router 上下文。

条目统计：总计 6 条（CS-01～CS-06，无跳号重号），其中已复现 5 条，推断 1 条（CS-04）；每条均含 7 个独立字段行（触发条件 / 影响 / 复现步骤 / 证据 / 状态 / 修法方向 / 还需要什么）

---

## 一、上下文来源清单（四要素：来源文件与行 / 注入时机 / 载体格式 / 接收方）

| # | 上下文来源 | 来源文件与行 | 注入时机 | 载体格式 | 接收方 | 验证方法 |
|---|---|---|---|---|---|---|
| S1 | 编排协议本体（何时该编排 / 怎么开始 / 管理层定位 / 「成员记忆共享但隔离」声明） | `plugin/scripts/session-start.mjs:19-48`（隔离声明在 `:42`） | SessionStart（新会话或恢复会话的首次模型处理前，一次） | plain-text stdout（`:73`） | Router 父会话 | 代码路径确定；前轮实测摘录（`docs/audit/context-flow.md` 摘录 3：父会话 transcript 第 2 行 `plugin_hook_context` 含「本会话已启用 Super-agent 编排机制」）。**本轮未在会话面复现到 hook 上下文**（见 CS-06） |
| S2 | 意图粗筛路由指令 + 用户文本内疑似路径回显 | `plugin/scripts/gate.mjs:35-36`（判定）、`:38-49`（未命中分支）、`:52-59`（路由指令）、`:60-67`（疑似路径） | UserPromptSubmit（每轮用户提问；命中 `judgeTriggerIntent` 才注入，未命中静默 `exit(0)`） | plain-text stdout（`:97`） | Router 父会话 | 代码路径确定；粗筛判据唯一出处 `plugin/scripts/lib.mjs:1567-1584` |
| S3 | 实战记录摘要（匹配参考） | `plugin/scripts/records.mjs:46-78`（收齐→排序→取样→披露省略者），由 `session-start.mjs:53` 与 `gate.mjs:41,77` 调用 | SessionStart 一次 + 每次 UserPromptSubmit | plain-text stdout | Router 父会话（覆盖**全体**有记录成员） | 代码路径确定；调用方两处口径已统一（均取 `summarizeRecordsDetailed(3, 12)`） |
| S4 | 派工 brief 原文（SCOPE / GOAL / ACCEPT / FORBID / EVIDENCE） | Router 手写，经 `task` 工具 `prompt` 参数 | 派工瞬间 | tool_use `input.prompt`（明文） | worker / verifier 子会话 | **真实会话面已见**：本会话首条 user 消息 1828 字符，含 `SCOPE:` 行、`ACCEPT`、`FORBID`、`EVIDENCE`（原文见第四节摘录 1） |
| S5 | 父会话标记 + 成员名 + 专项归属 | 运行时注入的 `<agent-context>` 段（本会话实测含 `PARENT SESSION: mvs_9bdda202ae274c909a5b4352fc45a471`、`agentName: sa-context-trace`、`SESSION ROLE: branch`） | 子会话建立时 | 明文系统上下文块 | worker / verifier | 亲眼见过（活体系统提示内）；**该块在本会话 transcript 的首条 user 消息内未出现**，其 transcript 行位置属推断 |
| S6 | 成员历史教训的「规则」段（`- **规则**：` 行） | 读取：`plugin/scripts/lessons.mjs:31-40`（单文件 + 只取规则行）；**注入点 1**：`plugin/scripts/dispatch.mjs:137-138, 196-203`；**注入点 2**：`plugin/scripts/guard.mjs:202-208` | 注入点 1 = 派工瞬间（父会话）；注入点 2 = worker **首次工具调用、建 binding 那一刻**（子会话） | `hookSpecificOutput.additionalContext`（JSON） | 注入点 1 → Router；注入点 2 → 目标 worker（仅其本人的） | 代码路径确定；「进哪个会话」由载体语义与调用方所在会话决定 |
| S7 | 成员实战记录（该成员此前验收通过的成果 / 做法 / 证据） | 读取：`plugin/scripts/lessons.mjs:52-75`（读方法论文件「实战记录」段）；注入：`plugin/scripts/dispatch.mjs:141, 204-213` | 派工瞬间 | `hookSpecificOutput.additionalContext`（JSON） | **仅 Router 父会话**；guard 未注入（见 CS-02） | 代码路径确定 |
| S8 | 成员方法论正文 | `.superagent/methods/<成员名>.md`；路径由 bootstrap 的 system_prompt 模板指向（`plugin/skills/super-agent-router/references/bootstrap.md:66-75`） | 成员开工前自行 read | 文件正文（不进上下文，除非成员主动读） | 目标成员自己 | 机制不注入正文；只放开读取权限（`plugin/scripts/guard.mjs:227-235`） |
| S9 | 错题本全文（现象 / 根因 / 规则 / 下次派工） | `.superagent/lessons/<成员名>.md` | 成员开工前自行 read；Router 私有账 `_router.md` **无人读** | 文件正文 | 目标成员自己（读权限见 CS-03）；**Router 私有账无人读**（见 CS-01） | 实测：`read .superagent/lessons/sa-orchestration-audit.md` → 成功，11 行 |
| S10 | SCOPE 白名单（判定依据，非上下文） | `plugin/scripts/lib.mjs:301-323`（抽取）、`:539-583`（transcript 解析，兼容 compatible / codex 两变体，语义定位） | worker 首次工具调用时从自身 transcript 解析 | JSON（`{parentSessionId, agent, scope}`）写入台账 | guard 内部 | 代码路径确定；`plugin/scripts/guard.mjs:171-201` |
| S11 | 派工台账（含 scope、`lessons`、`lesson_count`） | `plugin/scripts/dispatch.mjs:168-190`（写）、`plugin/scripts/lib.mjs:56-105`（读写） | 派工瞬间写；worker 首次调用 / SubagentStop 读 | JSON 文件（`PLUGIN_DATA/dispatches.json`） | 机制内部 + 派工发起方 | 台账在插件数据目录（非工作区），成员通常读不到（推断，见 CS-04） |

**S6/S7 的两个注入点是并列的、不是替代关系**：`dispatch.mjs` 产出的是**父会话**上下文（Router 读后决定是否转写进 brief），`guard.mjs` 产出的是**子会话**上下文（worker 直接收到）。前者靠 Router 自觉，后者是代码强制。

---

## 二、「共享 vs 隔离」清单与判据

图例：✔ = 机制保证送达 ｜ △ = 送达但需人工转写 ｜ ✘ = 结构性拿不到 ｜ ⚠ = 越界可达（不该拿到却能拿到）

| 上下文 | 共享 / 隔离 | 判据 | 机制依据 | 判定 |
|---|---|---|---|---|
| 编排协议本体（S1） | **共享（全体成员同一份机制）**，但只注入 Router | 事件类型（SessionStart 只在派工方会话触发） | `plugin/hooks/hooks.json` SessionStart；`plugin/skills/super-agent-router/references/scope.md:195-199` | ✔（Router）/ ✘（worker，需 brief 携带） |
| 路由指令（S2） | 共享给 Router | 事件类型 | `hooks.json` UserPromptSubmit | ✔（Router） |
| 实战记录摘要（S3） | **共享：覆盖全体有记录成员**，收在 Router 一处 | 按**名录**（roster 全量收集，见 `records.mjs:50-60`），不按目标成员 | `records.mjs:46-78` | ✔（Router 全体成员汇总） |
| 派工 brief（S4） | 隔离：一对一 | 派工目标 | `dispatch.mjs:42-43` | ✔ |
| 父会话标记 / 成员名（S5） | 隔离：一对一 | 运行时注入 | — | ✔ |
| **成员历史教训规则段（S6）** | **隔离：按成员文件名逐个取** | **按文件名**（`lessons.mjs:11-18` 拼 `.superagent/lessons/<name>.md`，读单个文件，只取 `- **规则**：` 行） | `dispatch.mjs:137`、`guard.mjs:202-208` | ✔（注入层隔离成立） |
| **成员实战记录（S7）** | 隔离：按成员方法论文件 | 按文件名（`lessons.mjs:24-27,52-75`） | `dispatch.mjs:141` | ✔（仅 Router）/ ✘（worker，见 CS-02） |
| 成员方法论正文（S8） | 隔离：按成员文件名 | 按文件名 + 精确路径放行 | `guard.mjs:227-235`（`mode='exact'`） | ✔（注入与读取均按成员） |
| **错题本全文（S9）** | **机制层隔离，读取层不隔离** | 注入按文件名；**读取按目录树** | `lib.mjs:233-245`（目录条目放宽整棵）、`guard.mjs:227-235` | ⚠（见 CS-03） |
| Router 私有账 `_router.md` | **应隔离给 Router，实测成员可读** | 无隔离机制 | 无任何脚本读它，但 `ro: .superagent/lessons/` 覆盖它 | ⚠（见 CS-03） |

**判据归纳**：**注入层按「成员文件名」隔离，读取层按「SCOPE 条目的所在目录树」放宽**。两层的判据不同，这正是串味的入口——注入层再严，读取层一松就破。

---

## 三、关键不变量：派工时是否**只**注入目标成员自己的教训？

**结论：成立——注入层不会把别的成员的教训漏进来。** 依据（代码路径 + 实跑等价复现）：

1. `plugin/scripts/dispatch.mjs:137`：`const lessons = agentKey ? readLessons(agentKey) : (agent ? readLessons(agent) : [])` —— 只取**一个** key。
2. `plugin/scripts/lessons.mjs:31-40`：`readLessons(name)` → `lessonsPath(name)`（`:15-18` = `.superagent/lessons/<净化后 name>.md`）→ **只读这一个文件**，且只提取 `^-\s*\*\*规则\*\*【：】s*(.+)$` 行。别的成员的错题本文件根本不在读取路径上。
3. `plugin/scripts/guard.mjs:205-208`：worker 侧注入取自台账里**与本会话匹配的那条派工记录** `d.lessons`，而 `d.lessons` 的唯一写入点就是上面的 `dispatch.mjs:137`（`dispatch.mjs:164-165, 180-181`）。链路闭环，不存在第二条写入口。
4. 实证：父会话四次派工的 `task.prompt` 全文（1834 / 1828 / 2037 / 2318 字符）逐条检查 `PRIOR_LESSONS` / `PRIOR_RECORDS` / 规则原文 → **全部 false**。父会话既没有把兄弟成员的教训抄进来，也**没有**把目标成员自己的教训抄进来（见 CS-05）。

**但同一不变量在读取层不成立**：见 CS-03。

---

## 四、合作性机制核对

**既定形态**（本项目）：父会话做上下文切片；成员之间只共享「产出契约」与「经独立验收裁决的结论」。

**核对结果：主干符合，偏离 3 处。**

| 协作面 | 现状 | 证据 | 符合？ |
|---|---|---|---|
| 产出契约 | brief 一对一传递（S4） | 本会话首条 user 消息实测 | ✔ |
| 经验收裁决的结论 | 实战记录写进**目标成员自己的**方法论文件「实战记录」段，只经 `dispatch.mjs:141` 注入给该成员的下一轮 | `lessons.mjs:52-75`、`dispatch.mjs:141` | ✔ |
| 成员之间共享**原始上下文**（彼此 transcript / 黑板） | **不存在**。`readBriefFromTranscript` 只读**调用者自己**的 transcript 取 scope（`lib.mjs:539-583`）；无共享黑板文件；`dispatch.mjs` 只往派工台账写 scope 与目标成员的规则行，不写任何 transcript 正文 | 全仓检索无黑板写入点 | ✔ |
| 跨成员结论污染 | 父会话层面 S3 把**全体**成员的记录汇总注入 Router（`records.mjs:50-63` 收齐全体有记录成员，`session-start.mjs:53-69` / `gate.mjs:77-93` 输出），Router 再写 brief。**无任何校验**阻断 Router 抄错成员 | `records.mjs:50-63`、`dispatch.mjs:205-207`（文案自称「可作方法参考」但无约束） | △ 偏离 |
| Router 编排层教训回流 | **断裂**：`_router.md` 无人读（CS-01） | 全仓检索无 `readLessons('_router')` 调用点 | ✘ 偏离 |
| 成员的实战记录回流给自己 | **断裂**：worker 拿不到自己的记录（CS-02） | `guard.mjs:26-32` imports 无 `readRecords` | ✘ 偏离 |

---

## 五、错误传播评估

**结论：会污染，但污染路径不是「注入块串味」，而是「目录型 SCOPE 放开了读取」＋「Router 手工转写无校验」。按可能性排序：**

1. **读取面污染（已实测发生，概率最高）**：任何成员只要 SCOPE 里带 `ro: .superagent/lessons/` 或 `ro: .superagent/methods/` 这类**目录条目**，就能读到**全体成员的错题本与方法论**，以及 **Router 私有账 `_router.md`**。实测：本单（`sa-context-trace`）在本任务内成功读到 `sa-orchestration-audit` 的规则原文「被越界拦截两次后必须立即停手，改用 read/grep 取证…」与 `_router.md` 全部 94 行。方向与「教训前置」相反——是**教训被窃取而非被分发**。后果：接收方可能把别成员的错误结论当成本方历史约束执行（例如把审计员的「被拦两次就停手」当成本成员的既有规则），也可能在产物中复述别人的内部教训。
   依据：`plugin/scripts/lib.mjs:233-245`（目录条目读放宽到整棵）、`plugin/scripts/guard.mjs:227-235`（D-14 修复只约束**自动放行**的两个精确文件，**不约束 Router 自己写在 SCOPE 里的目录条目**）；实测 `read` 两次均成功。
2. **Router 转写污染（推断，本轮已发生空转）**：S3 汇总全体成员记录注入 Router，Router 写 brief 时无校验；若把 A 成员的做法抄进 B 成员的 brief，B 会当成「已验证路径」执行。当前实测为**反向失效**：Router 连目标成员自己的教训都没抄（CS-05），说明这条「人工转写」通道既无机制保障也无实际使用。
3. **注入层串味：不会发生**（第三节已证）。这是本机制做对的地方，应在改造中保留。

**因此「成员之间因上下文混乱互相篡位」的真实风险点是读取面，不是注入面。**

---

## 六、缺口清单

### 6.1 该共享而没共享

| 缺口 | 具体项 | 直接后果 |
|---|---|---|
| G1 | Router 自己的错题本 `_router.md`（5 条 RT- 教训，94 行）从未进入 Router 上下文 | 编排层教训零回流：RT-02「brief 复述字段模板即分叉」、RT-03「编号在派工时分配」等已写明的教训，在本轮派工里原样复发——4 份 brief 仍各写各的、编号仍各自从 01 开始 |
| G2 | 目标成员的实战记录未进 worker 上下文（guard 只注入 lessons） | worker 拿不到「自己做成过什么」，每轮从零摸索；已验证路径无法复用 |
| G3 | 派工时 lessons 进 worker 的通道条件苛刻（要求台账记录仍 `active` + scope 重叠 + agent_key 命中）且无留痕 | 一旦派工记录先被回收或命名对不上，注入静默消失，worker 收不到任何信号（自己也不知情） |
| G4 | 父会话的 `PRIOR_LESSONS` / `PRIOR_RECORDS` 转写契约无机制保障且本轮未执行 | dispatch 已把规则注进父会话，Router 却不转写 → 教训在 worker 侧断链，闭环完全依赖自觉 |

### 6.2 该隔离而没隔离

| 缺口 | 具体项 | 直接后果 |
|---|---|---|
| G5 | `ro: .superagent/lessons/` 目录条目开放整棵错题本目录，跨成员 + Router 私有账一并可达（已实测） | 成员能读别人的教训与编排层的锅；读到的内容进入上下文，构成实际的跨成员污染 |
| G6 | `ro: .superagent/methods/` 目录条目开放全体成员方法论 + 实战记录 | 成员可读他人履历与验收结论，绕过「只共享产出契约」的形态 |
| G7 | 隔离判据在注入层与读取层不一致（文件名 vs 目录树） | 机制改进时容易只修一层：注入层看起来是干净的，就误判「隔离已成立」 |

---

## 七、缺口明细条目（S1 七字段模板）

### CS-01
- 触发条件：需要 Router 把编排层教训（brief 给错、模板复述漂移、编号撞号、阴性观察被当平台事实）用在下一次派工上。
- 影响：编排层教训只写不读，零回流。`plugin/skills/super-agent-router/references/contract.md:280` 与 `references/review.md:161` 都明写「由 SessionStart 注入 Router 上下文」，但代码里没有任何一处实现——`plugin/scripts/session-start.mjs:13-14` 只 import 了 `lib.mjs` 与 `records.mjs`，全文无 `readLessons` 调用；全仓 `plugin/` 检索 `readLessons` 的调用点只有 `dispatch.mjs:137`（按目标成员读）。**Router 自己的 5 条 RT- 教训（94 行）从未到达 Router 上下文。** 后果：本轮父会话给 4 个成员手写 brief、全部缺 `PRIOR_LESSONS`/`PRIOR_RECORDS`、条目编号仍各自从 01 开始（与 RT-02/RT-03 记载的教训完全同型），说明教训确实没进上下文。
- 复现步骤：1) 读 `plugin/scripts/session-start.mjs:13-14` 与全文，确认无 `readLessons`、无 `_router`；2) 全仓检索 `plugin/` 的 `readLessons` 调用点 → 仅 `dispatch.mjs:137`；3) 检索 `_router` → 仅命中 SKILL.md / README.md / CHANGELOG.md / lessons-gate.mjs（拒写）/ contract.md，**无读取点**；4) 读 `.superagent/lessons/_router.md` → 存在，94 行，5 条 RT- 条目；5) 对照父会话四次派工的 `task.prompt`（实测）→ 模板与编号问题复现。
- 证据：`plugin/scripts/session-start.mjs:13-14`（import 清单）、`plugin/scripts/records.mjs:46-78`（SessionStart 只注入记录摘要）、`plugin/scripts/lessons.mjs:31-40`（唯一的规则行读取器）、`plugin/skills/super-agent-router/references/contract.md:280`、`plugin/skills/super-agent-router/references/review.md:161`、`plugin/scripts/lessons-gate.mjs:37`（只拒写不读）。真实会话面：父会话 `mvs_9bdda202ae274c909a5b4352fc45a471` 的 4 次 `task` 调用 `prompt` 实测（1834 / 1828 / 2037 / 2318 字符）全部缺 `PRIOR_LESSONS` 与 `PRIOR_RECORDS`。**追加事实**：即便补上读取调用，`_router.md` 用的是 S1 七字段模板（触发条件/影响/复现步骤/证据/状态/修法方向/还需要什么），**不含 `- **规则**：` 行**，而 `lessons.mjs:36` 的正则只认规则行 → 结构上读出来也是 0 条，需另设解析入口。
- 状态：已复现
- 修法方向：在 `session-start.mjs` 增加 Router 错题本注入通道，且按 S1 七字段模板另设解析（不能复用 `readLessons` 的规则行正则）；注入内容需与成员教训**视觉可区分**（例如标题标明「编排层教训」），避免 Router 把它当成某个成员的教训转写给 worker。修法归机制 owner，本单不改代码。
- 还需要什么：需要确认「Router 编排层教训」注入时的**条目形态**（整条 7 字段注入，还是压成一句可执行判断）——两者对 Router 行为的引导强度差别很大，本单无法从现有文档判定。

### CS-02
- 触发条件：worker 开工，需要知道「这个专项此前做成过什么、用的什么做法」。
- 影响：**实战记录从未进入 worker 上下文**。`plugin/scripts/guard.mjs:26-32` 的 import 清单里没有 `readRecords`；唯一的注入构造 `guard.mjs:202-208` 只拼 `d.lessons`（教训规则段），**没有 records**。而 `plugin/skills/super-agent-router/references/scope.md:207-208` 写的是「该成员的历史教训 | guard 直接注入 worker 上下文」与「该成员的实战记录 | guard 直接注入 worker 上下文（同上）」——**第二行与代码不符**；`plugin/README.md:283` 则写「该成员的实战记录 | 派工时随注入文本给出（匹配阶段给 Router 参考）」——两份文档自相矛盾，代码只支持 README 那一版。后果：worker 侧「做成过什么」这条上下文链完全断掉，每轮从零摸索；已验收的成果无法沿用。
- 复现步骤：1) 读 `plugin/scripts/guard.mjs:26-32`（import 清单）确认无 `readRecords`；2) 读 `plugin/scripts/guard.mjs:202-208`（注入内容只含 `d.lessons`）；3) 检索 `readRecords` 调用点 → `dispatch.mjs:141`、`records.mjs:51`、`roster.mjs:135`、`lessons-gate.mjs`（无关），**无 guard**；4) 对照 `references/scope.md:207-208` 与 `plugin/README.md:283` → 文档冲突。
- 证据：`plugin/scripts/guard.mjs:26-32`、`:202-208`、`:66-74`（`allow()` 只输出 `additionalContext`，内容由调用方传入）；`plugin/scripts/lessons.mjs:52-75`（`readRecords` 读方法论「实战记录」段）；`plugin/scripts/dispatch.mjs:141`（唯一注入点，属父会话）；`plugin/skills/super-agent-router/references/scope.md:207-208`；`plugin/README.md:283`。实测：本会话 `task.prompt` 全文无 `PRIOR_RECORDS`（与 CS-05 同源）。
- 状态：已复现
- 修法方向：要么在 `guard.mjs` 的注入块里补 `d` 对应派工记录里的实战记录（需 dispatch 侧把 records 一并写进台账，当前台账只存 `lessons`/`lesson_count`），要么统一两份文档的表述并把记录改走 brief 契约。二者必须择一，现状是**文档说已注入、代码没注入**。修法归机制 owner。
- 还需要什么：需要父会话决定「实战记录给 worker」是走**机制注入**（worker 必收、但每轮消耗上下文）还是走**契约字段**（Router 转写、可裁剪）——这决定改动落在 `guard.mjs`/`dispatch.mjs` 还是落在 brief 模板，本单不代为决定。

### CS-03
- 触发条件：Router 在 SCOPE 里写了目录型只读条目（例：`ro: .superagent/lessons/`、`ro: .superagent/methods/`）。
- 影响：**成员可读到全体成员的错题本与方法论，以及 Router 的私有错题本**——这正是「成员之间因上下文混乱互相篡位」的落点，且方向与「教训前置」相反（教训被窃取而非分发）。读模式按「scope 条目**所在目录树**」放宽（`lib.mjs:233-245`），目录条目 `.superagent/lessons/` 直接覆盖整棵。D-14 的精确文件修复（`guard.mjs:227-235` + `mode='exact'`）只约束**机制自动放行的那两个文件**，**不约束 Router 自己写进 SCOPE 的目录条目**。后果：被读取的他人教训进入本成员上下文，可能被当成本方历史约束执行或复述进产物；Router 私有账（含对编排层失误的归因）同样外泄。
- 复现步骤：1) 本会话 `task.prompt` 的 SCOPE 含 `ro: .superagent/lessons/` 与 `ro: .superagent/methods/`（目录条目）；2) `read .superagent/lessons/sa-orchestration-audit.md` → **成功**，11 行，含规则行「- **规则**：被越界拦截两次后必须立即停手，改用 read/grep 取证…」；3) `read .superagent/lessons/_router.md` → **成功**，94 行（Router 私有账，无任何隔离）；4) 读 `plugin/scripts/lib.mjs:233-245` 确认读模式目录树放宽规则；5) 读 `plugin/scripts/guard.mjs:227-235` 确认精确路径只覆盖自动放行的两个文件。
- 证据：`plugin/scripts/lib.mjs:233-245`（read 模式：目录条目命中树根与整棵）、`:247-250`（`exact` 模式）、`plugin/scripts/guard.mjs:227-239`（exactPaths 与 `allowedByExact`）、`plugin/scripts/lessons.mjs:11-18`（文件按成员名分离）、`plugin/skills/super-agent-router/references/contract.md:51-55`（S2.1 读放行规则）。实测取证（本会话内）：两次跨成员读取均返回成功内容，见上第 2、3 步。
- 状态：已复现
- 修法方向：两处都得改，且缺一不可——① **读取面**：把 `.superagent/lessons/`、`.superagent/methods/` 从「目录即整棵」改为「只放行目标成员的那一个文件 + `_router.md` 仅对 Router 放行」，即在读模式上叠加成员名维度；② **写入面**：机制侧或派工模板层限制 SCOPE 不得用这两个目录作为目录条目（应写成具体文件或交由机制自动放行）。修法归机制 owner，本单不改代码。
- 还需要什么：需要确认「成员是否应当能读**其他**成员的错题本」这一产品级决定——若答案是「可以」（例如便于协作），则当前行为不是缺陷而是缺少显式声明与边界；若答案是「不可以」，则需按上条收紧。本单按用户「担心成员互相篡位」的表述倾向后者，但这是产品决策，不在本单职权内。

### CS-04
- 触发条件：worker 首次工具调用时，台账里找不到与本会话匹配的**仍 active** 的派工记录（记录已被回收/判死），或派工记录的 `agent_key` 与本会话解析出的 agent 不一致。
- 影响：`plugin/scripts/guard.mjs:205-208` 的注入条件是 `d && Number(d.lesson_count||0) > 0 && d.lessons.length`，其中 `d` 来自 `guard.mjs:191-198` 的三重筛选（agent_key 相等 + `state==='active'` + scope 重叠）。任一条不成立 → `d` 为 undefined → **注入静默消失，不报错、不留痕**，worker 收不到任何关于「没有教训上下文」的信号，只能继续开工。
- 复现步骤：1) 读 `plugin/scripts/guard.mjs:191-198`（筛选条件）与 `:202-208`（注入条件）；2) 构造台账记录 `state='done'` 而 worker 首次调用 → `d` 为 undefined；3) 构造 `agent_key` 与 brief 解析出的 agent 不一致（显示名 vs routing id）→ 同上；4) 观察 stdout：照常放行、无注入、无痕迹。
- 证据：`plugin/scripts/guard.mjs:168-209`、`plugin/scripts/lib.mjs:494-498`（`resolveAgentKey` 取值优先级）、`plugin/scripts/dispatch.mjs:130-138`、`plugin/scripts/watchdog.mjs:42-70`（回收路径，回收后记录变 `done`）。
- 状态：推断
- 修法方向：把「教训上下文未送达」变成**可观测事件**（留痕文件或 worker 首条上下文里的显式标注），并把 agent 命名收敛到 routing id 单一命名空间（与既有 D-12 同族）。修法归机制 owner，本单不改代码。
- 还需要什么：需要一次能观察到 `guard` 注入真实落地的会话证据（worker 首条上下文里出现「历史教训（开工前先看）」块），才能把本条从推断升为已复现或证伪。**本轮未能观察到的原因见 CS-06（会话面不携带 hook 上下文），不能据此判定注入未发生。**

### CS-05
- 触发条件：Router 读到 `dispatch.mjs` 注入的 `历史教训（派工时必须写进 brief）` 块后，理应把规则写进 brief 的 `PRIOR_LESSONS` 段、记录写进 `PRIOR_RECORDS` 段。
- 影响：**本轮 4 次派工全部未转写**。实测父会话四次 `task.prompt`（长度 1834 / 1828 / 2037 / 2318）逐条检查：`PRIOR_LESSONS`=false、`PRIOR_RECORDS`=false、目标成员规则原文=false。其中 `sa-orchestration-audit` **自身有错题本**（`.superagent/lessons/sa-orchestration-audit.md`，1 条规则），其规则仍不在自己的 brief 里。后果：即便 `guard` 侧注入链路成立，Router 侧的人工转写通道也是空的；「教训前置」的闭环实际依赖单一机制路径，且 Router 侧没有任何自检会报缺。
- 复现步骤：1) 取父会话 `mvs_9bdda202ae274c909a5b4352fc45a471` 的 4 次 `task` 调用 `args.prompt` 全文；2) 逐条正则检查 `PRIOR_LESSONS` / `PRIOR_RECORDS` / 「被越界拦截两次后必须立即停手」→ 全部 false；3) 对照 `plugin/skills/super-agent-router/references/brief.md:44-56`（PRIOR_LESSONS 契约：Router 必须把注入的规则写进 brief）；4) 对照 `plugin/scripts/dispatch.mjs:197`（注入文案本身写着「派工时必须写进 brief」）。
- 证据：`plugin/scripts/dispatch.mjs:196-203`（注入文案）、`plugin/skills/super-agent-router/references/brief.md:44-56`、`:58-66`、`plugin/scripts/lessons.mjs:31-40`（规则行提取）。真实会话面：父会话 4 次派工 prompt 实测。
- 状态：已复现
- 修法方向：要么取消「Router 必须转写」这一人工契约（改由机制直接注入 brief 结构化字段，即 CS-02/CS-04 讨论的形态），要么为它加可检查项（派工闸门校验 brief 是否含目标成员的规则行，缺则拒发）。**两个方向的共同点是消灭「靠自觉」**。修法归机制 owner。
- 还需要什么：需要父会话给出本轮**有意不转写**还是**漏转写**的确认——若是有意的（例如认为规则过时），则本条应降级为「契约与实践不一致」而非缺陷。

### CS-06
- 触发条件：用会话面（`mavis_session_messages` 逐条读消息与工具结果）判断某段 hook 上下文是否送达某个会话。
- 影响：**该验收面不携带 hook `additionalContext` 与 `plugin_hook_context`**，因此「在会话里没搜到注入块」**不能推出「没注入」**。实测对照：父会话会话面里 `历史教训（派工时必须写进 brief）` 命中 **0** 次、`实战记录（该成员此前验收通过的成果` 命中 **0** 次、`本轮按编排流程处理` 命中 **0** 次、`本会话已启用 Super-agent 编排机制` 命中 **0** 次——而 `dispatch.mjs:215-220` 对每一次 `task` 调用都必然产出 lessons + records 两个块，`gate.mjs` 与 `session-start.mjs` 也必然产出明文输出。**同一会话面读本会话的首条 user 消息却能读到完整 brief（S4）**。结论：缺席是载体的存放位置问题，不是投递失败。后果：任何「用会话面搜不到某段上下文 ⇒ 判定为缺口」的验收结论都不可靠——包括前轮 `docs/audit/context-flow.md` 摘录 4 的推理形态（父会话 task prompt 无 lessons 段，该事实本身成立且已复现，但由此推广到「additionalContext 不进子会话」这一步不成立）。
- 复现步骤：1) 在父会话 `mvs_9bdda202ae274c909a5b4352fc45a471` 翻 6 页共 300 条消息，全文检索上述 4 个标记 → 命中 0；2) 对照代码：`dispatch.mjs:196-220`、`gate.mjs:52-97`、`session-start.mjs:19-73` 必然产出对应文本；3) 同一会话面读首条 user 消息 → 完整 brief 可读（说明消息面本身工作正常）；4) 在兄弟成员会话 `mvs_3aabaac7506c4fc09b96178c28bde15e` 全文检索「开工前先看」→ 0 次，而该成员的规则原文命中 3 次、命中位置全部落在**成员自己 `read` 错题本文件的工具结果里**（`".superagent/lessons/sa-orchestration-audit.md":{...}`），即自读而非注入。
- 证据：`plugin/scripts/dispatch.mjs:215-220`、`plugin/scripts/gate.mjs:97`、`plugin/scripts/session-start.mjs:73`、`plugin/scripts/guard.mjs:66-74`、`:202-208`。会话面实测数据：父会话 300 条消息 / 4 个标记命中 0；兄弟成员会话「开工前先看」命中 0、「被越界拦截两次后必须立即停手」命中 3（均为自读回显）。
- 状态：已复现
- 修法方向：为 hook 上下文建立**可读观测面**（落一份 hook 输出到可读留痕文件，如已有的 `gate-trace.jsonl` 机制扩展到 PreToolUse），否则「上下文是否送达」只能靠读代码断言；改造验收应改为**读留痕**而非读会话面。本单不改代码。
- 还需要什么：需要运行时侧给出 hook `additionalContext` 的实际投递位置（是否进消息流、进 system 上下文、还是仅进模型内部上下文），才能判定 CS-04 是「已送达但不可见」还是「未送达」。

---

## 八、真实会话原文摘录（事实，非转述）

### 摘录 1 —— 子会话首条 user 消息确实带派工原文与 SCOPE 行（本会话，`mvs_c679482b2b5d459db60cbff1b78cb5aa`，首条 user 消息，1828 字符）

原文片段（逐字）：

```
你是 `sa-context-trace`，Super-agent Router 体系里的专项成员，工作目录 `C:\Users\yang2\Documents\MiniMax\mini code的插件`。

## 你的专项（owns）
上下文注入与传递链路追踪：查清每段上下文的来源、注入时机、载体格式与接收方，产出缺口清单。

## 为什么派给你
用户要求验证编排系统的「成员互相关联性和上下文的记忆、共享性和合作性」，并担心成员之间因上下文混乱互相篡位。你的专项正好覆盖「这段上下文从哪来、经谁手、到谁那里」。

## 路径白名单（可读项用 ro: 标只读；可写项只有最后一个报告文件）
SCOPE: ro: .superagent/roster.json, ro: .superagent/methods/, ro: .superagent/lessons/, ro: plugin/scripts/session-start.mjs, …, docs/audit/context-sharing.md

## 交付物
写 `docs/audit/context-sharing.md`，并在最终回复里给出同样内容的要点摘要（结论先行）。

## ACCEPT（逐条可勾选，每条都要有证据）
1. **上下文总清单**：列出系统里每一段上下文的四要素 —— 来源（文件:行号）/ 注入时机…
```

→ **派工原文、SCOPE 行、ACCEPT、交付物路径四项齐全**，是本链路唯一被完整验证直接进入子会话首条消息的上下文。该消息**不含** `PRIOR_LESSONS`、**不含** `PRIOR_RECORDS`（对应 CS-05）。

### 摘录 2 —— 兄弟成员 brief 同样不带教训段（`mvs_3aabaac7506c4fc09b96178c28bde15e`，`sa-orchestration-audit`，首条 user 消息，2318 字符）

原文片段（逐字）：

```
你是 `sa-orchestration-audit`，Super-agent Router 体系里的专项成员，工作目录 `C:\Users\yang2\Documents\MiniMax\mini code的插件`。

## 你的专项（owns）
编排机制行为缺陷审计：沿 guard/dispatch/watchdog/gate 的判定分支逐条找出可复现的行为漏洞。

## 路径白名单（可读项用 ro: 标只读；可写项只有最后一个报告文件）
SCOPE: ro: .superagent/roster.json, ro: .superagent/methods/, ro: .superagent/lessons/, ro: docs/audit/account-agents-snapshot.json, …
```

→ 该成员**自己**有错题本（`.superagent/lessons/sa-orchestration-audit.md`），但 brief 里**没有** `PRIOR_LESSONS`、**没有** `PRIOR_RECORDS`（CS-05）。同时注意它的 SCOPE 同样含 `ro: .superagent/lessons/` 与 `ro: .superagent/methods/` 目录条目 —— 与摘录 1 同构，CS-03 的条件在兄弟成员身上同样成立。

### 摘录 3 —— 教训规则原文在本会话可被直接读到（CS-03 实证）

本会话内 `read .superagent/lessons/sa-orchestration-audit.md` 返回成功，内容含：

```
- **规则**：被越界拦截两次后必须立即停手，改用 read/grep 取证，并在交付说明里写清还需要哪些路径，由 Router 补 SCOPE；不得用编码、换通道等方式重试
```

同一会话内 `read .superagent/lessons/_router.md` 返回成功，**94 行**（Router 私有账，含 RT-01～RT-05）。两次读取均**未被越界拦截**，尽管本成员的专项是「上下文注入与传递链路追踪」、与该文件所属成员无关。

### 摘录 4 —— 兄弟成员会话里「规则原文」出现的位置是自读回显，不是注入（CS-04 / CS-06）

`mvs_3aabaac7506c4fc09b96178c28bde15e` 的工具结果原文片段：

```
".superagent/lessons/sa-orchestration-audit.md":{"ok":true,"content":"# sa-orchestration-audit 的错题本\\n\\n## 2026-11-09 · 任务「审计编排机制判定分支（第一单）」· 类型：交付缺失\\n- 现象：反复撞越界拦截，40 分钟未能交付清单…\\n- **规则**：被越界拦截两次后必须立即停手，改用 read/grep 取证…"
```

→ 规则原文出现在**成员自己 `read` 该文件的 tool_result** 里；同一会话全文检索 guard 的注入标记「开工前先看」→ **0 次**。据 CS-06，0 次**不能**推出「未注入」，只能推出「本验收面看不到它」。

---

## 九、验证方法与判定位置索引

| 结论 | 判定位置 | 验证手段 | 事实等级 |
|---|---|---|---|
| 注入层按成员文件名隔离，别成员教训不会漏进来 | `lessons.mjs:11-18,31-40`；`dispatch.mjs:137`；`guard.mjs:202-208` | 读码追唯一写入口 + 父会话 4 次派工 prompt 逐条检查 | 已复现 |
| 读模式按目录树放开，跨成员与 Router 私有账可达 | `lib.mjs:233-245`；`guard.mjs:227-239` | 本会话实测两次跨成员 read 成功 | 已复现 |
| Router 私有错题本从未注入 Router | `session-start.mjs:13-14`；全仓无 `readLessons('_router')` | 全仓检索 + 父会话派工实测 | 已复现 |
| 实战记录未进 worker 上下文 | `guard.mjs:26-32,202-208` | import 清单 + 全仓 `readRecords` 调用点检索 | 已复现 |
| 会话面不携带 hook 上下文 | `dispatch.mjs:215-220` 等 | 父会话 300 条消息 4 标记命中 0，同时 brief 可读 | 已复现 |
| lessons→worker 注入通道会静默消失 | `guard.mjs:191-198,205-208` | 读码推演（构造条件未实跑） | 推断 |
| 成员之间无原始上下文共享（无黑板 / 互读 transcript） | `lib.mjs:539-583`；全仓无黑板写入点 | 全仓检索 | 已复现（未见共享写入点） |
| 父会话层面全员记录汇总注入 Router | `records.mjs:50-63`；`session-start.mjs:53-69`；`gate.mjs:77-93` | 读码 | 已复现（路由后果为推断） |

**取证过程中的两点说明（避免把噪声当事实）**：

1. 「历史教训」「实战记录」等字样在会话里大量出现，**多数是成员读取 `dispatch.mjs`/`guard.mjs` 源码后的回显**，不是注入块。本单已逐条区分：判定注入只看 **tool_result** 中是否出现注入块本身（且需排除读码回显）。
2. 兄弟成员会话里规则原文命中 3 次，经逐条打开确认**全部**落在成员自己 `read` 错题本文件的 tool_result 内；本单未把回显计为注入。

**本单的边界**：只做追踪与取证，未改动任何机制代码（`plugin/scripts/` 全程只读）、未删除任何文件、未推送远端；对「是否共享上下文」「成员是否应能读彼此错题本」等产品级决策只列事实与后果，不下结论——该决策属父会话。
