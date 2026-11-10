# D-80 / D-85 修复报告（编排机制边界判定）

- **缺陷**：D-80（`docs/audit/defect-ledger.md` 第 1319 行）、D-85（同文件第 1281 行）
- **改动文件**：`plugin/scripts/lib.mjs`、`plugin/scripts/guard.mjs`、`tests/fix-d80-d85-test.mjs`（新建）、`tests/e2e-test.mjs`（变异体互锁）
- **契约依据**：`references/contract.md` S2（scope 语义）、S3（通道语义：bash 按命令里的路径 token 判定、按命令意图分流）
- **日期**：2026-11-11
- **会话**：同一会话内续做（保留 D-77 / D-73 的既有改动，未重开上下文）

---

## 0. 一句话

- **D-80**：家目录展开从「watchdog 侧的一次调用」**下沉**到 `lib.mjs` 的 `absolutizePath()` 内部 —— 展开是判定的一环，口径必须只有一处，否则下一个拿它判存在性的脚本会重蹈覆辙。
- **D-85**：空设备（`/dev/null` / `NUL` / `/dev/stdout` / `$null` …）**不是写目标、也不是项目资产** —— 不再为它记一条用不上的越界请求，也不再给出「批准了也不会生效」的批准命令；真实路径越界**照常记账并拦**。

---

## 1. 改了什么

### 1.1 D-80：家目录展开下沉（`plugin/scripts/lib.mjs`）

改前 `absolutizePath()` 只认盘符与 `/` 开头，其余一律拼到工作区根下：

```js
const raw = String(p || '').replace(/\\/g, '/').trim();   // 改前：~/$HOME/%USERPROFILE% 不展开
```

改后（新增私有 helper `homeDir()` + 在「拼工作区根」**之前**展开）：

```js
function homeDir() {
  try { return String(os.homedir() || ''); } catch (e) { return ''; }
}

export function absolutizePath(p, root) {
  const raw = expandHomePath(String(p || '').replace(/\\/g, '/').trim(), homeDir());
  const base = String(root || projectRoot()).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!raw) return '';
  if (/^[A-Za-z]:\//.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  return base ? base + '/' + raw : raw;
}
```

**为什么这么改（三条）**：

1. **展开是判定的一环，不是字符串美化** —— 不展开就会把家目录下的真实文件拼成 `<工作区根>/~/...` 这种永远不存在的路径，存在性校验必然判假，于是**真实存在的文件被判成「不存在」**，诚实的交付报告被当场拦下（D-80 的原始症状）。
2. **下沉，而不是让每个调用方各自记得展开** —— 「每个调用方都要记得」这件事已经漏过一次：watchdog 侧展开了、lib 侧没有，于是下一个拿 `absolutizePath()` 判存在性的脚本会重蹈覆辙。口径只留一处。
3. **展开发生在「拼工作区根」之前** —— 家目录下的路径是**工作区外**的真实路径，展开后必须仍被当成工作区外路径，不能被折进工作区根、也不能被当成白名单内的资产。

**边界（刻意不动）**：

- `expandHomePath(p, home)` 的**签名与语义一字未改**（arity 仍为 2，9 组语义用例逐条钉住）—— watchdog 侧仍在用它判存在性，不受影响。
- 取不到家目录时（`os.homedir()` 抛错/空）返回空串，`expandHomePath` 于是原样返回 → 行为退回「不展开」，**不会凭空造一个家目录出来**（造出来的路径必然判不存在 = 误拦诚实的交付）。

### 1.2 D-85：空设备不是写目标（`plugin/scripts/lib.mjs` + `plugin/scripts/guard.mjs`）

改前 `extractWriteTargets()` 把 `/dev/null` 当成写目标，护栏判它「不在白名单内」⇒ 台账里多一条**用不上的越界请求**，拦截文案还给出**无意义的批准命令**（批准它也不会让任何东西生效），真正的越界请求被淹在噪声里。

改后三处联动：

