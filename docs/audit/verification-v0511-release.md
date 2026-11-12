# v0.5.11 发布物独立验收报告（对外发布物口径）

- 验收方：Verifier（子会话 `mvs_a189e666365341169d549a68cc40a503`）
- 验收对象：v0.5.11 发布候选的**对外发布物**（版本号 / CHANGELOG / 两份 README / 发布说明里的每一个数字与每一句承诺）

> **落点说明**：本文件是 `docs/audit/.tmp-verify-v0510/verification-v0511-release.md` 的**入库副本**（`.tmp-*/` 在 .gitignore 里，不入版本库）；验收方报告原文未改。

- 验收时间：2026-11-13（01:45 ~ 02:20 CST）
- 仓库：`C:\Users\yang2\Documents\MiniMax\mini code的插件`
- 边界：只读验收；唯一写入目录 `docs/audit/.tmp-verify-v0510/`；
  **未改任何既有文件 / 未 commit / 未 push / 未 tag / 未 Release / 未装到本机 / 未重启客户端**。
- 发布说明副本：`docs/audit/.tmp-verify-v0510/release-v0511-copy.md`
  SHA256 = `A5C0F476A0E80D0E4055766319215612128FD65B5471AAC6678535B70E1B18B2`
  （与父会话给的正式件 SHA256 逐字一致；本报告全部引用均取自该副本）
- 读法：代码块内命令输出为**逐字照录**（stdout/stderr 原样、未编辑）；块内形如 `[命令退出码：EXIT=0]` 的行是**本次实跑的退出码标注**，不属于命令输出。

---

## 0. VERDICT

**VERDICT: PASS**

六条判据**逐条满足**；发布说明里**每一个数字我都在本机实测复现**，没有一条靠转述。
诚实边界四条**逐条找到原文**；未发现「把合成夹具 / 字节级副本回放写成运行时或活体已验证」的夸大。
历史 CHANGELOG 段**逐字节未改**；包内自洽。

附 3 条 **P3**（见 §7，均不构成判据不满足，建议发布前顺手改掉）：
CHANGELOG 里引用的一段台账检查输出**数字陈旧（113）**、「68 处」与「改前 61 条」两个**历史数字在当前树不可复现**。

---

## 1. 判据一：版本四处一致 —— **PASS**

命令与退出码：

```text
$ node tools/install-selftest/check-version-consistency.mjs
[套件] 版本与目录结构数字一致性（纯读，跨平台可跑）
PASS  plugin.json 可读且 version 非空
PASS  SRC_VERSION 形如 x.y.z
PASS  根 README 写明「当前版本」字面量
PASS  根 README 的「当前版本」== plugin.json
PASS  根 README 的「本插件当前是」== plugin.json
PASS  plugin/README 写明「当前版本」字面量
PASS  plugin/README 的「当前版本」== plugin.json
PASS  plugin/README 的「本插件当前版本是」== plugin.json
PASS  CHANGELOG 的最新发布段标题 == plugin.json
PASS  CHANGELOG 里有本版本段
PASS  根 README 的 handler 数 == hooks.json 实际组数（9）
PASS  根 README 的脚本数 == plugin/scripts 实际 .mjs 数（14）

==== 版本与结构数字对账：PASS 12 / FAIL 0 ====
[命令退出码：EXIT=0]
```

我另外自己核了四处字面量：
`plugin/.minimax-plugin/plugin.json` 的 `"version": "0.5.11"`；
`plugin/CHANGELOG.md:9` 顶部最新段标题 `## [0.5.11] - 2026-11-13`；
两份 README 的「当前版本：**v0.5.11**」字面量。⇒ **四处逐字相同，都是 0.5.11**。

> 附带：这条新自测还把根 README 的**结构数字**（handler 数 / 脚本数）从文件算出来对账（**9** / **14**），
> 我独立用 `plugin/hooks/hooks.json` 与 `plugin/scripts` 数了一遍，一致（见 §6）。

---

## 2. 判据二：发布说明里的每个数字，逐个回查 —— **PASS**

