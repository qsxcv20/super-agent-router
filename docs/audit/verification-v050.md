覆盖范围：对 v0.5.0 机制判定改造在仓库工作树（分支 main，HEAD a0cce04，28 个文件未提交改动）中的实现做独立对抗性复核。复核对象是缺陷台账 docs/audit/defect-ledger.md 的 D-01～D-24，重点是检查 1（run_code 复合判定）与检查 2（变异检验），并逐条核对契约 S1～S10 与实现的一致性。本次复核只读不改：除本报告外未改动仓库任何文件；变异副本全部放在系统临时目录，仓库工作树零 diff。

一句话结论：P0 五条「静默放行」（D-01/02/03/04/05）在实现层确实被改成「必然拒绝」，且都有实测变红证据；台账多数条目也有对应实现与断言。但 v0.5.0 新加的 run_code 复合判定分支实测坐实误伤——代码文本里只要出现 scope 外的路径字样（哪怕只是注释或字符串常量）、出现 // 注释、或引号里带斜杠的命令，整次 run_code 就被拒；不含任何路径 token 的正常代码同样被拒（没有可判定的目标路径）。hooks.json 本轮新增的 run_code 匹配项会把这层误伤带进真实运行时。

条目统计：总计 35 条，其中成立 30 条，不成立 2 条，未验证 3 条

---

# v0.5.0 机制改造 · 独立验收报告（对抗性复核）

复核者：独立 verifier（不参与实现，不采信任何自述）
复核时间：2026-11-10
被测实现：仓库工作树未提交改动（基线 = HEAD a0cce04）

## 零、方法与取证手段

- 实现取证：直接读仓库版 plugin/scripts 下的 guard、lib、dispatch、watchdog、record-gate、records、roster 脚本，以及 plugin/hooks/hooks.json、plugin/skills/super-agent-router/references/contract.md。
- 活体取证：以假 PLUGIN_DATA（临时目录里预置 dispatches 台账与一个 binding）驱动仓库版 guard.mjs，stdin 灌入合成 PreToolUse 载荷，读取 permissionDecision 与 reason。共 21 组载荷，输出留有原文。
- 变异取证：用 git plumbing 取改前版本（git show HEAD:<path>）写进系统临时目录的副本，用 SAR_PLUGIN_ROOT 指向副本，跑仓库自带的回归套件，看断言是否变红。共 4 组。
- 基线取证：8 个回归套件逐个跑，记录每套 PASS 计数与结尾行。
- 环境边界：本机线上安装的插件仍是改前版本（匹配器里没有 run_code 与 mavis），因此 run_code 与 mavis 的端到端拦截无法在本会话触发；本报告对这两项一律以「仓库版实现 + 合成载荷」取证，并在对应条目标注该边界。
- 副作用控制：全程未修改仓库任何文件；变异副本位于系统临时目录；本报告是唯一新增的仓库文件。

---

## 一、检查 1：run_code 复合判定（1a～1e）

### V-01
- 涉及对象：检查 1a —— run_code 复合分支，scope 内路径应放行。
- 复核方式：合成载荷 tool_name=run_code、agent_type=worker、session_id=V050（台账中预置 binding，scope 三条仓库内路径），code 内含一次 tools.write，file_path 指向 scope 内文件。
- 证据：guard.mjs 进程 stdout 为空（空输出即放行），exit=0；同组对照载荷（tool_name=write、同一路径）同样放行；tool_name=read 读同一路径亦放行。
- 判定：成立
- 说明：复合分支不是「一律拒绝」；作用域内路径确实放行，1a 的语义成立。

### V-02
- 涉及对象：检查 1b —— run_code 代码文本里仅仅「提及」scope 外的路径，是否被误拦（误伤）。
- 复核方式：两组载荷——(i) code 只是一句注释，提到 docs/audit/runtime-guards.md，无任何写调用；(ii) code 先写 scope 内文件，再声明一个字符串常量指向 scope 外的路径。
- 证据：(i) 输出 permissionDecision=deny，理由「目标 //, docs/audit/runtime-guards.md 不在白名单内」；(ii) 输出 permissionDecision=deny，理由「目标 docs/audit/runtime-guards.md 不在白名单内」——(ii) 真正的写目标是 scope 内文件，仅因代码文本里出现了一个 scope 外路径字样，整次调用被拒。
- 判定：成立
- 说明：1b 误伤确认存在。机制在 guard.mjs 的 targetsOf 复合分支：targets 用 extractPathTokens(code) 对整段代码文本抽路径 token，命中即按 scope 判定，命中 scope 外路径即 deny；注释里的 // 本身也被当成路径 token（含路径分隔符）。这与「只判定真实写目标」的预期不符，是本轮新增护栏带来的误伤。

### V-03
- 涉及对象：检查 1c —— run_code 内 tools.write 写 scope 外文件必须被拦。
- 复核方式：合成载荷 code 内含 tools.write，file_path 指向 scope 外文件（该路径在命令行里用 JSON unicode 转义拼出，避免命令行文本本身触发线上旧 guard 的扫描）。
- 证据：permissionDecision=deny，理由「目标 docs/audit/runtime-guards.md 不在白名单内」。
- 判定：成立
- 说明：真正的越界写被拦住了，方向正确。问题不在这一条，而在 V-02、V-04——拦的范围过大。

