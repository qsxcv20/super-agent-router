# D-110 独立验收报告（v0.5.11 补验）

- 验收方：独立验收方（子会话 verifier，本会话 id mvs_4fb48727ad654a21a7fa6933509cb49f）
- 被验收对象：**D-110 一条**（台账 docs/audit/defect-ledger.md 的 ### D-110 条，L692-L700），其余条目不在本单范围。

> **落点说明**：本文件是 `docs/audit/.tmp-verify-v0511/verification-d110.md` 的**入库副本**（`.tmp-*/` 在 .gitignore 里，不入版本库）；验收方报告原文未改。

- 判据出处：父会话本单的验收清单（6 条勾选项）+ 台账 D-110 条的「修法方向 / 需要什么」+ 契约 S1（状态词表）/ S10（零欠账 4 条）。
- 纪律：成员自述数字（16 套 / 1051 条 / MISS=0）一律未采信，全部自己重跑；变异体只落在本单可写目录，真实仓库一个字节未动；结论只有 PASS / FAIL。
- 原始输出归档：docs/audit/.tmp-verify-v0511/raw（20-21-22 系列文件，含 CMD 行、EXIT 与原始输出）。

## 0. 结论摘要

| # | 检查项 | 实测 | 判定 |
|---|---|---|---|
| 1 | 零欠账套件：exit 0、D-110-D1~D5 存在且绿、D-94-D6 绿 | exit 0；5 条新断言全绿；D-94-D6 PASS :: exit=1 | PASS |
| 2 | 自造变异体：派生改回写死 / 注入退化成空操作 ⇒ 专属断言必须变红 | A 只红 D-110-D1；B 只红 D-110-D2；基线副本 66/0 | PASS |
| 3 | 变异矩阵：exit 0、MISS=0、M-D110a/M-D110b 恰好红一条 | exit 0；MISS=0；两条均恰好红一条 | PASS |
| 4 | 全量回归：exit 0、16 套全绿、自报条数 | exit 0；16 套 / 1051 PASS / 0 FAIL（我自己数） | PASS |
| 5 | 台账：12 项全 PASS、114 条、待复核 0 | 12 项 PASS；114 条；待复核 0（我独立重算） | PASS |
| 6 | D-110 状态字段与证据相符 | 已修（v0.5.11 …）；三处逐字相同；台账自洽检查无异议 | PASS |

**总判定：PASS。**

另有 **1 条附加观察（候选新缺陷，尚未登记台账）**：D-110 的字节自检只比较字符串、不校验改动落到了目标字段 ⇒ 手法仍可能「字节变了但故障没造成」而 4 条自检全绿（见 2.2 与 3 节）。它不推翻 D-110 的判定（台账登记的触发条件是「版本号写死导致 replace 空操作」，该路径已被完整覆盖），但同族的残余面建议由父会话决定是否登记。

## 1. 检查①：零欠账套件（tests/zero-debt-test.mjs）

命令：node tests/zero-debt-test.mjs　退出码 **0**（raw/20-zero-debt-test.txt 首行 EXIT=0）

五条 D-110 专属断言的原文（按实际输出顺序）：

```
PASS D-110-D1 注入用的版本号必须从当前版本派生（写死 ⇒ 下次升版复发） :: current=0.5.11 derived=0.5.12 probe(9.9.7)=9.9.8
PASS D-110-D3 造故障手法自检 · README 版本字面量：字节确实被改掉了
PASS D-110-D4 造故障手法自检 · README handler 数：字节确实被改掉了
PASS D-110-D2 造故障手法自检 · manifest 升版：字节确实被改掉了
PASS D-110-D5 造故障手法自检 · README 脚本数：字节确实被改掉了
```

D-94-D6（原被这条缺陷打红的断言）现在为绿：

```
PASS D-94-D6 plugin.json 升版而文档没跟 ⇒ 退出码非 0 :: exit=1
```

套件结尾：

```
>>> ZERO-DEBT ALL PASS
```

实现落点核对（tests/zero-debt-test.mjs）：版本派生 nextVersion（L378-382，读当前版本后末段 +1，不写死字面量）；readManifestVersion（L385-390，读 JSON 不靠正则猜字段）；replaceManifestVersion（L393-396，只换 version 字段）；bumpManifestVersion（L399-402，派生过程一并返回供断言盯）；injectFault（L407-416，替换后断言字节真变了，没变就打印「造故障的手法失效了（D-110）」并 exit 1）。

判定 PASS。

## 2. 检查②：验收方自造变异体（字节级副本，真实仓库未动）

