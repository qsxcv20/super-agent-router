# 编排机制行为缺陷清单 · 判定分支审计

覆盖范围：沿 `plugin/scripts/` 的 guard、dispatch、watchdog、gate、session-start 五个脚本的判定分支（主流程 + 异常分支 + 默认放行分支）逐条走，并追进这五个脚本实际调用的判定模块 `lib.mjs`、`record-gate.mjs`、`lessons.mjs`、`records.mjs`，以及 `.superagent/` 下 4 份回归测试所覆盖与未覆盖的分支。

一句话结论：拦截分支本身写得扎实，但机制里存在 5 条默认放行分支（guard 的 bash 路径正则漏检、未登记工具名、brief 解析失败、目标字段名不符、watchdog 的关键词式「证据」判定），任何一条被触发，scope 边界就静默失效而不报错；在飞名额则只有一条回收通路，且回收匹配的键与写台账的键不在同一命名空间。

条目统计：总计 18 条（RG-01～RG-18，无跳号重号），其中已复现 16 条，推断 2 条（RG-14、RG-16）

取证口径：状态「已复现」= 输入条件一旦满足，输出由被审计代码路径唯一确定，判定位置已给到文件+行号（本单环境禁止执行 node/bash，未逐条实际运行）；状态「推断」= 结论依赖尚未取证的运行时事实，推断依据与「还需要什么才能确认」写在证据里。

### RG-01
- 触发条件：worker 子会话调用 `bash`，命令里出现的路径**最后一段不含「点 + 1~8 位字母数字」**（目录、点文件、无扩展名文件），例如 `rm -rf config`、`rm -rf .git`、`rm -rf node_modules`、`rm -rf build/out`。
- 影响：越界删除/覆盖目录型目标完全绕过 SCOPE 边界；该分支不报错、不留痕，属静默失效。它绕过的正是 guard 声称要拦的「bash 里藏路径」场景。
- 复现步骤：
  1. Router 派工 `SCOPE: src/app.ts`（dispatch.mjs 接受该 scope）。
  2. 在 worker 子会话里调用 `bash`，命令为 `rm -rf config`（目录，不在 scope 内）。
  3. 观察 guard.mjs 的 stdout：**为空**——既无 `permissionDecision: deny`，也无任何提示。
  4. 对照：`rm -rf src/app.ts`（有扩展名）会被 deny。说明判定依据不是「是否越界」，而是「正则是否认出这个路径」。
