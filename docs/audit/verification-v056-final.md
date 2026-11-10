# v0.5.6 收口后 · 最终复核报告

- **复核方**：独立验收方（verifier）。本单 = 追加单「收口后的最终复核」。
- **复核基准**：HEAD ``a4dde9a``（父会话已把「4 项 → 5 项」计数订正**提交进版本库**）；复核期间父会话持续改动（HEAD 依次 ``7ff65c1`` → ``7e48e74`` → ``a4dde9a``），本报告以**最终读到**的文件内容为准。
- **环境**：win32 10.0.26200 x64 / Node v26.7.0 / PowerShell 5.1 / 会话 `mvs_26fc11cb8e99483697531140266df940`
- **时间戳**：2026-11-11 01:45 → 02:35 GMT+0800
- **写入边界**：唯一写入 = `docs/audit/.tmp-v055/`（本报告 + 3 个探针/工具脚本）。`plugin/` `tests/` `tools/` `docs/audit/*.md` 一行未改。

## 0. 一句话结论

**v0.5.6 可以发。** F-05~F-09 五项条件全部收住（逐条 PASS），收口时新挖出的 3 处台账不自洽全部闭合，永久台账断言六项全 PASS、`23 PASS / 0 FAIL / 0 WARN`、6 个变异体一个不少红、真实台账逐字节未变；十二套 787 条回归 0 FAIL（仓库副本与安装副本各一遍）、四个变异矩阵全 OK。**剩余阻塞项 0**；留下 3 项**非阻塞**的 P3 文档项（§8 F-1/F-2/F-3），以及机制侧 8 条**已如实登记**的未修与设计边界（交付报告 §7.5 已列）。

**VERDICT: PASS**

## 1. 复核方法与证据纪律

- 所有结论以**代码 / 实测输出**为准，不采信修复报告与交付报告的自述。
- 阴性结论一律配金丝雀 + 时间戳 + 会话/环境标识三件套。
- 变异检验统一走**系统临时目录里的插件副本**，仓库工作树零改动；每个开关**单开一个进程**并在子进程 env 显式 `delete` 其余三个开关。
- 回归跑在**仓库副本**（`%TEMP%\sar-rc-QJ21Bv`，由 `docs/audit/.tmp-v055/mkcopy.cjs` 生成，排除 `.git` 与 `docs/audit/.tmp-*`）；安装副本那一遍用 `--root C:\Users\yang2\.minimax\plugins\super-agent-router` 单独跑。

### 1.1 自曝：本轮的三次失误 —— **都是验收通道的工具限制，不是产品缺陷**

> 本节三条**全部属于「验收通道（bash 命令行）」的环境性质**，与被验产品无关。写在这里是为了不误导下一版去修一个不存在的产品问题。

1. **第一次把仓库副本路径抄错一位**（写成 `sar-rc-QC21Bv`，实际是 `sar-rc-QJ21Bv`）⇒ 第一次后台回归任务直接 `MODULE_NOT_FOUND` 失败。已按真实路径重跑才拿到 787 这个数。**失败的那次不计入证据。**
2. **自写 base64 编码器不支持非 ASCII** ⇒ 第一次写矩阵驱动脚本时中文正则被写坏（`node --check` 报 `SyntaxError: Invalid regular expression`），后端任务随之失败。已改为**纯 ASCII 源码**重写并 `node --check` 通过后才启动。
3. **报告正文走 bash 命令行时踩了三个坑**：命令里的 `"` 会**提前闭合 PowerShell 的双引号**；PowerShell 双引号串会把 **反引号**当转义符吃掉（实测：``AAA `BBB` CCC`` 写进去变成 `AAA BBB CCC`）；长 base64 参数在中途被改动。三条都是**通道性质**（本回合 PTC 工具集只有 read / bash / grep / glob / web_fetch / web_search / task_*，**没有 `tools.write`**，无法走非命令行写入通道）。已改用「反引号双写 + 非 ASCII 全转义 + 小块分片 + 逐块校验」写入，写完用 `read` 回读校验。

（本轮探针夹具无其它失误；上轮 5 处夹具误判见 `docs/audit/verification-v056.md` §1，不重复。）

