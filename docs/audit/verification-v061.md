# D-80 / D-85 补测独立验收报告（v0.5.7 收口条件 ① 的复查）

- **复核方**：独立验收方（verifier）。本单 = **追加单**（第二单），复用上一单的契约与台账口径。
- **复核基准**：HEAD `4c035ab` + 父会话未提交的改动。**产品代码（`plugin/scripts/lib.mjs`、`plugin/scripts/guard.mjs`）逐字节未动**（SHA256 比对，见 §5.2）；本单只验**补测**（`tests/fix-d80-d85-test.mjs`）是否真把上一单的两个条件钉住。
- **环境**：win32 10.0.26200 x64 / Node v26.7.0 / PowerShell 5.1 / 会话 `mvs_26fc11cb8e99483697531140266df940`
- **时间戳**：2026-11-11 05:15 → 05:45 GMT+0800（矩阵收尾时间见 §5.4）
- **写入边界**：唯一写入 = `docs/audit/.tmp-v055/`（本报告 + 6 个探针脚本）。`plugin/` `tests/` `tools/` `docs/audit/*.md` 一行未改；未 commit / push / deploy / 建号；未改台账编号与状态。

## 0. 一句话结论

**条件 ① 已落实：两条永久断言都真钉住了。** 我用**上一单自己的锚点**（不是 worker 的开关）独立复现：

- F-1 变异（`homeDir()` 恒造假家目录）—— 上一单 worker 套件 **41/41 全绿**，现在 **2 FAIL**；
- F-2 变异（只放宽 `/dev/urandom` + `/dev/random`）—— 上一单 worker 套件 **41/41 全绿**，现在 **5 FAIL**。

**「恰好转红」这个升级不是自证**：我用三组注入分别打出「多红一条」「少红一条」「不该红的红了」，三条检出路径（`EXTRA-RED` / `MISS` / `WRONG-RED`）**全部被报出来**，且未改动的对照副本仍全 YES ⇒ 比对机制真的会失败。

**第 4 项（worker 自曝的那条断言）我的独立判断：不是恒绿，有独立牙齿，可接受。** 理由与证据见 §4 —— 关键是它能在「不造路径」断言**全绿**的情况下单独转红（这才是「有牙齿」的严格标准）。

**VERDICT: PASS** —— 上一单的三个条件现已全部闭合（① 本单验过；② 父会话已做，本单复核口径一致；③ 发布说明按 §7 口径写）。**无新增阻塞项。**

## 1. 复核方法与证据纪律

- worker 的交付报告与自述只当**待验对象**读，不当证据；所有结论以**代码 + 实测输出**为准。
- **独立复现**：第 1、2 项我**不用 worker 的开关**，而是用**上一单我自己写的锚点**（`mut-v060.mjs` 的 VM3、`mut4b-v060.mjs` 的 VM4b）重新打 —— 这两个锚点与 worker 的 `M-F1b` / `M-F2` 各自独立。
- **第 3 项不采信「矩阵全 YES」**：我往**临时副本**里注入故意的「多红 / 少红 / expectGreen 被违反」，看它**能不能报出来**；每次都配一个**未改动的对照副本**（必须仍全 YES），否则无法区分「注入生效」与「副本环境本身坏掉」。
- **第 4 项不采信 worker 的自曝措辞**：我把「不造路径」与「磁盘上不存在」两条断言**分开测**，并构造「只有后者能红、前者全绿」的场景，看它是否真能独立转红。
- 阴性结论一律配**金丝雀 + 时间戳 + 会话标识**；变异检验一律走**系统临时目录的插件副本**，仓库工作树零改动。

### 1.1 自曝：本轮探针的三次失误（都是我的夹具问题，不是产品缺陷）

1. **第一次跑「第 4 项」探针时，我把变异写成了「有兜底但兜底不触发」的形态** —— 我保留了 `try { return String(os.homedir() || ''); }` 这一行，只在后面追加 `return os.tmpdir()`。但兜底**只在 `os.homedir()` 不可得时才走到**，而父进程里 `os.homedir()` 一切正常 ⇒ **兜底根本没执行**，四种形态全绿（`red=0`）。这个「全绿」是**我的探针没打到点上**，不是断言恒绿的证据。改正：把 `homeDir()` 改成 `h || <兜底>` 的**无条件兜底**形态（`let h = ''; try {...} catch {...}; if (!h) { h = <X>; }`），让兜底在子进程（`os.homedir` 被改成抛错/返回空）里必然生效。改正后四种形态分别转红 2/4/2/2 条 —— 结论完全变了。
2. **第一次跑「不是自证」探针时，CASE A 的锚点命中错了位置** —— 我用 `indexOf(LABEL)` 找标签，但那个标签在文件里有**两处**（断言调用点在前、变异体的 `expect` 列表在后），`indexOf` 命中的是**断言调用点** ⇒ 我删掉的是断言本身，测出来的是「少红」而不是「多红」。改正：改用**以 `id: 'M-F2'` 为起点做索引区间定位**，只改 `expect` 列表里的那一处。改正后 `EXTRA-RED` 如期出现。
3. **CASE C（测 `WRONG-RED`）第一次注入把标签插进了 `expectGreen:` 键与数组之间**（非法位置）⇒ node `--check` 报 `SyntaxError: Unexpected string`，探针直接退出，**没测到东西**。改正：插到 `[` 之后（数组首元素位置），并加一道 `node --check` 语法自检再跑。改正后 `WRONG-RED` 如期出现。