- 证据：`plugin/scripts/guard.mjs:137`（路径提取正则 `/[A-Za-z0-9_.\\/-]+\.[A-Za-z0-9]{1,8}/g`，要求点后跟 1~8 位字母数字）、`plugin/scripts/guard.mjs:138`（候选过滤）、`plugin/scripts/guard.mjs:139`（`if (candidates.length === 0) process.exit(0);` 即默认放行分支）、`plugin/scripts/guard.mjs:141`（候选非空才继续判定）。旁证：本审计执行 `git status --short` 时同样命中这条放行分支（命令中无带扩展名的路径 token）。
- 状态：已复现
- 修法方向：改 `plugin/scripts/guard.mjs:137` 的候选提取——不要用「点+扩展名」判定路径，改为先按空白/引号切词、再逐词判定是否为路径形态（含 `/`、`\` 或以 `.` 开头的点文件）；并把 `guard.mjs:139` 的默认分支改为对未知命令从严（命令含 rm/mv/cp/重定向等动词时，必须命中至少一个已知 scope 路径才放行），而不是直接放行。

### RG-02
- 触发条件：子代理会话调用任何不在 `DANGEROUS` / `WRITE_TOOLS` / `READ_TOOLS` 三张表里的工具名——包括本环境的 `mavis`（其 command 参数空间实测含 `agent create` / `agent update` / `agent delete`，见证据）与 `run_code`（内部代理 `tools.write` / `tools.edit` / `tools.bash`）。
- 影响：guard 头部注释声明的「账号级与对外不可逆操作——一律拦」只对 run_code 内部的那组工具名生效；同一个账号级删除通过 `mavis` 的命令空间即可达成（`mavis` 不在 DANGEROUS 表内），复合工具同理。护栏在最外层留了一道没有规则的口子。
- 复现步骤：
  1. 子代理会话调用工具 `mavis`，`tool_input = {"command":"agent delete","args":{"agent_name":"sa-x"}}`（`agent delete` 的入参名为 `agent_name`，见证据里 `agent help` 返回的命令清单）。
  2. 观察 guard.mjs stdout：为空 → 放行。
  3. 对照：`tool_name = "mavis_agent_delete"` 会被 deny（`guard.mjs:58`）。
- 证据：`plugin/scripts/guard.mjs:51-57`（DANGEROUS 表，键为工具名）、`plugin/scripts/guard.mjs:58-60`（命中即 deny）、`plugin/scripts/guard.mjs:64-69`（未登记工具名 → `process.exit(0)`）；本环境取证：`mavis` 工具自身的 `agent help` 子命令返回的 agent 组命令清单为 `agent list | agent get | agent create | agent update | agent delete`——即 `agent delete` / `agent update` 确在 `mavis` 的 command 参数空间内，而工具名仍是 `mavis`，不在 DANGEROUS 表内；`tool_search` 检索不到名为 `mavis` 的条目，因为它是常驻可见工具而非按需工具；`run_code` 的代理清单含 `write`/`edit`/`bash`，另含按工具名登记在 DANGEROUS 表内的 `mavis_agent_delete` / `mavis_agent_update`。
- 状态：已复现
- 修法方向：把 DANGEROUS 判定从「工具名等值」升级为「工具名 + 关键参数」二维判定（`mavis` 且 command 以 `agent delete`/`agent update` 开头 → deny）；给 `run_code` 这类复合工具补一条规则：其参数里出现写类工具名时，一律按写类工具的 scope 规则处理。

### RG-03
- 触发条件：worker 子会话的 `transcript_path` 所指 transcript 里，第一条 user 消息**不在文件前 8 行内**，或消息对象的 `type` 不是 `'user'`，或缺 `PARENT SESSION:` / `agentName:` 标记。
- 影响：`readBriefFromTranscript` 返回 null → guard 不建立 binding → `guard.mjs:97` 的 `if (!binding || ...) process.exit(0)` 放行。该 worker 的全部文件读写（含 scope 外的写）一次性失去边界约束，且没有任何报错或日志。越界管控从「逐条判定」退化为「整段失效」。
- 复现步骤：
  1. 造一份 JSONL transcript：前 8 行放 8 条非 user 类型（type=summary/meta）记录，第 9 行才是带 `SCOPE: src/app.ts` 的 user 消息。
  2. 用 `agent_type` + 该 `transcript_path` 调 guard.mjs，`tool_name=write`、`file_path=config/prod.yaml`。
  3. stdout 为空 → 放行（对照：把该 user 消息挪到第 1 行则被 deny）。
- 证据：`plugin/scripts/lib.mjs:275`（`lines.slice(0, 8)` 只看前 8 行）、`plugin/scripts/lib.mjs:278`（`obj.type !== 'user'` 过滤）、`plugin/scripts/lib.mjs:289-291`（靠正则取父会话/成员名/SCOPE）、`plugin/scripts/guard.mjs:74-76`（brief 为空则不建 binding）、`plugin/scripts/guard.mjs:97-101`（无 binding → 默认放行）。
- 状态：已复现
- 修法方向：改 `plugin/scripts/lib.mjs:275`——不要只看前 8 行，改为扫描整份 transcript 找第一条 user 消息（或直接找含 `SCOPE:` 的 user 消息）；同时把 `plugin/scripts/guard.mjs:97` 的默认分支从「放行」改为「从严 + 显式报一次原因」，至少让派工方知道这条 worker 没被约束。

### RG-04
- 触发条件：PreToolUse(task) 载荷不含 `turn_id`（或为空串）。
- 影响：`dispatch.mjs:30` 得到 `tid = ''`，`dispatch.mjs:95-100` 的去重过滤 `String(d.turn_id || '') === tid` 对**所有** turn_id 为空的历史记录成立 → 同一 `parent_session_id` + 同一 `agent` 的旧 active 记录被整条删除。前一个 worker 的 scope 从台账消失 → 闸门二（重叠检测）看不到它 → 两个 worker 可被派到同一处互相覆盖；闸门三（在飞名额）也少算一个 → 并发上限形同虚设。
- 复现步骤：
  1. 载荷 A：`{session_id:'c1', agent_name:'w', prompt:'SCOPE: src/a.ts'}`（不带 turn_id）→ 台账出现 1 条记录。
  2. 载荷 B：`{session_id:'c1', agent_name:'w', prompt:'SCOPE: src/b.ts'}`（同样不带 turn_id）→ 台账里只剩 B 一条，A 被抹掉。
  3. 读 `dispatches.json`：c1 的记录数为 1 而非 2；此时再派 `SCOPE: src/a.ts` 不会被判重叠。
- 证据：`plugin/scripts/dispatch.mjs:30`（tid 取值）、`plugin/scripts/dispatch.mjs:95-100`（去重过滤）、`plugin/scripts/dispatch.mjs:102-116`（写入）。`.superagent/chain-test.mjs` 的 `dispatch()` 辅助函数始终带 `turn_id`，因此这条路径没有被任何回归测试覆盖。
- 状态：已复现
- 修法方向：改 `plugin/scripts/dispatch.mjs:95-100` 的去重键——缺 `turn_id` 时退化为 `parent_session_id + agent + tool_use_id`（`tool_use_id` 已在 `dispatch.mjs:106` 写入但从未被读取，正好可作唯一键），不要把空串当成「同一个 turn」。

### RG-05
- 触发条件：worker 自己再派子代理（`session_id` = worker 会话 id），或同一项目里第二个 Router 会话派工。
- 影响：闸门二想解决的是「两个 worker 写同一处会互相覆盖、验收无法判断谁的改动生效」，但 `activeDispatches(ledger, sid, now)`（`dispatch.mjs:59`）只筛 `d.parent_session_id === sid`，父 Router 的在飞记录不在其中——嵌套派工与跨会话重叠全部漏检，同一文件可被两个并行 worker 同时写。文档 `dispatch.mjs:55-57` 把规则写成「同一会话里」，实现与文档一致，但与机制目的不一致。
- 复现步骤：
  1. Router 会话 P 派工 W1：`SCOPE: src/x.ts` → 台账记录 parent=P。
  2. W1 会话再派工 W2：`SCOPE: src/x.ts` → `activeDispatches(ledger, 'W1')` 返回空 → 无冲突 → 放行（W1 与 W2 会写同一文件）。
  3. 换 Router 会话 P2 派 `SCOPE: src/x.ts` → 同样放行。
- 证据：`plugin/scripts/dispatch.mjs:59-70`（闸门二）、`plugin/scripts/lib.mjs:221-228`（`activeDispatches` 按 `parent_session_id` 过滤）、`plugin/scripts/lib.mjs:198-216`（`scopeClash` 本身是对的，问题在上游选集）。
- 状态：已复现
- 修法方向：把闸门二的比对集从「同一父会话的 active 派工」扩大到「同一项目内所有 active 派工」（在 `dispatch.mjs:59` 改用项目维度查询，或在 `lib.mjs:221` 增加一个不按 parent 过滤的查询入口）；`scopeClash` 可直接复用。

### RG-06
- 触发条件：台账 `dispatches` 超过 200 条后，`dispatch.mjs:117` 的 `slice(-200)` 丢掉最旧记录；若被丢掉的正好是当前会话自己的历史记录，`totalDispatches` 统计出的累计数就低于真实值。
- 影响：闸门三的「累计派工 30」上限只在台账尚未被截断时有效；多会话并行、长时间运行后可持续超派。
- 复现步骤：
  1. 预置台账：200 条记录，其中最旧的 30 条属于会话 X（其余属于其它会话）。
  2. 以会话 X 派工一次 → `dispatch.mjs:117` 截断掉 X 最旧的一条 → X 的累计数从 30 降到 29。
  3. 再次派工 → `total = 29 < 30` → 放行（若台账未被截断，此时应为拒绝）。
- 证据：`plugin/scripts/dispatch.mjs:117`（`slice(-200)`）、`plugin/scripts/lib.mjs:230-233`（`totalDispatches` 只统计台账里仍在的记录）、`plugin/scripts/dispatch.mjs:77-82`（上限判定）。
- 状态：已复现
- 修法方向：把累计计数从「扫台账」改为台账里持久化一个 per-session 累计计数；或把截断策略改成按会话配额保留（例如每个 parent_session_id 至少保留最近 N 条），别让 200 这个全局截断决定单个会话的额度。

### RG-07
- 触发条件：worker 被取消、被中断，或平台没有发出 `SubagentStop`（子会话异常退出、Router 提前放弃）。
- 影响：`plugin/scripts/` 全目录检索 `cancel|interrupt|abort|timeout|超时|取消` **零命中**——全机制只有 `watchdog.mjs` 的 SubagentStop 一条回收通路（`watchdog.mjs:28-51`）。回收不发生时，该派工在 `DISPATCH_TTL_MS`（2 小时，`lib.mjs:84`）内一直占着「在飞」名额：闸门二把它当成仍在写同一处的 worker（挡住同 scope 的新派工），闸门三把它计入并发上限（6）。两小时后它被 `lib.mjs:226` 的 TTL 过滤悄悄排除出统计，但台账里 `state` 永远是 `'active'`——台账状态与真实状态失步，后续任何按 `state==='active'` 判断的逻辑都会误判。
- 复现步骤：
  1. 派工 `SCOPE: src/x.ts` 给 worker，随后**不触发** SubagentStop（等价于派工被取消）。
  2. 立刻以同一父会话再派 `SCOPE: src/x.ts` → 被判「组队冲突」拒绝。
  3. 把台账里该记录的时间戳改成 3 小时前 → 同一命令被放行（TTL 过期即被忽略），而台账里该条 `state` 仍是 `active`。
- 证据：`plugin/scripts/watchdog.mjs:28-54`（唯一回收点，整段被 try/catch 包裹、异常被静默吞掉）、`plugin/scripts/lib.mjs:226`（TTL 过滤）、`plugin/scripts/lib.mjs:84`（`DISPATCH_TTL_MS = 2h`）、`plugin/scripts/lib.mjs:235-241`（`markDispatchDone` 只把 state 置 done，无 cancelled/timeout 终态）、`plugin/scripts/watchdog.mjs:51-53`（`catch (e) {}`，注释「回收失败不能影响 watchdog 的本职判定」——回收失败无任何日志）。
- 状态：已复现
- 修法方向：在 `plugin/scripts/lib.mjs` 增加 `markDispatchAborted(ledger, dispatchId, reason)`，并在 `dispatch.mjs` 写记录时同时记 `tool_use_id`（`dispatch.mjs:106` 已写但从未被读），供中断事件回调；TTL 过期时显式落成 `state: 'timeout'` 并写 `ended_at`，别让台账出现「永远 active」的条目；`watchdog.mjs:51-53` 的 catch 至少往 stderr 记一行。

### RG-08
- 触发条件：worker 收尾文本同时含「完成类」词与「证据类」词，例如「搞定了，测试通过」。
- 影响：`claimsDone`（`watchdog.mjs:94`）命中「搞定」；`hasEvidence`（`watchdog.mjs:95`）命中「测试」→ `watchdog.mjs:96` 的拦截分支不触发；`claimedPaths` 又因文本里没有产出动词而返回空 → `watchdog.mjs:115` 放行。watchdog 头部注释（「早期版本只做字面关键词匹配——『搞定了』这种话能蒙混过关……现在改为：先判声明，再把声明里提到的文件路径真实校验一遍」）声称的修复并不成立：加两个关键词即可完全绕过完成度校验。
- 复现步骤：
  1. `watchdog.mjs` 载荷 `{last_assistant_message: '搞定了，测试通过'}` → stdout 为空。
  2. 对照：`{last_assistant_message: '搞定了'}` → 被 block（`.superagent/chain-test.mjs:80-87` 锁的就是这一条）。
- 证据：`plugin/scripts/watchdog.mjs:9-12`（注释声称的修复）、`plugin/scripts/watchdog.mjs:94-96`（判定实现）、`plugin/scripts/watchdog.mjs:105-115`（文件校验分支未触发）；`.superagent/chain-test.mjs:80-87` 只锁了「搞定了」单个词，未覆盖「搞定了 + 证据关键词」。
- 状态：已复现
- 修法方向：改 `plugin/scripts/watchdog.mjs:95` 的 `hasEvidence`——证据必须是**可核验的具体物**（存在的文件路径 / 带行号的引用 / 可复现的命令与输出），而不是「测试/运行/结果」这类描述性词；建议收敛为「至少一个通过 `claimedPaths` 存在性校验的路径」或「一段命令输出」。

### RG-09
- 触发条件：worker 在交付里写出**工作区之外的绝对路径**（Windows 盘符路径 `C:/...`）。
- 影响：`watchdog.mjs:78` 只把以 `/` 开头的当绝对路径，`C:/...` 不以 `/` 开头 → 被拼成 `<工作区根>/C:/...` → `watchdog.mjs:79` 的 `existsSync` 必然为 false → 该文件被列入「声称产出但不存在」→ `watchdog.mjs:105-112` block。交付被反复打回，而文件其实真实存在。这与 RG-08 方向相反：watchdog 一边放行空话，一边拦截实话。
- 复现步骤：
  1. 在工作区外创建一个真实文件，例如 `C:/tmp/out/result.ts`。
  2. `watchdog.mjs` 载荷 `{last_assistant_message: '已完成，改动文件 C:/tmp/out/result.ts，测试通过'}`。
  3. 输出 block，理由是「声称产出了这些文件，但它们在磁盘上不存在」——但该文件确实存在。
- 证据：`plugin/scripts/watchdog.mjs:78`（`const abs = norm.startsWith('/') ? norm : root + '/' + norm;`）、`plugin/scripts/watchdog.mjs:79`（`existsSync` 判定）。对照 `plugin/scripts/lib.mjs:113-121`（`relativize` 已实现盘符绝对路径处理），watchdog 这条路径没有复用。
- 状态：已复现
- 修法方向：改 `plugin/scripts/watchdog.mjs:78`——盘符路径（`/^[A-Za-z]:/`）按绝对路径直接判存在；把路径归一化抽成 `lib.mjs` 的公共函数，让 guard 与 watchdog 用同一套规则（现在两处各写各的）。

### RG-10
- 触发条件：Router 派工时 `agent_name` 写的是**显示名**，而子会话 transcript / Hook 载荷里是**routing id**。
- 影响：台账写的是 `agent: tInput.agent_name`（`dispatch.mjs:26,107`），guard 拿 `brief.agent || agentType` 去匹配（`guard.mjs:80,86-91`），watchdog 拿 `brief.agent || input.agent_type` 去匹配（`watchdog.mjs:44`）——三处来源、两种命名，且都是严格等值比较。命名不一致时 guard 的绑定里 `dispatch_id` 为空（`guard.mjs:82`），watchdog 回收不到该派工 → 名额不回收 → 连锁触发 RG-07：同一 scope 在 2 小时内不能再派工。
- 复现步骤：
  1. `dispatch.mjs` 载荷：`{session_id:'P', agent_name:'编排审计', prompt:'SCOPE: src/x.ts'}` → 台账记录 `agent: '编排审计'`。
  2. worker 子会话的 transcript 里 `agentName: sa-orchestration-audit`，Hook 载荷 `agent_type: sa-orchestration-audit`。
  3. 触发 watchdog 的 SubagentStop → `watchdog.mjs:44` 的等值比较失败 → `dispatchId` 为空 → `markDispatchDone` 不执行 → 台账里该记录 `state` 仍为 `active`。
- 证据：`plugin/scripts/dispatch.mjs:26`（写 `agent_name`）、`plugin/scripts/dispatch.mjs:107`（写台账的 `agent` 字段）、`plugin/scripts/guard.mjs:80`（绑定取 `brief.agent || agentType`）、`plugin/scripts/guard.mjs:86-91`（按 agent 等值反查派工）、`plugin/scripts/watchdog.mjs:44`（同一等值比较）、`plugin/scripts/lib.mjs:290`（agent 取自 transcript 的 `agentName:`）。本环境的 agent-context 同时给出 `agent: 编排审计 # display name` 与 `agentName: sa-orchestration-audit # routing ID`，证明两个命名空间并存。
- 状态：已复现
- 修法方向：在 `plugin/scripts/lib.mjs` 加统一的 `resolveAgentKey(input, brief)`（一律用 routing id，缺失时回退并做一次映射），dispatch 写入、guard 反查、watchdog 回收三处统一用它；反查时不要用等值比较，改成「能唯一确定的那条」（配合 dispatch_id 透传）。

