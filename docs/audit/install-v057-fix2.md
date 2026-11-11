# v0.5.7 公开前最后一轮收尾（fix2）—— 修 v063 复验的 V1 / V2 / V3 / V4

| 项 | 内容 |
|---|---|
| 依据 | `docs/audit/verification-v063.md`（复验方原文，父会话按字节转写，sha256 `30e540394e610c33bcb19f421b6fd01704288f7486efc7424fd5add7107e886a`） |
| 要修的 | V1（中）/ V2（低）/ V3（低）/ V4（低）四条非阻断发现 |
| 不推翻 | 上一轮的 F1 尾随空白 fail closed、F6 内容级 manifest 核对、F2 / F3 文档口径 —— 全部保留（§5.2 逐条核对） |
| 不做 | 不升版、不改 `plugin/`、不动 `.superagent/`、不碰 `docs/audit/*.md`（正式路径由父会话转写）、不 commit / push / 改可见性 / 建 tag |

改动文件全部在 SCOPE 内（§7 列出）。每条改动都给出「文件:行号」+「原始输出」。

---

## 1. V1（中）—— 尾随空格断言不具区分度

### 1.1 复验方指出的问题（照抄其判定，不加演绎）

`tools/install-selftest/trailing-space-test.mjs` 里所有「非零退出」类断言**只断言退出码，不看输出**。
BEFORE 侧（摘掉 F1 守卫）家目录场景**也是红的** —— 它的非零退出来自 `Move-Item` 搬不动带尾随空格的路径（install.ps1 的 catch 分支），**与守卫无关**。
⇒ 这条红**钉不住守卫**：把守卫整个摘掉，它照样红。

### 1.2 改法：断言从「非零退出」升级为「非零退出 + 恰好命中该入口的守卫消息 + 没有任何成功标记」

| 位置 | 改了什么 |
|---|---|
| `tools/install-selftest/trailing-space-test.mjs:55-78` | 新增判定函数：`guardPhrase()` / `guardHit()` / `guardOnly()` / `hitMarkers()`；`ENTRY_LABELS` 固定三个入口标签（`USERPROFILE（家目录）` / `-Target` / `-Project`），必须与两个 .ps1 里传给 `Assert-NoTrailingWhitespace` 的 label **逐字一致** |
| `trailing-space-test.mjs:161-168` | uninstall 侧 `-Target` 场景：拆成「非零退出且命中守卫」+「守卫只命中 -Target 这一条入口」+「无任何成功标记」 |
| `trailing-space-test.mjs:192-198` | install 侧 `-Target` 场景：同上 |
| `trailing-space-test.mjs:216-222` | install 侧 `-Project` 场景：同上 |
| `trailing-space-test.mjs:241-247` | install 侧家目录场景：同上（入口 `USERPROFILE（家目录）`） |
| `trailing-space-test.mjs:264-270` | **新增** uninstall 侧家目录场景 —— 之前完全没覆盖「卸载的家目录入口」 |
| `trailing-space-test.mjs:39-46` | FAIL 明细压成单行（powershell 的 Write-Host 带 CRLF，直接拼进 FAIL 行会把终端刷花，报告不可读） |

「只因守卫而红」用三件事同时成立来钉：

1. 退出码非 0；
2. 输出里**恰好**命中「路径参数 <入口> 含尾随空白」，且**另外两个入口的守卫消息一条都不许出现**（`guardOnly`）；
3. 输出里**没有任何成功标记** —— install 侧：安装完成 / 已播种 / 自校验通过 / 最终目录复核通过 / 已创建安装根目录 / 已是最新；uninstall 侧：已彻底删除 / 已移到回收位 / 删前核对通过 / 运行时台账已移到回收位。

每个场景另外补了**构造有效性的阳性证据**（不靠脚本行为反推）：两个同名根确实并存（`:158`）、参数确实多一个尾随空格（`:159`）、带空格的项目目录 / 家目录确实存在（`:213` / `:238` / `:260`）。