| 位置 | 改前 | 改后 |
|---|---|---|
| `lib.mjs` 新增 `isNullDevicePath(p)` | 无此概念 | 识别 `/dev/null` `/dev/zero` `/dev/stdout` `/dev/stderr` `/dev/stdin` / `NUL` `NUL:` `\\.\NUL` / `$null` |
| `lib.mjs` 新增 `isNullDeviceToken(tok)` | 无此概念 | 额外覆盖**贴写/带 fd 前缀**的重定向形态：`>/dev/null` `2>/dev/null` `&>/dev/null` `>NUL`（`2>/dev/null` 是最常见的 stderr 重定向，漏掉它等于没修） |
| `lib.mjs` `extractWriteTargets()` | 空设备进写目标 | 空设备**不进**写目标（动词参数与 `>`/`>>` 两处都剔） |
| `lib.mjs` 新增 `hasAssetWriteVerb(cmd)` | 用 `hasWriteVerb()` | 只有「**重定向到空设备**」这一种情况不算写操作；真正的写动词（rm/cp/mv…）仍然算，重定向目标取不到（`cmd >`）仍然算（解析不出即拒绝）。`hasWriteVerb()` 本身语义**未改** |
| `guard.mjs` bash 分支 | 路径 token 直接进判定对象 | 先合并 token 与写目标，再**剔掉空设备形态**，其余路径判定一分不变 |
| `guard.mjs` 兜底 deny | `hasWriteVerb(cmd)` | `hasAssetWriteVerb(cmd)` —— `cmd > /dev/null` 不再触发「写操作但识别不出目标路径」那条兜底拒绝 |

**为什么不是「拦下来但批不了」**：改前这条请求是**能被批准的**（`--grant` 返回 `ok:true`、`added:["/dev/null"]`、`audit_logged:true`）—— 残余不是「永远无法批准」，而是「批准它毫无意义 + 拦截文案给出的批准命令毫无意义」。所以本单**从产生侧堵**（不再产生这条请求），而不是把批准入口堵死。

**为什么读通道也剔**：台账原话是「空设备既不在工作区、**也不该被当成项目资产**」—— 这是与通道无关的分类。留着它，`cat /dev/null` 照样记一条用不上的越界请求。

**刻意不收的形态**（避免放宽过头）：

- `null` —— bash 里 `> null` 会真的建一个叫 `null` 的文件，那是**真实写目标**；
- `/dev/urandom` `/dev/random` —— 是真实设备，不是丢弃口。

---

## 2. 怎么验证

### 2.1 专属断言：每条缺陷各自一组，改前红、改后绿

新套件：`tests/fix-d80-d85-test.mjs`（**进版本库**，41 条断言）。
断言锚在**仓库副本**上（`SAR_D80D85_PLUGIN_ROOT` 可覆盖）—— 本单改的是仓库副本，安装副本由发版时同步，跟着安装副本走会看到假红。

命令：

```
node tests\fix-d80-d85-test.mjs
```

输出（节选，完整 41 条全绿）：