> 这三条都是「**探针自己没打中 ⇒ 阴性结论看起来像阳性结论**」的同一类翻车 —— 上一单已因同类问题自曝过一次（「改前基线路径写错，看起来像放行」）。

## 2. 五项逐条结论

### 2.1 【PASS】F-1 真钉住了 —— 用我上一单自己的变异打出红

**worker 声称**：新增 4 条断言（`os.homedir` 抛错 / 返回空 × 「不造路径」/「产出路径磁盘上不存在」），走子进程探针；变异体 `M-F1` / `M-F1b` / `M-F1c`。

**我的独立复现**（`mut-v060.mjs` 的 VM3，锚点是我上一单写的，与 worker 的 `M-F1b` 各自独立 —— 我的是 `|| 'C:/fake/home/dir'` 形态，worker 的是整函数替换形态）：
```
==== VM3 :: homeDir() FABRICATES a home dir when unavailable
   worker-suite  exit=1 pass=47 fail=2
      W-FAIL FAIL F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=C:/fake/home/dir/sar-d80d85-f1-uLuDtI/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-6
      W-FAIL FAIL F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=C:/fake/home/dir/sar-d80d85-f1-uLuDtI/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-
   verifier-probe exit=1 pass=53 fail=2
      V-FAIL FAIL A9b no fabricated home dir in result :: out=C:/fake/home/dir/secret/file.txt
      V-FAIL FAIL A9c result equals naive workspace-root join (fallback = no expansion) :: out=C:/fake/home/dir/secret/file.txt
```
**对照上一单同一变异的数字**：worker 套件 **fail=0（41/41 全绿）** → 现在 **fail=2**。

⇒ **F-1 那条「取不到家目录不得造路径」的要求，现在有永久断言钉住了**，且断言命中的是**展开结果本身**（`got` vs `want`），不是「某条命令被不被拦」⇒ 命中别的分支也不会让它假绿。

**两种失败形态都覆盖了**（`os.homedir` 抛错 / 返回空）—— 这两种是**不同的失灵方式**（抛错是异常路径，返回空是「取到了但是空」），只测一种会漏另一种。

### 2.2 【PASS】F-2 真钉住了 —— 用我上一单自己的变异打出红

**我的独立复现**（`mut4b-v060.mjs` 的 VM4b：**只**放宽 `/dev/urandom` + `/dev/random`，**不加**裸 `null`，锚点是我上一单写的）：
```
anchor hits = 1
VM4b worker-suite exit=1 pass=44 fail=5
   W-FAIL FAIL D-85 空设备识别不放宽真实路径（null / src/null / /dev/nullx / /dev/urandom / /dev/random 都不是空设备） :: null=false srcnull=false urandom=true random=tru
   W-FAIL FAIL F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备 :: urandom=true random=true
   W-FAIL FAIL F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标 :: urandom=[] random=[]
   W-FAIL FAIL F-2 真实设备（/dev/urandom）在护栏层仍判越界
   W-FAIL FAIL F-2 真实设备（/dev/urandom）在护栏层仍记进待审清单 :: pending=2
VM4b verifier-probe exit=1 pass=50 fail=5
   V-FAIL FAIL B2 /dev/urandom is NOT a null device (deliberate) :: true
   V-FAIL FAIL B3 /dev/random is NOT a null device (deliberate) :: true
   V-FAIL FAIL B13 token form >/dev/urandom NOT recognized as null device :: true
   V-FAIL FAIL C9 > /dev/urandom (real device) is DENIED
   V-FAIL FAIL C10 > /dev/random (real device) is DENIED
```
**对照上一单同一变异的数字**：worker 套件 **fail=0（41/41 全绿）** → 现在 **fail=5**。

⇒ **F-2 那条要求钉住了**，而且是**多层**钉住：纯函数层（不被当空设备 / 仍被当写目标）+ 护栏层（仍判越界 / 仍记待审清单）。护栏层那两条尤其重要 —— 它验的是「真实设备被放过时，护栏**确实不拦**」这个后果，而不只是识别函数本身。

### 2.3 【PASS】「恰好转红」不是自证 —— 三条检出路径全部实测有效

矩阵的比对逻辑（`tests/fix-d80-d85-test.mjs`）：按**断言标签**取红集合 ⇒ `missing`（声明了该红却没红）/ `extra`（红了但没声明）/ `wronglyRed`（`expectGreen` 里的红了）三者任一非空即判该变异体 **NO**。

**我必须确认这个比对会失败，否则「全 YES」就是废话。** 我把套件**复制到临时目录**（仓库工作树零改动），在**副本**里注入三种故意的错误，各配一个**未改动的对照副本**：

