# F-01 / F-04 修复报告（权威面脚本归属判据 + SCOPE 含空格路径）

- 执行者：sa-mechanism-fix（编排机制边界判定改造）
- 待验对象：`docs/audit/verification-v055.md` §2 的 F-01（P1）、F-04（P3）—— **验收报告是待查对象，不是本报告的证据**
- 契约：`plugin/skills/super-agent-router/references/contract.md`（S2 第 7 条、S13.3 第 1 条、S13.5）
- 改动范围：`plugin/scripts/guard.mjs`、`plugin/scripts/lib.mjs`、`tests/guard-test.mjs`、`tests/scope-test.mjs`、契约；探针在 `docs/audit/.tmp-f01/`
- 未做：未 commit / 未 push / 未部署；未触碰 `{lessons,lessons-gate,record-gate,records,roster}.mjs`、`tests/{lessons,records,roster}-test.mjs`、`dispatch.mjs`、`plugin/README.md`、`plugin/CHANGELOG.md`、`docs/audit/defect-ledger.md`
- 日期：2026-11-10

---

## 0. 结论摘要

| 编号 | 复核结论 | 处置 | 断言（改前 → 改后） |
|---|---|---|---|
| F-01 | **成立**，且比验收报告描述的更实（提权链端到端可兑现，已本地复现） | 归属判据由「运行中 guard 自己所在的那一份」改为**插件包身份** | 7 红 → 0 红（共 10 条断言） |
| F-04 | **成立**，且本仓库自己的路径就带空格 | 切分尊重路径里的空格（契约 S2 新增第 7 条） | 4 红 → 0 红（共 8 条断言） |

两条都与验收方一致，未发现「验收方说错」的地方；但**各有两处验收方没展开的细节**，其中一处推翻了我方上一轮的口径（见 §1.2）。

---

## 1. F-01（P1）权威面脚本的拦截锚点太窄 → 整条提权链可绕

### 1.1 验收方说的现象

> SCOPE 覆盖 `plugin/scripts/` 的 worker 执行**仓库副本**的 `--tier full` → 整条提权链跑通：
> 名录里该成员变 full、变更账写下假批准人、下一次派工即按 full 生效。
> 原因是「批准人校验」在 worker 手里根本不构成阻拦 —— worker 的派工原文里就带着父会话 id，它照抄就能过。

### 1.2 我复核的结论

**成立。** 三处独立取证：

**（a）代码**：改前的 `guard.mjs` 用 `pluginRootDir()`（`path.resolve(path.dirname(path.dirname(process.argv[1])))`）
反推「插件根」，`authorityScriptHit()` 只比 `base + '/scripts/' + name`。
⇒ 判定**只覆盖运行中 guard 自己所在的那一份副本**（生产里是 hook 缓存树），
仓库副本 `plugin/scripts/scope-amend.mjs` 完全不在锚点内。

**（b）端到端复现**（`docs/audit/.tmp-f01/probe-f01-chain-before.mjs`，把 git HEAD 的 guard 装进一个插件包目录后跑）：

```
GUARD_DECISION=ALLOW
CLI_EXIT=0
CLI_OUT={ "ok": true, "agent": "sa-w", "tier": "full", "changed": true, "before": "scoped", … }
ROSTER_TIER=full granted_by=(无)
CHANGES_LOG=2026-11-10T12:21:40.996Z | tier | sa-w | scoped -> full | by mvs_parent_e2e
```

⇒ 验收方描述的「名录变 full + 变更账写下假批准人」**一字不差地复现**。

**（c）机制解释**：验收方说「批准人校验在 worker 手里不构成阻拦」——**我确认，并补充一句**：
批准人校验只要求 `--approver` 等于派工台账里出现过的父会话 id，而 worker 的派工原文
（`PARENT SESSION:`）里就写着这个值。⇒ 这一层是**纵深防御**，不是主防线。
上一轮把它算进「削弱」是**高估**了它。

**（d）与验收方不一致 / 验收方未展开的两处**（都要写进台账口径）：