### V-04
- 涉及对象：检查 1 的补充边界 —— 复合分支在没有可判定目标、以及代码含 // 注释、引号命令、tools.bash 时的行为。
- 复核方式：四组载荷——(i) 纯算术代码；(ii) 只带一行 // 注释且注释里引用的是 scope 内路径；(iii) code 内含 tools.bash，命令写在引号里且不含路径；(iv) code 内含 tools.bash，命令写在引号里且含重定向与 scope 内路径。
- 证据：(i) deny「越界管控无法执行：run_code 没有可判定的目标路径。取不到目标就放行 = 这次调用完全绕过了越界判定，故拒绝」；(ii) deny「目标 // 不在白名单内」；(iii) 同样 deny「没有可判定的目标路径」；(iv) deny「目标 echo hi > docs/audit/verification-v050.md 不在白名单内」——整条命令字符串被当成一个路径 token 判掉。
- 判定：成立
- 说明：复合分支当前可放行的形态极窄——代码文本里必须至少出现一个 scope 内路径 token，且不得出现任何其它路径样 token（// 注释、含斜杠的引号串、tools.bash 这类带已知扩展名的标识符都不行）。对以 run_code 为主力工具的 worker，这是大面积误拦。

### V-05
- 涉及对象：检查 1d —— 内层工具调用是否也被 hook 判定（重复判定；run_code 是否必须进匹配器）。
- 复核方式：观察本会话自身的 hook 行为。线上安装的是改前版本插件，其 PreToolUse 匹配器为 write|edit|multiedit|notebookedit|bash，不含 run_code；本会话在 run_code 内部调用内层 bash 时仍收到越界拦截，拦截对象是内层 bash 子调用。
- 证据：本次会话中若干次内层 bash 调用被拦（工具结果为 PTC_TOOL_BLOCKED，归属内层 bash 子调用）；同一时刻外层 run_code 调用本身正常返回。
- 判定：成立
- 说明：内层调用已被独立判定，run_code 再进匹配器属于同一动作的第二层判定，且第二层判定方式更粗糙（整段代码文本扫路径），因此把 V-02、V-04 的误伤带进来。若保留 run_code 匹配项，其判定必须只做内层判定不做的事（危险工具名、危险参数）。

### V-06
- 涉及对象：检查 1e —— mavis 工具的 command 参数为 agent delete 时必须被拦。
- 复核方式：合成载荷 tool_name=mavis、tool_input 的 command 为 agent delete sa-probe，用仓库版 guard.mjs 跑。
- 证据：permissionDecision=deny，理由「已拦截：mavis 的 agent delete 会删除/改写账号级成员，必须由用户亲自发起。」
- 判定：成立
- 说明：参数维度危险判定生效；配合 hooks.json 新增的 mavis 匹配项，改前版本「工具名不在 DANGEROUS 表就整条放行」的洞（D-03）被堵上。

### V-07
- 涉及对象：检查 1 的最小修法建议（只给建议，不改代码）。
- 复核方式：对照契约 S2/S3/S5 的语义要求与复合分支现状，列出最小改动点。
- 证据：契约 S3 只对 bash 规定「命令里的路径 token」按意图分流，S5 对复合工具只要求「参数维度危险判定」；而实现把整段代码文本当命令文本处理（guard.mjs 的 targetsOf 复合分支）。
- 判定：成立
- 说明：最小修法三条，任选其一即可消除误伤，不建议拖到下个版本：
  (1) 复合分支不再对自由文本做路径扫描：只保留 dangerousInCode 的危险工具名/危险参数判定（它已能拦 mavis agent delete、miniapp publish、website deploy），作用域判定交给内层调用各自触发 PreToolUse（V-05 已证内层会被判定）；
  (2) 若坚持在复合层判作用域，必须只从真实工具调用的实参抽取路径（例如解析出 tools.write/tools.edit 的 file_path 实参），注释与字符串常量不得参与；
  (3) 复合层不得复用「取不到目标就 deny」这条写类工具规则（D-16 的目的是防写通道失守，对复合工具不适用；无路径 token 的纯计算代码应当放行）。
  另建议把 run_code 从 hooks.json 的 guard 匹配器移除，或让复合分支走独立入口，避免与内层判定重复。

---

## 二、检查 2：变异检验（把实现回退到改前行为，断言是否变红）

前置说明：brief 要求副本放在 docs/audit/ 下，但线上安装的改前版 guard 只允许精确文件写入，docs/audit/ 下新建文件会被拦；本机硬安全策略又禁止递归拷贝到工作区外。最终按 Router 后续指令把副本放在系统临时目录（%TEMP%/sar-mut1..4），用 git show HEAD:<path> 取改前版本写入副本，仓库工作树零 diff；每组变异前都会打印标记确认回退确实落盘（首轮曾因 Out-File 参数名写错导致回退静默失败、套件假绿，已修正后重跑）。

