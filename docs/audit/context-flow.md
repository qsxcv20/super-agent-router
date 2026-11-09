# 上下文注入与传递链路追踪（context-flow）

覆盖范围：追踪 `plugin/hooks/hooks.json` 接线表、`plugin/scripts/session-start.mjs`（SessionStart 协议注入）、`plugin/scripts/gate.mjs`（UserPromptSubmit 粗筛与实战记录摘要）、`plugin/scripts/dispatch.mjs`（PreToolUse task 派工闸门 + 错题本/实战记录 additionalContext）、`plugin/scripts/lib.mjs`（`extractScope` / `readBriefFromTranscript` / 台账）、`plugin/scripts/guard.mjs`（子会话 scope 绑定与判定）、`plugin/scripts/lessons.mjs` + `plugin/scripts/records.mjs`（错题本与履历解析），以及 `C:/Users/yang2/AppData/Local/Temp/minimax-plugin-hooks/transcripts/` 下 18 个真实 transcript 样本（9 会话 × `compatible`/`codex` 两变体）。

一句话结论：派工 brief 本身确实到达子会话，但「错题本规则 / 实战记录」只以 PreToolUse 的 `additionalContext` 挂在父会话的 task 调用上、从未进入子会话首条消息，且 `readBriefFromTranscript` 只认 `compatible` 变体、认不出 `codex` 变体，导致子会话的 scope 白名单在 codex 运行时下结构性拿不到。

条目统计：总计 8 条（CF-01～CF-08，无跳号重号），其中已复现 6 条（CF-01、CF-03、CF-04、CF-06、CF-07、CF-08），推断 2 条（CF-02、CF-05）；每条均含 7 个独立字段行（触发条件 / 影响 / 复现步骤 / 证据 / 状态 / 修法方向 / 还需要什么）

---

## 一、上下文来源清单（含来源文件与行 / 注入时机 / 载体格式 / 验证方法）

| # | 上下文来源 | 来源文件与行 | 注入时机 | 载体格式 | 接收方 | 验证方法 |
|---|---|---|---|---|---|---|
| S1 | 编排协议本体（何时该编排、怎么开始） | `plugin/scripts/session-start.mjs:19-50` | SessionStart（会话开始，仅一次） | plain-text stdout → 运行时包成 `<plugin-hook-context>` | Router（父会话） | 真实 transcript：`4efc02c8...compatible.jsonl` 第 2 行 `"subtype":"plugin_hook_context"`，正文为 `<plugin-hook-context>\n[super-agent-router] 本会话已启用 Super-agent 编排机制。…` |
| S2 | 实战记录摘要（匹配参考） | `plugin/scripts/records.mjs:38-54`（由 `session-start.mjs:39` 与 `gate.mjs:42` 调用） | SessionStart 一次 + 每次 UserPromptSubmit | plain-text stdout | Router | 真实 transcript：`4efc02c8...compatible.jsonl` 第 2 行同一 `plugin_hook_context` 块尾部含 `【当前专项成员的实战记录（匹配参考）】` 与 `sa-plugin-release` 条目 |
| S3 | 路由指令 + prompt 内 SCOPE 回显 | `plugin/scripts/gate.mjs:26-37` | UserPromptSubmit（每轮 prompt，命中 `gate.mjs:15-17` 粗筛才注入） | plain-text stdout | Router | 真实 transcript：`76a305b5...compatible.jsonl` 第 2 行 `plugin_hook_context`；代码路径见 `gate.mjs:19-21`（未命中则 `process.exit(0)` 静默放行） |
| S4 | 错题本规则（派工时必须写进 brief） | `plugin/scripts/dispatch.mjs:85-86, 121-125` | PreToolUse（matcher=`task`，父会话发起派工那一刻） | `hookSpecificOutput.additionalContext`（JSON） | **父会话（Router）**——是否转写进 brief 全靠 Router 自觉 | 真实 transcript：`4efc02c8...compatible.jsonl` 第 63/65 行是两次 `task` 工具调用（`agent_name` = `sa-orchestration-audit` / `sa-context-trace`），其 `prompt` 内**不含** lessons 块；父会话全文 grep `历史教训（派工时必须写进 brief）` 命中均为读码回显 |
| S5 | 实战记录（该成员此前验收通过的成果） | `plugin/scripts/dispatch.mjs:89, 126-132` | PreToolUse（matcher=`task`） | `hookSpecificOutput.additionalContext`（JSON） | **父会话（Router）** | 同上；`4efc02c8...compatible.jsonl` 中 `该成员此前验收通过的成果` 的 2 次命中均出现在读 SKILL.md 的 tool_result 内，非注入块 |
| S6 | 派工 brief 原文（含 SCOPE / ACCEPT / FORBID / EVIDENCE） | Router 手写，经 `task` 工具 `prompt` 参数传入 | 派工瞬间 | tool_use `input.prompt`（明文） | worker / verifier | 真实 transcript：`5b26db54...compatible.jsonl` 第 1 行首条 user 消息含 `SCOPE: .superagent/worker-probe.txt`；本会话 `73f33cbc...compatible.jsonl` 第 1 行含 `SCOPE: docs/audit/context-flow.md…` |
| S7 | 父会话标记 + 成员名 | 运行时注入的 `<agent-context>` 段 | 子会话首条消息 | 明文 `PARENT SESSION:` / `agentName:` | worker / verifier | 真实 transcript：`5b26db54...compatible.jsonl` 第 1 行含 `PARENT SESSION: mvs_9bdda202ae274c909a5b4352fc45a471`、`agentName: worker` |
| S8 | SCOPE 白名单（判定依据，非上下文） | `plugin/scripts/lib.mjs:260-293` `readBriefFromTranscript` | 首次工具调用时从 transcript 解析 | JSON（`{parentSessionId, agent, scope}`）写入台账 | guard.mjs 内部 | 复刻 `readBriefFromTranscript` 逐行逻辑跑 9 个 `compatible` 样本：7 个解析出 scope，2 个返回 null |

