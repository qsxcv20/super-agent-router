# 编排机制缺陷台账（v0.5.0 输入）

覆盖范围：由本轮两名互不通信的专项成员独立产出的两份缺陷清单，经独立 verifier 逐条复核（26 条裁决 V-01～V-26）后，由 Router 合并、去重、统一编号与字段模板而成。原始清单 `docs/audit/runtime-guards.md`（18 条）、`docs/audit/context-flow.md`（8 条）与验收报告 `docs/audit/verification.md` 为本台账的证据来源。

一句话结论：把独立验收也纳入证据链后，26 条里 25 条成立、1 条被证伪，合并去重后共 24 条独立缺陷；P0 级 5 条全部是「静默放行」——边界判定一旦落空，越界管控不是报错，而是安静地不再生效。

条目统计：总计 24 条，其中 P0 5 条，P1 11 条，P2 8 条；已复现 21 条，推断 3 条

---

## 一、索引与裁决

| 台账编号 | 来源条目 | 严重度 | 归属层 | 一句话 |
|---|---|---|---|---|
| D-01 | CF-01 | P0 | 机制层 | transcript 为 codex 变体时，只认 compatible 的解析器返回 null → 同样整段放行 |
| D-02 | RG-01 | P0 | 机制层 | bash 路径提取正则要求「点+1~8位字母数字」，目录型目标(rm -rf config/.git/node_modules)整体逃逸，且无候选时直接放行 |
| D-03 | RG-02 | P0 | 机制层 | guard 只按工具名分流三张表，未登记的工具名一律放行 → 账号级不可逆操作可绕开 |
| D-04 | RG-03 | P0 | 机制层 | brief 不在 transcript 前 8 行 → 解析返回 null → guard 整段放行，越界管控一次性失效 |
| D-05 | RG-04 | P0 | 机制层 | dispatch 去重键依赖 turn_id，载荷缺该字段时旧记录被整条抹掉 → 前一个 worker 的 scope 从台账消失 |
| D-06 | CF-03 | P1 | 契约层 | 错题本规则/实战记录只以 additionalContext 进父会话，从不进子会话 → 教训前置靠 Router 手抄，无代码强制 |
| D-07 | CF-05 | P1 | 机制层 | extractScope 对写法敏感，SCOPE 行写法稍变就漏收 → 白名单变小等于放行 |
| D-08 | CF-07 | P1 | 契约层 | 4 类 hook（7 条规则）全部绑在父会话事件流，子会话不触发 SessionStart / UserPromptSubmit |
| D-09 | RG-05 | P1 | 机制层 | 闸门二只按同一父会话比对，嵌套派工与第二个 Router 会话都取不到在飞记录 |
| D-10 | RG-07 | P1 | 机制层 | 只有 SubagentStop 一条回收通路；派工被取消/中断/异常退出时名额 2 小时不回收 |
| D-11 | RG-08 | P1 | 机制层 | watchdog 的关键词式证据判定可被「搞定了，测试通过」这类空话绕过 |
| D-12 | RG-10 | P1 | 机制层 | 显示名与 routing id 两套命名空间做等值比较 → 反查失败 → 状态不回收 |
| D-13 | RG-11 | P1 | 契约层 | record-gate 的 verified_by 只校验「不等于 agent 名」→ 履历可由陌生人伪造，且会被注入给 Router 当匹配依据 |
| D-14 | RG-13 | P1 | 机制层 | 读模式按 scope 条目所在目录树放行整棵，写通道严格按条目本身 → 读写权限不对称 |
| D-15 | RG-14 | P1 | 契约层 | gate 把用户原文里的 SCOPE 当授权措辞注入，dispatch 照单全收 |
| D-16 | RG-16 | P1 | 机制层 | 写类工具的路径键名不匹配时取不到 target → 静默放行 |
| D-17 | CF-04 | P2 | 契约层 | gate 未命中粗筛即静默退出 → Router 不知道自己被编排机制覆盖 |
| D-18 | CF-06 | P2 | 契约层 | 错题本文件不存在时「教训前置」天然为空；方法论存在但正文不进上下文（需成员主动 read） |
| D-19 | RG-06 | P2 | 机制层 | 台账 slice(-200) 截断后，累计派工额度统计偏低 |
| D-20 | RG-09 | P2 | 机制层 | watchdog 不识别盘符绝对路径，把工作区外真实存在的路径判成「不存在」→ 误拦 |
| D-21 | RG-12 | P2 | 契约层 | record-gate 的 nextSection 索引口径混用（相对 vs 绝对）→ 20 条上限恒算错 |
| D-22 | RG-15 | P2 | 机制层 | glob/grep 显式传 path 目录时语义不稳（带尾斜杠与不带结果不同） |
| D-23 | RG-17 | P2 | 契约层 | 台账写了 4 个字段，但全仓无任何判定读取 → 台账写了无人读 |
| D-24 | RG-18 | P2 | 契约层 | 实战记录摘要按 roster 顺序截断 6 名，排位靠后的成员记录结构性不可见 |
| D-27 | 用户反馈 | P0 | 机制层 | 主动触发粗筛漏判 83%：口语化编排请求几乎全部静默放行，Router 不知道编排机制存在 |
| D-28 | 本轮实测 | P2 | 机制层 | 派工被取消/中断时不触发 SubagentStop，并发名额泄漏到 TTL（2 小时），机制没有可用释放入口 |

**合并与剔除说明**

- `CF-02` 与 `RG-03` 是同一缺陷（brief 不在前 8 行 → 整段放行）。两份清单分别定级为「推断」与「已复现」，定级互相打架，合并时统一按「已复现」。
- `CF-08` 与 `RG-18` 是同一缺陷（实战记录按 roster 顺序截断），已合并。
- 原 `CF-06`（声称被派工成员的方法论文件不存在）被独立验收用三重取证证伪：方法论文件真实存在且读成功，真实发生过的 ENOENT 指向的是**错题本**文件。该条目已由产出者据实改写为「错题本不存在时教训前置天然为空、方法论正文不进上下文」，改写后的版本作为 D-18 纳入。**被证伪的原条目不入账**——但「审计结论会被证伪」这件事本身，正是本台账必须由独立验收产生的理由。

## 二、统一条目模板（单一事实源）

本轮两份 brief 的字段模板是我分别手写的：给两个 worker 的是 6 字段，给 verifier 的是 7 字段（多一条「还需要什么」），于是验收反过来判产出「字段模板不一致」。**根因不在成员，在编排层没有单一事实源的模板。** 模板必须收敛成一份，由 brief 引用而不是复述：

```
### D-01
- 触发条件：
- 影响：
- 复现步骤：
- 证据：
- 状态：已复现 | 推断
- 修法方向：
- 还需要什么：
```

## 三、缺陷明细

### D-01
- 触发条件：子会话 transcript 为 `*.codex.jsonl` 变体（`type:"response_item"`、`payload.role:"user"`、`payload.content[].type:"input_text"`），而 `readBriefFromTranscript` 只认 `type:"user"` + `message.content[].type:"text"`。
- 影响：scope 白名单解析返回 null → `guard.mjs:97-102` 走「解析不到边界 -> 放行」→ 子会话**完全不受越界管控**，可读写任意路径；同时 `dispatch_id` 反查失败，`watchdog.mjs:38-49` 兜底回收也失效，在飞派工名额不回收。
- 复现步骤：1) 取任一 `*.codex.jsonl` 样本；2) 逐字复刻 `lib.mjs:273-288` 的解析逻辑（只取 `obj.type==='user'` 且 `part.type==='text'`）；3) 观察 text 长度恒为 0、函数返回 null；4) 对比同一会话的 `*.compatible.jsonl` 变体，同一逻辑可解析出 scope。
- 证据：`plugin/scripts/lib.mjs:276-288`（`if (!obj || obj.type !== 'user') continue;` 与 `if (part && part.type === 'text')`）与 `plugin/scripts/guard.mjs:75`（`readBriefFromTranscript(String(input.transcript_path || ''))`）。真实样本：`5b26db54f727d72c35ce4cf7ed2a79f7.codex.jsonl` 第 1 行 `{"timestamp":"2026-11-09T12:31:28.969Z","type":"session_meta","payload":{...}}`、第 2 行 `{"timestamp":"2026-11-09T12:31:29.049Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"PTC is enabled for this turn...`——顶层 `type` 是 `response_item` 而非 `user`，`part.type` 是 `input_text` 而非 `text`，两处判断均落空。同文件全文含 `SCOPE:` 与 `PARENT SESSION:`（rawHasSCOPE=true、rawHasParentSession=true），说明**内容在、格式不符**。同一会话 `5b26db54...compatible.jsonl` 第 1 行可正常解析出 `SCOPE: .superagent/worker-probe.txt`、`agentName: worker`、`parentSessionId=mvs_9bdda202ae274c909a5b4352fc45a471`。 **本运行时用哪一变体的限定说明**：本单实测中，本会话（`73f33cbc...`）的 guard 确实按 brief 解析出的 scope 正常拦截了越界读写（拦截文案列出的 SCOPE 与 brief 一致），说明**当前 MCode 运行时传给 `input.transcript_path` 的是 `compatible` 变体**，本条在当前运行时不会触发；但 `codex` 变体由同一 `originator: minimax_plugin_hook` 写出、且与 `compatible` 同目录并存，一旦运行时切到 codex 形态（如换 Codex 系后端），同一条代码路径会静默放行。
- 状态：已复现
- 修法方向：`readBriefFromTranscript` 增加对 `codex` 变体的解析分支（`obj.type==='response_item' && obj.payload.role==='user'` + `part.type==='input_text'`）；或改为按 payload 形状嗅探而非硬编码 `type==='user'`。修法归机制 owner，本单不改代码。**重复关系**：本条与 Runtime-Guard 清单的同类条目重复（该清单条目以「brief 不在前 8 行」描述，落点同为 brief 解析不出 → scope 白名单为空 → guard 放行这一族问题），合并台账时应与之一并计入同一编号，不重复计数。
- 还需要什么：需要运行时侧给出目标环境 `input.transcript_path` 的实际取值样本（或直接在真实 codex 后端下跑一轮 guard 判定），才能确认本条在目标运行时是否已实际触发；本轮只验证了两种 transcript 形态的解析差异，未确认目标运行时会落到哪一种。
- 来源：CF-01 ｜ 严重度：P0 ｜ 归属层：机制层

