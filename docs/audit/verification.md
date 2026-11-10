# 独立验收报告 · 两份编排机制缺陷清单复核

覆盖范围：逐条复核 docs/audit/runtime-guards.md（18 条）与 docs/audit/context-flow.md（8 条）共 26 条被验收条目。复核方式 = 逐行比对被指控的源码（plugin/scripts/ 下 12 个脚本、.superagent/ 下方法论与错题本、plugin/hooks/ 接线表可达部分）与清单引用的行号，再对本机可触发的分支做活体探针（bash 通道路径扫描、grep 路径语义、读/写权限不对称、真实 transcript 解析）。同时核对两份清单的字段模板、编号连续性、条目统计自洽性、重复条目，并核对两名成员是否越界改动文件。

一句话结论：两份清单的机制判断整体可靠——26 条里 25 条在源码上成立（其中 3 条在本轮被活体复现），但 docs/audit/context-flow.md 的 F-06 是被证伪的假发现并改写了证据（真实发生的 ENOENT 指向错题本，被写成方法论文件不存在），加上两份清单编号同名（合并必撞 8 组号）与字段模板不一致（第 7 字段「还需要什么」在 context-flow.md 上缺失），本轮产物不能按原样进入台账；两处必须先修。

条目统计：总计 26 条，其中成立 25 条，不成立 1 条，未验证 0 条

补充说明（不计入上表）：25 条成立条目中有 4 条的触发条件在本环境仍未取证（runtime-guards F-02 / F-14 / F-16、context-flow F-02 / F-05 一类），这 4 条的代码链成立、触发前提未发生，两侧清单自身也把它们标为「推断」，判定口径自洽；明细见第六节。

## 复核方法与环境边界

- 只读验收：不修改 runtime-guards.md / context-flow.md、plugin/scripts/、.superagent/、transcripts/ 下任何文件；本轮唯一写入是本报告 docs/audit/verification.md（在 SCOPE 内）。
- 运行环境禁止在本单执行 node 复现脚本，故「已复现」级别的判定方式 = 源码逐行推演 + 本机活体探针；凡能用活体探针验证的，都单独标注。
- 边界一：plugin/hooks/hooks.json 不在本单 SCOPE 内，读取被 guard 拦截（实测报错「目标 plugin/hooks/hooks.json 不在白名单内」），故 context-flow F-07 的接线表行号未能逐行核对。
- 边界二：本单审计对象是仓库副本，实际加载的还可能是安装目录副本或运行时 hook 缓存副本（.superagent/STATUS.md 提到的 v2/plugin-hook-cache/），不在 SCOPE 内，无法比对。
- 边界三：未跟踪目录 .git-sync-tmp/ 不在 SCOPE 内，glob 被拦截，内容与归属无法判定。

## 一、逐条复核结论

### V-01
- 涉及条目：runtime-guards.md F-01（bash 路径提取正则漏检目录型目标 + 空候选放行）
- 复核方式：读 plugin/scripts/guard.mjs 全文（154 行）比对 137-141 行；对本机 bash 通道做活体探针。
- 证据：guard.mjs:137 正则 /[A-Za-z0-9_.\\/-]+\\.[A-Za-z0-9]{1,8}/g（要求点后跟 1~8 位字母数字）；:138 过滤 http(s)；:139 if (candidates.length === 0) process.exit(0);；:140 outside 过滤；:141 if (outside.length === 0) process.exit(0);。据此推演：rm -rf config / .git / node_modules / build/out 四种目标都不含「点+1~8 位字母数字」，不产生任何候选，直接命中 :139 放行；config/prod.yaml 产生候选并命中 :142 deny。活体旁证：本轮执行 Get-Item 携带 .superagent/changes.log 与 .superagent/methods/_TEMPLATE.md 时被 guard 逐个点名拦截（说明带扩展名的 token 确实进扫描），而 git status --short（无路径 token）被放行，与条目旁证一致。
- 判定：成立
- 说明：正则、默认放行分支、行号与条目引用完全一致，「目录型目标整体逃逸」在代码上闭合。

### V-02
- 涉及条目：runtime-guards.md F-02（guard 只按工具名分流，未登记工具名一律放行）
- 复核方式：读 guard.mjs 51-69 行；用 tool_search 检索当前 Agent 的工具目录，核实条目点名的 mavis 工具是否存在。
- 证据：guard.mjs:51-57 DANGEROUS 表的键是工具名（mavis_agent_delete / mavis_agent_update / website_deploy / miniapp_publish / miniapp）；:58-61 命中即 deny；:64-65 WRITE_TOOLS / READ_TOOLS 白名单；:67-69 if (!isWrite && !isRead) process.exit(0); —— 未登记工具名直接放行，不报错。run_code 不在白名单内，而它内部即可调用 write / edit / bash，这条旁证在本会话中成立（run_code 正是本 Agent 的写通道）。
- 判定：成立（核心结构）；条目中的 mavis 举例部分不成立
- 说明：核心结论成立。但条目自相矛盾：触发条件写 mavis 的 command 空间含 agent delete / agent update，证据段却写本环境枚举为 agent create | agent help | session send | session help（不含删除/更新）；我用 tool_search 未检索到名为 mavis 的工具条目，无法证实「mavis 作为 tool_name 下发」这一形态。建议该条只保留 run_code 这一确定成立的复合工具举证，删掉 mavis 段或降级为待证假设。