### 1.3 验证：突变体对照（唯一能证明「有牙齿」的证据）

突变体做法与验收方一致：**只把 `Assert-NoTrailingWhitespace` 的调用行整行替换成 `$script:__mutantNoOp = $true`**（函数定义保留），install 3 处 / uninstall 2 处；突变体目录带 `plugin/` 与 `.superagent/` 兄弟目录。

```
AFTER : PASS 39 / FAIL 0  exit=0
BEFORE: PASS 19 / FAIL 20  exit=1

=== 恰好转红（AFTER 绿、BEFORE 红）=== 20 条
  带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）
  带尾随空格的 -Target：守卫只命中 -Target 这一条入口
  带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）
  带尾随空格的 -Target：用户【没指定】的目录仍在
  带尾随空格的 -Target：用户【没指定】的目录内容一字未动
  install 带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）
  install 带尾随空格的 -Target：守卫只命中 -Target 这一条入口
  install 带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）
  install 带尾随空格的 -Target：无空格的那个目录未被创建
  install 带尾随空格的 -Project：非零退出且命中守卫（-Project 入口）
  install 带尾随空格的 -Project：守卫只命中 -Project 这一条入口
  install 带尾随空格的 -Project：输出里没有任何成功标记（只因守卫而红）
  install 带尾随空格的 -Project：无空格的项目目录未被播种
  install 带尾随空格的 -Project：目标插件目录未被创建
  install 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）
  install 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口
  install 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）
  install 家目录带尾随空格：带空格的家目录下也没建 .minimax
  uninstall 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）
  uninstall 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口
=== 恰好转红 = 20 条 ===
=== 恒绿 = 19 条（金丝雀 6 条 + 构造有效性 13 条）===
EXTRA-RED（AFTER 红）= 0 ; MISS = 0
```

突变体脚本语法自检（`ParseFile`）：`PARSE_OK docs/audit/.tmp-release/mutant/install.ps1` / `PARSE_OK .../mutant/uninstall.ps1`。

**关键一条**：BEFORE 侧「install 家目录带尾随空格」那条现在红了，明细是

```
FAIL  install 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）   :: code=1 命中守卫=false out=
FAIL  install 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）   :: 出现了成功标记：自校验通过,已创建安装根目录
```

即：BEFORE 的退出码**确实还是非 0**（它也会失败），但输出里**没有守卫消息**、且**出现了成功标记**
（自校验通过 / 已创建安装根目录）⇒ 断言把它钉成红。这正是 V1 要的那件事：**红的原因是守卫，不是别的原因**。

---

## 2. V2（低）—— 尾随反斜杠：装得上、卸不掉

### 2.1 根因（实测，不是推理）

```
GetFullPath(D:\foo\)                  = [D:\foo\]      <- 保留尾随反斜杠
Split-Path -Parent(D:\foo\super-agent-router) = [D:\foo]   <- 去掉尾随反斜杠
Join-Path(D:\foo\, super-agent-router) = [D:\foo\super-agent-router]
```

`uninstall.ps1` 原来直接比 `$parentOfTarget -ne $TargetRoot` ⇒ `D:\plugins` ≠ `D:\plugins\` ⇒ 必红。

端到端复现（**改前**的真实输出）：

```
--- A) target="C:\Users\yang2\AppData\Local\Temp\sar-probe-v2-...\plainroot\"
install exit=0 | ... [OK] 安装完成：C:\...\plainroot\super-agent-router
plugin dir exists = true
uninstall exit=1
  [X] 删前核对未通过：目标的父目录 "C:\...\plainroot" 不是安装根 "C:\...\plainroot\"，已停止。
plugin dir still exists = true

--- B) target="C:\Users\yang2\AppData\Local\Temp\sar-probe-v2-...\has space\"
install exit=0 | ... [OK] 安装完成：C:\...\has space\super-agent-router
uninstall exit=1
  [X] 删前核对未通过：目标的父目录 "C:\...\has space" 不是安装根 "C:\...\has space\"，已停止。