### D-02
- 触发条件：worker 子会话调用 `bash`，命令里出现的路径**最后一段不含「点 + 1~8 位字母数字」**（目录、点文件、无扩展名文件），例如 `rm -rf config`、`rm -rf .git`、`rm -rf node_modules`、`rm -rf build/out`。
- 影响：越界删除/覆盖目录型目标完全绕过 SCOPE 边界；该分支不报错、不留痕，属静默失效。它绕过的正是 guard 声称要拦的「bash 里藏路径」场景。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:137`（路径提取正则 `/[A-Za-z0-9_.\\/-]+\.[A-Za-z0-9]{1,8}/g`，要求点后跟 1~8 位字母数字）、`plugin/scripts/guard.mjs:138`（候选过滤）、`plugin/scripts/guard.mjs:139`（`if (candidates.length === 0) process.exit(0);` 即默认放行分支）、`plugin/scripts/guard.mjs:141`（候选非空才继续判定）。旁证：本审计执行 `git status --short` 时同样命中这条放行分支（命令中无带扩展名的路径 token）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/guard.mjs:137` 的候选提取——不要用「点+扩展名」判定路径，改为先按空白/引号切词、再逐词判定是否为路径形态（含 `/`、`\` 或以 `.` 开头的点文件）；并把 `guard.mjs:139` 的默认分支改为对未知命令从严（命令含 rm/mv/cp/重定向等动词时，必须命中至少一个已知 scope 路径才放行），而不是直接放行。
- 还需要什么：无，代码路径已确定
- 来源：RG-01 ｜ 严重度：P0 ｜ 归属层：机制层

### D-03
- 触发条件：子代理会话调用任何不在 `DANGEROUS` / `WRITE_TOOLS` / `READ_TOOLS` 三张表里的工具名——包括本环境的 `mavis`（其 command 参数空间实测含 `agent create` / `agent update` / `agent delete`，见证据）与 `run_code`（内部代理 `tools.write` / `tools.edit` / `tools.bash`）。
- 影响：guard 头部注释声明的「账号级与对外不可逆操作——一律拦」只对 run_code 内部的那组工具名生效；同一个账号级删除通过 `mavis` 的命令空间即可达成（`mavis` 不在 DANGEROUS 表内），复合工具同理。护栏在最外层留了一道没有规则的口子。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:51-57`（DANGEROUS 表，键为工具名）、`plugin/scripts/guard.mjs:58-60`（命中即 deny）、`plugin/scripts/guard.mjs:64-69`（未登记工具名 → `process.exit(0)`）；本环境取证：`mavis` 工具自身的 `agent help` 子命令返回的 agent 组命令清单为 `agent list | agent get | agent create | agent update | agent delete`——即 `agent delete` / `agent update` 确在 `mavis` 的 command 参数空间内，而工具名仍是 `mavis`，不在 DANGEROUS 表内；`tool_search` 检索不到名为 `mavis` 的条目，因为它是常驻可见工具而非按需工具；`run_code` 的代理清单含 `write`/`edit`/`bash`，另含按工具名登记在 DANGEROUS 表内的 `mavis_agent_delete` / `mavis_agent_update`。
- 状态：已复现（已完全确认）
- 修法方向：把 DANGEROUS 判定从「工具名等值」升级为「工具名 + 关键参数」二维判定（`mavis` 且 command 以 `agent delete`/`agent update` 开头 → deny）；给 `run_code` 这类复合工具补一条规则：其参数里出现写类工具名时，一律按写类工具的 scope 规则处理。
- 还需要什么：无，代码路径已确定
- 来源：RG-02 ｜ 严重度：P0 ｜ 归属层：机制层

### D-04
- 触发条件：worker 子会话的 `transcript_path` 所指 transcript 里，第一条 user 消息**不在文件前 8 行内**，或消息对象的 `type` 不是 `'user'`，或缺 `PARENT SESSION:` / `agentName:` 标记。
- 影响：`readBriefFromTranscript` 返回 null → guard 不建立 binding → `guard.mjs:97` 的 `if (!binding || ...) process.exit(0)` 放行。该 worker 的全部文件读写（含 scope 外的写）一次性失去边界约束，且没有任何报错或日志。越界管控从「逐条判定」退化为「整段失效」。
- 复现步骤：
- 证据：`plugin/scripts/lib.mjs:275`（`lines.slice(0, 8)` 只看前 8 行）、`plugin/scripts/lib.mjs:278`（`obj.type !== 'user'` 过滤）、`plugin/scripts/lib.mjs:289-291`（靠正则取父会话/成员名/SCOPE）、`plugin/scripts/guard.mjs:74-76`（brief 为空则不建 binding）、`plugin/scripts/guard.mjs:97-101`（无 binding → 默认放行）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/lib.mjs:275`——不要只看前 8 行，改为扫描整份 transcript 找第一条 user 消息（或直接找含 `SCOPE:` 的 user 消息）；同时把 `plugin/scripts/guard.mjs:97` 的默认分支从「放行」改为「从严 + 显式报一次原因」，至少让派工方知道这条 worker 没被约束。
- 还需要什么：无，代码路径已确定
- 来源：RG-03 ｜ 严重度：P0 ｜ 归属层：机制层

### D-05
- 触发条件：PreToolUse(task) 载荷不含 `turn_id`（或为空串）。
- 影响：`dispatch.mjs:30` 得到 `tid = ''`，`dispatch.mjs:95-100` 的去重过滤 `String(d.turn_id || '') === tid` 对**所有** turn_id 为空的历史记录成立 → 同一 `parent_session_id` + 同一 `agent` 的旧 active 记录被整条删除。前一个 worker 的 scope 从台账消失 → 闸门二（重叠检测）看不到它 → 两个 worker 可被派到同一处互相覆盖；闸门三（在飞名额）也少算一个 → 并发上限形同虚设。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:30`（tid 取值）、`plugin/scripts/dispatch.mjs:95-100`（去重过滤）、`plugin/scripts/dispatch.mjs:102-116`（写入）。`.superagent/chain-test.mjs` 的 `dispatch()` 辅助函数始终带 `turn_id`，因此这条路径没有被任何回归测试覆盖。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/dispatch.mjs:95-100` 的去重键——缺 `turn_id` 时退化为 `parent_session_id + agent + tool_use_id`（`tool_use_id` 已在 `dispatch.mjs:106` 写入但从未被读取，正好可作唯一键），不要把空串当成「同一个 turn」。
- 还需要什么：无，代码路径已确定
- 来源：RG-04 ｜ 严重度：P0 ｜ 归属层：机制层

### D-06
- 触发条件：`dispatch.mjs` 把错题本规则与实战记录包进 `hookSpecificOutput.additionalContext`（`plugin/scripts/dispatch.mjs:134-141`），该 JSON 由 **PreToolUse(task)** hook 产出——作用在**父会话的那次 task 调用**上，不进子会话首条消息。
- 影响：子会话拿不到「上次栽在哪儿」「做成过什么」。除非 Router 读到注入后**手工把内容抄进 brief 的 PRIOR_LESSONS / PRIOR_RECORDS 段**，否则错题本在 worker 侧完全断链；本轮两次派工（`sa-orchestration-audit`、`sa-context-trace`）的 task prompt 中均无 lessons/records 块，证实该转写未发生。
- 复现步骤：1) 打开父会话 transcript `4efc02c8...compatible.jsonl`；2) 定位第 63 行与第 65 行两次 `"type":"tool_use","name":"task"` 调用；3) 读其 `input.prompt` 全文，确认不含 `历史教训`、`实战记录` 段；4) 对比 `dispatch.mjs:121-132` 代码，注入内容应出现在 task 调用前的 hook 输出中。
- 证据：`plugin/scripts/dispatch.mjs:85`（`readLessons(agent)`）、`:89`（`readRecords(agent)`）、`:121-125`（lessons 块文案「派工时必须写进 brief」）、`:126-132`（records 块）、`:134-141`（写出 `additionalContext`）。真实样本：`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 第 65 行 `{"type":"tool_use","id":"call_01a1c0c913b675a7a3a03b96","name":"task","input":{`…其 `prompt` 首段为「你是「上下文注入与传递链路追踪专员」。工作目录：C:\Users\yang2\Documents\MiniMax\mini code的插件\n\n## 开工前必做\n先读 `.superagent/methods/sa-context-trace.md`…」——**无 PRIOR_LESSONS、无 PRIOR_RECORDS 段**。全语料 grep `历史教训（派工时必须写进 brief）` 仅命中 `73f33cbc`（本会话读码回显）、`3909fcb6.codex`、`c29fafdb`、`f73f5500`（均为读 `dispatch.mjs` 源码的回显），**没有任何一个样本的子会话首条 user 消息含该块**。
- 状态：已复现
- 修法方向：把 lessons/records 作为**结构化字段直接注入 task 的 `prompt`**（在 dispatch 阶段改写 prompt 而非仅输出 `additionalContext`），让子会话必然收到；或约定 `additionalContext` 由运行时透传到 task prompt。当前「靠 Router 自觉抄写」的传递方式没有机制保障。
- 还需要什么：需要一次「Router 读到 additionalContext 后主动转写进 brief」的实测派工样本，确认转写路径可行且不会被运行时截断；本轮两次派工均未转写，只证明了「不转写就断链」，尚未证明「转写能通」。
- 来源：CF-03 ｜ 严重度：P1 ｜ 归属层：契约层

### D-07
- 触发条件：子会话首条 user 消息里 `SCOPE:` 行的写法若不是「同一行内逗号分隔」，或 SCOPE 后面跟的是目录而非以 `/` 结尾的目录项，`extractScope`（`lib.mjs:158-181`）会漏收条目。
- 影响：SCOPE 漏收 → guard 的白名单比派工意图窄 → worker 被**误拦**在合法路径之外（写操作严格模式要求精确命中，`lib.mjs:143-145`）；反过来，若 SCOPE 行写成自然语言整句，`isPathLike`（`lib.mjs:88-97`）会整条丢弃，白名单为空 → `guard.mjs:97-102` 直接放行，越界管控对该 worker 完全失效。
- 复现步骤：1) 读 `lib.mjs:158-181` 的块解析逻辑；2) 构造 SCOPE 写成 `SCOPE: docs/audit/context-flow.md`（无逗号、后续换行接第二个路径）的 brief；3) 跑 `extractScope` → 只收第一个路径，第二个丢失；4) 再构造 SCOPE 写成含中文描述的整句 → 返回空数组。
- 证据：`plugin/scripts/lib.mjs:88-97`（`PATH_LIKE` 只收 `[A-Za-z0-9_@~.\\/-]`，含中文即非 path-like）、`:165-179`（行内分隔与块内续行两种模式）、`:169` 与 `:177`（按 `[,，s]+` 切分）。真实样本：`5b26db54f727d72c35ce4cf7ed2a79f7.compatible.jsonl` 第 1 行 `SCOPE: .superagent/worker-probe.txt` 为单行单条，`73f33cbca067dd3d55331579664d091d.compatible.jsonl` 第 1 行 `SCOPE: docs/audit/context-flow.md, plugin/scripts/gate.mjs, plugin/hooks/hooks.json, C:/Users/yang2/AppData/Local/Temp/minimax-plugin-hooks/transcripts/` 为逗号分隔多行——两者均能被 `extractScope` 正确解析（复刻结果：scope 长度 1 与 4）。**未观测到漏收的真实样本**，故判为推断：风险点是格式脆弱（任何 Router 手误都会静默缩窄或清空白名单），而非当前已发生。
- 状态：推断
- 修法方向：派工闸门（`dispatch.mjs:47-52`）已能拒绝「无 SCOPE」的派工，但**不能拒绝「SCOPE 解析后为空/过窄」**——建议在闸门处校验解析结果条目数与 brief 原文的一致性，或在 brief 模板里固化 SCOPE 的单行逗号格式。
- 还需要什么：需要一份 Router 实际写 SCOPE 的语料样本（或一份已固化的 brief 模板规范），才能判定该格式脆弱性在真实使用中是否已被触发；本轮 9 个样本全部解析成功，未观测到任何漏收，故本条判为「推断」。
- 来源：CF-05 ｜ 严重度：P1 ｜ 归属层：机制层