## 2. F-05 ~ F-09 逐条核对
### F-05（PASS）D-85 的「影响」段已按实测改写

**复现步骤**：`read docs/audit/defect-ledger.md`（偏移 1281，`### D-85` 段）→ 看「影响」段。

**实际输出**（`defect-ledger.md:1288-1291`）：
> ⚠ 更正（v0.5.6 独立复验 F-05 实测）：这条请求**是能被批准的** —— `--grant` 返回 `ok:true`、`added:["/dev/null"]`、`audit_logged:true`，即空设备会被真的写进 scope。**因此残余不是「永远无法批准」，而是「批准它毫无意义 + 拦截文案给出的批准命令是无意义的」** —— 按旧表述去修会修错方向。

且 D-85 状态仍写「**待修**（本轮只记，不塞进已发布的修复）」⇒ 没有把「已知未修」虚报成已修。

**本轮亲见的运行时事实**（重跑上轮探针 `docs/audit/.tmp-v055/probe-v056-p5.mjs`，`TOTAL_FAIL=0`）：
```
PASS D-85 已知未修：重定向到空设备被当成写目标 → 记一条越界请求 :: requests=[{"request_id":"req_mwb00pyq_40ddga", ... "targets":["/dev/null"],"state":"pending", ...}]
D-85 RAW_GUARD {... "permissionDecision":"deny", ... "以下路径不在白名单内：/dev/null ... 已记入待审清单 req_mwb00pyq_40ddga ..."}
D-85 GRANT_RESULT exit=0 { "ok": true, "granted": "req_mwb00pyq_40ddga", "added": [ "/dev/null" ], "approved_by": "mvs_parent_p85", "audit_logged": true, ... }
```
代码层交叉印证：`grep "/dev/null|NUL|dev/stdout" plugin/scripts` → **0 命中** ⇒ 排除清单确实还没做。

⇒ 新表述与事实一致，**PASS**。

### F-06（PASS）7 条明细的「来源/严重度/归属层」行已补齐

| 条目 | 来源行（实测行号） | 严重度 |
|---|---|---|
| D-78 | `defect-ledger.md:1307` 来源：D-72 轮 N-01 ｜ 严重度：P2 ｜ 归属层：机制层 | P2 |
| D-79 | `:1317` 来源：D-72 轮 N-02 ｜ 严重度：P3 ｜ 归属层：机制层 | P3 |
| D-80 | `:1328` 来源：D-72 轮 N-03 ｜ 严重度：P2 ｜ 归属层：机制层 | P2 |
| D-81 | `:1338` 来源：D-72 轮 N-04 ｜ 严重度：P2 ｜ 归属层：机制层 | P2 |
| D-83 | `:1265` 来源：D-75 轮 N-01 ｜ 严重度：P2 ｜ 归属层：机制层 | P2 |
| D-84 | `:1279` 来源：D-75 轮 N-02 ｜ 严重度：P2 ｜ 归属层：机制层 | P2 |
| D-85 | `:1296` 来源：v0.5.6 收尾实测（父会话）+ v0.5.6 独立复验 F-05 ｜ 严重度：P3 ｜ 归属层：机制层 | P3 |

机制层佐证：`node tools/ledger-check.mjs` 的 `detail-meta-line` 检查 **PASS**（89 条明细**全部**都有该行，不只这 7 条）。

### F-06 / F-07（PASS）D-25 的竖线已去掉，严格解析器不再丢行

**实际输出**：
- `defect-ledger.md:58` → `| D-25 | 审计 RG-06 | P0 | 机制层 | bash 通道按**命令形态**识别账号级不可逆操作（`mavis agent delete` / `mavis agent update` 等），12 条负例不误伤 … |`（**无竖线**）
- `defect-ledger.md:700`（状态表行）同样已改成 `mavis agent delete` / `mavis agent update`- `node tools/ledger-check.mjs` 摘要：`{"statsLine":7,"indexRows":89,"detailCount":89,"statusUnion":89,"indexIds":89}` ⇒ **索引表 88 → 89 行**，且 `index-columns` 检查 PASS（无一行被切成 ≠5 列）

⇒ 上一轮「索引表 88 行 ⇒ 缺 D-25」的表述**改判**（详见 §6.2）。