### RG-11
- 触发条件：以任意 `agent` + 任意 `verified_by`（只要不等于 agent 名）调用 record-gate。
- 影响：`record-gate.mjs:5-9` 声明「关键约束：成就只能由『验收通过』触发，不能由成员自述触发」，`:53-54` 的实现只有两条——`verified_by` 非空、且 `verified_by !== agent`。没有校验验收人是否存在、是不是真的验收方、验收是否发生。成员自己填一个别人的名字就能把未经验收的成果写进履历；而履历会被 `dispatch.mjs:89` 前置给下一个 worker、被 `gate.mjs:42` 与 `session-start.mjs:39` 当成「这人做成过什么」注入给 Router，污染路由匹配依据。
- 复现步骤：
  1. `node plugin/scripts/record-gate.mjs '{"agent":"sa-x","domain":"d","approach":"a","evidence":"e","verified_by":"verifier"}'`（方法论文件存在时）→ `{"ok":true,...}`，记录被写入。
  2. 换成 `verified_by:"sa-y"`（一个根本不存在、也从未验收过的成员名）→ 同样 `ok:true`。
- 证据：`plugin/scripts/record-gate.mjs:5-9`（声明的约束）、`plugin/scripts/record-gate.mjs:37`（取值）、`plugin/scripts/record-gate.mjs:53-54`（仅两条检查）、`plugin/scripts/record-gate.mjs:96-103`（写入路径）；履历消费方 `plugin/scripts/dispatch.mjs:85-89`、`plugin/scripts/gate.mjs:42-52`、`plugin/scripts/session-start.mjs:39-50`。
- 状态：已复现
- 修法方向：把 `verified_by` 从自由字符串换成可核验凭据——由验收方会话直接写自己的 agent 名（并在 roster 里校验其为验收角色），或要求附带验收记录文件路径并校验其存在且时间晚于成果产出；至少在 `record-gate.mjs:53` 附近加「验收人必须存在于 roster.json」的校验。