### D-08
- 触发条件：`plugin/hooks/hooks.json` 声明的 4 类 hook / 7 条规则（SessionStart / UserPromptSubmit / PreToolUse ×4 matcher / SubagentStop）全部绑定在**父会话 Router 的事件流**上；子会话不触发 SessionStart。
- 影响：子会话**结构性拿不到** SessionStart 的编排协议注入（`session-start.mjs:19-36` 的「本会话已启用 Super-agent 编排机制 / 何时该编排」整块）。这不是缺陷本身（worker 本就不该编排），但它意味着：**唯一能让模型知道「存在编排机制」的那段上下文只有 Router 有**；worker 若被要求「按协议自述」或需要转派，缺少协议原文，只能靠 brief 正文里 Router 转述的片段。
- 复现步骤：1) 在 `hooks.json` 列出全部 hook 事件；2) 对照 9 个 transcript 样本，找出带 `subtype:"plugin_hook_context"` 的会话；3) 观察该 subtype 仅出现在两个**父会话**（`4efc02c8` 第 2 行、`76a305b5` 第 2 行），7 个子会话均无。
- 证据：`plugin/hooks/hooks.json:3-14`（SessionStart→session-start.mjs）、`:15-26`（UserPromptSubmit→gate.mjs）、`:27-72`（PreToolUse：matcher `task`→dispatch.mjs、`write|edit|multiedit|notebookedit|bash`→guard.mjs、`read|glob|grep|list|search`→guard.mjs、`mavis_agent_delete|mavis_agent_update|website_deploy|miniapp|miniapp_publish`→guard.mjs）、`:73-84`（SubagentStop→watchdog.mjs）——**无任何面向子会话的 hook 事件**。真实样本对照：`73f33cbca067dd3d55331579664d091d.compatible.jsonl`（本会话，sa-context-trace）全 77 行类型分布为 `{"user/-":46,"assistant/-":31}`，**无一条 `plugin_hook_context`**；`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 全 89 行分布为 `{"system/compactionSummary":1,"system/plugin_hook_context":1,"system/session_identity_reminder":1,"assistant/-":43,"user/-":43}`。另：`76a305b5...compatible.jsonl` 与 `4efc02c8...compatible.jsonl` 的 `plugin_hook_context` 块只含 SessionStart 文案 + 实战记录摘要，**不含** `本轮按编排流程处理`（gate 产物）——说明两条注入线在父会话也是彼此独立、时机不同的两条路径。
- 状态：已复现
- 修法方向：这是设计边界而非 bug，但应在机制文档里显式写明「子会话不注入 SessionStart 协议」，避免 Router 误以为 worker 已知协议；若 worker 需要知道协议，应由 brief 显式携带协议要点，而不是依赖 hook。
- 还需要什么：需要一个「worker 确实需要转派或自述协议」的真实场景 transcript，以验证 brief 未携带协议要点时 worker 的实际表现；本轮 7 个子会话样本均未触发该场景，无法判断这条边界在实战中会造成实际损失还是仅停留在纸面。
- 来源：CF-07 ｜ 严重度：P1 ｜ 归属层：契约层

### D-09
- 触发条件：worker 自己再派子代理（`session_id` = worker 会话 id），或同一项目里第二个 Router 会话派工。
- 影响：闸门二想解决的是「两个 worker 写同一处会互相覆盖、验收无法判断谁的改动生效」，但 `activeDispatches(ledger, sid, now)`（`dispatch.mjs:59`）只筛 `d.parent_session_id === sid`，父 Router 的在飞记录不在其中——嵌套派工与跨会话重叠全部漏检，同一文件可被两个并行 worker 同时写。文档 `dispatch.mjs:55-57` 把规则写成「同一会话里」，实现与文档一致，但与机制目的不一致。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:59-70`（闸门二）、`plugin/scripts/lib.mjs:221-228`（`activeDispatches` 按 `parent_session_id` 过滤）、`plugin/scripts/lib.mjs:198-216`（`scopeClash` 本身是对的，问题在上游选集）。
- 状态：已复现（已完全确认）
- 修法方向：把闸门二的比对集从「同一父会话的 active 派工」扩大到「同一项目内所有 active 派工」（在 `dispatch.mjs:59` 改用项目维度查询，或在 `lib.mjs:221` 增加一个不按 parent 过滤的查询入口）；`scopeClash` 可直接复用。
- 还需要什么：无，代码路径已确定
- 来源：RG-05 ｜ 严重度：P1 ｜ 归属层：机制层

### D-10
- 触发条件：worker 被取消、被中断，或平台没有发出 `SubagentStop`（子会话异常退出、Router 提前放弃）。
- 影响：`plugin/scripts/` 全目录检索 `cancel|interrupt|abort|timeout|超时|取消` **零命中**——全机制只有 `watchdog.mjs` 的 SubagentStop 一条回收通路（`watchdog.mjs:28-51`）。回收不发生时，该派工在 `DISPATCH_TTL_MS`（2 小时，`lib.mjs:84`）内一直占着「在飞」名额：闸门二把它当成仍在写同一处的 worker（挡住同 scope 的新派工），闸门三把它计入并发上限（6）。两小时后它被 `lib.mjs:226` 的 TTL 过滤悄悄排除出统计，但台账里 `state` 永远是 `'active'`——台账状态与真实状态失步，后续任何按 `state==='active'` 判断的逻辑都会误判。
- 复现步骤：
- 证据：`plugin/scripts/watchdog.mjs:28-54`（唯一回收点，整段被 try/catch 包裹、异常被静默吞掉）、`plugin/scripts/lib.mjs:226`（TTL 过滤）、`plugin/scripts/lib.mjs:84`（`DISPATCH_TTL_MS = 2h`）、`plugin/scripts/lib.mjs:235-241`（`markDispatchDone` 只把 state 置 done，无 cancelled/timeout 终态）、`plugin/scripts/watchdog.mjs:51-53`（`catch (e) {}`，注释「回收失败不能影响 watchdog 的本职判定」——回收失败无任何日志）。
- 状态：已复现（已完全确认）
- 修法方向：在 `plugin/scripts/lib.mjs` 增加 `markDispatchAborted(ledger, dispatchId, reason)`，并在 `dispatch.mjs` 写记录时同时记 `tool_use_id`（`dispatch.mjs:106` 已写但从未被读），供中断事件回调；TTL 过期时显式落成 `state: 'timeout'` 并写 `ended_at`，别让台账出现「永远 active」的条目；`watchdog.mjs:51-53` 的 catch 至少往 stderr 记一行。
- 还需要什么：无，代码路径已确定
- 来源：RG-07 ｜ 严重度：P1 ｜ 归属层：机制层

### D-11
- 触发条件：worker 收尾文本同时含「完成类」词与「证据类」词，例如「搞定了，测试通过」。
- 影响：`claimsDone`（`watchdog.mjs:94`）命中「搞定」；`hasEvidence`（`watchdog.mjs:95`）命中「测试」→ `watchdog.mjs:96` 的拦截分支不触发；`claimedPaths` 又因文本里没有产出动词而返回空 → `watchdog.mjs:115` 放行。watchdog 头部注释（「早期版本只做字面关键词匹配——『搞定了』这种话能蒙混过关……现在改为：先判声明，再把声明里提到的文件路径真实校验一遍」）声称的修复并不成立：加两个关键词即可完全绕过完成度校验。
- 复现步骤：
- 证据：`plugin/scripts/watchdog.mjs:9-12`（注释声称的修复）、`plugin/scripts/watchdog.mjs:94-96`（判定实现）、`plugin/scripts/watchdog.mjs:105-115`（文件校验分支未触发）；`.superagent/chain-test.mjs:80-87` 只锁了「搞定了」单个词，未覆盖「搞定了 + 证据关键词」。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/watchdog.mjs:95` 的 `hasEvidence`——证据必须是**可核验的具体物**（存在的文件路径 / 带行号的引用 / 可复现的命令与输出），而不是「测试/运行/结果」这类描述性词；建议收敛为「至少一个通过 `claimedPaths` 存在性校验的路径」或「一段命令输出」。
- 还需要什么：无，代码路径已确定
- 来源：RG-08 ｜ 严重度：P1 ｜ 归属层：机制层

### D-12
- 触发条件：Router 派工时 `agent_name` 写的是**显示名**，而子会话 transcript / Hook 载荷里是**routing id**。
- 影响：台账写的是 `agent: tInput.agent_name`（`dispatch.mjs:26,107`），guard 拿 `brief.agent || agentType` 去匹配（`guard.mjs:80,86-91`），watchdog 拿 `brief.agent || input.agent_type` 去匹配（`watchdog.mjs:44`）——三处来源、两种命名，且都是严格等值比较。命名不一致时 guard 的绑定里 `dispatch_id` 为空（`guard.mjs:82`），watchdog 回收不到该派工 → 名额不回收 → 连锁触发 RG-07：同一 scope 在 2 小时内不能再派工。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:26`（写 `agent_name`）、`plugin/scripts/dispatch.mjs:107`（写台账的 `agent` 字段）、`plugin/scripts/guard.mjs:80`（绑定取 `brief.agent || agentType`）、`plugin/scripts/guard.mjs:86-91`（按 agent 等值反查派工）、`plugin/scripts/watchdog.mjs:44`（同一等值比较）、`plugin/scripts/lib.mjs:290`（agent 取自 transcript 的 `agentName:`）。本环境的 agent-context 同时给出 `agent: 编排审计 # display name` 与 `agentName: sa-orchestration-audit # routing ID`，证明两个命名空间并存。
- 状态：已复现（已完全确认）
- 修法方向：在 `plugin/scripts/lib.mjs` 加统一的 `resolveAgentKey(input, brief)`（一律用 routing id，缺失时回退并做一次映射），dispatch 写入、guard 反查、watchdog 回收三处统一用它；反查时不要用等值比较，改成「能唯一确定的那条」（配合 dispatch_id 透传）。
- 还需要什么：无，代码路径已确定
- 来源：RG-10 ｜ 严重度：P1 ｜ 归属层：机制层