- **D-A：上一轮的口径「工作区里的同名副本是普通文件，不误拦」是错的。**
  那份副本跑起来做的是同一件事（读同一个名录、写同一个变更账）。
  ⇒ 归属判据必须落在**身份**上，不能落在「路径长相」上。
  注意这条与「别的项目里也有 `roster.mjs`」并不矛盾：**在插件包目录树下的副本是权威面脚本，
  不在插件包目录树下的同名文件才是普通文件** —— 这正是新判据的分界线。

- **D-B：上一轮的「家目录四种写法都覆盖」实际上大半是死代码。**
  旧锚点下，`expandHome()` 展开后的路径仍要与「运行中那份」的 base 比对；
  家目录里的那份插件只有在**运行中的 guard 恰好装在家目录那份插件上**时才会命中。
  实测（改前）：四条家目录写法在探针里**全部未被「权威面脚本」规则命中**
  （命中的是 scope 层，理由文案是「越界拦截」而不是「权威面脚本」）。
  ⇒ 上一轮验收报告里「4 种写法同样被拒」这个观察成立，但**成立的原因不是家目录展开生效**，
  而是 scope 层恰好也拒了它。新的判据下，四条写法才真正由权威面规则命中。

### 1.3 改哪个文件哪一段

**`plugin/scripts/lib.mjs`（新增「插件包身份」三件套，lib.mjs:455-524）**

| 新增 | 作用 |
|---|---|
| `findPluginPackageRoot(filePath)`（:463） | 从文件所在目录往上找，第一个含 `.minimax-plugin/plugin.json` 的目录 = 包根；找不到返回空串（= 普通文件） |
| `readPluginPackageName(pkgRoot)`（:484） | 读包名（`plugin.json` 的 `name`）；读不到返回空串 |
| `ownPackageAuthority(absFilePath, opts)`（:505） | 归属判定三步：① 文件名在权威面清单里 ② 落在某个插件包里 ③ 包名与本插件一致；命中返回脚本名 |

**`plugin/scripts/guard.mjs`（判定锚点换掉）**

- 删除 `pluginRootDir()` —— **按 `process.argv[1]` 反推的锚点整条废止**（它就是漏洞本身）。
- 新增 `ownPackage()`（guard.mjs:332）：**只用 `process.argv[1]` 确定「本插件是谁」（包名）**，
  不再用它确定「哪些文件算权威面脚本」。
- 新增 `candidateBases()`：相对路径按**多个根**解析 —— 当前工作目录 / 工作区根
  （只锚一个根 = 换个目录执行就躲开）。
  **插件包根这一支是受限的**：只接「插件目录相对写法」（`scripts/xxx.mjs` 与裸文件名），
  且只对**执行类命令**（node/bun/deno/tsx/ts-node/npx/bunx）生效。
  为什么不放开：把任意相对路径拼到插件根下再判身份，会让**任何**以权威面脚本命名的文件
  （别的项目的 `docs/roster.mjs`）都被当成插件包里的东西 —— 那就是脚本名裸匹配，
  是 brief 明确禁止的误伤面。
- 重写 `authorityScriptHit()`（guard.mjs:389）：按**插件包身份**判，不再比路径长相。
- `expandHome()`（guard.mjs:347）扩到 `~` / `$HOME` / `%USERPROFILE%` / `$env:USERPROFILE%`
  四种写法，且正斜杠与反斜杠都认。

**没有**用「脚本名裸匹配」，**没有**用「路径里含 scripts/」这类模糊特征 —— 这两条是 brief 明确禁止的，
也是误伤的来源。

### 1.4 加了哪条断言

`tests/guard-test.mjs:845-961`（F-01 块，9 条断言）：

| 断言 | 内容 | 改前 | 改后 |
|---|---|---|---|
| ①-a | worker 执行**另一份副本**的 `--tier full` → deny（文案含「权威面脚本」） | **红** | 绿 |
| ①-b | worker 执行**另一份副本**的 `--grant` → deny | **红** | 绿 |
| ② | 父会话执行同一脚本 → 不被这条规则拦 | 绿 | 绿 |
| ③ | 无关项目里的同名文件（不在任何插件包目录树下）→ 不误拦 | 绿 | 绿 |
| ③ | 无关项目里的同名文件照常按 scope 判定放行 | 绿 | 绿 |
| ④ ×4 | `~` / `$HOME` / `%USERPROFILE%` / `$env:USERPROFILE%` 四种家目录写法都拦得住 | **红 ×4** | 绿 ×4 |
| ④-补 | 家目录**展开本身**可单独断言（四种写法都展开到真实家目录） | **红** | 绿 |