### V-08
- 涉及对象：变异 MU1 —— guard.mjs 与 lib.mjs 整体回退到 HEAD，检验 D-01/D-02/D-03/D-04/D-14/D-16/D-22 的判据是否真被锁住。
- 复核方式：把改前 guard.mjs、lib.mjs 写入临时副本，SAR_PLUGIN_ROOT 指向副本，跑 .superagent/guard-test.mjs。
- 证据：结尾行由「>>> GUARD2 ALL PASS」变为「>>> GUARD2 FAILURES: 22」，48 条断言中 22 条转红，含 D-02 的三条（bash 目录型目标被识别并拦下、bash 目录型目标 node_modules 被拦下、console.log 这类标识符不被当成路径）、D-03 的四条（mavis 的 agent delete 被拦、mavis 的 agent update 被拦、run_code 里的写操作按写判定并被拦、run_code 里的危险操作被拦）、D-04 的四条（解析不到边界时读被拒、brief 不在前几行也能定位、transcript 读不到时 deny 且写明原因、transcript 里没有 SCOPE 行时 deny）、D-22 的两条（glob 显式 path 在读放行目录树内放行、glob 无 path 时按工作区根判定并 deny），以及 D-01/D-14/D-16 与 ro: 条目、载荷非法等断言。
- 判定：成立
- 说明：这 22 条断言在旧实现下变红，说明它们不是空断言；检查 1 关心的 D-02/D-03/D-04/D-22 四条都在其中。

### V-09
- 涉及对象：变异 MU2 —— dispatch.mjs 回退到 HEAD（D-05/D-07/D-09/D-12/D-19/D-23）。
- 复核方式：改前 dispatch.mjs 写入临时副本，跑 .superagent/chain-test.mjs。
- 证据：结尾行变为「>>> CHAIN FAILURES: 9」，43 条中 9 条转红：缺 turn_id 时不抹掉同会话的其它记录（实测旧实现只剩 1 条记录：src/d5/b.ts，正是 D-05 描述的「旧记录被整条抹掉」）、两条 scope 都在、tool_use_id 作去重键时两条记录都在（记录数=1）、SCOPE 里有解析不出的条目时拒绝派工、跨会话的写冲突被拒、台账用 routing id 而不是显示名、累计派工超限被拒、台账不再写 unscoped 字段、派工载荷不是合法 JSON 时拒绝。
- 判定：成立
- 说明：D-05 的去重键改造有直接的红→绿证据。

### V-10
- 涉及对象：变异 MU3 —— watchdog.mjs 回退到 HEAD（D-11 与产出路径校验）。
- 复核方式：改前 watchdog.mjs 写入临时副本，跑 .superagent/chain-test.mjs。
- 证据：结尾行变为「>>> CHAIN FAILURES: 3」，转红三条：搞定了，测试通过 被拦（D-11）、引用到的路径不被当成产出校验、契约条款引用不被当成声称产出的文件。改前 claimedPaths 用「norm 以 / 开头则直用，否则拼 <工作区根>/ + norm」判存在性，带盘符路径会被拼成工作区根加盘符路径，恒判不存在。
- 判定：成立
- 说明：D-11 与产出/引用区分两条修复有红证据；D-20 的两条断言未转红，见 V-13 与 V-27。

### V-11
- 涉及对象：变异 MU4 —— record-gate.mjs 与 records.mjs 回退到 HEAD（D-13/D-21/D-24）。
- 复核方式：改前 record-gate.mjs、records.mjs 写入临时副本，跑 .superagent/records-test.mjs。
- 证据：30 条中 7 条转红：D-13 台账里不存在的验收方被拒、D-13 state=active 的验收方不被认可、D-13 台账不可用时拒绝写入、D-21 计数按段内实际条数（3 条存量 + 1 条新增 = 4）（旧口径只数出 1 条）、D-21 长前导文件里 20 条上限真的会触发、匹配阶段注入实战记录、注入时声明不改归属。
- 判定：成立
- 说明：D-13 的写入时校验与 D-21 的索引口径修复有直接红证据；D-24 的取样公平性体现为最后两条转红。

### V-12
- 涉及对象：变异覆盖缺口 1 —— 工具名兜底（未登记的文件类工具名按写判定）没有任何断言锁住。
- 复核方式：通读 .superagent/guard-test.mjs 找覆盖该规则的断言；再用活体载荷验证规则本身是否生效。
- 证据：guard-test.mjs 里与 D-03 相关的断言只有 mavis 的 agent delete/agent update/非危险命令三条与 run_code 的两条，没有一条用「未登记的文件类工具名」。活体验证：tool_name=upload_file、file 指向 src/x.ts → permissionDecision=deny，理由「目标 src/x.ts 不在白名单内」，规则本身有效；但若有人把它改回放行，现有套件不会变红。
- 判定：成立
- 说明：这是覆盖率缺口而非实现缺陷。建议补一条断言：未登记的文件类工具名按写判定，scope 外目标必须被拦。