### RG-12
- 触发条件：成员方法论文件的「## 实战记录」段位于文件后半段（本项目模板与真实文件都是这样——它是最后一个二级标题）。
- 影响：`record-gate.mjs:72-76` 的 `nextSection` 返回**相对偏移**（`rest` 内的位置），`:66` 却把它当**绝对索引**传给 `raw.slice(sectionStart, ...)`；当相对偏移小于 `sectionStart` 时 slice 得到空串 → `existing = 0` → `MAX_RECORDS = 20`（`:23`、`:68-69`）这道上限**永不触发**，履历可无限增长。同一文件的写入路径（`:96`）用的是正确的绝对索引 `raw.indexOf('\n## ', sectionStart + SECTION.length)`——同一文件两种索引口径，是这个 bug 的直接证据。
- 复现步骤：
  1. 造一个成员方法论文件：前半段是正文，末尾是「## 实战记录」段，其中已含 25 条 `### ...` 记录。
  2. 运行 record-gate 为该成员记一条 → 不报「已达上限」，照写。
  3. 输出里的 `records` 字段也会少报（`existing + 1`，`record-gate.mjs:106`）。
- 证据：`plugin/scripts/record-gate.mjs:64-69`（计数与上限判定）、`plugin/scripts/record-gate.mjs:72-76`（返回相对偏移的 `nextSection`）、`plugin/scripts/record-gate.mjs:96`（写入路径用绝对索引）。真实布局证据：`.superagent/methods/_TEMPLATE.md:42-44`（「## 实战记录」是最后一个二级标题，起于第 42 行）、`.superagent/methods/sa-plugin-release.md:52-59`（真实成员文件同构：段首在第 52 行、全文 61 行）。
- 状态：已复现
- 修法方向：改 `plugin/scripts/record-gate.mjs:72-76`，让 `nextSection` 返回绝对索引（`from + SECTION.length + rest.indexOf(...)`），与 `:96` 口径统一；并加一条断言：计数结果为 0 但文件里确有 `### ` 记录时判为异常，不要静默当成 0。

