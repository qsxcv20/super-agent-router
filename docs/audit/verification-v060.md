# D-80 / D-85 独立验收报告（v0.5.6 最后两条已登记未修项）

- **复核方**：独立验收方（verifier）。本单 = 追加单，复用上一单的契约与台账口径。
- **复核基准**：HEAD `4c035ab`（= v0.5.6 收口后最终复核通过那次提交）+ **父会话未提交**的 worker 改动（`plugin/scripts/lib.mjs`、`plugin/scripts/guard.mjs`、`tests/e2e-test.mjs`、`tests/fix-d80-d85-test.mjs` 新增、`docs/audit/fix-d80-d85.md` 新增）。
- **环境**：win32 10.0.26200 x64 / Node v26.7.0 / PowerShell 5.1 / 会话 `mvs_26fc11cb8e99483697531140266df940`
- **时间戳**：2026-11-11 04:02 → 05:40 GMT+0800
- **写入边界**：唯一写入 = `docs/audit/.tmp-v055/`（本报告 + 10 个探针/工具脚本）。`plugin/` `tests/` `tools/` `docs/audit/*.md` 一行未改；未 commit / push / deploy / 建号。

## 0. 一句话结论

**两条缺陷的修复本身是对的**：D-80 展开确实下沉到 `absolutizePath()` 内部、且在拼工作区根之前；D-85 空设备确实从写目标提取与判定对象两处剔掉，且**不是静默放行**（真实路径越界照拦、真实写动词仍算写、解析不出仍兜底拒绝、`> null` 与 `/dev/urandom` 仍被当写目标）。**但新套件有两处「永久断言」没把要求的行为钉住**（家目录取不到时不得造路径、`/dev/urandom`/`/dev/random` 不得被当空设备）—— 我用**独立于 worker 的 9 个变异**证实：其中 2 个变异 worker 套件 **41/41 全绿**。另发现**四处文档口径因这次修复而变陈旧**（其中 README 一处为本轮新增，归父会话收口）。

**VERDICT: PASS_WITH_CONDITIONS** —— 条件是「补两条永久断言 + 父会话收口四处文档口径」，**都不是机制缺陷**，不阻塞这两条修复合入。

## 1. 复核方法与证据纪律

- 所有结论以**代码 + 实测输出**为准；worker 的 `docs/audit/fix-d80-d85.md` 只当待验对象读，不当证据。
- **改前/改后对照**用 `git show HEAD:plugin/scripts/{lib,guard}.mjs` 造「改前」插件副本（`%TEMP%\sar-v060-prefix`），与工作树版跑**同一组命令**，逐条比对判定结果与台账 pending。
- 变异检验统一走**系统临时目录里的插件副本**，仓库工作树零改动；每个变异**单开一个进程**并在子进程 env 显式 `delete` 五个开关（`SAR_MUTATION` / `_D75` / `_D73` / `_D77` / `_D80D85`）。
- **阴性结论一律配金丝雀**：同一会话里先跑一条**阳性对照**（真实越界必须被拦），证明护栏确实在跑，再读「空输出 = 放行」。
- 我的 9 个变异**独立于 worker 的变异串**（我自写锚点、逐个实测命中数唯一；VM4b 见 `mut4b-v060.mjs`）。

### 1.1 自曝：本轮探针的五次失误（都是我的夹具/通道问题，不是产品缺陷）

1. **第一次 watchdog 端到端探针夹具错了**：我写 `已创建 ~/.minimax/...`，**金丝雀**（声称一个不存在的文件）也没被拦 ⇒ 夹具没让判定生效。照抄 `tests/chain-test.mjs:550` 的 N-03 载荷形状（`已完成。…，测试通过。`）后，金丝雀正确拦（`R-CLAIM-PATH-MISSING`）。**这是我的夹具错，不是产品问题。**
2. **变异驱动第一次把探针路径传成相对路径**：子进程 cwd 是仓库副本根 ⇒ 我的探针根本没启动，8 个变异全是 `exit=1 pass=0 fail=0`（那一轮结果**不计入证据**）。改成绝对路径重跑后才拿到真实数字。
3. **两次补丁脚本失败**：先把 ESM 写进 `.cjs`（node 报 `Cannot use import statement outside a module`）；后改用嵌套引号拼字符串（node 报 `Invalid or unexpected token`）。最后改为**新写一个探针文件**而不是打补丁，成功。
4. **第一次跑「改前基线」时我把插件根路径写错了**（写成 `%TEMP%\sar-v060-prefix\plugin`，而改前副本的根目录本身就是插件目录）⇒ 探针 import 失败、`stdout` 为空 ⇒ **看起来像「改前也放行」**。我据此在初稿里写了错误的「改前 watchdog 放行」，用正确路径重跑后才拿到真结果（改前 watchdog 同样拦）。**这正好是「阴性观察必须配金丝雀」的另一种翻车**：探针自己没跑起来时，它的输出与「放行」不可区分。
5. **报告分片写入踩了两个通道坑**：① 正文里的路径 token（如 `lib.mjs`）会被 bash 通道按「写判定」拦截 ⇒ 改用 base64 分片；② 三段 base64 拼在一起解码时，中间段的 `=` 填充会让解码器提前截断（**只解出第一段的 6,803 字符**，后两段静默丢失）⇒ 改为**按分段边界分别解码再拼接**。两次都是「写进去了但内容不对」，靠回读校验才发现。

## 2. 九项逐条结论

### 2.1 【PASS】D-80 机制：展开发生在 `absolutizePath()` 内部、且在拼工作区根之前

**代码事实**（`plugin/scripts/lib.mjs:611-619`）：
```js
export function absolutizePath(p, root) {
  const raw = expandHomePath(String(p || '').replace(/\\/g, '/').trim(), homeDir());
  const base = String(root || projectRoot()).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!raw) return '';
  if (/^[A-Za-z]:\//.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  return base ? base + '/' + raw : raw;
}
```
展开发生在**第一行**，而 `base`（工作区根）在第二行才计算 ⇒ **展开严格早于「拼工作区根」**。