```
=== CASE A-EXTRA-RED(undeclared red) exit=1
    rows=["YES","YES","YES","YES","YES","NO"]
    EXTRA_RED=1 MISS=0 WRONG_RED=0
    X:     EXTRA-RED F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备
    TAIL: >>> D80D85 MUTATION MATRIX FAILURES: 1
=== CASE B-MISS(declared but not red) exit=1
    rows=["YES","YES","YES","YES","YES","NO"]
    EXTRA_RED=0 MISS=1 WRONG_RED=0
    X:     MISS THIS-LABEL-NEVER-EXISTS-AT-ALL
    TAIL: >>> D80D85 MUTATION MATRIX FAILURES: 1
=== CASE C-WRONG-RED(expectGreen violated) exit=1
    EDITED_COPY_SYNTAX_OK=true
    rows=["YES","YES","YES","YES","YES","NO"]
    WRONG_RED=1 EXTRA_RED=0 MISS=0
    X:     WRONG-RED F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备
    TAIL: >>> D80D85 MUTATION MATRIX FAILURES: 1
=== CASE D-CONTROL(unmodified) exit=0
    rows=["YES","YES","YES","YES","YES","YES"]
    EXTRA_RED=0 MISS=0 WRONG_RED=0
    TAIL: >>> D80D85 MUTATION MATRIX OK
```

⇒ **三条检出路径全部有效，且未改动的对照副本仍全 YES**（证明前三条的失败是注入带来的，不是副本环境坏掉）。**这个比对不是自证。**

**这一条值得单独指出**：上一单 worker 的矩阵只验「该红的红了」，**证明不了「没有多红」**；而「多红」正是「变异体把不该坏的弄坏了」的那类失败（上一轮 M-D85 第一版就是这么被抓住的：行尾注释吞掉 `) {`，整个护栏起不来 ⇒「什么都不拦」⇒ 该绿的那几条反而先红）。这次升级把那个盲区补上了，**是实质性的进步，不是包装**。
### 2.4 【PASS，含独立判断】第 4 项：「产出路径磁盘上不存在」这条断言到底钉住没有

**worker 的自曝原文要点**：F-1 的「产出路径磁盘上不存在」在 `M-F1` / `M-F1b` 下**仍绿**（假目录本就不存在），它的牙齿只在 `M-F1c` 那一形态上。

**我的独立判断：不是恒绿，有牙齿，且在特定变异下**独立于**「不造路径」那条断言 ⇒ 可接受。**

**理由一（它会红）**：我构造了四种「兜底造家目录」形态，每种都让 `homeDir()` 在**取不到时无条件兜底**（这是关键 —— 兜底只在 `os.homedir()` 不可得时才走到，而 F-1 断言跑在**子进程**里，`os.homedir` 被改成抛错 / 返回空，所以兜底必然生效）：

```
### A-userInfo(REAL home) totalRed=4 f1red=4 | existsAssertionRed=2 noPathAssertionRed=2 | existsRedButNoPathGreen=false
    RED FAIL F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=C:/Users/yang2/sar-d80d85-f1-AsajvT/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-Te3D5O/p
    RED FAIL F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/sar-d80d85-f1-AsajvT/probe.txt exists=true
    RED FAIL F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=C:/Users/yang2/sar-d80d85-f1-AsajvT/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-Te3D5O/
    RED FAIL F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/sar-d80d85-f1-AsajvT/probe.txt exists=true
### B-USERPROFILE(REAL home) totalRed=4 f1red=4 | existsAssertionRed=2 noPathAssertionRed=2 | existsRedButNoPathGreen=false
    RED FAIL F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/sar-d80d85-f1-MI2TAZ/probe.txt exists=true
    RED FAIL F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/sar-d80d85-f1-MI2TAZ/probe.txt exists=true
### C-fake(nonexistent) totalRed=2 f1red=2 | existsAssertionRed=0 noPathAssertionRed=2 | existsRedButNoPathGreen=false
    RED FAIL F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=C:/fake/home/dir/sar-d80d85-f1-Rkfqp1/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-1AErds
    RED FAIL F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=C:/fake/home/dir/sar-d80d85-f1-Rkfqp1/probe.txt want=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-1AErd
### D-tmpdir(exists dir, no base) totalRed=2 f1red=2 | existsAssertionRed=0 noPathAssertionRed=2 | existsRedButNoPathGreen=false
    RED FAIL F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-f1-AH0O2c/probe.txt want=C:/Users/yang2/AppData/Local/Temp/
    RED FAIL F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-f1-AH0O2c/probe.txt want=C:/Users/yang2/AppData/Local/Temp
```

⇒ **形态 A / B 会让这条断言转红**（`exists=true`）。形态 B（兜底改用 `process.env.USERPROFILE`）是 **worker 没测过的形态**，但照样被抓住 ⇒ 这条断言不是只认 `os.userInfo()` 那一支。

**理由二（它有独立牙齿，不是被覆盖的冗余断言）—— 这才是严格标准**：
上面四种形态里，「存在」断言转红时「不造路径」断言**也**转红 ⇒ 只看这些，**分不清**这条断言是「有牙齿」还是「只是恰好跟着一起红」。于是我构造了一个**只有它能红**的场景：把子进程探针的输出改成 **`out` 保持正确的「不展开」路径、但 `exists` 报 `true`**（等价于「机制假装一个不存在的文件存在」）：

