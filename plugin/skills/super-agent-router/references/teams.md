# 成员目录

## 内置成员（本机，始终可用）

| 成员 | 归属(owns) | 拒绝(reject) |
|---|---|---|
| `explore` | 只读定位：找代码、找文件、摸清现状 | 不改文件，不给超出定位范围的结论 |
| `worker` | 边界清晰的一次性生产：明确 spec 的单点实现 | 跨文件重构、多步调研、需要判断的取舍 |
| `verifier` | 对抗性验证：独立复核产出、挑错 | 不动手改，不接受「看起来没问题」 |

## 专项成员（运行时配置）

**专项成员不在这里预先列出。** 它们在任务需要时被现场配置出来，
配置完登记进 `.superagent/roster.json`，此后复用。

要看当前有哪些专项成员，读 `.superagent/roster.json`；
要知道成员是否真的存在，跑 `mavis_agent_list`。

### 专项粒度 = 一件事

判据：一句话说清负责哪件事，且能写出验收标准。写不出验收标准就还不是专项。

命名：`sa-<专项领域>-<专项动作>`，kebab-case 英文。
禁用泛词：analyst / assistant / expert / helper —— 那是角色不是专项。

### 反例对照

```
✗ sa-data-analyst        一个筐：要同时会清洗/统计/出图/口径核对
✓ sa-spreadsheet-extract 从表格抠数据并回显口径
✓ sa-chart-plot          出图，出图前必须回显实际生效的筛选条件
✓ sa-stats-verify        统计数字的独立复核
```

### 登记格式

每个专项成员在 `.superagent/roster.json` 的 `members` 里有一条：

```json
{
  "name": "sa-<专项名>",
  "kind": "specialist",
  "owns": "<负责哪一件事>",
  "accepts": "<什么情况下派给它>",
  "reject": "<什么情况下不该派给它>",
  "method": ".superagent/methods/<专项名>.md",
  "source": "runtime",
  "created_for": "<触发它的那次任务>",
  "created_at": "<ISO 时间>"
}
```

**未登记 = 不可见。** 路由只看 roster 和 agent list，不看成员的自我描述。

## 成员的「精」在哪

不在 system_prompt 长度，在三件套：

1. **方法论** `.superagent/methods/<name>.md` —— 怎么做
2. **验收清单** 同文件的「验收清单」段 —— 怎么算做好了
3. **错题本** `.superagent/lessons/<name>.md` —— 这类活历史栽在哪
4. **实战记录** 方法论文件的「实战记录」段 —— 这类活做成过什么

四者都可版本控制、可 review、可分享。

其中 1+4 同文件：方法论与履历同生共死，方法论删了履历一起没。
2 是准入（还没做成过事就没有履历），3 是警戒（做过但栽过）。