两条设计要点：

1. **「另一份副本」怎么造**：在临时目录里造一个**同样是插件包**（带 `.minimax-plugin/plugin.json`）、
   但**不是运行中 guard 所在的那一份**的副本。这正是生产条件
   （运行中 = 缓存树/安装目录，目标 = 仓库副本）。旧锚点只认运行中那一份 ⇒ 必红。
2. **家目录四条断言是自足的**：探针自建一个「假家目录 + 假插件包」，
   并给 guard 进程传 `HOME` / `USERPROFILE` ⇒ 不依赖本机是否装了本插件，换台机器结论一样。
   并且另加一条 **④-补**：把家目录展开抽成纯函数 `expandHomePath()`（lib.mjs）单独断言 ——
   否则「命令被拒」可能由别的分支命中，四条断言就会变成假绿。

### 1.5 断言改前红改后绿（真实输出）

**改前**（`node docs/audit/.tmp-f01/run-guard-test-before.mjs guard-test`：把 git HEAD 的插件脚本
装成 `SAR_PLUGIN_ROOT`，用**新**的回归套件去跑）：

```
PASS_COUNT=202
FAIL_COUNT=7
FAIL ①-a worker 执行另一份副本的权威面脚本（--tier）被拒（F-01）
FAIL ①-b worker 执行另一份副本的权威面脚本（--grant）被拒（F-01）
FAIL ④ 家目录写法 ~ 被拦（F-01） :: …越界拦截…
FAIL ④ 家目录写法 $HOME 被拦（F-01） :: …越界拦截…
FAIL ④ 家目录写法 %USERPROFILE% 被拦（F-01） :: …越界拦截…
FAIL ④ 家目录写法 $env:USERPROFILE% 被拦（F-01） :: …越界拦截…
FAIL ④-补 家目录四种写法都展开到真实家目录（F-01） :: lib.mjs 没有导出 expandHomePath
```

**改后**：

```
RESULT guard-test exit=0 pass=209 fail=0
>>> SHELL ALL PASS
```

端到端链（同一探针，改后）：

```
GUARD_DECISION=DENY
GUARD_REASON=[super-agent-router] 已拦截：子代理执行了**父会话专属的权威面脚本**（权限/记录入口：scope-amend.mjs）…
ROSTER_TIER=scoped granted_by=(无)
CHANGES_LOG=(无)
```

⇒ 提权链从「ALLOW + 名录变 full + 变更账写假批准人」变成「DENY + 名录不动 + 无留痕」。

### 1.6 残余风险（如实列出）

1. **复制一份改名再执行** → 仍不在判定范围（复制品不在插件包目录树下，归属判不出来）。
   契约 S13.5 已按这个口径改写。
2. **内联代码直接写文件** → 复合层只判危险操作（契约 S3），作用域交回内层调用。
3. **「批准人 = 父会话 id」仍是纵深防御**，不是主防线（worker 知道父会话 id）。
4. **本插件包名读不到时**（运行中的副本没有 `.minimax-plugin/plugin.json`）：
   归属判定退化成「只要落在任意插件包里就算」⇒ 别的插件的同名脚本会被误拦。
   方向是 fail-closed（宁可多判不可漏判），但这是一个**已知误伤面**，写在契约里。