```
PATCHED_PROBE exit=1 totalRed=2
  f1red=2 existsAssertionRed=2 noPathAssertionRed=0
  => exists-assertion is LIVE (has independent teeth) = true
    RED FAIL F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-or1VZq/proj/~/sar-d80d85-f1-1nEWeA/probe.txt exists=true
    RED FAIL F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在 :: out=C:/Users/yang2/AppData/Local/Temp/sar-d80d85-or1VZq/proj/~/sar-d80d85-f1-1nEWeA/probe.txt exists=true
```

⇒ **「不造路径」两条全绿（`noPathAssertionRed=0`），而「磁盘上不存在」两条转红** ⇒ 这条断言**独立生效**，它守的是「不能假装文件存在」这一条**别的断言守不住**的要求。

**理由三（它守的是真问题）**：这条断言守的不是「路径长得对不对」，而是「**别让一个根本不存在的文件被当成存在**」。上一单台账 D-80 的原始症状正是「真实存在的文件被判成不存在」；反过来「不存在的文件被判成存在」同样是错判（会让 watchdog 的存在性校验**假绿**）。这两条断言守的是**两个方向**，不是同一条断言的两种写法。

**理由四（worker 的自曝措辞准确，我不推翻它）**：worker 说「在 `M-F1` / `M-F1b` 下仍绿（假目录本就不存在）」—— **属实**（我的形态 C 独立复现：`existsAssertionRed=0`）。worker 说「牙齿只在 `M-F1c` 那一形态上」—— **方向正确但不完全**：形态 B（`process.env.USERPROFILE` 兜底）同样能触发，而 worker 的矩阵里**没有**这一形态。**这不是缺陷**（断言本身有牙齿 ⇒ 不需要每个兜底形态各配一个变异体），但 worker 的措辞把「牙齿所在」说成了某一个具体变异体，容易让人误以为「只有那一种改法能抓住」。

**结论**：这条断言**不是恒绿**，**在特定变异下有牙齿**，且**牙齿独立于**主断言 ⇒ **可以接受，无需再改**。worker 的自曝**诚实**，我**不推翻**。
### 2.5 【PASS】没有引入新问题：回归 0 FAIL、既有四矩阵全 OK、6 个变异体各自恰好转红

**（1）补测套件本体**（`node tests/fix-d80-d85-test.mjs`）：
```
>>> FIX-D80-D85 ALL PASS   （49 条断言，0 FAIL；上一单是 41 条）
```
新增的 8 条全部在输出里可见（F-1 四条 + F-2 四条；另既有「不放宽真实路径」那条被**扩展**为含 `urandom`/`random`）：
```
PASS F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」 :: got=.../proj/~/sar-d80d85-f1-w8dWju/probe.txt want=.../proj/~/sar-d80d85-f1-w8dWju/probe.txt stderr=
PASS F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在 :: out=.../proj/~/sar-d80d85-f1-w8dWju/probe.txt exists=false
PASS F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」 :: got=.../proj/~/sar-d80d85-f1-w8dWju/probe.txt want=.../proj/~/sar-d80d85-f1-w8dWju/probe.txt stderr=
PASS F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在 :: out=.../proj/~/sar-d80d85-f1-w8dWju/probe.txt exists=false
PASS D-85 空设备识别不放宽真实路径（null / src/null / /dev/nullx / /dev/urandom / /dev/random 都不是空设备） :: null=false srcnull=false urandom=false random=false
PASS F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备 :: urandom=false random=false
PASS F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标 :: urandom=["/dev/urandom"] random=["/dev/random"]
PASS F-2 真实设备（/dev/urandom）在护栏层仍判越界 :: {... permissionDecision: deny ... 不在白名单内：/dev/urandom ...}
PASS F-2 真实设备（/dev/urandom）在护栏层仍记进待审清单 :: pending=3
```

**（2）新套件的 6 个变异体**（`SAR_MUTATION_D80D85=1`）：
```
| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言恰好转红 |
|---|---|---|---|---|
| M-D80 | D-80 | 回退「家目录展开下沉」 | 9 | YES |
| M-D85 | D-85 | 回退「空设备不是写目标」 | 12 | YES |
| M-F1 | D-80（F-1） | 回退「取不到家目录就不展开」：取不到时造一个假家目录出来 | 2 | YES |
| M-F1b | D-80（F-1） | 回退「取真实家目录」：homeDir() 恒返回假家目录（验收方原变异） | 10 | YES |
| M-F1c | D-80（F-1） | 回退「取不到家目录就不展开」：改用 os.userInfo().homedir 兜底 | 4 | YES |
| M-F2 | D-85（F-2） | 回退「真实设备不是空设备」：把 /dev/urandom 与 /dev/random 收进空设备集合 | 5 | YES |
>>> D80D85 MUTATION MATRIX OK
```

**（3）全量回归**（`node tools/run-tests.mjs --all --root plugin --repo .`，工作树）：
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
⇒ **13 套 / 836 条断言 / 0 FAIL**（上一单 828 条，新增 8 条断言 ⇒ 836，数字对得上）。

