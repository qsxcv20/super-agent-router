# super-agent-router 当前状态

更新：2026-11-09 21:05　版本：v0.4.0

## 状态：v0.4.0 已发布，并通过独立验收

插件已被 MCode 识别并启用（`v2/plugin-hook-cache/` 有完整包副本）。
**必须新开一个会话** —— Hook 按会话激活，旧会话不会重新注入协议。

v0.4.0 修的是一条更底层的错配：**派工发生在父会话，工具执行发生在子会话**，
而 v0.3.x 用同一个 session_id 索引两层，于是两头都错。

## v0.4.0 修了什么（真实跑一遍编排闭环查出来的）

本轮不是读文档推的，是**真跑**出来的：现场配置专项成员 → 派工 → 独立验收 → 记履历。

| 漏洞 | 探测方式 | 后果 | 修法 |
|---|---|---|---|
| guard 按 session_id 找 scope，台账记的却是「发起方」会话 | worker 在子会话改 scope 外文件 | 越界管控对真正要约束的 worker 完全失效 | 改按子会话绑定，scope 从子会话自己的 transcript 派工原文解析 |
| Router 父会话被 worker 的 scope 套住 | 派完第一个工，Router 写自己的收尾文件 | Router 被自己派出的 worker 锁死 | 载荷无 `agent_type` 即放行 —— 只约束被派工的子代理 |
| 组队 scope 重叠无人检测 | 同一会话连派两个重叠 scope | 两个 worker 互相覆盖，验收无法判断谁的改动生效 | dispatch 闸门：写冲突即拒，报出冲突路径 |
| 单会话派工数无上限 | 同一会话连派 7 个 | 编排失控，用派工代替思考 | dispatch 闸门：并发在飞 6 / 累计 30 |
| worker 结束后名额不回收 | 派工后不看台账 state | 在飞数只增不减，会话把自己锁死 | watchdog 在 SubagentStop 回收名额 |
| worker 读不到自己的方法论 | worker 读 .superagent/methods/ 被拦 | 「把一件事做到精」的载体被切断 | guard 读模式放行该成员的方法论与错题本 |
| watchdog 把版本号当文件路径 | 交付报告里写 0.4.0 | worker 被逼反复改写交付说明 | 路径校验收窄到带产出动词的句子 |
| 发布只同步脚本、漏同步清单 | 安装目录 version 仍是 0.3.2 | 机制生效了但「版本身份」没发布出去 | 部署改全量同步（tools/deploy-plugin.mjs） |

新增 chain-test 第 6～15 组锁住这些行为，八套回归全绿。

## 真实跑通的那一遍（2026-11-09）

- 现场配置专项成员 `sa-plugin-release`：先写方法论 → 再建成员 → 再登记
- 派工 → worker 产出 plugin.json 升版 + CHANGELOG + 面向使用者的 README
- 独立 verifier 验收：首轮 7 项中 6 项通过、1 项不通过，另查出 4 个问题
  （含一个高severity：发布根本没落地，安装目录还是 0.3.2）
- 修完收窄 brief 重派 → 复验 **7 项全通过（VERDICT: PASS）**
- record-gate 把履历写进该成员的方法论文件

台账实证：派工记录带 scope → 子会话绑定记录 scope → worker 结束后 state 转 done。

## 仍需注意

- **Hook 按会话激活**：装完或升级后必须新开会话才生效。
- **guard 是护栏不是沙箱**：脚本一旦落盘就能绕过工具级判定。
  真正的边界是运行时权限 + 人工确认，别把 hook 当安全边界。
- **平台原生 Agent Team 与本插件互补**：原生管「要不要拆、拆几个」，
  本插件管「派给谁 + scope 边界 + 验收闭环 + 错题本与履历沉淀」。

## 历史

v0.3.x 修的 Hook 不触发根因、派工闸门、履历机制等，见 git log 与 plugin/CHANGELOG.md。