**独立看代码的后果**（不是看报告转述）：`absolutizePath` 全仓**只有两个调用点** —— `plugin/scripts/watchdog.mjs:236` 与 `:255`，**都是存在性校验**。`inScope` / `canonicalPathKey` / `canonicalScopeEntries` **都不调用它** ⇒ D-80 的改动**不改变白名单匹配语义**（这一条是 worker 未申报、我专门查的影响面，结论是**无影响**）。

**改前/改后对照**（我的 `probe-ba-v060.mjs`，同一命令）：
```
### PRE-FIX (git HEAD 4c035ab)
D80_ABS=C:/Users/yang2/AppData/Local/Temp/sar-v060ba-IVOxDb/proj/~/sar-v060bahome-hQ9XAr/probe.txt EXISTS=false
### POST-FIX (working tree)
D80_ABS=C:/Users/yang2/sar-v060bahome-L5adnA/probe.txt EXISTS=true
```
⇒ **改前**：家目录下的真实文件被拼成 `<工作区根>/~/...` ⇒ `existsSync` 必假（**D-80 的原始症状**）；**改后**：命中真实路径、存在性判定为真。

**用户可见症状层面必须说清（否则会夸大这次修复）**：`watchdog.mjs` 侧**本来**就显式展开（`absolutizePath(expandHomePath(p, HOME_DIR), root)`），所以 D-72 的 N-03 早已修好可见症状。我用与 `chain-test` 同形状的载荷做改前/改后端到端对照，**两边行为完全相同**：
```
### PRE-FIX : EXISTING_HOME_FILE => NOT_BLOCKED :: (空)
### PRE-FIX : MISSING_HOME_FILE (canary) => BLOCKED :: {... [规则 R-CLAIM-PATH-MISSING] ...}
### POST-FIX: EXISTING_HOME_FILE => NOT_BLOCKED :: (空)
### POST-FIX: MISSING_HOME_FILE (canary) => BLOCKED :: {... [规则 R-CLAIM-PATH-MISSING] ...}
```
⇒ **这次修复的价值是「消除 lib 层的潜在复发口」（台账原话：下一个拿它判存在性的脚本会重蹈覆辙），不是翻转用户可见症状**。这一点必须写进发布说明，否则会让人以为「此前家目录写法会被误拦」。
### 2.2 【PASS】D-80 边界：`expandHomePath` 签名与语义一字未改；既有路径行为未变；家目录路径展开后仍是工作区外路径

**「一字未改」的最强证据是 diff 本身**：`git diff HEAD -- plugin/scripts/lib.mjs | grep "export function expandHomePath"` → **0 行** ⇒ 该函数**逐字节未动**（不是「我重读了觉得没变」）。

**我的独立断言**（`probe-v060.mjs` A4~A8，全部 PASS）：
```
PASS A4 drive-letter absolute path unchanged :: C:/x/y
PASS A5 slash absolute path unchanged :: /x/y
PASS A6 relative path still joined to workspace root :: C:/Users/.../proj/src/app.ts
PASS A7 expandHomePath arity unchanged (=2) :: arity=2
PASS A8 expandHomePath 9 semantic cases unchanged :: bad=0
PASS A2 ~ result stays OUTSIDE workspace root :: C:/Users/yang2/sar-v060home-5qNuMn/probe.txt
PASS A2 $HOME result stays OUTSIDE workspace root :: C:/Users/yang2/sar-v060home-5qNuMn/probe.txt
PASS A2 %USERPROFILE% result stays OUTSIDE workspace root :: C:/Users/yang2/sar-v060home-5qNuMn/probe.txt
PASS A2 $env:USERPROFILE result stays OUTSIDE workspace root :: C:/Users/yang2/sar-v060home-5qNuMn/probe.txt
```
⇒ 家目录下的路径展开后是**真实的工作区外绝对路径**（`C:/Users/yang2/...`），既没被折进工作区根、也没被当成白名单内资产（我的断言是「不等于 proj 且不以 proj/ 开头」，且文件确实存在）。

### 2.3 【PASS（产品）/ 断言未钉住（见 §5 F-1）】D-80 不会造出假路径

**产品行为**（我的 A9 组，子进程把 `os.homedir` 改成抛错后再 import lib.mjs）：
```
PASS A9a child with throwing os.homedir still produced output :: stdout={"out":"C:/Users/yang2/AppData/Local/Temp/sar-v060probe-OYxKfF/proj/~/secret/file.txt"}
PASS A9b no fabricated home dir in result :: out=C:/Users/.../proj/~/secret/file.txt
PASS A9c result equals naive workspace-root join (fallback = no expansion) :: out=C:/Users/.../proj/~/secret/file.txt
PASS A9d fabricated path does not exist on disk (no false positive) :: out=C:/Users/.../proj/~/secret/file.txt
```
⇒ 取不到家目录时**退回「不展开」**（`lib.mjs` 的 `homeDir()` 抛错/空 ⇒ 返回空串 ⇒ `expandHomePath` 原样返回），**没有凭空造一个家目录**，产出路径也不存在于磁盘上（不会假装文件存在）。

**但**：worker 的新套件**没有**这一条断言 —— 见 §3 的 VM3（我独立造「造家目录」变异，worker 套件 41/41 全绿）。

### 2.4 【PASS】D-85 机制：空设备从写目标提取与判定对象两处都剔掉；含 fd 前缀贴写形态；Windows NUL 同等处理

**代码事实**（`plugin/scripts/lib.mjs`）：