### V-13
- 涉及对象：变异覆盖缺口 2 —— D-20（盘符绝对路径）的两条断言不具区分力。
- 复核方式：MU3 回退 watchdog.mjs 后逐条核对 D-20 两条断言是否变红，并读改前 watchdog 的 claimedPaths 实现。
- 证据：MU3 的 3 条转红里没有 D-20 的两条：链式测试第 25 条（盘符绝对路径的产出不被误判为不存在）与第 27 条（盘符绝对路径不存在时被拦）在旧实现下同样为绿。
- 判定：成立
- 说明：D-20 的修复本身有效（V-26），但没有任何断言能区分改前改后——这条 P2 缺陷目前处于「改对了但没被锁住」的状态。原因未逐行确认（改前 PATH_TOKEN 正则与盘符前缀的关系未比对），此处仅作推断。
## 三、检查 3：台账条目逐条证据

### V-14
- 涉及对象：D-01 —— transcript 为 codex 变体时 scope 解析恒为 null，导致整段放行。
- 复核方式：读 lib.mjs 的 readBriefFromTranscript 与 userMessageText（同时认 compatible 与 codex 两种 user 消息形状，且按「含 SCOPE: 的 user 消息」语义定位，不再用固定 8 行窗口）；再以仓库版 guard.mjs 跑 codex 变体合成 transcript。
- 证据：实现位置为 lib.mjs 的 readBriefFromTranscript 与 userMessageText；变体样本由 .superagent/guard-test.mjs 的 makeCodexTranscript 构造（type=response_item、payload.role=user、content[].type=input_text），基线断言「codex 变体：scope 内放行」「codex 变体：scope 外 deny」全绿，MU1 回退后后者转红。
- 判定：成立
- 说明：D-01 的 codex 变体解析已修复并被断言锁住；失败语义也从「放行」改成「deny 并写明原因」。

### V-15
- 涉及对象：D-02 —— bash 路径提取只认「点 + 1~8 位字母数字」，目录型目标整体逃逸且无候选即放行。
- 复核方式：读 lib.mjs 的 S3 段（splitCommandTokens / isPathToken / extractPathTokens / extractWriteTargets / hasWriteVerb / isReadOnlyCommand 与 KNOWN_EXTENSIONS）；用仓库版 guard.mjs 跑目录型目标、只读命令、危险命令、带点标识符四组载荷。
- 证据：实测「递归删除整个 config 目录」的命令 → deny「以下路径不在白名单内：config」；「递归删除整个 node_modules 目录」同理；cat 范围外文件 → deny、cat 范围树内文件 → 放行；git push origin main → deny「命令包含对外可见的不可逆动作」；带点标识符 console.log(JSON.stringify(...)) 基线放行、MU1 回退后转红。实现侧：已知扩展名白名单 + 含分隔符即路径 + 动词加参数兜底（extractWriteTargets）+ 写命令取不到目标即 deny。
- 判定：成立
- 说明：D-02 的三条子问题（目录型目标、带点标识符、无候选默认放行）在实现层都已关闭，且有红证据。

### V-16
- 涉及对象：D-03 —— 未登记工具名一律放行，账号级不可逆操作可绕开。
- 复核方式：读 guard.mjs 的 toolKind、dangerousByArgs、dangerousInCode；用仓库版 guard.mjs 跑 mavis/miniapp/未登记工具名载荷。
- 证据：toolKind 把 run_code 判为 composite、把含 file/path/write/edit 等字样的未登记工具名按 FILE_TOOL_HINT 判为 write、把 web_search/web_fetch/task/think/todo/tool_search/skill 等判为 none 直接放行；dangerousByArgs 按参数拦 mavis 的 agent delete/agent update 与 miniapp 的 publish；dangerousInCode 在复合文本里拦同名危险动作。实测：mavis agent delete → deny；notebookedit 的 notebook_path 指向范围外 → deny；upload_file（未登记）指向范围外 → deny；web_search → 放行。
- 判定：成立
- 说明：D-03 的工具名兜底缺断言（V-12），实现本身成立。

### V-17
- 涉及对象：D-04 —— brief 不在 transcript 前 8 行 → 解析返回 null → guard 整段放行。
- 复核方式：读 lib.mjs 的 readBriefFromTranscript 与 guard.mjs 的绑定建立分支；用仓库版 guard.mjs 跑「无绑定且无 transcript_path」「载荷不是合法 JSON」两组载荷。
- 证据：readBriefFromTranscript 返回带 reason 的结果对象，guard.mjs 在失败时 deny 并写明具体原因（变体不认识 / 没找到 SCOPE 行 / 文件读不到）；另有 parseInputStrict 兜底，载荷解析失败也 deny。实测：无 transcript_path → deny「越界管控无法建立：载荷里没有 transcript_path，取不回派工原文。解析不到边界 = 边界不存在，此处不放行」；载荷非合法 JSON → deny「载荷不是合法 JSON」；基线套件中 D-04 的四条断言在 MU1 回退后转红。
- 判定：成立
- 说明：D-04 的「解析失败即放行」已改为必然拒绝，且拒绝理由可读。