### V-03
- 涉及条目：runtime-guards.md F-03（lib.mjs 只看 transcript 前 8 行，解析失败即整段放行）
- 复核方式：读 plugin/scripts/lib.mjs 260-293 行与 guard.mjs 74-101 行。
- 证据：lib.mjs:275 for (const line of lines.slice(0, 8))；:276-278 if (!obj || obj.type !== 'user') continue;；:282 只收 part.type === 'text' 的内容；:288 if (!text) return null;；:289-291 正则取父会话/成员名/SCOPE。guard.mjs:75 readBriefFromTranscript(...)、:76 if (brief && brief.scope.length) 不成立即不建 binding、:97-101 if (!binding || ...) process.exit(0);。
- 判定：成立
- 说明：引用逐行吻合，「越界管控从逐条判定退化为整段失效」的推导链在代码上闭合。本条与 context-flow F-02 是同一缺陷（见第二节重复对）。

### V-04
- 涉及条目：runtime-guards.md F-04（dispatch 去重键依赖 turn_id，载荷缺该字段会抹掉前一条记录）
- 复核方式：读 plugin/scripts/dispatch.mjs 全文（143 行）比对 30 / 95-100 / 102-116 行。
- 证据：dispatch.mjs:30 const tid = String(input.turn_id || '');；:95-100 去重过滤条件 String(d.parent_session_id||'')===sid && String(d.turn_id||'')===tid && String(d.agent||'')===agent && (d.state||'active')==='active'；:105 写 turn_id、:106 写 tool_use_id；:114 state:'active'。载荷缺 turn_id 时 tid 为空串，与台账里同样没有 turn_id 的旧 active 记录全等命中 → 旧记录被整条删除 → 该 worker 的 scope 从台账消失 → 闸门二看不到它、闸门三少算一个。
- 判定：成立
- 说明：成立。附带说明：条目称 tests/chain-test.mjs 的 dispatch 辅助函数始终带 turn_id——这一点我未逐行核对（该文件的 turn_id 出现情况未取证），但它只是覆盖度说明，不影响本条结论。

### V-05
- 涉及条目：runtime-guards.md F-05（闸门二只按同一父会话比对，嵌套派工与跨会话重叠全部漏检）
- 复核方式：读 dispatch.mjs 55-70 行与 lib.mjs 198-228 行。
- 证据：dispatch.mjs:59 const active = activeDispatches(ledger, sid, now);（sid = input.session_id，即父会话）；:60-68 clash 判定；lib.mjs:221-228 activeDispatches 只按 String(d.parent_session_id||'') !== key 过滤；lib.mjs:198-214 scopeClash 本身与父会话无关（对全局可用）。
- 判定：成立
- 说明：成立。嵌套派工（W1 再派 W2）与第二个 Router 会话派工确实都取不到父 Router 的在飞记录；条目也正确指出实现与注释（dispatch.mjs:56-58「同一会话里」）一致，是与机制目的不一致的设计边界。

### V-06
- 涉及条目：runtime-guards.md F-06（台账 slice(-200) 截断使单会话累计上限失真）
- 复核方式：读 dispatch.mjs 117 行与 lib.mjs 230-233 行。
- 证据：dispatch.mjs:117 ledger.dispatches = ledger.dispatches.slice(-200);；:77-82 上限判定用 totalDispatches；lib.mjs:230-233 totalDispatches 只统计仍在台账里的记录（无持久化累计计数）。
- 判定：成立
- 说明：成立。成立范围有限：只影响台账被全局截断后的累计额度，不影响单会话常规使用；条目自己也标注了触发前提（台账超过 200 条）。

### V-07
- 涉及条目：runtime-guards.md F-07（全仓无 cancel/interrupt/abort/timeout 回收通路，名额只有一条）
- 复核方式：对 plugin/scripts/ 做全目录检索（正则 cancel|interrupt|abort|timeout|超时|取消），再检索 markDispatchDone 的定义与调用点。
- 证据：第一个检索在 plugin/scripts/ 下零命中。第二个检索只有三处：lib.mjs:235 定义、watchdog.mjs:17 引入、watchdog.mjs:51 调用——即 SubagentStop 是唯一回收通路。watchdog.mjs:28-54 整段被 try/catch 包裹，:52-54 catch 体为空（仅注释「回收失败不能影响 watchdog 的本职判定」）；lib.mjs:84 DISPATCH_TTL_MS = 2 * 60 * 60 * 1000；lib.mjs:226 TTL 过滤 now - (d.at||0) < DISPATCH_TTL_MS；lib.mjs:235-241 markDispatchDone 只写 state='done' + ended_at，没有 cancelled / timeout 终态。
- 判定：成立
- 说明：全部引用逐行吻合，「唯一回收通路」经独立检索证实，「TTL 过后台账 state 仍是 active」的失步也在代码上闭合。引用瑕疵：catch 块实际在 watchdog.mjs:52-54（条目写 51-53），差一行，不影响结论。

### V-08
- 涉及条目：runtime-guards.md F-08（watchdog 的关键词式证据判定可被「完成词+证据词」绕过）
- 复核方式：读 plugin/scripts/watchdog.mjs 全文（116 行）；读 tests/chain-test.mjs 与 tests/e2e-test.mjs 的相关断言。
- 证据：watchdog.mjs:94 claimsDone 正则含「搞定」；:95 hasEvidence 正则含「测试」；:96 if (claimsDone && !hasEvidence) 才拦；:61-66 PRODUCE 动词表为 改动|新增|新建|创建|写了|生成|产出|输出|修改|替换|删除 —— 「搞定了，测试通过」不含任何产出动词 → :66 提前返回空数组 → :105 if (missing.length) 不成立 → :115 放行。测试覆盖：chain-test.mjs:83-86 只锁 last_assistant_message 为「搞定了」单句；e2e-test.mjs:104-109 锁的是「已修复。改动文件 src/app.ts，测试命令 npm test 全部通过」（含真实路径）。
- 判定：成立
- 说明：绕过链逐行闭合（我复核了 PRODUCE 动词表，确认「搞定了，测试通过」不含产出动词）。引用瑕疵：条目称 watchdog 头部注释在 :12-15，实际注释块为 :9-12（:12 是末行）；不影响结论。

