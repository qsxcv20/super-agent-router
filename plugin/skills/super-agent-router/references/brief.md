# 派工 Brief 模板

## 模板

```markdown
SCOPE: src/app.ts, src/util.ts

GOAL: 一句话说清要达成什么

ACCEPT:
- [ ] 具体可验证的条件 1
- [ ] 具体可验证的条件 2

FORBID:
- 不修改 scope 之外的文件
- 不做 X（不属于本单的事）

EVIDENCE:
- 改了哪些文件（完整路径）
- 跑了什么命令、结果是什么
- 如何复现验证

PRIOR_LESSONS:
- <该成员历史教训里的规则，插件会自动注入，你也要带进 brief>
```

## 字段规则

### SCOPE（必填）

- **具体路径清单**，逐条列出
- 目录必须以 `/` 结尾：`src/app/` 表示整个目录
- 插件的 `PreToolUse` Hook 会拿它做越界拦截
- 否定式禁令（"不要动生产配置"）**不算** scope，无法被拦截

### ACCEPT（必填）

可勾选、可验证。禁止"代码质量良好""功能正常"这类不可判定条件。

### EVIDENCE（必填）

`SubagentStop` Hook 会检查：声称完成却没给证据时，拦一次要求补上。

### PRIOR_LESSONS（有就带，没有就留空）

**这是自我进化真正生效的位置。**

派工前，插件的 `PreToolUse(task)` Hook 会自动读取目标成员的错题本
（`.superagent/lessons/<成员名>.md`），把其中的「规则」段注入上下文。

Router 读到这个注入后，必须把相关规则**写进 brief 的 PRIOR_LESSONS 段**。

这样 Worker 从开工第一秒就知道"上次同类任务栽在哪儿"，
而不是等失败了再复盘。

留空的情况只有两种：该成员还没有错题本，或本次任务与历史教训无关。

### PRIOR_RECORDS（有就带，没有就留空）

派工前，插件的 `PreToolUse(task)` Hook 会自动读取目标成员的实战记录
（方法论文件的「实战记录」段），注入该成员此前验收通过的成果与做法。

Router 读到后，可以把相关做法写进 brief 作为方法参考 —— 但**不要写进
`FORBID`**。履历是参考，不是命令。

留空的情况：该成员还没有实战记录，或本次任务与其历史成果无关。

## 示例

```markdown
SCOPE: src/auth/login.ts, src/auth/session.ts

GOAL: 修复登录请求在 30s 超时后未正确清理连接的问题

ACCEPT:
- [ ] 超时路径下连接被显式释放
- [ ] 补充一个覆盖超时分支的测试
- [ ] 现有测试全部通过

FORBID:
- 不改动 src/auth/ 之外的文件
- 不调整超时阈值本身

EVIDENCE:
- 改动文件路径
- 测试命令与输出
- 超时复现步骤

PRIOR_LESSONS:
- 改连接清理逻辑前必须先确认异常路径下的 finally 块存在
```
## 派工前的边界自检三连（v0.5.0）

派工前必查这三件事，否则成员会反复撞墙：

1. **读得到吗** —— 把成员要读的每个路径列出来，逐个确认它落在某个 scope 条目的
   所在目录树内。漏一个 = 成员必然撞越界拦截。
2. **说得准吗** —— brief 里每句关于边界的描述（「整个目录可读」「只有 X 能写」），
   必须与 `references/contract.md` 的通道语义一致。**半真话比不说更危险**：
   曾有一位成员撞墙 40 分钟，根因就是 brief 写「整个目录可读」，
   而 bash 通道实际按「写」判定。
3. **同源吗** —— 条目模板、编号规则、状态口径一律直接引用
   `references/contract.md`，**不要在 brief 里复述**。复述即漂移：
   曾给两个 worker 的模板是 6 字段、给 verifier 的是 7 字段，
   验收反过来判产出「字段模板不一致」。

## 只读条目

想让成员读一个目录、但不给它写权限，用 `ro:` 前缀：

```
SCOPE: ro: plugin/scripts/, docs/audit/report.md
```

`ro:` 条目按所在目录树放行读、永不授予写、不参与派工的写冲突检测。
完整语义见 `references/contract.md` 的 S2。

## brief 是 worker 唯一的协议载体

子会话**不触发** `SessionStart` 与 `UserPromptSubmit`（见 `references/scope.md`），
所以「SessionStart 自动注入编排协议」只对 Router 生效。worker 看到的只有你写的 brief。
brief 缺一条，worker 就少一条依据——目标、边界、验收标准、交付要求，一个都不能省。

## 产出契约

缺陷清单、验收结论、复盘记录这类产出，一律使用 `references/contract.md` S1 的
7 字段模板与编号命名空间。brief 里只需写「条目模板见 contract.md S1」，
**不要把字段抄一遍**。