### D-13
- 触发条件：以任意 `agent` + 任意 `verified_by`（只要不等于 agent 名）调用 record-gate。
- 影响：`record-gate.mjs:5-9` 声明「关键约束：成就只能由『验收通过』触发，不能由成员自述触发」，`:53-54` 的实现只有两条——`verified_by` 非空、且 `verified_by !== agent`。没有校验验收人是否存在、是不是真的验收方、验收是否发生。成员自己填一个别人的名字就能把未经验收的成果写进履历；而履历会被 `dispatch.mjs:89` 前置给下一个 worker、被 `gate.mjs:42` 与 `session-start.mjs:39` 当成「这人做成过什么」注入给 Router，污染路由匹配依据。
- 复现步骤：
- 证据：`plugin/scripts/record-gate.mjs:5-9`（声明的约束）、`plugin/scripts/record-gate.mjs:37`（取值）、`plugin/scripts/record-gate.mjs:53-54`（仅两条检查）、`plugin/scripts/record-gate.mjs:96-103`（写入路径）；履历消费方 `plugin/scripts/dispatch.mjs:85-89`、`plugin/scripts/gate.mjs:42-52`、`plugin/scripts/session-start.mjs:39-50`。
- 状态：已复现（已完全确认）
- 修法方向：把 `verified_by` 从自由字符串换成可核验凭据——由验收方会话直接写自己的 agent 名（并在 roster 里校验其为验收角色），或要求附带验收记录文件路径并校验其存在且时间晚于成果产出；至少在 `record-gate.mjs:53` 附近加「验收人必须存在于 roster.json」的校验。
- 还需要什么：无，代码路径已确定
- 来源：RG-11 ｜ 严重度：P1 ｜ 归属层：契约层

### D-14
- 触发条件：worker 执行读类工具，目标落在某个 scope 条目**所在目录**下。
- 影响：`guard.mjs:111-118` 想放行的只是「该成员自己的方法论与错题本」两个文件；但 `lib.mjs:147-152` 的读模式判定用条目的**父目录**做前缀匹配 → 实际放开了 `.superagent/methods/` 与 `.superagent/lessons/` 下的**全部文件**，包括其他成员的履历与错题本。同理，任何以文件形式声明的 scope，其所在目录整棵树都可读。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:111-118`（拼两个具体文件）、`plugin/scripts/lib.mjs:129-155`（`inScope`）、`plugin/scripts/lib.mjs:147-152`（读模式用 `e.slice(0, e.lastIndexOf('/'))` 取父目录做前缀）；实测证据见复现步骤（本审计读上述文件均成功，工具未拦截）。
- 状态：已复现（已完全确认）
- 修法方向：把「成员自己的方法论/错题本」改成按**精确文件**放行（读模式增加一条「精确文件白名单」通道，不走目录树规则）；`lib.mjs:147-152` 的目录树放宽只保留给 scope 里显式以 `/` 结尾的目录项。
- 还需要什么：无，代码路径已确定
- 来源：RG-13 ｜ 严重度：P1 ｜ 归属层：机制层

### D-15
- 触发条件：用户 prompt 里出现 `SCOPE:`（任何大小写、任何位置），例如粘贴进来的日志或需求文档里含这一行。
- 影响：`gate.mjs:13` 的 `SCOPE_HINT` 命中即注入，`gate.mjs:24` 的 `extractScope(prompt)` 把用户文本里的路径抽出来，`gate.mjs:36` 以「本轮 prompt 中声明的 SCOPE：…」的**授权口吻**写进模型上下文；而 `dispatch.mjs:25` 会从 Router 的 brief 里再提取一次 scope 作为 worker 的写权限边界。两处提取来源不同却以同一份授权呈现——用户文本里一段并非用户本意的「SCOPE:」可能成为 worker 的写边界。
- 复现步骤：
- 证据：`plugin/scripts/gate.mjs:13`（SCOPE_HINT）、`plugin/scripts/gate.mjs:24`（提取）、`plugin/scripts/gate.mjs:36`（注入措辞）、`plugin/scripts/dispatch.mjs:25` 与 `plugin/scripts/lib.mjs:158-176`（第二次提取）、`plugin/scripts/lib.mjs:90-104`（`isPathLike` 允许 `C:` 前缀）。
- 状态：推断
- 修法方向：把 gate 注入的措辞从「本轮 prompt 中声明的 SCOPE」改成「用户文本中出现的疑似路径（未验证，是否作为边界由 Router 判定）」；并在 `dispatch.mjs` 侧要求 SCOPE 必须由 Router 显式复述并承担，而不是从用户原文继承。
- 还需要什么：gate 一定会注入这段文本（代码确定），但「Router 会原样照抄进 brief」属模型行为、本单未取证，因此越界的最终后果是推断。需要一次真实编排的 transcript，看 Router 的 brief 是否采用了注入文本里的 SCOPE；若不采用，本条降级为「措辞误导」。
- 来源：RG-14 ｜ 严重度：P1 ｜ 归属层：契约层

### D-16
- 触发条件：写类工具的路径参数不在 `file_path` / `path` / `filePath` / `pattern` / `file_pattern` / `query` 之内（例如 `notebookedit` 的 `notebook_path`、批量编辑的 `paths` 数组）。
- 影响：`guard.mjs:129` 的 `if (!target) process.exit(0)` 直接放行——又一个默认放行分支，且不报错。这类工具一旦真的以别的键名下发路径，越界管控对该工具完全失效。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:123-129`（键名清单与默认放行）、`plugin/scripts/guard.mjs:64-65`（工具名单里含 `notebookedit`）。
- 状态：推断
- 修法方向：改 `plugin/scripts/guard.mjs:129`——取不到目标时不要放行，改为对「已知写类工具但目标缺失」直接 deny（目标缺失本身就是异常）；并把路径键名清单收敛到一份可维护的映射表。
- 还需要什么：默认放行分支的存在由代码确定；但「平台是否以 `notebook_path` 下发」未取证——本环境工具 schema 中 `edit` 用的是 `file_path`（命中），`notebookedit` 的参数名未验证。需要一次真实的 `notebookedit` 调用载荷，或平台 Hook 载荷的字段契约文档。
- 来源：RG-16 ｜ 严重度：P1 ｜ 归属层：机制层

### D-17
- 触发条件：`gate.mjs:15-17` 的粗筛（INTENT 词表 + SIGNAL + `SCOPE:` 提示）未命中时，`gate.mjs:19-21` 直接 `process.exit(0)` 不输出任何内容。
- 影响：Router 在没有命中特征词的轮次里拿不到「本轮按编排流程处理」的协议注入，只能靠 SessionStart 那一次注入的余温 + skill 里的协议判断。表现为**该轮不该编排时正确静默（设计意图），但漏判时 Router 会完全不知道编排机制存在**——因为 SessionStart 只注入一次（`session-start.mjs:18-55` 全文只输出一次）。
- 复现步骤：1) 读 `gate.mjs:11-22`，确认命中条件与静默分支；2) 构造不含 INTENT 词、不含 SIGNAL 词、无 `SCOPE:` 的 prompt；3) 以该 JSON 作 stdin 跑 `node plugin/scripts/gate.mjs`，观察 stdout 为空、exit 0；4) 对照含 `派工`/`并行` 等词的 prompt，stdout 出现「本轮按编排流程处理」。
- 证据：`plugin/scripts/gate.mjs:11`（INTENT 正则）、`:15-17`（命中判定）、`:19-22`（`if (!hit) { process.exit(0); }`）、`:26`（注入首行文案）。真实样本佐证「命中才注入」：`4efc02c8...compatible.jsonl` 第 2 行的 `plugin_hook_context` 块**只有 SessionStart 的协议**（`本会话已启用 Super-agent 编排机制…`）+ 实战记录摘要，**没有** `本轮按编排流程处理`——说明父会话该轮并未走 gate 注入路径；而 `76a305b5...compatible.jsonl` 第 2 行的同一 hook 块里 `本会话已启用` 出现在偏移 43 处，与 SessionStart 首行文案一致。判定位置：`plugin/scripts/gate.mjs:19-22`。
- 状态：已复现
- 修法方向：保留静默放行（省 token 是对的），但把「编排机制存在」这一事实锚定到不会消失的载体（SessionStart 已做一次），并让后续轮次至少能在需要时按需重读 skill；当前形态下 SessionStart 的注入一旦被长会话压缩掉又无补偿机制。
- 还需要什么：需要 gate.mjs 的 INTENT/SIGNAL 词表与真实 Router 提问语料的对照统计，确认是否存在「本应编排却未命中粗筛」的漏判样本；本轮只验证了「命中才注入」与「未命中静默 exit 0」两个分支的代码路径，未在真实语料上测出漏判。
- 来源：CF-04 ｜ 严重度：P2 ｜ 归属层：契约层

### D-18
- 触发条件：`guard.mjs:111-120` 为读操作额外放行 `root + '/.superagent/methods/' + who + '.md'` 与 `root + '/.superagent/lessons/' + who + '.md'`，其中 `who = binding.agent || agentType`；而 `who` 对应的两个文件**并非总是同时存在**——方法论由建员流程落盘，错题本只在成员真正栽过跟头后才产生。
- 影响：该放行**只解决「能不能读到文件」，不解决「内容进不进上下文」**。两条路径的正文都必须由成员主动 read 才会进入上下文；路径来自**运行时注入的 agent system_prompt 与 brief 正文**（如「先读 `.superagent/methods/sa-context-trace.md`」），不是 hook 注入的，所以「成员方法论/错题本路径」这条上下文来源能否到达，取决于成员运行时配置，不在本插件链路内。**本轮据实观察到的事实**：方法论文件 `.superagent/methods/sa-context-trace.md` **存在**（55 行，实读成功），而被派工成员的错题本 `.superagent/lessons/sa-context-trace.md` **不存在**——该成员尚未栽过跟头，本来就没有错题本。由此得出的真实影响是：**「教训前置」这一环在成员侧天然为空**，不是因为链路吞掉了它，而是因为没有内容可传递；本轮派工 brief 里「PRIOR_LESSONS（该成员暂无错题本，本次为空）」正是这一状态的正确呈现。这与 CF-03 是两个独立缺口：CF-03 是「有内容但传不到子会话」的通道断链，本条是「通道两侧都没内容」的空态。
- 复现步骤：1) 读 `guard.mjs:107-120` 确认放行逻辑只放宽路径判定、无注入正文；2) 实读 `.superagent/methods/sa-context-trace.md` → 读成功（55 行，首行 `# sa-context-trace`）；3) 列 `.superagent/lessons/` 目录 → 只有 `_TEMPLATE.md` 与 `sa-orchestration-audit.md`，**无** `sa-context-trace.md`；4) 对照 `.superagent/roster.json` 中 `sa-context-trace` 的 `method` 字段 = `.superagent/methods/sa-context-trace.md`，与磁盘实况一致；5) 观察 guard 侧：即便文件存在，也只是允许读，不自动把正文注入上下文。
- 证据：`plugin/scripts/guard.mjs:107-110`（注释明写「它们住在项目的 .superagent/ 下，通常不在派工 SCOPE 里；不放开这两个读权限，整套机制就断了」）、`:111-120`（仅 `scope.concat` 两路径）。本轮独立复核三处取证：① `read .superagent/methods/sa-context-trace.md` → 成功，`totalLines` = 55；② `glob .superagent/lessons/*` → 仅 `_TEMPLATE.md`、`sa-orchestration-audit.md`，**无** `sa-context-trace.md`；③ `read .superagent/roster.json` → 成员 `sa-context-trace` 的 `method` 字段指向该 methods 文件（存在且与 roster 一致）。**更正说明**：本条此前版本把缺失记在 methods 路径上（报为 ENOENT），属取证误记——methods 文件一直存在，真实缺失的是错题本文件。取证的 transcripts 目录不在本轮 SCOPE 内（grep 被 guard 拦截），故 transcript 侧的三重复核由独立验收完成，本轮依据的是上述工作区直接取证。
- 状态：已复现
- 修法方向：原结论方向（「方法论拿不到 / 方法论缺失应拒绝派工」）作废——方法论一直存在，据此修闸门只会误拒正常派工。新方向指向「**方法论存在、但错题本不存在时，教训前置这一环在成员侧天然为空**」：① 不要把「成员无错题本」记成链路缺陷，那本就是正确状态（还没栽过跟头）；② 机制层应在 brief 里显式区分「该成员无错题本（内容为 0 条）」与「错题本存在但未送达（通道故障）」两种空值，否则 Router 无法判断该补内容还是该修链路；③ 承接 CF-03 的修法方向，让 lessons 以结构化字段直接进入 task prompt 时，空集合要显式标注为「该成员暂无错题本」，而不是静默省略——否则两种空值在下游无法区分。
- 还需要什么：需要一份真实的 `.superagent/lessons/<成员名>.md` 样本（当前仅 `sa-orchestration-audit` 有错题本）配合 `lessons.mjs` 的读取路径实测，才能确认「有错题本时该文件能否被成员读到并进入上下文」；本条当前只确认了「无错题本时该环天然为空」这一半，另一半（有内容时的到达情况）未取证。
- 来源：CF-06 ｜ 严重度：P2 ｜ 归属层：契约层