---

## 二、「来源 × 接收方」矩阵

图例：**✔** = 已复现到达 ｜ **△** = 到达但不完整/需人工转写 ｜ **✘ 缺口** = 结构性拿不到

| 来源 ＼ 接收方 | Router（父） | worker（子） | verifier（子） |
|---|---|---|---|
| 派工 brief（SCOPE/ACCEPT/FORBID/EVIDENCE） | ✔ | ✔ | ✔ |
| 错题本规则（lessons） | △ 仅在 task 调用前的 `additionalContext`；需 Router 手抄进 brief | ✘ 缺口：首条 user 消息实测无 lessons 块 | ✘ 缺口：首条 user 消息实测无 lessons 块 |
| 实战记录（records） | △ 仅在 task 调用前的 `additionalContext`；需 Router 手抄进 brief | ✘ 缺口：首条 user 消息实测无 records 块 | ✘ 缺口：首条 user 消息实测无 records 块 |
| 成员方法论（methods/`<name>`.md 路径） | ✔ 靠 SKILL.md 指向 | △ 只有路径字符串；guard 放行读该路径，但**方法论正文不进上下文**（须成员主动 read 才入上下文）；该方法论文件**本轮实测存在**（55 行） | △ 同左 |
| SCOPE 白名单 | ✔（写在 brief 里） | ✔（首条消息 `SCOPE:` 行） | ✔（首条消息 `SCOPE:` 行） |

### 每个缺口会导致什么具体后果

- **错题本规则 → worker 缺口**：worker 开工时看不到「上次同类任务栽在哪儿」，只能靠自己重新踩坑；错题本的复利在 worker 侧完全断掉，本轮修的问题下一轮会以同样形态复发。
- **实战记录 → worker 缺口**：worker 拿不到该成员此前验收通过的做法与证据，无法沿用已验证路径，每次都要从零摸索，等于把「做过成过什么」这条上下文在每轮重建。
- **错题本规则 → verifier 缺口**：verifier 验收时不知道该成员历史上被判失败过哪些点，只能凭本次交付文本判断，容易把「上次已修、本次复现」的模式漏判为通过。
- **实战记录 → verifier 缺口**：verifier 无法核对本次产出与该成员历史成果是否同源、是否违反既往已确认的约束，验收缺少纵向基准。
- **成员方法论正文 → worker/verifier 缺口**：方法论只以「路径」形式出现，模型不读文件就拿不到规则内容；本轮实测该成员的方法论文件 `.superagent/methods/sa-context-trace.md` **存在**（55 行），缺口仅在「正文不会自动进上下文」，成员必须主动 read。**该成员的错题本 `.superagent/lessons/sa-context-trace.md` 则不存在**（尚未栽过跟头，本就没有错题本）——「教训前置」这一环在成员侧天然为空，详见 CF-06。
- **SCOPE → worker/verifier 缺口**：无（这是本链路唯一完整到达子会话的上下文载体）。

---

## 三、缺陷清单