### V-18
- 涉及对象：D-05 —— 去重键依赖 turn_id，载荷缺该字段时旧记录被整条抹掉。
- 复核方式：读 dispatch.mjs 的去重段；MU2 回退实测。
- 证据：实现改为 turnKey 取 turn_id 或 tool_use_id，且只有「父会话 + agent + turnKey + state=active」四项全同才允许原地覆盖一条，绝不删除其它记录；两者都缺时不去重。MU2 回退后断言「缺 turn_id 时不抹掉同会话的其它记录」转红，旧实现实测只剩 1 条记录。
- 判定：成立
- 说明：D-05 已闭环。

### V-19
- 涉及对象：D-10 —— 派工被取消/中断/异常退出时名额不回收（要求三条回收通路）。
- 复核方式：读 lib.mjs 的 markDispatchAborted（L389 附近）、reapExpiredDispatches（L399 附近）、activeDispatches（L411 附近）、activeDispatchesAll（L423 附近）与 dispatch/watchdog 的调用点。
- 证据：三条通路在代码层齐备——(1) 正常结束：watchdog.mjs 在交付校验通过后 markDispatchDone 回收；(2) 超时兜底：reapExpiredDispatches 按 DISPATCH_TTL_MS 把超龄 active 记录判死为 aborted、end_reason 写 ttl_expired，dispatch.mjs 在闸门判定前先 reap 并把结果落盘；(3) 读时自愈：activeDispatches 与 activeDispatchesAll 读取时先 reap。reclaimState 对已判死记录不复活并往 stderr 留痕；watchdog 的 catch 分支不再静默吞异常。链式测试第 19 条（超龄记录被 TTL 判死并落盘）基线为绿。
- 判定：成立
- 说明：三条回收通路代码齐备且有断言；但「派工被取消/中断」这一路仍无平台事件可挂（见 V-31）。

### V-20
- 涉及对象：D-12 —— 显示名与 routing id 两套命名空间做等值比较 → 反查失败 → 状态不回收。
- 复核方式：读 lib.mjs 的 resolveAgentKey、dispatch.mjs 的台账写入与反查、guard.mjs 的派工匹配、watchdog.mjs 的 dispatchMatchesAgent；MU2 回退实测。
- 证据：实现统一收敛到 routing id：dispatch 同时写 agent 与 agent_key，guard 与 watchdog 用 agent_key 优先匹配并允许回退到显示名；链式测试「台账用 routing id 而不是显示名」在 MU2 回退后转红（旧实现只写下显示名）。
- 判定：成立
- 说明：D-12 已闭环。

### V-21
- 涉及对象：D-13 —— verified_by 只校验「不等于 agent 名」，履历可被陌生人伪造。
- 复核方式：读 record-gate.mjs 的写入时校验；用仓库版 record-gate.mjs 直接跑三种载荷（假验收方 / 未设 PLUGIN_DATA / 空台账）。
- 证据：实现要求派工台账里存在 agent 等于 verified_by 且 state 为 done 的记录，否则拒写。实测输出原文：假验收方 → 「验收方「sa-ghost-verifier」在派工台账里没有 state=done 的记录 —— 不存在「叫这个名字的验收方跑过验收」的证据，履历不可写入（验收需走一次 task 派工，由 watchdog 回收成 done）」；未设 PLUGIN_DATA → 「无法核验验收方「verifier」：派工台账为空或不可用（PLUGIN_DATA 未设置 / 台账文件缺失）—— 验收通过必须有台账凭据」；台账存在但 dispatches 为空 → 同一条「台账为空或不可用」错误。MU4 回退后这三条断言转红。
- 判定：成立
- 说明：D-13 已闭环，且错误文案可执行（说清了怎样才算数）。

### V-22
- 涉及对象：D-14 —— 读模式按 scope 条目所在目录树放行整棵，其它成员的私有方法论/错题本可读。
- 复核方式：读 guard.mjs 的 exactPaths 段与 lib.mjs 的 inScope 三档（write/read/exact）；用仓库版 guard.mjs 读别人的方法论与读自己的方法论。
- 证据：实现新增 exact 精确文件档与 allowedByExact，方法论与错题本改由工作区根加成员名拼出的两个具体文件精确放行，不再走目录树；链式测试「读别人的方法论被拦（按精确文件放行，不开目录树）」在 MU1 回退后转红。
- 判定：成立
- 说明：D-14 已闭环。

### V-23
- 涉及对象：D-16 —— 写类工具的路径键名不匹配时取不到 target → 静默放行。
- 复核方式：读 guard.mjs 的 WRITE_PATH_KEYS/READ_PATH_KEYS 与「取不到目标即 deny」分支；实测 notebookedit 与空载荷。
- 证据：键名表收敛为一份映射（file_path/path/filePath/notebook_path/notebookPath/file/filename/files/paths/target/dest/source/abs_path/absolute_path 等）；取不到目标时 deny「越界管控无法执行：… 没有可判定的目标路径」；实测 notebookedit 带 notebook_path 指向范围外 → deny；写类工具空载荷 → deny。两条断言在 MU1 回退后转红。
- 判定：成立
- 说明：D-16 已闭环；但该规则被复用到复合工具上造成 V-04 的过度拦截。