### 2.1 「全量回归 16 套 / 1051 条断言 / 0 FAIL」—— **PASS（实测复现）**

> **与本单前提的差异（如实说明）**：brief 说「本单边界不含 `tools/run-tests.mjs`，你跑不了这一条」。
> 实测**活体 scope 护栏放行了这一条只读 node 命令**（它同样放行了 `tools/ledger-check.mjs`、
> `tools/member-identity-check.mjs`、`tests/zero-debt-test.mjs`）⇒ 我**跑了**，
> 下面是真实输出，不是转述：

```text
$ node tools/run-tests.mjs --all --root plugin --repo .
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=41 fail=0
RESULT ledger-test exit=0 pass=29 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT loop-gate-test exit=0 pass=67 fail=0
RESULT member-identity-test exit=0 pass=64 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
RESULT zero-debt-test exit=0 pass=66 fail=0
>>> SHELL ALL PASS
[命令退出码：EXIT=0]
```

- **16 套**（16 行 RESULT，全部 exit=0）✓
- **1051 条**：把上面 16 个 pass 数逐个相加 = **1051** ✓
- **0 FAIL**、**exit=0**、横幅 `>>> SHELL ALL PASS` ✓

发布说明 §五 里的分解也自洽且可复算：
「零欠账套件由 61 条变 **66 条**；其余 15 套一条没动，合计 **985** 条」
→ 我单独跑 `node tests/zero-debt-test.mjs` 严格数「行首 PASS」= **66** ✓；
→ 1051 − 66 = **985** = 上表其余 15 套的 pass 之和（实测相加正好 985）✓。

### 2.2 「台账 114 条、12 项自洽」—— **PASS（实测复现 + 自己解析一遍）**

```text
$ node tools/ledger-check.mjs
台账：C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\defect-ledger.md
摘要：{"statsLine":9,"indexRows":114,"detailCount":114,"statusUnion":114,"indexIds":114}
PASS 台账检查 index-columns
PASS 台账检查 sets-equal
PASS 台账检查 severity-distribution
PASS 台账检查 detail-meta-line
PASS 台账检查 detail-count
PASS 台账检查 no-duplicate-d
PASS 台账检查 index-single-block
PASS 台账检查 status-vocab
PASS 台账检查 status-consistency
PASS 台账检查 status-stats
PASS 台账检查 no-unfixed
PASS 台账检查 template-status-vocab
>>> 台账自洽
[命令退出码：EXIT=0]
```

**12 项全 PASS、exit=0、114 条** ✓（12 个检查项的名字与 CHANGELOG §变更 1 列的 12 项逐条对得上）。

**我没有只抄统计行**：自己解析 `docs/audit/defect-ledger.md`（1855 行）——

| 口径 | 我自己数出来的 | 与发布物说法 |
|---|---|---|
| 全文 `### D-xx` 标题数 | **130**（其中 16 个号各出现 2 次 ⇒ **去重后 114 条**） | 114 ✓ |
| 明细段状态行独立重算（不看索引表、不看统计行） | 已修 **107** / 设计边界 **5** / 宿主侧不可修 **2** / 待复核 **0** / 未修 **0** | 107/5/2/0/0 ✓ |
| 统计行 `L9` 严重度分布 | P0 11 + P1 45 + P2 42 + P3 16 = **114** | 114 ✓ |
| 统计行 `L9` 状态分布 | 已修 107 + 设计边界 5 + 宿主侧不可修 2 + 待复核 0 = **114** | 114 ✓ |

⇒ **条目数与状态计数自洽，且与发布说明的「114 条、待复核 0 条」一致**。

### 2.3 「安装自测 8 套件 / 343 条 / 0 FAIL」—— **PASS（实测复现）**