**（4）既有四矩阵**（在仓库副本上跑，仓库工作树零改动）：
```
==== MATRIX total sw=SAR_MUTATION suite=e2e-test.mjs exit=0 elapsed=219.7s pass=0 fail=0
  | | M-D37 | D-37 | 派工前的「目标成员存在性」判定被摘掉 | 9 | YES |
  | | M-D38 | D-38 | 会话注入里的陈旧名单披露被摘掉 | 1 | YES |
  | | M-D39 | D-39 | 账号级建号子命令从危险清单里摘掉 | 3 | YES |
  | | M-D40 | D-40 | 拦截消息的「只读条目」分型被摘掉 | 3 | YES |
  | | M-D41 | D-41 | 复合层判定退回「对整段代码文本做朴素正则」 | 3 | YES |
  | | M-D72a | D-72 | 否定式产出判定被摘掉 | 7 | YES |
  | | M-D72b | D-72 | 非断言语境判定被摘掉 | 4 | YES |
  | | M-D72c | D-72 | 子句级归属被摘掉（退回行级扫描） | 5 | YES |
  | | M-D72d | D-72 | 家目录展开被摘掉（~ 路径不再按真实家目录判存在性） | 1 | YES |
  | | M-D72e | D-72 | 通配符跳过被摘掉 | 2 | YES |
  >>> E2E MUTATION MATRIX OK
==== MATRIX d75 sw=SAR_MUTATION_D75 suite=scope-amend-test.mjs exit=0 elapsed=26.1s pass=0 fail=0
  | | M-D75a | D-75 | 回退「升级显式化」 | 12 | YES |
  | | M-D75b | D-75 | 回退变更账上的升级标注（回执不动） | 3 | YES |
  | | M-D75c | D-75 | 回退回执上的升级字段（变更账不动） | 8 | YES |
  | | M-D75d | D-75 | 回退路径写法归一 | 2 | YES |
  >>> D75 MUTATION MATRIX OK
==== MATRIX d73 sw=SAR_MUTATION_D73 suite=scope-amend-test.mjs exit=0 elapsed=20.0s pass=0 fail=0
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

D77 矩阵的**单独实跑原始输出**（本单第一次跑四矩阵时，后台任务的 300 秒上限先到了、D77 未跑完 —— 这是**通道限制**，不是产品问题；改为单独后台重跑 `SAR_MUTATION_D77=1 node tests/dispatch-release-test.mjs`，退出码 0）：
```
| M-D77a | D-77 | 回退整个写路径：无跨进程锁 + 裸 writeFileSync（无临时文件、无原子替换） | 5 | YES |
    RED FAIL D-77 两个并发写者各加一条记录 ⇒ 两条都在 :: 台账记录数=1 readers=2 | out1={...}
    RED FAIL D-77 并发写者两条记录各自带自己的 scope（没被覆盖成同一条） :: [["worker-b","src/b.ts"]]
    RED FAIL D-77 回读校验失败 ⇒ 派工被拒并报出规则编号 :: {...}
    RED FAIL D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致） :: beforeLen=684 afterLen=27
    RED FAIL D-77 回读校验失败后 ⇒ 台账仍是合法 JSON 且原有记录还在 :: null
| M-D77b | D-77 | 回退「回滚」：回读校验失败后不恢复到写前状态 | 2 | YES |
    RED FAIL D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致） :: beforeLen=684 afterLen=27
    RED FAIL D-77 回读校验失败后 ⇒ 台账仍是合法 JSON 且原有记录还在 :: null
| M-D77c | D-77 | 回退「回读校验」：写完不校验直接报成功 | 3 | YES |
    RED FAIL D-77 回读校验失败 ⇒ 派工被拒并报出规则编号 :: {...}
    RED FAIL D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致） :: beforeLen=684 afterLen=27
    RED FAIL D-77 回读校验失败后 ⇒ 台账仍是合法 JSON 且原有记录还在 :: null
>>> D77 MUTATION MATRIX OK
```
⇒ **既有 10 + 4 + 3 + 3 = 20 个变异体全 YES**，本次补测**未把既有机制带偏**。

**（5）`M-D72d` 互锁仍然成立** —— 这是上一单的重点关注项：补测后 `M-D72d` 改成**断整条链**（watchdog 侧 + lib 侧各摘一处），实测**仍转红 1 条 / YES** ⇒ D-80 下沉后没有让 D-72 的 N-03 断言失去互锁。

## 3. 产品代码零改动 与 改动面零越界

### 3.1 产品代码逐字节未动

```
plugin/scripts/lib.mjs   NOW=CD654F19F7FB0142E7749097F1E633E1F6C1BAE85480D50A07C03AF1ADA48E52
                       LAST=CD654F19F7FB0142E7749097F1E633E1F6C1BAE85480D50A07C03AF1ADA48E52  SAME=True
plugin/scripts/guard.mjs NOW=BF189F0B1408F56486C96A82101E3BB0B58B1186DFF17BCFC71C8817B6EC5D6A
                       LAST=BF189F0B1408F56486C96A82101E3BB0B58B1186DFF17BCFC71C8817B6EC5D6A  SAME=True
