# v0.5.7 一键安装 / 卸载 —— 独立验收报告（v062）

- **验收方**：verifier，会话 `mvs_26fc11cb8e99483697531140266df940`
- **验收对象**：`install.ps1`、`uninstall.ps1`、根 `README.md`（安装 / 卸载两节）、成员报告 `docs/audit/.tmp-release/install-v057.md`
- **验收时间窗**：2026-11-11T09:27:44+08:00 ~ 10:10:12+08:00（本报告全部原始输出均出自该窗口）
- **报告落盘**：`docs/audit/.tmp-v055/verification-v062.md`（正式路径由父会话转写，本单不写正式路径）
- **隔离声明**：全程**未触碰**真实安装目录 `C:\Users\yang2\.minimax\plugins\super-agent-router`（只做只读列目录）。所有安装 / 卸载实跑都在 `%TEMP%\sar-v062-*` 下的仓库副本 + 临时目标上完成。
- **方法声明**：**不采信成员报告自述输出**，全部结论以本方实跑原始输出为准；阴性结论一律配阳性对照（金丝雀）+ 时间戳 + 会话标识。

---

## 0. 结论速览

| # | 验收项 | 结论 | 关键证据 |
|---|--------|------|----------|
| 1 | 一键安装真能装上 | **PASS** | 源 28 / 目标 28，`MISSING=0 DIFFER=0 EXTRA=0`，hooks 引用的 5 个脚本全部存在 |
| 2 | 幂等（同版本不重装） | **PASS** | 二次运行报「已是最新」；`guard.mjs` mtime ticks 与哈希逐字未变；无 `.backup`，`.staging` 残留 0 |
| 3 | 源校验失败不装一半 | **PASS** | 退出码 1、报「已停止，没有安装任何东西」、目标目录**根本没被创建** |
| 4a | 默认卸载 → 移入 `.trash` | **PASS** | 原位无残留、`.trash` 内 28 文件完整、同级 `other-plugin` 存活、项目 `.superagent` 未动 |
| 4b | `-Purge` 真删、不误伤同级 | **PASS** | 插件目录已删；`super-agent-routerX`、`super-agent-router-backup` 及其标记文件均存活 |
| 4c | 默认不动运行时台账 | **PASS** | 真实台账 `files before=1 / after=1`，目录仍在 |
| **4d** | **尾随空格路径身份** | **FAIL** | **`GetFullPath` 裁掉尾随空格 ⇒ `-Purge` 真删了用户未指定的同级目录**（详见 §10） |
| 5 | `-VerifyOnly` 零写入 | **PASS** | 目标目录未被创建；已装状态下再跑，快照（哈希 + mtime）逐字相同 |
| 6 | `-Project` 播种空名录 | **PASS** | 4 目录 + 4 模板逐字节一致、`members=[]`、无 BOM、`changes.log` 0 字节、重跑不覆盖 |
| 7 | PS 5.1 BOM / 语法 / 中文不乱码 | **PASS** | 两文件首 3 字节 `ef bb bf`；`ParseFile` errors=0；输出含中文且无 U+FFFD、无 `?` 替换 |
| 8 | README ↔ 脚本逐字一致 | **PASS（有 2 处口径不一致 + 1 处外部门槛）** | 命令 / 参数 / 路径字面量 18/20 一致；模板数 3 vs 4、手工复制清理项不全、clone 地址当前 404 |
| 9 | 两条边界判断 | **已判定** | 边界一：宿主代码级证实不会当插件加载（机制与成员表述略有出入）；边界二：保守失败方向**正确** |

**总判定：PASS_WITH_CONDITIONS** —— 九项中八项 PASS，**第 4d 项 FAIL**（真实缺陷，需在公开发布前修）；另有 3 处文档口径问题需一并修。

> **交付前复核（2026-11-11T10:08~10:10+08:00）**：F1 的决定性反例已用修正版探针重跑，证据强度提升到内容级（SHA256）；真实安装目录与运行时台账经只读复核**未被本单触碰**。**九项判定与总判定均不变。**（证据见 §10.8）

---

## 1. 待验产物与工作树基线

```text
$ git status --short
 M README.md
?? LICENSE
?? install.ps1
?? uninstall.ps1

$ git diff --name-only -- plugin/
(空 —— 插件包零改动成立)

$ node -e "console.log(require('./plugin/.minimax-plugin/plugin.json').version)"
0.5.7

$ git log --oneline -3
746f755 chore: 把误入仓库根的 MCode 运行时参考文件移出版本控制（.gitignore 早已声明排除）
af35968 feat(mechanism): v0.5.7 —— 家目录展开下沉 + 空设备不是写目标（D-80 / D-85 闭环）
4c035ab docs(audit): v0.5.6 收口后最终复核通过（VERDICT: PASS，剩余阻塞项 0）
```

文件时间线（UTC）：

```text
install.ps1    2026/11/11 00:58:54
uninstall.ps1  2026/11/11 00:58:54
LICENSE        2026/11/11 01:02:25
README.md      2026/11/11 01:18:59   <-- 晚于成员交付，父会话又改过
docs/audit/.tmp-release/install-v057.md  2026/11/11 01:13:03
```

---

## 2. 第 1 项 —— 一键安装真能装上（PASS）

实跑（`v062-i123.ps1`，2026-11-11T09:37:37+08:00）：

```text
SRC_FILE_COUNT=28
== 源包校验
  [OK] plugin.json：name=super-agent-router version=0.5.7
  [OK] hooks.json 引用的 5 个脚本全部存在：session-start.mjs, gate.mjs, dispatch.mjs, guard.mjs, watchdog.mjs
  [OK] 源包文件数：28
== 安装
  [OK] 自校验通过：28 个文件，SHA256 全部一致
  [OK] 安装完成：...\target\super-agent-router
  [OK] 最终目录复核通过：28 个文件，SHA256 全部一致
ITEM1_INSTALL_EXIT=0

ITEM1_SRC_FILES=28 DST_FILES=28 MISSING=0 DIFFER=0 EXTRA=0
ITEM1_HOOK_SCRIPT session-start.mjs EXISTS=True
ITEM1_HOOK_SCRIPT gate.mjs EXISTS=True
ITEM1_HOOK_SCRIPT dispatch.mjs EXISTS=True
ITEM1_HOOK_SCRIPT guard.mjs EXISTS=True
ITEM1_HOOK_SCRIPT watchdog.mjs EXISTS=True
```