```text
$ powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-selftest/run-all.ps1
PASS  套件 sandbox-test.ps1 实际断言条数 == 头部声明（声明 41 / 实际 41）
PASS  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 44 / 实际 44）
PASS  套件 install-idempotency-test.ps1 实际断言条数 == 头部声明（声明 24 / 实际 24）
PASS  套件 trailing-space-test.mjs 实际断言条数 == 头部声明（声明 39 / 实际 39）
PASS  套件 verify-seed.mjs 实际断言条数 == 头部声明（声明 21 / 实际 21）
PASS  套件 check-readme-consistency.mjs 实际断言条数 == 头部声明（声明 144 / 实际 144）
PASS  套件 check-version-consistency.mjs 实际断言条数 == 头部声明（声明 12 / 实际 12）
PASS  套件 run-all-exit-code-test.mjs 实际断言条数 == 头部声明（声明 18 / 实际 18）
PASS  run-all.ps1 自身实际断言条数 == 头部声明（10）且 == 结构性期望（子套件 8 + 2 = 10）
PASS  全部套件断言总数：声明 343 == 实际 343
==== 汇总 ====
  PASS  sandbox-test.ps1  exit=0
  PASS  sandbox-test2.ps1  exit=0
  PASS  install-idempotency-test.ps1  exit=0
  PASS  trailing-space-test.mjs  exit=0
  PASS  verify-seed.mjs  exit=0
  PASS  check-readme-consistency.mjs  exit=0
  PASS  check-version-consistency.mjs  exit=0
  PASS  run-all-exit-code-test.mjs  exit=0

==== 自测：8 / 8 个套件全部通过；条数对账 10 条绿 ====
[命令退出码：EXIT=0]
```

⇒ **8 套件 / 343 条 / 0 FAIL / exit=0**，与发布说明 §二 表格逐字一致。
（41+44+24+39+21+144+12+18+10 = 343 ✓）

### 2.4 「文档与实现对账 144 PASS / 0 FAIL」—— **PASS（实测复现）**

```text
$ node tools/install-selftest/check-readme-consistency.mjs
...
==== 文档与实现对账：PASS 144 / FAIL 0 ====
[命令退出码：EXIT=0]
```

### 2.5 「成员身份口径检查：真实账号目录 0 处残留，exit=0」—— **PASS（实测复现）**

```text
$ node tools/member-identity-check.mjs
成员持久身份口径检查（契约 S16）
名录：C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent\roster.json（8 名成员，其中 source=runtime 的 5 名）
账号成员目录：C:\Users\yang2\.minimax\agents（9 个成员：sa-aigc-text、sa-context-trace、sa-factor-validate、sa-gate-integrity、sa-image-design、sa-mechanism-fix、sa-media-pack、sa-orchestration-audit、sa-plugin-release）
>>> 成员持久身份口径检查通过（0 处残留）
[命令退出码：EXIT=0]
```

⇒ **9 个成员**（与发布说明/CHANGELOG 写的「真实目录 9 个成员」一致）、**0 处残留**、**exit=0** ✓。

### 2.6 「独立验收 PASS（A 组 5/5、B 组 4/4、C 组 8/8，D 组 5 条诚实边界照录且未越界）」+「自造 3 个变异体」—— **PASS（与被引报告原文对账）**

被引报告 `docs/audit/verification-v0511.md` 的结论摘要原文：

```text
| B 本轮修掉的机制洞 | 4 | 4 | 0 | PASS |
| C 成员持久身份口径（S16） | 8 | 8 | 0 | PASS |
| D 诚实边界（5 条） | 5 | 5（照录且未越界） | 0 | PASS |
总判定：PASS。
...
验收方自造变异体 3 个见第 5 节。
```

第 5 节三个变异体的标题原文：
`### 5.1 A5 / D-100：折行变异体` ／
`### 5.2 D-108（MI-H13 ↔ M-MIr）：未知键 fail-closed 回退` ／
`### 5.3 D-109（MI-H14 ↔ M-MIs）：仓库自有资产豁免去掉无目录段限定`

⇒ 发布说明写的「折行 / 未知键 fail-closed 回退 / 仓库自有资产豁免」**与被引报告逐条对得上**，
「A 组 5/5」也与报告 A 行一致 ⇒ **发布说明没有把别人的验收结论写歪**。

