# sa-mechanism-fix

## 归属

把编排机制的**边界判定**改成「静默失效」不可能：scope 语义、工具通道语义、
transcript 里的 brief 解析、派工台账的生命周期。产出的改动让「越界必被拦、
边界算不出必被拒、派工不结束必被回收」成为代码保证，而不是靠约定。

## 适用

- 缺陷台账里已定位、且属于 guard / lib / dispatch / watchdog / session-start 的判定缺陷
- 「解析不出来就放行」「取不到目标就放行」这类默认放行分支
- 派工台账的名额回收、去重键、状态失步

## 不适用

- **record-gate / lessons-gate / records / roster** 的判定与统计口径 —— 归 `sa-gate-integrity`
- 不改协议文档与参考手册（`references/`）—— 契约由父会话维护
- 不做版本发布（归 `sa-plugin-release`）、不推送远端
- 不改 `plugin/scripts/` 之外的任何文件

## 方法

1. **先读契约**：`plugin/skills/super-agent-router/references/contract.md` 的 S2~S6 是唯一依据。
   不要凭印象实现——契约已经把每条判定规则写死了。
2. **再读缺陷台账**：`docs/audit/defect-ledger.md` 的 `D-` 条目给出触发条件与修法方向。
   brief 里指明要修哪几条，不要把缺陷正文复述进 brief。
3. **一条一条改，改一条验一条**。每条改完立刻跑对应的回归（见验收清单），
   不要攒到最后一起跑——边界语义改动极易互相干扰。
4. **改判定分支时的铁律**：凡是「解析不出 / 取不到 / 读不到」的位置，
   一律改成 **deny**，绝不保留放行分支。放行分支就是未来的静默失效。
5. **不要为了让测试通过而放宽判定**。回归失败时先问：是我改错了，还是原判定真的更安全？
6. **注释写「为什么」不写「是什么」**：尤其要写清「这条分支以前为什么会放行」，
   免得后人看到「多余的保护」就删掉。

## 验收清单

- [ ] 契约 S2~S6 每一条都有对应实现，且行为可被回归断言覆盖
- [ ] 「解析不出 / 取不到 / 读不到」的位置**没有残留任何放行分支**
- [ ] `ro:` 只读条目被支持：只授予读，不授予写，且不参与派工写冲突检测
- [ ] bash 通道：只读命令按读判定、写命令按写判定；`console.log` 这类带点标识符不再被当成路径
- [ ] glob / grep 的判定对象是有效检索根，不是 pattern 本身
- [ ] transcript brief 解析兼容 `compatible` 与 `codex` 两种变体，且按语义定位而非固定行号
- [ ] 派工去重键在 `turn_id` 缺失时不会抹掉其它记录
- [ ] 名额回收三条路齐全：正常结束 / 超时兜底 / 读时自愈
- [ ] 边界相关回归全绿（`chain-test` `guard-test` `scope-test` `e2e-test` `hooks-test`）
- [ ] 只改动 SCOPE 内的文件

## 易错

- 把「解析失败」改成 deny 时忘了同步改测试预期，把安全改动当成回归
- 改完只跑自己那两套测试，忘了跑另外三套——边界语义是跨脚本耦合的
- 在 `guard.mjs` 里加了新判定，却没在 `dispatch.mjs` 的写冲突检测里同步，读写口径就不一致了
- 只改仓库副本没改安装副本，测试跑的是安装副本，改动看起来「没生效」
- 把契约当成建议而不是硬规则，凭自己的理解补条款——那正是契约要消除的漂移

## 实战记录

<验收通过的成果由 record-gate.mjs 写入；首次为空>

### 2026-11-10 · 边界判定与护栏机制改造（scope 语义 / 通道语义 / brief 解析 / 台账回收） · 把静默放行的边界判定关掉并随 v0.5.0 发布
- 做法：先按契约 S2~S6 把判定分支列成可复现清单，再逐条改成「解析不出或取不到即拒绝」；引入 ro: 只读条目与 mode=exact 区分读写；复合工具层只做危险操作判定、作用域交回内层（外层粒度不得粗于内层）
- 证据：plugin/scripts/{lib,guard,dispatch,watchdog,gate,session-start}.mjs 六脚本 + plugin/hooks/hooks.json；docs/audit/verification-v050.md（首轮独立验收）与 verification-v050-recheck.md（复验 PASS_WITH_RESIDUAL，17 组合成载荷 + 5 组变异检验）
- 验收：verifier