### CF-01
- 触发条件：子会话 transcript 为 `*.codex.jsonl` 变体（`type:"response_item"`、`payload.role:"user"`、`payload.content[].type:"input_text"`），而 `readBriefFromTranscript` 只认 `type:"user"` + `message.content[].type:"text"`。
- 影响：scope 白名单解析返回 null → `guard.mjs:97-102` 走「解析不到边界 -> 放行」→ 子会话**完全不受越界管控**，可读写任意路径；同时 `dispatch_id` 反查失败，`watchdog.mjs:38-49` 兜底回收也失效，在飞派工名额不回收。
- 复现步骤：1) 取任一 `*.codex.jsonl` 样本；2) 逐字复刻 `lib.mjs:273-288` 的解析逻辑（只取 `obj.type==='user'` 且 `part.type==='text'`）；3) 观察 text 长度恒为 0、函数返回 null；4) 对比同一会话的 `*.compatible.jsonl` 变体，同一逻辑可解析出 scope。
- 证据：`plugin/scripts/lib.mjs:276-288`（`if (!obj || obj.type !== 'user') continue;` 与 `if (part && part.type === 'text')`）与 `plugin/scripts/guard.mjs:75`（`readBriefFromTranscript(String(input.transcript_path || ''))`）。真实样本：`5b26db54f727d72c35ce4cf7ed2a79f7.codex.jsonl` 第 1 行 `{"timestamp":"2026-11-09T12:31:28.969Z","type":"session_meta","payload":{...}}`、第 2 行 `{"timestamp":"2026-11-09T12:31:29.049Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"PTC is enabled for this turn...`——顶层 `type` 是 `response_item` 而非 `user`，`part.type` 是 `input_text` 而非 `text`，两处判断均落空。同文件全文含 `SCOPE:` 与 `PARENT SESSION:`（rawHasSCOPE=true、rawHasParentSession=true），说明**内容在、格式不符**。同一会话 `5b26db54...compatible.jsonl` 第 1 行可正常解析出 `SCOPE: .superagent/worker-probe.txt`、`agentName: worker`、`parentSessionId=mvs_9bdda202ae274c909a5b4352fc45a471`。 **本运行时用哪一变体的限定说明**：本单实测中，本会话（`73f33cbc...`）的 guard 确实按 brief 解析出的 scope 正常拦截了越界读写（拦截文案列出的 SCOPE 与 brief 一致），说明**当前 MCode 运行时传给 `input.transcript_path` 的是 `compatible` 变体**，本条在当前运行时不会触发；但 `codex` 变体由同一 `originator: minimax_plugin_hook` 写出、且与 `compatible` 同目录并存，一旦运行时切到 codex 形态（如换 Codex 系后端），同一条代码路径会静默放行。
- 状态：已复现
- 修法方向：`readBriefFromTranscript` 增加对 `codex` 变体的解析分支（`obj.type==='response_item' && obj.payload.role==='user'` + `part.type==='input_text'`）；或改为按 payload 形状嗅探而非硬编码 `type==='user'`。修法归机制 owner，本单不改代码。**重复关系**：本条与 Runtime-Guard 清单的同类条目重复（该清单条目以「brief 不在前 8 行」描述，落点同为 brief 解析不出 → scope 白名单为空 → guard 放行这一族问题），合并台账时应与之一并计入同一编号，不重复计数。
- 还需要什么：需要运行时侧给出目标环境 `input.transcript_path` 的实际取值样本（或直接在真实 codex 后端下跑一轮 guard 判定），才能确认本条在目标运行时是否已实际触发；本轮只验证了两种 transcript 形态的解析差异，未确认目标运行时会落到哪一种。

### CF-02
- 触发条件：`readBriefFromTranscript` 只扫描 transcript **前 8 行**（`lib.mjs:275` `lines.slice(0, 8)`），而父会话（Router）的首条 user 消息落在第 5 行、子会话（worker/verifier）的首条 user 消息落在第 1 行。
- 影响：父会话 transcript 若在 brief 之前堆积了 ≥8 条 system/compaction 条目，`readBriefFromTranscript` 扫不到 brief → 返回 null → guard 放行；worker 侧同理，若 harness 前置消息变多（本次实测 3～5 条 system 块），首条 user 消息一旦被挤出 8 行窗口，scope 立刻失效。窗口是硬编码常量，不随会话长度自适应。
- 复现步骤：1) 在样本上统计首条 user 消息行号：worker/verifier/本成员均为第 1 行，两个父会话为第 5 行；2) 构造一个首条 user 消息位于第 9 行及之后的子会话 transcript（或在 brief 前插入 8 条 system 消息）；3) 跑 `readBriefFromTranscript` → text 为空、返回 null；4) 观察 guard 进入放行分支。
- 证据：`plugin/scripts/lib.mjs:275`（`for (const line of lines.slice(0, 8))`）、`plugin/scripts/guard.mjs:75-76`（解析失败即不建 binding）、`plugin/scripts/guard.mjs:97-102`（无 binding 放行）。真实样本行号：`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 第 1～4 行依次为 `"type":"system","subtype":"compactionSummary"`、`"type":"system","subtype":"plugin_hook_context"`、`"type":"system","subtype":"session_identity_reminder"`、`"type":"assistant"`，第 5 行才是首条 `"type":"user"`；`76a305b5abaaaccf0dc34576325423e7.compatible.jsonl` 同样以 `compactionSummary`（第 1 行）+ `plugin_hook_context`（第 2 行）开头。**注意**这两个是父会话，父会话本就不该被 scope 约束（CF-01 之外的独立问题）；本条的真正风险在于该 8 行窗口对**子会话**同样成立——子会话此刻只靠 1 条 harness 前置消息侥幸入窗。
- 状态：推断
- 修法方向：改为按语义定位（扫描到第一个含 `SCOPE:` 的 user 消息为止），而非固定 `slice(0,8)`；或把 brief 落盘到台账而非每次回读 transcript。
- 还需要什么：需要 codex 运行时下子会话 harness 前置消息条数的实际分布（当前样本仅 1～5 条，全部落在 8 行窗口内），才能判定该硬编码窗口在目标运行时是否已被触顶——本条判为「推断」正是因为缺这份分布数据。

### CF-03
- 触发条件：`dispatch.mjs` 把错题本规则与实战记录包进 `hookSpecificOutput.additionalContext`（`plugin/scripts/dispatch.mjs:134-141`），该 JSON 由 **PreToolUse(task)** hook 产出——作用在**父会话的那次 task 调用**上，不进子会话首条消息。
- 影响：子会话拿不到「上次栽在哪儿」「做成过什么」。除非 Router 读到注入后**手工把内容抄进 brief 的 PRIOR_LESSONS / PRIOR_RECORDS 段**，否则错题本在 worker 侧完全断链；本轮两次派工（`sa-orchestration-audit`、`sa-context-trace`）的 task prompt 中均无 lessons/records 块，证实该转写未发生。
- 复现步骤：1) 打开父会话 transcript `4efc02c8...compatible.jsonl`；2) 定位第 63 行与第 65 行两次 `"type":"tool_use","name":"task"` 调用；3) 读其 `input.prompt` 全文，确认不含 `历史教训`、`实战记录` 段；4) 对比 `dispatch.mjs:121-132` 代码，注入内容应出现在 task 调用前的 hook 输出中。
- 证据：`plugin/scripts/dispatch.mjs:85`（`readLessons(agent)`）、`:89`（`readRecords(agent)`）、`:121-125`（lessons 块文案「派工时必须写进 brief」）、`:126-132`（records 块）、`:134-141`（写出 `additionalContext`）。真实样本：`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 第 65 行 `{"type":"tool_use","id":"call_01a1c0c913b675a7a3a03b96","name":"task","input":{`…其 `prompt` 首段为「你是「上下文注入与传递链路追踪专员」。工作目录：C:\Users\yang2\Documents\MiniMax\mini code的插件\n\n## 开工前必做\n先读 `.superagent/methods/sa-context-trace.md`…」——**无 PRIOR_LESSONS、无 PRIOR_RECORDS 段**。全语料 grep `历史教训（派工时必须写进 brief）` 仅命中 `73f33cbc`（本会话读码回显）、`3909fcb6.codex`、`c29fafdb`、`f73f5500`（均为读 `dispatch.mjs` 源码的回显），**没有任何一个样本的子会话首条 user 消息含该块**。
- 状态：已复现
- 修法方向：把 lessons/records 作为**结构化字段直接注入 task 的 `prompt`**（在 dispatch 阶段改写 prompt 而非仅输出 `additionalContext`），让子会话必然收到；或约定 `additionalContext` 由运行时透传到 task prompt。当前「靠 Router 自觉抄写」的传递方式没有机制保障。
- 还需要什么：需要一次「Router 读到 additionalContext 后主动转写进 brief」的实测派工样本，确认转写路径可行且不会被运行时截断；本轮两次派工均未转写，只证明了「不转写就断链」，尚未证明「转写能通」。