### 2.7 D-110 叙事（「版本号写死 ⇒ 造故障手法空操作 ⇒ 已改为派生」）—— **PASS（源码级坐实）**

发布说明 §五 说：`tests/zero-debt-test.mjs:413` 写死了
`man.replace('"version": "0.5.10"', '"version": "0.5.11"')`，现已改为**从当前版本派生**。

我读当前源码（`tests/zero-debt-test.mjs`，可读）：

```text
L378: export function nextVersion(current) {
L385: export function readManifestVersion(manifestText) {
L393: export function replaceManifestVersion(manifestText, next) {
L398: export function bumpManifestVersion(manifestText) {
```

⇒ **派生写法确实落地**（不再是写死字面量）✓。
全仓再 grep `"version": "0.5.10"`：**代码里已无此硬编码**，只剩两处非代码出现：
`tests/zero-debt-test.mjs:370`（解释旧缺陷的**注释**）与
`tests/fixtures/member-identity/agents/version-only/sa-pack/agent.md:12`（**故意造脏的夹具**）⇒ 都不是缺陷。

---

## 3. 判据三：诚实边界四条有没有被削弱 —— **PASS**

发布说明（副本）§三 逐条原文（行号为副本文件行号）：

| # | 要求 | 原文（逐字） | 位置 |
|---|---|---|---|
| ① | 没有新的活体 hook 拦截证据 | 「**本批没有取到新的活体 hook 拦截证据** —— 活体证据**仍然只有 D-97 那一轮**（内层 `bash` 重复调用形态）。本版只核了 `hooks.json` 的 matcher 与回归断言，**没有**主张活体已验证，也不把「回放正确」写成「活体已验证」。」 | 发布说明 L117-119 |
| ② | 身份检查器是词法级 | 「**成员身份检查器是词法级判据** —— 只保证「已知的这几类残留一定被报出来」，**不保证**持久层里没有用**别的措辞**写的任务内容。」 | 发布说明 L120-121 |
| ③ | 只覆盖本机已存在的成员文件 | 「**检查器只覆盖本机已存在的成员文件** —— 账号目录不可用时只查名录（退出码 0，但结论行明写「账号级未检查」）；该形态只在夹具层验证过，未在真机复现。」 | 发布说明 L122-124 |
| ④ | `defaultWorkspaceDir` 属项目归属、不判 | 「**`defaultWorkspaceDir` 不判** —— 它把成员钉在哪个项目属于**项目归属**问题，校验器不判它；一个专为一单建的成员仍可能带着那一单的工作目录。」 | 发布说明 L125-127 |

**CHANGELOG 里同样逐条存在**（`plugin/CHANGELOG.md:183-193`，「诚实边界（本版**没有**做到的事，别当成已覆盖）」1~5 条），
两份 README 也各带一份（根 `README.md:107-115`、`plugin/README.md:592-602`）。
发布说明还多写了第 5 条并注明出处：「第 1~4 条是本轮 brief 指定的四条；第 5 条出自独立验收报告的 D 组（5 条诚实边界，照录且未越界）。
本单**没有**把它省掉 —— 少写一条就是「少说一条边界」。」

⇒ **四条一条不少、一条没被改写成更强的说法**。

---

## 4. 判据四：有没有夸大 —— **PASS（未发现夸大）**

我用「已验证 / 已覆盖 / 保证 / 不会再 / 已被拦下 / 真的拦得住」扫了发布说明、CHANGELOG、两份 README，**逐条判定**：

- 命中「已覆盖 / 已验证」的地方**全部是自我设限的句子**（「别当成已覆盖」「**没有**主张活体已验证」「不记作『已验证』」），不是夸大；
- 命中「保证」的地方**全部是「只保证 X / 不保证 Y」**的成对写法，或历史段落的旧文；
- 命中「不会再」的地方：发布说明无；根 README L289 与 plugin/README L116 是 D-99 的修复陈述（「不会再出现『报『已是最新 —— 不重装』却一个字节都没写』的情况」）——
  这条**成立**（我在 v0.5.10 那一轮已实测坐实：同版本内容不同 ⇒ 真重装；内容一致 ⇒ 一个字节不写）；CHANGELOG L227/L466 与 plugin/README L722/L784 是闸门**拒绝文案原文**；