---

## 3. 第 2 项 —— 幂等：同版本不重装（PASS）

```text
ITEM2_GUARD_MTIME_TICKS_BEFORE=639299365801120997 HASH_BEFORE=BF189F0B1408F564
== 已是最新 —— 不重装
  [OK] 目标已是 v0.5.7，与源一致，跳过安装（没有备份、没有覆盖）
ITEM2_SECOND_RUN_EXIT=0
ITEM2_GUARD_MTIME_TICKS_AFTER=639299365801120997 HASH_AFTER=BF189F0B1408F564
ITEM2_GUARD_UNCHANGED=True
ITEM2_BACKUP_DIR_EXISTS=False
ITEM2_STAGING_RESIDUE_COUNT=0
```

---

## 4. 第 3 项 —— 源校验失败 ⇒ 不装一半（PASS）

夹具：仓库副本里删掉 `plugin/scripts/guard.mjs` 后安装。

```text
ITEM3_BROKEN_SRC_GUARD_EXISTS=False
== 源包校验
  [X] hooks.json 引用的脚本不存在：scripts/guard.mjs

  [X] 源包校验未通过（1 项）—— 已停止，没有安装任何东西。
ITEM3_BROKEN_EXIT=1
ITEM3_TARGET_EXISTS=False        <-- 目标目录压根没被创建
```
## 5. 第 4 项 —— 卸载（4a / 4b / 4c PASS，4d FAIL）

### 5.1 4a 默认卸载（PASS，2026-11-11T09:33:41+08:00）

```text
== super-agent-router 卸载程序
  [OK] 已移到回收位：...\plugins\.trash\super-agent-router-20261111-093342
  [i] 运行时台账仍在（未动）：C:\Users\yang2\.minimax\v2\plugin-data\hooks\super-agent-router
UNINSTALL_DEFAULT_EXIT=0
ORIGINAL_GONE=True
TRASH_ENTRIES=1
TRASH_ENTRY name=[super-agent-router-20261111-093342] files=28
OTHER_PLUGIN_SURVIVES=True
PROJECT_STATE_UNCHANGED=True
REAL_LEDGER_EXISTS_AFTER=True
REAL_LEDGER_FILES_AFTER=1
```

### 5.2 4b `-Purge` 真删且不误伤同级（PASS，2026-11-11T09:30:10+08:00）

```text
  [OK] 已彻底删除：...\plugins\super-agent-router
UNINSTALL_PURGE_EXIT=0
SIBLING super-agent-routerX exists=True marker=True
SIBLING super-agent-router-backup exists=True marker=True
PLUGIN_GONE=True
```

### 5.3 4c 默认不动运行时台账（PASS）

```text
REAL_LEDGER_FILES_BEFORE=1
REAL_LEDGER_FILES_AFTER=1
REAL_LEDGER_EXISTS_AFTER=True
```

阳性对照说明：该台账目录**非空**（1 个文件），所以「1 → 1」是实测相等，不是「那里本来什么都没有」。

### 5.4 4d 尾随空格路径身份 —— **FAIL**

见 §10（单独展开，含复现步骤与根因定位）。

---

## 6. 第 5 项 —— `-VerifyOnly` 零写入（PASS）

```text
VERIFY_EXIT=0
== VerifyOnly：只校验，未写入任何文件
  [i] 本次没有创建任何目录或文件：...\i5-target
VERIFY_TARGET_EXISTS=False        <-- 目标目录未被创建
PARENT_SNAP_AFTER_VERIFYONLY_LEN=0   <-- 父目录快照为空：连 .staging 都没建

--- 阳性对照（金丝雀）：同一目标上跑真安装 ---
CANARY_SNAP_CHANGED=True
CANARY_BEFORE_LEN=8 AFTER_LEN=4348
CANARY_FILE_COUNT=28

--- 已安装状态下再跑一次 -VerifyOnly ---
VERIFYON_EXISTING_EXIT=0
VERIFYON_EXISTING_SNAP_IDENTICAL=True      <-- 快照逐字相同（含每个文件的 mtime ticks）
VERIFYON_EXISTING_LEN1=4348 LEN2=4348
SOURCE_PLUGIN_UNCHANGED=True
```

结论：`--VerifyOnly` 分支在代码上位于依赖检查 / 源校验 / 目标现状检查**之后**、安装**之前** `exit 0`（`install.ps1:280`），实测零写入成立；金丝雀证明快照法确实能测出写入，不是「测不出」。

---

## 7. 第 6 项 —— `-Project` 播种空名录（PASS）

```text
SEED_EXIT=0
== 播种项目状态层
  [i] 已建目录：methods / lessons / incidents / agent-snapshots
  [OK] 已播种：methods\_TEMPLATE.md
  [OK] 已播种：lessons\_TEMPLATE.md
  [OK] 已播种：incidents\_TEMPLATE.md
  [OK] 已播种：agent-snapshots\_README.md
  [OK] 已播种：roster.json（members 为空数组 —— 默认 0 个成员）
  [OK] 已播种：STATUS.md
  [OK] 已播种：changes.log（空文件）

STATE_EXISTS=True
DIR methods exists=True / lessons True / incidents True / agent-snapshots True
ROSTER_HAS_BOM=False
ROSTER_MEMBERS_COUNT=0
ROSTER_VERSION=1
ROSTER_NONASCII_CHARS=57          <-- note 中文完好，未乱码
CHANGES_LOG_BYTES=0
TEMPLATE methods\_TEMPLATE.md srcExists=True dstExists=True identical=True
TEMPLATE lessons\_TEMPLATE.md  ... identical=True
TEMPLATE incidents\_TEMPLATE.md ... identical=True
TEMPLATE agent-snapshots\_README.md ... identical=True
RERUN_NO_OVERWRITE=True           <-- 已存在文件不覆盖（写入标记后复跑仍为标记）
```