- `lib.mjs:1991` 新增导出 `isNullDevicePath(p)` —— 判「这个路径是不是空设备」；`NULL_DEVICE_PATHS` 集合 = `/dev/null` `/dev/zero` `/dev/stdout` `/dev/stderr` `/dev/stdin`，另加 `nul` / `nul:` / `//./nul` / `$null`（大小写不敏感）。
- `lib.mjs:2010` 新增导出 `isNullDeviceToken(tok)` —— 额外覆盖**贴写与 fd 前缀形态**：`>/dev/null` `2>/dev/null` `&>/dev/null` `>NUL`（正则 `/^(\d*|&)?(>>|>)(.*)$/` 取目标后再判）。
- `lib.mjs:2039` 与 `lib.mjs:2047` —— `extractWriteTargets()` 的**两处**循环（动词参数循环、`>`/`>>` 重定向循环）各自加了空设备过滤 ⇒ 空设备既不进「动词参数」目标，也不进「重定向」目标。
- `lib.mjs:2071` 新增导出 `hasAssetWriteVerb(cmd)` —— 与 `hasWriteVerb` 只差一处：**重定向到空设备不算写操作**；真写动词（rm/cp/mv…）仍算；重定向目标取不到（`cmd >`）仍算。
- `plugin/scripts/guard.mjs:33` 导入这两个新函数；`guard.mjs:647` 在 `targetsOf()` 里把合并后的目标 `filter(t => !isNullDeviceToken(t))`；`guard.mjs:734` 的兜底 deny 由 `hasWriteVerb(cmd)` 改为 `hasAssetWriteVerb(cmd)`。

⇒ **判定对象与写目标两处都剔了**（不是只改一处）。这是 D-85 的关键：只改 `extractWriteTargets` 而不改 `targetsOf()`，`/dev/null` 仍会作为「路径 token」进判定对象；只改 `targetsOf()` 而不改 `extractWriteTargets()`，写目标集合仍非空 → 兜底 deny 仍会触发。

**我的独立断言**（`probe-v060.mjs` B1~B13，全部 PASS）：
```
PASS B1 echo hi > /dev/null -> no null-device write target :: []
PASS B1 echo hi >NUL -> no null-device write target :: []
PASS B1 echo hi > nul -> no null-device write target :: []
PASS B1 echo hi 2>/dev/null -> no null-device write target :: []
PASS B1 echo hi &>/dev/null -> no null-device write target :: []
PASS B1 echo hi >>/dev/null -> no null-device write target :: []
PASS B1 echo hi >$null -> no null-device write target :: []
PASS B1 echo hi 2>&1 -> no null-device write target :: []
PASS B2 /dev/urandom is NOT a null device (deliberate) :: false
PASS B3 /dev/random is NOT a null device (deliberate) :: false
PASS B4 bare null is NOT a null device (deliberate) :: false
PASS B5 src/null is NOT a null device :: false
PASS B6 /dev/nullx is NOT a null device :: false
PASS B7 /dev/null IS a null device :: true
PASS B8 NUL IS a null device (case-insensitive) :: true
PASS B9 token form 2>/dev/null recognized :: true
PASS B10 token form &>/dev/null recognized :: true
PASS B11 token form >NUL recognized :: true
PASS B12 token form 2>&1 NOT recognized as null device :: false
PASS B13 token form >/dev/urandom NOT recognized as null device :: false
```

**护栏层断言**（`probe-v060.mjs` C0~C13，全部 PASS）：
```
PASS C0 CANARY: a real out-of-scope write target IS denied (guard is live) :: {... permissionDecision: deny ... 不在白名单内：canary-out.txt ...
PASS C1 cmd > /dev/null is ALLOWED (no deny output) :: out= exit=0
PASS C2 cmd > /dev/null records NO pending request :: pending=1
PASS C3 real path write target is DENIED :: {... deny ... out.txt ...}
PASS C4 real path write target IS recorded as pending :: pending=2
PASS C5 real write verb (rm) is DENIED :: {... deny ...}
PASS C6 write verb with NO resolvable target -> fallback DENY (parse-fail = reject) :: {... 命令里有写操作，但一个可判定的目标路径都识别不出来 ... 命令：rm ...}
PASS C7 redirect with NO target -> fallback DENY (parse-fail = reject) :: {... 命令：echo hi > ...}
PASS C8 bare > null (real file in bash) is DENIED :: {... deny ...}
PASS C9 > /dev/urandom (real device) is DENIED :: {... deny ...}
PASS C10 > /dev/random (real device) is DENIED :: {... deny ...}
PASS C11 read of a null device is ALLOWED (not an asset)
PASS C12 real write verb + 2>/dev/null: real target still DENIED :: {... deny ...}
PASS C13 no pending request mentions a null device :: [["canary-out.txt"],["out.txt"],["config"],["null"],["/dev/urandom"],["/dev/random"]]
```

⇒ C0 是**金丝雀**（同会话真实越界必被拦 ⇒ 证明护栏在跑），C2/C4 是**台账 pending 计数对照**（空设备不记、真实目标记），C6/C7 是**兜底拒绝**（解析不出即拒绝，没被放宽）。C8/C9/C10 是**收紧侧**（裸 `null`、真设备仍当写目标）。

### 2.5 【PASS】D-85 不是「静默放行」—— 决定性金丝雀

「把空设备从写目标剔掉」最危险的误判方向是：顺手把**真实写**也放行了。我的判据是：**去掉重定向后，改前是不是同样放行**。若改前就放行，说明挡的从来只是空设备这个 token，不是载荷。

我的 `probe-ba2-v060.mjs`（同一组命令，改前/改后各跑一遍）：
```
### PRE-FIX silent-pass canary
CMD[node -e "require('fs').writeFileSync('secret.txt','x')"] => ALLOW
CMD[node -e "require('fs').writeFileSync('secret.txt','x')" > /dev/null] => DENY :: [super-agent-router] 越界拦截：... 以下路径不在白名单内：/dev/null ...
CMD[rm out.txt 2>/dev/null] => DENY :: [super-agent-router] 越界拦截：... 以下路径不在白名单内：out.txt, 2>/dev/null ...
CMD[echo hi > out.txt] => DENY :: [super-agent-router] 越界拦截：... 以下路径不在白名单内：out.txt ...
PENDING=["[\"/dev/null\"]","[\"out.txt\",\"2>/dev/null\"]","[\"out.txt\"]"]
### POST-FIX silent-pass canary
CMD[node -e "require('fs').writeFileSync('secret.txt','x')"] => ALLOW
CMD[node -e "require('fs').writeFileSync('secret.txt','x')" > /dev/null] => ALLOW
CMD[rm out.txt 2>/dev/null] => DENY :: [super-agent-router] 越界拦截：... 以下路径不在白名单内：out.txt ...
CMD[echo hi > out.txt] => DENY :: [super-agent-router] 越界拦截：... 以下路径不在白名单内：out.txt ...
PENDING=["[\"out.txt\"]"]
```