### CF-04
- 触发条件：`gate.mjs:15-17` 的粗筛（INTENT 词表 + SIGNAL + `SCOPE:` 提示）未命中时，`gate.mjs:19-21` 直接 `process.exit(0)` 不输出任何内容。
- 影响：Router 在没有命中特征词的轮次里拿不到「本轮按编排流程处理」的协议注入，只能靠 SessionStart 那一次注入的余温 + skill 里的协议判断。表现为**该轮不该编排时正确静默（设计意图），但漏判时 Router 会完全不知道编排机制存在**——因为 SessionStart 只注入一次（`session-start.mjs:18-55` 全文只输出一次）。
- 复现步骤：1) 读 `gate.mjs:11-22`，确认命中条件与静默分支；2) 构造不含 INTENT 词、不含 SIGNAL 词、无 `SCOPE:` 的 prompt；3) 以该 JSON 作 stdin 跑 `node plugin/scripts/gate.mjs`，观察 stdout 为空、exit 0；4) 对照含 `派工`/`并行` 等词的 prompt，stdout 出现「本轮按编排流程处理」。
- 证据：`plugin/scripts/gate.mjs:11`（INTENT 正则）、`:15-17`（命中判定）、`:19-22`（`if (!hit) { process.exit(0); }`）、`:26`（注入首行文案）。真实样本佐证「命中才注入」：`4efc02c8...compatible.jsonl` 第 2 行的 `plugin_hook_context` 块**只有 SessionStart 的协议**（`本会话已启用 Super-agent 编排机制…`）+ 实战记录摘要，**没有** `本轮按编排流程处理`——说明父会话该轮并未走 gate 注入路径；而 `76a305b5...compatible.jsonl` 第 2 行的同一 hook 块里 `本会话已启用` 出现在偏移 43 处，与 SessionStart 首行文案一致。判定位置：`plugin/scripts/gate.mjs:19-22`。
- 状态：已复现
- 修法方向：保留静默放行（省 token 是对的），但把「编排机制存在」这一事实锚定到不会消失的载体（SessionStart 已做一次），并让后续轮次至少能在需要时按需重读 skill；当前形态下 SessionStart 的注入一旦被长会话压缩掉又无补偿机制。
- 还需要什么：需要 gate.mjs 的 INTENT/SIGNAL 词表与真实 Router 提问语料的对照统计，确认是否存在「本应编排却未命中粗筛」的漏判样本；本轮只验证了「命中才注入」与「未命中静默 exit 0」两个分支的代码路径，未在真实语料上测出漏判。