```
PASS D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录 :: got=C:/Users/yang2/sar-d80-beClJZ/probe.txt want=C:/Users/yang2/sar-d80-beClJZ/probe.txt
PASS D-80 家目录写法（~）展开后真实存在的文件判为存在 :: abs=C:/Users/yang2/sar-d80-beClJZ/probe.txt
PASS D-80 家目录写法（$HOME）在 absolutizePath 内部展开到真实家目录 :: got=C:/Users/yang2/sar-d80-beClJZ/probe.txt want=C:/Users/yang2/sar-d80-beClJZ/probe.txt
PASS D-80 家目录写法（%USERPROFILE%）在 absolutizePath 内部展开到真实家目录 :: got=C:/Users/yang2/sar-d80-beClJZ/probe.txt want=C:/Users/yang2/sar-d80-beClJZ/probe.txt
PASS D-80 家目录写法（$env:USERPROFILE）在 absolutizePath 内部展开到真实家目录 :: got=C:/Users/yang2/sar-d80-beClJZ/probe.txt want=C:/Users/yang2/sar-d80-beClJZ/probe.txt
PASS D-80 家目录下的路径不被折进工作区根（仍是工作区外路径） :: abs=C:/Users/yang2/sar-d80-beClJZ/probe.txt proj=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-M83ZzG/proj
PASS D-80 盘符绝对路径行为未变（仍按绝对路径直用） :: C:/x/y
PASS D-80 以 / 开头的绝对路径行为未变 :: /x/y
PASS D-80 相对路径仍拼到工作区根 :: C:/Users/yang2/AppData/Local/Temp/sar-d80d85-M83ZzG/proj/src/app.ts
PASS D-80 expandHomePath 的参数个数未变（签名未改） :: arity=2
PASS D-80 expandHomePath 语义未变："~/a" @ "H" :: got="H/a" want="H/a"
PASS D-85 空设备不是写目标：extractWriteTargets 不含 /dev/null :: []
PASS D-85 空设备不是写目标：Windows NUL 同等处理 :: []
PASS D-85 空设备不是写目标：贴写形态（2>/dev/null）同样不算 :: ["out.txt"]
PASS D-85 重定向到空设备不被拦（空设备不是写目标）
PASS D-85 重定向到空设备不产生越界请求（台账不记噪声） :: pending=0 nullTargets=[]
PASS D-85 重定向到空设备不给出无意义的批准命令
PASS D-85 Windows 空设备（NUL）不被拦
PASS D-85 Windows 空设备（NUL）不产生越界请求 :: []
PASS D-85 贴写形态（2>/dev/null）不被拦
PASS D-85 贴写形态（2>/dev/null）不产生越界请求 :: []
PASS D-85 读通道的空设备同样不判越界（设备不是项目资产）
PASS D-85 读通道的空设备不产生越界请求 :: []
PASS D-85 真实文件的写目标照常被拦 :: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",…以下路径不在白名单内：out.txt…
PASS D-85 真实文件的写目标照常记进待审清单 :: pending=1
PASS D-85 真实文件的写目标给出的是有意义的批准命令 :: …已记入待审清单 req_xxx。批准命令：…
PASS D-85 真实路径的写操作照常被拦（不被空设备排除牵连） :: …以下路径不在白名单内：config…
PASS D-85 写动词但识别不出目标时仍被兜底拒绝（不放宽） :: …命令里有写操作，但一个可判定的目标路径都识别不出来，无法验证是否越界。命令：rm…
>>> FIX-D80-D85 ALL PASS
```

> 这几行 `::` 之后是护栏的 deny JSON 原文：`request_id`、批准命令里的**绝对路径**随运行环境变化，
> 故此处只保留判定部分原文，`…` 表示被略去的可变字段；断言判据（`permissionDecision=deny`、
> 台账 pending 条数、`--grant` 提示在不在）全部是完整取用的。

**每组断言能指认命中的是哪条规则**：

- D-80 组断言的是**展开结果本身**（不是「某条命令被不被拦」）—— 命中别的分支也可能让「被拦」成立，只有展开结果对，才说明这一环真的生效。
- D-85 组的「不产生越界请求」断言**不复用被测的 lib 函数**去识别空设备（识别函数坏了断言会跟着假绿），改用测试侧硬编码的形态判定。

### 2.2 变异矩阵：回退修复 ⇒ 目标断言必红

开关 `SAR_MUTATION_D80D85=1`（**默认关**，独立于其它矩阵档位）。副本装在系统临时目录，仓库工作树零改动。

命令：

```
$env:SAR_MUTATION_D80D85='1'; node tests\fix-d80-d85-test.mjs
```

输出：

```
| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |
|---|---|---|---|---|
| M-D80 | D-80 | 回退「家目录展开下沉」：absolutizePath 内部不再展开家目录 | 9 | YES |
| M-D85 | D-85 | 回退「空设备不是写目标」：空设备重新进入判定对象与写目标 | 12 | YES |
>>> D80D85 MUTATION MATRIX OK
```

转红明细（M-D80，节选）：

```
RED FAIL D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录 :: got=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-ttdPNo/proj/~/sar-d80-oYKghI/probe.txt want=C:/Users/yang2/sar-d80-oYKghI/probe.txt
RED FAIL D-80 家目录写法（~）展开后真实存在的文件判为存在 :: abs=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-ttdPNo/proj/~/sar-d80-oYKghI/probe.txt
RED FAIL D-80 家目录下的路径不被折进工作区根（仍是工作区外路径） :: abs=…/proj/~/sar-d80-oYKghI/probe.txt
```

转红明细（M-D85，节选）：