### 2026-11-10 · 危险操作在 bash 通道的形态识别（D-25 账号级不可逆操作绕过族） · 堵住 bash 通道绕过账号级不可逆操作的洞，并把同一族残余全部闭环
- 做法：按命令位置上的「CLI+子命令+动作」判定而非字样匹配；切命令段并识别命令替换/进程替换/base64 载荷；包装器开关按包装器分别定义（带值/布尔/位置参数）；最终把命令位置从「闭集包装器名单」改为「数据段/执行段」二分，使 exec 及任何新包装器自动覆盖
- 证据：plugin/scripts/lib.mjs 命令形态判定 + tests/guard-test.mjs 的 D-25 断言（两轮共 76 条）；两轮独立复验均 PASS_WITH_RESIDUAL，残余 D-25b/D-25c/D-25d/D-25e 全部闭环；父会话活体复核 43 条必拦全 DENY / 21 条负例全 ALLOW / 0 异常；五套回归 0 FAIL
- 验收：verifier

### 2026-11-10 · 编排机制边界判定改造：派工台账生命周期与名额回收 · 修派工台账并发写（D-77）与账号名单不可得时的降级口径（D-73）
- 做法：把台账写路径统一收口到一个锁内入口（锁内重读 + 原子替换 + 回读校验 + 失败回滚），五个写方全部改走；用「起跑号牌」把并发概率变成必然，确定性复现改前「两个写者都报成功但只剩一条记录」的静默形态；D-73 不推翻 D-37 的「名单不可得不拒派」取舍，改成存在性三态 + 降级派工不占名额不参与冲突判定
- 证据：plugin/scripts/lib.mjs 的 withLedgerLock/updateLedger；docs/audit/fix-d77.md 与 docs/audit/fix-d73.md；tests/dispatch-release-test.mjs 的 D-77 段 25 条、tests/scope-amend-test.mjs 的 D-73 段 22 条；变异体 SAR_MUTATION_D77 三个与 M-D73a/b/c 三个全转红；独立复验 docs/audit/verification-v056.md 判 PASS
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-10T17:17:22.290Z

### 2026-11-10 · 闭环 D-80（家目录展开下沉到 absolutizePath）与 D-85（空设备不是写目标），并补齐两条永久断言 · 编排机制边界判定改造：scope 语义、工具通道语义、transcript brief 解析、派工台账生命周期与名额回收
- 做法：把家目录展开下沉到「解析成绝对路径」这一步（早于拼工作区根），口径只留一处；空设备从写目标提取与判定对象两处剔掉，真实路径越界照拦、真实写动词仍算写、解析不出仍兜底拒绝；每条缺陷配专属断言与语义层变异体，矩阵比对升级为「恰好转红」（多红报 EXTRA-RED、少红报 MISS）
- 证据：plugin/scripts/lib.mjs 与 plugin/scripts/guard.mjs；docs/audit/fix-d80-d85.md；tests/fix-d80-d85-test.mjs（49 条断言 + 6 个变异体）；独立复验 docs/audit/verification-v060.md 判 PASS_WITH_CONDITIONS、docs/audit/verification-v061.md 判 PASS（验收方用它自己上一轮的锚点复现：F-1 由 41/41 全绿变 2 FAIL、F-2 变 5 FAIL）
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-10T22:07:02.344Z

### 2026-11-11 · 编排机制边界判定改造：工具通道语义与判定闸门 · D-86 无进展重复调用闸门（loop-gate）：子代理陷入重复查证时当场拦下
- 做法：判据只取行为不取思维内容：连续相同调用指纹（bash/run_code 取命令正文、read 取 path 并连 offset·limit、glob/grep 取 pattern+path）达 N 次即拦第 N+1 次；归属键用 turn_id 归一（真实 transcript 行无 sessionId，用它过滤是死代码）；只读尾部并按 x4 自适应扩读（请求行与结果行交替，固定窗口会静默少算）；效率闸门 fail-open，guard 仍独立 fail-closed。
- 证据：plugin/scripts/loop-gate.mjs + tests/loop-gate-test.mjs（37 条断言，10 个变异体全红）；独立复验 PASS：430+ 真实 transcript 复现阳性（最长连跑 14 次 run_code / 10 次 task_output）+ 3 个金丝雀 + 60 份抽样误拦 0
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-11T18:25:56.984Z