```

（带空格的路径同样复现 ⇒ 与路径长度 / 空格无关，纯粹是尾随分隔符。）

### 2.2 改法

- **新增** `Get-ComparablePath()`（`uninstall.ps1:100-114`）：比较前把路径形态归一。
  **只动分隔符，一个空白都不动** —— 空白是路径身份的一部分，F1 的语义一个字不许松。
  - 统一 `/` → `\`（`:107`）；
  - 去掉尾随分隔符（`:111`）；
  - **盘符根特判**（`:109`）：`C:\` / `C:` 归一成 `C:\`，**不能归成 `C:`**；
  - UNC 根 `\server\share` 归一成 `\server\share\`（`:110`）。
- 插件目录的比较改成归一后比（`uninstall.ps1:167-172`）；台账目录同样（`uninstall.ps1:217`）。
- **没有改 `install.ps1`**：它的路径拼装不依赖父目录比较，`Join-Path` 本身能处理尾随分隔符
  （实测 `Join-Path(D:\foo\, super-agent-router) = D:\foo\super-agent-router`）。

### 2.3 验证

改后（同一个探针，同一个参数）：

```
uninstall exit=0
  [i] 删前核对通过：路径级结构自检一致（末段 + 父目录），内容级确认是本插件目录（manifest name=super-agent-router）
  [OK] 已彻底删除：C:\...\plainroot\super-agent-router