结论：播种语义成立。**注意一处口径问题**：脚本实际播种 **4** 个模板文件，README 与成员报告都写「三个模板」（详见 §11-F2）。

---

## 8. 第 7 项 —— PS 5.1：BOM / 语法 / 中文不乱码（PASS）

```text
BOM install.ps1 head=ef bb bf hasBom=True
PARSE install.ps1 errors=0 tokens=2163
FFFD_IN_FILE install.ps1=0
BOM uninstall.ps1 head=ef bb bf hasBom=True
PARSE uninstall.ps1 errors=0 tokens=770
FFFD_IN_FILE uninstall.ps1=0
OUT_HAS_ANZHUANG=True          <-- 输出含「安装」
OUT_HAS_YUANBAO=True           <-- 输出含「源包校验」
FFFD_IN_OUTPUT=0
QUESTION_MARKS_IN_OUTPUT=0
```

结论：两个 .ps1 都是 UTF-8 with BOM，PS 5.1 自带 parser 零错误，实跑中文无乱码、无 `?` 替换。这一项是成员最容易踩坑的地方（无 BOM 会被 ANSI 解读而 ParseError），实测确实过关。

---

## 9. 第 8 项 —— README ↔ 脚本逐字一致（PASS，附 2 处不一致 + 1 处外部门槛）

本方自写对账脚本 `v062-i8c.cjs`（**不复用**成员的 `_check-readme-consistency.mjs`），从 README 正则抽出全部脚本命令行、从两个 .ps1 的 `param()` 块抽参数名，双向对账：

```text
install.ps1 params: ["Target","Project","VerifyOnly"]
uninstall.ps1 params: ["Target","Purge","PurgeData"]
README command lines (8):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Target "D:\minimax-plugins"
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Project "D:\my-project"
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -VerifyOnly
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge -PurgeData
PASS  README flag supported: install:Target / install:Project / install:VerifyOnly
PASS  README flag supported: uninstall:Target / uninstall:Purge / uninstall:PurgeData
PASS  install param mentioned in README: install:Target / install:Project / install:VerifyOnly
PASS  uninstall param mentioned in README: uninstall:Target / uninstall:Purge / uninstall:PurgeData
PASS  README states empty members array
PASS  install.ps1 writes empty members
PASS  README says VerifyOnly writes nothing
PASS  README purge claim verbatim path check
PASS  uninstall.ps1 has verbatim check code
PASS  README trash path matches script .trash
PASS  README ledger path matches script
PASS  install.ps1 VerifyOnly exits before install block
PASS  uninstall default=move to trash, Purge=delete
PASS  README manual-copy warns about private memory
FAIL  README template-count matches script   scriptTemplates=4 readmeSaysThree=true
==== README/SCRIPT CONSISTENCY PASS 18 FAIL 2 ====
```

（第 2 条 FAIL 是**我方探针写错**，不是产品缺陷 —— 见 §14-b；真实不一致只有模板数那一处。）
---

## 10. 第 4d 项独立判断：尾随空格路径身份 —— **FAIL**（本单最重的一条）

### 10.1 成员声称了什么

成员报告 §2 设计口径表：

```text
| `-Purge` 删前逐字校验路径在插件目录内，且**不 trim** | 路径尾随空格是路径身份的一部分，裁剪会删错目录 |
```

脚本 `uninstall.ps1:70` 自己也写了同一句：

```text
# 路径安全判定：**不 trim**（路径尾随空格是路径身份的一部分，裁剪会删错目录）
```

### 10.2 实测反例（决定性）

构造成对目录：`X` 与 `X `（尾随空格，用 `\\?\` 扩展路径 API 创建，Windows 常规 API 无法创建这种名字），两者**各自**放一个 `super-agent-router` 目录并放可辨标记文件。然后对**带尾随空格的那个**跑 `-Purge`：

```text
===== 4g-1 : two sibling roots X and X(space), each with its own plugin dir =====
CREATE_SPACED_ROOT=True
BASE_CHILD name=[p] nameLen=1
BASE_CHILD name=[p ] nameLen=2          <-- 两个目录确实并存，名字只差尾随空格
PRE plain plugin marker exists=True
TARGET_ARG=[...\sar-v062-i4g-20261111-093912\p ] len=65

== super-agent-router 卸载程序
  [i] 插件目录 : ...\sar-v062-i4g-20261111-093912\p\super-agent-router     <-- 尾随空格被吃掉了
  [i] 安装根   : ...\sar-v062-i4g-20261111-093912\p
  [OK] 已彻底删除：...\sar-v062-i4g-20261111-093912\p\super-agent-router
UNINSTALL_EXIT=0
POST plain plugin dir exists=False
POST plain plugin MARKER exists=False     <-- 用户【没指定】的那个目录被真删了
POST spaced root survived=True
SPACED_ROOT_CHILD name=[super-agent-router] nameLen=18   <-- 用户【指定】的那个纹丝不动
```

### 10.3 根因定位

```text
===== 4f : GetFullPath trimming evidence =====
SPACED_LEN=67 NORM_LEN=66
GETFULLPATH_LEN=66 TRIMMED_EQUAL=True
GETFULLPATH_EQ_NORM=True
```

`uninstall.ps1:86` 与 `install.ps1:189` 都用 `[System.IO.Path]::GetFullPath($Target)`，而 **`GetFullPath` 会裁掉路径末尾的空白**。所以：

- 脚本注释里那个「不 trim」的 `Test-SafePath`（`uninstall.ps1:72-81`）**根本没机会生效** —— 裁剪发生在它上游的 `GetFullPath`，等到它比对时路径已经被规范化过了；
- 成员报告 §2 的「裁剪会删错目录」这句警告，说的正是**实际发生**的事，只是成员把它当成了已被防住的假设。

### 10.4 安装侧同源问题

```text
===== 4g-2 : install with trailing-space Target =====
  [i] 安装目标 : ...\q\super-agent-router     <-- 传入的是 q(带空格)，实际落到 q