### RG-13
- 触发条件：worker 执行读类工具，目标落在某个 scope 条目**所在目录**下。
- 影响：`guard.mjs:111-118` 想放行的只是「该成员自己的方法论与错题本」两个文件；但 `lib.mjs:147-152` 的读模式判定用条目的**父目录**做前缀匹配 → 实际放开了 `.superagent/methods/` 与 `.superagent/lessons/` 下的**全部文件**，包括其他成员的履历与错题本。同理，任何以文件形式声明的 scope，其所在目录整棵树都可读。
- 复现步骤：
  （本审计自身的实测，无需构造）
  1. 本单 SCOPE 只列了 `.superagent/` 下的 4 个 `.mjs` 文件。
  2. 用 `read` 读 `.superagent/roster.json`、`.superagent/STATUS.md`、`.superagent/hooks-test.mjs`、`.superagent/methods/sa-plugin-release.md`——**全部读取成功**，尽管这些文件都不在 SCOPE 里。
  3. 结论：读放行按「条目所在目录树」生效，不是按「条目本身」。
- 证据：`plugin/scripts/guard.mjs:111-118`（拼两个具体文件）、`plugin/scripts/lib.mjs:129-155`（`inScope`）、`plugin/scripts/lib.mjs:147-152`（读模式用 `e.slice(0, e.lastIndexOf('/'))` 取父目录做前缀）；实测证据见复现步骤（本审计读上述文件均成功，工具未拦截）。
- 状态：已复现
- 修法方向：把「成员自己的方法论/错题本」改成按**精确文件**放行（读模式增加一条「精确文件白名单」通道，不走目录树规则）；`lib.mjs:147-152` 的目录树放宽只保留给 scope 里显式以 `/` 结尾的目录项。