plugin dir still exists = false
```

永久回归断言（`tools/install-selftest/sandbox-test2.ps1:140-175`，场景 18 / 19，共 8 条）：

- S18「构造有效性：尾随反斜杠确实传到了脚本」（`:163`）—— 用一个把入参原样写回文件的 `arg-echo.ps1` 探针（`:145-161`）**证明**参数真的带着尾随反斜杠进了脚本，不靠脚本行为反推；
- S18 安装 exit 0 + 插件目录已建（`:165-166`）；
- S19 卸载 exit 0 + 插件目录已删 + 输出命中「manifest name=super-agent-router」（证明内容级核对确实跑了，不是被跳过）（`:171-175`）。

---

## 3. V3（低）—— leaf/parent 两条是派生式恒真

### 3.1 问题

`$PluginDir = Join-Path $TargetRoot $Script:PluginName` ⇒ `$leaf` 与 `$parentOfTarget` **都是自己拼出来的**，
期望值与被检值同源 ⇒ 恒真。这两条**不构成独立验证**，但上一轮把它写成了「两条独立核对」
（`uninstall.ps1` 的 .DESCRIPTION、README 卸载节、上一轮交付报告）。

### 3.2 改法：**不删功能，只降级措辞**

| 位置 | 改成了什么 |
|---|---|
| `uninstall.ps1:10-16`（.DESCRIPTION） | 明写「路径级（**结构自检**，不构成独立验证）… 期望值与被检值同源，只防实现层面的错位」+「内容级（**唯一有牙齿的一条**）：读 .minimax-plugin\plugin.json 核对 name」 |
| `uninstall.ps1:159-161`（代码注释） | 同上，并加一句「这一层**挡不住「作用到了别的目录」**，不要把它当成安全保证」 |
| `uninstall.ps1:178-180` | 内容级标注为「**唯一有牙齿的一条**」，并写明它挡得住哪一类 |
| `uninstall.ps1:189`（成功提示） | 「删前核对通过：路径级结构自检一致（末段 + 父目录），内容级确认是本插件目录（manifest name=…）」 |
| `uninstall.ps1:211`（台账段） | 同样标成「结构自检（期望值与被检值同源 ⇒ 不构成独立验证）」，比较也改用归一值 |
| `README.md:241-246` | 卸载节改成两层核对：路径级明写「挡不住「作用到了别的目录」」，内容级明写是「唯一有牙齿的一条」+「非零退出，且目标目录一个字节都不删」 |
| `tools/install-selftest/check-readme-consistency.mjs:161-177` | **新增 8 条断言**：脚本与 README 都**不许**再出现「两条独立核对」，且**必须**出现「结构自检」「唯一有牙齿的一条」「挡不住」 |

### 3.3 补的永久断言（错目标 ⇒ 零删除）

`tools/install-selftest/sandbox-test2.ps1:107-137`（场景 16 / 17，共 10 条）：

- **S16 夹具**（`:118`）：目标目录里的 manifest `name` 是 `some-other-plugin`（**确实是别的插件**）；
- **S17 夹具**（`:132`）：目标目录**读不到 manifest**（没有 .minimax-plugin 目录）；
- 两个场景各 4 条：卸载退出码非 0 + 报错命中内容级 manifest 核对 + 目标目录仍在 + **整棵目录的「相对路径 + SHA256」串前后完全相同**（一个字节都没删、没改）。

「一个字节都没删」用整棵目录的哈希串比对（`Get-TreeHash`，`sandbox-test2.ps1:42-52`），不是只查一个标记文件。

实测（截自 `tools/install-selftest/run-all.ps1` 的输出）：

```
--- 场景 16：uninstall -Purge 目标不是本插件目录（manifest name 不符）-> 拒绝删除 ---
PASS  S16 夹具就绪：目标确实是「不是本插件目录」（manifest name 不符）
PASS  S16 退出码非 0
PASS  S16 报错命中内容级 manifest 核对
PASS  S16 目标目录仍在
PASS  S16 目标目录一个字节都没删（整棵目录哈希前后相同）
--- 场景 17：uninstall -Purge 目标读不到 manifest -> 拒绝删除 ---
PASS  S17 夹具就绪：目标确实读不到 manifest
PASS  S17 退出码非 0
PASS  S17 报错命中内容级 manifest 核对
PASS  S17 目标目录仍在
PASS  S17 目标目录一个字节都没删（整棵目录哈希前后相同）
```

---

## 4. V4（低）—— 头部声明的条数与实测不符

### 4.1 实测出来的真值（自己跑出来的，不是抄 v063）

| 套件 | 改前头部写的 | 实测 | 改后 |
|---|---|---|---|
| `sandbox-test.ps1` | 43 | **41** | 41 |
| `sandbox-test2.ps1` | 13 | **30**（本单新增 17） | 30 |
| `trailing-space-test.mjs` | 18 | **39**（本单改造 + 新增） | 39 |
| `verify-seed.mjs` | 22 | **21** | 21 |
| `check-readme-consistency.mjs` | （没写） | **90**（本单新增 36） | 90 |
| `run-all.ps1` | 43 / 13 / 18 / 22 | — | 改为**不再另抄一份** |

合计 **221 条**（41 + 30 + 39 + 21 + 90），加 `run-all.ps1` 自身 **7 条**条数对账。

### 4.2 机器断言（防漂）：三层绑在一起

1. **机器标记**：每个套件头部有唯一一行「机器标记：ASSERTION-COUNT: NN」
   （`run-all.ps1:6`、`sandbox-test.ps1:6`、`sandbox-test2.ps1:6`、`trailing-space-test.mjs:3`、
   `verify-seed.mjs:2`、`check-readme-consistency.mjs:3`）。
2. **运行期核对**（`run-all.ps1:86-104`）：跑完每个套件，数它**实际输出**里以 PASS / FAIL 开头的行数，
   与它头部的 `ASSERTION-COUNT` 比；再比总数；最后一条比 `run-all` 自身实际跑了多少条。
3. **静态三方一致**（`check-readme-consistency.mjs:179-207`）：机器标记 ↔ 头部人类可读文本「（NN 条断言）」
   ↔ `README.md:211-217` 表格里的条数，三者必须一致。

README 的自测表因此新增「断言条数」一列（`README.md:211-217`），数字与各套件头部**同源**，不再各抄一份。

### 4.3 这条断言**有牙齿**（不是恒绿）

把 `sandbox-test2.ps1` 的头部条数从 30 故意改成 31 再跑 `run-all.ps1`：

```
FAIL  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 31 / 实际 30）   :: declared=31 actual=30
FAIL  套件 sandbox-test2.ps1 头部人类可读条数与机器标记一致（31 条断言）   :: 头部没有「（31 条断言）」
FAIL  README 自测表里 sandbox-test2.ps1 的条数与机器标记一致（31）   :: README 写的是 30
FAIL  全部套件断言总数：声明 222 == 实际 221   :: declared=222 actual=221
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====
exit=1
```

改完**已自动还原**，还原后该文件仍是「机器标记：ASSERTION-COUNT: 30」（还原过程写在
`docs/audit/.tmp-release/v4-teeth-check.mjs` 的 `finally` 块里）。

---

## 5. 逐条验收核对

### 5.1 v063 §7 的四条发现

| 发现 | 要求 | 落地 | 证据 |
|---|---|---|---|
| **V1** | 非零退出类断言必须命中守卫消息、能分辨入口、只因守卫而红、装卸两侧覆盖 | ✔ | §1.2 / §1.3：突变体 **20 条恰好转红**、**19 条恒绿**（金丝雀 6 条仍在）、EXTRA-RED 0 |
| **V2** | 两侧按去掉尾随分隔符归一后再比；根路径特判；只动分隔符不动空白；补永久回归断言 | ✔ | §2：改前「装得上、卸不掉」实测 + `Get-ComparablePath`（`uninstall.ps1:100-114`）+ 场景 18/19 共 8 条 |
| **V3** | 不再宣称「两条独立核对」；统一改成「路径级是结构自检、内容级才有牙齿」；补错目标零删除的永久断言 | ✔ | §3：脚本 5 处 + README 1 处 + 对账 8 条 + 场景 16/17 共 10 条 |
| **V4** | 自己实跑量出条数再更新；加机器断言 | ✔ | §4：实跑 41 / 30 / 39 / 21 / 90 = 221；三层绑定；**改错即红**（§4.3） |

### 5.2 上一轮的 F1 / F6 / F2 / F3 有没有被本单改坏

| 上一轮 | 现状 | 证据 |
|---|---|---|
| **F1** 尾随空白 fail closed | **保留**：`Assert-NoTrailingWhitespace` 一个字没改；两个 .ps1 仍在 `GetFullPath` **之前**拦 | 突变体对照 20 条恰好转红（§1.3）；`check-readme-consistency.mjs:126-135` 的 F1 组 6 条断言仍全绿 |
| **F6** 内容级 manifest 核对 | **保留**：`uninstall.ps1:178-187` 的内容级核对原样；只是把措辞从「两条独立核对」改成「唯一有牙齿的一条」 | §3.2；S16 / S17 实测内容级核对会红、目标目录零删除（§3.3）；`check-readme-consistency.mjs:137-147` 的 F6 组断言仍全绿 |
| **F2** README 四个模板并列全 | **保留**：README 模板段未动 | `check-readme-consistency.mjs:100-117` 的 F2 组断言仍全绿 |
| **F3** 手工复制清理清单 | **保留**：README 手工复制表未动 | `check-readme-consistency.mjs:118-125` 的 F3 组断言仍全绿 |

### 5.3 方法论验收清单（`.superagent/methods/sa-plugin-release.md`）

| 清单项 | 结果 | 证据 |
|---|---|---|
| plugin.json 的 version 与 CHANGELOG 顶部条目版本号一致 | ✔ | version=`0.5.7`；CHANGELOG 顶部 `## [0.5.7]` —— 本单**不升版**（理由见 §5.4） |
| plugin.json 的 description 覆盖本次全部行为变更，未承诺未实现的能力 | ✔（不适用） | 本单改的是**仓库根**的 install / uninstall 脚本与 README，`plugin/` 零改动 ⇒ 插件包行为无变更 ⇒ description 无需变动 |
| CHANGELOG 每条含「改了什么 / 为什么 / 怎么验证」 | ✔（不适用） | 同上：`plugin/` 零改动 ⇒ 无新增包内行为变更 ⇒ 不新增 CHANGELOG 条目 |
| hooks.json 引用的每个脚本在 plugin/scripts/ 下都真实存在 | ✔ | 实测 `hooks refs=5 missing=[]`（session-start / gate / dispatch / guard / watchdog） |
| README 说明安装位置、启用验证方法、故障排查路径 | ✔ | 本单只改卸载节的**措辞**与自测表；安装位置 / 启用验证 / 排查路径三段未动 |
| 全程只改动 SCOPE 内的文件 | ✔ | §7；`git status --short` 见 §6 |