### F-08（PASS）三处都加了 `mavis_agent_create`，且与实际判定对得上

| 位置 | 行号 | 实测原文片段 |
|---|---|---|
| `plugin/README.md` 危险工具表 | :544 | 危险工具表已列 `mavis_agent_create` / `mavis_agent_delete` / `mavis_agent_update` / `website_deploy` / `miniapp` / `miniapp_publish`，并写明「建号（`mavis_agent_create` / `mavis agent create`）同样在拦 —— 账号成员是跨项目全局可见的，子代理自己建号会让账号成员与项目名录脱钩」 |
| `plugin/skills/super-agent-router/references/scope.md` 管控分类行 | :12 | 危险类已含 `mavis_agent_create`，判定列写「**一律拦**，不论有没有 scope。建号与删除、改写**对称**」 |
| `plugin/skills/…/references/scope.md`「为什么拦」明细表 | :85 | 新增一行：建号是账号级全局可见的变更，需人工确认（与删除、改写对称） |

**与判定口径对得上（代码事实）**：
- `plugin/hooks/hooks.json:62` matcher = `mavis_agent_delete|mavis_agent_update|mavis_agent_create|website_deploy|miniapp|miniapp_publish` —— README 表里 6 个工具**全在**。
- `plugin/scripts/lib.mjs:2644` 定义 `TOOL_AGENT_CREATE`；`:2678` DANGEROUS 理由「创建账号级成员是账号级全局可见的变更，需人工确认」。
- `plugin/scripts/guard.mjs` 的 `DANGEROUS` 表含 `[TOOL_AGENT_CREATE]`；`dangerousByArgs()` 的 `mavis` 参数判定正则含 **create** ⇒ 命令形态 `mavis agent create` 同样被拦。

⇒ 文档口径与 hook matcher、与代码判定**三处一致**，**PASS**。

### F-09（PASS，但有 1 处残留）D-80 的交叉引用已改

**实际输出**（`defect-ledger.md:1326`）：
> …`guard.mjs` 侧早就因此把 `expandHomePath()` 抽成纯函数（见 **D-65 的修复轮**：判定锚点换成插件包身份后，把家目录展开抽成纯函数 `expandHomePath()`；以及 **D-70**：上一轮「四种家目录写法都被拦」的断言是假绿）…

**全仓 grep「D-65」**（`tools.grep` pattern=`D-65`，全仓库，limit=60，**实际命中 14 条，未触发截断** ⇒ 穷举不是抽样）：

| 位置 | 性质 |
|---|---|
| `defect-ledger.md:85` | 索引表 D-65 本人 —— 正确 |
| `defect-ledger.md:1044` | `### D-65` 明细标题 —— 正确 |
| `defect-ledger.md:1326` | **已按 F-09 改写** —— 正确 |
| `defect-ledger.md:1365` | 状态表行区 —— 正确 |
| `release-v056.md:78` | 区间列举 `D-65 ~ D-69` —— 正确 |
| `release-v056.md:201/203` | **编号订正说明**（说明 dispatch.mjs:321 的注释该用哪个号）—— 正确 || `verification-v056.md:57/122/123/275` | 我上轮报告的原文（含对 F-09 的描述）—— 正确 |
| **`fix-d72.md:302`** | **仍写着「（见 D-65/D-70）」—— 与 F-09 同款误引，未修** |

⇒ 台账里的那条**已修**（**PASS**）；但**历史轮次的修复报告 `docs/audit/fix-d72.md:302` 留着同款误引**（见 §8 F-3）。金丝雀：同一次 grep 在同一批文件里命中 8 条 D-65，其中 7 条是正确用法 ⇒ 判据本身可用。
## 3. 收口时新挖出的 3 处台账问题 —— 逐条确认闭合

### 3.1 D-81 的「来源/严重度」行归位 —— **闭合**

D-81 段起于 `defect-ledger.md:1330`，其「来源：…｜严重度：P2｜归属层：机制层」行现在在 **`:1338`**，位于本段内部、紧跟「还需要什么」之后（**不再落在文件末尾**）。
机制层佐证：`ledger-check` 的 `detail-meta-line` PASS。