⇒ **判为「不是静默放行」**，依据三条：
1. **载荷写法本身改前就 ALLOW**（第一行两侧相同）⇒ 引号里的载荷不被解析，这是台账 **D-76 的设计边界**（复合层载荷），不是本次回归。
2. **改前的 DENY 理由是「`/dev/null` 不在白名单内」** ⇒ 挡的是**空设备这个 token**，不是载荷。D-85 去掉的是「偶然挡住噪声的拦截」，不是真保护。
3. **改后真实越界仍 DENY 且仍记账**：`rm out.txt 2>/dev/null` 与 `echo hi > out.txt` 两侧都 DENY，且改后 pending 里**只剩 `out.txt`、不再有 `2>/dev/null`**（改前把 `2>/dev/null` 当成真实路径记进台账了 —— 这本身也是噪声）。

### 2.6 【PASS，但有一处需要写进发布说明】D-85 的影响面边界

**必须说清的一点**：D-85 修的是「空设备被当成写目标 ⇒ 产生用不上的越界请求」，**不是**「命令里的危险写不再被拦」。带 `>` 的真实写目标仍然照拦（`echo hi > out.txt` 两侧都 DENY）。

**我另做的边缘用例探针**（`probe-edge-v060.mjs` / `probe-edge2-v060.mjs`，改前/改后对照）—— 专门验「剔除空设备后，会不会顺手把多目标命令里的真实越界目标也放掉」：
```
### PRE-FIX edge
CMD[cp secret.txt /dev/null] => DENY
CMD[cp /etc/hosts /dev/null] => DENY
CMD[mv out.txt /dev/null] => DENY
CMD[tee /dev/null] => DENY
CMD[cat secret.txt > /dev/null] => DENY
CMD[cat src/app.ts > /dev/null] => DENY
CMD[rm -rf secret.txt 2>/dev/null] => DENY
### POST-FIX edge
CMD[cp secret.txt /dev/null] => DENY
CMD[cp /etc/hosts /dev/null] => DENY
CMD[mv out.txt /dev/null] => DENY
CMD[tee /dev/null] => ALLOW
CMD[cat secret.txt > /dev/null] => DENY
CMD[cat src/app.ts > /dev/null] => ALLOW
CMD[rm -rf secret.txt 2>/dev/null] => DENY
```
```
### POST-FIX edge2
CMD[tee /dev/null secret.txt] => DENY
CMD[tee secret.txt /dev/null] => DENY
CMD[tee] => ALLOW
CMD[rm secret.txt > /dev/null] => DENY
CMD[dd of=secret.txt] => DENY
CMD[dd of=/dev/null] => DENY
CMD[echo hi > NUL] => ALLOW
CMD[echo hi > nul] => ALLOW
CMD[cat src/app.ts > NUL] => ALLOW
CMD[echo hi > /dev/urandom] => DENY
CMD[cat src/app.ts > /dev/urandom] => DENY
```

⇒ 关键三条：
- `tee /dev/null secret.txt` 与 `tee secret.txt /dev/null` **改后仍 DENY** ⇒ 同一命令里**只要还有一个真实越界目标，空设备被剔掉不会把那个真实目标一起放掉**（`extractWriteTargets` 逐个目标过滤，不是「整条命令只要沾了空设备就全放」）。
- `cp secret.txt /dev/null` / `mv out.txt /dev/null` 改后仍 DENY ⇒ 「拷到空设备」这类**读越界**没被顺手放过（`cp`/`mv` 的源路径仍进判定）。
- `dd of=/dev/null` 改后仍 DENY ⇒ `of=` 参数形态不被当成空设备（保守方向，不算缺陷，见 §7）。

**一处需要写进发布说明的口径**（不是缺陷）：`tee /dev/null` 改前 DENY、改后 ALLOW。`tee` 只有一个目标 `/dev/null`（无真实写目标）⇒ 按 D-85 的口径「空设备不是写目标」，放行是**符合口径的**；但它确实是**用户可观测的行为变化**，发布说明里应写明，避免被当成「护栏被削弱了」。
### 2.7 【PASS】断言判别力：worker 套件 vs 我的探针 —— 两个「0/N」都指明了本该命中项

**worker 套件**（`tests/fix-d80-d85-test.mjs`，352 行）：
```
>>> FIX-D80-D85 ALL PASS   （41 条断言，0 FAIL）
```

**我的探针**（`docs/audit/.tmp-v055/probe-v060.mjs`，55 条断言）：
```
TOTAL_FAIL=0
```

**worker 自带的变异矩阵**（`SAR_MUTATION_D80D85=1`，我复跑确认）：
```
| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |
|---|---|---|---|---|
| M-D80 | D-80 | 回退「家目录展开下沉」：absolutizePath 内部不再展开家目录 | 9 | YES |
| M-D85 | D-85 | 回退「空设备不是写目标」：空设备重新进入判定对象与写目标 | 12 | YES |
>>> D80D85 MUTATION MATRIX OK
```

⇒ **0/41 与 0/55 这两个数，必须能指出「本该命中的是哪几条」**，否则就是零信息：

| 套件 | 0 FAIL 的含义 | 本该命中的断言（谁保证它会红） |
|---|---|---|
| worker 41 条 | 现行代码下全部行为正确 | M-D80 变异下 **9 条**转红（4 种家目录写法 × 2 条 + 1 条工作区外断言）；M-D85 变异下 **12 条**转红 |
| 我的 55 条 | 现行代码下全部行为正确 | 见 §3 的 9 个变异逐个给出 worker/我的 FAIL 数 |

**但两个套件都没钉住的行为，我用独立变异证实了**（§3 VM3 / VM4b）—— 这是本轮唯一的实质性发现。