### 5.4 为什么**不升版**、不改 CHANGELOG（如实交代，不装作没这回事）

本单改的是**仓库根**的 `install.ps1` / `uninstall.ps1` / `tools/install-selftest/` / 根 `README.md`。
**`plugin/` 一行没动**（§6 的 `git diff --name-only -- plugin/` 为空）⇒ 插件包本身没有行为变更。
按方法论「版本号按语义化递增，把本次行为变更摘要写进 description」，本单**不构成插件包行为变更**，
因此**不升 version、不改 description、不新增 CHANGELOG 条目**。
（上一轮的 v0.5.7 已经在位，本单是**同一版本发布前**的收尾。）

---

## 6. 关键命令与原始输出

```
$ powershell -NoProfile -ExecutionPolicy Bypass -File "tools/install-selftest/run-all.ps1"

  sandbox-test.ps1              41 条 0 FAIL
  sandbox-test2.ps1             30 条 0 FAIL
  trailing-space-test.mjs       39 条 0 FAIL
  verify-seed.mjs               21 条 0 FAIL
  check-readme-consistency.mjs  90 条 0 FAIL
  ---- 合计 221 条 0 FAIL ----
  PASS  套件 sandbox-test.ps1 实际断言条数 == 头部声明（声明 41 / 实际 41）
  PASS  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 30 / 实际 30）
  PASS  套件 trailing-space-test.mjs 实际断言条数 == 头部声明（声明 39 / 实际 39）
  PASS  套件 verify-seed.mjs 实际断言条数 == 头部声明（声明 21 / 实际 21）
  PASS  套件 check-readme-consistency.mjs 实际断言条数 == 头部声明（声明 90 / 实际 90）
  PASS  全部套件断言总数：声明 221 == 实际 221
  PASS  run-all.ps1 自身实际断言条数 == 头部声明（7）
  ==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====

$ node tools/run-tests.mjs --all --root plugin --repo .
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
  >>> SHELL ALL PASS          # 13 套 / 836 条 / 0 FAIL（与上一轮基线逐项相同）

$ git diff --name-only -- plugin/
  （空）                      # plugin/ 零改动

$ node -e "console.log(require('./plugin/.minimax-plugin/plugin.json').version)"
  0.5.7

$ git status --short
   M README.md
  ?? LICENSE
  ?? docs/audit/install-v057-fix.md
  ?? docs/audit/install-v057.md
  ?? docs/audit/verification-v062.md
  ?? docs/audit/verification-v063.md
  ?? install.ps1
  ?? tools/install-selftest/
  ?? uninstall.ps1

$ git check-ignore -v tools/install-selftest/*.ps1 tools/install-selftest/*.mjs
  exit=1                      # 1 = 无一被忽略（自测文件会进版本库）

$ node -e "<逐文件 BOM / 行尾 / 字节数>"
  install.ps1                                      BOM=Y CRLF=n bytes=21627
  uninstall.ps1                                    BOM=Y CRLF=n bytes=13113
  tools/install-selftest/sandbox-test.ps1          BOM=Y CRLF=n bytes=12495
  tools/install-selftest/sandbox-test2.ps1         BOM=Y CRLF=n bytes=11863
  tools/install-selftest/run-all.ps1               BOM=Y CRLF=n bytes=5473
  tools/install-selftest/trailing-space-test.mjs   BOM=n CRLF=n bytes=18710
  tools/install-selftest/verify-seed.mjs           BOM=n CRLF=n bytes=6756
  tools/install-selftest/check-readme-consistency.mjs BOM=n CRLF=n bytes=13802
  README.md                                        BOM=n CRLF=n bytes=16162
```