```
RED FAIL D-85 空设备不是写目标：extractWriteTargets 不含 /dev/null :: ["/dev/null"]
RED FAIL D-85 空设备不是写目标：Windows NUL 同等处理 :: ["NUL"]
RED FAIL D-85 空设备不是写目标：贴写形态（2>/dev/null）同样不算 :: ["out.txt","2>/dev/null"]
RED FAIL D-85 重定向到空设备不被拦（空设备不是写目标） :: …"permissionDecision":"deny"…
RED FAIL D-85 重定向到空设备不产生越界请求（台账不记噪声） :: pending=1 nullTargets=["/dev/null"]
RED FAIL D-85 Windows 空设备（NUL）不被拦 :: …"permissionDecision":"deny"…
RED FAIL D-85 贴写形态（2>/dev/null）不被拦 :: …"permissionDecision":"deny"…
RED FAIL D-85 读通道的空设备同样不判越界（设备不是项目资产） :: …"permissionDecision":"deny"…
```

矩阵还带两条**互不牵连**的检查（`expectGreen`）：M-D80 变异下 D-85 那组必须仍绿；M-D85 变异下 D-80 那组、以及「真实路径照常拦」「兜底拒绝不放宽」必须仍绿。两组都通过 ⇒ 两条缺陷各自被独立钉住。

**变异工装自带的一道自检**（本轮实际救了一次场）：每次定向回退后跑 `node --check`，脚本解析不了就直接判「变异体本身失败」。第一版 M-D85 变异串把 `) {` 吞进了行尾注释，导致副本里整个护栏**起不来** —— 表现是「什么都不拦」，于是真实路径那几条断言变红、空设备那几条反而绿。矩阵当场报 `WRONG-RED` 把它揪出来，改法是把变异点挪到 lib 的语义层（`hasAssetWriteVerb` 里「空设备继续 vs 直接算写操作」那一行），不再依赖 guard 的导入表。

### 2.3 全量回归

命令：

```
node tools\run-tests.mjs --all --root plugin --repo .
```

输出：

```
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=41 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=29 fail=0
RESULT ledger-test exit=0 pass=23 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
>>> SHELL ALL PASS
```

13 套 0 FAIL / 828 条断言（新增套件被 `tools/run-tests.mjs` 的 `tests/*-test.mjs` 自动发现规则收录）。

其余既有变异矩阵复验（各自独立开关，本次改动未带偏）：

```
$env:SAR_MUTATION_D77='1'; node tests\dispatch-release-test.mjs   → >>> D77 MUTATION MATRIX OK
$env:SAR_MUTATION_D73='1'; node tests\scope-amend-test.mjs       → >>> D73 MUTATION MATRIX OK
$env:SAR_MUTATION_D75='1'; node tests\scope-amend-test.mjs       → >>> D75 MUTATION MATRIX OK
```

### 2.4 既有回归互锁：`e2e-test.mjs` 的 M-D72d 变异体

**问题**：D-72 的 N-03（家目录写法按真实家目录判存在性）原先靠**摘掉 watchdog 侧那一环**来让断言转红。D-80 把展开下沉到 lib 之后，只摘 watchdog 侧，链路仍然成立 ⇒ 断言不会红（矩阵会报 `MISS`）。

**改法**：M-D72d 改成**断整条链**（watchdog 侧 + lib 侧各摘一处），并在注释里写明为什么必须两处都摘。

命令：

```
$env:SAR_MUTATION='1'; node tests\e2e-test.mjs
```

输出（节选）：

```
| M-D72d | D-72 | 家目录展开被摘掉（~ 路径不再按真实家目录判存在性） | 1 | YES |
    RED FAIL N-03 家目录写法（~）按真实家目录判存在性：存在的文件不被拦 :: {"decision":"block","reason":"[super-agent-router] [规则 R-CLAIM-PATH-MISSING] 你声称产出了这些文件，但它们在磁盘上不存在：~/sar-d72-…
>>> E2E MUTATION MATRIX OK
>>> E2E 工装 ALL PASS
```

其余 9 个变异体（M-D37 / M-D38 / M-D39 / M-D40 / M-D41 / M-D72a-e）全部保持 `YES`。