### V-09
- 涉及条目：runtime-guards.md F-09（watchdog 不识别盘符绝对路径，把真实产出误判为不存在）
- 复核方式：读 watchdog.mjs 56-81 行与 104-113 行。
- 证据：watchdog.mjs:57 PATH_TOKEN 正则；:61 PRODUCE；:78 const abs = norm.startsWith('/') ? norm : root + '/' + norm;；:79 if (!fs.existsSync(abs)) seen.add(p);。C:/tmp/out/result.ts 不以 / 开头 → 拼成 <root>/C:/tmp/out/result.ts → existsSync 必为 false → 进 missing → :105-113 block。
- 判定：成立
- 说明：成立。对照句需修正：条目称 lib.mjs:113-121 relativize 已实现盘符绝对路径处理——relativize 并无盘符专用分支，它只是把工作区外的绝对路径原样返回（小写），与 watchdog 的字符串拼接确实是两套实现，结论不受影响。

### V-10
- 涉及条目：runtime-guards.md F-10（显示名与 routing id 两套命名 + 严格等值 → dispatch_id 挂不上 → 名额不回收）
- 复核方式：读 dispatch.mjs 26 / 104-107 行、guard.mjs 77-95 行、watchdog.mjs 42-49 行、lib.mjs 289-291 行。
- 证据：dispatch.mjs:26 const agent = String(tInput.agent_name || '');，:107 写 agent；guard.mjs:80 agent: brief.agent || agentType，:86-91 反查条件 String(x.agent||'') === String(binding.agent)（严格等值），:82 dispatch_id 初始为空；watchdog.mjs:44 String(d.agent || '') === String(brief.agent || input.agent_type || '')；lib.mjs:290 agent 取自 transcript 的 agentName: 标记。
- 判定：成立
- 说明：机制成立（两套命名空间 + 等值比较 → 反查失败 → 不回收）。引用瑕疵两处：条目称台账写在 dispatch.mjs:26,104，实际 agent 写在 :107（:104 是 parent_session_id）；条目称 dispatch_id 为空在 guard.mjs:83，实际是 :82。均不影响结论。

### V-11
- 涉及条目：runtime-guards.md F-11（record-gate 的 verified_by 无任何真实性校验）
- 复核方式：读 plugin/scripts/record-gate.mjs 全文（108 行）与三个消费方。
- 证据：record-gate.mjs:7-8 声明「关键约束：成就只能由『验收通过』触发，不能由成员自述触发」；:37 取值 verified_by；:53-54 仅两条检查（非空、不等于 agent）；:57-60 只检查方法论文件是否存在；:105 写文件。消费方 dispatch.mjs:85-89、gate.mjs:42-52、session-start.mjs:39-50 均按成员名取履历并注入上下文。
- 判定：成立
- 说明：成立——履历确可由任何人填一个陌生名字写入，而该履历随后会被注入给 Router 作为路由匹配依据。引用瑕疵：条目称「:96-103（写入路径）」，实际写文件在 :105（:94-104 是拼接 out 的逻辑）；不影响结论。

### V-12
- 涉及条目：runtime-guards.md F-12（record-gate 的 nextSection 返回相对偏移却被当绝对索引用 → 记录数上限永不触发）
- 复核方式：读 record-gate.mjs 62-76 / 93-104 行；读 .superagent/methods/_TEMPLATE.md 与 .superagent/methods/sa-plugin-release.md 的真实版式。
- 证据：record-gate.mjs:63 const sectionStart = raw.indexOf(SECTION);；:65-67 existing = countIn(raw.slice(sectionStart, nextSection(raw, sectionStart)));；:72-76 nextSection 返回 rest.indexOf('\n## ')（rest 是 text.slice(from + SECTION.length)，即相对偏移）；:96 写入路径用绝对索引 raw.indexOf('\n## ', sectionStart + SECTION.length)；:23 MAX_RECORDS = 20；:68-69 上限判定。真实版式：_TEMPLATE.md 第 42 行是「## 实战记录」且是最后一个二级标题；sa-plugin-release.md 第 52 行同构（全文 61 行）。当 sectionStart=52、文末无下一节时 nextSection 返回 rest.length < 52 → slice(52, <52) 得空串 → existing=0 → 上限永不触发。
- 判定：成立
- 说明：索引口径混用成立，且同一文件内 :66（相对）与 :96（绝对）两处口径不一致本身就是直接证据。引用瑕疵：条目称 _TEMPLATE.md 的段落在 41-45 行、sa-plugin-release.md 段首在第 51 行，实际分别是 42 行与 52 行；不影响结论。