```
（LAST = 上一单我留在 `%TEMP%\sar-v060-vnFdo5` 的仓库副本，即补测前的工作树状态。）

⇒ **本单（补测）没有碰产品代码一行**，与 worker 声称一致。

### 3.2 改动面（`git diff --name-status HEAD` + 未跟踪）

```
M  docs/audit/defect-ledger.md              ← 父会话：台账状态与诚实边界收口（条件 ②）
M  docs/audit/reuse-registry.md             ← 父会话自己的改动（会话复用计数），与本单无关
M  plugin/.minimax-plugin/plugin.json       ← 父会话：包描述口径（条件 ②）
M  plugin/CHANGELOG.md                      ← 父会话：新增 v0.5.7 段 + v0.5.6 段末尾追加指向
M  plugin/README.md                         ← 父会话：诚实边界改写 + 空设备新节（条件 ②）
M  plugin/scripts/guard.mjs                 ← 上一单的 D-85 修复（产品代码，本单未动）
M  plugin/scripts/lib.mjs                   ← 上一单的 D-80/D-85 修复（产品代码，本单未动）
M  plugin/skills/super-agent-router/references/contract.md  ← 父会话：契约 S8.1 第 3 条（条件 ②）
M  tests/e2e-test.mjs                      ← 上一单：M-D72d 互锁
?? docs/audit/fix-d80-d85.md                ← worker 交付报告
?? docs/audit/verification-v060.md          ← 父会话：我上一单报告的逐字转写
?? tests/fix-d80-d85-test.mjs               ← 本单：补测套件（41 → 49 条，矩阵 2 → 6 个）
```

⇒ **零越界**：本单只新增/修改 `tests/fix-d80-d85-test.mjs` 与 `docs/audit/.tmp-v055/` 下的探针。`.superagent/`、`tools/`、`plugin/hooks/` **零 diff**。

### 3.3 我上一单报告的转写逐字一致

```
TMP_SHA=486c89f86e84d372dc1c93f908dddafe85d9d145c1613fb4fa075cd2445420f0
OFFICIAL_SHA=486c89f86e84d372dc1c93f908dddafe85d9d145c1613fb4fa075cd2445420f0
IDENTICAL=true
TMP_BYTES=41296 OFFICIAL_BYTES=41296
```
## 4. 父会话已做的改动 —— 口径复核（条件 ② 与 ③）

### 4.1 台账 D-80 状态行（`docs/audit/defect-ledger.md`）

```
- 状态：已复现 → **已修（v0.5.7）**：家目录展开**下沉**到 `lib.mjs` 的 `absolutizePath()` 内部 —— 展开发生在「拼工作区根」**之前**，调用方不必各自记得展开；`expandHomePath(p, home)` 的签名与语义未变；取不到家目录时退回「不展开」，不造路径。
  **诚实边界**：**用户可见症状本次没有翻转** —— watchdog 链路改前改后完全相同（独立验收实测）。这次修的是 **lib 层的潜在复发口**（下一个拿 `absolutizePath()` 判存在性的脚本会重蹈覆辙），**不是**「此前家目录写法会被误拦」。
- 还需要什么：无。已下沉到 `absolutizePath()` 内部（v0.5.7），并把该硬规矩写进契约 S8.1 第 3 条。
```

⇒ **与我的实测结论一致**，且「用户可见症状没有翻转」「不是此前会被误拦」这两句正是我上一单的核心结论（§4.2 改前改后 watchdog 完全相同）。**没有把话说反。**

### 4.2 台账 D-85 状态行 + 索引表行

```
- 状态：已复现 → **已修（v0.5.7）**：空设备（`/dev/null` / `/dev/zero` / `/dev/stdout` / `/dev/stderr` / `/dev/stdin` / `NUL` / `$null`）从**写目标提取**与**判定对象**两处剔掉 —— 不再记越界请求，也不再给出无意义的批准命令；真实路径越界照拦、真实写动词仍算写、重定向目标解析不出仍兜底拒绝。
  **诚实边界**：① 只堵「产生侧」—— 台账里**已有**的历史 `/dev/null` 待审项仍需人工在待审清单里拒绝；② `dd of=/dev/null` 这种 `of=` 参数形态仍判 DENY（保守方向）；③ `tee /dev/null` 由 DENY 变 ALLOW（用户可观测的行为变化）；④ `/dev/urandom` 与 `/dev/random` 是真实设备，**刻意不收**。

索引表行：D-85 | v0.5.6 收尾实测 | P3 | 机制层 | ... 记一条**批准了也没意义**的越界请求（...）
（原为「记一条**永远无法批准**的越界请求」—— 已按上一单台账 D-85 条目里的「⚠️ 更正」改成「批准了也没意义」。）
```

⇒ ①②③④ 四条**逐条对得上我的实测**：

| 台账诚实边界 | 我的实测依据 |
|---|---|
| ① 只堵产生侧，历史待审项仍需人工拒绝 | 上一单 §4.3：改后 pending 里 `["/dev/null"]` 那条不再**产生**（历史条目不在本单范围） |
| ② `dd of=/dev/null` 仍 DENY | 上一单 §2.6 边缘用例：`CMD[dd of=/dev/null] => DENY`（两侧都 DENY） |
| ③ `tee /dev/null` 由 DENY 变 ALLOW | 上一单 §2.6 边缘用例：PRE `DENY` / POST `ALLOW` |
| ④ `urandom`/`random` 刻意不收 | 上一单 §2.4 B2/B3/B4：`/dev/urandom`、`/dev/random`、裸 `null` 均返回 false |

### 4.3 契约 S8.1 第 3 条（`plugin/skills/super-agent-router/references/contract.md`）

```
3. **「判存在性前必须展开家目录」** —— 不展开就会把真实存在的文件判成「不存在」，
   同样是误拦。**展开已下沉到 `lib.mjs` 的 `absolutizePath()` 内部**（v0.5.7，D-80 收口）：
   展开发生在「解析成绝对路径」这一步、**早于**「拼工作区根」，调用方不必各自记得展开。
   `expandHomePath(p, home)` 的签名与语义未变；取不到家目录时退回「不展开」，不造路径。