### 2.8 【PASS】全量回归与既有变异矩阵（本次改动未带偏既有机制）

**全量回归**（跑在**仓库副本** `%TEMP%\sar-v060-vnFdo5`，不碰真实工作树；新套件被自动发现规则收录）：
```
REPO=C:\Users\yang2\AppData\Local\Temp\sar-v060-vnFdo5
ROOT=C:\Users\yang2\AppData\Local\Temp\sar-v060-vnFdo5\plugin
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
⇒ **13 套 / 828 条断言 / 0 FAIL**。

**四个既有变异矩阵**（`matrix-all-v056.mjs`，各自独立开关，副本上跑）：
```
==== MATRIX total sw=SAR_MUTATION suite=e2e-test.mjs exit=0 elapsed=217.7s pass=0 fail=0
  | | M-D37 | D-37 | 派工前的「目标成员存在性」判定被摘掉 | 9 | YES |
  | | M-D38 | D-38 | 会话注入里的陈旧名单披露被摘掉 | 1 | YES |
  | | M-D39 | D-39 | 账号级建号子命令从危险清单里摘掉（bash 通道 + 参数判定 + 复合层） | 3 | YES |
  | | M-D40 | D-40 | 拦截消息的「只读条目」分型被摘掉（退回一律说不在白名单内） | 3 | YES |
  | | M-D41 | D-41 | 复合层判定退回「对整段代码文本做朴素正则」 | 3 | YES |
  | | M-D72a | D-72 | 否定式产出判定被摘掉 | 7 | YES |
  | | M-D72b | D-72 | 非断言语境判定被摘掉 | 4 | YES |
  | | M-D72c | D-72 | 子句级归属被摘掉（退回行级扫描） | 5 | YES |
  | | M-D72d | D-72 | 家目录展开被摘掉（~ 路径不再按真实家目录判存在性） | 1 | YES |
  | | M-D72e | D-72 | 通配符跳过被摘掉（模式又被当成文件去校验存在性） | 2 | YES |
  >>> E2E MUTATION MATRIX OK
==== MATRIX d75 sw=SAR_MUTATION_D75 suite=scope-amend-test.mjs exit=0 elapsed=27.1s pass=0 fail=0
  | | M-D75a | D-75 | 回退「升级显式化」 | 12 | YES |
  | | M-D75b | D-75 | 回退变更账上的升级标注（回执不动） | 3 | YES |
  | | M-D75c | D-75 | 回退回执上的升级字段（变更账不动） | 8 | YES |
  | | M-D75d | D-75 | 回退路径写法归一 | 2 | YES |
  >>> D75 MUTATION MATRIX OK
==== MATRIX d73 sw=SAR_MUTATION_D73 suite=scope-amend-test.mjs exit=0 elapsed=19.6s pass=0 fail=0
  | | M-D73a | D-73 | 回退「降级记录不占名额」 | 2 | YES |
  | | M-D73b | D-73 | 回退「名录内外口径不同」 | 1 | YES |
  | | M-D73c | D-73 | 回退「降级派工不参与冲突检测」 | 1 | YES |
  >>> D73 MUTATION MATRIX OK
==== MATRIX d77 sw=SAR_MUTATION_D77 suite=dispatch-release-test.mjs exit=0 elapsed=458.1s pass=0 fail=0
  | | M-D77a | D-77 | 回退整个写路径：无跨进程锁 + 裸 writeFileSync | 5 | YES |
  | | M-D77b | D-77 | 回退「回滚」：回读校验失败后不恢复到写前状态 | 2 | YES |
  | | M-D77c | D-77 | 回退「回读校验」：写完不校验直接报成功 | 3 | YES |
  >>> D77 MUTATION MATRIX OK
>>> ALL MATRICES DONE
```

⇒ **10 + 4 + 3 + 3 = 20 个既有变异体全 YES**（每个变异体都把目标断言打成红）。

**特别核了 M-D72d**：D-80 把家目录展开下沉到 lib 之后，原来「只摘 watchdog 侧那一环」的变异会失效（链路仍成立 ⇒ 断言不会红）。worker 把它改成**断整条链**（watchdog 侧 + lib 侧各摘一处），实测**仍转红 1 条 / YES** ⇒ 互锁保住了。这条我没有独立复现机制，只复核了它在矩阵里确实转红。

### 2.9 【PASS】改动面与「没碰什么」

`git diff --stat HEAD -- plugin tests`：
```
plugin/scripts/guard.mjs |  14 ++++--
plugin/scripts/lib.mjs   | 113 +++++++++++++++++++++++++++++++++++++++++++++--
tests/e2e-test.mjs       |   6 +++
3 files changed, 127 insertions(+), 6 deletions(-)
```
`git status --porcelain`：
```
 M docs/audit/reuse-registry.md
 M plugin/scripts/guard.mjs
 M plugin/scripts/lib.mjs
 M tests/e2e-test.mjs