### D-19
- 触发条件：台账 `dispatches` 超过 200 条后，`dispatch.mjs:117` 的 `slice(-200)` 丢掉最旧记录；若被丢掉的正好是当前会话自己的历史记录，`totalDispatches` 统计出的累计数就低于真实值。
- 影响：闸门三的「累计派工 30」上限只在台账尚未被截断时有效；多会话并行、长时间运行后可持续超派。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:117`（`slice(-200)`）、`plugin/scripts/lib.mjs:230-233`（`totalDispatches` 只统计台账里仍在的记录）、`plugin/scripts/dispatch.mjs:77-82`（上限判定）。
- 状态：已复现（已完全确认）
- 修法方向：把累计计数从「扫台账」改为台账里持久化一个 per-session 累计计数；或把截断策略改成按会话配额保留（例如每个 parent_session_id 至少保留最近 N 条），别让 200 这个全局截断决定单个会话的额度。
- 还需要什么：无，代码路径已确定
- 来源：RG-06 ｜ 严重度：P2 ｜ 归属层：机制层

### D-20
- 触发条件：worker 在交付里写出**工作区之外的绝对路径**（Windows 盘符路径 `C:/...`）。
- 影响：`watchdog.mjs:78` 只把以 `/` 开头的当绝对路径，`C:/...` 不以 `/` 开头 → 被拼成 `<工作区根>/C:/...` → `watchdog.mjs:79` 的 `existsSync` 必然为 false → 该文件被列入「声称产出但不存在」→ `watchdog.mjs:105-112` block。交付被反复打回，而文件其实真实存在。这与 RG-08 方向相反：watchdog 一边放行空话，一边拦截实话。
- 复现步骤：
- 证据：`plugin/scripts/watchdog.mjs:78`（`const abs = norm.startsWith('/') ? norm : root + '/' + norm;`）、`plugin/scripts/watchdog.mjs:79`（`existsSync` 判定）。对照 `plugin/scripts/lib.mjs:113-121`（`relativize` 已实现盘符绝对路径处理），watchdog 这条路径没有复用。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/watchdog.mjs:78`——盘符路径（`/^[A-Za-z]:/`）按绝对路径直接判存在；把路径归一化抽成 `lib.mjs` 的公共函数，让 guard 与 watchdog 用同一套规则（现在两处各写各的）。
- 还需要什么：无，代码路径已确定
- 来源：RG-09 ｜ 严重度：P2 ｜ 归属层：机制层

### D-21
- 触发条件：成员方法论文件的「## 实战记录」段位于文件后半段（本项目模板与真实文件都是这样——它是最后一个二级标题）。
- 影响：`record-gate.mjs:72-76` 的 `nextSection` 返回**相对偏移**（`rest` 内的位置），`:66` 却把它当**绝对索引**传给 `raw.slice(sectionStart, ...)`；当相对偏移小于 `sectionStart` 时 slice 得到空串 → `existing = 0` → `MAX_RECORDS = 20`（`:23`、`:68-69`）这道上限**永不触发**，履历可无限增长。同一文件的写入路径（`:96`）用的是正确的绝对索引 `raw.indexOf('\n## ', sectionStart + SECTION.length)`——同一文件两种索引口径，是这个 bug 的直接证据。
- 复现步骤：
- 证据：`plugin/scripts/record-gate.mjs:64-69`（计数与上限判定）、`plugin/scripts/record-gate.mjs:72-76`（返回相对偏移的 `nextSection`）、`plugin/scripts/record-gate.mjs:96`（写入路径用绝对索引）。真实布局证据：`.superagent/methods/_TEMPLATE.md:42-44`（「## 实战记录」是最后一个二级标题，起于第 42 行）、`.superagent/methods/sa-plugin-release.md:52-59`（真实成员文件同构：段首在第 52 行、全文 61 行）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/record-gate.mjs:72-76`，让 `nextSection` 返回绝对索引（`from + SECTION.length + rest.indexOf(...)`），与 `:96` 口径统一；并加一条断言：计数结果为 0 但文件里确有 `### ` 记录时判为异常，不要静默当成 0。
- 还需要什么：无，代码路径已确定
- 来源：RG-12 ｜ 严重度：P2 ｜ 归属层：契约层

### D-22
- 触发条件：worker 用 `glob`/`grep` 且显式传 `path` 目录（该目录在 scope 条目所在目录下，但目录本身不是条目）。
- 影响：`guard.mjs:123-127` 的 `targetOf` 优先取 `tInput.path` → 目标变成目录（如 `src/app`）；`lib.mjs:147-152` 的读模式只放开「条目所在目录下的**文件**」，不放开「该目录本身」→ `inScope` 返回 false → `guard.mjs:149-153` deny。结果是：读 `src/app/session.ts` 放行、列 `src/app` 目录被拦——同一个目录，两种结论。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:123-129`（目标取值）、`plugin/scripts/lib.mjs:129-155`（`inScope` 读模式分支）、`plugin/scripts/guard.mjs:149-153`（最终 deny）；`.superagent/e2e-test.mjs:127-128`（`{pattern:'src/app/*.ts'}` 放行 / `{pattern:'**/*.ts'}` 拦截）与 `.superagent/guard-test.mjs:97-102`（同一组用例）只锁了「pattern 不带 path」的情形，未覆盖带 `path` 的调用；`.superagent/chain-test.mjs` 全文 `glob|grep|pattern` 零命中，不含任何 glob 用例（原引用 `:157-166` 举证不实，已删除）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/lib.mjs:147-152`——读模式命中「条目所在目录」时应把该目录本身也算命中（`rel === dir` 也放行）；或在 `plugin/scripts/guard.mjs:123-127` 对 glob/grep 优先按 pattern 判定、path 只作附加约束。
- 还需要什么：无，代码路径已确定
- 来源：RG-15 ｜ 严重度：P2 ｜ 归属层：机制层

### D-23
- 触发条件：任何一次派工。
- 影响：`dispatch.mjs` 写了 4 个字段，全仓没有任何判定读过它们——典型的「台账写了但判定不查」。其中 `unscoped: false` 最能说明问题：它看起来是「无 scope 派工」的标记，但闸门一（`dispatch.mjs:47-55`）已直接拒掉无 scope 的派工，这个字段永远只能是 false 且没人读；`tool_use_id`（`dispatch.mjs:106`）是唯一能标识「一次具体派工」的天然唯一键，却被写入不用，正是 RG-04 去重键退化的直接原因。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:106,109,111,113`（写入点）；检索结果见复现步骤（`plugin/scripts/` 与 `.superagent/` 两个目录下均只有写入点、无读取点）。
- 状态：已复现（已完全确认）
- 修法方向：要么让判定真的用上这些字段（`tool_use_id` 用作去重与回收的键；`unscoped` 删掉或改为记录「scope 提取时是否降级」），要么从台账结构里删掉，避免后来人误以为它们在起作用。
- 还需要什么：无，代码路径已确定
- 来源：RG-17 ｜ 严重度：P2 ｜ 归属层：契约层

### D-24
- 触发条件：roster 里第 7 个及以后的成员也有实战记录。
- 影响：`records.mjs:51` 的 `if (out.length >= maxMembers) break;` 在满 6 个时直接截断（`gate.mjs:42` 与 `session-start.mjs:39` 都传 6），注入文本却写成「以下成员过去有验收通过的成果」，读起来像全集——被截掉的成员对匹配参考完全不可见，Router 可能为一个已有战绩的专项另建成员。
- 复现步骤：
- 证据：`plugin/scripts/records.mjs:38-53`（`maxMembers` 与 `break`）、`plugin/scripts/records.mjs:51`（截断行）、`plugin/scripts/gate.mjs:42`、`plugin/scripts/session-start.mjs:39`（两处都传 6）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/records.mjs:51`——截断时保留「已显示 N / 共 M」的显式提示，或按成员的 owns 相关度排序后再截断；`gate.mjs:42` / `session-start.mjs:39` 的 6 与 `records.mjs:38` 的默认 8 要对齐说明。
- 还需要什么：无，代码路径已确定
- 来源：RG-18 ｜ 严重度：P2 ｜ 归属层：契约层

---

## 四、归属层分布与修复顺序建议

- P0/机制层：5 条
- P1/契约层：4 条
- P1/机制层：7 条
- P2/契约层：5 条
- P2/机制层：3 条

建议顺序：① 先清 P0 的 5 条静默放行（边界不报错 = 边界不存在）；② 再修 P1 中让「教训前置」真正生效的那条（CF-03）与让履历不可伪造的那条（RG-11）；③ 契约层统一为单一事实源（模板、编号命名空间、验收标准与产出标准必须同源）；④ P2 逐条消噪。

**未验证项**：所有「已复现」均为静态推演 + 活体探针，未实跑被审计脚本；安装目录与运行时缓存副本与仓库副本已比对确认逐字节一致（11/11 脚本），故「审计对象 ≠ 运行时对象」这一残留风险已排除。
---