做法：把 README.md、docs/audit/defect-ledger.md 与 plugin/ tests/ tools/ 三个目录字节级复制到 docs/audit/.tmp-verify-v0511/d110copy/，只在副本的 tests/zero-debt-test.mjs 上改，再以 SAR_REPO_DIR 指向副本跑套件（与仓库自带矩阵同一套复制口径）。

### 2.1 关键一问：新断言会不会自己变成新的死代码 —— 否

### 变体 A：把版本派生改回写死（父会话要求的形态之一）

改法：把 nextVersion 的派生语句改成写死返回值。锚点命中 1 次。

```
BASELINE exit=0 pass=66 fail=0
MUTANT_A hardcoded-derivation anchor_hits=1 exit=1 pass=65 fail=1
  RED FAIL D-110-D1 注入用的版本号必须从当前版本派生（写死 ⇒ 下次升版复发） :: current=0.5.11 derived=0.5.12 probe(9.9.7)=0.5.12
```

恰好红一条，且就是 D-110-D1；详情里 probe(9.9.7)=0.5.12 直接暴露「派生被写死」。副本基线 66/0 ⇒ 这条断言是被真断言钉住的，不是恒绿。

### 变体 B：把注入退化成空操作（我自选的写法，与仓库自带 M-D110b 不同）

改法：把 replaceManifestVersion 的替换回调改成保留原值（a + next + c ⇒ a + v + c），使替换后字节与原文完全相同。锚点命中 1 次。

```
MUTANT_B no-op-injection anchor_hits=1 exit=1 pass=60 fail=1
  RED FAIL D-110-D2 造故障手法自检 · manifest 升版：字节确实被改掉了 :: 造故障的手法失效了（D-110）：替换后字节与原文完全相同 ⇒ 假故障没造成
```

恰好红一条，且就是 D-110-D2。判定 PASS —— 新断言**不会自己变成新的死代码**：手法一旦失效，它当场转红并自带失败原因。

### 2.2 两个补充变体（用于界定自检的覆盖边界）

### 变体 C：注入写回原文（改动没落到磁盘）

改法：injectFault 里写回 before 而不是 after。锚点命中 1 次。

```
MUTANT_C write-not-landed anchor_hits=1 exit=1 pass=63 fail=4
  RED FAIL D-94-D3 根 README 的版本字面量与 plugin.json 不一致 ⇒ 退出码非 0 :: exit=0
  RED FAIL D-94-D5 README 的 handler 数与实际不符 ⇒ 退出码非 0 :: exit=0
  RED FAIL D-94-D6 plugin.json 升版而文档没跟 ⇒ 退出码非 0 :: exit=0
  RED FAIL D-94-D9 README 的脚本数与实际不符 ⇒ 退出码非 0 :: exit=0
```

### 变体 D：替换正则打错字段（更贴近真实误写）

改法：把 replaceManifestVersion 的正则键从 version 改成 description（字节会变，但版本字段没被改）。锚点命中 1 次。

```
MUTANT_D wrong-field anchor_hits=1 exit=1 pass=65 fail=1
  RED FAIL D-94-D6 plugin.json 升版而文档没跟 ⇒ 退出码非 0 :: exit=0
```

C 与 D 的共同含义：**4 条 D-110 字节自检（D-110-D2~D5）在这两个变体下全绿**，而下游 D-94 断言红。原因是自检只比较字符串（after !== before），不校验「改的确实是目标字段、且落盘内容确实是 after」。即：手法仍可能以「字节变了但故障没造成」的形式坏掉，而自检看不出来 —— 这与 D-110 原本要治的**症状类**（断言语焉不详地红）是同一条。详见第 3 节。

## 3. 附加观察（候选新缺陷，尚未登记台账 —— 不改变 D-110 的判定）

**观察名**：造故障的字节自检只比字符串，不校验目标字段/落盘结果 ⇒ 手法仍可能「字节变了但故障没造成」而自检全绿。

**触发条件**：injectFault 的自检判据是「替换串与原文不同」（tests/zero-debt-test.mjs:408 的 const changed = after !== before），而不是「目标字段确实变了 / 落盘内容确实是 after」。于是两类改动能绕过它：① 写回的内容不是 after（变体 C）；② 替换串确实变了，但改的是别的字段（变体 D，更贴近真实误写：正则键写错）。

**实测影响**：变体 C 下 4 条下游断言（D-94-D3 / D-94-D5 / D-94-D6 / D-94-D9）红而 4 条自检全绿；变体 D 下 D-94-D6 红而自检全绿。红的形态正是 D-110 原文批评的「断言语焉不详地红」—— 看不出是手法坏了还是机制坏了。