（`LICENSE` 与 `docs/audit/*.md` **不是本单产物** —— 是别人/父会话的；本单只碰了 §7 列的那些。
所有 .ps1 保持 **UTF-8 BOM + LF**（PS 5.1 读无 BOM 的 UTF-8 .ps1 会按 ANSI 读坏，本项目已栽过）。）

---

## 7. 改动文件清单（全部在 SCOPE 内）

| 文件 | 改了什么 | 规模 |
|---|---|---|
| `uninstall.ps1` | V2：新增 `Get-ComparablePath` + 两处比较改用归一值；V3：.DESCRIPTION / 代码注释 / 成功提示 / 台账段降级措辞 | 10,913 → 13,113 B |
| `tools/install-selftest/trailing-space-test.mjs` | V1：断言升级为「命中守卫 + 只命中该入口 + 无成功标记」；**新增**卸载侧家目录场景；补构造有效性断言；FAIL 明细压单行 | 20 → 39 条 |
| `tools/install-selftest/sandbox-test2.ps1` | V2：场景 18 / 19（尾随反斜杠装卸 + arg-echo 构造有效性探针）；V3：场景 16 / 17（错目标零删除）；新增 `Get-TreeHash` | 13 → 30 条 |
| `tools/install-selftest/check-readme-consistency.mjs` | V2 / V3 / V4 三组对账断言（机器标记 ↔ 头部文本 ↔ README 表格） | 54 → 90 条 |
| `tools/install-selftest/run-all.ps1` | V4：逐套件核对「声明条数 == 实际 PASS+FAIL 条数」+ 总数核对 + 自身条数核对；头部**不再另抄**条数 | +7 条对账 |
| `tools/install-selftest/sandbox-test.ps1` | V4：头部条数 43 → 41 + 机器标记 | 41 条 |
| `tools/install-selftest/verify-seed.mjs` | V4：头部条数 22 → 21 + 机器标记 | 21 条 |
| `README.md` | V3：卸载节两层核对措辞；V2：尾随反斜杠说明；V4：自测表加「断言条数」列 | 15,373 → 16,162 B |
| `docs/audit/.tmp-release/install-v057-fix2.md` | 本报告（父会话转写正式路径） | — |