### D-25
- 触发条件：worker 在 bash 命令里夹带账号级或对外可见的不可逆动作，且命令里**同时**含一个 scope 内的路径 token（让「取不到目标即 deny」这条规则不生效）。典型命令：`echo x >> .superagent/STATUS.md && mavis agent delete sa-victim`。
- 影响：**worker 可以绕过护栏删除账号级成员**（`mavis agent delete`）、改写成员（`mavis agent update`）、触发部署或 Mini App 发布。`mavis` 是本机真实存在的 CLI，命令文本会被 shell 真的执行 —— 这不是理论风险，是可执行的账号级不可逆动作。根因：`lib.mjs` 的 `DANGEROUS_COMMAND` 只覆盖固定几个对外命令（`git push`/`npm publish`/`docker push`/`terraform apply`/`kubectl apply`/`gh pr create`），不含账号级动作；而 `guard.mjs` 的 `dangerousByArgs` 只按**工具名 + 参数**判定（`mavis` 工具、`miniapp` 工具），bash 是自由文本命令，走不到那条分支。
- 复现步骤：用假 `PLUGIN_DATA` + 真 transcript 驱动**仓库版** `plugin/scripts/guard.mjs`（scope = `.superagent/STATUS.md`），喂合成 PreToolUse 载荷：① `bash` + `command="echo x >> .superagent/STATUS.md && mavis agent delete sa-victim"` → **ALLOW**；② `bash` + `command="mavis agent delete sa-victim"`（无路径 token）→ **ALLOW**；③ 对照组 `bash` + `command="echo x >> .superagent/STATUS.md && git push"` → **DENY**（`DANGEROUS_COMMAND` 生效）；④ `bash` + `mavis agent update` → **ALLOW**；⑤ `bash` + `website_deploy` → **ALLOW**；⑥ `bash` + 普通命令 `echo x >> .superagent/STATUS.md` → **ALLOW**（对照组，必须仍然放行）。
- 证据：活体探针输出逐行 —— `PROBE|P1-bash-in-scope-plus-agent-delete|ALLOW`、`PROBE|P2-bash-agent-delete-only|ALLOW`、`PROBE|P3-bash-in-scope-plus-git-push|DENY`、`PROBE|P4-bash-in-scope-plus-agent-update|ALLOW`、`PROBE|P5-bash-in-scope-plus-website-deploy|ALLOW`、`PROBE|P6-runcode-agent-delete|DENY`、`PROBE|P7-bash-in-scope-harmless|ALLOW`。探针工装：`C:/Users/yang2/AppData/Local/Temp/sar-probe-bash/probe.mjs`（假 PLUGIN_DATA + 真 transcript，驱动仓库版 guard）。**注意 P6**：机制层的复合判定对同一动作是 DENY 的 —— 判定逻辑本身没错，是**触发链路**没走到（见 D-26）。
- 状态：已复现
- 修法方向：bash 通道的危险判定必须按**命令形态**识别（CLI + 子命令 + 动作，如 `mavis agent delete|update`），不能用「见到 delete 就拦」这种词匹配 —— 那会误伤 `rm build/out.txt` 这类普通路径操作；同时必须保留只读命令分流（`ls`/`cat`/`git log` 仍按读判定）。契约侧已在 S3 新增「bash 通道的危险操作形态」条款、S5.3 补「同一份清单必须在 bash 通道同样生效」。
- 还需要什么：无 —— 复现不依赖平台派发行为，纯机制层即可判定。
- 来源：v0.5.0 独立复验收尾时的运行时取证 ｜ 严重度：P0 ｜ 归属层：机制层

### D-26
- 触发条件：**把一次阴性观察写成了平台恒定事实** —— 2026-11-10 10:22 的子会话里外层 `run_code` 没被派发，据此判定「平台不对容器调用派发 PreToolUse」，并把这条写进了契约 S3、`scope.md`、README 与 RT-04。
- 影响：结论方向错了 —— 平台**会**为容器调用派发（14:29 与 15:10 的子会话实测当场 DENY），只是**派发与否随会话而变**。写错比没写更坏：文档把复合层标成「预留防线 / 当前不生效」，后人据此不再维护它；更严重的是它把「判定落在内层」这条正确的处置说成了「因为平台不派发所以不得不落内层」—— 依据错了，结论侥幸对，将来平台一旦统一派发或统一不派发，这套文档都会误导。
- 复现步骤：① **阴性样本**（2026-11-10 10:22，子会话 `mvs_b0accaba…`）：给活动 hook 树的 `scripts/guard.mjs` 装一行临时日志（把 `readStdin()` 收到的原始载荷追加到日志文件），并同步到安装副本（运行时从安装副本物化新树）；开一个新子会话，只做一次 `run_code` 调用（`return { probe: 'container-dispatch-check', n: 1 + 1 }`）与一次 `read` 调用；读日志 —— **只有 `read` 有条目，外层 `run_code` 没有任何条目**。② **金丝雀样本**（2026-11-10 15:10，子会话 `mvs_355c229f…`）：同一形状的调用，外层代码里放一个危险字符串常量（`const note = 'mavis agent delete';`）→ **被拒**，原文「[super-agent-router] 已拦截：在复合调用里执行了 agent delete（删除成员是账号级不可逆操作）。…」；纯计算对照组（`return { probe: 'canary-control', n: 1 + 1 }`）→ 放行。③ 14:29 的子会话 `mvs_20e67557…` 独立复现同一形态一次（拒绝原文逐字一致）。
- 证据：探针日志 `C:/Users/yang2/AppData/Local/Temp/sar-hook-log.jsonl` 条目分布 = `write 1 / bash 2 / read 1`，**无 run_code**（其中 read 条目来自探针子会话的容器内子调用，证明日志探针在该会话内正常工作）—— 这条阴性观察本身可信；反证来自运行时 transcript：会话 `mvs_20e67557…`（2026-11-10T06:29:58Z）与金丝雀复测会话 `mvs_355c229f…`（2026-11-10 15:10）的 `run_code` 工具结果里都带着**本插件自己的**拒绝原文，而该原文只可能由 `guard.mjs` 的 `tool_name === 'run_code'` 分支产生 ⇒ 平台确实派发了容器事件。缓存树逐棵核对：`run_code` 是 2026-11-10 08:19 才进入 matcher 的，11/9 物化的 60 棵树全部没有它，11/10 08:11 之后物化的树全部有。
- 状态：**已证伪并更正**（原结论「平台不派发」作废，改为「派发随会话而变」）
- 修法方向：文档四处同步更正 —— 契约 S3「容器调用的派发事实」、`references/scope.md` 复合工具章节的运行时事实注、`.superagent/lessons/_router.md` RT-04、`.superagent/STATUS.md` 的 v0.5.0 收尾段。处置不变但理由要改对：**(1) 危险操作与作用域的判定必须落在内层通道**（D-25 的修法）—— 理由不再是「平台不派发所以没办法」，而是「派发不可靠，不能当唯一防线」；**(2) `run_code` matcher 条目保留** —— 它在派发到的会话里确实生效；**(3) `mavis` 条目保留** —— 普通工具调用实测稳定被派发并判定。
- 还需要什么：需要把「哪个会话会被派发」钉到具体机制上 —— 已确认 `run_code` 于 08:19 才进 matcher、11/9 物化的 60 棵树都没有它（已逐棵核对），**推断**是 matcher 取自会话绑定的缓存树，因此老会话不派发、新会话派发；这一推断尚未逐棵验证，会影响「老会话里的 worker 到底有没有复合层保护」的判断。另外需要平台侧确认载荷里的代码字段名（当前机制读 `tool_input.code` / `program` / `script`）。
- 来源：v0.5.0 独立复验收尾时的运行时取证（**该结论已在本轮被证伪并更正**）｜ 严重度：P0（原判 P1 —— 它让整层防护的维护状态被误标）｜ 归属层：运行时事实（+ 文档）

### D-25b
- 触发条件：bash 命令用**带布尔开关的包装器**执行危险动作 —— `sudo -n mavis agent delete sa-x`、`env -i mavis agent delete sa-x`、`timeout 5 mavis agent delete sa-x`、`powershell -Command mavis agent delete sa-x`（未加引号）。
- 影响：D-25 的洞没被完全堵住 —— 这四条形态仍然 **ALLOW**，账号级成员删除可经包装器绕过。根因三处：① `lib.mjs` 的 `WRAPPER_VALUE_FLAGS` 把 `-n/-i/-e/-l/-s/-h/-d/-o` 一律当「带独立取值的开关」吞掉后一个 token，而 `sudo -n`、`env -i` 是**布尔开关不带值** —— 真正的命令词（`mavis`）被吞掉，命令位置找不到它；② `COMMAND_WRAPPERS` 是闭集，漏了 `timeout`、`powershell`/`pwsh`、`cmd /c`、`stdbuf`、`ionice` 等；③ `powershell -Command` 后面的整段没有被当作内层命令再判一次。
- 复现步骤：用假 PLUGIN_DATA + 真 transcript 驱动仓库版 guard（scope = `.superagent/STATUS.md`），喂上述四条合成 bash 载荷 → 观察 verdict 为 ALLOW（应为 DENY）。
- 证据：独立 verifier 复验（D-25 收窄单）实测：`sudo -n mavis agent delete sa-x`、`env -i mavis agent delete sa-x`、`timeout 5 mavis agent delete sa-x`、`powershell -Command mavis agent delete sa-x` 全部 ALLOW。对照：同一轮里 `sudo mavis agent delete`（无开关）、`env FOO=1 mavis agent delete`、`sh -c "mavis agent delete"`、`cat $(mavis agent delete)` 等 10 条包装形态全部 DENY。verifier 另注：`sudo`/`env`/`timeout`/`powershell` 在本机均存在（`mavis` 本身不在 PATH，但**判定层洞成立**，与 D-25 同一威胁模型）。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：带值开关改成**按包装器分别定义**（布尔开关不吞 token；只有 `sudo -u/-g/-p/-C/-r/-t`、`env -u/--unset/-C/--chdir` 这类真带值开关才吞）；`timeout` 的时长按**位置参数**处理；包装器集合补齐 `timeout`、`powershell`/`pwsh`、`cmd /c`、`stdbuf`、`ionice`、`setsid` 等；`powershell -Command`/`-c` 之后的整段按**内层命令**再判一次。查表不得一律小写化（`sudo -H` 与 `sudo -h` 语义不同）；认不出的开关按「宁可多判不可漏判」处理。
- 还需要什么：无 —— 判定层可独立验证，不需要真实执行这些命令。
- 来源：D-25 独立复验的残余发现 ｜ 严重度：P0 ｜ 归属层：机制层

### D-25c
- 触发条件：bash 命令形如 `mavis list agent delete` —— `agent` 不是 `mavis` 之后的**第一个**子命令，却因为「`mavis` 后面出现 `agent delete`」而被判成危险动作。
- 影响：**过度拦**。正常运维命令（先列再删的复合写法、`mavis agent list` 之类）被误判为账号级不可逆操作并拒答 —— 护栏误伤会让 worker 无路可走，最终绕过护栏（这正是上一轮 `run_code` 复合层误伤的教训）。
- 复现步骤：喂合成 bash 载荷 `mavis list agent delete` → 观察 verdict 为 DENY（应为 ALLOW）。
- 证据：独立 verifier 复验实测：`mavis list agent delete` 被拦；对照组 `mavis agent list` 未被拦（说明命中的是「`agent` 子命令非位置匹配」而不是别的分支）。verifier 措辞原文：「`mavis list agent delete` 被拦（`agent` 子命令非位置匹配，过度拦）」。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：`agent` 必须是 `mavis` 之后的**第一个**子命令才算 `mavis agent delete|update`；位置之后的 `agent` 不构成危险形态。
- 还需要什么：无。
- 来源：D-25 独立复验的残余发现 ｜ 严重度：P1 ｜ 归属层：机制层

