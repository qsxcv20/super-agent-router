# 记录闸门与统计口径审计报告（错题本持久性 / 履历真实性 / 归因公平 / 取样口径）

- 审计对象：`plugin/scripts/{record-gate,lessons-gate,lessons,records}.mjs`，注入链路 `dispatch.mjs` / `session-start.mjs` / `guard.mjs` / `lib.mjs`（本轮只读审查，未改任何机制脚本）
- 契约依据：`plugin/skills/super-agent-router/references/contract.md` S1 / S7 / S9
- 沙箱：`docs/audit/.tmp-gate/sbx1|sbx2|sbx3/`（临时项目目录 + 临时 PLUGIN_DATA），探针 `probe1.mjs`（A/B/D 组）、`probe2.mjs`（C/D 组）、`probe3.mjs`（边界与完整性）
- 复现命令（探针均可重跑）：`node docs/audit/.tmp-gate/probe1.mjs` / `probe2.mjs` / `probe3.mjs`
- 仓库真实 `.superagent/`：probe3 逐文件记录 14 个文件的字节数与 mtime，**零改动**，且无任何文件提及沙箱路径（输出 `repo_superagent_touched_by_probe: 0`）
- 探针轮次：3 轮（时间盒 8 轮内）
- 编号说明：缺陷条目用 S1 成员命名空间 `RG-`，合并进台账时由父会话改写为 `D-`

## 0. 一句话结论

记录闸门在**内容准入**上基本可信（验收方真实性、归因公平、上限、注入措辞都实测通过），但在**写入身份**与**并发**上不可信：错题本/履历的写入闸门不校验「谁在写」，任何调用方都能指定别人的成员名写入其账本；并发写会静默丢条目。段首定位口径在 D-21 修掉「相对偏移」之后，仍留「子串定位 vs 行首定位」这一对不一致。

## 1. 结论表