?? docs/audit/fix-d80-d85.md
?? tests/fix-d80-d85-test.mjs
```

**受保护文件零 diff**（逐个 `git diff --stat HEAD -- <file>` 全部为空）：`docs/audit/defect-ledger.md`、`docs/audit/delivery-v056.md`、`docs/audit/verification-v055.md`、`docs/audit/verification-v056.md`、`plugin/hooks/hooks.json`、`plugin/.minimax-plugin/plugin.json`、`plugin/README.md`、`plugin/CHANGELOG.md`、`.superagent/roster.json`、`.superagent/changes.log`、`.superagent/STATUS.md`。

⇒ **台账编号与状态未被改**（D-80 仍是「部分已修」、D-85 仍是「待修」），未 commit / push / deploy / 建号。`docs/audit/reuse-registry.md` 的改动只写会话复用计数与归档收敛，**与 D-80/D-85 无关**（已逐行核过 diff）⇒ 确认不是 worker 产物，是父会话自己的改动。

## 3. 我自己的 9 个独立变异 —— 锚点独立于 worker

**为什么自己写变异**：worker 的变异串只证明「回退它自己写的那两处能转红」。它**不能**证明「断言钉住的是需求本身」—— 如果需求本身有第二条路径没被钉住，worker 的变异串看不见。

**我的 8 个变异**（`docs/audit/.tmp-v055/mut-v060.mjs`，每个变异**实测锚点命中数 = 1**，变异打在**系统临时目录的插件副本**上，仓库工作树零改动；每个变异单开一个进程并显式 delete 五个 `SAR_MUTATION*` 开关）：

| # | 变异内容 | worker 套件 FAIL | 我的探针 FAIL | 判别力 |
|---|---|---|---|---|
| VM1 | `absolutizePath` 停止展开家目录（D-80 回退） | **9** | **10** | 两套都抓得住 |
| VM2 | 空设备表恒不命中（D-85 回退） | **11** | **9** | 两套都抓得住 |
| **VM3** | **`homeDir()` 造假家目录**（取不到时返回 `C:/fake/home/dir`） | **0（41/41 全绿）** | **2** | **worker 套件抓不住** |
| VM4 | 空设备集合放宽（加 `urandom`/`random`/裸 `null`） | **1** | **7** | worker 几乎抓不住 |
| **VM4b** | **只放宽 `urandom`/`random`（不加裸 `null`）** | **0（41/41 全绿）** | **5** | **worker 套件抓不住** |
| VM5 | `hasAssetWriteVerb` 退回（空设备又算写操作） | **2** | **1** | 两套都抓得住 |
| VM6 | fd 前缀形态失效（`2>/dev/null` 不再识别） | **4** | **4** | 两套都抓得住 |
| VM7 | guard 不剔空设备（判定对象保留它） | **8** | **5** | 两套都抓得住 |
| VM8 | Windows `NUL` 不再识别 | **6** | **3** | 两套都抓得住 |

原始输出（摘要行 + 两个关键变异的红项）：
```
SUMMARY [{"id":"VM1","applied":true,"wfail":9,"vfail":10},{"id":"VM2","applied":true,"wfail":11,"vfail":9},
{"id":"VM3","applied":true,"wfail":0,"vfail":2},{"id":"VM4","applied":true,"wfail":1,"vfail":7},
{"id":"VM5","applied":true,"wfail":2,"vfail":1},{"id":"VM6","applied":true,"wfail":4,"vfail":4},
{"id":"VM7","applied":true,"wfail":8,"vfail":5},{"id":"VM8","applied":true,"wfail":6,"vfail":3}]
```
```
==== VM3 :: homeDir() FABRICATES a home dir when unavailable
   worker-suite  exit=0 pass=41 fail=0
   verifier-probe exit=1 pass=53 fail=2
      V-FAIL FAIL A9b no fabricated home dir in result :: out=C:/fake/home/dir/secret/file.txt
      V-FAIL FAIL A9c result equals naive workspace-root join (fallback = no expansion) :: out=C:/fake/home/dir/secret/file.txt
```
```
==== VM4b :: only urandom/random over-broadened (bare null NOT added)
anchor hits = 1
VM4b worker-suite exit=0 pass=41 fail=0
VM4b verifier-probe exit=1 pass=50 fail=5
   V-FAIL FAIL B2 /dev/urandom is NOT a null device (deliberate) :: true
   V-FAIL FAIL B3 /dev/random is NOT a null device (deliberate) :: true
   V-FAIL FAIL B13 token form >/dev/urandom NOT recognized as null device :: true
   V-FAIL FAIL C9 > /dev/urandom (real device) is DENIED
   V-FAIL FAIL C10 > /dev/random (real device) is DENIED