### 3.2 状态表里 D-75 重复且矛盾 —— **闭合**

全文件 `^| D-75 |` 现在只有 **3 处**：`:95`（索引表行）、`:1172`（`### D-75` 明细标题）、`:1378`（状态表行，状态 =「已修（待独立复验）」）。**状态表里 D-75 只剩一行**，陈旧那行（「口径已定，待实现」）已删。
机制层佐证：`ledger-check` 的 `no-duplicate-d` PASS（该检查按**同一张表内**重复判定，且会报出状态矛盾）。

### 3.3 明细重算 P2 = 30 vs 统计行 31 —— **闭合**

`node tools/ledger-check.mjs` 的 `severity-distribution` PASS —— 该检查**从明细重算**再与统计行**逐字**比（口径写在 `tools/ledger-check.mjs` 头注释第 3、5 条：严重度只认明细段自己的来源行，统计行不得反过来当严重度来源）。
实测摘要 `indexRows=89 / detailCount=89 / statusUnion=89` ⇒ 明细 89 = 统计行总计 89。

### 3.4 三处过期口径更新 —— **全部落实**

| 口径 | 实测 |
|---|---|
| 「本轮新增」改为 **D-44~D-85 共 42 条** | `defect-ledger.md:9` 写「本轮新增 **D-44~D-85 共 42 条**」；脚本枚举明细标题落在 44~85 区间的 **42 个**（**44~85 无缺号**，`MISSING_NUMBERS=[]`） |
| 章节编号统一为 **一~九** | 全文 `^### ` 标题实测 9 个：一(:13) 二(:122) 三(:137) 四(:381) 五(:612) 六(:670) 七(:731) 八(:755) 九(:799) —— **每个编号各一次、顺序正确**，无两个「六」、无「六」排在「五」前 |
| 状态表标题 | `:1342` = 「本轮新增 D-44~D-85 的修复状态（待复验）」 |

## 4. 永久台账断言 —— 原始输出

### 4.1 `node tools/ledger-check.mjs`
```
台账：C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\defect-ledger.md
摘要：{"statsLine":7,"indexRows":89,"detailCount":89,"statusUnion":89,"indexIds":89}
PASS 台账检查 index-columns
PASS 台账检查 sets-equal
PASS 台账检查 severity-distribution
PASS 台账检查 detail-meta-line
PASS 台账检查 detail-count
PASS 台账检查 no-duplicate-d
>>> 台账自洽
EXIT=0
```
**六项全 PASS** ✓

### 4.2 `node tests/ledger-test.mjs`（基线 + 变异体）

输出 **23 条 PASS、0 条 FAIL、0 条 WARN**，末尾 `>>> LEDGER ALL PASS`，`EXIT=0`。
其中「PASS 已知缺口清单与台账现状一致（没有失效钉住项）」⇒ `KNOWN_GAPS` 为空且台账零偏差。WARN 的触发条件是「已登记缺口不再出现」，**空清单 + 零偏差 ⇒ 天然无 WARN**，与 §7.3 写的「23 PASS / 0 FAIL / 0 WARN」一致。

### 4.3 `SAR_MUTATION_LEDGER=1 node tests/ledger-test.mjs`（只跑变异体）

6 个变异体**一个不少红**：

| 变异体 | 手法 | 转红的检查 | 新偏差 |
|---|---|---|---|| M1 | 索引表某行塞未转义竖线（切成 6 列） | `index-columns` | `index-columns:line-17` |
| M2 | 删掉一条明细的「来源/严重度」行 | `detail-meta-line` | `detail-meta-line:D-01` |
| M3 | 把统计行 P1 改成 999 | `severity-distribution` | `severity-distribution:P1` |
| M4 | 删掉索引表里的 D-85 | `sets-equal` | `sets-equal:missing:index:D-85` |
| M5 | 状态表补一行状态矛盾的重复行 | `no-duplicate-d` | `no-duplicate-d:D-44` |
| M6 | 把一条明细的严重度 P0↔P1 互换 | `severity-distribution` | `severity-distribution:P0` + `:P1` |

末行 `PASS 变异过程中真实台账逐字节未变` + `>>> LEDGER ALL PASS`，`EXIT=0`。