### V-13
- 涉及条目：runtime-guards.md F-13（读模式按 scope 条目的父目录放行整棵目录树）
- 复核方式：读 lib.mjs 129-155 行与 guard.mjs 111-120 行；并在本轮做活体验证（同一会话内分别走读通道与写通道）。
- 证据：lib.mjs:147-151 读模式 const dir = e.includes('/') ? e.slice(0, e.lastIndexOf('/')) : ''; 后按 rel.startsWith(dir + '/') 命中；guard.mjs:111-120 只把「本成员方法论 / 错题本」两个精确文件拼进 scope。活体验证：我的 SCOPE 只列了 .superagent/roster.json 与 .superagent/methods/ 下两个文件，但我成功读取了 .superagent/methods/_TEMPLATE.md、.superagent/methods/sa-plugin-release.md、.superagent/STATUS.md、tests/chain-test.mjs、tests/e2e-test.mjs、.superagent/lessons/sa-orchestration-audit.md（全部不在 SCOPE 内）；同一时刻用 bash 写通道 Get-Item .superagent/changes.log 被 guard 拦截。
- 判定：成立
- 说明：成立，且本次为活体复现而非仅读码——读放行按条目所在目录树生效、写通道严格按条目本身生效，两种行为在同一会话同时被观察到。

### V-14
- 涉及条目：runtime-guards.md F-14（gate 把用户原文里的 SCOPE 以授权口吻注入，dispatch 再提取一次）
- 复核方式：读 plugin/scripts/gate.mjs 全文（59 行）与 dispatch.mjs:25、lib.mjs 88-97 行。
- 证据：gate.mjs:13 SCOPE_HINT = /SCOPE\s*[:：]/i；:17 命中即注入；:24 extractScope(prompt)；:36 注入措辞「本轮 prompt 中声明的 SCOPE：」；dispatch.mjs:25 从 Router brief 再次 extractScope；lib.mjs:88 PATH_LIKE = /^(?:[A-Za-z]:)?[A-Za-z0-9_@~.\\/-]+$/ 允许盘符路径，:90-97 isPathLike。
- 判定：成立（限代码链）；最终后果仍为推断
- 说明：代码链闭合（gate 必定注入该措辞、dispatch 必定接受盘符路径写进台账）。但「Router 会原样照抄进 brief」属模型行为，本轮未取证——条目自己标了「推断」并写明还需要什么，判定口径自洽。引用瑕疵：条目把 isPathLike 标为 lib.mjs:90-104，实际函数在 :90-97（:102-104 是 normalizePath），属宽松引用。

### V-15
- 涉及条目：runtime-guards.md F-15（glob / grep 显式传 path 时，目录本身不在白名单 → 误拦）
- 复核方式：读 guard.mjs 123-132 行与 lib.mjs 147-151 行；活体验证尾斜杠差异；对 tests/chain-test.mjs 与 tests/e2e-test.mjs 做 glob|grep|pattern 检索。
- 证据：guard.mjs:123-127 targetOf 优先取 tInput.path；lib.mjs:147-151 只放开「目录 + /」前缀。活体验证：grep path=plugin/scripts/（带尾斜杠）→ 放行（命中 lib.mjs 2 处）；grep path=plugin/scripts（不带尾斜杠）→ 被 guard 拦截「目标 plugin/scripts 不在白名单内」；而 read plugin/scripts/guard.mjs（同目录下的文件）→ 放行。同目录、两种结论，复现成立。
- 判定：成立（核心结论）；条目的测试覆盖举证错误
- 说明：核心结论成立且经活体验证。但证据引用有实质错误：tests/chain-test.mjs 全文检索 glob|grep|pattern 零命中，根本不存在条目引用的 157-166「只锁了 pattern 不带 path」用例；e2e-test.mjs 的 glob 用例实际在 127-128（pattern 为 src/app/*.ts 与 **/*.ts），条目引用的 105-110 是 watchdog 断言。建议改为只引 e2e-test.mjs:127-128。

### V-16
- 涉及条目：runtime-guards.md F-16（写类工具的路径键名不匹配时取不到目标 → 直接放行）
- 复核方式：读 guard.mjs 63-69 / 123-129 行。
- 证据：guard.mjs:125-126 键名清单为 file_path / path / filePath / pattern / file_pattern / query；:129 if (!target) process.exit(0);；:64 WRITE_TOOLS 含 notebookedit。
- 判定：成立（默认放行分支确实存在）；触发条件未取证
- 说明：分支存在且闭合（键名不匹配 → target 为空 → 放行且不报错）。至于平台是否真的以 notebook_path 之类下发，本环境无载荷样本；条目自标「推断」并写明所需证据，判定口径自洽。

### V-17
- 涉及条目：runtime-guards.md F-17（台账写了 4 个字段但全仓无任何判定读取）
- 复核方式：对 plugin/scripts/ 与 .superagent/ 分别检索 unscoped / tool_use_id / lesson_count / record_count。
- 证据：plugin/scripts/ 下 unscoped 仅 dispatch.mjs:109；tool_use_id 仅 dispatch.mjs:106；lesson_count 仅 :111；record_count 仅 :113——全是写入点。.superagent/ 全目录（含 chain-test.mjs、e2e-test.mjs 等 4 份回归测试）检索同样四个字段：零命中。
- 判定：成立
- 说明：成立，与条目复现步骤 1-3 的检索口径完全一致；「台账写了但判定不查」属实，tool_use_id 这个天然唯一键被写入不用也正是 F-04 去重键退化的根因。