### CF-05
- 触发条件：子会话首条 user 消息里 `SCOPE:` 行的写法若不是「同一行内逗号分隔」，或 SCOPE 后面跟的是目录而非以 `/` 结尾的目录项，`extractScope`（`lib.mjs:158-181`）会漏收条目。
- 影响：SCOPE 漏收 → guard 的白名单比派工意图窄 → worker 被**误拦**在合法路径之外（写操作严格模式要求精确命中，`lib.mjs:143-145`）；反过来，若 SCOPE 行写成自然语言整句，`isPathLike`（`lib.mjs:88-97`）会整条丢弃，白名单为空 → `guard.mjs:97-102` 直接放行，越界管控对该 worker 完全失效。
- 复现步骤：1) 读 `lib.mjs:158-181` 的块解析逻辑；2) 构造 SCOPE 写成 `SCOPE: docs/audit/context-flow.md`（无逗号、后续换行接第二个路径）的 brief；3) 跑 `extractScope` → 只收第一个路径，第二个丢失；4) 再构造 SCOPE 写成含中文描述的整句 → 返回空数组。
- 证据：`plugin/scripts/lib.mjs:88-97`（`PATH_LIKE` 只收 `[A-Za-z0-9_@~.\\/-]`，含中文即非 path-like）、`:165-179`（行内分隔与块内续行两种模式）、`:169` 与 `:177`（按 `[,，s]+` 切分）。真实样本：`5b26db54f727d72c35ce4cf7ed2a79f7.compatible.jsonl` 第 1 行 `SCOPE: .superagent/worker-probe.txt` 为单行单条，`73f33cbca067dd3d55331579664d091d.compatible.jsonl` 第 1 行 `SCOPE: docs/audit/context-flow.md, plugin/scripts/gate.mjs, plugin/hooks/hooks.json, C:/Users/yang2/AppData/Local/Temp/minimax-plugin-hooks/transcripts/` 为逗号分隔多行——两者均能被 `extractScope` 正确解析（复刻结果：scope 长度 1 与 4）。**未观测到漏收的真实样本**，故判为推断：风险点是格式脆弱（任何 Router 手误都会静默缩窄或清空白名单），而非当前已发生。
- 状态：推断
- 修法方向：派工闸门（`dispatch.mjs:47-52`）已能拒绝「无 SCOPE」的派工，但**不能拒绝「SCOPE 解析后为空/过窄」**——建议在闸门处校验解析结果条目数与 brief 原文的一致性，或在 brief 模板里固化 SCOPE 的单行逗号格式。
- 还需要什么：需要一份 Router 实际写 SCOPE 的语料样本（或一份已固化的 brief 模板规范），才能判定该格式脆弱性在真实使用中是否已被触发；本轮 9 个样本全部解析成功，未观测到任何漏收，故本条判为「推断」。

### CF-06
- 触发条件：`guard.mjs:111-120` 为读操作额外放行 `root + '/.superagent/methods/' + who + '.md'` 与 `root + '/.superagent/lessons/' + who + '.md'`，其中 `who = binding.agent || agentType`；而 `who` 对应的两个文件**并非总是同时存在**——方法论由建员流程落盘，错题本只在成员真正栽过跟头后才产生。
- 影响：该放行**只解决「能不能读到文件」，不解决「内容进不进上下文」**。两条路径的正文都必须由成员主动 read 才会进入上下文；路径来自**运行时注入的 agent system_prompt 与 brief 正文**（如「先读 `.superagent/methods/sa-context-trace.md`」），不是 hook 注入的，所以「成员方法论/错题本路径」这条上下文来源能否到达，取决于成员运行时配置，不在本插件链路内。**本轮据实观察到的事实**：方法论文件 `.superagent/methods/sa-context-trace.md` **存在**（55 行，实读成功），而被派工成员的错题本 `.superagent/lessons/sa-context-trace.md` **不存在**——该成员尚未栽过跟头，本来就没有错题本。由此得出的真实影响是：**「教训前置」这一环在成员侧天然为空**，不是因为链路吞掉了它，而是因为没有内容可传递；本轮派工 brief 里「PRIOR_LESSONS（该成员暂无错题本，本次为空）」正是这一状态的正确呈现。这与 CF-03 是两个独立缺口：CF-03 是「有内容但传不到子会话」的通道断链，本条是「通道两侧都没内容」的空态。
- 复现步骤：1) 读 `guard.mjs:107-120` 确认放行逻辑只放宽路径判定、无注入正文；2) 实读 `.superagent/methods/sa-context-trace.md` → 读成功（55 行，首行 `# sa-context-trace`）；3) 列 `.superagent/lessons/` 目录 → 只有 `_TEMPLATE.md` 与 `sa-orchestration-audit.md`，**无** `sa-context-trace.md`；4) 对照 `.superagent/roster.json` 中 `sa-context-trace` 的 `method` 字段 = `.superagent/methods/sa-context-trace.md`，与磁盘实况一致；5) 观察 guard 侧：即便文件存在，也只是允许读，不自动把正文注入上下文。
- 证据：`plugin/scripts/guard.mjs:107-110`（注释明写「它们住在项目的 .superagent/ 下，通常不在派工 SCOPE 里；不放开这两个读权限，整套机制就断了」）、`:111-120`（仅 `scope.concat` 两路径）。本轮独立复核三处取证：① `read .superagent/methods/sa-context-trace.md` → 成功，`totalLines` = 55；② `glob .superagent/lessons/*` → 仅 `_TEMPLATE.md`、`sa-orchestration-audit.md`，**无** `sa-context-trace.md`；③ `read .superagent/roster.json` → 成员 `sa-context-trace` 的 `method` 字段指向该 methods 文件（存在且与 roster 一致）。**更正说明**：本条此前版本把缺失记在 methods 路径上（报为 ENOENT），属取证误记——methods 文件一直存在，真实缺失的是错题本文件。取证的 transcripts 目录不在本轮 SCOPE 内（grep 被 guard 拦截），故 transcript 侧的三重复核由独立验收完成，本轮依据的是上述工作区直接取证。
- 状态：已复现
- 修法方向：原结论方向（「方法论拿不到 / 方法论缺失应拒绝派工」）作废——方法论一直存在，据此修闸门只会误拒正常派工。新方向指向「**方法论存在、但错题本不存在时，教训前置这一环在成员侧天然为空**」：① 不要把「成员无错题本」记成链路缺陷，那本就是正确状态（还没栽过跟头）；② 机制层应在 brief 里显式区分「该成员无错题本（内容为 0 条）」与「错题本存在但未送达（通道故障）」两种空值，否则 Router 无法判断该补内容还是该修链路；③ 承接 CF-03 的修法方向，让 lessons 以结构化字段直接进入 task prompt 时，空集合要显式标注为「该成员暂无错题本」，而不是静默省略——否则两种空值在下游无法区分。
- 还需要什么：需要一份真实的 `.superagent/lessons/<成员名>.md` 样本（当前仅 `sa-orchestration-audit` 有错题本）配合 `lessons.mjs` 的读取路径实测，才能确认「有错题本时该文件能否被成员读到并进入上下文」；本条当前只确认了「无错题本时该环天然为空」这一半，另一半（有内容时的到达情况）未取证。