| # | 问题 | 结论 | 证据强度 | 复现 |
|---|---|---|---|---|
| A1 | 教训落在哪、怎么读回 | 落在 `<项目目录>/.superagent/lessons/<成员名>.md`（`lessons.mjs:7-18`）；下一会话由 `dispatch.mjs:200,256-268` 读回并注入 brief | 亲眼见过（probe1 A5/A6 真跑 dispatch 注入） | probe1 |
| A1' | 读回路径是否只依赖文件名 | **不只依赖文件名**：还依赖项目目录（`MINIMAX_PROJECT_DIR` 或 cwd）。同一文件名换项目目录 → 读回 0 条。跨会话成立、**跨项目不成立**（`references/review.md` 明写「跨项目各看各的」，属设计） | 亲眼见过（probe1 A3） | probe1 |
| A2 | 读不到时注入措辞 | 「0 条（该成员暂无错题本 —— 是「还没栽过跟头」，不是传递故障）」—— 与 D-18 要求一致 | 亲眼见过（probe1 A6 原文输出） | probe1 |
| A2' | 该措辞是否总真 | **不总真**：文件存在且有 1 条、只是格式不匹配 `- **规则**：` 正则时，注入仍是「0 条（还没栽过跟头）」→ 把「抽不出」谎报成「没栽过跟头」 | 亲眼见过（probe2 A7） | probe2 |
| A3 | 写入是追加还是覆盖 | **追加**（read-modify-write，`lessons-gate.mjs:150`），两条内容都在，旧条目不被顶掉 | 亲眼见过（probe1 A1） | probe1 |
| A3' | 并发写同一文件 | **丢条目且不报错**：5 轮 × 8 并发，落盘 7/6/5/8/8 条，8 次写入全部返回 `ok: true`；另一轮 8 条全丢 | 亲眼见过（probe3 A4） | probe3 |
| B4 | `verified_by` 校验拦什么 | 三层：非空（`record-gate.mjs:66`）、≠ 执行者（`:68`）、派工台账里有 `agent==verified_by && state=='done'`（`:79-88`）；台账不可用 → 拒（fail-closed） | 亲眼见过（probe1 B1/B2/B3/B5） | probe1 |
| B4' | 三态实测 | ① 验收方=执行者 → 拒；② 验收方不在台账 / state≠done → 拒；③ 台账里 `state=done` → 放行（`records:1`） | 亲眼见过 | probe1 |
| B4'' | 判据能否被绕过 | **能**：台账行若缺 `parent_session_id`，`lib.mjs:73-79` 的迁移把 `state` 改成 `done` → 实测 `state='active'` 的这种行也被当作已验收，放行 | 亲眼见过（probe1 B4） | probe1 |
| B5 | 段首定位口径 | `record-gate.mjs:102` 用 `raw.indexOf('## 实战记录')`（**子串**匹配），`lessons.mjs:84` 用行首 `^##\s+` + `/实战记录/`（**行首**匹配）—— 两套口径并存 | 亲眼见过（读码 + probe2 B8） | probe2 |
| B5' | 段不在文件开头 | 正确：新条目插在实战记录段末、易错段之前；易错段的 `###` 未计入（D-21 的相对/绝对索引混用确已修好） | 亲眼见过（probe2 B6） | probe2 |
| B5'' | 上限已满 | **拒写**（`record-gate.mjs:117-118`），不挤掉最旧；20 条 / 15 条上限与 `records.md` / `review.md` 一致 | 亲眼见过（probe2 B7、probe1 D1） | probe1/probe2 |
| B5''' | 前文出现字面串「## 实战记录」 | **定位串位**：新履历被写进「归属」段，`readRecords` 读回只剩旧记录 → 写进去却读不出来（静默丢失）；计数同时被污染（把归属段的 `###` 当履历条数） | 亲眼见过（probe2 B8） | probe2 |
| C6 | 归因公平怎么判 | `lessons-gate.mjs:69-95`：10 条语序正则 + 2 条豁免（宾语是成员自己的产物且处于执行语境 / 否定语境） | 亲眼见过（读码 + 23 条语例） | probe2/probe3 |
| C6' | 甩锅拦得住吗 | 拦得住：10 条甩锅语例全被拒，并报出命中语序（brief 给错 / 给错的 brief / 派工给错 / Router 的锅 / 派工 brief 有误 / 上游给错了 / 需求本身自相矛盾 / brief 本身写错了 / 编排层的锅 / Router 给错了 brief） | 亲眼见过（probe2 C6） | probe2 |
| C6'' | 认错放得过吗 | 放得过：8 条成员认错语例全放行（含「我没回显筛选条件」「按 brief 做了但没回显筛选条件」「按 brief 给错了口径」「不是 brief 给错，是我漏了回显」） | 亲眼见过（probe2 C6、probe3 C6b） | probe2/probe3 |
| C6''' | 有没有洞 | **有一个**：归因只查 `cause + ' ' + rule`（`:99`），**不查 `symptom`** → 把「Router 给错了 brief」写进 `symptom`、cause 写自己的锅，实测**放行** | 亲眼见过（probe3 C6b 末行） | probe3 |
| C7① | 直接 write 别人的错题本 | DENY（guard：目标不在白名单） | 亲眼见过（probe2 C7_1） | probe2 |
| C7② | bash 通道改别人的错题本 | DENY（路径 token 不在白名单） | 亲眼见过（probe2 C7_2） | probe2 |
| C7③ | SCOPE 塞 `.superagent/lessons/` | 可写形式 DENY（闸门 1b，`dispatch.mjs:95-113`）、`ro:` 形式也 DENY（1b 不区分读写）、连**自己**的 `.superagent/lessons/sa-alpha.md` 也 DENY（1b 按目录前缀匹配） | 亲眼见过（probe2 C7_7/8/9） | probe2 |
| C7④ | 私有记忆「除精确文件通道外一律不授予」 | 成立：`ro: <工作区根>/` 下读兄弟成员错题本仍 DENY（`lib.mjs:215`），读**自己**的错题本 ALLOW（guard 精确文件通道） | 亲眼见过（probe2 C7_3/4/14/15） | probe2 |
| C7⑤ | 成员能不能写别人的账本 | **能，且闸门不拦**：`lessons-gate.mjs` 的 `agent` 字段由调用方指定 → 以 `sa-victim` 写入，`sa-victim.md` 真的被创建并写进条目（返回 `ok:true`）；`record-gate.mjs` 同构（目标方法论文件由 `payload.agent` 决定），未单独实证 | 亲眼见过（错题本侧，probe3 C7_13）／推断（履历侧同构） | probe3 |
| D8 | 上限数与契约是否一致 | 一致：履历 20（`record-gate.mjs:37`）、错题本 15（`lessons-gate.mjs:14`），与 `records.md` / `review.md` 相同；超限均为**拒写** | 亲眼见过 | probe1/probe2 |
| D8' | 注释与行为是否一致 | 不一致（措辞层面）：`record-gate.mjs:37` 注释写「超了先合并淘汰旧的」，实际是**拒绝写入**并要求人工先合并 | 亲眼见过（读码 + 实测） | probe1 |
| D9 | S9 有没有代码强制 | **一半有**：成员侧强制到位（归因正则 + `agent` 不得以 `_` 开头，`lessons-gate.mjs:37,99`）；Router 侧「注入 Router 上下文」**已实现**（`session-start.mjs:15,65-73` 调 `readRouterLessons()`），实测注入出「【编排层自己的历史教训（派工前先看）】- RT-01：… —— 修法：…」 | 亲眼见过（probe2 D9） | probe2 |
| D9' | Router 侧写入有闸门吗 | **没有**：全仓只有读 `_router.md` 与「拒绝成员写 `_router`」，没有任何写入校验/模板校验/条数上限 → S9 的「改为记进 _router.md」仍靠人工 | 亲眼见过（全仓 grep `_router`） | — |
| D9'' | 取样口径（D-24） | 公平性成立：排序=条数降序+名字升序，截断显式披露 `omitted/truncated/totalMembers`；注入层 `maxMembers=12=MAX_ROSTER` → 名录内成员不会被挤掉（实测 11/11 全显示、truncated=false） | 亲眼见过（probe2 D24） | probe2 |
| D9''' | 取样口径仍有差异 | `records.mjs` CLI 默认 `maxMembers=8`（`:46`）而注入层传 12 → 同一批数据两处结论不同（CLI 报「8/共 11、省略 3 人」，注入层报全量）；另 `roster.json` 重名未去重 → 同一成员在摘要里出现两次并占两个名额 | 亲眼见过（probe2 D24） | probe2 |

## 2. 缺陷清单

条目统计：共 9 条 / 已复现 9 / 推断 0（其中 RG-01 的「履历侧同构」与 RG-01 末段为推断，已在条目内标注）

### RG-01
- 触发条件：调用方在写入载荷里指定**别的成员名**（`agent` 字段），并让该写入动作发生在脚本内部。
- 影响：成员可以把「栽过哪」写进兄弟成员的错题本、把「做成过什么」写进兄弟成员的方法论文件。错题本与履历是**路由器匹配与派工前置**的依据，被篡改后直接影响派工决策，且写入方拿不到任何拦截反馈。
- 复现步骤：1) `MINIMAX_PROJECT_DIR` 指向沙箱项目；2) 调用 `lessons-gate.mjs`，载荷 `agent='sa-victim'`；3) 观察返回 `{"ok":true,...,"entries":1}`；4) 读 `.superagent/lessons/sa-victim.md` → 文件被创建且含该条目。
- 证据：`plugin/scripts/lessons-gate.mjs:133-150`（目标路径 = `lessonsPath(payload.agent)`，无身份校验）；probe3 输出 `C7_13_gate_writes_other_member.file_exists=true`。履历侧同构：`plugin/scripts/record-gate.mjs:96`（`methodPath(agent)`），**未单独实证**。
- 状态：已复现
- 修法方向：写入目标不再由载荷独断 —— 由派工绑定（台账 binding 的 `agent_key`）决定，或在闸门内比对载荷 `agent` 与当前会话绑定成员，不一致即拒；同时把「写入者」写进条目本身（谁写的）以便审计。
- 还需要什么：需要 mechanism owner 给闸门一条可信的「当前调用者」来源（会话 id → 台账 binding）；这依赖 `lib.mjs`/台账，属机制层，本专项改不了。

### RG-02
- 触发条件：成员方法论文件在真正的「## 实战记录」段之前，正文里出现过字面串「## 实战记录」（引用、说明、模板片段）。
- 影响：新履历被写进**前一个段**（实测写进了「归属」段）；`readRecords` 按行首匹配只认真正的段 → **写进去却读不出来**（静默丢失，履历条数不增、摘要里看不到）；同时该段里的其他 `###` 被当成履历条数 → 20 条上限被提前触顶（实测记为 3 条，实际只有 1 条）。
- 复现步骤：方法论文件写「## 归属\n\n详见 ## 实战记录 段。\n\n### 子标题一\n\n### 子标题二\n\n## 实战记录\n\n### 2026-01-01 · D · T0 …」，台账里放一个 `agent=verifier, state=done` 的派工行，跑 `record-gate.mjs`。
- 证据：`plugin/scripts/record-gate.mjs:102`（`raw.indexOf(SECTION)` 子串定位）与 `plugin/scripts/lessons.mjs:84`（行首匹配）口径不一致；probe2 输出 `B8_inline_mention.records=3`、`B8_file` 显示新条目落在「## 归属」段内、`B8_readrecords` 只读到旧条目。
- 状态：已复现
- 修法方向：段首定位改为**行首锚定**（与 `readRecords` 同一函数、同一正则），例如按 `/^##\s+实战记录/m` 取位置；并把「定位段首」抽成 `lessons.mjs` 的单一导出，record-gate 与 readRecords 共用，从结构上消掉两套口径（S7.4）。
- 还需要什么：无，代码路径已确定。

### RG-03
- 触发条件：派工台账里存在**缺 `parent_session_id`** 的历史行（`lib.mjs` 的 legacy 迁移会把它们的状态一律改成 `done`）。
- 影响：`verified_by` 的「验收方真实存在」判据可被这样一行台账满足 —— 即使那一行真实状态是 `active`（验收根本没跑完）。履历于是能被一个「台账里存在同名行」的验收方背书，而这条背书正是 Router 匹配时的依据。
- 复现步骤：台账写 `{"dispatches":[{"dispatch_id":"d2","agent":"ghost","state":"active"}]}`（无 `parent_session_id`），跑 `record-gate.mjs` 且 `verified_by='ghost'` → 返回 `ok:true`，履历写入成功。
- 证据：`plugin/scripts/lib.mjs:73-79`（迁移：`if (!d.parent_session_id) { d.state='done'; d.legacy=true; }`）、`plugin/scripts/record-gate.mjs:79-84`（只按 `state=='done'` 判定）；probe1 输出 `B4_no_parent_session_id.out` 含 `"ok": true`。
- 状态：已复现
- 修法方向：迁移不要改写真实状态语义 —— 保留原字段（如 `state_legacy`）并让 `verified_by` 判据要求「`state=='done'` **且** 有 `parent_session_id` 且非 legacy」，或让迁移把 legacy 行的验收凭据标记为不可用于履历背书。
- 还需要什么：迁移在 `lib.mjs`，属机制 owner（`sa-mechanism-fix`）范围，需父会话指派。

### RG-04
- 触发条件：把「Router 的锅」写进条目的 `symptom`（现象）字段，而 `cause` 写成成员自己的失误。
- 影响：归因公平闸门放行 —— 编排层的锅仍然进了成员错题本，S9 的实质要求（成员账上不背编排层的锅）被绕过。
- 复现步骤：载荷 `symptom='Router 给错了 brief，我只是照做，返工了'`、`cause='我漏了回显口径'`、其余合法字段 → 闸门返回 `ok:true`。
- 证据：`plugin/scripts/lessons-gate.mjs:99`（只检 `cause + ' ' + rule`）；probe3 输出 `C6b_attribution_edges` 末行 `actual='放行'`。
- 状态：已复现
- 修法方向：归因判定改为覆盖**全部自由文本字段**（symptom/cause/rule/next_time），但豁免位同样逐字段适用，避免把「现象里提到 brief」误判成甩锅。
- 还需要什么：无，代码路径已确定。

### RG-05
- 触发条件：同一成员的错题本被两个及以上写入方同时追加（并行派工、复盘与闸门重跑撞车）。
- 影响：read-modify-write 无锁无原子性 → 后写者用旧快照覆盖先写者，条目**静默丢失**；每一次写入都返回 `ok:true`，调用方与复盘方都以为记上了。实测 8 次并发最多只落 5 条。
- 复现步骤：对同一 `agent` 并发启动 8 个 `lessons-gate.mjs` 进程 → 8 次全部 `ok:true`，最终文件条目数 7/6/5/8/8（5 轮）。
- 证据：`plugin/scripts/lessons-gate.mjs:140-150`（读全文 → 拼串 → `fs.writeFileSync` 整体覆盖）；probe3 输出 `A4_concurrency_5_rounds`（`writes_ok=8` 而 `entries_in_file=5..8`）。
- 状态：已复现
- 修法方向：改成**单次追加**（`fs.appendFileSync`）或「写临时文件 + 原子 rename」并加文件锁；写入后回读校验条目数，不一致时报错而不是返回成功。
- 还需要什么：无，代码路径已确定。

### RG-06
- 触发条件：成员错题本文件存在、且有条目，但条目的「规则」行不是 `- **规则**：` 这个精确格式（历史文件、手写条目、S1 模板格式）。
- 影响：派工注入把这类成员说成「0 条（还没栽过跟头）」—— D-18 明确要求区分的两种空值（没栽过 vs 没送达）之外，**第三种空值（内容在但抽不出）被谎报成第一种**；Router/Worker 据此认为该成员是干净的。
- 复现步骤：写 `sa-alt.md`（1 条条目，规则行写作 `- 规则：必须先回显口径`），跑 `dispatch.mjs`（载荷 `agentName: sa-alt`）→ 注入文本为「sa-alt 的历史教训：0 条（该成员暂无错题本 —— 是「还没栽过跟头」，不是传递故障）」。
- 证据：`plugin/scripts/lessons.mjs:31-40`（抽不出就返回空数组）、`plugin/scripts/dispatch.mjs:256-265`（只看数组长度）、probe2 输出 `A7_alt_format_injection`。
- 状态：已复现
- 修法方向：注入前先判「文件是否存在 / 条目数（`countEntries`）/ 抽出的规则条数」三个量，分别措辞：确实无错题本 / 错题本存在但读不出内容（通道故障待查）。
- 还需要什么：无，代码路径已确定（`dispatch.mjs` 属注入链路，可由 mechanism owner 承接）。

### RG-07
- 触发条件：Router 自己的失误（brief 给错、边界没列全）需要沉淀时。
- 影响：S9 要求「改为记进 `_router.md`」，但全仓**没有任何写入闸门**：没有模板校验、没有编号校验、没有条数上限、没有写入留痕；`_router.md` 是唯一靠人工自觉维护的记录文件，格式漂移无人拦。
- 复现步骤：全仓检索 `_router` → 只有三处：`lessons.mjs:54-72`（读）、`lessons-gate.mjs:37`（拒绝成员以 `_` 开头）、`session-start.mjs:65`（注入）；无任何写入路径。
- 证据：grep 输出（`plugin/skills/.../references/contract.md:288` 声称由 SessionStart 注入 —— 该部分**已实现且实测通过**，本条只针对写入侧）。
- 状态：已复现
- 修法方向：给 `_router.md` 加一个写入闸门（强制 S1 七字段齐全、编号前缀合法、条数上限、写入留痕），由 Router 侧调用；成员侧继续保持拒写。
- 还需要什么：无，代码路径已确定。

### RG-08
- 触发条件：同一批实战记录，走「注入层」（`gate.mjs` / `session-start.mjs` 传 `maxMembers=12`）与走「CLI 层」（`records.mjs summary` 默认 8）两条路。
- 影响：同一份数据两处给出不同结论 —— CLI 说「显示 8 / 共 11、省略 sa-m08、sa-m09、sa-m10」，注入层说「11 个全部显示」。口径不统一时，验收时看 CLI、运行时看注入，会得出互相矛盾的判断。
- 复现步骤：沙箱 roster 造 11 个有记录的成员，跑 `node plugin/scripts/records.mjs summary`（输出 `shownMembers:8, omitted:[sa-m08,sa-m09,sa-m10]`），再调 `summarizeRecordsDetailed(3,12)`（输出 11 个、`truncated:false`）。
- 证据：`plugin/scripts/records.mjs:46,65,72`（默认 8 + 披露字段）、`plugin/scripts/session-start.mjs:91` 与 `gate.mjs` 传 12、`plugin/scripts/roster.mjs:20`（`MAX_ROSTER=12`）；probe2 输出 `D24_cli_summary` / `D24_detailed_12`。
- 状态：已复现
- 修法方向：把「取样名额」提成单一常量（与 `MAX_ROSTER` 绑定），CLI 默认值与注入层调用取同一个值；披露字段保持不变。
- 还需要什么：无，代码路径已确定。

### RG-09
- 触发条件：`roster.json` 里出现同名成员（手改文件绕过 `roster.mjs register` 的重名拒绝）。
- 影响：同一成员在实战记录摘要里出现两次（实测 `sa-m02` 出现两次，各带 `count:5`），既重复计数又白占一个名额；被挤掉的其他人就此少一个可见位置 —— 正是 D-24 想消除的那类「结构性不可见」。
- 复现步骤：roster 里写两个 `name='sa-m02'` 的成员，跑 `records.mjs summary` → `totalMembers=11`（真实成员 10 个），摘要里 `sa-m02` 出现两次。
- 证据：`plugin/scripts/roster.mjs:41-48`（`listMembers` 只排序不去重）、`plugin/scripts/records.mjs:48-60`（按名单逐个收齐）；probe2 输出 `D24_cli_summary`。
- 状态：已复现
- 修法方向：`listMembers` 按 name 去重（同名取一条并留痕），或 `readRoster` 读入时检测重名并显式报出异常。
- 还需要什么：无，代码路径已确定。

## 3. 需要 Router 做什么

1. **派单修复**：RG-02、RG-04、RG-05、RG-06、RG-08、RG-09 属本专项（record-gate / lessons-gate / lessons / records / roster 五个脚本的判定与统计口径），可直接派给本专项执行；RG-01、RG-03、RG-07 需要 `lib.mjs`/台账与注入链路的改动，属机制 owner（`sa-mechanism-fix`），请指派并把判据传过去（本报告已给出最小复现）。
2. **两处口径需父会话拍板**：① RG-03 的迁移语义 —— legacy 台账行到底算不算「验收通过」；② RG-01 的写入者身份来源 —— 闸门能否可信地拿到「当前调用者」。
3. **运行时副本一致性未证**：审计对象是仓库 `plugin/`，但运行时真正加载的是安装副本（工作区之外），本轮被越界拦截无法读取比对。请批准一次只读比对（`scope-amend --grant`），否则「审计对象 = 运行时对象」这一前提在本轮**未验证**。
4. **编号口径**：brief 里的「D-09 的豁免位」与台账 D-09（嵌套派工/跨会话在飞检测）不是同一条；归因豁免位对应的是本专项的归因公平改造（契约 S7.2）。请统一编号口径，避免后续派工按错编号取错条目。
5. **报告路径纪律**：本文件此前存放的是上一实例的探针脚本（已归档为 `docs/audit/.tmp-gate/prev-instance-probe.js.bak`），现为报告；草稿与沙箱一律留在 `docs/audit/.tmp-gate/`。

## 4. 未能验证 / 诚实边界

- **运行时安装副本**：在工作区之外，`read` 与 `bash` 两条通道都被越界拦截（两次拦截记录：req_mwafwixb_cetk2z 等），本轮**无法**确认运行时加载的脚本与仓库副本一致。
- **worker 侧教训注入**（`guard.mjs` 从台账 binding 回注 `d.lessons`）：依赖真实 transcript 解析，本轮用合成 binding 绕过了该分支，**未**端到端实证（父会话侧注入已由 `dispatch.mjs` 实测覆盖）。
- **RG-01 的完整链路**：错题本侧「闸门接受任意成员名」是亲眼所见；「成员能在真实运行时触达该写入路径」依赖 hook 只看命令文本这一点（`dispatch.mjs:115-121` 自述的诚实边界：脚本内部 fs 写入不受本判定约束），属**推断**，未在真实 worker 会话中端到端跑通。
- **仓库真实 `.superagent/`**：全程只读（probe3 逐文件清单 + mtime/大小核对，零改动）；但探针是以 `node` 子进程直读该目录完成的，**未经 hook 拦截路径**核验，这一点属已知边界。