5. **hook 仍是护栏不是沙箱**：脚本内部自带的 fs 写入不受判定约束（契约 S13.5 原有口径照旧）。
6. 只在 **Windows / PowerShell 5.1 / Node v26.7.0** 上验过；Linux/macOS 未验。
7. **误伤面（我自查过，边界写在这里）**：bash 通道里，只要命令的**段首是执行类命令**
   且参数是**裸文件名**（`node scope-amend.mjs`），就会被这条规则拦 ——
   即便那个文件其实在别的项目里。实测误伤探针（`probe-f01-precision.mjs`）的结论：
   `cat <别处>/docs/roster.mjs` 放行、`cp <别处>/docs/roster.mjs …` 放行、
   `node scripts/scope-amend.mjs`（插件目录相对写法）拦、
   `node scope-amend.mjs`（裸文件名）拦。
   ⇒ 误伤只落在「执行类命令 + 裸文件名」这一格，其余形态不误伤。

---

## 2. F-04（P3）SCOPE 里含空格的路径被静默截断

### 2.1 验收方说的现象

> `extractScopeDetail` 按空格切分 SCOPE 行 ⇒ 绝对路径里带空格时被切成两段（后半段被当成另一个条目），
> 该白名单条目**静默不生效**。本仓库自己的路径就含空格。

### 2.2 我复核的结论

**成立。** 改前探针（`docs/audit/.tmp-f01/probe-scope-now.mjs`）实测：

```
INPUT   = "SCOPE: C:\Users\yang2\Documents\MiniMax\mini code的插件\src\app.ts"
ENTRIES = ["C:\Users\yang2\Documents\MiniMax\mini"]
REJECTED= []
```

⇒ `rejected` 是空的 ⇒ **静默**：派工闸门（`dispatch.mjs:78`）看到 rejected 为空 ⇒ 放行派工，
白名单里却躺着一个被截断的路径。

**验收方未展开的三点，我复核后补上**（都影响修法选择）：

- **D-C：截断后的前半截仍会被收进白名单。** `C:\...\mini` 过得了 `isPathLike`（无空格无中文），
  于是白名单里有一条**看起来正常、永远匹配不上目标**的条目。
  比「整条丢掉」更隐蔽：白名单非空 ⇒ 不报错 ⇒ 目标被判成越界。
- **D-D：含中文的路径走的是另一条分支。** `mini code的插件` 里的中文让 `isPathLike` 失败，
  而 `collectScopeTokens` 的 CJK 分支会把它**整条丢弃**（连 `rejected` 都不进）
  ⇒ 白名单更窄，且同样不报错。**只修切分不够，`isPathLike` 也必须放开。**
- **D-E：被引号包裹的路径同样被截断**（旧切分不认引号）⇒ 引号形态必须一并支持。

### 2.3 改哪个文件哪一段

**`plugin/scripts/lib.mjs`**

