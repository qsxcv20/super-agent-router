# D-91 收尾轮 · 语义变异体矩阵定义

> **为什么这个文件存在**：变异体矩阵是「断言到底会不会红」的证明。
> 如果「改哪一行、改成什么」只存在于某个人的临时脚本里，那么矩阵结论就
> **既不可采信（谁都能声称自己跑了另一种变异）也不可反驳（没人能复现）**。
> 本文件把每个变异体的**锚点原文、改成什么、期望红哪条断言**逐字固定下来，
> 任何人拿它跑都能得到同一个结论。
>
> **配套执行器**：`tests/fixtures/d91-mutation-matrix.mjs`
> （串行执行；变异矩阵**不应并发跑** —— 并发会引入调度抢占，
>  与 D-93 的性能断言噪声同源，会让「恰好红一条」的判定失真。）

## 判定口径（三列必须分开报，不许合成一个数字）

矩阵每个变异体跑完要报三个**互不相同**的量，口径混淆就会得出错结论
（2026-11-12 复审实测：我自报的 EXTRA-RED 条数与验收方实测差 1，
 根因就是列名没区分「专属锚点红 / EXTRA-RED / 总红数」）：

| 列名 | 含义 | 判定 |
|---|---|---|
| **专属锚点红** | 本变异体**指定**的那条断言是否转红 | 必须为「是」，否则判 **MISS**（该变异体没被任何断言抓住 ⇒ 断言是死的） |
| **EXTRA-RED** | 除专属锚点外，**额外**转红的断言条数 | 应为 0；>0 说明别处的断言被这条语义牵连 |
| **总红数** | 套件 FAIL 断言总条数 | 记录用；与「专属锚点红」**不是一回事**（专属红 1 条时总红数可能是 1~N） |

判定：
- 专属锚点红 = 是 且 总红数 = 1 ⇒ **恰好红一条**（最强形态）。
- 专属锚点红 = 是 且 总红数 > 1 ⇒ **EXTRA-RED(N)**（专属命中，但有牵连）。
- 专属锚点红 = 否 ⇒ **MISS**（致命：该变异体没被断言抓住）。

## 执行前置条件

1. 变异必须跑在**字节级副本**上（`fs.copyFileSync`），
   **禁止** PowerShell 重定向 / 文本方式写回 —— 会改行尾，引入非语义差异。
2. 每个副本先独立跑 `node --check`：exit≠0 说明是模块加载错误，
   **不算**「断言红了」，只能记「变异体无效」。
3. 基线（未变异）必须全绿，否则矩阵结论无意义。
4. 矩阵**串行**执行，不并发。

## 变异体清单

### M1 · 择一层失效
- 描述：`pickNamespace()` 恒返回 `outer`（择一失效）。
- 锚点（原文，独一命中）：
  ```
    if (innerHas && !outerHas) return 'inner';
    if (outerHas && !innerHas) return 'outer';
    if (innerHas && outerHas) return 'inner';
  ```
- 改成：
  ```
    if (innerHas && !outerHas) return 'outer';
    if (outerHas && !innerHas) return 'outer';
    if (innerHas && outerHas) return 'outer';
  ```
- 期望红：**D-91 收尾 PTC·择一层**

### M2 · 不可比分支不生效
- 描述：不可比记录照常计入（不可比边界失效）。
- 锚点：`if (ns === 'inner' && !innerComparable(c, pay)) {`
- 改成：`if (false) {`
- 期望红：**D-91 收尾 不可比①**

### M4 · 哨兵改用正常指纹
- 描述：不可比记录的占位指纹改成真实指纹 ⇒ 被当成正常记录计入。
- 锚点：`  return '\u0000incomparable:' + name;`
- 改成：`  return fingerprint(name, (rec && rec.args) || {});`
- 期望红：**D-91 收尾 不可比③b**

### M6 · 取内层读错层级
- 描述：`innerCallsOf()` 读 `m.ptc`（取错层级）。
- 锚点：
  ```
    const det = m.details;
    if (!det || typeof det !== 'object') return out;
    const ptc = det.ptc;
  ```
- 改成：
  ```
    const det = m;
    if (!det || typeof det !== 'object') return out;
    const ptc = det.ptc;
  ```
- 期望红：**D-91 收尾 PTC·取内层层**

### M7 · 可比性判定恒 false
- 描述：`innerComparable()` 恒返回 false（可比性判定失效）。
- 锚点：
  ```
    for (const k of keySet) {
      if (!(k in recArgs)) return false;
      if (!(k in payArgs)) return false;
    }
    return true;
  ```
- 改成：`  return false;`
- 期望红：**D-91 收尾 PTC·可比性层**

### M8 · 不可比记录直接丢弃
- 描述：不可比记录被丢弃而不占位 ⇒ 不能打断连续段。
- 锚点：
  ```
        calls.push({ fp: incomparableFp(c) });
        continue;
  ```
- 改成：`      continue;`
- 期望红：**D-91 收尾 不可比③a**

## 口径说明（为什么 M4 与 M8 是两条不同的断言）

- **不可比③a** 用**序列长度守恒**判定（序列长度 == 内层记录数）：
  钉住「不可比记录占位」这件事本身。
  判据只用长度，**不**用哨兵计数或「哪些记录不可比」——
  后两者随被测实现走 ⇒ 别的层坏掉时也会误红，定位就废了。
- **不可比③b** 判定**哨兵表示**（哨兵前缀 + 与真实指纹不同）：
  钉住 M4 这种「哨兵被换成正常指纹」的语义。

所以 M4 与 M8 各自只打红自己那条；两者**故意不合并**成一条断言 ——
合并会让「占位」与「表示」两个语义互相掩盖。

## 复跑命令

```
node tests/fixtures/d91-mutation-matrix.mjs .
```

输出逐行含：变异体 id、`node --check` exit、套件 pass/fail/exit、
专属锚点红（是/否）、EXTRA-RED 条数、总红数、判定。