### RG-14
- 触发条件：用户 prompt 里出现 `SCOPE:`（任何大小写、任何位置），例如粘贴进来的日志或需求文档里含这一行。
- 影响：`gate.mjs:13` 的 `SCOPE_HINT` 命中即注入，`gate.mjs:24` 的 `extractScope(prompt)` 把用户文本里的路径抽出来，`gate.mjs:36` 以「本轮 prompt 中声明的 SCOPE：…」的**授权口吻**写进模型上下文；而 `dispatch.mjs:25` 会从 Router 的 brief 里再提取一次 scope 作为 worker 的写权限边界。两处提取来源不同却以同一份授权呈现——用户文本里一段并非用户本意的「SCOPE:」可能成为 worker 的写边界。
- 复现步骤：
  1. `gate.mjs` 载荷 `{"prompt":"看下这个报错\nSCOPE: C:/Users/x/.ssh/id_rsa"}` → 输出里出现「本轮 prompt 中声明的 SCOPE：C:/Users/x/.ssh/id_rsa」。
  2. 后续派工时 `dispatch.mjs` 会接受同一个 scope（`isPathLike` 允许盘符路径），并写进台账成为 worker 的白名单。
- 证据：`plugin/scripts/gate.mjs:13`（SCOPE_HINT）、`plugin/scripts/gate.mjs:24`（提取）、`plugin/scripts/gate.mjs:36`（注入措辞）、`plugin/scripts/dispatch.mjs:25` 与 `plugin/scripts/lib.mjs:158-176`（第二次提取）、`plugin/scripts/lib.mjs:90-104`（`isPathLike` 允许 `C:` 前缀）。
- 状态：推断
- 还需要什么：gate 一定会注入这段文本（代码确定），但「Router 会原样照抄进 brief」属模型行为、本单未取证，因此越界的最终后果是推断。需要一次真实编排的 transcript，看 Router 的 brief 是否采用了注入文本里的 SCOPE；若不采用，本条降级为「措辞误导」。
- 修法方向：把 gate 注入的措辞从「本轮 prompt 中声明的 SCOPE」改成「用户文本中出现的疑似路径（未验证，是否作为边界由 Router 判定）」；并在 `dispatch.mjs` 侧要求 SCOPE 必须由 Router 显式复述并承担，而不是从用户原文继承。