| 位置 | 改动 |
|---|---|
| `tokenizeScopeText`（lib.mjs:329） | 重写切分口径：先按**逗号**切；每个片段若**被引号包住**或**以盘符开头**（`X:\` / `X:/`）就**整体**算一个条目；否则才按空白切。保留旧的 `ro:` 语义（`ro: path` / `ro:path` 都认；`ro : path` 维持旧行为不变） |
| `collectScopeTokens`（lib.mjs:425） | 接受「整体形态」的条目（引号/盘符）—— 形态已经证明「这是一个路径」，不再受字符集限制 |
| `isPathLike`（lib.mjs:137） | 增加一支：**以盘符开头的绝对路径**整体算路径（路径里可以有空格与中文）。判据是**形态**（盘符开头），不是「有没有空格/有没有中文」—— 一句自然语言不会以 `X:\` 开头 |

**`plugin/skills/super-agent-router/references/contract.md`**：S2 新增第 7 条（切分口径 + 理由 + 相对路径带空格必须加引号的理由）。

### 2.4 加了哪条断言

`tests/scope-test.mjs:175-244`（F-04 块，8 条断言）：

| 断言 | 内容 | 改前 | 改后 |
|---|---|---|---|
| ① | 含空格的绝对路径**解析为一个完整条目**（不截断） | **红** | 绿 |
| ② | 该路径**读放行**（白名单真生效） | 绿 | 绿 |
| ② | 该路径**写放行**（白名单真生效） | **红** | 绿 |
| ② | 同一白名单对**相对路径**同样生效 | **红** | 绿 |
| ③ | 不带空格的写法不受影响 | 绿 | 绿 |
| ④ | `ro:` 只读前缀仍然生效 | 绿 | 绿 |
| ④ | 中文自然语言片段仍被丢弃（不混进白名单） | 绿 | 绿 |
| ④ | 双引号包裹的含空格路径同样是一个完整条目 | **红** | 绿 |

**一条值得单独说的观察**：改前「读放行」也是绿的 —— 因为读模式按条目**所在目录树**放宽，
被截断的 `C:\...\my` 恰好覆盖到了目标所在目录，读能过；写要求精确命中，写不过。
⇒ **只验「解析出一个条目」不够，必须验读写都放行**（brief 的要求正确，这条断言就是按这个写的）。

### 2.5 断言改前红改后绿（真实输出）

**改前**（同一套新断言跑 git HEAD 的插件）：

```
PASS_COUNT=25
FAIL_COUNT=4
FAIL F-04 含空格的绝对路径解析为一个完整条目 :: ["C:\…\sar-scope-HmETCV\my","proj\src\app\login.ts"]
FAIL F-04 含空格路径写放行（白名单真生效） :: …越界拦截…
FAIL F-04 含空格白名单对相对路径同样生效 :: …越界拦截…
FAIL F-04 双引号包裹的含空格路径同样是一个完整条目 :: ["C:\…\sar-scope-HmETCV\my","proj\src\app\login.ts"]
```

（失败明细里那两段就是截断的现场：一条路径被切成两条。）

**改后**：

```
RESULT scope-test exit=0 pass=29 fail=0
>>> SHELL ALL PASS
```

### 2.6 残余风险

1. **相对**路径里带空格仍**必须加引号** —— 带空格的相对路径与不带空格的相对路径在切分前无法区分，
   没有可靠的自动判据。已在契约 S2 第 7 条写明。**若父会话希望自动支持，需要另给一条判据**（见 §6）。
2. **路径里含逗号**仍会被切断（逗号是条目分隔符）。Windows 允许路径含逗号 —— 未处理，契约也没写。
3. `isPathLike` 放宽到「盘符开头」后，一句以 `C:\` 开头的自然语言会被当成路径收进白名单。
   无实际权限影响（它匹配不上任何真实目标），但会让白名单里多一条噪声条目。
4. 中文自然语言片段仍按旧口径**静默丢弃**（不报错、不计入 `rejected`）—— 本轮未改。

---

## 3. 契约口径变更（哪一层管什么）

| 条款 | 变更 |
|---|---|
| **S2 第 7 条**（新增） | SCOPE 条目的切分口径：先逗号 → 引号/盘符整体 → 否则空白；相对路径带空格必须加引号；理由写明「静默截断 = 判定落空」 |
| **S13.3 第 1 条**（改写） | 权威面脚本的**归属判据 = 插件包身份**（`.minimax-plugin/plugin.json` + 包名一致 ⇒ 仓库/安装目录/缓存树每一份副本都被拦）；明确禁止「脚本名裸匹配」「路径里含 scripts/」「锚在运行中那一份」；写明**这条只管执行（bash 通道），读与改写不受此条限制**（机制维护类成员要改的就是它们），改写仍受 scope 与 `.superagent/` 规则约束；父会话不受影响 |
| **S13.5**（改写） | 把「有代码保证」与「仍没有保证」分开写：插件包里的官方脚本现在**一律被拦**（代码保证，有回归钉住）；复制改名、内联代码**仍不在判定范围**；「批准人 = 父会话 id」是纵深防御不是主防线 |

---

## 4. 回归结果

```
node tools/run-tests.mjs --all --root plugin --repo .
```

| 套件 | 结果 | 套件 | 结果 |
|---|---|---|---|
| chain-test | 47 pass / 0 fail | hooks-test | 26 pass / 0 fail |
| d27-mut-test | 14 pass / 0 fail | records-test | 46 pass / 0 fail |
| dispatch-release-test | 30 pass / 0 fail | roster-test | 23 pass / 0 fail |
| e2e-test | 47 pass / 0 fail | scope-amend-test | 67 pass / 0 fail |
| **guard-test** | **209 pass / 0 fail**（含 F-01 的 10 条） | **scope-test** | **29 pass / 0 fail**（含 F-04 的 8 条） |
| **lessons-test** | **65 pass / 0 fail** ← 见下的时间线 | | |

**lessons-test 的时间线（如实记录）**：本轮第一次跑全量时，lessons-test 报 **2 条 FAIL**
（`D-52 并发写入全部返回成功或明确失败`、`D-52 并发写入的每一条都在文件里`），
落在 `plugin/scripts/lessons.mjs` / `tests/lessons-test.mjs` ——
这两个文件工作树里当时已有 `+124` / `+322` 行未提交改动，是**另一位成员的在制品**，
本轮**未触碰**它们。

- **归因取证**：把 `plugin/scripts/lib.mjs` **单独换回 git HEAD 版本**、其余保持当前工作树后重跑，
  失败依旧（同样 2 条）⇒ 与本轮 lib.mjs 改动无关（脚本见 `attr-lessons-fail.mjs`）。
- `lessons.mjs` 只从 lib.mjs 导入 `readLedger` 与 `findBinding`，本轮两处都没动。
- **最终状态**：本轮收尾时再跑全量，lessons-test 已 **65 pass / 0 fail**（另一位成员推进后转绿），
  十二套全绿。上面的取证保留，是为了说明「当时那 2 条红不是本轮造成的」。

**安装副本未部署** —— 按分工由父会话统一部署后再测；本报告所有结论均基于**仓库副本**。

---

## 5. 未验证边界（如实列出）

1. **未在真实运行时触发过**本轮的新规则：所有取证都是合成载荷（同一份 guard 脚本 + 合成载荷），
   验证的是**判定逻辑**，不是**触发链路**（契约 S3「容器调用的派发事实」里那条坑）。
   真实运行时的活体验证需要父会话派一个 worker 去跑权威面脚本。
2. **安装副本与运行时缓存树未重测**（未部署）。
3. 只在 **Windows / PowerShell 5.1 / Node v26.7.0** 上验过。
4. `lessons-test` 的 2 条失败**未追查**（不在本轮所有权内）。
5. F-01 的提权后果只在**沙箱项目目录**复现（没有碰真实 `.superagent/roster.json`）——
   与验收方的边界一致。

---

## 6. 需要父会话决定 / 批准的事

1. **台账登记**：F-01、F-04 需要进 `docs/audit/defect-ledger.md`（本轮未碰该文件）。
   建议同时登记 §1.2 的 **D-A**（上一轮口径「同名副本不误拦」是错的）与 **D-B**
   （上一轮的家目录展开大半是死代码）—— 否则下一轮还会有人拿旧口径当既定事实。
2. **F-04 的相对路径带空格**：本轮口径是「必须加引号」。若希望自动支持，
   需要一条可判定的信号（例如「片段里出现分隔符且**只有一个**已知扩展名 ⇒ 整体算一条」）——
   这条要父会话拍板，因为它会改变「自然语言片段被丢弃」的既有行为。
3. **路径含逗号**：本轮未处理（逗号是条目分隔符）。若要支持，同样需要口径。
4. **部署**：安装副本由父会话统一部署；部署后建议在真实运行时做一次活体验证
   （派一个 SCOPE 覆盖 `plugin/scripts/` 的 worker 去跑权威面脚本，确认被拒）。

---

## 7. 缺陷条目（契约 S1 七字段模板）

### F-01
- 触发条件：worker 的 SCOPE 覆盖插件脚本目录（例：`plugin/scripts/`），且它知道父会话 id
  （worker 一定知道：派工原文里就带 `PARENT SESSION:`）；它执行的是**运行中 guard 所属那一份之外的**副本。
- 影响：整条提权链端到端兑现 —— 名录里该成员等级变 full、变更账写下假批准人、下一次派工即按 full 生效；
  「批准人必须是父会话 id」挡不住（worker 照抄即可）。
- 复现步骤：1) 沙箱项目放 `.superagent/roster.json`（成员 `sa-w`，`tier=scoped`）；
  2) 台账里放一条 `state=active`、`parent_session_id=mvs_parent_e2e` 的派工；
  3) transcript 里 worker 的派工原文写 `SCOPE: <另一份副本>/scripts/` 与 `PARENT SESSION: mvs_parent_e2e`；
  4) 以 `agent_type=worker` 调 guard，`tool_input.command = 'node <另一份副本>/scripts/scope-amend.mjs --tier full --agent sa-w --approver mvs_parent_e2e'`；
  5) 改前护栏放行 → 真执行 → 名录 `tier=full`、变更账写下 `by mvs_parent_e2e`。
- 证据：`plugin/scripts/guard.mjs`（改前）`pluginRootDir()` / `authorityScriptHit()` 只比
  `base + '/scripts/' + name`；探针 `docs/audit/.tmp-f01/probe-f01-chain-before.mjs` 的真实输出
  （`GUARD_DECISION=ALLOW` → `CLI_EXIT=0` → `ROSTER_TIER=full` → 变更账一条）；
  `docs/audit/.tmp-f01/run-guard-test-before.mjs` 的 6 条红。
- 状态：已复现
- 修法方向：归属判据改为**插件包身份**（目录树里有 `.minimax-plugin/plugin.json` 且包名一致）；
  相对路径按多个根解析；家目录四种写法都展开；契约 S13.3 第 1 条与 S13.5 同步改写。
- 还需要什么：父会话派一个真实 worker 做一次活体验证（部署后），确认触发链路也生效。

### F-04
- 触发条件：SCOPE 里写含空格的绝对路径（本仓库自己的路径就含空格：
  `C:\Users\yang2\Documents\MiniMax\mini code的插件\…`）。
- 影响：该条目被截成两段 —— 前半截被当成条目收进白名单（永远匹配不上目标），
  后半段被丢弃；`rejected` 为空 ⇒ 派工闸门放行，**白名单静默不生效**（目标被判成越界）。
  含中文的路径更糟：整条被丢弃，同样不报错。
- 复现步骤：运行 `node docs/audit/.tmp-f01/probe-scope-now.mjs`（只读，只 import lib.mjs），
  看 B1/B2/B3 三组；或跑 `node docs/audit/.tmp-f01/run-guard-test-before.mjs scope-test`（4 条红）。
- 证据：`plugin/scripts/lib.mjs`（改前）`tokenizeScopeText` 按 `[,\uff0c\s]+` 切分、
  `isPathLike` 的 `PATH_LIKE` 不收空格与中文、`collectScopeTokens` 的 CJK 分支整条丢弃。
- 状态：已复现
- 修法方向：切分尊重路径里的空格（先逗号 → 引号/盘符整体 → 否则空白）；
  `isPathLike` 放开「盘符开头的绝对路径」；契约 S2 新增第 7 条。
- 还需要什么：父会话拍板「相对路径带空格是否自动支持」（本轮口径：必须加引号）。

---

## 8. 证据清单（探针与沙箱）

全部在 `docs/audit/.tmp-f01/`，只读或只写临时目录，**未碰真实名录与真实变更账**：

| 文件 | 用途 |
|---|---|
| `probe-scope-now.mjs` | SCOPE 解析现状取证（F-04 的 A/B 两组；改前改后各跑一次） |
| `probe-f01.mjs` | F-01 判定探针（①-a/①-b/②/③/④ 共 7 条断言） |
| `probe-f01-before.mjs` | 把 git HEAD 的 guard/lib 装成插件包后跑同一份 F-01 探针（改前红） |
| `probe-f01-chain.mjs` | 端到端提权链取证（DENY/ALLOW + 名录等级 + 变更账） |
| `probe-f01-chain-before.mjs` | 端到端提权链的改前对照 |
| `run-guard-test-before.mjs` | 用**新**回归套件跑 **git HEAD** 的插件（区分力取证） |
| `attr-lessons-fail.mjs` | lessons-test 失败的归因（只把 lib.mjs 换回 HEAD） |
| `probe-f01-precision.mjs` | 误伤自查：同名文件不误拦 / 插件目录相对写法要拦 / 家目录展开逐条验 |