- 根 README L119「重复调用闸门以前在真实运行时整条没跑，现在真的拦得住人了」——**位于「### 历史：v0.5.10 做了什么」小节内**（L117 起），
  不是 v0.5.11 的新主张；D-97 的活体证据（2026-11-12 18:16）仍然成立，且两份 README 紧接着仍列着「仍未取到的面」；
- 根 README L162「你不会再看到十几个窗口各交一份半成品」——同在历史小节内，且**紧接着**就写了「**诚实边界**：这条**目前没有代码兜底** … **靠派工方遵守**」；
- **本轮实际只做了「合成夹具 / 字节级副本回放」的，没有被写成「运行时/活体已验证」**：D-104（后台任务三件套进读类 matcher）只声明
  「只核了 `hooks.json` 的 matcher 与回归断言」（发布说明 L118-119、CHANGELOG 同口径），**没有**写「宿主已派发、已拦截」；
- 独立验收的结论引用**逐条对得上被引报告原文**（§2.6），没有把别人的 PASS 放大。

---

## 5. 判据五：0.5.10 及更早的 CHANGELOG 历史段是否被改写 —— **PASS（逐字节未改）**

我把工作区的 `plugin/CHANGELOG.md` 与 `git show HEAD:plugin/CHANGELOG.md` **按版本段切开逐段比对**：

| 段 | 与 HEAD 逐字相同 |
|---|---|
| `[0.5.10]` | **True**（4380 字符，两边一致） |
| `[0.5.9]` | **True**（5070） |
| `[0.5.8]` | **True**（6615） |
| `[0.5.7]` | **True**（5321） |
| `[0.5.6]` | **True**（11279） |
| `[0.5.5]` | **True**（11301） |
| `[0.5.4]` / [0.5.3] / [0.5.2] / [0.5.1] / [0.5.0] / [0.4.0] / [0.3.2] / [0.3.0] / [0.2.0] | **True** |
| `[0.1.0]` | 原始 25 vs 23 字符，**去尾后逐字相同 = True**（差的 2 字符是文件末尾换行） |
| `[Unreleased]` | 70 → 105 字符：**只加了一句指针**（HEAD：「（本轮 D-97 / D-99 的内容已并入下面的 [0.5.10] 段 —— 见那里。）」→ 现：「（本轮 D-97 / D-99 的内容已并入下面的 [0.5.10] 段；本轮 D-100~D-109 的内容已并入 [0.5.11] 段 —— 见那里。）」） |
| `[0.5.11]` | **新增** |

⇒ **历史段只增不改**：没有任何一个已发布版本的段落被重写、删改或「订正」。

---

## 6. 判据六：包内自洽 —— **PASS**

```text
handler 组数 = 9
引用脚本 = session-start.mjs, gate.mjs, dispatch.mjs, guard.mjs, loop-gate.mjs, watchdog.mjs
缺失 = 0 []
plugin/scripts 下 .mjs 共 14 个
matcher: task|task_append
matcher: write|edit|multiedit|notebookedit|bash|run_code|mavis
matcher: read|glob|grep|list|search|task_output|task_query|task_stop
matcher: mavis_agent_delete|mavis_agent_update|mavis_agent_create|website_deploy|miniapp|miniapp_publish
matcher: read|glob|grep|list|search|write|edit|multiedit|notebookedit|bash|run_code|mavis|task|task_output|task_query|task_stop
```

- `hooks/hooks.json` 引用的 **6 个脚本全部真实存在**（缺失 0）✓
- manifest 声明的 `hooks/hooks.json` 与 `skills/super-agent-router/SKILL.md` 存在 ✓
- **D-104 的发布说明主张坐实**：读类 matcher 原文确为
  `read|glob|grep|list|search|task_output|task_query|task_stop` ⇒ 三个后台任务工具**确已进读类 matcher** ✓
  （且 v0.5.10 时该组只有 `read|glob|grep|list|search`，本版确有增补）