```

⇒ **三处口径与我的实测逐句对得上**：「早于拼工作区根」（代码 `lib.mjs:611-613`）、「签名与语义未变」（上一单 diff 匹配 0 行）、「取不到家目录时退回不展开，不造路径」（本单 F-1 两条断言现行代码下全 PASS）。**上一单列的四处陈旧口径，这一处已改。**

### 4.4 README 的两处用户可观测变化

```
| 命令 | 之前 | 现在 |
|---|---|---|
| `tee /dev/null` | **DENY** | **ALLOW** |
| `dd of=/dev/null` | DENY | **仍然 DENY** |
```

⇒ 与我上一单 §7 第 5、6 条**逐字对得上**。README 明确写「**别把这两条读成『空设备一律放行』**」—— 这正是我上一单提的那条口径要求（「若列举『空设备一律放行』，`dd of=/dev/null` 是反例」）。

### 4.5 文档口径残留复查（上一单列的四处 + CHANGELOG 历史段）

```
plugin/README.md:475-477        → 已改写为「家目录展开已下沉到 lib 层（v0.5.7 的 D-80）」  ✅
plugin/.minimax-plugin/plugin.json:6 → 已改为新事实                                        ✅
plugin/skills/.../contract.md:397 → 已改（§4.3）                                            ✅
plugin/CHANGELOG.md:300-301     → v0.5.6 历史段原文保留（父会话在该段末尾追加指向 v0.5.7）✅
plugin/CHANGELOG.md:433          → 更早的 v0.5.6 历史段，同上                                  ✅
```

⇒ **上一单列的四处陈旧口径已全部收口**。CHANGELOG 里剩下的两处是**历史版本段**（记录的是 v0.5.6 当时的状态，父会话明确「原文一个字未删改，只在该段末尾追加一句指向 v0.5.7」）—— **这是正确的做法**（历史记录改写等于伪造历史），**不构成残留**。

### 4.6 台账自洽性

```
摘要：{"statsLine":7,"indexRows":89,"detailCount":89,"statusUnion":89,"indexIds":89}
PASS 台账检查 index-columns
PASS 台账检查 sets-equal
PASS 台账检查 severity-distribution
PASS 台账检查 detail-meta-line
PASS 台账检查 detail-count
PASS 台账检查 no-duplicate-d
>>> 台账自洽
```

⇒ **89 = 89 = 89**，六项全 PASS（状态行改动没有破坏台账自洽）。
## 5. 仍然开着的边界（如实列出）

1. **D-80 的用户可见症状至今没有翻转** —— 补测不改变这一点。watchdog 链路改前改后完全相同（上一单 §4.2 改前改后端到端对照，本单未重跑该对照，但产品代码 SHA256 未变 ⇒ 结论不变）。**发布说明若写成「此前家目录写法会被误拦」仍是夸大。**
2. **D-85 只堵「产生侧」** —— 台账里**已有**的历史 `/dev/null` 待审项仍需人工在待审清单里拒绝（`--grant` 仍会把它写进 scope，批准它没有意义）。**本单未验「人工拒绝这条历史项」的端到端流程**（不属本单范围）。
3. **贴写形态的真实文件目标仍未归一** —— `echo hi >out.txt` 的 token 仍是 `>out.txt`，与白名单条目对不上 ⇒ 仍判越界。既有行为，非本单引入。
4. **fd 复制（`2>&1`）仍会被当成写目标** —— `rm foo 2>&1` 的 `2>&1` 仍进写目标集合。另一族问题，本单未处理。
5. **`dd of=/dev/null` 改后仍 DENY** —— `of=` 参数形态不被识别为空设备（保守方向）。
6. **`tee /dev/null` 由 DENY 变 ALLOW** —— 符合 D-85 口径，但属用户可观测变化。
7. **本单验的是「机制对不对」，不是「链路通不通」** —— 全部用合成 PreToolUse 载荷驱动真实 `guard.mjs`（契约 S3；RT-04）。真实运行时某工具会不会被派发/拦住是另一问，本单无真实会话触发记录，**不作平台级结论**。
8. **只覆盖 win32 / Node v26.7.0 / PowerShell 5.1** —— Linux / macOS 全部未验证。F-1 的子进程探针依赖 `os.homedir()` 可被改写，这在 Node 各平台上应同样可行，但**未实测**。
9. **F-1 的子进程探针只覆盖「`os.homedir` 抛错」与「`os.homedir` 返回空」两种失灵方式** —— 若将来实现改成「`os.homedir` 返回一个**带尾随空格**的路径」或「返回**相对路径**」，探针不会覆盖。这属于**已知覆盖边界**，不是当前缺陷（现行实现返回 `String(os.homedir() || '')`，无这两种形态）。
10. **矩阵的 6 个变异体没有覆盖「家目录取得到但取错」的所有形态** —— 例如 `homeDir()` 返回**另一个用户的家目录**。断言「不造路径」会红（输出不等于期望），但这一形态在矩阵里没有专门位。**断言本身能抓，矩阵没列** —— 这是矩阵覆盖度的问题，不是断言覆盖度的问题。
11. **「恰好转红」的 `expect` 列表是人工维护的** —— 若将来新增断言而忘了把它加进某个变异体的 `expect` 列表，矩阵会报 `EXTRA-RED`（**多红**）⇒ 这个方向是**安全**的（会失败而不是假绿）。反之若某个变异体忘了加 `expect` 条目，同样会报 `EXTRA-RED`。**但若同时忘了加断言、也忘了加 expect，两边都变绿 ⇒ 仍可能漏** —— 本单用三组注入证明了「矩阵会失败」这一侧可靠，**没有**证明「新增断言一定会被纳入某个变异体」（那需要人工维护纪律）。
12. **本单未部署、未发布、未推 GitHub、未改台账编号与状态**；唯一写入 = `docs/audit/.tmp-v055/`。

## 6. PRIOR_LESSONS

**无内容**（该成员暂无错题本，本次为空 —— 按契约要求显式写明，不静默省略）。

## 7. 结论

**VERDICT: PASS**

**一句话：上一单的条件 ① 已真正落实 —— 两条永久断言都钉住了，「恰好转红」不是自证，第 4 项那条断言经我独立构造后确认「不是恒绿、有独立牙齿」，可接受。**

**逐项对照验收清单**：

| 验收项 | 结论 | 关键证据 |
|---|---|---|
| 用**你自己的** F-1 变异（恒造假家目录）打出红 | ✅ | 我的 VM3 锚点：worker 套件 0 FAIL → **2 FAIL**（上一单同变异 41/41 全绿） |
| 用**你自己的** F-2 变异（只放宽 urandom/random）打出红 | ✅ | 我的 VM4b 锚点：worker 套件 0 FAIL → **5 FAIL**（上一单同变异 41/41 全绿） |
| 「恰好转红」的漏报/多报都能被检出（不是自证） | ✅ | 三组注入：`EXTRA-RED` ✅ / `MISS` ✅ / `WRONG-RED` ✅，未改动对照副本仍全 YES |
| 第 4 项给出独立判断与理由 | ✅ | 「不是恒绿、有独立牙齿」—— 形态 A/B 转红；**且**在「不造路径」全绿时它仍能单独转红（`noPathAssertionRed=0` 而 `existsAssertionRed=2`） |
| 全量回归 0 FAIL；既有四矩阵仍全 OK；6 个变异体各自恰好转红 | ✅ | 13 套 / 836 条 / 0 FAIL；既有 20 个变异体全 YES；新 6 个全 YES |
| 产品代码零改动、改动面零越界 | ✅ | `lib.mjs` / `guard.mjs` SHA256 与上一单副本**逐字节相同**；改动面仅 `tests/` 与 `docs/audit/.tmp-v055/` |
| 父会话改的台账/契约口径与我的实测一致（尤其 D-80 的「症状没翻转」） | ✅ | §4.1~§4.6；四条 D-85 诚实边界逐条对上我的边缘用例 |
| 报告写在 `docs/audit/.tmp-v055/verification-v061.md`，含 VERDICT | ✅ | 本文件 |
| 阴性结论带金丝雀 + 时间戳 + 会话标识 | ✅ | §2.3 每组注入都配**未改动对照副本**；会话 `mvs_26fc11cb8e99483697531140266df940`；时间戳 2026-11-11 05:15→05:45 GMT+0800 |

**我不同意的地方（如实写出）**：

1. **worker §5.5 自曝的措辞略窄，但结论正确**：它说「『产出路径磁盘上不存在』的牙齿只在 `M-F1c` 那一形态上」。实测上牙齿**不止** `M-F1c` 那一形态 —— 我构造的形态 B（兜底改用 `process.env.USERPROFILE`）同样让它转红，而 worker 矩阵里没有这一形态。**这不是缺陷**（断言本身有牙齿，不需要每个兜底形态各配一个变异体），但措辞容易让人误读成「只有那一种改法能抓住」。**我保留该条断言，判定可接受。**
2. **矩阵的 `expect` 列表是人工维护的**（§5 第 11 条）：「多红必失败」这侧可靠，但「新增断言一定会被纳入某个变异体」这侧靠人工纪律。**不构成阻塞**（现状 6 个变异体自洽），但下一轮加断言时值得复核。

**给父会话的两条提醒（非阻塞）**：
1. **发布说明务必按台账 D-80 的措辞写**：「用户可见症状没有翻转」「修的是 lib 层复发口」，**不要**写「此前家目录写法会被误拦」—— 我上一单实测 watchdog 链路改前改后完全相同，这句话会是错的。
2. **README 的「`tee /dev/null` ALLOW / `dd of=/dev/null` 仍 DENY」对照表已到位**（§4.4），发布说明里保留这两条即可，不必重复展开。

**本单未改 `plugin/` `tests/` `tools/` `docs/audit/*.md` 一行**（除父会话自己已做的文档收口外，本单只写了 `docs/audit/.tmp-v055/`），未 commit / push / deploy / 建号，未改台账编号与状态。唯一写入 = `docs/audit/.tmp-v055/`（本报告 + 6 个探针脚本）。