**另一处互锁**：`tests/chain-test.mjs` 的变异自检按「特征行」定位 `lib.mjs` 的盘符分支（`[A-Za-z]:` + `test(raw)) return raw;`）。D-80 只改了 `absolutizePath()` 的第一行，特征行仍在 ⇒ 锚点仍命中：

```
MUTATION 回退前 lib.mjs 第 589 行: if (/^[A-Za-z]:\//.test(raw)) return raw;
```

---

## 3. 改前改后差异一览

| 场景 | 改前 | 改后 |
|---|---|---|
| `absolutizePath('~/x', root)` | `<root>/~/x`（必然不存在） | `<真实家目录>/x`（真实存在则存在） |
| `absolutizePath('C:/x', root)` | `C:/x` | `C:/x`（不变） |
| `absolutizePath('/x', root)` | `/x` | `/x`（不变） |
| `absolutizePath('rel/x', root)` | `<root>/rel/x` | `<root>/rel/x`（不变） |
| `extractWriteTargets('echo hi > /dev/null')` | `['/dev/null']` | `[]` |
| `extractWriteTargets('rm out.txt 2>/dev/null')` | `['out.txt','2>/dev/null']` | `['out.txt']` |
| bash `echo hi > /dev/null`（scoped worker） | deny + **记一条越界请求** + 给「批准命令」 | 放行，**不记账**，无批准命令 |
| bash `echo hi > NUL`（scoped worker） | 同上 | 同上 |
| bash `node -e "…" 2>/dev/null`（scoped worker） | deny + 记一条越界请求 | 放行，不记账 |
| bash `cat /dev/null`（scoped worker） | deny + 记一条越界请求 | 放行，不记账 |
| bash `echo hi > out.txt`（out.txt 越界） | deny + 记账 + 批准命令 | **完全不变** |
| bash `rm -rf config`（config 越界） | deny + 记账 | **完全不变** |
| bash `rm`（写动词但无目标） | 兜底 deny | **完全不变**（兜底拒绝未被放宽） |
| 台账待审清单里的空设备条目 | 会产生，且**批准了也不生效** | 不再产生；历史的旧条目仍需人工清理 |

---

## 4. 边界与未覆盖的部分（诚实边界）

1. **只堵「产生侧」**：本单让机制**不再产生**空设备的越界请求；台账里若已有历史的 `/dev/null` 待审项，`--grant` 仍会把它写进 scope（那是别的成员的归属面，且改成「批不了」正是本单明确不采的方向）。清理历史条目需人工在待审清单里拒绝。
2. **贴写形态的「真实文件目标」仍未归一**：`echo hi >out.txt`（运算符与目标贴写）里，token 仍是 `>out.txt`，与白名单条目 `out.txt` 对不上 ⇒ 仍被判越界。这是**既有行为**（非本单引入），本单没有顺手改它 —— 改它要动 `extractPathTokens()` 的语义，属于另一次改动。
3. **fd 复制（`2>&1`）仍会被当成写目标**：`rm foo 2>&1` 里 `2>&1` 仍会进写目标集合。它不是空设备、也不是路径，属于另一族问题，本单未处理。
4. **合成载荷只验「判定逻辑」**：本单用合成 PreToolUse 载荷驱动真实 `guard.mjs`，验的是**机制对不对**；「某工具在真实运行时会不会被派发/拦住」是另一问，契约 S3 已写明派发随会话而变，不能由合成载荷推断（RT-04）。
5. **chain-test 变异自检里两条 V-13 诊断在单盘机器上仍报 `NO`**（`盘符绝对路径的产出不被误判为不存在` / `工作区之外真实存在的盘符绝对路径不被误拦`）：这是该套件**自述**的既有现象 —— 旧实现把 `C:/x` 截成 `/x`，在只有 C: 的机器上仍指向同一个文件，所以单盘机器看不出差异；真正能区分的是第 25c 条（用 `subst` 挂第二个盘符）与第 27 条（报错必须保留盘符前缀），这两条本次复验仍为 `YES`。**与 D-80 无关**。
6. **本次改动只碰判定逻辑**：未改契约文档（`references/`）、未改协议与版本号文件、未动 watchdog 的判定逻辑（D-72/78/79/81 的四层判定由既有回归锁死）、未动 record-gate / lessons-gate / records / roster（归另一名成员）。
7. **无对外动作**：未建号、未删成员、未部署、未发布、未 `git commit` / `push`。