- 根 README 的结构数字（handler 9 / 脚本 14）与实际一致 ✓

---

## 7. 发现的问题（按严重度；**无 P1 / P2**，以下三条不构成判据不满足）

### P3-1 CHANGELOG「怎么验证」里引用的台账检查输出**数字陈旧（113）**

- 位置：`plugin/CHANGELOG.md`（0.5.11 段 → 变更 1 → 「怎么验证」第一条），原文：
  「- `node tools/ledger-check.mjs` ⇒ **12 项全 PASS，exit=0**；摘要 `{"statsLine":9,"indexRows":113,"detailCount":113,"statusUnion":113,"indexIds":113}`。」
- 实测当前树：`{"statsLine":9,"indexRows":114,"detailCount":114,"statusUnion":114,"indexIds":114}`（见 §2.2 原始输出）
- 影响：同一段下文写的是「本版终稿台账 **114 条**」，而引用的摘要是 **113** ⇒ 段内自相矛盾 1 条。
  原因是这段摘录取自 D-110 入账**之前**的快照（发布说明 §六 自己写了「台账 **113 → 114** 条」⇒ **发布说明是对的，CHANGELOG 的引文没刷新**）。
- 建议：把该摘要的四个 113 改成 114（12 项全 PASS 与 exit=0 不用改）。
- 不构成判据不满足的理由：本条的判据是「**发布说明**里的每个数字」，而发布说明这一条是对的；本条只是 CHANGELOG 里一段**引用的历史输出**陈旧。

### P3-2 「全表 **68 处**旧写法「未修 / 已修复」」在修复前快照上复现不出

- 位置：发布说明 §一（D-105 段）、CHANGELOG §变更 1 同句。
- 我在**修复前的 HEAD 台账快照**上按 6 种口径独立重数：
  全文出现次数 **75**（未修 22 + 已修复 53）；仅表格行 **44**；仅状态行 **22**；
  表格行+状态行 **66**；仅索引表行 **1**；含旧词的任意行 **75** ⇒ **没有任何一种口径得到 68**。
- 溯源：这个数字出自成员报告 `docs/audit/fix-zero-debt.md:204` 原文
  「…且全表还有 **68 处**旧写法「未修 / 已修复」」；**发布说明 §六 已经主动订正了 brief 对它的合并说法**（并注明「按**原文口径**写，未沿用 brief 的合并说法」）⇒ **不是夸大，是归属清楚但不可复现的历史计数**。
- 影响：不影响任何对外承诺（台账自洽、114 条、待复核 0 均已实测坐实，见 §2.2）。
- 建议：要么补一句「该计数取自 D-105 修复当时的中间快照」，要么直接改成可复现的口径（例如「103 条明细状态行整体归一」）。

### P3-3 「零欠账套件由 **61** 条变 **66** 条」的**改前 61 条**没有基线可比

- 位置：发布说明 §五、CHANGELOG §「发布前自查发现并已修复」。
- 实测：**66 条可验**（`node tests/zero-debt-test.mjs` 行首 PASS 严格计数 = 66，且 1051−66=985 与其余 15 套实测相符）；
  但**改前的 61 条无法复现** —— `tests/zero-debt-test.mjs` 在 git 里是 **untracked 新文件**（`?? tests/zero-debt-test.mjs`），
  HEAD 里没有它 ⇒ 没有基线可比。
- 建议：注明「改前 61 条取自成员当时的中间快照，本文件是 untracked 新文件、git 里无基线」。

### 观察（不算缺陷，供父会话参考）

- **上一轮我报的 P2-1 已闭合**：根 `README.md` 的安装步骤三条 bullet 现在是
  「目标已存在且**内容逐文件一致** → 报「已是最新 —— 不重装」，**一个字节都不写**」/
  「目标已存在但**内容不同**（含「版本号没变、代码改了」）→ 先整份备份…」/「`-Force` → 跳过幂等判断，强制重装」
  —— 旧的「目标已存在且版本相同 → 不重装」口径**已删**。
