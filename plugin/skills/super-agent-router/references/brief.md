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