**与 D-110 判定的关系**：D-110 登记的触发条件是「版本号写死 ⇒ replace 成空操作」，该路径已被完整覆盖并被我的变体 A/B 与仓库自带 M-D110a/M-D110b 双向钉住；台账「修法方向」要求的「断言字节真的变了」也已逐字实现。故 D-110 判 PASS。本观察是同族残余面，台账尚无对应条目，是否登记由父会话决定。

**建议方向（不代做）**：把自检从「字符串不同」升级为「注入后重读该文件，断言目标字段确实变成了预期值（例如重读 manifest 后断言 version 字段 == 派生值）」，或「注入后立刻重跑一次检查器并断言其退出码非 0」。两者任一都能把 C / D 这两条残余路径变红。

## 4. 检查③：语义变异体矩阵

命令：node tests/fixtures/zero-debt-mutation-matrix.mjs .　退出码 **0**（raw/21-zero-debt-matrix.txt 首行 EXIT=0）

```
MATRIX_EXIT=0
基线：pass=52 fail=0 exit=0
M-D110a [D-110] 版本派生改回写死（下次升版就复发）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D110b [D-110] 替换手法退化成空操作（字节没变 ⇒ 假故障没造成）：套件 pass=46 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=12
```

MISS=0（20 个变异体全部被抓住）；M-D110a / M-D110b 两条均「恰好红一条」，无 EXTRA-RED。EXTRA-RED 合计 12（照实记）：M-D87a=1、M-D87c=5、M-D87d=3、M-D89b=2、M-D89e=1，其余 13 个变异体 EXTRA-RED=0。判定 PASS。

计数口径备注（避免误读）：矩阵执行器用 /^PASS (?! )/ 计断言，**不含**检查器子输出里的「PASS  某某 == 某某」行，所以它的基线是 52；而 tools/run-tests.mjs 与我的独立计数用「行首是 PASS 」计（含子输出行），同一个套件是 66。两者都不是错，只是计数规则不同，本报告的条数一律按后者（并注明规则）。

## 5. 检查④：全量回归

命令：node tools/run-tests.mjs --all --root plugin --repo .　退出码 **0**（结尾 >>> SHELL ALL PASS）

我自己用独立脚本逐套跑并逐套数（计数规则：行首为 PASS 的行数），结果与仓库 runner 一致：

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| chain-test.mjs | 0 | 70 | 0 |
| d27-mut-test.mjs | 0 | 14 | 0 |
| dispatch-release-test.mjs | 0 | 58 | 0 |
| e2e-test.mjs | 0 | 53 | 0 |
| fix-d80-d85-test.mjs | 0 | 49 | 0 |
| guard-test.mjs | 0 | 228 | 0 |
| hooks-test.mjs | 0 | 41 | 0 |
| ledger-test.mjs | 0 | 29 | 0 |
| lessons-test.mjs | 0 | 65 | 0 |
| loop-gate-test.mjs | 0 | 67 | 0 |
| member-identity-test.mjs | 0 | 64 | 0 |
| records-test.mjs | 0 | 52 | 0 |
| roster-test.mjs | 0 | 38 | 0 |
| scope-amend-test.mjs | 0 | 119 | 0 |
| scope-test.mjs | 0 | 38 | 0 |
| zero-debt-test.mjs | 0 | 66 | 0 |
| **合计** | 全 0 | **1051** | **0** |

16 套全绿、0 FAIL、退出码 0。判定 PASS。

## 6. 检查⑤：台账自洽

命令：node tools/ledger-check.mjs　退出码 **0**

```
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
```

12 项全 PASS。我自己解析明细段独立重算（不看统计行）：

```
明细条数 = 114（索引行 114 / 修复状态表并集 114）
严重度：P0=11  P1=45  P2=42  P3=16   （越界 0 条）
状态：已修=107  未修=0  设计边界=5  宿主侧不可修=2  待复核=0   （越界 0 条）
```

**待复核 0**；114 条。判定 PASS。

## 7. 检查⑥：D-110 的状态字段与证据是否相符

台账原文（docs/audit/defect-ledger.md L698）：

- 状态：已修（v0.5.11 · 父会话独立复跑全量回归 16 套 / 1051 条 / 0 FAIL · 专属断言 5 条 + 变异体 2 个 MISS=0）

三处状态格逐字相同（我独立解析）：索引行 L147 = 明细段 L698 = 修复状态表 L1855 = 已修（v0.5.11 · 父会话独立复跑全量回归 16 套 / 1051 条 / 0 FAIL · 专属断言 5 条 + 变异体 2 个 MISS=0）；台账自洽检查（status-vocab / status-consistency / status-stats / no-unfixed）对它无异议。

「已修」所依据的证据逐条被我复跑确认：