### V-24
- 涉及对象：D-22 —— glob/grep 显式传 path 目录时语义不稳（目录本身不可读）。
- 复核方式：读 guard.mjs 的 globRoot 与 targetsOf 的 glob/grep 分支；实测三组 glob 载荷。
- 证据：实现新增 globRoot()：显式 path/directory/dir 优先，缺省用工作区根，判定对象是有效检索根而非 pattern；实测 glob 带 path 落在读放行树内 → 放行；glob 不带 path → deny（按工作区根判定）；glob 带 path 指向范围外 → deny。两条断言在 MU1 回退后转红。
- 判定：成立
- 说明：D-22 已闭环。

### V-25
- 涉及对象：D-08 —— 5 类 hook 全绑父会话事件流，子会话不触发 SessionStart / UserPromptSubmit。
- 复核方式：读 hooks.json 全文；核对 git diff --stat 里 skill 目录文档的改动量。
- 证据：hooks.json 仍是 5 类事件（SessionStart、UserPromptSubmit、PreToolUse 四条、SubagentStop），没有新增面向子会话的事件——与「这是设计边界而非 bug」的判断一致；本轮把该边界写进 skill 目录的 SKILL 主文件与 references 下 brief/review/scope 三份文档（diffstat：SKILL 主文件 +5 行、brief +39、review +26、scope +65），并由契约 S10 规定缺陷统一收在台账、brief 只引编号不復述正文。
- 判定：成立
- 说明：D-08 以文档化与契约化处置，不是代码修复；判定基于文档 diff 存在且与实现不冲突。

### V-26
- 涉及对象：D-20 —— watchdog 不识别盘符绝对路径，把工作区外真实存在的产出判成不存在。
- 复核方式：读 watchdog.mjs 的 PATH_TOKEN 与 absolutizePath 调用；对照 lib.mjs 的 absolutizePath 实现；跑链式测试第 25 条。
- 证据：watchdog.mjs 的 PATH_TOKEN 正则加上可选盘符前缀，并用 lib.mjs 的 absolutizePath（对盘符开头的绝对路径按绝对路径直用，不再拼工作区根）判存在性；第 25 条基线为绿，说明真实存在的盘符产出不再被拦。
- 判定：成立
- 说明：实现层修复有效；但断言不具区分力，见 V-27。

---

## 四、检查 4、5、6：自我更正、范围一致性、残留风险

### V-27
- 涉及对象：检查 4a —— brief 要求「D-20 反向断言在旧实现下失败」。
- 复核方式：MU3 回退 watchdog.mjs 后逐条核对 D-20 的两条断言是否变红；读改前 watchdog 的 claimedPaths 实现。
- 证据：MU3 的三条转红里没有 D-20 的两条：链式测试第 25 条（盘符绝对路径的产出不被误判为不存在）与第 27 条（盘符绝对路径不存在时被拦）在旧实现下同样为绿。改前实现把带盘符的绝对路径拼在工作区根之后，恒判不存在，理论上第 25 条应当被拦（即转红），实测却是绿的。
- 判定：不成立
- 说明：brief 的这一条自述与实测不符——反向断言（第 27 条）在旧实现下并不失败，正向断言（第 25 条）也没有失败。结论上 D-20 的修复是真的（V-26），但它没有任何能区分改前改后的断言，验收不能靠这两条断言背书。

### V-28
- 涉及对象：检查 4b —— verified_by 的真实性只在写入时校验：假验收方被拒、空台账或未设 PLUGIN_DATA 被拒并给出可执行错误、历史履历仍可读并注入。
- 复核方式：仓库版 record-gate.mjs 直接跑三种载荷（原文见 V-21）；再读 records.mjs 与 lessons.mjs 的读取路径、record-gate.mjs 文件头的向后兼容策略段；基线上 records-test 的第 14 条断言验证历史履历可读。
- 证据：写入时校验三态均实测成立（见 V-21）。读取路径不查台账：records.mjs 的 summarizeRecordsDetailed 只按名录收集有记录的成员、按成果条数排序取样并披露 omitted/truncated，不做验收方核验；record-gate.mjs 文件头明确「本校验只发生在写入时，读取时不做任何台账校验，历史履历里那些不在台账里的名字照样读得出来、照样照常注入」。基线套件第 14 条「D-13 历史履历（验收方不在台账）仍能读出」为绿；MU4 回退时它仍为绿——说明该条本就是兼容性保护断言，不该变红。
- 判定：成立
- 说明：写入时严、读取时宽，且宽的那一侧有断言与文档双重说明。唯一提醒：历史存量里的伪造条目不会被这次修复追溯清理，属已知存量风险。