### CF-07
- 触发条件：`plugin/hooks/hooks.json` 声明的 5 类 hook（SessionStart / UserPromptSubmit / PreToolUse ×3 matcher / SubagentStop）全部绑定在**父会话 Router 的事件流**上；子会话不触发 SessionStart。
- 影响：子会话**结构性拿不到** SessionStart 的编排协议注入（`session-start.mjs:19-36` 的「本会话已启用 Super-agent 编排机制 / 何时该编排」整块）。这不是缺陷本身（worker 本就不该编排），但它意味着：**唯一能让模型知道「存在编排机制」的那段上下文只有 Router 有**；worker 若被要求「按协议自述」或需要转派，缺少协议原文，只能靠 brief 正文里 Router 转述的片段。
- 复现步骤：1) 在 `hooks.json` 列出全部 hook 事件；2) 对照 9 个 transcript 样本，找出带 `subtype:"plugin_hook_context"` 的会话；3) 观察该 subtype 仅出现在两个**父会话**（`4efc02c8` 第 2 行、`76a305b5` 第 2 行），7 个子会话均无。
- 证据：`plugin/hooks/hooks.json:3-14`（SessionStart→session-start.mjs）、`:15-26`（UserPromptSubmit→gate.mjs）、`:27-72`（PreToolUse：matcher `task`→dispatch.mjs、`write|edit|multiedit|notebookedit|bash`→guard.mjs、`read|glob|grep|list|search`→guard.mjs、`mavis_agent_delete|mavis_agent_update|website_deploy|miniapp|miniapp_publish`→guard.mjs）、`:73-84`（SubagentStop→watchdog.mjs）——**无任何面向子会话的 hook 事件**。真实样本对照：`73f33cbca067dd3d55331579664d091d.compatible.jsonl`（本会话，sa-context-trace）全 77 行类型分布为 `{"user/-":46,"assistant/-":31}`，**无一条 `plugin_hook_context`**；`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 全 89 行分布为 `{"system/compactionSummary":1,"system/plugin_hook_context":1,"system/session_identity_reminder":1,"assistant/-":43,"user/-":43}`。另：`76a305b5...compatible.jsonl` 与 `4efc02c8...compatible.jsonl` 的 `plugin_hook_context` 块只含 SessionStart 文案 + 实战记录摘要，**不含** `本轮按编排流程处理`（gate 产物）——说明两条注入线在父会话也是彼此独立、时机不同的两条路径。
- 状态：已复现
- 修法方向：这是设计边界而非 bug，但应在机制文档里显式写明「子会话不注入 SessionStart 协议」，避免 Router 误以为 worker 已知协议；若 worker 需要知道协议，应由 brief 显式携带协议要点，而不是依赖 hook。
- 还需要什么：需要一个「worker 确实需要转派或自述协议」的真实场景 transcript，以验证 brief 未携带协议要点时 worker 的实际表现；本轮 7 个子会话样本均未触发该场景，无法判断这条边界在实战中会造成实际损失还是仅停留在纸面。

### CF-08
- 触发条件：`gate.mjs` 与 `dispatch.mjs` 各自独立解析「实战记录」：前者走 `records.mjs:38-54` 的 `summarizeRecords(3, 6)`（按 roster 顺序取前 6 名成员、每人最近 3 条），后者走 `dispatch.mjs:89` 的 `readRecords(agent).slice(-3).reverse()`（按目标成员取 3 条）。
- 影响：同一份「实战记录」在两个环节得到**两套不同集合**：Router 在 SessionStart/gate 阶段看到的是「谁的记录最多就排前面」的横切摘要，而真正派工给某个成员时用的是该成员自己的 3 条。Router 做匹配时看到的清单与最终注入 worker 的清单不同源，匹配结论可能与实际派工内容不一致。另外 `summarizeRecords` 按 roster 数组顺序取前 6 名后 `break`，**排在 roster 后面的成员其记录永远不出现在 Router 的匹配参考里**——这是结构性不可见，不是概率问题。
- 复现步骤：1) 读 `records.mjs:38-54` 与 `dispatch.mjs:89` 两处取数逻辑；2) 对照 `roster.json` 的成员顺序与实际有记录的成员；3) 确认排在第 7 位及之后的成员，其记录不会进入 `summarizeRecords` 结果；4) 确认 gate 注入的摘要条数（每成员 3 条、上限 6 成员）与 dispatch 注入的条数（目标成员 3 条）集合不同。
- 证据：`plugin/scripts/records.mjs:41-52`（`for (const m of roster.members)` … `if (out.length >= maxMembers) break;`，且 `out.push` 只在 `recs.length` 非零时执行——**无记录的成员不占名额，有记录的成员才占**，故被截断的是「有记录但排位靠后」的成员）、`plugin/scripts/gate.mjs:42`（`summarizeRecords(3, 6)`）、`plugin/scripts/dispatch.mjs:89`（`readRecords(agent).slice(-3).reverse()`）。真实样本佐证两条注入线互不重叠：`4efc02c8...compatible.jsonl` 第 2 行 `plugin_hook_context` 块尾部的实战记录摘要只列出 `sa-plugin-release` 一个成员，其条目为「2026-11-09 · 插件包版本发布 · 把插件包升到 v0.4.0 并补齐发布说明 —— 先核对 manifest 与 hooks.json 引用的脚本是否都存在…」；而同一会话第 63/65 行两次 task 派工的目标是 `sa-orchestration-audit` 与 `sa-context-trace`——**两者都未出现在 Router 看到的那份匹配参考里**。
- 状态：已复现
- 修法方向：让 Router 侧的匹配参考与派工侧的注入共用同一取数口径（例如都按目标成员过滤，或让 Router 参考覆盖全部有记录成员而非前 6 名）；否则「谁做成过什么」这条上下文在匹配阶段是残缺的。
- 还需要什么：需要一份「有实战记录但在 roster 中排位靠后」的成员样本（当前只有 `sa-plugin-release` 一人有记录），才能实测第 7 位之后成员的记录被截断的实际后果；并需要一次「Router 依据匹配参考选中某成员」的实测派工，以核对匹配结论与最终注入内容是否真的不一致。

---

## 四、真实 transcript 原文摘录（事实，非转述）

### 摘录 1 —— 子会话首条 user 消息确实带派工原文与 SCOPE 行
文件：`C:/Users/yang2/AppData/Local/Temp/minimax-plugin-hooks/transcripts/5b26db54f727d72c35ce4cf7ed2a79f7.compatible.jsonl`，第 1 行（`"type":"user"`）。原文片段（节选，`<agent-context>` 段之后）：

```
这是一次机械探针任务，不要做任何额外发挥。