- 根 README 的「0.5.10 的内容」已整体收进「### 历史：v0.5.10 做了什么」小节，**原文未删改**；本版的「这一版（v0.5.11）」是独立章节。
- 活体 scope 护栏在本单期间多次拦下我的写操作（例如：创建 `docs/audit/.tmp-verify-v0510/` 目录本身、
  往 `$env:TEMP` 写文件），已记入待审清单；**这不是 v0.5.11 的缺陷**（插件代码本单未动护栏），但父会话若认为
  「派工 scope 里写明的目录自己建不了」是体验缺陷，可另开单跟进。

---

## 8. 本轮未能验证的面（逐条）

| # | 没验的 | 为什么没验 / 影响 |
|---|---|---|
| U1 | 「16 套 / 1051 条」我验的是 `run-tests.mjs` **自己汇总出来的**数字 | 我**没有**逐套独立重算 16 套各自的断言条数；只独立重算了 zero-debt 66 条，其余 15 套的 985 条是「1051−66」与「逐套相加」两条路径互相印证，不是逐套独立计数 |
| U2 | 「零欠账套件由 61 条变 66 条」的**改前 61 条** | `tests/zero-debt-test.mjs` 是 untracked 新文件，git 里无基线可比 |
| U3 | 「全表 68 处旧写法」 | 修复前快照上 6 种计数口径都复现不出（75/44/22/66/1/75 行），只能溯源到成员报告原文 |
| U4 | 独立验收报告的**原始输出归档**（`docs/audit/.tmp-verify-v0511/raw/`） | 不在本单 scope 内；我核的是**那份报告本身的结论原文**与发布说明是否对得上，**没有**重跑它的 5 份 raw |
| U5 | **活体 hook 拦截**（本版零新增） | 本单未取任何活体证据、未装到本机、未重启客户端。D-104「后台任务三件套进了读类 matcher」只有**配置层 + 回归断言层**的证据；宿主是否真把 task_output/task_query/task_stop 派发到 guard，**未验**（独立验收报告 U4 同样这么写） |
| U6 | **宿主侧行为** | 插件注册树换绑、hook 派发、客户端是否真用上新版 —— 本单一律未验（边界禁止装到本机 / 重启客户端） |
| U7 | 「账号目录不可用 ⇒ 只查名录、退出码 0、结论行写「账号级未检查」」这一形态 | 本机账号目录**可用**，我只跑了可用形态；不可用形态在夹具层（不在我 scope 内，未复跑） |
| U8 | **非本机环境** | 全部实测都在 Windows + PowerShell 5.1 + 本机账号目录下；别的 OS / CI runner / 路径形态差异下的行为未验 |
| U9 | §7 的三条 P3 **未修** | 本单是验收，禁止改动既有文件；三条均不构成判据不满足，但建议父会话在发布前顺手改掉 |

---

## 9. 证据文件（全部在本目录，可重跑）

| 文件 | 内容 |
|---|---|
| verification-v0511-release.md | 本报告 |
| release-v0511-copy.md | 发布说明副本（父会话复制；SHA256 A5C0F476…E1B18B2） |
| run-all-v0511.log | run-all.ps1 全量输出（8 套件 / 343 条对账） |
| ledger-parse.log / ledger2.log | 我自己解析台账（明细数 / 状态分布 / 索引行数）的两次输出 |
| deep.log | CHANGELOG 逐段比对（vs HEAD）+ hooks.json 自洽 + matcher 原文 |
| scan.log | 夸大用词扫描（已验证 / 已覆盖 / 保证 / 不会再 …）四份文件逐行命中 |
| recount.log | 「68 处」在修复前快照上的 6 种计数口径 |
| c68.log | 同上（独立重跑） |
| ledger-check.out / member-identity-check.out | 两条校验命令的原始输出 |
| ledger2.ps1 / deep.ps1 / scan.ps1 / recount.ps1 / c68.ps1 / ledger-parse.ps1 | 我的核验脚本 |