INSTALL_SPACED_TARGET_EXIT=0
BASE2_CHILD name=[p] nameLen=1
BASE2_CHILD name=[p ] nameLen=2
BASE2_CHILD name=[q] nameLen=1             <-- 建的是 q，不是 q(带空格)
```

即：`-Target "...\q "` 与 `-Target "...\q"` 在脚本眼里**完全等价**，装到哪个目录由裁剪后的名字决定；`-Project` 同样走 `GetFullPath`（`install.ps1:331`）。

### 10.5 复现步骤（可复核）

```powershell
# 1) 用扩展路径 API 造两个同名只差尾随空格的根：X 与 "X "，各放一个 super-agent-router
# 2) uninstall.ps1 -Target "<父目录>\X " -Purge
# 3) 观察：脚本打印的「安装根」是 <父目录>\X（空格消失），且 X\super-agent-router 被真删
```

### 10.6 期望 vs 实际

| | 期望（按脚本注释与成员报告的设计口径） | 实际 |
|---|---|---|
| `-Target "...\X "` | 只作用于 `X `，绝不碰 `X` | 作用到 `X`，`X\super-agent-router` 及其标记文件被真删 |
| `-Purge` 的「逐字确认路径在插件目录内」 | 能挡住尾随空格造成的错位 | 该确认发生在裁剪之后，挡不住 |

### 10.7 影响面与严重度

- **影响**：`-Purge` 路径下是**误删用户未指定的目录**；`-Target` / `-Project` 路径下是**装/写到另一个目录**。
- **触发前提**：目标根目录名带尾随空格。Windows 常规 API（`CreateDirectory`、`Join-Path`、cmd `mkdir`、node `fs`）都会规范化掉尾随空格，所以这种目录只能由 `\\?\` 扩展路径、NTFS 直写或少数工具产生 —— 概率不高但并非不存在。
- **为什么仍要按缺陷记账**：本插件自己刚在 v0.5.6 修过同类洞 —— `plugin/CHANGELOG.md` 明确写「插件数据目录判定按**目录名逐字**比较（Windows 上带**尾随空格**的同名目录不再被误判成插件目录）」。同一类「尾随空格 = 路径身份」的问题，在新的 install / uninstall 脚本里以另一形态重现。
- **修法方向（不在本单实施）**：在 `GetFullPath` **之前**判定入参是否带尾随空白 —— 要么 fail closed（带尾随空白就报错退出），要么全程不做规范化拼接。
- **可检出性**：现有测试没有覆盖这一形态 —— 成员的 103 条断言里没有「同名只差尾随空格」的用例，所以它在自测里是绿的。

### 10.8 交付前复核（v062-r2）：反例重跑 + 真实安装目录只读复核

交付前重跑一次 F1，确认「决定性反例」不是一次性偶然。首版探针 `v062-i4g.ps1` 有一处夹具缺陷（spaced 侧标记路径多打一个空格，详见 §14(f)），本轮改用修正版探针 `v062-i4g2.ps1`：两侧标记文件都写上，并加了一行**机制直证**。

```text
SESSION=mvs_26fc11cb8e99483697531140266df940 TIME=2026-11-11T10:09:56.6665359+08:00
MECH_GetFullPath_of_p_space=[C:\Users\yang2\AppData\Local\Temp\sar-v062-i4g2-20261111-100956\p]
CREATE_SPACED_ROOT=True
CREATE_SPACED_PLUGIN=True
PRE plain marker exists=True
PRE spaced marker exists=True
PRE spaced marker sha256=4D1FDC29459AF5471B8FE0B61FB37C47FAE7BD5BE1E4063CE39BE706242B6D03
TARGET_ARG=[C:\Users\yang2\AppData\Local\Temp\sar-v062-i4g2-20261111-100956\p ] len=66

== super-agent-router 卸载程序
  [i] 插件目录 : C:\Users\yang2\AppData\Local\Temp\sar-v062-i4g2-20261111-100956\p\super-agent-router
  [i] 安装根   : C:\Users\yang2\AppData\Local\Temp\sar-v062-i4g2-20261111-100956\p
  [OK] 已彻底删除：C:\Users\yang2\AppData\Local\Temp\sar-v062-i4g2-20261111-100956\p\super-agent-router
UNINSTALL_EXIT=0