**独立指纹复核**（不依赖被验对象自带的断言）：
```
跑前： LEDGER_SHA_BEFORE = 9A919B174742D29014AA8BF0F3B9862E66CE85A17EF4D3288F6BEEF7100C2727
跑后： LEDGER_SHA_AFTER  = 9A919B174742D29014AA8BF0F3B9862E66CE85A17EF4D3288F6BEEF7100C2727
mtime（跑前 = 跑后）= 2026-11-10T17:33:18.1606543Z
```
⇒ 「真实台账逐字节未变」**成立**（外部指纹，不是套件自证）。

### 4.4 第 12 套确实进了全量回归

`tools/run-tests.mjs` 自动发现 `tests/*-test.mjs`；实测副本内 **12** 个套件文件；全量回归输出含 `RESULT ledger-test exit=0 pass=23 fail=0`。✓

## 5. 交付报告 `docs/audit/delivery-v056.md` 逐条核对

### 5.1 §7.4「父会话自己独立跑出来的数字」

| 报告里的数 | 我的实测 | 结论 |
|---|---|---|
| 全量回归（仓库副本）**十二套 787 条断言 0 FAIL** | 逐套：chain 70 / d27-mut 14 / dispatch-release 58 / e2e 53 / guard 228 / hooks 29 / **ledger 23** / lessons 65 / records 52 / roster 38 / scope-amend 119 / scope 38 = **787**，全部 `exit=0 fail=0`，末尾 `>>> SHELL ALL PASS` | **成立** |
| 「仓库副本与安装副本各跑一遍」（§4.5:194 / §5.3:235） | 我用 `--root C:\Users\yang2\.minimax\plugins\super-agent-router` **独立跑了一遍**：同样 12 套、同样 787 条、0 FAIL、`>>> SHELL ALL PASS` | **成立**（我上轮 §3.4 的未验证边界就此闭合） |
| 四个变异矩阵全 OK：总矩阵 / D75 / D73 / **D77** | 总矩阵 218.1s（M-D37/38/39/40/41 + M-D72a~e = **10 个**全 YES，`>>> E2E MUTATION MATRIX OK`）；D75 26.8s（**4 个**全 YES）；D73 21.3s（**3 个**全 YES）；D77 458.6s（M-D77a/b/c **全 YES**，红条数 5+2+3 = **10 条 RED**，`>>> D77 MUTATION MATRIX OK`） | **成立**（含「10 条 RED」） |
| 部署 `INSTALLED_VERSION=0.5.6` | 安装副本 manifest 实测 `version=0.5.6`；`description` 与仓库**逐字一致**（`DESC_IDENTICAL=true`） | **成立** || 部署 `CACHE_SYNCED trees=4 skipped=1`（跳过 superpowers） | **部分成立 / 已漂移**，见 §8 F-2 | **部分** |
| 安装副本自洽：hooks 引用的 **5 个脚本全部存在** | hooks.json 引用的 5 个脚本 `dispatch / gate / guard / session-start / watchdog` **全部 EXISTS=True**；**更强**：安装副本 `plugin/` 与仓库 `plugin/` **28 个文件逐字节一致**（`MISSING_IN_INST=[] EXTRA_IN_INST=[] BYTE_DIFF_FILES=[]`） | **成立（证据强于报告）** |
| 台账 **89 条**，严格检查六项全 PASS | `detailCount=89`，六项全 PASS（§4.1） | **成立** |
| 发布说明与成员原稿**逐字一致**（均 14,724 字节） | 两文件 SHA256 **完全相同** `D8A57FE5…C16D55A`，均 14,724 字节，逐字节 `IDENTICAL=True` | **成立** |

### 5.2 §7.2「独立复验的结论」—— 转述有没有曲解