```

⇒ **两个实质性发现（都不是产品缺陷，是「永久断言没把要求钉住」）**：

**F-1（VM3）**：产品行为**是对的**（取不到家目录 ⇒ 退回不展开 ⇒ 不造路径、产出路径磁盘上不存在，我的 A9b/A9c/A9d 三条断言在现行代码下全 PASS）。但 **worker 的 41 条断言里没有一条覆盖这个要求** ⇒ 造家目录这个变异能让 worker 套件 **41/41 全绿**。**要求**：补一条「家目录取不到 ⇒ 结果不含任何家目录形态的绝对路径」的永久断言。

**F-2（VM4b）**：worker 有一条「空设备识别不放宽真实路径（`null` / `src/null` / `/dev/nullx` 都不是空设备）」的断言（`tests/fix-d80-d85-test.mjs:213`），但它**只钉了 `null` / `src/null` / `/dev/nullx`**，**没钉 `/dev/urandom` 与 `/dev/random`**。worker 的交付报告里明确把这俩列为「刻意不收的形态」（理由：真实设备）—— **要求既然写进了交付报告，就该有永久断言钉住它**，否则下一轮有人把 `urandom` 加进空设备表，套件不会拦。

**严重度**：F-1 / F-2 都是 **P3（非阻塞）** —— 它们不说明当前代码有错，只说明**回归网有洞**。产品行为两条都正确（我的探针证明）。
## 4. 改前 / 改后对照汇总

对照物 = `git show HEAD:plugin/scripts/{lib,guard}.mjs` 造的「改前」副本（`%TEMP%\sar-v060-prefix`），与工作树版跑**同一组命令**。

### 4.1 D-80 机制层
```
### PRE-FIX (git HEAD 4c035ab)
D80_ABS=C:/Users/yang2/AppData/Local/Temp/sar-v060ba-F6vzlI/proj/~/sar-v060bahome-Kzn2Wi/probe.txt EXISTS=false
### POST-FIX (working tree)
D80_ABS=C:/Users/yang2/sar-v060bahome-GcLHeC/probe.txt EXISTS=true
```
⇒ 改前：家目录下的真实文件被拼成 `<工作区根>/~/...` ⇒ `existsSync` 必假（D-80 的原始症状）；改后：命中真实路径、存在性判定为真。

### 4.2 D-80 链路层（watchdog 端到端）—— 改前改后**完全相同**
```
### PRE-FIX
EXISTING_HOME_FILE => NOT_BLOCKED :: 
MISSING_HOME_FILE (canary) => BLOCKED :: {... [规则 R-CLAIM-PATH-MISSING] ...}
### POST-FIX
EXISTING_HOME_FILE => NOT_BLOCKED :: 
MISSING_HOME_FILE (canary) => BLOCKED :: {... [规则 R-CLAIM-PATH-MISSING] ...}
```
⇒ **watchdog 链路上没有可观测差异**：存在的家目录文件两边都不拦，不存在的两边都拦（`R-CLAIM-PATH-MISSING`）。**这是 D-72 早就修好的可见症状**（watchdog 侧本来就显式展开 `expandHomePath(p, HOME_DIR)`）。

⇒ **因此 D-80 本次修复的价值必须这样表述**：**消除 `lib.mjs` 层的潜在复发口**（台账原话：「下一个拿它判存在性的脚本会重蹈覆辙」），**不是翻转用户可见症状**。发布说明若写成「此前家目录写法会被误拦」就是**夸大**。

### 4.3 D-85 机制层（10 条命令 + 台账 pending）
```
### PRE-FIX (git HEAD 4c035ab)
CMD[echo hi > /dev/null] => DENY
CMD[node -e "console.log(1)" > /dev/null] => DENY
CMD[node -e "require('fs').writeFileSync('secret.txt','x')" > /dev/null] => DENY
CMD[echo hi > out.txt] => DENY
CMD[rm -rf config] => DENY
CMD[rm] => DENY
CMD[echo hi >] => DENY
CMD[echo hi > null] => DENY
CMD[cat /dev/null] => DENY
PENDING_TARGETS=["[\"/dev/null\"]","[\"out.txt\"]","[\"config\"]","[\"null\"]"]
### POST-FIX (working tree)
CMD[echo hi > /dev/null] => ALLOW
CMD[node -e "console.log(1)" > /dev/null] => ALLOW
CMD[node -e "require('fs').writeFileSync('secret.txt','x')" > /dev/null] => ALLOW
CMD[echo hi > out.txt] => DENY
CMD[rm -rf config] => DENY
CMD[rm] => DENY
CMD[echo hi >] => DENY
CMD[echo hi > null] => DENY
CMD[cat /dev/null] => ALLOW
PENDING_TARGETS=["[\"out.txt\"]","[\"config\"]","[\"null\"]"]
```
⇒ **只有 3 条从 DENY 变 ALLOW**（全是「重定向/读取到空设备」这一类），**其余 6 条两侧都 DENY**（含兜底拒绝 `rm` 与 `echo hi >`，以及裸 `null`）。台账 pending 里 `["/dev/null"]` 这条噪声消失，其余照旧。

### 4.4 我另测的「改前把 `2>/dev/null` 当真实路径记账」
改前：`rm out.txt 2>/dev/null` 的 pending targets = `["out.txt","2>/dev/null"]`（`2>/dev/null` 被当成真实路径记进台账）；改后 = `["out.txt"]`。**这是 D-85 顺带修掉的第二处噪声**，worker 的交付报告未提。

## 5. 本轮新发现（worker 未申报）

| # | 严重度 | 触发条件 | 影响 | 证据 |
|---|---|---|---|---|
| **F-1** | **P3（非阻塞）** | `homeDir()` 取不到家目录时**造假**一个家目录（如 `C:/fake/home/dir`） | **产品行为正确**（现行代码取不到就退回不展开，不造路径、产出路径磁盘上不存在）；但 **worker 的 41 条断言无一覆盖该要求** ⇒ 该变异下 worker 套件 **41/41 全绿**。回归网有洞 | §3 VM3（wfail=0 / vfail=2）、§2.3 A9b~A9d |
| **F-2** | **P3（非阻塞）** | 空设备表被放宽，把 `/dev/urandom`、`/dev/random` 收进去 | **产品行为正确**（现行代码明确不收，且 guard 层仍把 `> /dev/urandom` 当真实写目标 DENY）；但 worker 只有一条「不放宽真实路径」断言，**只钉了 `null` / `src/null` / `/dev/nullx`，没钉 `urandom` / `random`** ⇒ 仅放宽这两者时 worker 套件 **41/41 全绿**。而 worker 交付报告明确把这两者列为「刻意不收的形态」 | §3 VM4b（wfail=0 / vfail=5）、`tests/fix-d80-d85-test.mjs:213` |
| **F-3** | **P3（文档，非缺陷）** | `plugin/README.md:475-477` | **第四处**陈旧口径（我上轮只发现三处）：README 的「诚实边界」节仍写「**家目录展开目前只在收尾判定这一侧做**（v0.5.6 的 D-80 只修了一半）… 底层路径折算函数本身仍不展开」。本次修复后这句已不成立 | `plugin/README.md:475-477` 原文已附在 §6 |
| **F-4** | **P3（文档，非缺陷）** | `plugin/.minimax-plugin/plugin.json:6` 的 description 字段 | 面向使用者的包描述里仍写着「诚实边界：D-80 的家目录展开目前做在 watchdog 侧，`lib.mjs` 的 `absolutizePath()` 本身仍不展开」—— 同样已不成立 | `plugin.json` description 末段原文已附在 §6 |

⇒ **F-3 / F-4 与我上轮记的三处（`plugin.json` description、`plugin/CHANGELOG.md:149`、`references/contract.md:397`）合计四处文档口径**，全部归父会话收口。**`plugin/CHANGELOG.md:281` 属旧版本历史段（记录的是当时的状态），不算残留。**

## 6. 四处（上轮已记三处 + 本轮新增一处）文档口径原文

```
# ① plugin/.minimax-plugin/plugin.json:6（description 末段）
... 诚实边界：D-80 的家目录展开目前做在 watchdog 侧，`lib.mjs` 的 `absolutizePath()` 本身仍不展开；复合层载荷把命令放进变量时判不了（设计边界，非缺陷）。