POST plain plugin dir exists=False
POST plain plugin MARKER exists=False
POST spaced plugin dir exists=True
POST spaced marker exists=True
POST spaced marker sha256=4D1FDC29459AF5471B8FE0B61FB37C47FAE7BD5BE1E4063CE39BE706242B6D03
SPACED_MARKER_UNCHANGED=True
BASE_CHILD name=[p] nameLen=1
BASE_CHILD name=[p ] nameLen=2
DONE_TIME=2026-11-11T10:09:56.9131190+08:00
```

复核要点：

- **机制直证**：`MECH_GetFullPath_of_p_space=[...\p]` —— 同一进程内 `[System.IO.Path]::GetFullPath()` 直接把 `p ` 规范化成 `p`（尾随空格消失），根因不依赖卸载脚本的其它行为；与 `uninstall.ps1:86` 的源码行一一对应（该行已逐行核对属实）。
- **删错了对象**：用户传入的是 `TARGET_ARG=[...\p ]`（带尾随空格，len=66），脚本打印的「插件目录 / 安装根」变成 `[...\p]`（空格消失）；`POST plain plugin dir exists=False` + `POST plain plugin MARKER exists=False` ⇒ **用户【没指定】的 `p\super-agent-router` 及其内容被真删**。
- **指定对象纹丝不动**：用户指定的 `p \super-agent-router` 目录仍在（`POST spaced plugin dir exists=True`），其标记文件 **SHA256 前后完全相同**（`4D1FDC29…6D03` ⇒ `SPACED_MARKER_UNCHANGED=True`）⇒ 不只是没被删，**内容也一字未动**。
- **两个根确实并存**：`BASE_CHILD name=[p] nameLen=1` 与 `name=[p ] nameLen=2`。
- **判定不变**：F1 仍判 **FAIL**，且证据强度由「目录级」提升到「**内容级（SHA256）**」。

同轮顺带做了**真实安装目录的只读复核**（只列目录，不写不删）：

```text
CHECK_TIME_UTC=2026-11-11T02:08:52.5727654Z
SESSION_ID=mvs_26fc11cb8e99483697531140266df940
REAL_DIR_EXISTS=True
REAL_FILE_COUNT=28
REAL_NEWEST_FILE_MTIME=2026-11-10T21:37:23.2202822Z
REAL_DIR_MTIME=2026-11-10T07:42:38.4637021Z
REAL_PLUGINJSON=True
L_LEDGER_EXISTS=True
L_LEDGER_FILE_COUNT=1
PLUGINS_ROOT_CHILDREN=super-agent-router
```

真实目录内最新文件 mtime = `2026-11-10T21:37:23Z`（= 2026-11-11T05:37+08:00），**早于本单全部写入窗口（09:27~10:10+08:00）**；运行时台账仍为 1 个文件；`~/.minimax/plugins` 下只有 `super-agent-router` 一个子目录（未留下任何 `p ` / `q ` 之类的测试残留）。工作树基线复核仍为 ` M README.md` / `?? LICENSE` / `?? install.ps1` / `?? uninstall.ps1`，与 §1 一致。

---

## 11. 第 9 项：两条边界的独立判断

### 11.1 边界一：MCode 扫描 `~/.minimax/plugins/` 会不会把 `.backup/` / `.staging/` / `.trash/` 当插件加载

**结论：不会当插件加载 —— 但机制与成员表述略有出入。** 证据来自本机已安装宿主（MCode）包内 `app.asar` 的真实代码（`resources/app.asar`，371,919,371 字节）：

```text
--- 插件根路径来自 dataDir ---
pluginsDir: path.join(dataDir, 'plugins'),          // = ~/.minimax/plugins