### D-25d
- 触发条件：bash 命令用**闭集包装器名单之外**的启动器执行危险动作 —— `exec mavis agent delete sa-x`、`taskset 0 mavis agent delete sa-x`、`watch -c mavis agent delete sa-x`、`at now mavis agent delete sa-x`、`parallel mavis agent delete sa-x`、`script -q -c "…" mavis`、`chroot . mavis agent delete sa-x`、`strace -f mavis agent delete sa-x` 等 17 条形态。
- 影响：账号级成员删除仍可绕过护栏。**根因不是漏了一个 `exec`** —— 是「命令位置」用**闭集包装器名单**实现：名单外的启动器被当成命令本身，后续 token 全部不再参与判定。补 10 个名字，下一个变体照样漏 —— 这是**结构性缺口**，也是 D-25b 的同根因族。
- 复现步骤：喂上述形态的合成 bash 载荷 → 观察 verdict 为 ALLOW（应为 DENY）。
- 证据：独立 verifier 实测 17 条形态全部 ALLOW；verifier 定位到 `plugin/scripts/lib.mjs` 的 `WRAPPER_SPECS`（14 键）与 `SHELL_PAYLOADS` 两张闭集表，`exec` 未列入（同类的 `command`/`builtin` 却列了）。本机 `mavis` 不在 PATH，未实际删成员，但**判定层洞成立**。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：**命令位置不再用闭集名单实现**，改为「数据段 / 执行段」二分 —— 段首命中**数据命令清单** → 段内其余 token 与引号内内容皆为数据；段首不是数据命令 → 段内**每个 token 都是命令候选**。由此 `exec` 及任何将来出现的包装器自动被覆盖。数据命令清单要尽量完整，但**不得收 `tar`/`unzip`/`zip`/`gzip`**（`--to-command` 会真执行，收进来等于开盲区）。另补启动器形态：`npx`/`bunx`、`npm`/`pnpm exec|dlx`、`yarn dlx` 之后的**首个程序参数**按命令位置判定。
- 还需要什么：无。
- 来源：D-25 残余闭环复验 ｜ 严重度：P0 ｜ 归属层：机制层

### D-25e
- 触发条件：bash 命令形态被**过度拦** —— ① `sh -c mavis agent delete sa-x`（**未加引号**）；② `command -v mavis agent delete sa-x`。
- 影响：护栏误伤。① 按 POSIX，`sh -c <string> [name [args...]]` —— `command_string` 只有 `mavis` 一个词，`agent delete sa-x` 是 `$0`/`$1` 位置参数，**执行的是没有子命令的 `mavis`**，不该按 `mavis agent delete` 拦；② `command -v` 是**查询**语义（打印命令路径），不执行任何东西，更不该拦。误伤会让 worker 无路可走，最终绕过护栏 —— 与上一轮 `run_code` 复合层误伤同源。
- 复现步骤：喂上述两条合成 bash 载荷 → 观察 verdict 为 DENY（应为 ALLOW）。
- 证据：独立 verifier 实测两条均被拦；verifier 定位根因：`lib.mjs:991` 的 `positions.push(fi + 1)` 把**载荷下标漏进外层位置表**；`lib.mjs:861` 把 `command` 的 `-v` 当普通 bool 开关。对照：`sh -c "mavis agent delete sa-x"`（带引号，单个 token 内含空格，整个 token 就是命令）**必须拦**。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：载荷取参按 **shell 语义** —— `sh`/`bash` 的 `-c` 只取**一个**参数作命令串，余下是位置参数，**不推进外层位置表**；`powershell`/`cmd` 取余下整段；base64 载荷解不出即拒绝；`command -v`/`-V` 按查询语义处理，该段无命令位置。
- 还需要什么：无。
- 来源：D-25 残余闭环复验 ｜ 严重度：P1 ｜ 归属层：机制层

### D-27
- 触发条件：用户用**口语化说法**表达编排意图 —— 「拆一下这块」「分头做」「各做各的」「同时做 A 和 B」「谁负责这块」「派谁去做」「几个人一起做」「帮我拆解这个任务」「这个要做两件事」「复审一下」「评审一下」「放到后台做」「一前一后两个人」「让 A 和 B 各自负责」「一边调研一边写」「实现和验证一起」「分一下工」「这两个能不能一起做」。
- 影响：**该走编排的轮次被静默放行，Router 完全不知道编排机制存在** —— 这一轮就退化成单点直做，多性质任务不做拆分、不做独立验收。实测漏判率 **83%（23 条应命中里漏 19 条）**，而误触发 **0 条** —— 粗筛偏保守到近乎失效。
- 复现步骤：1) 取 `plugin/scripts/gate.mjs` 的三个正则（`INTENT` / `SIGNAL` / `SCOPE_HINT`）；2) 喂上面 18 条口语化请求；3) 观察命中数为 0。判定式见「复现步骤」的工装：`C:/Users/yang2/AppData/Local/Temp/sar-gate-regex-test.mjs`（把当前三个正则原样复刻后跑 23 条样本）。
- 证据：父会话实测输出 —— `SUMMARY should_hit=23 missed=19 false_trigger=0`；漏判样本逐条列出（含长度）。根因两条：**① INTENT 只覆盖名词化/书面说法**（派工/组队/分工/验收/复盘），漏掉口语**动词短语**（拆一下/拆解/分头做/各做各的/同时做/谁负责/派谁/复审/评审/放到后台/几个人一起…）；**② `prompt.length > 40` 这个硬门槛把 SIGNAL 废掉了** —— SIGNAL 里的「同时/多个/各自/分别」本该接住这些说法，但中文口语指令通常只有 3~12 字。运行时侧佐证：本会话 36 个带 hook 注入的轮次里，gate **漏判 10 次**；**用户本轮这一句「好像还有点问题就是主动触发还有其他的你看看」（21 字）本身就是漏判样本**。另有断言缺口：回归只测了「一条长书面指令（命中）+ 一条单点提问（静默）」两个极端，**口语化编排请求一条都没测** —— 这就是漏判能长期存在的原因。
- 状态：**已修复（v0.5.1）**
- 修复后证据：判定抽到 `lib.mjs` 的 `judgeTriggerIntent()` 并导出（回归可 `import` 直接断言）；契约新增 **S11「触发语义」**。语料自测：A 档 23 条**漏判 0**（改前 19）、B 档 6 条误触发 0、C 档 7 条伪信号误触发 0。四组变异自检（`node .superagent/d27-mut-test.mjs`，常驻套件）：M1 回退词表 → 红 3 条；M2 恢复长度门槛 → 红 1 条；M3 去掉动作性限定 → 伪信号红 5 条；M4 常真桩对照 → B 档 6 条 + C 档 7 条全红；每组均核对 sha256 落盘与 `node --check`。九套回归对仓库副本与安装副本均 0 FAIL。
- 修法方向：① INTENT 补口语动词短语；② 去掉 `length > 40` 硬门槛，改用「信号词 + 动作性」判定；③ 判定函数从 `gate.mjs` 抽到 `lib.mjs` 导出，使回归能**直接 import 断言**；④ 未命中时**条件式**兜底注入一行极短提示（仅当「roster 存在且有专项成员且该成员有实战记录」时），对单点小改的工作区零成本；⑤ 载荷解析失败**不静默**（`parseInput` → `parseInputStrict` 或留痕）。契约侧新增「触发语义」条款（父会话落）。
- 还需要什么：需要平台侧确认 UserPromptSubmit 的派发时机与载荷形状是否稳定 —— 若载荷字段名变化，`prompt` 取空会导致「永远不命中」的静默失效（与 D-26 同族的「触发链路」问题）。
- 来源：用户反馈「主动触发还有其他的」后的定点排查 ｜ 严重度：P0 ｜ 归属层：机制层

### D-28
- 触发条件：父会话取消派工（`task_stop`）、中断派工，或子会话异常退出（非正常结束）。
- 影响：**并发名额泄漏到 TTL（2 小时）为止**。`MAX_ACTIVE_DISPATCHES = 6`，单会话连派 6 个 worker 再取消几个，后续派工会以「在飞派工已达上限」被拒 —— 表现为「机制突然不让我派工了」，而报错完全不指向真正原因。属于**活性问题**（不是安全问题：多占名额不放行，不放行越权操作）。
- 复现步骤：1) 父会话派出一个 worker；2) 用 `task_stop` 取消它；3) 读台账 `PLUGIN_DATA/dispatches.json`，该条 `state` 仍是 `active`；4) 在 TTL 内继续派满 6 个，第 7 个被「在飞派工已达上限」拒绝。
- 证据：本轮实测 —— 派工 `dsp_mwab22ks_4iccn9`（`sa-mechanism-fix`）被父会话 `task_stop` 取消后，台账 `state` 长时间停在 `active`，父会话只能靠**一次性临时脚本**手工调 `markDispatchAborted` 才把名额拿回来（`end_reason=parent_cancelled_task_no_delivery`）。**机制本身没有可用入口** —— `markDispatchAborted` 虽已从 lib.mjs 导出，但没有任何 CLI / 脚本 / 文档告诉调用方怎么用；契约 S6.2 第 2 条的三条路（正常结束 / 超时兜底 / 读时自愈）**没有一条覆盖取消场景**。
- 状态：**已修复（v0.5.2）**
- 修复后证据：新增 `plugin/scripts/release-slot.mjs`（契约 S6.2 第 5 条）+ 常驻回归 `.superagent/dispatch-release-test.mjs`（20 条断言，全绿）；入口 `node scripts/release-slot.mjs '{"dispatch_id":"dsp_xxx"}'` 或按 `parent_session_id` 批量释放。
- 修法方向：① 契约 S6.2 补第 5 条：取消场景由**发起方显式释放**，入口由插件自带；② 释放只把 `active` 翻成 `aborted`，`done` / `aborted` 的记录一个字节都不动；③ 目标不存在或台账读不出来时**报错退出**，不许静默成功 —— 否则调用方以为名额放掉了，实际还在占着；④ 台账条目里**没有子会话 id**，所以「自动探测子会话是否还活着」不可行，能自动拿到的只有终止事件而取消场景没有终止事件 —— 这条写进契约，免得下次又去做自动探测。
- 还需要什么：若平台将来提供「派工被取消」的事件（类似 SubagentStop 的取消态），应改为**事件驱动自动回收**，本入口退化为兜底。当前无平台事件可用。
- 来源：本轮「主动触发还有其他的」定点排查中实测暴露 ｜ 严重度：P2 ｜ 归属层：机制层

## 五、v0.5.0 修复状态（2026-11-10）

本轮按契约 `plugin/skills/super-agent-router/references/contract.md` 改造，独立验收见 `docs/audit/verification-v050.md`（35 条，30 成立 / 2 不成立 / 3 未验证，VERDICT FAIL → 修完复验）。