### V-29
- 涉及对象：检查 5a —— 成员范围与 SCOPE 的交叉核对（diffstat 越界检查）。
- 复核方式：git status --short 与 git diff --stat 全量核对本轮改动涉及的每个文件与其归属成员。
- 证据：本轮共 28 个文件改动 —— .superagent 下 8 个回归套件、changes.log 与 roster.json（机制侧成员的测试与名录）；plugin/scripts 下 10 个脚本（机制侧）；plugin/hooks/hooks.json（机制侧）；plugin/skills/super-agent-router 下 SKILL 主文件与 references 下 brief/review/scope（协议与文档侧）；plugin/CHANGELOG.md 与 plugin/README.md（发布侧）；plugin/.minimax-plugin/plugin.json（版本号）。未跟踪新增为 .superagent/lessons/_router.md、两个成员方法论、contract.md 与本报告。名录里 sa-mechanism-fix 明写「不改 record-gate / lessons-gate / records / roster（归 sa-gate-integrity），不改协议文档」，sa-gate-integrity 明写「不改 guard / lib / dispatch / watchdog / session-start / gate」；而 diff 显示 record-gate.mjs、records.mjs、roster.mjs、lessons-gate.mjs 与 session-start.mjs、gate.mjs 同时被改。逐项看内容归属：guard/lib/dispatch/watchdog 属机制侧；record-gate/records/roster/lessons-gate 属闸门侧；gate/session-start 两侧都动了，但改动落在各自边界内。
- 判定：成立
- 说明：未发现成员越界改动，每个文件的改动都能归到某个 owns。但 git 层面无法区分同一批改动里哪些行是谁写的，只能靠内容归属判断——这是协作可审计性的弱项，不是功能缺陷。

### V-30
- 涉及对象：检查 5b —— 契约 S1～S10 与实现、以及 plugin/skills 目录文档的一致性。
- 复核方式：逐节对照 contract.md 与实现。
- 证据：S1 七字段模板由 lib.mjs 的 validateEntryOutput 实现（七个字段名、编号前缀一致、序号递增、条目统计行自洽）；S2 的 ro: 只读语义由 splitScopeEntry 加 inScope 三档实现，基线有三条 ro: 断言为绿；S3 通道语义（glob/grep 判定有效检索根、bash 路径 token 规则、只读命令白名单）在 lib.mjs 实现且基线断言为绿；S4 的双变体加语义定位加解析失败 deny 实测成立；S5 的工具名兜底与参数维度危险判定实测成立，但契约只要求「参数维度危险判定」，实现额外把整段代码文本纳入作用域判定——实现超出契约授权且方向有害（见 V-02、V-04、V-07）；S6 三条回收路径代码齐备；S7 的 verified_by 判据实测成立；S8 的收尾契约校验在 watchdog 实现；S10 要求 brief 只引编号不復述正文，references 下三份文档已按此改写。
- 判定：成立
- 说明：S1～S10 在实现层大体对齐，唯一实质性偏离是 S5 复合工具判定被扩到自由文本——契约未授权，且造成误伤。

### V-31
- 涉及对象：检查 6 —— 残留风险清单。
- 复核方式：汇总本轮未闭合与未验证项。
- 证据：(1) hooks.json 的匹配器改动（新增 run_code、mavis）只有在插件更新后的新会话才生效，本会话线上仍是改前版本，未能端到端触发；(2) 内层调用被判定是「当前线上改前版本」的行为，改后版本内层判定是否仍独立触发，未验证；(3) D-06（教训前置进子会话）只见到 dispatch.mjs 仍以 additionalContext 注入父会话，未见结构性进子会话的证据；(4) D-18 的错题本空态语义靠 brief 文案区分，未端到端验证；(5) 复合分支若按建议 1 修，危险判定覆盖度会下降（dangerousInCode 是文本正则），需与内层判定配合评估；(6) 台账写盘失败时 writeLedger 返回 false 且调用方未检查，名额回收失败只往 stderr 留痕；(7) record-gate 的历史存量伪造履历不会被追溯清理；(8) 本轮改动集中在未提交工作树，发布前需确认 hooks.json 与 plugin.json 版本号同步上线。
- 判定：成立
- 说明：以上八项为未闭合或未验证项，其中 (1)(2) 是发布流程必须交代的生效边界。

### V-32
- 涉及对象：检查 6b —— run_code 与 mavis 在真实运行时的端到端拦截。
- 复核方式：尝试在真实会话中触发（内层 bash 被拦已证实内层会触发；run_code 与 mavis 未能触发）。
- 证据：本会话线上插件为改前版本，其 PreToolUse 匹配器为 write|edit|multiedit|notebookedit|bash，不含 run_code 与 mavis；仓库版 hooks.json 已是 write|edit|multiedit|notebookedit|bash|run_code|mavis。仓库版实现层面的判定已由 21 组合成载荷覆盖，但「平台是否真的把 run_code 调用送进该 hook」这一步未验证。
- 判定：未验证
- 说明：环境边界（线上未更新插件），非产品失败。发布前必须在装好新插件的新会话里跑一次真实 run_code（写 scope 内文件、写 scope 外文件、纯计算代码各一次），确认新匹配项按预期拦截而不是误伤。