--- listLocalPluginCandidates：扫描【直接子目录】，没有任何点开头过滤 ---
async function listLocalPluginCandidates(rootPath) {
    const candidates = [];
    for (const child of await readdir(rootPath, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const childPath = path.join(rootPath, child.name);
        try {
            const childStat = await lstat(childPath);
            if (childStat.isSymbolicLink() || !childStat.isDirectory()) continue;
            candidates.push({ directoryName: child.name, rootPath: await realpath(childPath) });
        } catch { continue; }
    }
    ...sort...
}

--- detectLocalPluginPackage：必须有 manifest，否则 return undefined（不算插件）---
async function detectLocalPluginPackage(rootPath, root, dataDir = path.dirname(path.dirname(rootPath))) {
    if (await pluginPathExists(root, 'plugin.json', 'file')) { ... }
    const manifests = {
        hasMiniMax:   await pluginPathExists(root, '.minimax-plugin/plugin.json', 'file'),
        hasCompatible: await pluginPathExists(root, '.claude-plugin/plugin.json', 'file'),
        hasCodex:     await pluginPathExists(root, '.codex-plugin/plugin.json', 'file'),
    };
    if (!manifests.hasMiniMax && !manifests.hasCompatible && !manifests.hasCodex) return undefined;
    return readCandidatePackage(rootPath, manifests);
}
```

同时扫过宿主全量代码找「点开头目录过滤」与「递归扫描」，结论：

```text
dot-dir filter near plugin: 0        <-- 没有 startsWith('.') 之类的过滤
'.backup' firstIndex=-1              <-- 宿主代码里根本没有这三个名字
'.trash'   firstIndex=-1
'.staging' firstIndex=97728093       <-- 命中处是 electron-builder 配置，与插件扫描无关
readdir+plugin windows: 23           <-- 插件相关 readdir 全部是一层枚举，无递归
```

**据此的准确表述**：

- 宿主**会**把点开头目录当「候选」逐个看（没有点开头过滤），成员 §9.4 的理由「三个目录都以点开头且内无 plugin.json」在**结论上正确**，但**机制描述不准** —— 真正挡住它们的是「这些目录自己根部没有 manifest」，不是「点开头」；
- 而且扫描是**一层**的：`.trash/super-agent-router-<时间戳>/` 里躺着一份**完整插件包**（含 `.minimax-plugin/plugin.json`），但它挂在 `.trash` 下面，是候选目录 `.trash` 的**下一层**，不会被扫到；
- `.staging` / `.backup` 同理。

**证据边界（如实写明）**：这是**宿主代码级**证据（静态读本机已装 MCode 的 `app.asar`），**不是**活体触发记录 —— 要做活体验证需要在真实 `~/.minimax/plugins` 下造点开头目录，本单禁止写真实安装区，故未做。宿主升版可能改这层逻辑，结论应表述为「在当前这版宿主代码下成立」。

顺带记录当前真实插件目录状态（只读）：

```text
REAL_PLUGINS_DIR_EXISTS=True
REAL_PLUGIN_CHILD name=[super-agent-router] nameLen=18 isDir=True hasManifest=True
```

### 11.2 边界二：`hooks.json` 靠正则抽取脚本名，将来改写法 ⇒ 保守失败（中止安装），方向对不对

**结论：方向正确 —— 而且可实证。**

「方向正确」的判据：失败方向必须是「装不上 / 装了个坏的」之一，最好是前者（fail closed）。本方用**变异体**验证：把仓库副本 `plugin/hooks/hooks.json` 里的 `scripts/` 改成 `lib/`（正反斜杠两种写法都改），使正则抽不到任何引用：

```text
HOOKS_PATCHED_REMAINING_SCRIPT_REFS=0
== 源包校验
  [X] hooks.json 里没有解析到任何 PLUGIN_ROOT/scripts 引用

  [X] 源包校验未通过（1 项）—— 已停止，没有安装任何东西。
I9B_EXIT=1
I9B_TARGET_EXISTS=False        <-- 目标目录未被创建
```

即：**正则失配 ⇒ 报「没有解析到任何引用」⇒ 非零退出 ⇒ 一个字节都没装**。成员 §9.5 的描述与实际行为一致。

方向判语：**宁可装不上，也不要装个坏的** —— 成立。副作用是「将来改 hooks.json 写法会挡住安装」，这属于**设计取舍**而非缺陷，但需要在改 `hooks.json` 的同时同步改 `install.ps1` 的正则（`install.ps1` 里 `$rx = [regex]'PLUGIN_ROOT[^A-Za-z0-9_.-]*[\\/]+scripts[\\/]+([A-Za-z0-9_.\-]+)'`），否则发布会被自己的校验挡住。

---

## 12. 发现清单（按严重度）

### F1（高）尾随空格路径身份：`-Purge` 会真删用户未指定的同级目录

- **触发条件**：`-Target`（或 `-Project`）指向的根目录名带尾随空格，而同父目录下存在去掉空格后的同名目录。
- **影响**：卸载 `-Purge` 删除**用户没有指定**的目录树（数据丢失方向）；安装 / 播种写到另一个目录。
- **证据**：`§10.2` 实测（`POST plain plugin MARKER exists=False`）、`§10.3` 根因（`GETFULLPATH_EQ_NORM=True`）、`§10.4` 安装侧同源。
- **定位**：`uninstall.ps1:86`、`install.ps1:189`、`install.ps1:331`；`uninstall.ps1:70` 的注释与实现相反。
- **期望 / 实际**：期望「不 trim，只作用 `X `」；实际「裁剪后作用 `X`，删掉 `X` 下的插件」。
- **修法方向**：在 `GetFullPath` 之前对入参做尾随空白判定，fail closed 或改用不规范化拼接。

### F2（中）README「三个模板」与脚本实际「4 个模板」不一致

- **触发条件**：任何人读 `README.md:136` / `README.md:160` 并据此预期文件清单。
- **影响**：文档口径不符；用户按 README 预期只会拿到 3 个模板，实际多一个 `agent-snapshots/_README.md`。
- **证据**：`install.ps1:342-347` 模板数组 4 项；`install.ps1:190` 播种输出 4 条「已播种」；本方对账脚本 `FAIL README template-count matches script scriptTemplates=4 readmeSaysThree=true`。
- **附带**：成员报告 §2 也写「播种只放空名录 + 三个模板」，与其自身 §5.3 原始输出（4 条）自相矛盾。

### F3（中）README「手工复制」备选路径的清理清单不全，会漏掉本项目的成员名录

- **触发条件**：非 Windows 用户照 README「备选：手工复制」操作。
- **影响**：README 只让删「`methods/` 与 `lessons/` 里除 `_TEMPLATE.md` 之外的文件」（`README.md:162`），但仓库 `.superagent/` 根下还有 `roster.json`（**8 名成员**，含 owns / accepts / reject / `tier_granted_by: mvs_9bdda202ae274c909a5b4352fc45a471`）、`STATUS.md`、`changes.log`，README 未提清理 ⇒ 手工复制会把这些一并带给第三方，与 README 自己在「不会把本仓库的成员、方法论、错题本复制给你」一句的承诺不一致。
- **证据**：`.superagent/roster.json` 实读 `members` 计数 = 8；`.superagent/` 顶层 = `agent-snapshots, changes.log, incidents, lessons, methods, roster.json, STATUS.md`；`README.md:162`。
- **注意**：`-Project` 路径**没有**这个问题（实测播种 `members=[]`，且 `methods` 下只有 `_TEMPLATE.md`）。这是**手工路径独有**的缺口。

### F4（中，发布门槛，非 install / uninstall 缺陷）README 的 clone 地址当前 404

- **触发条件**：第三方按 `README.md:105` 执行 `git clone https://github.com/qsxcv20/super-agent-router.git`。
- **影响**：一键安装的第一步直接失败，公开可用性不成立。
- **证据**：`GET https://api.github.com/repos/qsxcv20/super-agent-router` → `{"message":"Not Found","status":"404"}`；`GET https://github.com/qsxcv20/super-agent-router` → HTTP 404。
- **归属**：成员报告 §9.2 说 README 里是占位符、URL 由父会话统一处理；但当前 README 里已是**具体地址**，说明父会话后来填了（README mtime 01:18:59 晚于成员交付 01:13:03）。仓库尚未公开 / 尚不存在 —— **发布前必须处理**，本单不代做（不改可见性、不 push）。

### F5（低）成员报告「README 全文其余部分一字未动」已被后续改动打破

- **证据**：成员 §7.3 原话；当前 README 含成员未声明的第 3 行 MIT 徽章、`README.md:327` 的「## 许可」节、以及具体 clone 地址 —— 均为成员交付**之后**（README mtime 01:18:59 > 成员最后写 01:01:52）由他人写入。
- **影响**：不属成员记账问题，但父会话转写正式报告时不应把徽章 / 许可节 / URL 记成成员产出。

### F6（低）`uninstall.ps1` 的「逐字确认」在结构上恒真

- **定位**：`uninstall.ps1:105-108`：`$expected = Join-Path $TargetRoot $PluginName` 后与 `$PluginDir` 比 —— 而 `$PluginDir` 本身就是上一行用同样两个量拼出来的（`uninstall.ps1:87`），所以这个比较**永远相等**，不构成任何额外保护。
- **影响**：README「`-Purge` 才真删；删前脚本会逐字确认目标路径确实在插件目录内」（`README.md:204`）与成员报告 §10.1 第 11 项的「删前确认在插件目录内、不 trim」在**实现上**没有对应物；真正起作用的只是「固定用 `super-agent-router` 这个名字 + `Test-SafePath` 前缀检查」。
- **为什么仍列**：这是 F1 得以溜过去的结构原因 —— 检查看着在、实则不设防。

---

## 13. 两个专项结论

### 13.1 专项一：4 个自测脚本（103 条断言）是否值得移进仓库 / 可移植性 / 代价

**先纠正一个事实**：成员 §1 列的是 **6** 个验证脚本（另有 `_cleanup.mjs`），断言数 103 = `_sandbox-test.ps1` 43 + `_sandbox-test2.ps1` 13 + `_verify-seed.mjs` 22 + `_check-readme-consistency.mjs` 25（4 个**带断言**的），另有 `_add-bom.mjs`、`_parse-check.ps1` 两个工具脚本。

**结论：值得移进仓库，但必须改造后再移，不能原样搬。**

理由（仓库内先例）：本仓库已有 `tools/run-tests.mjs`，其头部注释写明「**它要进仓库**：验收壳是证据链的一环。放在临时目录里的壳，『谁在什么口径下跑的、跑的是哪几套』无法被第三方复核」。同一把尺子应当适用于这 4 个脚本。而且 `.gitignore` 含 `docs/audit/.tmp-*/` ⇒ 这些脚本**当前根本不在仓库里**（成员 §9.7 也承认），`.tmp-release` 一清理，103 条断言对第三方就永久不可复跑 —— 这正是「供别人使用」交付标准下最该补的一环。

**可移植性核查（结论：没有写死本机绝对路径，但写死了仓库相对路径与版本字面量）**：

| 脚本 | 绝对路径 | 相对/环境依赖 | 版本字面量 |
|---|---|---|---|
| `_sandbox-test.ps1` | **无**（用 `(Resolve-Path '.').Path`） | 写死 `docs\audit\.tmp-release\_sandbox`；`$env:USERPROFILE = $fakeHome` 做隔离（好） | 写死 `0.5.7` / `0.5.6`（4 处） |
| `_sandbox-test2.ps1` | **无** | 写死同一沙箱路径 | 写死 `9.9.9`（他插件版本，无害） |
| `_verify-seed.mjs` | **无**（`process.cwd()`） | 写死 `path.join(ROOT,'docs','audit','.tmp-release','_sandbox')`；调用 `powershell` | 写死 `0.5.7` |
| `_check-readme-consistency.mjs` | **无** | 纯读 README / 两个 .ps1（cwd 相对） | 无 |

另注：`.gitignore` 有 `_*.mjs` 规则 ⇒ 若原名搬进仓库，`_verify-seed.mjs` / `_check-readme-consistency.mjs` 会被**静默忽略**，必须改名或加否定规则。

**移进去的代价（必须一起付）**：

1. 路径改造：2 个 .ps1 + 1 个 .mjs 里的沙箱路径字面量要改（建议改为 `%TEMP%` 或脚本同级 `_sandbox`，并把沙箱写进 `.gitignore`）；
2. 版本解耦：`_sandbox-test.ps1` 的 4 处 + `_verify-seed.mjs` 的 1 处版本字面量应改为从 `plugin/.minimax-plugin/plugin.json` 读取，否则每次发版都要改测试（现在就会立刻在 0.5.8 上变红）；
3. 平台标注：依赖 `powershell` 命令与 PS 5.1 ⇒ 只能在 Windows 跑，CI 需标注跳过；
4. 文件名：去掉前导 `_`（否则被 `_*.mjs` 规则吃掉），并在 `README.md` 目录结构里补一行；
5. 运行入口：建议加一个 `tools/install-selftest/run-all.ps1`（或并入现有 `tools/run-tests.mjs` 的套件发现机制），让第三方一条命令复跑 103 条断言。

**替代方案**：若不想承担上述 5 项改造，至少把 `_check-readme-consistency.mjs`（纯读、无版本字面量、跨平台 node）搬进仓库 —— 它守的是本单最容易复发的一类洞（文档写了脚本不支持的参数），性价比最高。

### 13.2 专项二：`LICENSE`（MIT）归属 —— 确认没记错账

**结论：成员的记账是对的 —— `LICENSE` 不是成员产物；记到父会话账上正确。**

证据链：

```text
1) LICENSE CreationTimeUtc = LastWriteTimeUtc = 2026-11-11 01:02:25Z，1062 字节，MIT，Copyright (c) 2026 yang2
2) 成员的 install.ps1 / uninstall.ps1 最后写 = 00:58:54Z；成员的 README 最后写 = 01:01:52Z
   ⇒ LICENSE 的创建时间比成员最后一次写 README 晚 33 秒，比成员写两个 .ps1 晚 3 分 31 秒
3) 成员自己的会话 transcript（保存在父会话 2026/11/10/10-06-24-456-session_*/messages.jsonl 内）里明确写道：
   "但注意：git status 现在多了 `?? LICENSE` —— 这不是我创建的！是别人（父会话或其它成员）刚创建的。我没有碰它。"
   并自行核对："LICENSE 的 mtime 是 2026-11-11T01:02:25Z，README.md 的 mtime 是 01:01:52Z ... 所以 LICENSE 是在我改 README 之后 33 秒创建的 —— 不是我创建的"
4) 成员报告 §9.9 如实标注：「仓库里的 LICENSE（MIT，mtime 2026-11-11T01:02:25Z）不是本单产物 ... 从未创建 LICENSE」，§11.6 再次提醒「别把 LICENSE 记到本单账上」
5) 成员最终 git status 已含 `?? LICENSE`（说明它出现在成员收工前，不是收工后新出现的）
6) 当前 README 的 MIT 徽章（第 3 行）、## 许可 节（第 327 行）、具体 clone 地址（第 105 行）均**不在**成员 §7 的 README 改动清单里，且 README mtime 01:18:59Z 晚于成员交付 01:13:03Z ⇒ 这三处是成员交付之后由父会话补的，与 LICENSE 同属父会话侧的产物
```

**一处诚实的边界**：我在保留的父会话 transcript 里**没有定位到写 LICENSE 的那一次 tool call 原文**（只找到成员引用它的片段），所以「父会话并发写入」是与全部可用证据一致的**推断**，而非直接命中的写调用记录。能**直接证实**的是那个否定命题：**不是成员产物**（mtime 次序 + 成员自述 + 成员 git status 三条独立证据同向）。

记账建议：LICENSE + README 徽章 + README 许可节 + README 具体 clone 地址 ⇒ **一并记在父会话账上**，不记成员账。成员报告 §9.9 / §11.6 的标注如实、诚实，无记账错误。

---

## 14. 我自己的探针 / 夹具错误（自曝）

按「探针错必须自曝」的纪律，本单我犯过 6 个探针级错误，全部已在正文对应位置更正，不影响上述结论：

- **(a) 首次 hooks.json 变异只替换了正斜杠形式**：初版把 `/scripts/` 改成 `/lib/`，但 `hooks.json` 里 Windows 形式 `scripts` 仍在 ⇒ 正则照样抽出 7 个引用 ⇒ 安装正常成功。当时那次的「安装成功」是**我的变异没做干净**，不是产品行为。修正版（正反斜杠同时改、剩余引用 0）才拿到 §11.2 的决定性输出。
- **(b) 对账脚本有一条断言写错**：我断言「`uninstall.ps1` 不含 `.superagent`」，但脚本**收尾提示文案**里本来就有一句「项目里的 `.superagent/` 与运行时台账是**数据**」—— 子串匹配命中的是**提示语**。该 FAIL 是**我的探针错**，不是产品缺陷；实际行为已由 4a 的 `PROJECT_STATE_UNCHANGED=True` 证明。
- **(c) 一次断言引用了过期路径变量**：第 3 项脚本里的 `ITEM3_STAGING_EXISTS` 指向的是第 1 项目标的 `.staging`（变量复用），该行输出无意义；有效证据是 `ITEM3_TARGET_EXISTS=False`。
- **(d) `.mjs` 里用 `require`**：仓库 `package.json` 为 ESM，`.mjs` 里 `require` 直接报错；对账脚本改用 `.cjs` 后正常。
- **(e) 我自写 base64 编码器最初把非 ASCII 当单字节**，导致脚本中文乱码；改成三字节 UTF-8 后正常。另外 PS 5.1 读**无 BOM** 的 UTF-8 .ps1 会按 ANSI 解读而 ParseError —— 我所有自写 .ps1 一律保持**纯 ASCII**，从根上绕开这个坑（成员与我在本单都栽过这一跤，成员的处理方式正确：给两个 .ps1 加 BOM）。

- **(f) 复核轮发现首版 F1 探针的夹具缺陷（标记路径多打一个空格）**：首版探针 `v062-i4g.ps1:28` 写 spaced 侧标记时路径多了一个空格（目标成了 `p \super-agent-router \SPACED_PLUGIN_MARKER.txt` —— 目录名 `super-agent-router ` 带尾随空格，而实际建成的是 `super-agent-router`）⇒ 该次 `WriteAllText` 抛 `DirectoryNotFoundException`，**spaced 侧标记根本没写进去**。当时该侧的存活证据是**目录清单**（`SPACED_ROOT_CHILD name=[super-agent-router] nameLen=18`），不依赖标记，故 §10.2 的结论本身不受影响；但「用户指定目录内容一字未动」这一条当时**没有内容级证据**。复核轮改用修正版探针 `v062-i4g2.ps1`（两侧标记都写上）补上了 SHA256 前后相同的证据（§10.8）。

另：本单自写的探针 / 夹具全部落在 `docs/audit/.tmp-v055/`（唯一可写目录），未改动 `install.ps1` / `uninstall.ps1` / `README.md` / `plugin/**` / `tests/**` / `tools/**` / `docs/audit/*.md` / `.superagent/**`，未 commit / push / deploy / 改可见性 / 建 Release。

---

## 15. 仍然开着的边界

1. **F1 的活体触发未做**：尾随空格根目录只能由 `\\?\` 扩展路径 API 造出；本单没有在真实 `~/.minimax/plugins` 下造点开头 / 尾随空格目录来触发宿主加载行为（禁止写真实安装区），故边界一的结论是**宿主代码级**而非活体触发级。
2. **边界一的宿主版本依赖**：结论基于本机当前 MCode 版本的 `app.asar`；宿主升版可能改这层扫描逻辑，结论应表述为「当前这版宿主代码下成立」。
3. **README 的 clone 地址可达性**：当前 404（F4）。仓库一旦公开，F4 自动消解 —— 但在公开前，README 的一键安装路径对外不可用。
4. **F1 修复后的回归**：本单未修改代码，故「修复后 103 条断言是否仍全绿、是否新增尾随空格用例」不在本单范围。
5. **成员报告与当前 README 的差量**：README 在成员交付后被父会话改过（徽章 / 许可节 / URL）。若父会话要转写正式报告，需以**当前** README 为准重新对一次账（我的 §9 对账就是基于当前 README，18/20 一致）。
6. **`install.ps1` / `uninstall.ps1` 在真实 `~/.minimax/plugins` 上的实跑**：本单全部在临时目标上做（真实目录只读）。真实目录上的首次安装（`~/.minimax/plugins` 不存在 → 需新建根）这一形态未实测。

---

## 16. VERDICT

**PASS_WITH_CONDITIONS**

- 九项中 **八项 PASS**（1 / 2 / 3 / 4a / 4b / 4c / 5 / 6 / 7），第 8 项 PASS 但附 2 处文档口径不一致与 1 处外部门槛，**第 4d 项 FAIL**。
- **必须修（公开发布前）**：F1（尾随空格路径身份 —— `-Purge` 误删用户未指定目录）。修法方向：在 `GetFullPath` 之前判定尾随空白并 fail closed；同时删掉/改写 `uninstall.ps1:70` 与 README 里与实现相反的「不 trim」表述（F6），并补一条「同名只差尾随空格」的回归用例。
- **应当修**：F2（README「三个模板」→ 四个）、F3（README 手工复制路径的清理清单补 `roster.json` / `STATUS.md` / `changes.log`）。
- **发布门槛**：F4（clone 地址当前 404）—— 属父会话职责（公开 / push）。
- **记账**：F5 / §13.2 —— LICENSE、README 徽章、README 许可节、README 具体 clone 地址**记父会话**，不记成员；成员报告 §9.9 / §11.6 如实，无记账错误。

---

*验收方：verifier / `mvs_26fc11cb8e99483697531140266df940` / 2026-11-11T09:27~10:10+08:00。所有原始输出见 §2-§11 与 §10.8；所有结论均出自本方实跑，未采信成员报告自述输出。*