| 报告里的转述 | 核对 |
|---|---|
| 「F-03 **FAIL → 已收口**」 | **属实**。F-03（台账自洽）当时的 FAIL 项就是「统计行与明细区对不上 / 7 条无严重度 / 索引表丢行」，现在 `ledger-check` 六项全 PASS。 |
| 「**5 项**条件（F-05~F-09）已逐条收口」 | **成立**。**注**：我复核开始时这一句还是「**4 项**」，父会话在我复核**期间**把它改成了「5 项」；当前工作树已是「5 项」，与 F-05~F-09 的实际条数一致（`docs/audit/verification-v056.md` §7 也有同样的订正）。 |
| A 组「F-01/F-02/F-04 PASS、F-03 FAIL→已收口」 | 与我上轮结论一致，**未曲解**。 |
| B 组「D-80 残余确实还在」「D-85 已知未修、确认仍在」 | **本轮亲见复核成立**（§2 F-05 的探针输出 + `plugin/scripts` 里 `/dev/null` 零命中）。 |
| D 组「十一套 **764 条 0 FAIL**（与父会话数字一致）」 | 属实 —— 那是**我上轮**的数字；本轮是 12 套 787 条（新增第 12 套 +23 条）。两处不矛盾（不同轮次），但读者容易混。 |
| C 组「版本 0.5.6（仓库 + 安装副本一致）」 | **成立**（本轮实测）。 |

⇒ §7.2 **无曲解**（唯一一处计数错「4→5」已被父会话当场改正）。

### 5.3 §7.5「仍然开着的东西」—— 有没有漏报

**派工单点的 7 项，逐项核对：全部在** ✓ —— D-80 残余 / D-85 已知未修 / D-76 设计边界 / D-74 子项未验证 / S4.5 的 `TASK_CHILD_ARCHIVED` 子项 / D-44·D-49 脚本层绕过 / 宿主 `mavis-trash.cmd` 尾随空格传参。（另加 D-25b~D-25e 已闭环一行。）

**但相对我上轮报告 §3「未验证边界」10 条逐条对照，§7.5 漏了 4 条仍然开着的边界**（其中 2 条在报告别处有覆盖、2 条台账与报告别处都没有对应条目）：

| 我上轮 §3 的条目 | 现在还开着吗 | §7.5 是否有 | 报告别处 / 台账是否有 |
|---|---|---|---|
| §3.4 只跑仓库副本、没在安装副本复跑 | **已闭合**（本轮我自己跑了安装副本那一遍） | — | — |
| §3.6 D-84 的「报错」口径（退出码仍 0、`ok:true`） | 仍开着 | **没有** | 台账 D-84「还需要什么」写了「回执与账本可能不一致，需人工看该字段」—— **可追溯但 §7.5 未转述** |
| §3.5 D-85 批准后是否真能写 `/dev/null` | 仍开着 | **没有** | 台账 D-85 状态「待修」—— 可追溯，但「批准后真能写吗」这问未答 |
| §3.7 只验证了 Windows（Linux/macOS 未验证） | 仍开着 | **没有** | **全报告无对应条目** || §3.9 F-01 修法后的旁路形态未系统评估（改名/伪包） | 仍开着 | **没有** | §6.1「仍然没有保证：把脚本复制一份改名再执行…」—— **有覆盖**（但不在 §7.5 这一节） |
| §3.8 台账 89 条只做机械统计、没逐条人工复核「影响/复现步骤」 | 仍开着 | **没有** | 新增的 `ledger-check` 是**结构**检查（列数 / 三集合 / 分布 / 元信息行 / 重复），**不校验每条「影响」是否仍与代码一致** —— 台账里无对应条目 |

金丝雀与阴性口径：上表「全报告无对应条目」是阴性结论 —— 判据用 `tools.grep` 在**同一文件**上扫 `Windows|Linux|macOS|安装副本|退出码|逐条|改名|复制一份`，**同一批 pattern 命中了 `安装副本`（:161/:194/:235/:306/:326）、`复制一份改名`（:145/:253）、`逐条`（:30/:40/:110/:128/:131）** ⇒ 检索本身有效；`Windows|Linux|macOS` 与 `退出码` 在该文件 **0 命中**（未触发截断，limit=30，实际返回 19 条）。

⇒ §7.5 的**核心 7 项齐全**，但作为「如实列，不藏」的一节，**相对验收方自己的未验证边界清单有漏项** ⇒ 记为 §8 **F-1（P3，非阻塞）**。
## 6. 两条「更正」的明确表态