目标：把指定字符串写入一个文件，然后报告成功。

步骤：
1. 用 write 工具创建文件 `.superagent/worker-probe.txt`
2. 文件内容就一行：WORKER_PROBE_OK
3. 写入后用 read 工具读回该文件确认内容
4. 回报时只写一句话：已写入 .superagent/worker-probe.txt，内容为 WORKER_PROBE_OK

不要读写任何其他路径，不要执行任何 bash 命令，不要修改任何其它文件。

SCOPE: .superagent/worker-probe.txt

ACCEPT:
- [ ] .superagent/worker-probe.txt 存在
- [ ] 其内容包含 WORKER_PROBE_OK

EVIDENCE:
- read 回读的文件内容
```

同一条消息的 `<agent-context>` 段含：`PARENT SESSION: mvs_9bdda202ae274c909a5b4352fc45a471`、`agentName: worker`。→ 派工 brief、SCOPE 行、父会话标记、成员名四项齐全，**这是本链路唯一被完整验证到达子会话的上下文**。

### 摘录 2 —— codex 变体格式不符，brief 解析不出
文件：`…/5b26db54f727d72c35ce4cf7ed2a79f7.codex.jsonl`，第 2 行原文：

```
{"timestamp":"2026-11-09T12:31:29.049Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"PTC is enabled for this turn. Use run_code with await tools.<name>(args) for eligible ordinary tools and explicitly return a JSON result. Keep the visible control tools as direct calls. Do not call run_code from inside run_code. These tools are only callable inside run_code in this turn: read, bash, grep, glob, web_fetch, web_search, task_query, task_output, task_stop.\n\n<system-reminder>\nUse `tool_search` to discover permitted on-demand tools …
```

顶层 `type` = `response_item`（非 `user`）、`part.type` = `input_text`（非 `text`）→ `lib.mjs:276-288` 的两道判断同时落空。

### 摘录 3 —— SessionStart 协议只注入父会话
文件：`…/4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl`，第 2 行原文（节选）：

```
{"uuid":"projection-1-383962c6cbd445de","parentUuid":"projection-0-da5c511e0dd4e81e","sessionId":"mvs_9bdda202ae274c909a5b4352fc45a471","timestamp":"2026-11-09T14:34:22.896Z","type":"system","subtype":"plugin_hook_context","message":{"role":"user","content":[{"type":"text","text":"<plugin-hook-context>\n[super-agent-router] 本会话已启用 Super-agent 编排机制。\n\n当用户的需求满足下列任一条时，主动走编排流程，不要只做单点执行：\n- 需要同时做多件不同性质的事（如实现 + 验证、取数 + 成稿）\n- 某个任务有明确的方法论要求，需要做到「精」而不是「能」\n- 用户说「拆」「分工」「并行」「谁来做」「组队」「复盘」「验收」\n\n开始方式：\n1. 读 .superagent/roster.json（专项名录，路由的唯一依据）…
```

同一条记录尾部还接实战记录摘要：`【当前专项成员的实战记录（匹配参考）】- sa-plugin-release（owns：…）：· 2026-11-09 · 插件包版本发布 · 把插件包升到 v0.4.0 并补齐发布说明 —— …`。

对照：本会话（`73f33cbca067dd3d55331579664d091d.compatible.jsonl`，sa-context-trace）全 77 行无任何 `plugin_hook_context` 记录。

### 摘录 4 —— 父会话的 task 调用 prompt 里没有 lessons/records 段
文件：`…/4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl`，第 65 行原文（节选）：

```
{"uuid":"projection-64-8e07ce22d584257f","parentUuid":"projection-63-1dafc1180e4520f6","sessionId":"mvs_9bdda202ae274c909a5b4352fc45a471","timestamp":"2026-11-09T14:49:24.457Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"{\"type\":\"thinking\",\"thinking\":\"Tr…
```

该 `tool_use` 的 `name` 为 `task`、`input.agent_name` 为 `sa-context-trace`、`input.prompt` 首段为：

```
你是「上下文注入与传递链路追踪专员」。工作目录：C:\Users\yang2\Documents\MiniMax\mini code的插件

## 开工前必做
先读 `.superagent/methods/sa-context-trace.md`，严格按其中的「方法」执行；完成前逐条核对同文件的「验收清单」。
```

→ prompt 中**没有** `PRIOR_LESSONS`、**没有** `PRIOR_RECORDS` 段，尽管 `dispatch.mjs:121-132` 在同一时刻向父会话输出了这两块。

---

## 五、验证方法与判定位置索引

| 结论 | 判定位置 | 验证手段 |
|---|---|---|
| codex 变体解析不出 brief | `plugin/scripts/lib.mjs:276-288` | 逐字复刻解析函数跑真实 codex 样本，text 长度 0 |
| lessons/records 不进子会话 | `plugin/scripts/dispatch.mjs:121-141` | 检视父会话两次 task 调用的 `input.prompt` 全文 + 7 个子会话首条 user 消息标记扫描 |
| gate 未命中即静默 | `plugin/scripts/gate.mjs:15-22` | 代码路径 + 父会话 hook 块内容对照 |
| SCOPE 解析脆弱 | `plugin/scripts/lib.mjs:88-97, 158-181` | 复刻 `extractScope` 跑 9 个真实 brief，全部解析成功（故判推断） |
| 方法论正文不进上下文 / 成员无错题本 | `plugin/scripts/guard.mjs:107-120` | 实读 `.superagent/methods/sa-context-trace.md` → **存在**（55 行）；列 `.superagent/lessons/` → **无** `sa-context-trace.md` |
| SessionStart 只到父会话 | `plugin/hooks/hooks.json:3-84` | 9 样本按 `type/subtype` 统计 `plugin_hook_context` 分布 |
| 两套实战记录取数口径不一致 | `plugin/scripts/records.mjs:41-52` + `gate.mjs:42` + `dispatch.mjs:89` | 对照 hook 块内成员清单与 task 调用目标成员 |

**取证过程中的两点说明（避免把噪声当事实）**：
1. 全语料 grep `历史教训（派工时必须写进 brief）` / `该成员此前验收通过的成果` 的多数命中是成员**读取 `dispatch.mjs` 源码后的回显**（出现在 `tool_result` 内），不是注入块。本清单已逐条区分，未把回显计为注入。
2. `bash` 通道执行内联脚本会被 `guard.mjs:137` 的路径扫描器拦下（`fs.readdirS`、`o.type` 等含点 token 被判为路径而不在白名单）——这本身是 guard 的既有行为，本单未改动任何脚本；最终取证改用 `read` + JS 解析完成。