# ② plugin/CHANGELOG.md:148-151（v0.5.6 变更 4 的诚实边界）
- **诚实边界 —— 本条只修了一半**：家目录展开目前做在 **watchdog 侧**；
  `plugin/scripts/lib.mjs` 的 `absolutizePath()`（`lib.mjs:585`）**本身仍不展开家目录写法**。
  也就是说：凡是不经 watchdog 这条路径的去家目录判断，仍可能把真实存在的文件判成「不存在」。
  台账 D-80 记为「部分已修」，残余归 `lib.mjs` 的归属成员 —— 本版**不声称**该缺陷已全修。

# ③ plugin/skills/super-agent-router/references/contract.md:397-398（S8.1 硬规矩 3）
3. **「判存在性前必须展开家目录」** —— 不展开就会把真实存在的文件判成「不存在」，
   同样是误拦。（已知残余：`lib.mjs` 的 `absolutizePath()` 本身仍不展开家目录，
   展开目前做在 watchdog 侧 —— 见台账 D-80 的「还需要什么」。）

# ④ plugin/README.md:475-477（本轮新增发现）
- **家目录展开目前只在收尾判定这一侧做**（v0.5.6 的 D-80 只修了一半）：
  `~` / `$HOME` / `%USERPROFILE%` 的展开做在 watchdog（收尾校验）侧；
  底层路径折算函数本身仍不展开。
  影响面：经由收尾判定的那条路已不受影响；不经由它的其它路径仍可能把家目录下的真实文件判成「不存在」。
```

⇒ **四处口径共同的问题不是「说得不准」，而是「现在说反了」** —— 修复后 `absolutizePath()` **确实**展开家目录了。这四处必须一起改，否则用户按 README 与包描述去理解，会以为「底层仍不展开」而继续绕路。**另**：台账 `docs/audit/defect-ledger.md:1292`（D-85 状态「待修」）与 `:1324`（D-80 状态「部分已修」）也需在收口时更新 —— 本单不改台账（边界要求）。

## 7. 仍然开着的边界（如实列出）

1. **D-80 的用户可见症状本次没有翻转**（§4.2）—— watchdog 链路改前改后完全相同；本次修的是 lib 层复发口。**任何「此前家目录写法会被误拦」的说法都是夸大。**
2. **D-85 只堵「产生侧」** —— 台账里若已有历史的 `/dev/null` 待审项，`--grant` 仍会把它写进 scope（那属别的成员的归属面，且改成「批不了」正是本单明确不采的方向）。历史条目需人工在待审清单里拒绝。
3. **贴写形态的真实文件目标仍未归一** —— `echo hi >out.txt`（运算符与目标贴写）的 token 仍是 `>out.txt`，与白名单条目 `out.txt` 对不上 ⇒ 仍判越界。**既有行为，非本单引入**，改它要动 `extractPathTokens()` 的语义。
4. **fd 复制（`2>&1`）仍会被当成写目标** —— `rm foo 2>&1` 的 `2>&1` 仍进写目标集合（我的实测：`extractWriteTargets('rm foo 2>&1')` = `["foo","2>&1"]`）。它不是空设备、也不是路径，属另一族问题，本单未处理。
5. **`dd of=/dev/null` 改后仍 DENY** —— `of=` 参数形态不被识别为空设备（保守方向：宁可多判不可漏判）。不算缺陷，但发布说明若列举「空设备一律放行」，这条是反例。
6. **`tee /dev/null` 改前 DENY / 改后 ALLOW** —— 符合 D-85 口径，但是**用户可观测的行为变化**，应写进发布说明。
7. **本单验的是「机制对不对」，不是「链路通不通」** —— 全部用合成 PreToolUse 载荷驱动真实 `guard.mjs`/`watchdog.mjs`（契约 S3；RT-04）。真实运行时某工具会不会被派发/拦住是另一问，本单无真实会话触发记录，故不作平台级结论。
8. **只覆盖 win32 / Node v26.7.0 / PowerShell 5.1** —— Linux / macOS 全部未验证。
9. **`/dev/*` 家族只按名称白名单识别** —— 判定认的是「形态」（名字在集合里），不是「设备是否存在」。在真机上 `/dev/null` 存在与否不影响判定（本单在 win32 上验的，`/dev/null` 根本不存在，判定照样生效）。
10. **`cmd >` 与 `rm` 的兜底拒绝未变** —— 解析不出目标即拒绝，C6/C7 已钉。

## 8. PRIOR_LESSONS

**无内容**（该成员暂无错题本，本次为空 —— 按契约要求显式写明，不静默省略）。

## 9. 结论

**VERDICT: PASS_WITH_CONDITIONS**

**一句话：两条缺陷的修复本身是对的，且不是静默放行** —— D-80 的展开确实下沉到 `absolutizePath()` 内部、在拼工作区根之前；D-85 的空设备确实从**写目标提取**与**判定对象**两处都剔掉，真实越界照拦、真实写动词仍算写、解析不出仍兜底拒绝、`> null` 与 `/dev/urandom` 仍被当写目标。回归 13 套 828 条 0 FAIL、既有 20 个变异体全转绿、我的 9 个独立变异里 7 个两套都抓得住。

**条件（都不是机制缺陷，不阻塞这两条修复合入）**：
1. **补两条永久断言**（§3 F-1 / F-2）：① 家目录取不到时**不得造路径**；② `/dev/urandom` 与 `/dev/random` **不得被当空设备**。缺这两条，下一轮有人改动这两处，41 条断言拦不住。
2. **父会话收口四处文档口径**（§6）：`plugin.json` description、`CHANGELOG.md:149`、`references/contract.md:397`、`README.md:475`；并更新台账 D-80 / D-85 的状态行。
3. **发布说明按 §7 的口径写**：D-80 修的是 lib 层复发口（**不是**翻转可见症状）；D-85 有两处用户可观测变化（`tee /dev/null` 放行、`dd of=/dev/null` 仍拦）。

**本单未改 `plugin/` `tests/` `tools/` `docs/audit/*.md` 一行**，未 commit / push / deploy / 建号，未改台账编号与状态。唯一写入 = `docs/audit/.tmp-v055/`（本报告 + 10 个探针/工具脚本 + 若干一次性写入夹具，夹具已清理）。