---

## 5. 验收条件补测（独立验收 F-1 / F-2）

> 本节是**追加单**（第三单）的内容，只补断言与变异体，**未改任何产品行为**。
> §2 里的套件条数（41）与矩阵（2 个变异体）是**第一单的快照** —— 现为 **49 条断言 / 6 个变异体**，见 §5.4。

### 5.1 两条验收条件 → 断言映射

| 验收条件 | 要求 | 新增断言 | 层级 |
|---|---|---|---|
| **F-1** | 家目录取不到时**不得造路径**；产出路径不得含凭空造出来的家目录 | `F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」`<br>`F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」` | lib（子进程） |
| **F-1** | 那个「展开失败」的路径在磁盘上**必须不存在** | `F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在`<br>`F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在` | lib（子进程） |
| **F-2** | `/dev/urandom` 与 `/dev/random` **不得被当空设备**，仍被当成写目标 | `F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备`<br>`F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标`<br>`D-85 空设备识别不放宽真实路径（null / src/null / /dev/nullx / /dev/urandom / /dev/random 都不是空设备）`（**扩展既有那条**） | lib（纯函数） |
| **F-2** | 真实设备在白名单外 ⇒ 护栏照常判越界并记账 | `F-2 真实设备（/dev/urandom）在护栏层仍判越界`<br>`F-2 真实设备（/dev/urandom）在护栏层仍记进待审清单` | guard（真实脚本 + 台账） |

合计 **8 条新断言**（41 → 49）。

### 5.2 F-1 的探针怎么写的（为什么用子进程）

**要求**：`os.homedir()` 抛错或返回空时，行为必须退回「不展开」。

**做法**：套件在临时目录里落一个探针脚本，由**子进程**执行：

```
import os from 'node:os';
…
if (mode === 'throw') { os.homedir = () => { throw new Error('simulated homedir failure'); }; }
else { os.homedir = () => ''; }
const lib = await import(pathToFileURL(libPath).href);
const out = lib.absolutizePath(process.argv[5], root);
console.log(JSON.stringify({ mode, out, exists: fs.existsSync(out) }));
```

**为什么用子进程而不是在本进程里换 `os.homedir`**：`homeDir()` 是**调用时**才取家目录的，本进程里换掉也能生效 —— 但那会把后面 D-80 组断言用的真实家目录一起污染，矩阵的「恰好转红」就没法自证了。子进程是隔离的：两种失败形态各跑一次，跑完即退。

**探针路径刻意取一个「在真实家目录下确实存在」的相对路径**（`~/<临时目录>/probe.txt`）：

- 正确行为（不展开）⇒ 产出 `<工作区根>/~/<临时目录>/probe.txt` ⇒ 磁盘上**不存在**；
- 若机制改用「另一个真实家目录来源」兜底（`os.userInfo().homedir`）⇒ 产出 `<真实家目录>/<临时目录>/probe.txt` ⇒ **它真的存在**。

这样两条 F-1 断言都**不是恒绿**：主判据（不造路径）由「造假家目录」变异体打红，副判据（不存在）由「换真实家目录来源」变异体打红。

### 5.3 新增变异体怎么造的（全部在语义层）

| 变异体 | 缺陷 | 变异点（`plugin/scripts/lib.mjs`） | 期望转红 | 实测 |
|---|---|---|---|---|
| **M-F1** | D-80（F-1） | `homeDir()` 取不到时**造一个假家目录**：`return h || 'C:/fake/home/dir'` | 2 条（两条「不造路径」） | 2 / YES |
| **M-F1b** | D-80（F-1） | `homeDir()` **恒**返回假家目录（= **独立验收方实际用的那个变异**） | 8 条 D-80 形态断言 + 2 条 F-1 | 10 / YES |
| **M-F1c** | D-80（F-1） | 取不到时改用 `os.userInfo().homedir` 兜底（另一种造路径，且产出的路径**真的存在**） | 4 条（两种形态 × 两条判据） | 4 / YES |
| **M-F2** | D-85（F-2） | 把 `/dev/urandom`、`/dev/random` **收进空设备集合** | 1 条（扩展后的「不放宽真实路径」）+ 4 条 F-2 | 5 / YES |