### 6.1 「`.tmp-release` 目录并不空，是你的 glob 跳过点目录」—— **成立**，该项改判 **PASS**

- 复现（**不依赖 glob**）：`Get-ChildItem -Force -File 'docs\audit\.tmp-release'` → **8 个文件**：
  `block10.md(3337) / block9.md(4675) / check-selfconsistency.mjs(6542) / count-assertions.mjs(948) / probe-d77-concurrency.mjs(4891) / probe-mimic-test.mjs(3637) / release-v056.md(14724) / selfcheck-v056.mjs(4672)`
  ⇒ 父会话说的「8 个文件」**逐个对上**。
- 我上轮的「目录为空」是**探针缺陷**（`glob` 默认跳过点目录），不是产品缺陷 —— **自曝：探针错了就是错了**。
- 转写稿与原稿**逐字一致**：`docs/audit/release-v056.md` 与 `docs/audit/.tmp-release/release-v056.md` **SHA256 相同**（`D8A57FE59F3FA8F33FC8B2E6A2951134438A733D9C705F9ECA00990CAC16D55A`）、均 **14,724 字节**、逐字节 `IDENTICAL=True`。
- ⇒ **该项由「未验证」改判 PASS**。

### 6.2 「D-25 在索引表第 58 行，只是含未转义竖线被严格解析器丢掉」—— **成立**，我上轮的「缺 D-25」结论改判

- 复现：`defect-ledger.md:58` = `| D-25 | 审计 RG-06 | P0 | 机制层 | …（`mavis agent delete` / `mavis agent update` 等）… |` —— **D-25 确实在索引表第 58 行**（本轮已把竖线去掉，严格解析器不再丢它）。
- 证据链：收口前该行含未转义竖线 ⇒ 严格解析把它切成 ≠5 列 ⇒ 整行被丢弃 ⇒ 上轮量到「索引 88 行 vs 明细 89 条」并误判为「缺 D-25」；收口后 `indexRows=89` 与 `detailCount=89` 相等 ⇒ **无条目丢失**。
- ⇒ **「严格解析会丢行」这个机制结论仍成立**；**「索引表缺 D-25」不成立**，改判。

## 7. 生产代码未改的证据

| 指纹 | 跑前 | 跑后 |
|---|---|---|
| `plugin/` 整树 SHA256（28 个文件逐个哈希后合并） | `045E18A55BBBAAD360D5179B68AEF8B00178810C991A357B1671523C03576840` | **同左** |
| `docs/audit/defect-ledger.md` SHA256 | `9A919B174742D29014AA8BF0F3B9862E66CE85A17EF4D3288F6BEEF7100C2727` | **同左**（mtime 也未变：2026-11-10T17:33:18.1606543Z） |
| `git status --short` | `M .superagent/STATUS.md`、`M docs/audit/delivery-v056.md`、`M docs/audit/live-trigger-evidence.txt`、`?? docs/audit/reuse-registry.md`、`?? tools/extract-live.mjs` | `M .superagent/STATUS.md`、`M docs/audit/delivery-v056.md`、`M docs/audit/verification-v056.md` |

⇒ 工作树里**只有父会话自己的 v0.5.6 改动**（HEAD 期间从 `7ff65c1` 前进到 `7e48e74`，我在复核期间父会话又改了 3 个文件）。**本单未改 `plugin/` `tests/` `tools/` `docs/audit/*.md` 一行**；唯一写入 = `docs/audit/.tmp-v055/`（本报告 + `mkcopy.cjs` + `matrix-all-v056.mjs` + 重跑上轮的 `probe-v056-p5.mjs`）。
## 8. 本轮新发现（按严重度）