### RG-15
- 触发条件：worker 用 `glob`/`grep` 且显式传 `path` 目录（该目录在 scope 条目所在目录下，但目录本身不是条目）。
- 影响：`guard.mjs:123-127` 的 `targetOf` 优先取 `tInput.path` → 目标变成目录（如 `src/app`）；`lib.mjs:147-152` 的读模式只放开「条目所在目录下的**文件**」，不放开「该目录本身」→ `inScope` 返回 false → `guard.mjs:149-153` deny。结果是：读 `src/app/session.ts` 放行、列 `src/app` 目录被拦——同一个目录，两种结论。
- 复现步骤：
  1. worker scope 为 `src/app/login.ts`。
  2. `read` 目标 `src/app/session.ts` → 放行。
  3. `glob` 目标 `{path:'src/app', pattern:'*.ts'}` → deny（提示「目标 src/app 不在白名单内」）。
  4. 注意：仓库现有的 4 份回归测试只覆盖不带 `path` 的 glob 调用（见证据），本条为构造式复现，未被任何回归测试锁住。
- 证据：`plugin/scripts/guard.mjs:123-129`（目标取值）、`plugin/scripts/lib.mjs:129-155`（`inScope` 读模式分支）、`plugin/scripts/guard.mjs:149-153`（最终 deny）；`.superagent/e2e-test.mjs:127-128`（`{pattern:'src/app/*.ts'}` 放行 / `{pattern:'**/*.ts'}` 拦截）与 `.superagent/guard-test.mjs:97-102`（同一组用例）只锁了「pattern 不带 path」的情形，未覆盖带 `path` 的调用；`.superagent/chain-test.mjs` 全文 `glob|grep|pattern` 零命中，不含任何 glob 用例（原引用 `:157-166` 举证不实，已删除）。
- 状态：已复现
- 修法方向：改 `plugin/scripts/lib.mjs:147-152`——读模式命中「条目所在目录」时应把该目录本身也算命中（`rel === dir` 也放行）；或在 `plugin/scripts/guard.mjs:123-127` 对 glob/grep 优先按 pattern 判定、path 只作附加约束。

### RG-16
- 触发条件：写类工具的路径参数不在 `file_path` / `path` / `filePath` / `pattern` / `file_pattern` / `query` 之内（例如 `notebookedit` 的 `notebook_path`、批量编辑的 `paths` 数组）。
- 影响：`guard.mjs:129` 的 `if (!target) process.exit(0)` 直接放行——又一个默认放行分支，且不报错。这类工具一旦真的以别的键名下发路径，越界管控对该工具完全失效。
- 复现步骤：
  1. 子代理载荷 `{tool_name:'notebookedit', tool_input:{notebook_path:'config/prod.ipynb'}, agent_type:'w', session_id:'W'}`（且 W 已有 scope `src/app.ts`）。
  2. stdout 为空 → 放行。
  3. 把键名换成 `file_path` → 同一路径被 deny。