**三点说明**：

1. **全部落在语义层**，不碰导入表 —— 上一单 M-D85 第一版栽过一次：把 guard 里的 `hasWriteVerb` 换回去，而当时那个导入已被我删掉 ⇒ 副本里成了未定义引用 ⇒ **整个护栏起不来、什么都不拦** ⇒ 该绿的真实路径断言先红了。现在变异点都改落在 lib 的语义（`homeDir()` 的返回值来源、空设备那张集合表）。
2. **矩阵的比对口径升级为「恰好转红」**：原来只查「期望的都红了」，现在按**断言标签**比对红集合 —— 少红一条 = 变异体没生效，**多红一条 = 误伤了别的断言**（列成 `EXTRA-RED`）。两个既有变异体的期望集也据此补成**完整红集合**（M-D80 9 条、M-D85 12 条）。
3. **语法自检保留**：每次定向回退后跑 `node --check`，脚本解析不了就判「变异体本身失败」。本单它又救了一次场 —— M-F1c 第一版替换串漏了函数的收尾 `}`（被行尾注释吃掉），矩阵当场报「变异体本身失败：变异后脚本无法解析」，而不是把一个坏变异体误读成有效变异。

### 5.4 原始输出

**新套件（正常档）** —— `node tests\fix-d80-d85-test.mjs`：

```
PASS F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-krWH8u/proj/~/sar-d80d85-f1-g0W9gu/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-krWH8u/proj/~/sar-d80d85-f1-g0W9gu/probe.txt
PASS F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-krWH8u/proj/~/sar-d80d85-f1-g0W9gu/probe.txt exists=false
PASS F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-krWH8u/proj/~/sar-d80d85-f1-g0W9gu/probe.txt want=…
PASS F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在 :: out=… exists=false
PASS F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备 :: urandom=false random=false
PASS F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标 :: urandom=["/dev/urandom"] random=["/dev/random"]
PASS F-2 真实设备（/dev/urandom）在护栏层仍判越界 :: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",…以下路径不在白名单内：/dev/urandom…
PASS F-2 真实设备（/dev/urandom）在护栏层仍记进待审清单 :: pending=3
>>> FIX-D80-D85 ALL PASS
```

（F-1 的产出路径与**独立验收方实测**逐字一致：`C:/…/proj/~/…/probe.txt`，且磁盘上不存在。）

**变异矩阵** —— `$env:SAR_MUTATION_D80D85='1'; node tests\fix-d80-d85-test.mjs`（其余开关已清空）：

```
| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言恰好转红 |
|---|---|---|---|---|
| M-D80 | D-80 | 回退「家目录展开下沉」：absolutizePath 内部不再展开家目录 | 9 | YES |
| M-D85 | D-85 | 回退「空设备不是写目标」：空设备重新进入判定对象与写目标 | 12 | YES |
| M-F1 | D-80（F-1） | 回退「取不到家目录就不展开」：取不到时造一个假家目录出来 | 2 | YES |
| M-F1b | D-80（F-1） | 回退「取真实家目录」：homeDir() 恒返回假家目录（验收方原变异） | 10 | YES |
| M-F1c | D-80（F-1） | 回退「取不到家目录就不展开」：改用 os.userInfo().homedir 兜底 | 4 | YES |
| M-F2 | D-85（F-2） | 回退「真实设备不是空设备」：把 /dev/urandom 与 /dev/random 收进空设备集合 | 5 | YES |
>>> D80D85 MUTATION MATRIX OK
```

M-F1c 的转红明细（可见副判据确实被打红）：

```
RED FAIL F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=C:/Users/yang2/sar-d80d85-f1-dyXfcE/probe.txt want=…
RED FAIL F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/sar-d80d85-f1-dyXfcE/probe.txt exists=true
RED FAIL F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=C:/Users/yang2/sar-d80d85-f1-dyXfcE/probe.txt want=…
RED FAIL F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/sar-d80d85-f1-dyXfcE/probe.txt exists=true
```

**全量回归** —— `node tools\run-tests.mjs --all --root plugin --repo .`：

```
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=29 fail=0
RESULT ledger-test exit=0 pass=23 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
>>> SHELL ALL PASS
```