- 全量回归 16 套 / 1051 条 / 0 FAIL ⇒ 属实（我自己数的条数与之一致）；
- 专属断言 5 条 ⇒ 属实（D-110-D1~D5 全在且全绿）；
- 变异体 2 个 MISS=0 ⇒ 属实（矩阵 MISS=0，M-D110a/M-D110b 恰好红一条）；
- 台账「修法方向」两条要求（版本号从假仓库 manifest 派生；注入后断言字节真变了）⇒ 逐字落到实现（tests/zero-debt-test.mjs:378-402 与 :407-416）。

**没有发现「已修」与证据不符**，故不判 FAIL。判定 PASS。

一处台账文字不一致（不影响判定，报给父会话）：D-110 的「需要什么」写的是「修完后全量回归 16 套 / **1046** 条 / 0 FAIL」，而它的状态行写 1051 条 —— 1046 是 D-110 修复前的套件条数（我在上一单独立实测过 1046），加了 5 条新断言后是 1051。实测与状态行一致，「需要什么」那一行的数字是旧值。

## 8. 本轮未能验证的面（逐条）

U1 **真实升版流程下的复发检验**：本单用行为级变体（把派生改回写死）复现「下次升版复发」，并未真的把 plugin.json 升到 0.5.12 再跑一遍 —— 本单不改 plugin/ 下文件，也不改版本号。派生逻辑本身用探针验证（probe 9.9.7 ⇒ 9.9.8），但「真升版后 D-94-D6 仍绿」只能等下一次真实升版实测。

U2 **宿主侧/流程侧的保证**：谁在升版、升版时是否同步改 tests/ 里的派生逻辑，属发布流程，本单只验了机制侧。

U3 **非本机环境**：全部实测在 Windows + PowerShell + 本仓库完成；别的操作系统 / CI runner / 路径形态差异下的行为未验。

U4 **活体 hook 拦截**：本批次仍没有新的活体拦截证据（活体证据仍只有 D-97 那一轮）；本报告不主张活体已验证，也不把「回放正确」写成「活体已验证」。

U5 **写入未落地这类失败在真实环境的发生概率**：我只证明了机制上存在该盲区（变体 C / D 可复现），没有证明它在真实环境里会发生。

U6 **check-version-consistency.mjs 在别的平台/路径形态下的行为**未验。

U7 **D-110 之外的缺陷**：本单只覆盖 D-110 一条；台账其余 113 条不在本单范围（其中 D-107~D-109 是上一单已覆盖的范围）。

## 9. 附录：产物与仓库未被改动的机械证据

9.1 产物（全部写在 docs/audit/.tmp-verify-v0511/ 下）

- verification-d110.md —— 本报告。
- raw/20-zero-debt-test.txt —— 零欠账套件完整原始输出。
- raw/21-zero-debt-matrix.txt —— 变异矩阵完整原始输出。
- raw/22-d110-mutant-*.txt —— 我自造变体的基线与 A / B / C / D 四次运行原始输出。
- d110copy/ —— README.md + 台账 + plugin/ tests/ tools/ 的字节级副本，四个变体都在其上施加。

9.2 仓库未被改动

- 四个变体全部跑在 docs/audit/.tmp-verify-v0511/d110copy/ 的副本上；每次变体前都重新复制（rmSync + copyFileSync + cpSync），副本与源来自同一份字节。
- 真实仓库的 tests/zero-debt-test.mjs、tests/fixtures/zero-debt-mutation-matrix.mjs、tools/ledger-check.mjs、plugin/ 下任何文件，本单未写入。

9.3 判定结论

检查①~⑥ 全部 PASS。总判定：PASS。
另附 1 条候选新缺陷（第 3 节）：字节自检只比字符串、不校验目标字段/落盘结果 —— 不改变 D-110 的判定，建议由父会话决定是否登记台账。
### 9.4 终态 git status 对账（本单结束时）

命令：git status --short　输出原文：

`
 M .superagent/STATUS.md
 M .superagent/methods/sa-plugin-release.md
 M docs/audit/verification-v0511-release.md
`

读法：**tools/ tests/ plugin/ 三个目录下没有任何改动条目** ⇒ 被验对象（tests/zero-debt-test.mjs、tests/fixtures/zero-debt-mutation-matrix.mjs、tools/ledger-check.mjs、tools/run-tests.mjs、plugin/）本单一个字都没动过 —— 比「与我开始时的列表比对」更强：它们现在相对 HEAD 是干净的，而我的四次变异体全部施加在 docs/audit/.tmp-verify-v0511/d110copy/ 的副本上。

上面这 3 项与本单无关（编排状态与发布侧记录，由父会话侧改动）；本单的产物全在 docs/audit/.tmp-verify-v0511/ 下，该目录被 .gitignore 忽略，故不出现在 git status 中。