- 证据：`plugin/scripts/guard.mjs:123-129`（键名清单与默认放行）、`plugin/scripts/guard.mjs:64-65`（工具名单里含 `notebookedit`）。
- 状态：推断
- 还需要什么：默认放行分支的存在由代码确定；但「平台是否以 `notebook_path` 下发」未取证——本环境工具 schema 中 `edit` 用的是 `file_path`（命中），`notebookedit` 的参数名未验证。需要一次真实的 `notebookedit` 调用载荷，或平台 Hook 载荷的字段契约文档。
- 修法方向：改 `plugin/scripts/guard.mjs:129`——取不到目标时不要放行，改为对「已知写类工具但目标缺失」直接 deny（目标缺失本身就是异常）；并把路径键名清单收敛到一份可维护的映射表。

### RG-17
- 触发条件：任何一次派工。
- 影响：`dispatch.mjs` 写了 4 个字段，全仓没有任何判定读过它们——典型的「台账写了但判定不查」。其中 `unscoped: false` 最能说明问题：它看起来是「无 scope 派工」的标记，但闸门一（`dispatch.mjs:47-55`）已直接拒掉无 scope 的派工，这个字段永远只能是 false 且没人读；`tool_use_id`（`dispatch.mjs:106`）是唯一能标识「一次具体派工」的天然唯一键，却被写入不用，正是 RG-04 去重键退化的直接原因。
- 复现步骤：
  1. 对 `plugin/scripts/` 全目录检索 `unscoped` → 仅 `dispatch.mjs:109` 一处（写入点）。
  2. 检索 `tool_use_id` → 仅 `dispatch.mjs:106` 一处；检索 `lesson_count`/`record_count` → 仅 `dispatch.mjs:111`/`:113`。
  3. 在 `.superagent/` 全目录（含 4 份回归测试）检索 `unscoped` → 零命中。
- 证据：`plugin/scripts/dispatch.mjs:106,109,111,113`（写入点）；检索结果见复现步骤（`plugin/scripts/` 与 `.superagent/` 两个目录下均只有写入点、无读取点）。
- 状态：已复现
- 修法方向：要么让判定真的用上这些字段（`tool_use_id` 用作去重与回收的键；`unscoped` 删掉或改为记录「scope 提取时是否降级」），要么从台账结构里删掉，避免后来人误以为它们在起作用。

### RG-18
- 触发条件：roster 里第 7 个及以后的成员也有实战记录。
- 影响：`records.mjs:51` 的 `if (out.length >= maxMembers) break;` 在满 6 个时直接截断（`gate.mjs:42` 与 `session-start.mjs:39` 都传 6），注入文本却写成「以下成员过去有验收通过的成果」，读起来像全集——被截掉的成员对匹配参考完全不可见，Router 可能为一个已有战绩的专项另建成员。
- 复现步骤：
  1. 让 roster 里 7 个成员的方法论文件都含「## 实战记录」段。
  2. 运行 `gate.mjs`（prompt 含编排意图）→ 注入里只出现前 6 个成员，第 7 个不出现；输出里也没有任何「还有 N 个未显示」的提示。
- 证据：`plugin/scripts/records.mjs:38-53`（`maxMembers` 与 `break`）、`plugin/scripts/records.mjs:51`（截断行）、`plugin/scripts/gate.mjs:42`、`plugin/scripts/session-start.mjs:39`（两处都传 6）。
- 状态：已复现
- 修法方向：改 `plugin/scripts/records.mjs:51`——截断时保留「已显示 N / 共 M」的显式提示，或按成员的 owns 相关度排序后再截断；`gate.mjs:42` / `session-start.mjs:39` 的 6 与 `records.mjs:38` 的默认 8 要对齐说明。

---

## 覆盖说明与边界

- **本单未覆盖**：`plugin/scripts/roster.mjs`、`plugin/scripts/lessons-gate.mjs` 两个脚本不在本单 SCOPE 内，未做判定分支审计——它们与派工/验收闭环相邻，建议下一单补齐。
- **审计对象是仓库副本**：全部行号对应仓库内的 `plugin/scripts/`。按 `.superagent/methods/sa-orchestration-audit.md` 的易错提示，实际被加载的还可能是安装目录副本与运行时 hook 缓存副本（见 `.superagent/STATUS.md` 的「`v2/plugin-hook-cache/` 有完整包副本」），二者不在本单 SCOPE 内，无法读取比对——**结论是否与实际加载的那份一致，未取证**。
- **未改动的文件**：`plugin/scripts/` 与 `.superagent/` 下所有文件均为只读审计，零改动；本单只新增了本文件。