| # | 严重度 | 触发条件 | 影响 | 证据 |
|---|---|---|---|---|
| **F-1** | **P3（非阻塞）** | `docs/audit/delivery-v056.md` §7.5「如实列，不藏」 | 相对验收方自己上轮 §3 的未验证边界清单，**漏 4 条仍开着的边界**：仅 Windows 未验证 / F-01 改名·伪包旁路未穷举 / D-84 退出码口径 / D-85 批准后是否真能写。其中「仅 Windows」与「台账逐条未人工复核」在台账与报告别处**都没有对应条目** | §5.3 对照表；金丝雀见 §5.3 末段 |
| **F-2** | **P3（信息，非缺陷）** | `delivery-v056.md` §7.4「`CACHE_SYNCED trees=4 skipped=1`」 | 该数是**点时快照**：按 `tools/deploy-plugin.mjs` 的判定逻辑**只读复算**当前 `.leases/`（6 项）得 **trees=5 / skipped=1**（多出来的那棵是 2026-11-10T17:43:20Z 运行时新建的租约树）。**`skipped=1 → superpowers` 被独立证实**（那棵树的 manifest 正是 `superpowers@6.2.8`）；`trees=4` 与租约时间线自洽（4 棵本插件树早于 17:43:20Z），但**部署不可重跑（本单 FORBID）⇒ 只能记「该次如此」**。建议报告注明这是快照而非当前值 | §5.1 表 + 只读复算输出 |
| **F-3** | **P3（非阻塞）** | `docs/audit/fix-d72.md:302` | F-09 同款误引「（见 D-65/D-70）」**未随台账一起修**（台账 :1326 已修）。读者按它去查家目录展开仍会查错条目 | 全仓 grep「D-65」14 条命中（未截断），见 §2 F-09 表 |

### 8.1 已如实登记、**不构成本轮阻塞**的开放项（交付报告 §7.5 已列，本轮复核未推翻）

D-80 残余（`lib.mjs` 的 `absolutizePath()` 不展开家目录）· D-85 已知未修（空设备被当写目标）· D-76 设计边界 · D-74 子项「`mavis_agent_create` 在真实运行时存在」未验证（本轮无 `tool_search`、本机 `mavis` CLI 不在 PATH）· S4.5 的 `TASK_CHILD_ARCHIVED` 子项（父会话实测过）· D-44/D-49 脚本层绕过（契约 S13.5 已声明诚实边界）· 宿主 `mavis-trash.cmd` 的 `%*` 会 trim 尾随空格（残留空目录当前为空、不影响运行时）· D-25b~D-25e 已闭环。

## 9. 剩余未验证边界（如实列出）

1. **Linux / macOS 全部未验证** —— 本轮全部结论只覆盖 win32 / Node v26.7.0 / PowerShell 5.1。
2. **`CACHE_SYNCED trees=4` 不可当场复现**（部署 FORBID + 租约状态已漂移到 5）—— 见 F-2。
3. **台账 89 条的「影响 / 复现步骤」是否仍与代码逐条一致** —— 只做了结构级自洽（列数 / 三集合 / 分布 / 元信息行 / 重复），未逐条人工复核。
4. **F-01 修法后的旁路形态未穷举**（改名 / 伪包形态）—— §6.1 只披露了这一类存在。
5. **D-85「批准后再写 `/dev/null` 是否真被放行」** —— 本轮只验到「`--grant` 返回 `ok:true` 并把 `/dev/null` 写进 scope」。
6. **D-84 的「报错」口径** —— 回执 `audit_logged=false` 如实反映，但 CLI 退出码仍是 0、`ok:true`；若口径要求非零退出码或 stderr 提示，需另定。
7. **「安装副本那一遍」的准确含义**：我跑的是「用仓库的测试套件 + `--root` 指向安装副本」。安装副本**不含 `tests/`**，所以套件里锚在 `REPO_PLUGIN`（`<repo>/plugin`）的 D-73/D-77 断言**跑的仍是仓库副本的代码** —— 这与父会话的命令形状一致，不是我的改写。
8. **本单未部署、未发布、未推 GitHub、未改台账编号与状态**；唯一写入 = `docs/audit/.tmp-v055/`。
## 10. PRIOR_LESSONS

**无内容**（该成员暂无错题本，本次为空 —— 按契约要求显式写明，不静默省略）。

## 11. 结论

**VERDICT: PASS**

**一句话：v0.5.6 能发** —— 剩余阻塞项 **0**；待办只有 3 条**非阻塞**的 P3 文档项（§8 F-1 §7.5 漏 4 条边界 / F-2 缓存树计数已漂移需注明是快照 / F-3 `fix-d72.md:302` 残留误引），以及机制侧 8 条**已如实登记**的未修与设计边界。