**没动**：`plugin/`（零改动）、`.superagent/`、`docs/audit/*.md`（正式路径由父会话转写）、`LICENSE`、
`install.ps1`（V2 不需要改它，见 §2.2）、`tests/`（仓库回归 13 套未动）。

---

## 8. 边界与未覆盖（不夸大）

1. **突变体只摘 F1 守卫**（install 3 处 / uninstall 2 处），**不检验 F6 的贡献**。F6 的贡献由 S16 / S17 直接实测
   （内容级核对会红、目标目录零删除），但**没有**做「摘掉 F6 ⇒ 哪几条转红」的突变体对照。
2. **真实安装目录未实跑**：`C:\Users\yang2\.minimax\plugins\super-agent-router` 全程只读、未被写入；
   真实运行时台账 `~/.minimax/v2/plugin-data/hooks/super-agent-router` 也没被碰。
   所有安装 / 卸载都在 `%TEMP%` 沙箱里、`%USERPROFILE%` 被重定向到假家目录。
3. **`-PurgeData` 分支本单没新增断言**（上一轮 `sandbox-test.ps1` 的 S10 覆盖了清台账；本单没动它）。
4. **尾随空格目录只在 NTFS 本机**通过 `\?\` 扩展路径造出；FAT32 / exFAT / 网络盘未验。
5. **尾随反斜杠的回归断言走无空格路径**：`%TEMP%` 路径不含空格时 PowerShell 的原生参数传递不给参数加引号，
   尾随反斜杠才能原样到达（带空格的路径在 **cmd.exe** 里会被反斜杠-引号转义吃掉 —— 那是 Windows 命令行引号规则，
   不是脚本能修的）。为了不把「shell 引号问题」混进「脚本路径处理」的断言里，S18 / S19 走无空格路径，
   并用 arg-echo 探针**证明**参数确实带着尾随反斜杠到了脚本（§2.3）。
6. **UNC 根的归一只做了代码级处理，没有实跑**（本机没建共享）。
7. **盘符根特判（`C:\` 不能归成 `C:`）是代码级保证，没有实跑**（把插件装到 `C:\` 根目录不在本单范围内，且有风险）。
8. `Get-ComparablePath` **只动分隔符**：它不做空白处理 —— 空白仍然由 `Assert-NoTrailingWhitespace`
   在更早一步 fail closed（F1 语义未松一个字）。
9. **未改仓库可见性 / 未 commit / 未 push / 未建 tag** —— 按协议由父会话统一做。

---

## 9. 自曝（本单自己踩的坑 / 无效探针）

1. **我自己写错过一条断言**：S16 的「夹具就绪」最初写成「目录哈希串里 Contains 插件名」，
   而 `$wrongBefore` 是**目录哈希串**（只含路径 + 哈希，**不含文件内容**）⇒ 那条断言自己红了。
   改成分别校验 manifest **内容**（`sandbox-test2.ps1:117-118`）与树哈希后才绿。
   **这是测试自己抓出来的**，不是靠改绿了事。
2. **头部条数我自己也写错过**：`sandbox-test2.ps1` 我先声明 29，实跑是 30 —— 正是 V4 要机器抓的那类漂移
   （后来由 `run-all.ps1` 的对账断言兜住）。
3. **探针有效性**：S18 / S19 的「构造有效性」不是靠脚本行为反推，而是用一个把入参原样写回文件的
   `arg-echo.ps1` 探针**证明**尾随反斜杠确实到达了脚本（回写值与入参逐字相等）。
4. **突变体的 BEFORE 侧家目录场景仍然是「非零退出」**（code=1）—— 如果只断言退出码，它会一直是绿（假绿）。
   现在靠「输出必须命中守卫消息」把它钉红，这正是 V1 的要害。
5. **清理临时沙箱时撞到一个已知限制**：`mavis-trash`（内部走 `FileSystem.DeleteDirectory`）**删不掉带尾随空格子目录的沙箱**
   （报「The system call level is not correct」），要用 `\?\` 扩展路径 + node 的 `fs.rmSync` 才删得掉。
   这与本项目 RT-08 是同一类问题（路径尾部空白是路径身份的一部分）。**本单没有去修宿主侧**，只如实记录。
6. **本单用过的临时脚本**（都在 gitignore 的 `docs/audit/.tmp-release/` 里，可复跑）：
   `probe-v2.ps1`（路径语义探针）、`probe-v2.mjs`（V2 改前 / 改后端到端复现）、
   `mutant-compare.mjs`（突变体对照）、`v4-teeth-check.mjs`（V4 防漂：改错即红、改完自动还原）、
   `parse-check.ps1`（`ParseFile` 语法自检）、`cleanup-tmp.mjs`（沙箱清理）。
7. **突变体目录已删除**（`mavis-trash.js`）：里面有 `plugin/` 与 `.superagent/` 的副本，留着会让后续审计误读。

---

## 10. 结论

V1 / V2 / V3 / V4 四条**全部落地**，且每条都有「改前会红 / 改后全绿」的机器证据（不是靠改断言让测试变绿）。
上一轮的 F1 / F6 / F2 / F3 **没有被改坏**；`plugin/` 零改动、版本仍 `0.5.7`。
仓库回归 **13 套 / 836 条 / 0 FAIL**；安装脚本自测 **5 套 / 221 条 + 7 条条数对账 / 0 FAIL**。
本单**未 commit / 未 push / 未改可见性 / 未建 tag** —— 正式路径的转写与发布动作留给父会话。