13 套 0 FAIL / 836 条断言（上一单 828 条，本单 +8 条新断言）。

### 5.5 自查：哪条断言真的有牙齿

| 断言 | 哪个变异体打红 | 备注 |
|---|---|---|
| F-1「不造路径」（两种形态） | M-F1、M-F1b、M-F1c | 主判据 |
| F-1「产出路径磁盘上不存在」 | **M-F1c** | M-F1 / M-F1b 造的是**不存在的**假目录 ⇒ 这条在它们下面仍绿（诚实说明：它的牙齿在「换真实家目录来源」这一形态上） |
| F-2 四条 + 扩展后的「不放宽真实路径」 | M-F2 | 纯函数层与护栏层各一半 |
| D-80 组 9 条 | M-D80、M-F1b | |
| D-85 组 12 条 | M-D85 | |

### 5.6 与验收方意见的分歧

**无实质分歧** —— 两条验收意见都成立，洞也确实存在（验收方用独立于我的变异证实的），本单照办并逐条钉住。三点补充说明：

1. **F-1 的变异体我做了两个（M-F1 与 M-F1b）**：M-F1b 就是验收方用的那个原变异（`homeDir()` 恒返回 `C:/fake/home/dir`），保留它是为了证明**验收方那个变异现在会红**；M-F1 是更细的一层（只改「取不到」这一支），作用是让 F-1 的判据**被单独隔离**出来 —— M-F1 下 D-80 组必须仍绿，矩阵才谈得上「恰好转红」。
2. **F-2 我既扩展了既有那条、又加了专属断言**：验收方说「扩展或另加」二选一；我两条都做（扩展是防「报告承诺了、套件没钉」的那个洞，专属断言是为了让判据能**指认命中哪条规则**）。
3. **「产出路径在磁盘上不存在」这条的适用范围**：它成立的前提是**工作区根下没有字面量 `~` 目录**（测试用的是临时工作区根，必然没有）。真实场景里若工作区根下正好有 `~` 目录且里面同名文件存在，这条会不成立 —— 这是该断言的**边界**，不是机制缺陷。

### 5.7 本单未触碰的东西

- **产品代码零改动**：`plugin/scripts/lib.mjs`、`plugin/scripts/guard.mjs` 的 diff 与上一单**逐字相同**（本单只改 `tests/fix-d80-d85-test.mjs` 与本报告）。
- 未改：`docs/audit/defect-ledger.md`、`docs/audit/verification-*.md`、`docs/audit/delivery-v056.md`、`plugin/hooks/hooks.json`、`plugin/.minimax-plugin/plugin.json`、`plugin/README.md`、`plugin/CHANGELOG.md`、`plugin/skills/**`、`.superagent/` 下任何文件。
- 未做账号级 / 对外动作；未 `git commit` / `push` / `deploy`。

---

## 6. 改动清单

| 文件 | 改动 |
|---|---|
| `plugin/scripts/lib.mjs` | ① 新增私有 `homeDir()`；`absolutizePath()` 内部展开家目录（D-80）② 新增 `isNullDevicePath()` / `isNullDeviceToken()`；③ `extractWriteTargets()` 排除空设备；④ 新增 `hasAssetWriteVerb()`（D-85） |
| `plugin/scripts/guard.mjs` | ① bash 分支从判定对象里剔掉空设备形态；② 兜底 deny 改用 `hasAssetWriteVerb()`（D-85） |
| `tests/fix-d80-d85-test.mjs` | **新建**：**49 条断言**（D-80 组 22 + D-85 组 19 + 验收条件 F-1 组 4 + F-2 组 4）+ 变异矩阵（`SAR_MUTATION_D80D85=1`，**6 个变异体**：M-D80 / M-D85 / M-F1 / M-F1b / M-F1c / M-F2；比对口径为「恰好转红」，含 `node --check` 语法自检） |
| `tests/e2e-test.mjs` | M-D72d 变异体改为断整条家目录展开链（watchdog 侧 + lib 侧），保住与 D-80 的互锁 |
| `docs/audit/fix-d80-d85.md` | 本报告（第一单 §1~§4/§6 + 追加单 §5 验收条件补测） |