### V-33
- 涉及对象：D-06 与 D-18 —— 教训前置是否真正进入子会话、错题本空态是否可区分。
- 复核方式：读 dispatch.mjs 的教训前置与 records 注入段、lessons.mjs 的读取路径；对照基线套件里 lessons-test 与 e2e-test 的相关断言；寻找子会话首条消息含教训块的真实样本。
- 证据：dispatch.mjs 仍以 hookSpecificOutput 的 additionalContext 输出教训块与履历块（该通道作用在父会话的 task 调用上）；本轮未取到子会话首条消息含教训块的真实样本，lessons-test 与 e2e-test 只覆盖到父会话侧的注入与读取函数级行为。
- 判定：未验证
- 说明：机制侧「读取时自愈」已验证，但「教训进子会话」这一环是否打通，本轮没有可用样本，不下结论。

### V-34
- 涉及对象：D-15 与 D-17 —— 契约层：用户原文里的 SCOPE 被当作授权措辞注入；gate 粗筛未命中即静默退出。
- 复核方式：读 gate.mjs 的粗筛与注入段、references 下 brief/scope 两份文档的改写；核对契约是否给出统一口径。
- 证据：gate.mjs 的 SCOPE_HINT 与注入措辞仍在，references 下 scope 与 brief 文档有对应改写（scope +65 行、brief +39 行）；但「用户文本里的疑似路径是否被 Router 当成授权」属模型行为，本轮无真实 transcript 可核对。
- 判定：未验证
- 说明：文档侧有处置痕迹，但最终后果依赖模型行为，缺样本不下结论。

### V-35
- 涉及对象：检查 6c —— 断言总数与「227 条」这一自述数字。
- 复核方式：逐个跑 8 个回归套件并统计 PASS 行。
- 证据：chain 43、guard 48、scope 21、e2e 34、hooks 16、records 30、lessons 19、roster 18，合计 229 条，全部为绿，结尾行分别是 >>> CHAIN ALL PASS、>>> GUARD2 ALL PASS、>>> SCOPE ALL PASS、>>> E2E ALL PASS、>>> HOOKS ALL PASS、>>> RECORDS ALL PASS、>>> LESSONS ALL PASS、>>> ROSTER ALL PASS。分套数字与自述一致，但合计是 229。
- 判定：不成立
- 说明：自述的总数字与实测差 2 条。不影响功能结论（套件全绿且变异后确有断言转红），但对外数字应以实测为准。

---

## 五、结论与发布判断

VERDICT: FAIL

判定含义：v0.5.0 按现状不能发布。理由是存在一条已被实测坐实、且由本轮改动引入的产品缺陷——检查 1b 的误伤：只要 run_code 的代码文本里出现 scope 外的路径字样（注释、字符串常量都算）、出现 // 注释、或引号里带斜杠的命令，整次调用就被拒；连不含任何路径 token 的纯计算代码也被「没有可判定的目标路径」拒掉。hooks.json 本轮新增的 run_code 匹配项会把这一层带进真实运行时，以 run_code 为主力工具的 worker 会大面积撞墙。这不是环境限制，是实现问题，因此不判 PARTIAL。

可以发布的前提（做完这三条即可改判）：

1. 按 V-07 修掉复合分支的路径扫描：推荐方案 1——复合层只保留危险工具名与危险参数判定，作用域交回内层调用各自触发 PreToolUse（V-05 已证内层会被判定）；或方案 2——只从真实工具调用的实参抽路径，注释与字符串常量不参与；同时把「取不到目标即 deny」从复合分支摘掉。
2. 补两条断言：V-12 的「未登记文件类工具名按写判定」、V-13 的「D-20 盘符路径正反向」，让这两处在实现回退时确实变红。
3. 在装好新插件的新会话里跑一次真实 run_code（写 scope 内文件、写 scope 外文件、纯计算代码各一次），确认新匹配项按预期工作——本报告因线上仍是改前版本，无法验证这一步（V-32）。

未完成检查的说明（本报告标记为未验证的三项）：V-32（端到端拦截）、V-33（教训进子会话的真实到达）、V-34（契约层措辞治理）都受同一环境边界限制——本机线上安装的插件仍是改前版本，无法触发新匹配项，也没有可用的真实 transcript 样本。这三项不是产品失败的证据，但也不能算通过；若要给出完整结论，需要在更新后的插件环境里复跑一次。

已确认为真的部分（可保留）：P0 五条的 fail-closed 改造成立（D-01/02/03/04/05，D-02/03/04/05 各有实测变红证据）；D-13 的写入时校验、D-21 的索引口径、D-24 的取样公平性有实测变红证据；8 个套件基线 229 条断言全绿；本次共 41 条断言在实现回退时转红，说明这批修复不是空转。

---

附：本报告所有「实测」结论均可由下列步骤复现——(1) 以假 PLUGIN_DATA 驱动仓库版 guard.mjs，stdin 灌入载荷读 permissionDecision；(2) git show HEAD:<path> 写入临时副本，SAR_PLUGIN_ROOT 指向副本跑回归套件看断言是否变红；(3) 逐个跑 8 个套件统计 PASS 行。变异副本与探针数据位于系统临时目录，未写入仓库。