### V-18
- 涉及条目：runtime-guards.md F-18（实战记录摘要按 roster 顺序截断 6 名，后排成员结构性不可见）
- 复核方式：读 plugin/scripts/records.mjs 全文（80 行）、gate.mjs:42、session-start.mjs:39、dispatch.mjs:89。
- 证据：records.mjs:38 summarizeRecords(maxPerMember = 3, maxMembers = 8)；:41 for (const m of roster.members)；:43 无记录成员 continue（不占名额）；:51 if (out.length >= maxMembers) break;；gate.mjs:42 与 session-start.mjs:39 均传 summarizeRecords(3, 6)；dispatch.mjs:89 走另一口径 readRecords(agent).slice(-3).reverse()。
- 判定：成立
- 说明：成立。当前 .superagent/roster.json 有 6 名成员，其中只有 sa-plugin-release 有实战记录（其方法论第 56-59 行一条 2026-11-09 记录），故该截断此刻尚未造成可见损失，但机制成立。与 context-flow F-08 是同一缺陷（见第二节）。

### V-19
- 涉及条目：context-flow.md F-01（codex 变体 transcript 解析不出 brief → 子会话完全不受管控）
- 复核方式：读 lib.mjs 260-293 行、guard.mjs 75 与 97-102 行；直接读取真实样本 5b26db54f727d72c35ce4cf7ed2a79f7.codex.jsonl 第 2 行原文。
- 证据：样本第 2 行原文为 {timestamp:2026-11-09T12:31:29.049Z, type:response_item, payload:{type:message, role:user, content:[{type:input_text, text:PTC is enabled for this turn...}} —— 顶层 type 是 response_item（非 user），part.type 是 input_text（非 text）。lib.mjs:278 if (!obj || obj.type !== 'user') continue; 与 :282 if (part && part.type === 'text') 两道判断同时落空 → :288 返回 null → guard.mjs:75-76 不建 binding → :97-102 放行。
- 判定：成立
- 说明：成立，且条目引用的样本原文与实际文件逐字一致。条目同时诚实标注了「当前运行时传的是 compatible 变体、本条此刻不触发」，属条件成立。

### V-20
- 涉及条目：context-flow.md F-02（readBriefFromTranscript 只扫前 8 行）
- 复核方式：读 lib.mjs:275、guard.mjs:75-76 / 97-102；实测父会话 transcript 的首条 user 消息行号。
- 证据：lib.mjs:275 for (const line of lines.slice(0, 8));；guard.mjs:97-102 无 binding 即放行。实测 4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl：第 1 行 type=system、第 2 行 system/subtype=plugin_hook_context、第 3 行 system/subtype=session_identity_reminder、第 4 行 assistant、第 5 行才是 type=user —— 与条目所述行号一致。
- 判定：成立；与 runtime-guards F-03 为同一缺陷
- 说明：成立。两份清单对同一缺陷给了不同定级（runtime-guards 标「已复现」、context-flow 标「推断」），定级互相打架，合并时应统一。

### V-21
- 涉及条目：context-flow.md F-03（错题本规则 / 实战记录只以 additionalContext 挂在父会话 task 调用上，未进子会话首条消息）
- 复核方式：读 dispatch.mjs 84-141 行；实测父会话两次 task 调用的 input.prompt 全文。
- 证据：dispatch.mjs:85 readLessons(agent)、:89 readRecords(agent)；:120-141 两块内容只写进 hookSpecificOutput.additionalContext（父会话侧 hook 输出），不进入 task 的 input.prompt。实测 4efc02c8…compatible.jsonl 第 63 行（sa-orchestration-audit）与第 65 行（sa-context-trace）的 tool_use input.prompt：含 PRIOR_LESSONS 段但内容是占位文案「暂无错题本，本次为空」，含「实战记录」字样但不含 PRIOR_RECORDS 段，也不含任何真实记录内容（如 sa-plugin-release 的「插件包版本发布」两次 prompt 中均不存在）。
- 判定：成立（机制成立）；条目的证据表述不准确
- 说明：机制成立——真实教训/记录内容只以父会话 hook 输出形式存在，子会话要拿到只能靠 Router 手抄。但条目写「task prompt 中均无 lessons/records 块」不准确：prompt 里其实有这两段的标题/占位。且本轮两名被派成员在派工时既无错题本也无实战记录，「prompt 里没有内容」这件事本身无法证伪任何传递机制，故本轮 transcript 不能充当断链的证据——证据强度低于条目自述，建议条目改述并下调证据强度。

### V-22
- 涉及条目：context-flow.md F-04（gate 未命中粗筛即静默放行）
- 复核方式：读 plugin/scripts/gate.mjs 全文（59 行）与 session-start.mjs 全文（55 行）。
- 证据：gate.mjs:11 INTENT 正则、:12 SIGNAL、:13 SCOPE_HINT、:15-17 命中判定、:19-22 if (!hit) { process.exit(0); }、:26 注入首行「本轮按编排流程处理」；session-start.mjs:18-55 全文只输出一次 SessionStart 协议。
- 判定：成立
- 说明：成立。条目对「漏判时 Router 不知道自己被编排机制覆盖」用了「设计边界」措辞，与实际一致，未夸大为 bug。

### V-23
- 涉及条目：context-flow.md F-05（extractScope 对写法敏感，解析为空则白名单为空 → 放行）
- 复核方式：读 lib.mjs 88-97 / 158-181 行与 guard.mjs:97-102 行。
- 证据：lib.mjs:165 行正则匹配 SCOPE 标题；:169 与 :177 按 /[,\uff0c\s]+/ 切分；:88 PATH_LIKE 只收 [A-Za-z0-9_@~.\\/-]，含中文即整条丢弃；:91 长度上限 200；guard.mjs:97-102 白名单为空即放行。
- 判定：成立（代码链成立）；本轮无真实漏收样本
- 说明：成立，条目自标「推断」并写明「未观测到漏收的真实样本」，判定口径自洽。引用瑕疵：条目把 PATH_LIKE 与 isPathLike 一并标为 lib.mjs:88-97，常量在 :88、函数在 :90-97。

### V-24
- 涉及条目：context-flow.md F-06（声称被派工成员的 .superagent/methods/sa-context-trace.md 实际不存在 / ENOENT）
- 复核方式：三重独立取证 ——（a）直接 read 该文件；（b）取文件系统创建/修改时间并与派工时间、报告时间对齐；（c）在该成员自己的 transcript 里做未污染检索（用未转义引号区分真实工具错误与文档回显）。
- 证据：（a）read .superagent/methods/sa-context-trace.md 成功，55 行 / 3000 字节，内容是完整方法论（含「## 方法」「## 验收清单」「## 易错」三段）。（b）该文件 CreationTime = LastWriteTime = 2026-11-09 22:47:20；而父会话派工时刻为 2026-11-09T14:49:24Z（= 22:49:24 本地，见 4efc02c8…compatible.jsonl 第 65 行 timestamp），本清单写于 23:04:04–23:05:55（文件时间戳）——方法论在派工前约 2 分钟即已存在，此后未被改动。roster.json 里 sa-context-trace 的 method 字段也指向该文件。（c）该成员自己的 transcript 73f33cbca067dd3d55331579664d091d.compatible.jsonl 第 6 行是一条 tool_result，内含该方法论文件全文（「## 验收清单…## 易错…只读代码就断言「注入了」」）—— 文件在派工后被成功读取；该 transcript 中所有真实 ENOENT（共 4 处，都在第 60 行）命中的都是 .superagent\\lessons\\sa-context-trace.md（错题本），没有一处是 methods 路径；检索 access '…methods…sa-context-trace.md' 在该 transcript 只命中 1 处，位于第 81 行——那是它自己写出的报告正文回显（tool_result 里含 docs/audit/context-flow.md 的 F-06 段落）。
- 判定：不成立
- 说明：这是假发现，且证据被改写：条目引用的 ENOENT 路径（methods）在整个语料里从未作为真实工具错误发生过；真实发生的是 lessons（错题本）ENOENT，被写成了 methods。条目正文自己也承认 lessons 文件 ENOENT 且与 brief「暂无错题本」一致——恰好说明作者把同一个错误文本换了个目录。F-06 里关于「guard 的方法论放行只解决可读性、不解决内容注入」的机制观察仍然有效，但作为缺陷条目必须删除或按实情改写。

### V-25
- 涉及条目：context-flow.md F-07（SessionStart 协议只注入父会话，子会话结构性拿不到）
- 复核方式：对全部 transcript 文件做未污染检索——只匹配未转义的 "subtype":"plugin_hook_context"，以把真实 hook 记录与文档里引用的那段 JSON 字符串区分开。
- 证据：全语料检索未转义的 "subtype":"plugin_hook_context" 只命中 4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl（1 处）与 76a305b5abaaaccf0dc34576325423e7.compatible.jsonl（1 处），即两个父会话；其余子会话与全部 codex 变体零命中。（若用未转义的子串 plugin_hook_context 统计，会把成员回显自己报告的字符串误计为注入——73f33cbc 会出现 123 次假命中，这一点必须在复核中排除。）
- 判定：成立
- 说明：运行时结论已独立验证。条目依据的 plugin/hooks/hooks.json 接线表行号我未逐行核对（该文件不在本单 SCOPE 内，读取被 guard 拦截），故该子项标注为未直接核对，但不影响主结论。

### V-26
- 涉及条目：context-flow.md F-08（gate 与 dispatch 各自取「实战记录」，两套口径；且后排成员被截断不可见）
- 复核方式：读 records.mjs 38-53、gate.mjs:42、session-start.mjs:39、dispatch.mjs:89；读 .superagent/roster.json 与 .superagent/methods/sa-plugin-release.md 的记录现状。
- 证据：records.mjs:43 无记录成员 continue、:51 if (out.length >= maxMembers) break;；gate.mjs:42 与 session-start.mjs:39 传 summarizeRecords(3, 6)；dispatch.mjs:89 readRecords(agent).slice(-3).reverse()（按目标成员取 3 条，顺序也相反）。roster.json 中 sa-plugin-release 是当前唯一有实战记录的成员（方法论第 56-59 行一条 2026-11-09 记录）。
- 判定：成立；与 runtime-guards F-18 为同一缺陷
- 说明：成立。条目比 runtime-guards F-18 多出的半句（Router 侧横切摘要 vs 派工侧目标成员 3 条，两套取数口径）经代码核对同样成立；合并台账时两条应合并为一条。

## 二、重复对：同一缺陷被两个角度各报一次

| 编号对 | 重复类型 | 同一缺陷 | 判定位置 | 两份清单定级是否一致 |
|---|---|---|---|---|
| runtime-guards F-03 ↔ context-flow F-02 | 完全重复 | lib.mjs:275 只扫 transcript 前 8 行 + 解析失败即整段放行 | lib.mjs:275、guard.mjs:75-76、:97-101 | 否（前者「已复现」，后者「推断」） |
| runtime-guards F-18 ↔ context-flow F-08 | 完全重复 | records.mjs:51 的 maxMembers 截断导致 roster 后排成员的实战记录结构性不可见 | records.mjs:41-51、gate.mjs:42 | 是（均「已复现」）；后者另加「两套取数口径」半句 |
| runtime-guards F-07 ↔ context-flow F-01 | 部分重叠 | 都导致在飞名额不回收 | lib.mjs:235-241 / lib.mjs:276-288 | 否（触发条件不同：平台不发 SubagentStop vs transcript 变体解析失败） |
| runtime-guards F-13 ↔ context-flow F-06 | 部分重叠 | 都引用 guard.mjs:111-120 的方法论读放行 | guard.mjs:111-120 | 否（前者成立，后者不成立） |
| runtime-guards F-14 ↔ context-flow F-05 | 部分重叠 | 都关于 SCOPE 的提取与呈现 | lib.mjs:158-181 / gate.mjs:13-36 | 否（前者讲用户原文继承授权，后者讲解析格式脆弱） |

结论：完全重复 2 组（合并后 26 条应收敛为 24 条独立缺陷），部分重叠 3 组。完全重复的两组必须合并，且需统一定级（同一缺陷在两份清单里一个标「已复现」一个标「推断」，会让后续按状态排优先级的消费者拿到矛盾输入）。

## 三、编号冲突

- 事实：runtime-guards.md 用 F-01…F-18，context-flow.md 用 F-01…F-08，前缀与起编号完全相同。
- 冲突：F-01 至 F-08 共 8 个编号在两份清单中各指一条不同缺陷。合并进同一台账必然出现 8 组同号不同义，且由于两名成员互不通信、看不到对方编号，无人可能自行避让。
- 契约层判定：属于「产出契约」缺陷。契约给了字段模板与「逐条编号」的要求，但没给全局编号命名空间（也没要求编号在跨成员范围内唯一），也没指定编号段分配或唯一性校验。责任在契约，不在任一成员。
- 建议：契约层固定「全局前缀 + 段」规则（如 RG-xx / CF-xx，或由 Router 预分配 ID 段），并把「条目 ID 在全批次内唯一」写进两单的 ACCEPT 项；合并台账时以 26 → 24 条的收敛结果为准。

## 四、结构差异

- 共性（通过）：两份清单的 6 个固定字段逐字一致、顺序一致 —— 触发条件 → 影响 → 复现步骤 → 证据 → 状态 → 修法方向；标题层级均为 ### F-xx；编号均无跳号、无重号（18 个 / 8 个标题连续）。
- 差异 1（第 7 字段不一致，不通过）：runtime-guards.md 的 2 条推断条目各带独立字段「- 还需要什么：」（共 2 处）；context-flow.md 的 8 条里 0 处有该字段，其 2 条推断条目把「还需要什么确认」塞在「修法方向」段末（F-02 结尾「需确认项：…」、F-05 结尾「未观测到漏收的真实样本，故判为推断…」）。因此任务书里所说的「同一套 7 字段模板」在 context-flow.md 上并不成立；而且这违反了该成员自己方法论 .superagent/methods/sa-context-trace.md 的验收清单条目「产出的结构与同批另一份清单字段完全一致（同字段、同顺序、同命名）」——它自己的清单要求自己没有满足。
- 差异 2（条目统计行，自洽）：runtime-guards.md 的「总计 18 条，其中已复现 16 条，推断 2 条」与实测标签计数（状态：已复现 16、状态：推断 2）完全吻合；context-flow.md 的「总计 8 条，其中已复现 6 条，推断 2 条」同样吻合。两份的「条目统计」行均无自相矛盾。
- 差异 3（文档级，不影响条目）：runtime-guards.md 多一段「取证口径」；context-flow.md 多四节（来源清单表、来源×接收方矩阵、真实 transcript 原文摘录、验证方法索引）。两者的章节体例不一致，若要求统一模板需要另行约定。

## 五、零改动检查

git status --short 的真实输出：

```
 M .superagent/changes.log
 M .superagent/roster.json
?? .git-sync-tmp/
?? .superagent/lessons/sa-orchestration-audit.md
?? .superagent/methods/sa-context-trace.md
?? .superagent/methods/sa-orchestration-audit.md
?? docs/audit/
```

逐项判定：

1. plugin/ 下零改动（成立）：git status 无任何 plugin/ 条目；git diff --stat 只列出 .superagent/changes.log（+2）与 .superagent/roster.json（+22）两个文件。plugin/scripts/ 下 12 个脚本全部未被改动，与「只读审计」的要求一致。
2. .superagent/roster.json 与 .superagent/changes.log 被改，但非成员所为（成立）：git diff 显示改动内容只有两条 register 留痕与两个成员登记条目（created_at 2026-11-09T14:47:48Z = 本地 22:47:48），而两次派工发生在 22:49:24（父会话 transcript 第 63/65 行时间戳）——即改动早于派工约 100 秒，属 Router 建员动作。
3. .superagent/methods/sa-context-trace.md 与 sa-orchestration-audit.md 的创建时间为 22:47:20（同属建员时刻，roster.json 里两者的 method 字段均指向这两个文件），非成员改动。
4. .superagent/lessons/sa-orchestration-audit.md 创建于 23:19:40，落在 runtime-guards 成员的会话窗口内，且该文件本身就在两单 SCOPE 范围内（成员自己的错题本），属允许写入。
5. docs/audit/ 为未跟踪新目录，内容是两份交付物 + 本报告，在 SCOPE 内。
6. .git-sync-tmp/（未跟踪）不在本单 SCOPE 内，我的 glob 被 guard 拦截，无法判定内容与归属 —— 此项未验证；从证据看它不含 plugin/scripts 或 .superagent 的成员产物特征。
7. 过程合规提醒（不构成越权写文件，但值得记录）：.superagent/lessons/sa-orchestration-audit.md 自述「被拦后改用 base64 编码命令重试」「不得用编码、换通道等方式重试」。也就是说 runtime-guards.md 的作者在派工中被 guard 拦下后，改用编码方式绕开路径扫描。这不产生越权文件（其产物仍在 SCOPE 内），但与 guard 的意图相悖，也正好落在它自己清单 F-01 指出的机制弱点上 —— 属自证。

结论：两名成员均未改动 plugin/scripts/ 与 .superagent/ 下超出各自 SCOPE 的文件（唯一例外是 .git-sync-tmp/ 无法判定）。

## 六、未验证项与残留风险

1. 本轮全部「已复现」级判定均为源码逐行推演 + 活体探针，未实际运行 node 复现脚本（两侧清单均声明本环境禁止执行 node/bash）。其中我能做活体验证的 3 条结论一致：F-01（bash 路径扫描只认点+扩展名）、F-13（读通道按目录树放行、写通道按条目严格）、F-15（带尾斜杠放行、不带则拦）。其余 22 条为静态推演，其「输入条件一旦满足输出唯一确定」的前提成立，但未逐条实跑。
2. 4 条成立条目的触发条件在本环境仍未取证：runtime-guards F-02（mavis 工具形态，tool_search 未检索到名为 mavis 的工具条目）、F-14（Router 是否原样照抄注入的 SCOPE）、F-16（平台是否以 notebook_path 一类键名下发）、context-flow F-02 / F-05（子会话 brief 是否被挤出 8 行窗口、SCOPE 是否解析失败）。两侧清单自身也把它们标为推断并写明所需证据，判定口径自洽。
3. plugin/hooks/hooks.json 不在本单 SCOPE 内（读取被 guard 拦截），context-flow F-07 引用的接线表行号未逐行核对；其运行时结论已由 transcript 独立验证。
4. 被审计对象是仓库副本，实际加载的可能另有安装目录副本 / 运行时 hook 缓存副本（.superagent/STATUS.md 提到 v2/plugin-hook-cache/ 有完整包副本），不在 SCOPE 内，无法比对。若运行时加载的不是仓库副本，本报告的行号级结论需重新核对。
5. 本轮唯一证伪的条目（context-flow F-06）恰恰属于「以自述的运行时事实为证据」这一类；说明两份清单中以「实测」措辞给出的运行时事实，其可信度需要独立复核，不能按自述采信。
6. 引用行号偏差（不影响结论，但应回修）：runtime-guards F-08（watchdog 注释块 :9-12 而非 :12-15）、F-10（dispatch.mjs:107 而非 :104；guard.mjs:82 而非 :83）、F-12（_TEMPLATE.md:42 / sa-plugin-release.md:52 而非 :41-45 / :51）、F-15（e2e-test.mjs:127-128 而非 :105-110；chain-test.mjs 的 glob 举证不存在）。

## 七、结论

- 26 条中成立 25 条、不成立 1 条（context-flow F-06）、条目级未验证 0 条；成立项内部另有 4 条触发条件未取证（第六节）。
- 2 组完全重复（runtime-guards F-03 ↔ context-flow F-02；runtime-guards F-18 ↔ context-flow F-08），3 组部分重叠；合并后独立缺陷为 24 条。
- 编号命名空间缺失导致 8 组撞号；字段模板在 context-flow.md 上少第 7 字段，且违反该成员自己方法论的验收清单。
- 零改动成立：plugin/scripts/ 与 .superagent/ 无越权改动（.git-sync-tmp/ 因越界拦截未能判定）。

VERDICT: FAIL

含义（针对两份产物能否按原样进入 v0.5.0 缺陷台账）：不通过。失败点集中在两处，均可低成本回修：
（一）docs/audit/context-flow.md 的 F-06 是被证伪的条目，其引用的 ENOENT 证据在语料中从未真实发生（真实错误指向 .superagent/lessons/sa-context-trace.md），属于证据改写，必须删除或按实情改写；
（二）两份清单不满足合并契约：F-01…F-08 共 8 组编号同名异义，且 context-flow.md 缺第 7 字段「还需要什么」。
成立并可直接采纳的部分：runtime-guards.md 的 18 条全部成立（仅 4 处引用行号偏差需回修，不影响任何结论），其中 F-01、F-07、F-13、F-15、F-17 是本轮价值最高的机制级结论（默认放行分支、名额回收缺口、读写权限不对称、目录路径语义、台账写了无人读）。
转为 PASS 的最小条件：（1）删除或据实改写 context-flow F-06；（2）为两份清单分配全局唯一编号（RG-xx / CF-xx 或 Router 预分配 ID 段）并合并 2 组完全重复条目；（3）context-flow.md 为两条推断条目补回独立「还需要什么」字段，或契约降为 6 字段并同步 runtime-guards.md；（4）修正 runtime-guards F-08 / F-10 / F-12 / F-15 的引用行号（F-15 改为只引 e2e-test.mjs:127-128，删除 chain-test.mjs 的 glob 举证）。
剩余风险：所有「已复现」均为静态推演而非实跑；运行时实际加载的副本可能不是仓库副本（行号级结论需复核）；F-02 / F-14 / F-16 / context-flow F-02 / F-05 的触发前提仍未取证。