| 编号 | 状态 | 说明 |
|---|---|---|
| D-01 | 已修复 | transcript brief 解析兼容 `codex` 变体 |
| D-02 | 已修复 | bash 路径 token 不再把 `console.log` 当路径；目录型目标可识别 |
| D-03 | 已修复 | 未登记的文件类工具名一律按写判定；`mavis` 的 `agent delete` 按参数拦截 |
| D-04 | 已修复 | brief 解析改为按语义定位，不再只扫前 8 行 |
| D-05 | 已修复 | 去重键缺 `turn_id` 时不再抹掉其它记录 |
| D-06 | 部分修复 | **教训**已由 guard 直达 worker 上下文；**履历**按协议只给 Router 做匹配参考（分工，非遗漏） |
| D-07 | 已修复 | SCOPE 解析不出条目即拒绝派工 |
| D-08 | 文档解决 | 子会话不触发 SessionStart 是运行时事实，代码关不掉；已写进 `references/scope.md` 与 `references/brief.md` |
| D-09 | 已修复 | 写冲突检测扩到项目维度 |
| D-10 | 已修复 | 名额回收三条路：正常结束 / 超时兜底 / 读时自愈 |
| D-11 | 已修复 | watchdog 证据须为可核验的具体物 |
| D-12 | 已修复 | 台账用 routing id（`agent_key`）而非显示名做等值比较 |
| D-13 | 已修复 | `verified_by` 必须在台账里有 `state=done` 记录；写入时校验，读取时不管历史 |
| D-14 | 已修复 | 方法论/错题本改为精确文件放行（`mode='exact'`），不再展开整棵目录树 |
| D-15 | 部分修复 | gate 的措辞治理仍依赖 Router自觉，未代码强制 |
| D-16 | 已修复 | 写类工具取不到目标即拒绝（复合工具除外，契约 S3 已写明例外） |
| D-17 | 未修复（说明有误，已纠正） | **原「部分修复」说明与实现不符** —— 「已显示 N / 共 M」只在 gate **命中分支**里；漏判时 `process.exit(0)` 一个字都不输出，Router 完全不知道编排机制存在。本轮按 D-27 一起修 |
| D-18 | 已修复 | 错题本为空时显式说「0 条（是没栽过跟头，不是传递故障）」 |
| D-19 | 已修复 | 台账截断策略调整 |
| D-20 | 已修复 | 盘符绝对路径按真实路径校验存在性，报错保留盘符前缀 |
| D-21 | 已修复 | 段首/段尾定位统一为绝对索引 |
| D-22 | 已修复 | glob/grep 判定对象改为有效检索根，目录本身算命中 |
| D-23 | 已修复 | 台账不再写无人读取的 `unscoped` 等字段 |
| D-24 | 已修复 | 记录摘要取样不再按名录顺序截断，改为收齐→按战绩排序→取样→披露省略者 |
| D-25 | 已修复 | bash 通道按**命令形态**识别账号级动作（`mavis agent delete|update` 等），12 条负例不误伤；独立复验 PASS_WITH_RESIDUAL，残余 D-25b / D-25c 已在本版闭环 |
| D-25b | 已修复 | 包装器开关改为按包装器分别定义（带值/布尔/位置参数分列），包装器集合补齐，载荷按两式取参并整体再判 |
| D-25c | 已修复 | 账号级 CLI 的子命令必须是第一个子命令：`mavis list agent delete` 不再被拦 |
| D-25d | 已修复 | **闭集包装器名单**改为「数据段/执行段」二分，`exec` 及任何新包装器自动覆盖；另补启动器（npx/npm exec/pnpm dlx）语义 |
| D-25e | 已修复 | 载荷取参按 shell 语义（`sh -c` 单参数、位置参数不推进外层）、`command -v` 查询语义，两例过度拦消除 |
| D-26 | 已证伪并更正（文档解决） | 原结论「平台**不对 `run_code` 容器派发 PreToolUse**」**作废**：实测平台会派发，但**随会话而变**（10:22 未派发 / 14:29、15:10 派发并当场 DENY）→ 复合层是**纵深防御的加成**而非唯一防线；判定落点仍在内层通道，契约 S3、`scope.md`、RT-04、STATUS 已同步更正 |

### 本轮新引入又修掉的一条

**`run_code` 复合判定误伤**（验收 V-02/V-04/V-07）：新加的 `run_code` 匹配项会把**整段代码文本**当命令文本扫路径，
于是注释里的 `//`、字符串常量里的 scope 外路径、引号里的命令串都被当成越界目标，
纯计算代码还会撞上「取不到目标就 deny」——实测三���正常代码被整次拒绝。

已按验收给的修法改成：**复合层只做危险操作判定（`dangerousInCode`），作用域判定交回内层调用**。
内层调用本来就被独立判定（V-05 实测内层 `bash` 被拦时外层 `run_code` 正常返回），所以复合层不再需要判作用域。

### 两条「改对了但没被锁住」的断言（验收 V-12/V-13）

- **V-12** 工具名兜底：原先无任何断言；已补 `upload_file` 等未登记文件类工具名按写判定且 scope 外必被拦的断言，回退实现后变红。
- **V-13** D-20 盘符路径：原先两条断言在旧实现下同样是绿的 —— 原因是**单盘机器上旧实现截掉盘符前缀后，剩下的根相对路径恰好指向同一个文件**。
  已改用 `subst` 挂载第二个盘符构造可区分场景，并补「报错必须保留盘符前缀」，回退后变红。

### 残余（未在本会话端到端验证）

线上安装副本在本次部署后才升级到 v0.5.0，而 **Hook 按会话激活** —— 本会话的 hook 缓存树仍是改前版本，
因此「真实 run_code 在新插件下的表现」需要在**新开会话**里再验一次（写 scope 内 / 写 scope 外 / 纯计算各一次）。
该边界由验收 V-32 记录，属环境边界而非产品失败。


---

## 六、独立复验与残留澄清（2026-11-10）

上一轮验收（`docs/audit/verification-v050.md`）判 FAIL 并给出三条改判条件。本轮补派独立 verifier 复验
（`docs/audit/verification-v050-recheck.md`，**VERDICT: PASS_WITH_RESIDUAL**）：三条改判条件全部以活体证据满足 ——
① 复合分支不再扫代码文本、不再套用「取不到目标即 deny」，17 组合成载荷全部按预期（改回改前语义后恰好 5 条复合断言变红）；
② V-12 与 D-20 两条断言在实现回退时确实变红（验收方首轮曾因把回退文件写到副本的错误位置而得到假绿，
自行发现后改为核对「套件实际加载的文件」的 sha256 + 行为级对照，重跑通过）；
③ 真实 `run_code` 三形态实测：scope 内写放行且文件建成、scope 外写被**内层**拦且文件未创建、纯计算放行。
8 套回归 243 条断言基线全绿。

复验报告列出的两条残留，其中**第一条在本轮被进一步查实并改判**：

| 残留项 | 复验时的结论 | 本轮查实 |
|---|---|---|
| 残留 1：外层 `run_code` 在真实运行时是否进入 PreToolUse 未能证实 | 「未验证」，两种候选解释无法区分 | **原「已坐实」结论已证伪并更正**：10:22 的日志探针阴性观察本身可信，但**推广错了** —— 14:29 与 15:10 的子会话实测平台**确实派发**并当场 DENY（金丝雀复测）。正确结论是「**派发随会话而变**」，不是平台恒定事实 → **D-26 改为「已证伪并更正」**；由它暴露的 bash 通道旁路仍记为 **D-25**（已闭环）。教训升级为：**单次阴性观察不能写成平台事实，写平台事实必须带金丝雀对照 + 时间戳 + 会话标识** |
| 残留 2：复合层断言对 HEAD 不具区分力 | 覆盖边界，非缺陷（区分力由 MUT-C 提供） | 维持原判 |

**方法论教训**（已进 Router 错题本 `.superagent/lessons/_router.md` 的 RT-04）：
**合成载荷只验证「判定逻辑」，不验证「触发链路」**，两者必须分开取证。
「机制对」与「链路通」是两个问题，合并成一个结论就会造出「防护存在」的假象 —— 这正是 D-25 长期没被发现的土壤。


---

## 七、D-25 的修复与复验（2026-11-10）

### 怎么发现的

D-25 不是台账里原有的条目，是**独立复验收尾时的运行时取证**坐实的：
用假 `PLUGIN_DATA` + 真 transcript 驱动仓库版 guard 做活体探针，发现
`echo x >> .superagent/STATUS.md && mavis agent delete sa-victim` 被放行。
而 `mavis` 是本机真实存在的 CLI，命令文本会被 shell 真的执行 —— **账号级成员删除可绕过护栏**。

**它为什么能躲过上一轮验收**：上一轮验收用的是「合成载荷驱动 guard 脚本」，判定逻辑是对的（DENY）；
但那层判定在真实运行时**是否被触发**当时没有独立证据，于是被当成了「已生效」。
合成载荷验的是**判定逻辑**，不验**触发链路**，两者必须分开取证（RT-04）。
（补充更正：后来据以推断的「平台不对容器派发」结论本身也是错的 —— 平台会派发，只是随会话而变。详见 D-26。）

### 修法与复验

修法：bash 通道按**命令形态**判定（命令位置上的「CLI + 子命令 + 动作」），
不按字样匹配；切命令段并识别命令替换，`sh -c`/`eval`/`sudo`/`env`/`xargs`/`find -exec` 包装与内层命令同判；
只读分流仅对无命令替换的命令生效。

独立复验结论 **PASS_WITH_RESIDUAL**：

| 项 | 结论 |
|---|---|
| 探针 P1/P2/P4/P5 | ALLOW → DENY；P3/P6 保持 DENY；P7 仍 ALLOW |
| 12 条负例 | 全部 ALLOW（无异常项） |
| 10 条包装形态 | 全部 DENY |
| 变异检验 | guard-test **11 条红**；另做 always-deny 桩对照（59 红）证明副本真被加载、无假绿 |
| 五套回归 | 197 断言全绿，0 FAIL |
| 残余 | **D-25b**（包装器布尔开关吞 token → 4 条形态仍放行）、**D-25c**（`mavis list agent delete` 过度拦） |

### 一条验收误判的澄清（留给下一个验收方）

复验方的 ACCEPT 五判「不成立」，理由是 `plugin/skills/.../contract.md` 与 `scope.md` 的 mtime
（10:50:37）晚于 D-25 的代码改动（lib 10:48:35 / guard 10:48:52 / guard-test 10:49:09），
于是判「本单越界改了 SCOPE 外文件」。

**这条不成立**：那两个文件是**父会话（Router）** 在同一时间窗内改的 —— 契约与参考文档按协议由父会话维护
（成员的 SCOPE 里没有它们，成员的方法论文件里也明写「不改协议文档与参考手册」）。
时间戳撞车是**父会话并行工作**造成的，不是成员越界。判定越界要看**谁写的**，不能只看 mtime ——
更稳的做法是比对内容归属与责任人，或在派工时把父会话的并行文档维护窗口告知验收方。
