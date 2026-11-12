# 编排机制缺陷台账（v0.5.0 输入）

覆盖范围：由本轮两名互不通信的专项成员独立产出的两份缺陷清单，经独立 verifier 逐条复核（26 条裁决 V-01～V-26）后，由 Router 合并、去重、统一编号与字段模板而成。原始清单 `docs/audit/runtime-guards.md`（18 条）、`docs/audit/context-flow.md`（8 条）与验收报告 `docs/audit/verification.md` 为本台账的证据来源。

一句话结论：把独立验收也纳入证据链后，26 条里 25 条成立、1 条被证伪，合并去重后共 24 条独立缺陷；P0 级 5 条全部是「静默放行」——边界判定一旦落空，越界管控不是报错，而是安静地不再生效。



条目统计（2026-11-12 D-98 落盘后更新）：总计 **102** 条（含 D-25b~D-25e 四个子条目），其中 P0 11 条、P1 43 条、P2 34 条、P3 14 条。P0 里含 D-26（翻案条目，按「静默放行」同族定级）—— **统计以本表逐条明细为准，不得凭印象写数**（独立验收 F-03 查出过两处不自洽）。

本轮新增 **D-44~D-85 共 42 条**，来自五处独立来源：v0.5.4 独立验收报告 `docs/audit/verification-v054.md` 的 F1~F5、B 路错题本专项报告 `docs/audit/lessons-persistence-and-isolation.md` 的 RG-01~RG-09，本轮实测的 D-58（护栏两层判定口径不一致），记录闸门修复过程中实测发现的 D-59~D-62（Windows 并发写入路径上的四个新缺陷），本轮部署核对时实测发现的 D-63（部署工具会跨插件覆盖别人的缓存树）与 D-64（回归用例会往真实变更账里写假记录）。**原报告编号前缀保留在每条的「来源」行**，台账号由本会话统一分配，两套编号的对照表见第八节。

---

## 一、索引与裁决

| 台账编号 | 来源条目 | 严重度 | 归属层 | 一句话 |
|---|---|---|---|---|
| D-01 | CF-01 | P0 | 机制层 | transcript 为 codex 变体时，只认 compatible 的解析器返回 null → 同样整段放行 |
| D-02 | RG-01 | P0 | 机制层 | bash 路径提取正则要求「点+1~8位字母数字」，目录型目标(rm -rf config/.git/node_modules)整体逃逸，且无候选时直接放行 |
| D-03 | RG-02 | P0 | 机制层 | guard 只按工具名分流三张表，未登记的工具名一律放行 → 账号级不可逆操作可绕开 |
| D-04 | RG-03 | P0 | 机制层 | brief 不在 transcript 前 8 行 → 解析返回 null → guard 整段放行，越界管控一次性失效 |
| D-05 | RG-04 | P0 | 机制层 | dispatch 去重键依赖 turn_id，载荷缺该字段时旧记录被整条抹掉 → 前一个 worker 的 scope 从台账消失 |
| D-06 | CF-03 | P1 | 契约层 | 错题本规则/实战记录只以 additionalContext 进父会话，从不进子会话 → 教训前置靠 Router 手抄，无代码强制 |
| D-07 | CF-05 | P1 | 机制层 | extractScope 对写法敏感，SCOPE 行写法稍变就漏收 → 白名单变小等于放行 |
| D-08 | CF-07 | P1 | 契约层 | 4 类 hook（7 条规则）全部绑在父会话事件流，子会话不触发 SessionStart / UserPromptSubmit |
| D-09 | RG-05 | P1 | 机制层 | 闸门二只按同一父会话比对，嵌套派工与第二个 Router 会话都取不到在飞记录 |
| D-10 | RG-07 | P1 | 机制层 | 只有 SubagentStop 一条回收通路；派工被取消/中断/异常退出时名额 2 小时不回收 |
| D-11 | RG-08 | P1 | 机制层 | watchdog 的关键词式证据判定可被「搞定了，测试通过」这类空话绕过 |
| D-12 | RG-10 | P1 | 机制层 | 显示名与 routing id 两套命名空间做等值比较 → 反查失败 → 状态不回收 |
| D-13 | RG-11 | P1 | 契约层 | record-gate 的 verified_by 只校验「不等于 agent 名」→ 履历可由陌生人伪造，且会被注入给 Router 当匹配依据 |
| D-14 | RG-13 | P1 | 机制层 | 读模式按 scope 条目所在目录树放行整棵，写通道严格按条目本身 → 读写权限不对称 |
| D-15 | RG-14 | P1 | 契约层 | gate 把用户原文里的 SCOPE 当授权措辞注入，dispatch 照单全收 |
| D-16 | RG-16 | P1 | 机制层 | 写类工具的路径键名不匹配时取不到 target → 静默放行 |
| D-17 | CF-04 | P2 | 契约层 | gate 未命中粗筛即静默退出 → Router 不知道自己被编排机制覆盖 |
| D-18 | CF-06 | P2 | 契约层 | 错题本文件不存在时「教训前置」天然为空；方法论存在但正文不进上下文（需成员主动 read） |
| D-19 | RG-06 | P2 | 机制层 | 台账 slice(-200) 截断后，累计派工额度统计偏低 |
| D-20 | RG-09 | P2 | 机制层 | watchdog 不识别盘符绝对路径，把工作区外真实存在的路径判成「不存在」→ 误拦 |
| D-21 | RG-12 | P2 | 契约层 | record-gate 的 nextSection 索引口径混用（相对 vs 绝对）→ 20 条上限恒算错 |
| D-22 | RG-15 | P2 | 机制层 | glob/grep 显式传 path 目录时语义不稳（带尾斜杠与不带结果不同） |
| D-23 | RG-17 | P2 | 契约层 | 台账写了 4 个字段，但全仓无任何判定读取 → 台账写了无人读 |
| D-24 | RG-18 | P2 | 契约层 | 实战记录摘要按 roster 顺序截断 6 名，排位靠后的成员记录结构性不可见 |
| D-27 | 用户反馈 | P0 | 机制层 | 主动触发粗筛漏判 83%：口语化编排请求几乎全部静默放行，Router 不知道编排机制存在 |
| D-28 | 本轮实测 | P2 | 机制层 | 派工被取消/中断时不触发 SubagentStop，并发名额泄漏到 TTL（2 小时），机制没有可用释放入口 |
| D-29 | 本轮实测 | P3 | 机制层 | 留痕路径多套一层目录：痕迹写了，但按文档给的路径找不到 —— 留痕不可发现等于半个静默失效 |
| D-30 | 本轮实测 | P3 | 机制层 | 变异自检套件用固定临时目录，并发跑互相抹副本 → 假红 —— 会给假 FAIL 的测试比没有测试更危险 |
| D-31 | 验证轮实测 | P1 | 机制层 | SCOPE 覆盖私有记忆目录：读模式按目录树放宽，成员能读到兄弟成员的错题本全文与 Router 私有账 |
| D-32 | 验证轮实测 | P2 | 契约层 | 编排层教训零回流：契约与 review.md 都写着「SessionStart 注入 _router.md」，代码从未实现 |
| D-33 | 验证轮实测 | P3 | 契约层 | scope.md 声称「实战记录注入给 worker」，与代码不符（履历只给 Router 做匹配参考） |
| D-34 | 用户诉求 | P1 | 机制层 | 越界后没有恢复通道：撞墙只能改 brief 重新派工或等 worker 汇报，父会话要靠 task_append 人工补口径 |
| D-35 | 用户诉求 | P1 | 机制层 | 权限只有「逐路径白名单」一档：派大活要枚举路径、限制太死，且机制里根本没有「提权」这个动作 |
| D-36 | 本轮实现 | P1 | 机制层 | SCOPE 的 .superagent/ 单文件条目读范围覆盖整棵目录树（ro: roster.json 就能读全部错题本）+ 可改自己的权限等级 |
| D-37 | C 路审计 MP-01 | P1 | 机制层 | 派工链路不校验目标成员是否存在于账号 → 静默空转并占名额、误拦同 SCOPE 的正常派工 |
| D-38 | C 路审计 MP-02 | P2 | 机制层 | 陈旧判定（roster reconcile）既无执行点也无消费者 —— 工具存在但机制不生效 |
| D-39 | C 路审计 MP-03 | P2 | 机制层 | 账号级成员创建无闸门（删除/改写已硬拦），与删除/改写不对称 → 账号与名录必然漂移 |
| D-40 | C 路审计 MP-A1 | P3 | 机制层 | 越界拦截消息把「只读条目不授写权」说成「路径不在白名单内」→ 诱导把只读条目升级成可写 |
| D-41 | C 路审计 MP-A2 | P2 | 机制层 | 复合层危险词扫描对文档正文同样生效：报告引用被拦命令的形态即被拦，损害「每条可复现」这条底线 |
| D-42 | 验收方实测 | P1 | 机制层 | 私有记忆的**读范围**漏洞：派工闸门只判条目路径本身碰没碰 .superagent/，但读模式对目录条目展开整棵树 —— 一条覆盖工作区的只读目录条目就把兄弟成员的错题本也放开了 |
| D-43 | 验收方实测 | P1 | 机制层 | SCOPE 写绝对路径时，相对路径的目标匹配不上（契约 S2 声称「两种写法都能命中」只对相对目标成立）—— 派工写绝对路径的 worker 全程被误拦 |
| D-25 | 审计 RG-06 | P0 | 机制层 | bash 通道按**命令形态**识别账号级不可逆操作（`mavis agent delete` / `mavis agent update` 等），12 条负例不误伤 —— 判定落点从「字样匹配」改为「命令位置上的 CLI+子命令+动作」 |
| D-25b | 验收残余 | P0 | 机制层 | 包装器开关按包装器分别定义（带值/布尔/位置参数分列），包装器集合补齐，载荷按两式取参并整体再判 |
| D-25c | 验收残余 | P1 | 机制层 | 账号级 CLI 的子命令必须是第一个子命令：`mavis list agent delete` 不再被拦（过度拦） |
| D-25d | 验收残余 | P0 | 机制层 | **闭集包装器名单**改为「数据段/执行段」二分，`exec` 及任何新包装器自动覆盖 |
| D-25e | 验收残余 | P1 | 机制层 | 载荷取参按 shell 语义（`sh -c` 单参数、位置参数不推进外层）、`command -v` 查询语义 |
| D-26 | 金丝雀复测 | P0 | 机制层 | 原结论「平台不对 `run_code` 容器派发 PreToolUse」**被证伪并更正**为「派发随会话而变」—— 阴性观察缺金丝雀对照时不能写成平台事实 |
| D-44 | 验收 F1 | P0 | 机制层 | worker 可用 bash 执行 admin CLI 给自己提权到 full、并自批准自己的越界请求 —— 「批准权在父会话手里」被推翻 |
| D-45 | 验收 F2 | P1 | 机制层 | 「批准请求」路径不校验派工状态：派工已 done/aborted 仍可扩权（与「直接加条目」路径口径分裂） |
| D-46 | 验收 F3 | P2 | 机制层 | full 成员命中私有状态目录时，文案误诊为「在工作区之外」并建议「批准后重试」—— 该建议永远无效，形成撞墙噪音 |
| D-47 | 验收 F4 | P3 | 契约层 | 文档数字与括注过期（CHANGELOG 同文件并存 484/487、scope.md 写三条例外而契约已四条）→ 契约不是单一事实源 |
| D-48 | 验收 F5 | P3 | 机制层 | 未重跑部署 ⇒ 安装副本与运行时缓存树的 CHANGELOG 落后于仓库副本（脚本逐文件一致，对外口径不一致） |
| D-49 | B 路 RG-01 | P1 | 机制层 | 记录闸门不校验写入者身份：载荷里的 agent 字段可指定别人 → 能写进兄弟成员的错题本与履历 |
| D-50 | B 路 RG-06 | P2 | 契约层 | 伪空值：错题本文件有内容但抽不出规则时，注入仍说「0 条（还没栽过跟头）」，把通道故障谎报成没有教训 |
| D-51 | B 路 RG-02 | P1 | 机制层 | 段首定位两套口径（子串 vs 行首）：正文出现字面串「## 实战记录」⇒ 履历写进别的段，写进去却读不出来，且条数被提前触顶 |
| D-52 | B 路 RG-05 | P1 | 机制层 | 并发写同一错题本静默丢条目：read-modify-write 无锁无原子，每次写入都返回 ok:true（8 并发最多落 5 条） |
| D-53 | B 路 RG-04 | P2 | 机制层 | 归因判定只查 cause+rule，漏查 symptom ⇒ 「Router 的锅」写进现象字段即可绕过归因公平闸门 |
| D-54 | B 路 RG-03 | P1 | 机制层 | legacy 台账行（缺 parent_session_id）被迁移改写成 done ⇒ 可冒充验收凭据给履历背书 |
| D-55 | B 路 RG-07 | P2 | 契约层 | `_router.md` 无任何写入闸门（无模板/编号/上限/留痕校验）⇒ 全仓唯一靠人工自觉维护的记录文件 |
| D-56 | B 路 RG-08 | P2 | 机制层 | 取样名额两处口径不一致（CLI 默认 8 vs 注入层 12）⇒ 同一份数据两个结论 |
| D-57 | B 路 RG-09 | P3 | 机制层 | roster 重名不去重：同一成员在摘要里出现两次，重复计数并白占名额（重现 D-24 想消除的结构性不可见） |
| D-58 | 本轮实测 | P1 | 机制层 | 护栏第二道防线按目录前缀一刀切：管理员批准的「精确文件」只读扩权成了死条目，且边界建不起来 ⇒ 该 worker 的工具调用全线被拦 |
| D-59 | B 路修复轮实测 | P1 | 机制层 | Windows 上 rename 覆盖被占用文件报 EPERM ⇒ 那条记录根本没落盘，而旧实现返回「成功」——并发写在 Windows 上会静默少条目 |
| D-60 | B 路修复轮实测 | P1 | 机制层 | 落盘回读校验失败未回滚 ⇒ 那一次失败写入把前序所有条目一起抹掉（校验只是「发现覆盖」，不是「避免覆盖」） |
| D-61 | B 路修复轮实测 | P2 | 机制层 | Windows 抢锁报 EPERM 被误判成失败（锁机制本身是对的）；第一版修法用 existsSync 区分「占用 vs 权限」也是错的 —— 杀软扫描时路径已解析不到 |
| D-62 | B 路修复轮实测 | P2 | 机制层 | 锁等待超时（15s）短于持有者重试窗口（8.8s）⇒ 排队中的写入方被误判成失败（偷锁阈值也必须大于等待超时） |
| D-63 | 本轮实测 | P1 | 工具层 | 部署工具对**每一棵**租约缓存树都做全量同步（且会删源里没有的文件）⇒ 别家插件的树会被整棵覆盖 —— 本轮侥幸没出事是运气不是机制 |
| D-64 | 本轮实测 | P2 | 工具层 | 回归用例漏传 MINIMAX_PROJECT_DIR ⇒ 扩权留痕回退到 process.cwd()，把**测试夹具的假批准人**写进真实项目的变更账（审计账被假记录污染） |
| D-65 | 复验 F-01 | P1 | 机制层 | 权威面脚本的拦截锚点只覆盖运行中 guard 自己那一份 ⇒ worker 用**仓库副本**就能跑通整条提权链（上一轮「同名副本不误拦」的口径是错的） |
| D-66 | 复验 F-02 | P2 | 机制层 | D-59~D-62 四条**没有专属断言**：回退实现后一条都不红，D-61 还时敏（一次 2 红、一次 0 红）—— 间接覆盖不等于有断言 |
| D-67 | 复验 F-03 | P2 | 契约层 | 台账不自洽三处：统计行严重度与逐条明细对不上、索引表缺 6 条、D-50 状态描述与代码相反 |
| D-68 | 复验 F-04 | P3 | 机制层 | SCOPE 里含空格的路径被按空格切开 ⇒ 该白名单条目静默不生效（**本仓库自己的路径就含空格**） |
| D-69 | 本轮实测 | P2 | 机制层 | 累计派工上限硬编码 30 且不可调 ⇒ 一轮做完又要做下一轮时，父会话被自己的历史锁死（机制建议「开新会话」，但会话不由人决定） |
| D-70 | F-01 修复轮自查 | P2 | 机制层 | 上一轮「家目录四种写法都被拦」的断言是**假绿**：命中的是 scope 层而不是权威面规则 —— 家目录展开在旧锚点下大半是死代码 |
| D-71 | v0.5.6 收尾实测 | P3 | 契约层 | 名录里的提权留痕可以写自称（`tier_granted_by: router`），与「批准人必须是真实会话 id」的口径矛盾 —— 机制只校验**新**提权的批准人，不校验存量值 |
| D-72 | v0.5.6 活体实测 | P1 | 机制层 | watchdog 把「这个文件**没有创建**」判成「声称产出」→ 连续 block，实质在逼成员去创建那个文件（若它越界，机制就把成员往越界推） |
| D-73 | 修复轮 N-01 | P1 | 机制层 | 账号成员名单不可得时，派工的成员存在性判定**整体降级为不判** ⇒ 派给不存在的成员重新变成静默失效（占名额 + 后续派工被组队冲突误拦） |
| D-74 | 修复轮 N-02 | P1 | 机制层 | hooks 的危险 matcher 只登记删除/改写两个旧工具名，**建号那个没登记** ⇒ 该工具名根本不会被派给护栏（而它在本机工具清单里真实存在） |
| D-75 | 修复轮 N-03 | P2 | 机制层 | 管理员用 `--grant` 批准一条「只读条目上的写请求」时，只读被静默升级成可写 —— D-40 想防的动作在**管理员路径**上仍然成立 |
| D-76 | 修复轮 N-04 | P3 | 机制层 | 复合层载荷把命令放进变量时判不了（取不到命令文本）—— 设计上的边界，但必须写进报告与注入，不能留成隐性缺口 |
| D-77 | v0.5.6 活体实测 | P1 | 机制层 | 派工台账是**无锁的读-改-写** ⇒ 并发写会**静默丢记录**：在飞派工记录一丢，「组队冲突」闸门就看不见那条派工 ⇒ 两个 worker 可以同时写同一处 |
| D-78 | D-72 轮 N-01 | P2 | 机制层 | watchdog 的「声称产出」判定按**行**归属路径 ⇒ 同一行里与产出动词无关的路径（典型是**引用护栏自己的拒绝原文**）被一并认领 ⇒ 诚实的报告被 block |
| D-79 | D-72 轮 N-02 | P3 | 契约层 | watchdog 的四条 block 消息都不带**规则编号** ⇒ 收到 block 的人无法区分是哪条规则在拦，断言只能靠猜文案关键词（命中别的分支就假绿） |
| D-80 | D-72 轮 N-03 | P2 | 机制层 | `lib.mjs` 的 `absolutizePath()` **不展开家目录写法** ⇒ 真实存在的文件被判「不存在」⇒ 诚实的报告被 block（活体拦下过确实存在的安装副本） |
| D-81 | D-72 轮 N-04 | P2 | 机制层 | watchdog 的路径正则**不含通配符** ⇒ 模式路径被从中间截成碎片当文件 ⇒ 碎片必假，且可能指认成员根本没提过的文件 |
| D-82 | v0.5.6 收尾实测 | P1 | 机制层 | 插件数据目录判定先 trim 整条路径 ⇒ Windows 上带**尾随空格**的同名目录被误判为插件目录 ⇒ 读到**空台账**（格式合法）⇒ 冲突与名额检测**全盲** |
| D-83 | D-75 轮 N-01 | P2 | 机制层 | 只读升级检测按路径**写法逐字**比较 ⇒ `./docs/x.md`、`docs//x.md` 等别名写法逃逸检测 ⇒ D-75 的「显式升级留痕」以别名形态重新变成静默 |
| D-84 | D-75 轮 N-02 | P2 | 机制层 | 变更账写入失败被**静默吞掉**（`appendChangeLog()` 返回值被丢弃）⇒ 批准生效但账上无痕 ⇒ 「变更账必须写明升级」在写失败时静默失效 |
| D-85 | v0.5.6 收尾实测 | P3 | 机制层 | bash 重定向到**空设备**（`> /dev/null`）被当成写目标 ⇒ 记一条**批准了也没意义**的越界请求（待审清单噪声，且可能掩盖真请求） |
| D-86 | 父会话本轮实测 | P1 | 机制层 | 子代理陷入「无进展重复调用」时**无中途检测**：watchdog 只挂 SubagentStop（终点）、普通 task 子代理无轮次上限、TTL 只回收名额不终止子代理 ⇒ 跑偏会一直烧 token，父会话在它停之前完全不知情 |
| D-87 | 验收方实测 | P1 | 机制层 | guard 的三个 PreToolUse matcher 都不含 `task_output` ⇒ 子代理用 `task_output` 读另一个子会话的输出时**完全不受 scope 约束**（读类宽松策略也管不到它） |
| D-88 | 父会话本轮实测 | P1 | 部署层 | 覆盖磁盘上的插件文件**不会让运行中的客户端换版本**：宿主把 hook 绑在注册时解析的内容哈希缓存树上 ⇒ 升级后**必须重启客户端**才生效（**本仓库侧告知已随 v0.5.8 落地**：install.ps1 / 根 README / plugin README / CHANGELOG 四处均写明并给出自证办法；**宿主侧绑定行为仍未修**） |
| D-89 | 父会话本轮实测 | P1 | 机制层 | `task_append`（追加到已有子会话派工）**在派工台账里一条不记** ⇒ 追加轮的 scope 留痕缺失、冲突检测失明、原派工条目在追加轮开始前就被标 done（名额提前释放），且**无法为追加轮预授权工作区外路径** |
| D-90 | 验收方实测（第三轮复审普查） | P2 | 工具层 | `tools/ledger-check.mjs` **结构上发现不了状态漂移**：第 ④ 项只比「D 号集合」、不比「状态文字」⇒ 明细段已写「已修」而状态表仍写「待修」的漂移**不会让任何检查报错**（实测 D-37~D-41 五条如此，而台账仍报六项全 PASS） |
| D-91 | 父会话本轮实测（重启后首次活体探针） | P1 | 机制层 | PTC 模式下闸门**恒不触发**：宿主给 hook 的载荷是**内层工具**（`tool_name='bash'`），而 transcript 的 `message.content[]` 记的是**外层** `run_code` ⇒ 指纹落在两个命名空间、**永不相等** ⇒ 末尾连续数恒为 0（活体 8+1 次逐字相同调用全放行，阳性对照正常被拦）**【已修；独立复审第 4/5 轮均达成判定（AC 全达成），收尾轮补断言后为 55 条；发布复审 PASS-with-conditions；活体证据仍待装+重启取】** |
| D-94 | v0.5.9 发布侧实测 | P3 | 工具层 | 「**版本号四处一致**」**没有任何自动化断言守护**：`tools/install-selftest/check-readme-consistency.mjs` 读了 `SRC_VERSION` 却**只打印不判定** ⇒ 升版时文档版本字面量分叉**不会让任何检查报错**（同轮实测：README 目录结构数字 7→8 handler / 13→14 脚本早已漂移，靠人眼发现） |
| D-93 | 独立复审（第 5 轮，清单外问题） | P3 | 工具层 | 性能断言**负载敏感**：并发下实测 2921ms 触发 `< 2000ms` 红了 ⇒ 往**变异体矩阵**注入与语义无关的红点（D-86 老断言，非 D-91 新增）；修法 = **重复采样取最小值**（min-of-N），**不要**单纯抬阈值（那会把「秒级」这个保证一起放松）**【已修（v0.5.9）：min-of-7 + 相对基线倍数，阈值 2000ms 未动】** |
| D-92 | 用户报告（2026-11-12） | P1 | 机制层 | 派工粒度缺「**项目**」维度 ⇒ **一个大项目被拆成十几个子步骤、十几个窗口各干一小块**：复用判据只有「专项 + 文件」两维；组队闸门**只算写冲突** ⇒ 只读类派工（探针 / 取证 / 审阅）永远不触发；复用提示只说「有 N 个会话覆盖」而**不指出该追加哪一个** ⇒ 三道本该拦住它的关卡在「项目内部步骤」这一形态上全部失效 |
| D-95 | v0.5.9 发布独立复审实测 | P2 | 契约层 | `plugin/CHANGELOG.md` 的 v0.5.9 段把 PTC 混合形态夹具写成「**同一行**同时含外层与内层」⇒ **与事实相反**：真实 transcript（51 行）**同含行 = 0**（仅外层 24 / 仅内层 24 / 皆无 3，**跨行交替**），同含形态的那份是**合成**夹具（生成器与断言名都已标注「真实中不存在」）⇒ 与生成器自述、夹具内容**三处自相矛盾** —— 正是 D-91「**注释宣称 ≠ 代码在做**」的文档版 |
| D-96 | 父会话本轮实测（v0.5.9 发布前跑 `ledger-check` 时撞上） | P2 | 契约层 | 台账**索引表的三条长行被折成了两行**（D-91 / D-93 / D-92 的第 5 格被拆到下一物理行，且续行**没有收尾竖线**）⇒ markdown 表格从中间**断成两块** ⇒ `ledger-check` 的 `blocks.find()` **只取第一块** ⇒ 「index」集合看不见 D-92 / D-93 / D-94 ⇒ 统计行声称的条数与工具能看到的对不上（D-96 实测：index 95 / detail 99 / status 96），**六项检查里 `sets-equal` 因此报红** |
| D-97 | 父会话活体实测（v0.5.9 装好 + 用户重启客户端后重跑探针） | P1 | 机制层 | 宿主给 plugin PreToolUse hook 的 `transcript_path` **不是会话的 `messages.jsonl`**，而是 %TEMP%/minimax-plugin-hooks/transcripts/<sha256(sessionId).slice(0,32)>.compatible.jsonl —— 一份 **Claude 兼容投影**：**没有** `details.ptc.child_calls[]`（PTC 内层调用在投影里不可见）、tool call 又是 `type:'tool_use'`+`input`（不是 `type:'toolCall'`+`arguments`）⇒ 闸门解析器在活体文件上**识别到 0 个调用** ⇒ 末尾连续数恒 0 ⇒ **闸门在真实运行时永不触发**（活体 6 次逐字相同调用全放行）；**D-91 的夹具取自会话 `messages.jsonl`（形态不同源）⇒ 单元测试绿、活体零拦截** |
| D-98 | 父会话活体实测（v0.5.9 重启后对比「续接的旧子会话」与「全新子会话」） | P1 | 宿主侧 | 客户端重启后**续接的旧子会话**里，插件 PreToolUse 的两道闸门**都不生效**（越界写当场放行、重复调用闸门也不拦），而**同一时刻新建的子会话**两道都生效 ⇒ 宿主侧派发差异（本仓库不可修）：要么重启后没给旧子会话派发 plugin PreToolUse，要么派发的载荷缺 `agent_type` 让 hook 误判为父会话（guard/loop-gate 对父会话一律放行）；**本地用同一份绑定回放 ⇒ 两个会话判定逐字相同（都 deny）⇒ 差别不在插件代码**；**操作规则：活体验证必须用全新子会话，续接的旧子会话不能作为活体证据** |
**补充索引（D-27~D-30 所在轮次没有独立的「修复状态」表 —— 状态以各条明细段的「状态」行为准）**

| 编号 | 状态 | 说明 |
|---|---|---|
| D-27 | 已修复（v0.5.1） | 触发粗筛补口语动词短语、去掉 `length > 40` 硬门槛；判定函数抽到 `lib.mjs` 导出，契约新增 S11「触发语义」 |
| D-28 | 已修复（v0.5.2） | 取消/中断的释放入口由插件自带（契约 S6.2 第 5 条）；释放只把 `active` 翻成 `aborted`，目标不存在时报错退出、不静默成功 |
| D-29 | 已修复（v0.5.2） | 留痕路径按**目录名**判断拼接，不再假设「PLUGIN_DATA 就是插件根」 |
| D-30 | 已修复（v0.5.2） | 变异自检套件工作目录改走 `mkdtempSync`（唯一用固定目录名的那套已改），并发跑不再互相抹副本 |

**合并与剔除说明**

- `CF-02` 与 `RG-03` 是同一缺陷（brief 不在前 8 行 → 整段放行）。两份清单分别定级为「推断」与「已复现」，定级互相打架，合并时统一按「已复现」。
- `CF-08` 与 `RG-18` 是同一缺陷（实战记录按 roster 顺序截断），已合并。
- 原 `CF-06`（声称被派工成员的方法论文件不存在）被独立验收用三重取证证伪：方法论文件真实存在且读成功，真实发生过的 ENOENT 指向的是**错题本**文件。该条目已由产出者据实改写为「错题本不存在时教训前置天然为空、方法论正文不进上下文」，改写后的版本作为 D-18 纳入。**被证伪的原条目不入账**——但「审计结论会被证伪」这件事本身，正是本台账必须由独立验收产生的理由。

## 二、统一条目模板（单一事实源）

本轮两份 brief 的字段模板是我分别手写的：给两个 worker 的是 6 字段，给 verifier 的是 7 字段（多一条「还需要什么」），于是验收反过来判产出「字段模板不一致」。**根因不在成员，在编排层没有单一事实源的模板。** 模板必须收敛成一份，由 brief 引用而不是复述：

```
### D-01
- 触发条件：
- 影响：
- 复现步骤：
- 证据：
- 状态：已复现 | 推断
- 修法方向：
- 还需要什么：
```

## 三、缺陷明细

### D-01
- 触发条件：子会话 transcript 为 `*.codex.jsonl` 变体（`type:"response_item"`、`payload.role:"user"`、`payload.content[].type:"input_text"`），而 `readBriefFromTranscript` 只认 `type:"user"` + `message.content[].type:"text"`。
- 影响：scope 白名单解析返回 null → `guard.mjs:97-102` 走「解析不到边界 -> 放行」→ 子会话**完全不受越界管控**，可读写任意路径；同时 `dispatch_id` 反查失败，`watchdog.mjs:38-49` 兜底回收也失效，在飞派工名额不回收。
- 复现步骤：1) 取任一 `*.codex.jsonl` 样本；2) 逐字复刻 `lib.mjs:273-288` 的解析逻辑（只取 `obj.type==='user'` 且 `part.type==='text'`）；3) 观察 text 长度恒为 0、函数返回 null；4) 对比同一会话的 `*.compatible.jsonl` 变体，同一逻辑可解析出 scope。
- 证据：`plugin/scripts/lib.mjs:276-288`（`if (!obj || obj.type !== 'user') continue;` 与 `if (part && part.type === 'text')`）与 `plugin/scripts/guard.mjs:75`（`readBriefFromTranscript(String(input.transcript_path || ''))`）。真实样本：`5b26db54f727d72c35ce4cf7ed2a79f7.codex.jsonl` 第 1 行 `{"timestamp":"2026-11-09T12:31:28.969Z","type":"session_meta","payload":{...}}`、第 2 行 `{"timestamp":"2026-11-09T12:31:29.049Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"PTC is enabled for this turn...`——顶层 `type` 是 `response_item` 而非 `user`，`part.type` 是 `input_text` 而非 `text`，两处判断均落空。同文件全文含 `SCOPE:` 与 `PARENT SESSION:`（rawHasSCOPE=true、rawHasParentSession=true），说明**内容在、格式不符**。同一会话 `5b26db54...compatible.jsonl` 第 1 行可正常解析出 `SCOPE: .superagent/worker-probe.txt`、`agentName: worker`、`parentSessionId=mvs_9bdda202ae274c909a5b4352fc45a471`。 **本运行时用哪一变体的限定说明**：本单实测中，本会话（`73f33cbc...`）的 guard 确实按 brief 解析出的 scope 正常拦截了越界读写（拦截文案列出的 SCOPE 与 brief 一致），说明**当前 MCode 运行时传给 `input.transcript_path` 的是 `compatible` 变体**，本条在当前运行时不会触发；但 `codex` 变体由同一 `originator: minimax_plugin_hook` 写出、且与 `compatible` 同目录并存，一旦运行时切到 codex 形态（如换 Codex 系后端），同一条代码路径会静默放行。
- 状态：已复现
- 修法方向：`readBriefFromTranscript` 增加对 `codex` 变体的解析分支（`obj.type==='response_item' && obj.payload.role==='user'` + `part.type==='input_text'`）；或改为按 payload 形状嗅探而非硬编码 `type==='user'`。修法归机制 owner，本单不改代码。**重复关系**：本条与 Runtime-Guard 清单的同类条目重复（该清单条目以「brief 不在前 8 行」描述，落点同为 brief 解析不出 → scope 白名单为空 → guard 放行这一族问题），合并台账时应与之一并计入同一编号，不重复计数。
- 还需要什么：需要运行时侧给出目标环境 `input.transcript_path` 的实际取值样本（或直接在真实 codex 后端下跑一轮 guard 判定），才能确认本条在目标运行时是否已实际触发；本轮只验证了两种 transcript 形态的解析差异，未确认目标运行时会落到哪一种。
- 来源：CF-01 ｜ 严重度：P0 ｜ 归属层：机制层

### D-02
- 触发条件：worker 子会话调用 `bash`，命令里出现的路径**最后一段不含「点 + 1~8 位字母数字」**（目录、点文件、无扩展名文件），例如 `rm -rf config`、`rm -rf .git`、`rm -rf node_modules`、`rm -rf build/out`。
- 影响：越界删除/覆盖目录型目标完全绕过 SCOPE 边界；该分支不报错、不留痕，属静默失效。它绕过的正是 guard 声称要拦的「bash 里藏路径」场景。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:137`（路径提取正则 `/[A-Za-z0-9_.\\/-]+\.[A-Za-z0-9]{1,8}/g`，要求点后跟 1~8 位字母数字）、`plugin/scripts/guard.mjs:138`（候选过滤）、`plugin/scripts/guard.mjs:139`（`if (candidates.length === 0) process.exit(0);` 即默认放行分支）、`plugin/scripts/guard.mjs:141`（候选非空才继续判定）。旁证：本审计执行 `git status --short` 时同样命中这条放行分支（命令中无带扩展名的路径 token）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/guard.mjs:137` 的候选提取——不要用「点+扩展名」判定路径，改为先按空白/引号切词、再逐词判定是否为路径形态（含 `/`、`\` 或以 `.` 开头的点文件）；并把 `guard.mjs:139` 的默认分支改为对未知命令从严（命令含 rm/mv/cp/重定向等动词时，必须命中至少一个已知 scope 路径才放行），而不是直接放行。
- 还需要什么：无，代码路径已确定
- 来源：RG-01 ｜ 严重度：P0 ｜ 归属层：机制层

### D-03
- 触发条件：子代理会话调用任何不在 `DANGEROUS` / `WRITE_TOOLS` / `READ_TOOLS` 三张表里的工具名——包括本环境的 `mavis`（其 command 参数空间实测含 `agent create` / `agent update` / `agent delete`，见证据）与 `run_code`（内部代理 `tools.write` / `tools.edit` / `tools.bash`）。
- 影响：guard 头部注释声明的「账号级与对外不可逆操作——一律拦」只对 run_code 内部的那组工具名生效；同一个账号级删除通过 `mavis` 的命令空间即可达成（`mavis` 不在 DANGEROUS 表内），复合工具同理。护栏在最外层留了一道没有规则的口子。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:51-57`（DANGEROUS 表，键为工具名）、`plugin/scripts/guard.mjs:58-60`（命中即 deny）、`plugin/scripts/guard.mjs:64-69`（未登记工具名 → `process.exit(0)`）；本环境取证：`mavis` 工具自身的 `agent help` 子命令返回的 agent 组命令清单为 `agent list | agent get | agent create | agent update | agent delete`——即 `agent delete` / `agent update` 确在 `mavis` 的 command 参数空间内，而工具名仍是 `mavis`，不在 DANGEROUS 表内；`tool_search` 检索不到名为 `mavis` 的条目，因为它是常驻可见工具而非按需工具；`run_code` 的代理清单含 `write`/`edit`/`bash`，另含按工具名登记在 DANGEROUS 表内的 `mavis_agent_delete` / `mavis_agent_update`。
- 状态：已复现（已完全确认）
- 修法方向：把 DANGEROUS 判定从「工具名等值」升级为「工具名 + 关键参数」二维判定（`mavis` 且 command 以 `agent delete`/`agent update` 开头 → deny）；给 `run_code` 这类复合工具补一条规则：其参数里出现写类工具名时，一律按写类工具的 scope 规则处理。
- 还需要什么：无，代码路径已确定
- 来源：RG-02 ｜ 严重度：P0 ｜ 归属层：机制层

### D-04
- 触发条件：worker 子会话的 `transcript_path` 所指 transcript 里，第一条 user 消息**不在文件前 8 行内**，或消息对象的 `type` 不是 `'user'`，或缺 `PARENT SESSION:` / `agentName:` 标记。
- 影响：`readBriefFromTranscript` 返回 null → guard 不建立 binding → `guard.mjs:97` 的 `if (!binding || ...) process.exit(0)` 放行。该 worker 的全部文件读写（含 scope 外的写）一次性失去边界约束，且没有任何报错或日志。越界管控从「逐条判定」退化为「整段失效」。
- 复现步骤：
- 证据：`plugin/scripts/lib.mjs:275`（`lines.slice(0, 8)` 只看前 8 行）、`plugin/scripts/lib.mjs:278`（`obj.type !== 'user'` 过滤）、`plugin/scripts/lib.mjs:289-291`（靠正则取父会话/成员名/SCOPE）、`plugin/scripts/guard.mjs:74-76`（brief 为空则不建 binding）、`plugin/scripts/guard.mjs:97-101`（无 binding → 默认放行）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/lib.mjs:275`——不要只看前 8 行，改为扫描整份 transcript 找第一条 user 消息（或直接找含 `SCOPE:` 的 user 消息）；同时把 `plugin/scripts/guard.mjs:97` 的默认分支从「放行」改为「从严 + 显式报一次原因」，至少让派工方知道这条 worker 没被约束。
- 还需要什么：无，代码路径已确定
- 来源：RG-03 ｜ 严重度：P0 ｜ 归属层：机制层

### D-05
- 触发条件：PreToolUse(task) 载荷不含 `turn_id`（或为空串）。
- 影响：`dispatch.mjs:30` 得到 `tid = ''`，`dispatch.mjs:95-100` 的去重过滤 `String(d.turn_id || '') === tid` 对**所有** turn_id 为空的历史记录成立 → 同一 `parent_session_id` + 同一 `agent` 的旧 active 记录被整条删除。前一个 worker 的 scope 从台账消失 → 闸门二（重叠检测）看不到它 → 两个 worker 可被派到同一处互相覆盖；闸门三（在飞名额）也少算一个 → 并发上限形同虚设。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:30`（tid 取值）、`plugin/scripts/dispatch.mjs:95-100`（去重过滤）、`plugin/scripts/dispatch.mjs:102-116`（写入）。`tests/chain-test.mjs` 的 `dispatch()` 辅助函数始终带 `turn_id`，因此这条路径没有被任何回归测试覆盖。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/dispatch.mjs:95-100` 的去重键——缺 `turn_id` 时退化为 `parent_session_id + agent + tool_use_id`（`tool_use_id` 已在 `dispatch.mjs:106` 写入但从未被读取，正好可作唯一键），不要把空串当成「同一个 turn」。
- 还需要什么：无，代码路径已确定
- 来源：RG-04 ｜ 严重度：P0 ｜ 归属层：机制层

### D-06
- 触发条件：`dispatch.mjs` 把错题本规则与实战记录包进 `hookSpecificOutput.additionalContext`（`plugin/scripts/dispatch.mjs:134-141`），该 JSON 由 **PreToolUse(task)** hook 产出——作用在**父会话的那次 task 调用**上，不进子会话首条消息。
- 影响：子会话拿不到「上次栽在哪儿」「做成过什么」。除非 Router 读到注入后**手工把内容抄进 brief 的 PRIOR_LESSONS / PRIOR_RECORDS 段**，否则错题本在 worker 侧完全断链；本轮两次派工（`sa-orchestration-audit`、`sa-context-trace`）的 task prompt 中均无 lessons/records 块，证实该转写未发生。
- 复现步骤：1) 打开父会话 transcript `4efc02c8...compatible.jsonl`；2) 定位第 63 行与第 65 行两次 `"type":"tool_use","name":"task"` 调用；3) 读其 `input.prompt` 全文，确认不含 `历史教训`、`实战记录` 段；4) 对比 `dispatch.mjs:121-132` 代码，注入内容应出现在 task 调用前的 hook 输出中。
- 证据：`plugin/scripts/dispatch.mjs:85`（`readLessons(agent)`）、`:89`（`readRecords(agent)`）、`:121-125`（lessons 块文案「派工时必须写进 brief」）、`:126-132`（records 块）、`:134-141`（写出 `additionalContext`）。真实样本：`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 第 65 行 `{"type":"tool_use","id":"call_01a1c0c913b675a7a3a03b96","name":"task","input":{`…其 `prompt` 首段为「你是「上下文注入与传递链路追踪专员」。工作目录：C:\Users\yang2\Documents\MiniMax\mini code的插件\n\n## 开工前必做\n先读 `.superagent/methods/sa-context-trace.md`…」——**无 PRIOR_LESSONS、无 PRIOR_RECORDS 段**。全语料 grep `历史教训（派工时必须写进 brief）` 仅命中 `73f33cbc`（本会话读码回显）、`3909fcb6.codex`、`c29fafdb`、`f73f5500`（均为读 `dispatch.mjs` 源码的回显），**没有任何一个样本的子会话首条 user 消息含该块**。
- 状态：已复现
- 修法方向：把 lessons/records 作为**结构化字段直接注入 task 的 `prompt`**（在 dispatch 阶段改写 prompt 而非仅输出 `additionalContext`），让子会话必然收到；或约定 `additionalContext` 由运行时透传到 task prompt。当前「靠 Router 自觉抄写」的传递方式没有机制保障。
- 还需要什么：需要一次「Router 读到 additionalContext 后主动转写进 brief」的实测派工样本，确认转写路径可行且不会被运行时截断；本轮两次派工均未转写，只证明了「不转写就断链」，尚未证明「转写能通」。
- 来源：CF-03 ｜ 严重度：P1 ｜ 归属层：契约层

### D-07
- 触发条件：子会话首条 user 消息里 `SCOPE:` 行的写法若不是「同一行内逗号分隔」，或 SCOPE 后面跟的是目录而非以 `/` 结尾的目录项，`extractScope`（`lib.mjs:158-181`）会漏收条目。
- 影响：SCOPE 漏收 → guard 的白名单比派工意图窄 → worker 被**误拦**在合法路径之外（写操作严格模式要求精确命中，`lib.mjs:143-145`）；反过来，若 SCOPE 行写成自然语言整句，`isPathLike`（`lib.mjs:88-97`）会整条丢弃，白名单为空 → `guard.mjs:97-102` 直接放行，越界管控对该 worker 完全失效。
- 复现步骤：1) 读 `lib.mjs:158-181` 的块解析逻辑；2) 构造 SCOPE 写成 `SCOPE: docs/audit/context-flow.md`（无逗号、后续换行接第二个路径）的 brief；3) 跑 `extractScope` → 只收第一个路径，第二个丢失；4) 再构造 SCOPE 写成含中文描述的整句 → 返回空数组。
- 证据：`plugin/scripts/lib.mjs:88-97`（`PATH_LIKE` 只收 `[A-Za-z0-9_@~.\\/-]`，含中文即非 path-like）、`:165-179`（行内分隔与块内续行两种模式）、`:169` 与 `:177`（按 `[,，s]+` 切分）。真实样本：`5b26db54f727d72c35ce4cf7ed2a79f7.compatible.jsonl` 第 1 行 `SCOPE: .superagent/worker-probe.txt` 为单行单条，`73f33cbca067dd3d55331579664d091d.compatible.jsonl` 第 1 行 `SCOPE: docs/audit/context-flow.md, plugin/scripts/gate.mjs, plugin/hooks/hooks.json, C:/Users/yang2/AppData/Local/Temp/minimax-plugin-hooks/transcripts/` 为逗号分隔多行——两者均能被 `extractScope` 正确解析（复刻结果：scope 长度 1 与 4）。**未观测到漏收的真实样本**，故判为推断：风险点是格式脆弱（任何 Router 手误都会静默缩窄或清空白名单），而非当前已发生。
- 状态：推断
- 修法方向：派工闸门（`dispatch.mjs:47-52`）已能拒绝「无 SCOPE」的派工，但**不能拒绝「SCOPE 解析后为空/过窄」**——建议在闸门处校验解析结果条目数与 brief 原文的一致性，或在 brief 模板里固化 SCOPE 的单行逗号格式。
- 还需要什么：需要一份 Router 实际写 SCOPE 的语料样本（或一份已固化的 brief 模板规范），才能判定该格式脆弱性在真实使用中是否已被触发；本轮 9 个样本全部解析成功，未观测到任何漏收，故本条判为「推断」。
- 来源：CF-05 ｜ 严重度：P1 ｜ 归属层：机制层

### D-08
- 触发条件：`plugin/hooks/hooks.json` 声明的 4 类 hook / 7 条规则（SessionStart / UserPromptSubmit / PreToolUse ×4 matcher / SubagentStop）全部绑定在**父会话 Router 的事件流**上；子会话不触发 SessionStart。
- 影响：子会话**结构性拿不到** SessionStart 的编排协议注入（`session-start.mjs:19-36` 的「本会话已启用 Super-agent 编排机制 / 何时该编排」整块）。这不是缺陷本身（worker 本就不该编排），但它意味着：**唯一能让模型知道「存在编排机制」的那段上下文只有 Router 有**；worker 若被要求「按协议自述」或需要转派，缺少协议原文，只能靠 brief 正文里 Router 转述的片段。
- 复现步骤：1) 在 `hooks.json` 列出全部 hook 事件；2) 对照 9 个 transcript 样本，找出带 `subtype:"plugin_hook_context"` 的会话；3) 观察该 subtype 仅出现在两个**父会话**（`4efc02c8` 第 2 行、`76a305b5` 第 2 行），7 个子会话均无。
- 证据：`plugin/hooks/hooks.json:3-14`（SessionStart→session-start.mjs）、`:15-26`（UserPromptSubmit→gate.mjs）、`:27-72`（PreToolUse：matcher `task`→dispatch.mjs、`write|edit|multiedit|notebookedit|bash`→guard.mjs、`read|glob|grep|list|search`→guard.mjs、`mavis_agent_delete|mavis_agent_update|website_deploy|miniapp|miniapp_publish`→guard.mjs）、`:73-84`（SubagentStop→watchdog.mjs）——**无任何面向子会话的 hook 事件**。真实样本对照：`73f33cbca067dd3d55331579664d091d.compatible.jsonl`（本会话，sa-context-trace）全 77 行类型分布为 `{"user/-":46,"assistant/-":31}`，**无一条 `plugin_hook_context`**；`4efc02c8fee262d90426ad814bcb1f11.compatible.jsonl` 全 89 行分布为 `{"system/compactionSummary":1,"system/plugin_hook_context":1,"system/session_identity_reminder":1,"assistant/-":43,"user/-":43}`。另：`76a305b5...compatible.jsonl` 与 `4efc02c8...compatible.jsonl` 的 `plugin_hook_context` 块只含 SessionStart 文案 + 实战记录摘要，**不含** `本轮按编排流程处理`（gate 产物）——说明两条注入线在父会话也是彼此独立、时机不同的两条路径。
- 状态：已复现
- 修法方向：这是设计边界而非 bug，但应在机制文档里显式写明「子会话不注入 SessionStart 协议」，避免 Router 误以为 worker 已知协议；若 worker 需要知道协议，应由 brief 显式携带协议要点，而不是依赖 hook。
- 还需要什么：需要一个「worker 确实需要转派或自述协议」的真实场景 transcript，以验证 brief 未携带协议要点时 worker 的实际表现；本轮 7 个子会话样本均未触发该场景，无法判断这条边界在实战中会造成实际损失还是仅停留在纸面。
- 来源：CF-07 ｜ 严重度：P1 ｜ 归属层：契约层

### D-09
- 触发条件：worker 自己再派子代理（`session_id` = worker 会话 id），或同一项目里第二个 Router 会话派工。
- 影响：闸门二想解决的是「两个 worker 写同一处会互相覆盖、验收无法判断谁的改动生效」，但 `activeDispatches(ledger, sid, now)`（`dispatch.mjs:59`）只筛 `d.parent_session_id === sid`，父 Router 的在飞记录不在其中——嵌套派工与跨会话重叠全部漏检，同一文件可被两个并行 worker 同时写。文档 `dispatch.mjs:55-57` 把规则写成「同一会话里」，实现与文档一致，但与机制目的不一致。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:59-70`（闸门二）、`plugin/scripts/lib.mjs:221-228`（`activeDispatches` 按 `parent_session_id` 过滤）、`plugin/scripts/lib.mjs:198-216`（`scopeClash` 本身是对的，问题在上游选集）。
- 状态：已复现（已完全确认）
- 修法方向：把闸门二的比对集从「同一父会话的 active 派工」扩大到「同一项目内所有 active 派工」（在 `dispatch.mjs:59` 改用项目维度查询，或在 `lib.mjs:221` 增加一个不按 parent 过滤的查询入口）；`scopeClash` 可直接复用。
- 还需要什么：无，代码路径已确定
- 来源：RG-05 ｜ 严重度：P1 ｜ 归属层：机制层

### D-10
- 触发条件：worker 被取消、被中断，或平台没有发出 `SubagentStop`（子会话异常退出、Router 提前放弃）。
- 影响：`plugin/scripts/` 全目录检索 `cancel|interrupt|abort|timeout|超时|取消` **零命中**——全机制只有 `watchdog.mjs` 的 SubagentStop 一条回收通路（`watchdog.mjs:28-51`）。回收不发生时，该派工在 `DISPATCH_TTL_MS`（2 小时，`lib.mjs:84`）内一直占着「在飞」名额：闸门二把它当成仍在写同一处的 worker（挡住同 scope 的新派工），闸门三把它计入并发上限（6）。两小时后它被 `lib.mjs:226` 的 TTL 过滤悄悄排除出统计，但台账里 `state` 永远是 `'active'`——台账状态与真实状态失步，后续任何按 `state==='active'` 判断的逻辑都会误判。
- 复现步骤：
- 证据：`plugin/scripts/watchdog.mjs:28-54`（唯一回收点，整段被 try/catch 包裹、异常被静默吞掉）、`plugin/scripts/lib.mjs:226`（TTL 过滤）、`plugin/scripts/lib.mjs:84`（`DISPATCH_TTL_MS = 2h`）、`plugin/scripts/lib.mjs:235-241`（`markDispatchDone` 只把 state 置 done，无 cancelled/timeout 终态）、`plugin/scripts/watchdog.mjs:51-53`（`catch (e) {}`，注释「回收失败不能影响 watchdog 的本职判定」——回收失败无任何日志）。
- 状态：已复现（已完全确认）
- 修法方向：在 `plugin/scripts/lib.mjs` 增加 `markDispatchAborted(ledger, dispatchId, reason)`，并在 `dispatch.mjs` 写记录时同时记 `tool_use_id`（`dispatch.mjs:106` 已写但从未被读），供中断事件回调；TTL 过期时显式落成 `state: 'timeout'` 并写 `ended_at`，别让台账出现「永远 active」的条目；`watchdog.mjs:51-53` 的 catch 至少往 stderr 记一行。
- 还需要什么：无，代码路径已确定
- 来源：RG-07 ｜ 严重度：P1 ｜ 归属层：机制层

### D-11
- 触发条件：worker 收尾文本同时含「完成类」词与「证据类」词，例如「搞定了，测试通过」。
- 影响：`claimsDone`（`watchdog.mjs:94`）命中「搞定」；`hasEvidence`（`watchdog.mjs:95`）命中「测试」→ `watchdog.mjs:96` 的拦截分支不触发；`claimedPaths` 又因文本里没有产出动词而返回空 → `watchdog.mjs:115` 放行。watchdog 头部注释（「早期版本只做字面关键词匹配——『搞定了』这种话能蒙混过关……现在改为：先判声明，再把声明里提到的文件路径真实校验一遍」）声称的修复并不成立：加两个关键词即可完全绕过完成度校验。
- 复现步骤：
- 证据：`plugin/scripts/watchdog.mjs:9-12`（注释声称的修复）、`plugin/scripts/watchdog.mjs:94-96`（判定实现）、`plugin/scripts/watchdog.mjs:105-115`（文件校验分支未触发）；`tests/chain-test.mjs:80-87` 只锁了「搞定了」单个词，未覆盖「搞定了 + 证据关键词」。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/watchdog.mjs:95` 的 `hasEvidence`——证据必须是**可核验的具体物**（存在的文件路径 / 带行号的引用 / 可复现的命令与输出），而不是「测试/运行/结果」这类描述性词；建议收敛为「至少一个通过 `claimedPaths` 存在性校验的路径」或「一段命令输出」。
- 还需要什么：无，代码路径已确定
- 来源：RG-08 ｜ 严重度：P1 ｜ 归属层：机制层

### D-12
- 触发条件：Router 派工时 `agent_name` 写的是**显示名**，而子会话 transcript / Hook 载荷里是**routing id**。
- 影响：台账写的是 `agent: tInput.agent_name`（`dispatch.mjs:26,107`），guard 拿 `brief.agent || agentType` 去匹配（`guard.mjs:80,86-91`），watchdog 拿 `brief.agent || input.agent_type` 去匹配（`watchdog.mjs:44`）——三处来源、两种命名，且都是严格等值比较。命名不一致时 guard 的绑定里 `dispatch_id` 为空（`guard.mjs:82`），watchdog 回收不到该派工 → 名额不回收 → 连锁触发 RG-07：同一 scope 在 2 小时内不能再派工。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:26`（写 `agent_name`）、`plugin/scripts/dispatch.mjs:107`（写台账的 `agent` 字段）、`plugin/scripts/guard.mjs:80`（绑定取 `brief.agent || agentType`）、`plugin/scripts/guard.mjs:86-91`（按 agent 等值反查派工）、`plugin/scripts/watchdog.mjs:44`（同一等值比较）、`plugin/scripts/lib.mjs:290`（agent 取自 transcript 的 `agentName:`）。本环境的 agent-context 同时给出 `agent: 编排审计 # display name` 与 `agentName: sa-orchestration-audit # routing ID`，证明两个命名空间并存。
- 状态：已复现（已完全确认）
- 修法方向：在 `plugin/scripts/lib.mjs` 加统一的 `resolveAgentKey(input, brief)`（一律用 routing id，缺失时回退并做一次映射），dispatch 写入、guard 反查、watchdog 回收三处统一用它；反查时不要用等值比较，改成「能唯一确定的那条」（配合 dispatch_id 透传）。
- 还需要什么：无，代码路径已确定
- 来源：RG-10 ｜ 严重度：P1 ｜ 归属层：机制层

### D-13
- 触发条件：以任意 `agent` + 任意 `verified_by`（只要不等于 agent 名）调用 record-gate。
- 影响：`record-gate.mjs:5-9` 声明「关键约束：成就只能由『验收通过』触发，不能由成员自述触发」，`:53-54` 的实现只有两条——`verified_by` 非空、且 `verified_by !== agent`。没有校验验收人是否存在、是不是真的验收方、验收是否发生。成员自己填一个别人的名字就能把未经验收的成果写进履历；而履历会被 `dispatch.mjs:89` 前置给下一个 worker、被 `gate.mjs:42` 与 `session-start.mjs:39` 当成「这人做成过什么」注入给 Router，污染路由匹配依据。
- 复现步骤：
- 证据：`plugin/scripts/record-gate.mjs:5-9`（声明的约束）、`plugin/scripts/record-gate.mjs:37`（取值）、`plugin/scripts/record-gate.mjs:53-54`（仅两条检查）、`plugin/scripts/record-gate.mjs:96-103`（写入路径）；履历消费方 `plugin/scripts/dispatch.mjs:85-89`、`plugin/scripts/gate.mjs:42-52`、`plugin/scripts/session-start.mjs:39-50`。
- 状态：已复现（已完全确认）
- 修法方向：把 `verified_by` 从自由字符串换成可核验凭据——由验收方会话直接写自己的 agent 名（并在 roster 里校验其为验收角色），或要求附带验收记录文件路径并校验其存在且时间晚于成果产出；至少在 `record-gate.mjs:53` 附近加「验收人必须存在于 roster.json」的校验。
- 还需要什么：无，代码路径已确定
- 来源：RG-11 ｜ 严重度：P1 ｜ 归属层：契约层

### D-14
- 触发条件：worker 执行读类工具，目标落在某个 scope 条目**所在目录**下。
- 影响：`guard.mjs:111-118` 想放行的只是「该成员自己的方法论与错题本」两个文件；但 `lib.mjs:147-152` 的读模式判定用条目的**父目录**做前缀匹配 → 实际放开了 `.superagent/methods/` 与 `.superagent/lessons/` 下的**全部文件**，包括其他成员的履历与错题本。同理，任何以文件形式声明的 scope，其所在目录整棵树都可读。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:111-118`（拼两个具体文件）、`plugin/scripts/lib.mjs:129-155`（`inScope`）、`plugin/scripts/lib.mjs:147-152`（读模式用 `e.slice(0, e.lastIndexOf('/'))` 取父目录做前缀）；实测证据见复现步骤（本审计读上述文件均成功，工具未拦截）。
- 状态：已复现（已完全确认）
- 修法方向：把「成员自己的方法论/错题本」改成按**精确文件**放行（读模式增加一条「精确文件白名单」通道，不走目录树规则）；`lib.mjs:147-152` 的目录树放宽只保留给 scope 里显式以 `/` 结尾的目录项。
- 还需要什么：无，代码路径已确定
- 来源：RG-13 ｜ 严重度：P1 ｜ 归属层：机制层

### D-15
- 触发条件：用户 prompt 里出现 `SCOPE:`（任何大小写、任何位置），例如粘贴进来的日志或需求文档里含这一行。
- 影响：`gate.mjs:13` 的 `SCOPE_HINT` 命中即注入，`gate.mjs:24` 的 `extractScope(prompt)` 把用户文本里的路径抽出来，`gate.mjs:36` 以「本轮 prompt 中声明的 SCOPE：…」的**授权口吻**写进模型上下文；而 `dispatch.mjs:25` 会从 Router 的 brief 里再提取一次 scope 作为 worker 的写权限边界。两处提取来源不同却以同一份授权呈现——用户文本里一段并非用户本意的「SCOPE:」可能成为 worker 的写边界。
- 复现步骤：
- 证据：`plugin/scripts/gate.mjs:13`（SCOPE_HINT）、`plugin/scripts/gate.mjs:24`（提取）、`plugin/scripts/gate.mjs:36`（注入措辞）、`plugin/scripts/dispatch.mjs:25` 与 `plugin/scripts/lib.mjs:158-176`（第二次提取）、`plugin/scripts/lib.mjs:90-104`（`isPathLike` 允许 `C:` 前缀）。
- 状态：推断
- 修法方向：把 gate 注入的措辞从「本轮 prompt 中声明的 SCOPE」改成「用户文本中出现的疑似路径（未验证，是否作为边界由 Router 判定）」；并在 `dispatch.mjs` 侧要求 SCOPE 必须由 Router 显式复述并承担，而不是从用户原文继承。
- 还需要什么：gate 一定会注入这段文本（代码确定），但「Router 会原样照抄进 brief」属模型行为、本单未取证，因此越界的最终后果是推断。需要一次真实编排的 transcript，看 Router 的 brief 是否采用了注入文本里的 SCOPE；若不采用，本条降级为「措辞误导」。
- 来源：RG-14 ｜ 严重度：P1 ｜ 归属层：契约层

### D-16
- 触发条件：写类工具的路径参数不在 `file_path` / `path` / `filePath` / `pattern` / `file_pattern` / `query` 之内（例如 `notebookedit` 的 `notebook_path`、批量编辑的 `paths` 数组）。
- 影响：`guard.mjs:129` 的 `if (!target) process.exit(0)` 直接放行——又一个默认放行分支，且不报错。这类工具一旦真的以别的键名下发路径，越界管控对该工具完全失效。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:123-129`（键名清单与默认放行）、`plugin/scripts/guard.mjs:64-65`（工具名单里含 `notebookedit`）。
- 状态：推断
- 修法方向：改 `plugin/scripts/guard.mjs:129`——取不到目标时不要放行，改为对「已知写类工具但目标缺失」直接 deny（目标缺失本身就是异常）；并把路径键名清单收敛到一份可维护的映射表。
- 还需要什么：默认放行分支的存在由代码确定；但「平台是否以 `notebook_path` 下发」未取证——本环境工具 schema 中 `edit` 用的是 `file_path`（命中），`notebookedit` 的参数名未验证。需要一次真实的 `notebookedit` 调用载荷，或平台 Hook 载荷的字段契约文档。
- 来源：RG-16 ｜ 严重度：P1 ｜ 归属层：机制层

### D-17
- 触发条件：`gate.mjs:15-17` 的粗筛（INTENT 词表 + SIGNAL + `SCOPE:` 提示）未命中时，`gate.mjs:19-21` 直接 `process.exit(0)` 不输出任何内容。
- 影响：Router 在没有命中特征词的轮次里拿不到「本轮按编排流程处理」的协议注入，只能靠 SessionStart 那一次注入的余温 + skill 里的协议判断。表现为**该轮不该编排时正确静默（设计意图），但漏判时 Router 会完全不知道编排机制存在**——因为 SessionStart 只注入一次（`session-start.mjs:18-55` 全文只输出一次）。
- 复现步骤：1) 读 `gate.mjs:11-22`，确认命中条件与静默分支；2) 构造不含 INTENT 词、不含 SIGNAL 词、无 `SCOPE:` 的 prompt；3) 以该 JSON 作 stdin 跑 `node plugin/scripts/gate.mjs`，观察 stdout 为空、exit 0；4) 对照含 `派工`/`并行` 等词的 prompt，stdout 出现「本轮按编排流程处理」。
- 证据：`plugin/scripts/gate.mjs:11`（INTENT 正则）、`:15-17`（命中判定）、`:19-22`（`if (!hit) { process.exit(0); }`）、`:26`（注入首行文案）。真实样本佐证「命中才注入」：`4efc02c8...compatible.jsonl` 第 2 行的 `plugin_hook_context` 块**只有 SessionStart 的协议**（`本会话已启用 Super-agent 编排机制…`）+ 实战记录摘要，**没有** `本轮按编排流程处理`——说明父会话该轮并未走 gate 注入路径；而 `76a305b5...compatible.jsonl` 第 2 行的同一 hook 块里 `本会话已启用` 出现在偏移 43 处，与 SessionStart 首行文案一致。判定位置：`plugin/scripts/gate.mjs:19-22`。
- 状态：已复现
- 修法方向：保留静默放行（省 token 是对的），但把「编排机制存在」这一事实锚定到不会消失的载体（SessionStart 已做一次），并让后续轮次至少能在需要时按需重读 skill；当前形态下 SessionStart 的注入一旦被长会话压缩掉又无补偿机制。
- 还需要什么：需要 gate.mjs 的 INTENT/SIGNAL 词表与真实 Router 提问语料的对照统计，确认是否存在「本应编排却未命中粗筛」的漏判样本；本轮只验证了「命中才注入」与「未命中静默 exit 0」两个分支的代码路径，未在真实语料上测出漏判。
- 来源：CF-04 ｜ 严重度：P2 ｜ 归属层：契约层

### D-18
- 触发条件：`guard.mjs:111-120` 为读操作额外放行 `root + '/.superagent/methods/' + who + '.md'` 与 `root + '/.superagent/lessons/' + who + '.md'`，其中 `who = binding.agent || agentType`；而 `who` 对应的两个文件**并非总是同时存在**——方法论由建员流程落盘，错题本只在成员真正栽过跟头后才产生。
- 影响：该放行**只解决「能不能读到文件」，不解决「内容进不进上下文」**。两条路径的正文都必须由成员主动 read 才会进入上下文；路径来自**运行时注入的 agent system_prompt 与 brief 正文**（如「先读 `.superagent/methods/sa-context-trace.md`」），不是 hook 注入的，所以「成员方法论/错题本路径」这条上下文来源能否到达，取决于成员运行时配置，不在本插件链路内。**本轮据实观察到的事实**：方法论文件 `.superagent/methods/sa-context-trace.md` **存在**（55 行，实读成功），而被派工成员的错题本 `.superagent/lessons/sa-context-trace.md` **不存在**——该成员尚未栽过跟头，本来就没有错题本。由此得出的真实影响是：**「教训前置」这一环在成员侧天然为空**，不是因为链路吞掉了它，而是因为没有内容可传递；本轮派工 brief 里「PRIOR_LESSONS（该成员暂无错题本，本次为空）」正是这一状态的正确呈现。这与 CF-03 是两个独立缺口：CF-03 是「有内容但传不到子会话」的通道断链，本条是「通道两侧都没内容」的空态。
- 复现步骤：1) 读 `guard.mjs:107-120` 确认放行逻辑只放宽路径判定、无注入正文；2) 实读 `.superagent/methods/sa-context-trace.md` → 读成功（55 行，首行 `# sa-context-trace`）；3) 列 `.superagent/lessons/` 目录 → 只有 `_TEMPLATE.md` 与 `sa-orchestration-audit.md`，**无** `sa-context-trace.md`；4) 对照 `.superagent/roster.json` 中 `sa-context-trace` 的 `method` 字段 = `.superagent/methods/sa-context-trace.md`，与磁盘实况一致；5) 观察 guard 侧：即便文件存在，也只是允许读，不自动把正文注入上下文。
- 证据：`plugin/scripts/guard.mjs:107-110`（注释明写「它们住在项目的 .superagent/ 下，通常不在派工 SCOPE 里；不放开这两个读权限，整套机制就断了」）、`:111-120`（仅 `scope.concat` 两路径）。本轮独立复核三处取证：① `read .superagent/methods/sa-context-trace.md` → 成功，`totalLines` = 55；② `glob .superagent/lessons/*` → 仅 `_TEMPLATE.md`、`sa-orchestration-audit.md`，**无** `sa-context-trace.md`；③ `read .superagent/roster.json` → 成员 `sa-context-trace` 的 `method` 字段指向该 methods 文件（存在且与 roster 一致）。**更正说明**：本条此前版本把缺失记在 methods 路径上（报为 ENOENT），属取证误记——methods 文件一直存在，真实缺失的是错题本文件。取证的 transcripts 目录不在本轮 SCOPE 内（grep 被 guard 拦截），故 transcript 侧的三重复核由独立验收完成，本轮依据的是上述工作区直接取证。
- 状态：已复现
- 修法方向：原结论方向（「方法论拿不到 / 方法论缺失应拒绝派工」）作废——方法论一直存在，据此修闸门只会误拒正常派工。新方向指向「**方法论存在、但错题本不存在时，教训前置这一环在成员侧天然为空**」：① 不要把「成员无错题本」记成链路缺陷，那本就是正确状态（还没栽过跟头）；② 机制层应在 brief 里显式区分「该成员无错题本（内容为 0 条）」与「错题本存在但未送达（通道故障）」两种空值，否则 Router 无法判断该补内容还是该修链路；③ 承接 CF-03 的修法方向，让 lessons 以结构化字段直接进入 task prompt 时，空集合要显式标注为「该成员暂无错题本」，而不是静默省略——否则两种空值在下游无法区分。
- 还需要什么：需要一份真实的 `.superagent/lessons/<成员名>.md` 样本（当前仅 `sa-orchestration-audit` 有错题本）配合 `lessons.mjs` 的读取路径实测，才能确认「有错题本时该文件能否被成员读到并进入上下文」；本条当前只确认了「无错题本时该环天然为空」这一半，另一半（有内容时的到达情况）未取证。
- 来源：CF-06 ｜ 严重度：P2 ｜ 归属层：契约层

### D-19
- 触发条件：台账 `dispatches` 超过 200 条后，`dispatch.mjs:117` 的 `slice(-200)` 丢掉最旧记录；若被丢掉的正好是当前会话自己的历史记录，`totalDispatches` 统计出的累计数就低于真实值。
- 影响：闸门三的「累计派工 30」上限只在台账尚未被截断时有效；多会话并行、长时间运行后可持续超派。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:117`（`slice(-200)`）、`plugin/scripts/lib.mjs:230-233`（`totalDispatches` 只统计台账里仍在的记录）、`plugin/scripts/dispatch.mjs:77-82`（上限判定）。
- 状态：已复现（已完全确认）
- 修法方向：把累计计数从「扫台账」改为台账里持久化一个 per-session 累计计数；或把截断策略改成按会话配额保留（例如每个 parent_session_id 至少保留最近 N 条），别让 200 这个全局截断决定单个会话的额度。
- 还需要什么：无，代码路径已确定
- 来源：RG-06 ｜ 严重度：P2 ｜ 归属层：机制层

### D-20
- 触发条件：worker 在交付里写出**工作区之外的绝对路径**（Windows 盘符路径 `C:/...`）。
- 影响：`watchdog.mjs:78` 只把以 `/` 开头的当绝对路径，`C:/...` 不以 `/` 开头 → 被拼成 `<工作区根>/C:/...` → `watchdog.mjs:79` 的 `existsSync` 必然为 false → 该文件被列入「声称产出但不存在」→ `watchdog.mjs:105-112` block。交付被反复打回，而文件其实真实存在。这与 RG-08 方向相反：watchdog 一边放行空话，一边拦截实话。
- 复现步骤：
- 证据：`plugin/scripts/watchdog.mjs:78`（`const abs = norm.startsWith('/') ? norm : root + '/' + norm;`）、`plugin/scripts/watchdog.mjs:79`（`existsSync` 判定）。对照 `plugin/scripts/lib.mjs:113-121`（`relativize` 已实现盘符绝对路径处理），watchdog 这条路径没有复用。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/watchdog.mjs:78`——盘符路径（`/^[A-Za-z]:/`）按绝对路径直接判存在；把路径归一化抽成 `lib.mjs` 的公共函数，让 guard 与 watchdog 用同一套规则（现在两处各写各的）。
- 还需要什么：无，代码路径已确定
- 来源：RG-09 ｜ 严重度：P2 ｜ 归属层：机制层

### D-21
- 触发条件：成员方法论文件的「## 实战记录」段位于文件后半段（本项目模板与真实文件都是这样——它是最后一个二级标题）。
- 影响：`record-gate.mjs:72-76` 的 `nextSection` 返回**相对偏移**（`rest` 内的位置），`:66` 却把它当**绝对索引**传给 `raw.slice(sectionStart, ...)`；当相对偏移小于 `sectionStart` 时 slice 得到空串 → `existing = 0` → `MAX_RECORDS = 20`（`:23`、`:68-69`）这道上限**永不触发**，履历可无限增长。同一文件的写入路径（`:96`）用的是正确的绝对索引 `raw.indexOf('\n## ', sectionStart + SECTION.length)`——同一文件两种索引口径，是这个 bug 的直接证据。
- 复现步骤：
- 证据：`plugin/scripts/record-gate.mjs:64-69`（计数与上限判定）、`plugin/scripts/record-gate.mjs:72-76`（返回相对偏移的 `nextSection`）、`plugin/scripts/record-gate.mjs:96`（写入路径用绝对索引）。真实布局证据：`.superagent/methods/_TEMPLATE.md:42-44`（「## 实战记录」是最后一个二级标题，起于第 42 行）、`.superagent/methods/sa-plugin-release.md:52-59`（真实成员文件同构：段首在第 52 行、全文 61 行）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/record-gate.mjs:72-76`，让 `nextSection` 返回绝对索引（`from + SECTION.length + rest.indexOf(...)`），与 `:96` 口径统一；并加一条断言：计数结果为 0 但文件里确有 `### ` 记录时判为异常，不要静默当成 0。
- 还需要什么：无，代码路径已确定
- 来源：RG-12 ｜ 严重度：P2 ｜ 归属层：契约层

### D-22
- 触发条件：worker 用 `glob`/`grep` 且显式传 `path` 目录（该目录在 scope 条目所在目录下，但目录本身不是条目）。
- 影响：`guard.mjs:123-127` 的 `targetOf` 优先取 `tInput.path` → 目标变成目录（如 `src/app`）；`lib.mjs:147-152` 的读模式只放开「条目所在目录下的**文件**」，不放开「该目录本身」→ `inScope` 返回 false → `guard.mjs:149-153` deny。结果是：读 `src/app/session.ts` 放行、列 `src/app` 目录被拦——同一个目录，两种结论。
- 复现步骤：
- 证据：`plugin/scripts/guard.mjs:123-129`（目标取值）、`plugin/scripts/lib.mjs:129-155`（`inScope` 读模式分支）、`plugin/scripts/guard.mjs:149-153`（最终 deny）；`tests/e2e-test.mjs:127-128`（`{pattern:'src/app/*.ts'}` 放行 / `{pattern:'**/*.ts'}` 拦截）与 `tests/guard-test.mjs:97-102`（同一组用例）只锁了「pattern 不带 path」的情形，未覆盖带 `path` 的调用；`tests/chain-test.mjs` 全文 `glob|grep|pattern` 零命中，不含任何 glob 用例（原引用 `:157-166` 举证不实，已删除）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/lib.mjs:147-152`——读模式命中「条目所在目录」时应把该目录本身也算命中（`rel === dir` 也放行）；或在 `plugin/scripts/guard.mjs:123-127` 对 glob/grep 优先按 pattern 判定、path 只作附加约束。
- 还需要什么：无，代码路径已确定
- 来源：RG-15 ｜ 严重度：P2 ｜ 归属层：机制层

### D-23
- 触发条件：任何一次派工。
- 影响：`dispatch.mjs` 写了 4 个字段，全仓没有任何判定读过它们——典型的「台账写了但判定不查」。其中 `unscoped: false` 最能说明问题：它看起来是「无 scope 派工」的标记，但闸门一（`dispatch.mjs:47-55`）已直接拒掉无 scope 的派工，这个字段永远只能是 false 且没人读；`tool_use_id`（`dispatch.mjs:106`）是唯一能标识「一次具体派工」的天然唯一键，却被写入不用，正是 RG-04 去重键退化的直接原因。
- 复现步骤：
- 证据：`plugin/scripts/dispatch.mjs:106,109,111,113`（写入点）；检索结果见复现步骤（`plugin/scripts/` 与 `.superagent/` 两个目录下均只有写入点、无读取点）。
- 状态：已复现（已完全确认）
- 修法方向：要么让判定真的用上这些字段（`tool_use_id` 用作去重与回收的键；`unscoped` 删掉或改为记录「scope 提取时是否降级」），要么从台账结构里删掉，避免后来人误以为它们在起作用。
- 还需要什么：无，代码路径已确定
- 来源：RG-17 ｜ 严重度：P2 ｜ 归属层：契约层

### D-24
- 触发条件：roster 里第 7 个及以后的成员也有实战记录。
- 影响：`records.mjs:51` 的 `if (out.length >= maxMembers) break;` 在满 6 个时直接截断（`gate.mjs:42` 与 `session-start.mjs:39` 都传 6），注入文本却写成「以下成员过去有验收通过的成果」，读起来像全集——被截掉的成员对匹配参考完全不可见，Router 可能为一个已有战绩的专项另建成员。
- 复现步骤：
- 证据：`plugin/scripts/records.mjs:38-53`（`maxMembers` 与 `break`）、`plugin/scripts/records.mjs:51`（截断行）、`plugin/scripts/gate.mjs:42`、`plugin/scripts/session-start.mjs:39`（两处都传 6）。
- 状态：已复现（已完全确认）
- 修法方向：改 `plugin/scripts/records.mjs:51`——截断时保留「已显示 N / 共 M」的显式提示，或按成员的 owns 相关度排序后再截断；`gate.mjs:42` / `session-start.mjs:39` 的 6 与 `records.mjs:38` 的默认 8 要对齐说明。
- 还需要什么：无，代码路径已确定
- 来源：RG-18 ｜ 严重度：P2 ｜ 归属层：契约层

### D-86
- 触发条件：子代理在同一派工内**连续发起 N 次完全相同的工具调用**、且中间没有任何别的工具调用（N 默认 5）—— 典型形态是「查证 → 验证 → 再查证」的无休止循环。
- 影响：跑的过程中**没有任何一层看得见**。① `plugin/scripts/watchdog.mjs` 挂在 `SubagentStop`（终点），只在 worker 停下来时看它最后一条消息；② 普通 `task` 子代理**没有轮次上限**（宿主 `maxTurns` 只属 goal 模式且 opt-in 不配即无上限，普通 task 路径不消费它）；③ 插件**没有中途止血能力**（`plugin/scripts/release-slot.mjs:9` 明写「取消场景必须由发起方显式释放」），TTL 到期只回收**台账名额**、**不终止子代理** ⇒ 一个陷入循环的子代理会一直烧 token，父会话在它停之前完全不知情。
- 复现步骤：本条为父会话实测推演出的**机制缺口**（非单次活体复现）。① 取本机真实子会话 transcript，统计工具调用指纹重复度 —— 实测最大子会话（55 MB / 431 条消息 / 215 次工具调用）里**同一条 bash 命令连续重复 45 次**、同一文件 read 13 次、edit 12 次；② 该形态下**跑的过程中没有任何 hook 触发过拦截** —— 因为不存在中途检测点（watchdog 只在 SubagentStop 醒来）。
- 证据：父会话本轮实测（2026-11-12）：`~/.minimax/v2/sessions` 全量扫描 419 个 jsonl / 112532 条消息，117 个子会话 transcript 合计 221 MB，最大单个 55 MB（assistant 消息 200 条 ≈ 200 次模型往返），中位数 722 KB；重复指纹普查输出 `bash×90, read×61, edit×24, task_output×20, grep×18, write×2` 且同命令重复 45 次。宿主侧：`node_modules/@mavis/config/dist/goal-config.js` 的 `maxTurns` 仅属 goal 模式（`goal.subagent.maxTurns` / `goal.budget.defaultMainTurns`，opt-in 不配即无上限）；`@mavis/agent-tools/dist/desktop/local-task.js:74-97` 的后台分支不消费任何轮次上限；插件侧 `plugin/scripts/watchdog.mjs` 只挂 SubagentStop、`plugin/scripts/release-slot.mjs:9` 写明取消场景必须由发起方显式释放。
- 状态：已复现（缺口已由实测数据确证：「重复指纹确实存在」与「跑的过程中没有拦截点」双向佐证）→ **已修（v0.5.8，独立复验两轮 PASS）**：新增 `plugin/scripts/loop-gate.mjs`（规则 `R-LOOP-SAME-CALL`，N 默认 5，可用 `SAR_LOOP_GATE_MAX_SAME` 覆盖），挂 `PreToolUse`、matcher 显式列出工具名（含 `task_output|task_query|task_stop`），归属键用 `turn_id` 归一（规则 A1~A4），只读 transcript 尾部并按 ×4 自适应扩读，效率闸门 fail-open。**活体拦截证据仍未取到，但阻断原因已从 D-88 推进到 D-91**：客户端重启后活体树确实换到了含 `loop-gate.mjs` 的新树（`1212d9fa…`，v0.5.8），闸门代码**已经上场**，但 8+1 次逐字相同的活体调用**一次都没被拦** —— 实测根因是闸门比对的**外层/内层命名空间错位**（D-91）。判定逻辑本身已用**真实子会话 transcript + 真实载荷**本地回放坐实：外层形态的第 6 次逐字相同调用即 deny（截断回放实测），内层形态恒放行；**该形态错位已由 D-91 定位并修复**（择一计数，见 D-91 条目）。
- 修法方向：新增**无进展重复调用闸门**（`plugin/scripts/loop-gate.mjs`）—— 挂 `PreToolUse`，用子会话自己的 transcript **尾部窗口**统计「末尾连续相同调用指纹的条数」，达阈值即 deny 并要求「基于已有信息给结论或说明卡点」。两条设计边界必须写进代码注释：① 判据只取**行为**、不取思维内容（重复是机器可判的指纹）；② 本闸门是**效率闸门**，读不到历史时 **fail-open 放行**（与 guard 的安全闸门 fail-closed 相反 —— 拦错的代价是子代理干不了活），且只对子代理生效、父会话一律放行。**不读正文**：子会话 transcript 可达 55 MB，父上下文装不下。
- 还需要什么：阈值已实测校准（N=5，误伤评估见契约 S15；独立复验抽样 60 份真实 transcript 误拦 0）。**仍缺「跑的过程中真实触发过」的活体证据** —— 须在**宿主换绑之后**（见 D-88；**重启客户端 = 确定路径**，插件面板「停用→再启用」= 未实测的候选路径）由独立验收方补（金丝雀对照 + 时间戳 + 子会话 id，缺一件只能写成「该次如此」）。
- 来源：父会话本轮实测 ｜ 严重度：P1 ｜ 归属层：机制层

### D-87
- 触发条件：子代理调用 `task_output` 读取另一个子会话 / 后台任务的输出。
- 影响：**完全不受 scope 约束**。`guard.mjs` 的三个 PreToolUse matcher（写类 / 读类 / 危险类）都不含 `task_output` ⇒ 宿主按**精确等值**匹配（不是子串）⇒ 这个工具**根本不会被派发到 guard**；读类策略（S2.1 允许读 scope 所在目录树）也管不到它。后果：子代理之间可以互相读输出、读别的派工的交付内容，绕开「成员记忆共享但隔离」这条纪律（D-06 那族）。
- 复现步骤：① 子代理调用 `task_output`；② 观察宿主未派发 guard 的 PreToolUse（`guard.mjs` 不产生任何 deny）；③ 该调用能读到另一子会话的输出。
- 证据：宿主 `runner.js` 的 `matches()` 对 MINIMAX 格式走 `alternatives.includes(value)` **精确等值**（父会话 2026-11-12 从宿主源码确证）；`plugin/hooks/hooks.json` 的三个 matcher 实测均无 `task_output`。旁证：验收方实测真实 transcript 里最长的连跑族正是 `task_output` 轮询（10 连跑）—— 说明这个工具在子代理里高频使用，不是理论风险。
- 状态：已复现（**未修**）—— D-86 的返修单里明确「发现但不改」，避免两个缺陷混在一单里。
- 修法方向：把 `task_output`（以及 `task_query` / `task_stop`）纳入 guard 的读类 matcher；并明确它读的是**另一个子会话的输出** ⇒ 判定对象不是「工作区路径」，要单独设计（不能直接套 scope 目录树规则）。
- 还需要什么：需要先确认 `task_output` 的载荷形状（读的是任务 id 还是输出文件路径）—— 载荷里只有 `task_id` 时 guard 无法从载荷直接算出目标路径，需要靠任务台账反查。
- 来源：验收方实测（D-86 独立复验顺带发现）｜ 严重度：P1 ｜ 归属层：机制层

### D-88
- 触发条件：用安装脚本（或手工覆盖）把插件文件升级到新版本，而**运行中的客户端不重启**。
- 影响：**新代码完全不上场，且没有任何报错**。宿主把插件的 hook 绑定在「插件注册时解析出来的那棵内容哈希缓存树」上（`~/.minimax/v2/plugin-hook-cache/sha256-tree-v1-<hash>`，目录名是插件包内容哈希）。覆盖磁盘文件**只会多物化出一棵新树**，不会让活体 handler 改用新树；把新版本的文件**直接写进活体树**在当时也不生效（**成因属推断**：宿主缓存了解析后的 hook 配置，或把树重新物化成注册时内容 —— 两者无法唯一区分，见证据③的诚实边界）。后果：① 用户升级后以为新机制已装上（v0.5.8 的「无进展重复调用闸门」实测**一次都没跑过**），实则跑的仍是旧版本 —— 与 D-86 同族的「静默失效」；② 对外分发时的告知缺口**已由 v0.5.8 补上**（`install.ps1` / 根 README / plugin README / CHANGELOG 四处均写明「必须重启客户端才会生效」并给出自证办法）；**未修的只剩宿主侧绑定行为本身** —— 宿主若不提供可用的热重载入口，用户只能靠重启换绑。
- 复现步骤：① 备份旧版 → 把插件目录换成 v0.5.8（跑 `install.ps1`）→ 观察 `plugin-hook-cache` 里**新长出一棵** v0.5.8 的树；② 起一个新的子代理会话，让它做一次 scope 越界操作 → 看拒绝原文里带出的缓存树路径指向哪一棵（本机是 **v0.5.7** 那棵）；③ 让子代理连发 N+1 次逐字相同的工具调用 → **全部放行**（因为那棵树上根本没有 `loop-gate.mjs`）。
- 证据（父会话 2026-11-12 实测，三次独立探针）：① 安装副本已是 v0.5.8（29 个文件与仓库逐字节一致），缓存树里确有 v0.5.8 的新树（`sha256-tree-v1-73354f92…`，目录创建于 02:39:36 —— 本条先前写 02:39:38，差 2 秒属口径差，不影响结论）；② 但 02:53:29 与 02:59:31 两个新子会话的 scope 越界拒绝原文里带出的树路径**都是** `sha256-tree-v1-31a958463f5881585b5181eb6d5b17d8c025a636ea85a089b6c966b46b1932c7` —— 该树 `version=0.5.7`、**无 `scripts/loop-gate.mjs`**、`hooks.json` 只有 4 个 PreToolUse 组；③ 第三次探针（19:04:22Z，会话 `mvs_14d4c419dc3742f88dcc64d247096339`）8 次逐字相同的顶层 `run_code` 全部放行 —— 此时父会话已把 v0.5.8 的 `hooks.json` 与 `loop-gate.mjs` **直接写进活体树**（该文件只读 mode 444，chmod 后写入成功）仍不生效。**诚实边界（2026-11-12 独立复验回写）**：① 这次写入的**终态已漂移** —— 该树随后被父会话**逐字节还原为 v0.5.7 原样**（现测：4 个 PreToolUse 组、`scripts/` 下 13 个文件、无 `loop-gate.mjs`、mtime=19:13:17Z），因此「当前树上没有 loop-gate.mjs」**不能**当作「宿主缓存了解析后配置」的证据；② 「宿主缓存了解析后的 hook 配置」与「宿主把树重新物化成注册时内容」两种解释**无法唯一区分**，本条按**推断**记录，不是已证事实（RT-04 / RT-05）。**可证的部分**：活体仍跑 0.5.7、8 次探针全放行 —— 前者由拒绝原文里的树路径支撑，后者由 transcript 原文支撑；④ **阳性对照**：**另两个新子会话**里 scope 越界拦截**正常生效**（02:53:29 的 `mvs_80ef7668ba4340fbacf0d9fd2629195d`、02:59:31 的 `mvs_b55158c41c184f29b3cdbad5cef94a1b`；拒绝原文含 `[super-agent-router] 越界拦截` 与那条树路径）⇒ 派发链路本身是通的，坏的是「派发的是哪一份代码」。**更正**：本条先前写「同一会话」，指的就是探针③那个会话 —— 独立复验与父会话各自独立实测均确认 `mvs_14d4c419…` 的 transcript 内**既无越界拒绝、也无任何树路径**，阳性对照落在上面那两个会话里；⑤ **闸门逻辑本身正确**：用该次真实 transcript + 真实载荷本地回放仓库版 `loop-gate.mjs`，第 6 次逐字相同调用即 deny（消息原文与契约 S15 一致），归属键不匹配时按 A4 放行（只少拦不误伤）；⑥ **换绑已实锤**（2026-11-12 客户端重启后首次活体探针）：阳性对照的拒绝原文里树路径为 `sha256-tree-v1-1212d9fa6672f239d3d6f2aedfb620c9efbe5e0ae59b071a5b89b9d8039255e6`（≠ 旧的 `31a958463…`），父会话直查该树确认 `scripts/loop-gate.mjs` 存在、`hooks.json` 5 个 PreToolUse 组 ⇒ **重启确实换到了新版树**。重启后闸门仍不拦，原因**不是**本条，而是 **D-91**（载荷与 transcript 的形态错位）。
- 状态：已复现 → **宿主侧行为已实锤（2026-11-12 客户端重启后活体验证）**：重启后活体树从 `31a958463…`（v0.5.7、无 `loop-gate.mjs`）**换成** `1212d9fa…`（v0.5.8、含 `loop-gate.mjs`、5 个 PreToolUse 组，父会话直查该树确认）⇒ **「升级后必须重启客户端才生效」从推断升级为已证事实**；宿主侧的绑定行为本仓库改不了（仍无免重启路径）→ **本仓库侧已做（v0.5.8）**：安装脚本、根 README、plugin README、CHANGELOG 四处均写明「升级后必须重启客户端」并给出用户可自证当前生效版本的办法（独立复验 AC3 实跑 `install.ps1` 确认输出逐字含「【必须重启 MiniMax Code 客户端才会生效】—— 不会自动生效。」）。**未修的只剩宿主侧绑定行为**。
- 修法方向：① `install.ps1` 装完必须输出「重启客户端后生效」并说明原因；② README 升级节补「重新安装 **并重启客户端**」两个动作 + 自证当前生效版本的办法；③ CHANGELOG 如实写明 v0.5.8 的活体拦截证据尚未取到、原因就是这条；④ 若宿主将来支持插件热重载，这几处需复核（不要写成永恒的平台事实）。**2026-11-12 复核补充**：宿主已存在 `enable/disable/refreshPlugins` RPC 与 `deactivateLocalPluginHooks` 回调（候选换绑入口），但**未实测**；若实测成立，这几处的「必须重启」需改为「必须换绑」，本条届时需同步复核。
- 还需要什么：**活体拦截证据**要在**客户端重启后**重跑探针才能取到（重启由用户在宿主侧完成，父会话无法代劳）；宿主**存在**「重新注册而不重启」的候选入口（2026-11-12 复核 `app.asar` 后修正本条，先前写「未找到可用入口」有误）：插件 RPC `POST /minimax-desktop/api/v1/plugins/:plugin_name/{disable,enable}` 与 `refreshPlugins`；停用会调用 `deactivateLocalPluginHooks(pluginName)`（`local-runtime-v2/dist/services.js:306`）摘掉旧绑定。**但本机实测桌面端没有对外 TCP 端口**（2026-11-12：11 个 MiniMax Code 进程经 netstat / Get-NetTCPConnection 全部无监听端口；本机其余 70 余个监听端口均与本宿主无关 —— 其中 node 持有的分属 kimi-search-proxy（127.0.0.1:8788）、WorkBuddy（:64627）等无关进程）⇒ 这套 HTTP 走 Electron IPC，外部脚本调不到，只能由人在插件界面点；**该路径未实测**，是否真能换绑待验证。**重启客户端这条确定路径已于 2026-11-12 实测通过**（活体树确实换到新版）。
- 来源：父会话本轮实测｜ 严重度：P1 ｜ 归属层：部署层

### D-89
- 触发条件：把工作**追加**到已有子会话（`task_append`）派工 —— 这恰是契约 S4.5 / RT-06 明确要求的**默认复用方式**（同一专项的连续工作不新开会话）。
- 影响：**追加轮在派工台账里完全没有记录**。① 台账是「谁被派了什么路径」的审计账，追加轮一条不记 ⇒ 事后复盘查不到这一轮的实际边界；② **冲突检测（闸门二：两轮 scope 重叠）对追加轮失明** —— 两个成员追加到各自会话、SCOPE 重叠时机制不拦；③ **名额提前释放**：追加轮开始前，上一轮的 `Subagent_stop` 已把原派工条目标成 `done`（实测 `dsp_mwchply1_trp9ic` 的 `ended_at=1794426018454`、`end_reason=subagent_stop`，而追加轮实际跑到 `1794427346380`）⇒ 父会话可以在成员还在干活时再派一轮同名成员，两边同时在飞、互相踩同一片 scope，而闸门看不见；④ **无法为追加轮预授权工作区外路径**：`scope-amend.mjs --dispatch --add` 要求「落在仍在飞的派工上」，追加轮没有派工记录 ⇒ 本轮想给验收方预加宿主目录只读权限**直接失败**（返回「派工 … 已结束（state=done）—— 事后再补权限没有意义」）。
  **诚实边界**：**名额与 TTL 的「不重复计数」不受影响** —— 原派工条目一直占位到 `Subagent_stop`，追加不会重复消耗名额；受影响的只是追加轮自身的留痕、冲突检测，以及追加轮期间原条目被提前关闭这件事。
- 复现步骤：① 父会话用 `task` 派一轮 → 台账新增一条 `dispatch_id`（agent / scope / state 齐）；② 同一专项 `task_append` 追加一轮（brief 含合规 SCOPE 行）→ **台账不新增任何行**；③ 追加轮期间若需读工作区外路径 → 被 guard 拦并自动记账，但**批准通道走不通**（`--dispatch --add` 找不到在飞的派工）。
- 证据（父会话 2026-11-12 实测）：① `plugin/hooks/hooks.json` 的 dispatch 组 matcher 为 `"task"`，而宿主对 MINIMAX 格式的 matcher 走**精确等值**（`alternatives.includes(value)`，非子串）⇒ `task_append` **不匹配** ⇒ dispatch.mjs 不被派发（与 D-87 同一族根因）；② **时间窗对照**：`task` 调用窗口我的记录 **1 条**；两个 `task_append` 窗口（`1794426400000~1794426520000`、`1794427350000~1794427600000`）我的记录 **0 条** —— 同窗内唯一一行属**另一个项目**（`Q:/小米手表远程控制插件`，父会话 `mvs_bfbdf0f…`）；父会话曾据此差点误判成「追加轮有记录」，是逐条打印 `parent_session_id` 后才排除的；③ 追加轮期间原派工条目被提前关闭（见「影响」第 ③ 条的 id 与时间戳）；④ 预授权失败实测（见「影响」第 ④ 条的返回原文）；⑤ **宿主侧载荷形态已确认（2026-11-12 父会话查 `app.asar` 源码）**：`task_append` 是独立工具（`node_modules/@mavis/agent-tools/dist/desktop/builtin-defs.js:544-556` 的 `LocalTaskAppendToolDef`，`name: 'task_append'`），入参 schema 只有两个字段 —— `task_id`（String，「The local task id to continue」）与 `content`（String）⇒ **载荷里没有任何 agent 身份**；`task_id` 是**宿主的本地后台任务 id**（`task` 工具回执里形如 `task_id="bg_…"` / `session_id="mvs_…"`）。
- 状态：已复现（**未修**）—— 修法见下，且**不宜只改 matcher**（追加载荷里没有 agent 身份）。
- 修法方向：dispatch 组 matcher 需覆盖 `task_append`（与 loop-gate 组补 `task_output|task_query|task_stop` 同一族修法；宿主对 MINIMAX 格式走**精确等值**，必须逐个列出）。但**不能只加 matcher** —— `task_append` 的载荷只有 `task_id` 与追加正文（见证据⑤，schema 级已确认），dispatch.mjs 不知道这一轮追加给了谁 ⇒ 需要另找身份来源。**首选解法（不动用户 brief 格式，2026-11-12 父会话查宿主源码后确定）**：① 新增一个 **PostToolUse 组**（matcher `task`）—— 宿主确认支持该事件，载荷含 `tool_name` / `tool_input` / `tool_response` / `tool_use_id`；从 `task` 调用的 `tool_response` 里解析宿主分配的 `task_id`，与 PreToolUse 阶段已知的 agent（由 brief 文本解析得到）**绑定写入派工台账**；② PreToolUse 收到 `task_append` 时，用 `tool_input.task_id` 反查台账 ⇒ 得到 agent + scope ⇒ **续期原派工条目**（把 `ended_at` 往后推）而不是另开一条 ⇒ 名额与 TTL **不重复计数**。**备选**（若 PostToolUse 路径不可用）：在追加正文里写一行机器可读的 `AGENT: <名字>` 由 dispatch.mjs 解析 —— 代价是要改派工格式，且旧格式 brief 需降级兜底。
- 还需要什么：**载荷形态已确认**（证据⑤，`task_append` ⇒ `tool_name='task_append'`、`tool_input={task_id, content}`、无 agent 身份）。仍需两件事：① 从 PostToolUse 的 `tool_response` 里**逐字确证**能解析到宿主分配的 `task_id`（本轮从 `task` 工具的返回文本看到过 `task_id="bg_…"`，但未从 hook 载荷逐字验证）；② 确认追加轮**续期原条目**的并发口径 —— 续期期间原条目的并发名额是否仍算 1（不得变成 2），这要写成断言。
- 来源：父会话本轮实测｜ 严重度：P1 ｜ 归属层：机制层

### D-90
- 触发条件：对台账做「明细段状态 vs 文末状态表」的一致性检查时 —— 或任何时候有人按状态表判断某条缺陷修没修。
- 影响：**台账自洽检查（`tools/ledger-check.mjs`）在结构上发现不了状态漂移**。它的第 ④ 项只比对「D 号集合」，**不比「状态文字」** ⇒ 明细段已写「已修」而状态表仍写「待修」的漂移**不会让任何检查报错**。实测存在这种漂移：D-37~D-41 五条明细写「已修（v0.5.6，待独立复验）」，而「五、v0.5.4 修复状态（2026-11-10）」那张表写「待修」—— 而 `ledger-check` 仍报六项全 PASS、exit 0。后果有两层：① 读者按状态表判断会误判（这几条其实修复轮已完成）；② 更要紧的是，将来真的发生状态漂移，**没有任何自动检查会拦下它** —— 这与本仓库一贯防的「静默失效」是同一族。
- 复现步骤：① 把某条缺陷的明细段「状态」改成「已修」，**不动**文末状态表对应行；② 跑 `node tools\ledger-check.mjs` → 仍报六项全 PASS、exit 0；③ 独立写解析器逐条比对明细状态与状态表状态文字 → 报出该条不一致。
- 证据：独立验收方（2026-11-12 第三轮复审）自写解析器，对**全部 93 个条目**做「明细段状态行 vs 文末状态表行」比对：结构层 93↔93 一一对应、无缺行、无重复、无多行冲突；语义层初筛 59 处差异 → 人工分类后真漂移 6 处（其中 5 条 D-37~D-41 属历史轮次快照表；另 4 条 D-06/D-08/D-15/D-17 同属 v0.5.0 历史表）⇒ **0 条是本轮回写引入的**，但正是这种「历史快照表不跟着更新」的形态证明该类漂移能长期存活而不被任何检查发现。验收方原话：「`ledger-check` 结构上无法发现『明细已修但表里还是待修』这类漂移 —— 这正是 D-88 那处矛盾能存活两轮的原因，属工具口径缺口」。
- 状态：已复现（**未修**）—— 本条是工具口径缺口，不影响既有六项检查各自的正确性（它们仍各自有效），但**六项全 PASS 不足以证明台账的状态口径一致**。
- 修法方向：① `tools/ledger-check.mjs` 增一项「明细段状态 vs 当前状态表状态文字」一致性检查（至少覆盖当前轮次的状态表）；② 或把历史轮次表**显式标注为时点快照**并在检查里识别标注过的表（跳过）；③ 两条都做最稳：标注解决读者误读，检查解决未来漂移。**注意**：加检查要动 `tools/ledger-check.mjs` 与 `tests/ledger-test.mjs`（23 条）与回归基线，需单独一轮并由独立验收方复验。
- 还需要什么：需要确认「当前轮次状态表」的可机器识别标记（现有表只有标题行，没有机器可读的字段）；需要父会话拍板走 ① 还是 ③。本轮父会话只做登记，**未改工具**（机制改造未获授权）。
- 来源：独立验收方实测（2026-11-12 第三轮复审，顺带普查发现）｜ 严重度：P2 ｜ 归属层：工具层

### D-91
- 触发条件：在 **PTC 模式**（本客户端默认形态：顶层只有一个 `run_code` 工具，它内部再调 `tools.<name>`）下运行 `R-LOOP-SAME-CALL` 闸门。
- 影响：**闸门在真实运行时恒不触发 —— 它永远数不出「连续相同调用」。** ① 宿主交给 hook 的载荷是**内层工具**：`node_modules/@mavis/agent-core/dist/pi-turn-runner/ptc-tool-executor.js:509` 的注释明写子调用的准入链是「PTC child policy, tool safety checks, **plugin PreToolUse hooks**, plan mode and the permission gate」，子调用记录的 `tool_name` 就是内层工具名（同文件 449 / 542 / 614 / 634 行）⇒ 载荷 `tool_name='bash'`、`tool_input={command}`；② 而 transcript 里 `message.content[]` 记的是**外层** `run_code`（`name='run_code'`、`arguments={code,description}`），内层调用记在 `message.details.ptc.child_calls[]`（`tool_name='bash'`、`input={command}`）；③ 闸门 `callsFromLines()` 只扫 `message.content[]` 的 toolCall ⇒ 它数出的指纹是 `run_code|<code>`，而载荷指纹是 `bash|<command>` ⇒ **两个命名空间永不相等 ⇒ 末尾连续数恒为 0 ⇒ 永不 deny**。
  实测表现：活体探针 **8+1 次逐字相同的 `run_code` 全部放行**，而同一会话里的阳性对照（scope 越界）**被正常拦下** ⇒ **派发链路是通的，坏的是闸门比对了不同命名空间的指纹**。这条把 D-86 的活体拦截从「宿主没换绑」推进到「闸门比错形态」——**离收口只差一处形态对齐**。
- 复现步骤：① 取一个 PTC 子会话的 `messages.jsonl`（内含 ≥5 次逐字相同的内层调用）；② 把 transcript 截断到第 5 次调用后；③ 用**内层形态**载荷（`tool_name='bash'`、`tool_input={command:'<那次的命令>'}`）喂 `plugin/scripts/loop-gate.mjs` ⇒ **ALLOW**；④ 换成**外层形态**载荷（`tool_name='run_code'`、`tool_input={code:'<那次的 code>'}`）喂同一脚本、同一 transcript ⇒ **DENY**（原文「你已经连续第 6 次发起**完全相同**的工具调用」）。差异不在闸门逻辑，在**载荷与 transcript 的形态配对**。
- 证据：父会话 2026-11-12 实测（客户端重启后首次活体探针，会话 `mvs_bc3dcca5de9b4f79adddce2d54982f40`，8+1 次逐字相同的顶层 `run_code`）：
  ① **活体树已换代、闸门代码确实已上场** —— 阳性对照的拒绝原文里树路径为 `sha256-tree-v1-1212d9fa6672f239d3d6f2aedfb620c9efbe5e0ae59b071a5b89b9d8039255e6`（旧的活体树是 `31a958463…` = v0.5.7）；父会话直查该树：`scripts/loop-gate.mjs` **存在**、`hooks.json` **5 个 PreToolUse 组**（含 loop-gate 组）⇒ 排除「树里没文件」这一解释；
  ② **形态实测** —— 该会话 `messages.jsonl` 里 `message.content[]` 的 toolCall 全是 `name='run_code'`、`arguments={code,description}`；`message.details.ptc.child_calls[]` 才是 `tool_name='bash'`、`input={command}`（24 个 toolResult 全部带 `child_calls`）；
  ③ **截断回放实验（决定性）** —— 截断到第 4 次 ⇒ 内层/外层载荷都 ALLOW；截断到第 5 次 ⇒ **外层载荷 DENY（第 6 次）**、**内层载荷 ALLOW**；
  ④ **宿主源码口径** —— `ptc-tool-executor.js:509` 的子调用准入链注释 + 子调用记录的 `tool_name`；
  ⑤ **为什么测试没抓到** —— `tests/loop-gate-test.mjs` 的夹具**两侧都用外层形态**（自造 `type:'toolCall'`+`arguments`）⇒ 37 条断言只能证明「解析器对自造形态成立」，**不能证明它认得真实运行时的形态**（与 D-90 同族的「夹具与真实形态不同源」）。
- **收尾轮（2026-11-12，sa-mechanism-fix 同一窗口，追加一轮）**：补上独立复审指出的两条**覆盖缺口** —— ① 「不可比边界」拆成 4 条断言（① 参数没落全⇒不可比⇒放行 / ② 打断连续段但不计入 / ③a 占位不得被丢弃 / ③b 哨兵表示不得被当成正常指纹）；② PTC 路径按「**择一 / 取内层 / 可比性**」三层各给**专属锚点**，使 M1/M6/M7 三种语义破坏**分别红不同的断言**（此前三种语义全红同一条，红/绿定位不了是哪层坏了）。套件 **44 → 54** 条；实现侧只加 `export` 与一个等价提取 `incomparableFp()`，**判定行为逐字未变**（哨兵字面量 `'\u0000incomparable:' + name` 与旧写法逐字一致）。**新夹具按真实 PTC 跨行交替形态派生**（实测真实 transcript「同一行同含外层+内层」= **0 行**，故不按同含形态造夹具；准确表述：**外层行逐字节取自真实 transcript，内层行按真实行结构与取值改写**，不是整份字节级复制 —— 复审第 5 轮 AC4 更正了「由真实字节派生」这个过宽的说法）。
- 状态：**已修（机制层；独立复审第 4 轮 PASS：AC1~AC8 全达成；收尾轮独立复审第 5 轮 PASS-with-conditions：AC1~AC6 全部达成判定）** —— 复审附带的 2 条覆盖缺口已**实证修补**：验收方自造 9 个语义变异体，**MISS = 0** —— 上一轮全绿的 M2/M4/M8 现分别被「不可比①」「不可比①」「不可比②+③a」钉住；PTC 三层（择一 / 取内层 / 可比性）各有**专属锚点**（M1/M6/M7 现红**不同**的断言，红点能定位断在哪一层）；既有 44 条断言**一条未删改**（逐条比对），8 个判定函数**逐字未变**（仅加 `export` 与等价提取 `incomparableFp()`，哨兵字面量 `' incomparable:' + name` 逐字一致）。**活体拦截证据仍未取到**（需装 + 重启客户端 + 重跑探针）。复审另留 6 条低severity记录项，其中 2 条为**文档数字/路径指错**（已派单修）、1 条为**性能断言负载敏感**（登记 D-93）、1 条为**夹具措辞需收窄**（本条已改）、1 条为**实现者自报 EXTRA-RED 条数与实测不符**（变异体定义未落盘 ⇒ 口径不可复现，已记入编排层教训）、1 条为**上一轮结论被转述失真**（父会话 brief 的问题，非实现者）。 —— 修法已落地（2026-11-12，sa-mechanism-fix 会话 `mvs_956275dd932d4e0690842458e840ed42`）：按载荷形态**择一**计数（`pickNamespace()` :345 决定数内层还是数外层），**内外两套序列绝不混数**（`callsFromLines()` :365 只取一套）；内层记录落盘参数是**子集** ⇒ 与载荷不可比时**打断连续段但不计入**（`innerComparable()` :321），宁可少拦不误伤。新增 `innerCallsOf()` :266 / `fingerprintKeySet()` :302；`callsFromLines()` :365 / `measureTrailing()` :398 / `main()` :427 改签名；`fingerprint()` :154 **逐字未改**（择一发生在**计数层**，不在指纹层）。
  **父会话独立复跑（2026-11-12，不采信执行者自述）**：`tests/loop-gate-test.mjs` **44 条断言全 PASS**（原 37 条）；全量回归 **14 套 / 897 条 / 0 FAIL**（loop-gate 套件 44 → **54** 条，见下「收尾轮」）；夹具 `tests/fixtures/d91-ptc-real-prefix.jsonl` 与真实 transcript **字节级前缀一致**（32239 B / 12 行，`raw.startsWith(fixture)=true`）；真实回放（`tests/d91-ptc-replay.mjs`，真实 transcript + 真实载荷）：内层 `bash` 连跑第 6 次 **DENY**、外层 `run_code` 第 6 次 **DENY**、逐字相同 `grep` 连跑 29 次仍 **ALLOW**（内层参数未落盘 ⇒ 不可比）、`glob` 段=4 不触发。
  **活体拦截证据仍未取到** —— 需 ① 把本修复安装进插件目录 → ② **重启 MiniMax Code 客户端**（D-88 已实锤「必须重启」）→ ③ 重跑活体探针（子会话 8 次逐字相同 + 阳性对照 + 金丝雀）。**机制回放通过 ≠ 活体已拦下**，两者不可互写。
- 修法方向：让**载荷与 transcript 取同一种形态**再比。① 计数侧改为**按载荷形态择一计数**：载荷是内层工具 ⇒ 数 `message.details.ptc.child_calls[]`（按 `tool_name`+`input` 归一）；载荷是外层 ⇒ 数 `message.content[]` 的 toolCall。**不能把两套序列混在一起数** —— 外层与内层在 transcript 里交替出现，混数会把连续段切碎，反而更拦不到。② 「改比外层」这条路走不通：宿主给的是内层载荷，hook 拿不到外层调用。③ 因此主修法是 ①，并且**必须新增一个「PTC 真实形态」的夹具**（从真实 `messages.jsonl` 取一段 `child_calls[]` 与 `content[]` 混合的样本），否则改完仍然测不出来。**边界**：非 PTC 模式（模型直接调工具）载荷与 transcript 同为外层形态，原逻辑仍成立 ⇒ **两种形态都要覆盖**。
- 还需要什么：需要确认宿主给 hook 的 `transcript_path` 在 PTC 模式下指向的就是这份 `messages.jsonl`（本轮实测该文件含 `SCOPE` 且 guard 能从中解析 brief，**强烈指向同一份**，但未从宿主源码逐字确证）；需要确认 `child_calls[]` 是否对**每一次**内层调用都完整落盘（本轮样本 24/24 全带，但样本量只有 1 个会话）。
- 来源：父会话本轮实测（客户端重启后首次活体探针 + 截断回放实验 + 宿主源码核对）｜ 严重度：P1 ｜ 归属层：机制层

### D-92
- 触发条件：父会话把**一个大项目**（同一族缺陷 / 同一批交付物 / 同一个验证目标）拆成十几个子步骤，并把每个子步骤当成独立的一单派出去 —— 每个子步骤一个新子会话 —— 而不是让一个窗口从头负责到底、子步骤在那个窗口内部完成。
- 影响：① **窗口数爆炸**：每个新窗口都要重读一遍方法论、契约、台账、相关脚本；② **上下文割裂**（比①更伤）：项目内部的步骤**共享同一批事实**，后一步的结论常常直接推翻前一步的假设，拆到不同窗口 ⇒ 每个窗口都**看不到上一步已经查出的事实** ⇒ 不只是慢，而是重复踩同一个坑；③ 各窗口彼此看不见 ⇒ 结论无法互相否证；④ 派工台账里这些子步骤互不关联 ⇒ 事后无法还原「这个项目到底做了什么」。
- 复现步骤（三条都是**协议与代码原文**，不依赖任何运行时行为）：① 读契约 S4.5 的复用判据 —— 判据是「**该成员是否已经读过本单要改的那些文件**」⇒ 只有**专项**与**文件**两个维度，**没有「项目」维度**；② 读 `references/scope.md` 的组队闸门 —— 「只算**写冲突**（条目相同，或一方是另一方的目录前缀）。读范围天然重叠，不算冲突」⇒ **只读类派工（探针 / 取证 / 审阅）永远不触发冲突闸门**；③ 读 `plugin/scripts/dispatch.mjs` 的复用提示实现（`:448` 起）—— 筛选条件是「该成员已有会话的 `binding.scope` **覆盖本单 SCOPE**」⇒ 读类派工的 SCOPE 天然覆盖多个会话 ⇒ 提示只会说「有 N 个会话覆盖本单 SCOPE」，**不指出该追加哪一个**。
  ⇒ 结论：**三道本该拦住它的关卡（复用判据、冲突闸门、复用提示）在「一个大项目内部的子步骤」这一形态上全部失效** ⇒ 「一个问题拆成十几个问题、十几个窗口」是协议的**结构性产物**，不是偶发失误。
- 证据：以上三条均为可逐字核对的原文（契约 S4.5、`scope.md` 组队闸门段、`dispatch.mjs:448-486` 的复用提示实现）；用户 2026-11-12 报告同一形态（「一个问题拆分成十几个问题，结果出了十几个窗口做程序修改」）。**本条不以任何窗口计数作为证据** —— 计数是现象，机制缺口才是缺陷。
- 状态：**已修（协议层）；程序层待做** —— ① 契约新增 **S4.6「派工粒度：一个项目一个窗口（项目级覆盖检查）」**：复用判据补第三维「**项目覆盖**」，明确「大项目 = 同一族缺陷 / 同一批交付物 / 同一个验证目标」，明确「**无专项 owner 的子步骤不得自成一窗**」，并写明诚实边界（这道规则**程序层拦不住**，只读类派工不触发冲突闸门）；② `SKILL.md` 铁律新增第 9 条「大项目一个窗口」+ 组队规则补「子步骤不开新窗」；③ `docs/audit/reuse-registry.md` 补「项目级覆盖」表（专项 / 文件 / 项目 三维，三个都答否才新开）。
- 修法方向：**程序层**（待派工 sa-mechanism-fix）：① 派工台账加**项目键**（brief 里带 `PROJECT:` 字段，或由专项 + 交付物族推导）⇒ 让「项目」成为**可机器读**的一等概念；② 派工回执在「同一项目已有在飞的派工」时给**指向性**提示（是哪个 `session_id`、边界是否覆盖），而不是只说「有 N 个会话覆盖」；③ 同一项目已有在飞派工且 SCOPE 重叠时**提示但不硬拦** —— 读类派工硬拦会误伤合法的并行取数。
- 还需要什么：需要确认「项目键」的来源（brief 里显式写 vs 由专项 + 交付物推导）；派工台账的 schema 一旦加字段，会与 **D-89**（追加轮续期原条目、不重复占名额）改到同一处 ⇒ 两条要在同一轮里对齐，别分两轮各改一次 schema。

- 来源：用户报告（2026-11-12）+ 协议与代码原文核对（父会话）｜ 严重度：P1 ｜ 归属层：机制层

### D-95
- 触发条件：写 v0.5.9 的 CHANGELOG 时，把「PTC 混合形态夹具」按**自己以为的形态**写进文档 —— 没有回头数真实 transcript 的行结构。
- 影响：**对外文档陈述了一个与事实相反的形态**，而且与**同一批产物的另外两处**（夹具生成脚本的自述、夹具文件本身的内容）**互相矛盾**。读者按 CHANGELOG 去理解「择一计数」的判据，会以为真实 transcript 里外层与内层**同行共存**（于是以为实现还得处理同一行里的两个命名空间）；而实现**只处理跨行交替**。这一族（D-91「注释宣称 ≠ 代码在做」）的文档版：**断言在、事实不在** —— 正是本仓库一路在防的静默失效。
- 复现步骤：① 打开 `plugin/CHANGELOG.md` 的 v0.5.9 段 ⇒ 原文写「PTC 真混合形态夹具（**同一行**同时含外层 `content[]` 与内层 `child_calls[]`）」；② 数真实 PTC transcript（`~/.minimax/v2/sessions/2026/11/12/00-04-02-355-session_bXZzX2JjM2RjY2E1ZGU5YjRmNzlhZGRkY2UyZDU0OTgyZjQw/messages.jsonl`，51 行）⇒ **仅外层 24 行 / 仅内层 24 行 / 同行同含 0 行 / 皆无 3 行**；③ 读 `tests/fixtures/d91-make-fixtures.mjs` 的自述 ⇒ 它自己写着同含形态「真实中不存在」；④ 读 `tests/fixtures/d91-ptc-same-line-mixed.jsonl` ⇒ **6 行全部同含**，且其**断言名**带「合成」标注。⇒ 四处对照，**三处与 CHANGELOG 矛盾**。
- 证据：独立复审方（2026-11-12，v0.5.9 发布产物独立复审，AC7）在复审中**主动发现**；父会话随后**独立复算**同一组数字（51 行 / 仅外层 24 / 仅内层 24 / 同含 0 / 皆无 3；两份主夹具同含行 = 0；合成夹具 6/6 同含）⇒ 与复审结论**逐项一致**，非转述。
- 状态：**已修（v0.5.9 发布前）** —— CHANGELOG 改为**跨行交替**的实话，并单列合成夹具的用途与「真实中不存在」的标注；两份 README 的相关表述同步；用户视角那句「它会被拦下来」收紧为「**按已坐实的判定逻辑**」并当场点出「活体拦截证据仍未取到」。
- 修法方向：**无需改代码** —— 机制本身是对的（实现按跨行交替处理，正是真实形态）；要补的是**发布前的自证动作**：任何写进对外文档的「形态 / 数量 / 条数」类断言，都要**当场从原始数据复算一遍**（本轮复审方与父会话各算一遍，才敢写）。
- 还需要什么：需要一条**自动化断言**把「文档口径与原始数据不符」这类漂移挡住（候选：从真实 transcript 现算「同含行数」并与文档里写的数字对账）—— 但这会动 `tests/`，**留到下一轮**（与 D-94「版本号四处一致无断言」同属「文档口径无自动化守护」族）。

- 来源：v0.5.9 发布独立复审实测（2026-11-12，复审方主动发现；父会话独立复算确认）｜ 严重度：P2 ｜ 归属层：契约层

### D-96
- 触发条件：往台账的**索引表**里追加一条**说明很长**的条目时，为了控制单行长度而把它**折成两行**（第一行写「`| D-9x | ... |`」，第二行写续文）—— 而续行**不以 `|` 收尾**，于是它在 markdown 与解析器眼里都**不是表格行**。
- 影响：① **索引表从中间断成两块** ⇒ `tools/ledger-check.mjs` 的 `blocks.find(b => splitRow(b.block[0])[0] === '台账编号')` **只认第一块** ⇒ 「index」集合**看不见**被折行之后的所有条目（D-91 的续行之后是 D-94 / D-93 / D-92 / D-95）；② 统计行写着「总计 N 条」，而工具能看到的索引行数**与它对不上**（实测 index 95 / detail 99 / status 96，统计行称 98）⇒ 账的**自证口径本身失效**；③ 这张表在 markdown 渲染里也是散的（续行会掉出表格）。**归族**：D-90 的同族 —— 「结构层失真让状态口径漂移不被发现」；本条更靠前一步：**结构先坏，口径才会漂**。
- 复现步骤：① 看 `docs/audit/defect-ledger.md` 的索引表：D-91 / D-93 / D-92 三行的第 5 格各被拆到**下一个物理行**；② 跑 `node tools/ledger-check.mjs` ⇒ `sets-equal` 报 7 处：index 缺 D-92 / D-93 / D-94 / D-95，status 缺 D-91 / D-93 / D-94；③ 看摘要行 `indexRows: 95, detailCount: 99, statusUnion: 96` ⇒ 三个集合**互不相等**；④ 把三条续行并回上一行 ⇒ 索引表恢复成**一个连续块**，六项检查**全 PASS**。
- 证据：本轮父会话在 v0.5.9 发布前跑 `ledger-check` 时**当场撞上**（第一次报「7 处不自洽」）；用独立诊断脚本 `tableBlocks()` 复算块边界，确认断裂点在 D-91 续行处。**折行本身是更早几轮登记 D-86~D-94 时引入的**（那几轮未重跑 `ledger-check`）。
- 状态：**已修（v0.5.9 发布前）** —— D-91 / D-93 / D-92 三条索引行**合并回单行**并补上收尾竖线，索引表恢复为**一个连续块**；统计口径随之更新为 **100 条**（P0 11 / P1 41 / P2 34 / P3 14）。
- 修法方向：① **写法**：索引表每条**必须单行**，长说明**不许折行**（宁可缩短措辞）；② **工具**：`ledger-check` 可增一条「索引表必须**只有一个连续块**」的检查（现在 `blocks.find()` 只取第一块 ⇒ 第二块里的条目对它**不存在**）；③ 两条都做。
- 还需要什么：第 ② 条要动 `tools/ledger-check.mjs` 与 `tests/ledger-test.mjs`，**留到下一轮**（与 D-90「不比状态文字」、D-94「版本号无断言」同属工具层待做）。
- 来源：父会话本轮实测（2026-11-12，v0.5.9 发布前跑 `ledger-check` 时撞上并用独立诊断脚本复算块边界）｜ 严重度：P2 ｜ 归属层：契约层

### D-97
- 触发条件：插件的 PreToolUse hook 靠宿主在载荷里给的 `transcript_path` 去读「本子会话的调用历史」—— 而宿主给的**不是会话的 `messages.jsonl`**，而是 `%TEMP%/minimax-plugin-hooks/transcripts/<sha256(sessionId).slice(0,32)>.compatible.jsonl`（**Claude 兼容投影**；宿主 `app.asar` 里 `@mavis/agent-tools` 的 `PluginHookTranscript.create()` / `pluginHookTranscriptPaths()` 即其落点）。
- 影响：`loop-gate.mjs` 的解析器只认两种形态 —— 外层 `message.content[].type==='toolCall'`+`arguments`，以及内层 `message.details.ptc.child_calls[]`。而**兼容投影里两者都没有**：无 `details.ptc.child_calls[]`（PTC 内层调用在投影中**不可见**），tool call 是 Claude 形态的 `type:'tool_use'`+`input` ⇒ 实测 `callsFromLines()` 在活体文件上 **owned = 0**（同一子会话的 `messages.jsonl` 上 owned = 8）⇒ 末尾连续数恒为 0 ⇒ **闸门在真实运行时永不触发**。**归族**：D-91 同族（「注释/夹具宣称 ≠ 代码在做」），但更靠前一步 —— **夹具取样的文件不是运行时真正被读的那份**。
- 复现步骤：① 装 v0.5.9 + 重启客户端 ⇒ 缓存树换绑为 `sha256-tree-v1-6a84c9cb…`（含 D-91 修复标记，与仓库 `plugin/` 逐字节一致）；② 全新子会话里连发 6 次逐字相同的内层 `tools.bash` ⇒ **全部放行**（第 6 次未被拦）；③ 同子会话发一条**裸绝对路径 token** 的越界命令 ⇒ **被 guard 当场拦下**，拒绝原文带出活体树路径 `…sha256-tree-v1-6a84c9cb…` ⇒ hook 链活着、树已换绑，只是**闸门这一支不判定**；④ 读 `%TEMP%/minimax-plugin-hooks/transcripts/<sha256(sessionId).slice(0,32)>.compatible.jsonl` ⇒ `child_calls` **0 处**、tool call 是 `tool_use`/`input`；⑤ 用它喂 `loop-gate.mjs` ⇒ stdout 空（放行）；⑥ 换成会话 `messages.jsonl` 并按「截断回放」法截到第 5 次探针结果 ⇒ **DENY**（`[规则 R-LOOP-SAME-CALL] … 连续第 6 次…`）。
- 证据：父会话 2026-11-12 实测（v0.5.9 装好 + 用户重启客户端后）：① 缓存树 `6a84c9cb…`（14:58:39 物化，`loop-gate.mjs` 28532 B，含 `pickNamespace`/`incomparableFp`/`innerComparable`）与仓库 `plugin/` **逐字节一致**；② 全新子会话 `mvs_25951e5b…` 的阳性对照被拦（`PTC_TOOL_BLOCKED` + `[super-agent-router] 越界拦截…` + 活体树路径）；③ 该子会话 6 次逐字相同调用全放行，其 transcript 的 `details.ptc.child_calls[]` 里 8 条内层调用 `status` 全为 `completed`、`retained_facts` 全空；④ 宿主源码证明 hook 的 `transcript_path` = 兼容投影文件；⑤ 三份文件同一解析器实测：兼容投影 **owned=0** / 会话 messages **owned=8** / codex 投影 **owned=0**；⑥ 仓库夹具 `tests/fixtures/d91-ptc-real-prefix.jsonl` 形态**同会话 messages**（含 `child_calls`+`toolCall`）⇒ **夹具与运行时形态不同源**。
- 状态：**已复现（未修）** —— D-91 的修法方向（择一计数）本身正确（截断回放已能 DENY），错在**输入文件取错**。
- 修法方向（候选，**未实施**）：① **解析两种 transcript 形态**（兼容投影的 `tool_use`/`input` + 会话 messages 的 `toolCall`/`arguments` + `details.ptc.child_calls[]`）；② **取对文件**：优先按 `session_id` 定位会话的 `messages.jsonl`（那里才有 PTC 内层记录），取不到再回退到载荷给的 `transcript_path`；③ **夹具换成运行时真正被读的那份**（逐字节取样 `%TEMP%/…/*.compatible.jsonl` 落盘进 `tests/fixtures/`），并加断言钉住「兼容投影下 owned 必须 > 0」；④ 投影里**没有**内层调用 ⇒ 内层计数在投影上**原理上不可得** ⇒ 还需先定口径：PTC 形态下以**外层 `run_code`** 为计数单元（投影里有），并把「内层 payload vs 外层调用」的指纹对齐规则写死（不可比即打断不计，沿用既有方向）。
- 还需要什么：④ 属**机制设计取舍**（外层计数 vs 内层计数），需先定口径再动手；修完必须**再取一次活体拦截证据**（重启 + 全新子会话 + 6 连发 + 阳性对照 + 金丝雀），并由独立验收方复验。**是否开这一轮、版本号取什么，由用户拍板**（本轮不代排）。
- 来源：父会话活体实测（2026-11-12，v0.5.9 装好 + 用户重启客户端后重跑探针；含宿主 `app.asar` 源码取证）｜ 严重度：P1 ｜ 归属层：机制层

### D-98
- 触发条件：客户端**重启**之后，**继续使用重启前就存在的子会话**（续接/追加）去调工具。
- 影响：插件 PreToolUse 的**两道闸门都不生效** —— ① guard（越界管控）：工作区之外的写**当场放行**（实测 `echo C:/Users/yang2/AppData/Local/Temp/sar-v059-chain-alive.txt` 原样执行）；② loop-gate（无进展重复调用闸门）：同样不拦。**同一时刻新建的子会话两道都正常**（越界写被当场拦下，`PTC_TOOL_BLOCKED` + 拒绝原文带出活体缓存树路径）。⇒ **升级并重启后，用户已有子会话的越界管控会「看起来失效」** —— 与 D-91/D-97 同族：**静默失效，不报错、不留痕**。
- 复现步骤：① 装 v0.5.9 + 重启客户端；② 在**重启前就存在的子会话**里追加一轮：发一条**裸绝对路径 token** 的越界命令（如 `echo C:/Users/yang2/AppData/Local/Temp/xxx.txt`）⇒ **被放行**；③ 在**新建的子会话**里发**逐字相同**的命令 ⇒ **被拦下**（`PTC_TOOL_BLOCKED` + `[super-agent-router] 越界拦截：…`）；④ 本地用同一份绑定回放：把两个会话的 `session_id` 分别喂给缓存树里的 `guard.mjs`（带 `PLUGIN_DATA`）⇒ **两者都 deny**，拒绝原文逐字相同 ⇒ 插件侧逻辑无差别。
- 证据：父会话 2026-11-12 实测（v0.5.9 装好 + 用户重启客户端后）：① 续接会话 `mvs_bc3dcca5…` 的第 3 轮探针（`bg_22175fd7`）里，**裸绝对路径 token** 形态的阳性对照**被放行**（`out` 是 echo 的正常 stdout）；② 全新会话 `mvs_25951e5b…` 的第 4 轮探针（`bg_fa9dc259`）里，**同一形态**的阳性对照**被拦下**，`err.code=PTC_TOOL_BLOCKED`，原文含活体树 `sha256-tree-v1-6a84c9cb…`；③ 用缓存树里的 `guard.mjs` 本地回放这两个 `session_id` ⇒ **两个都 deny**（待审清单 request id 不同，判定文本逐字相同）；④ 同一会话 `mvs_bc3dcca5…` 在**重启前**（`bg_7a891c21`）的阳性对照**是被拦的** ⇒ 差异的变量是「客户端重启 + 会话是否新建」，不是绑定内容。
- 状态：**已复现（宿主侧不可修）** —— 插件侧无可改之处（回放证明判定一致）；**本仓库侧要做的**是：① 把「活体验证必须用全新子会话」写进本项目的验证纪律（探针 brief 一律要求新建子会话，不许用续接会话当活体证据）；② 对外文档如实交代这条宿主边界（**不许**写成「装上就全程受保护」）。
- 修法方向（宿主侧，**本仓库不可修**）：宿主在客户端重启后给**续接**子会话派发 plugin PreToolUse 时，要么没派发，要么载荷缺 `agent_type`（hook 侧对无 `agent_type` 一律按父会话放行）⇒ 需要宿主侧保证：重启后**恢复子会话的 hook 派发**并带上 `agent_type`。**可报给宿主侧**（本仓库只留证据与操作规则）。
- 还需要什么：宿主侧行为需要独立复现确认（本条证据是本机一次对照）；本仓库侧不排期实现，只落纪律与诚实边界。
- 来源：父会话活体实测（2026-11-12，v0.5.9 装好 + 用户重启客户端后的「续接会话 vs 全新会话」对照）｜ 严重度：P1 ｜ 归属层：宿主侧

### D-93
- 触发条件：在**并发负载**下跑变异体矩阵（多个变异副本同时跑套件）。
- 影响：**性能断言负载敏感** ⇒ 会往矩阵里注入**与语义无关的红点**（实测并发时 `ms=2921` 触发 `< 2000ms` 的性能断言红，空闲复测 78~96ms）⇒ 矩阵结论被污染（多红报 EXTRA-RED 时要人工排除这条噪声，MISS 判定也可能被干扰）。**这是 D-86 的老断言，不是 D-91 本轮新增**。
- 复现步骤：① 造一个 20MB transcript 的性能断言场景；② 在机器有并发负载时跑（另一套件同时在跑）⇒ 耗时涨到 2921ms；③ 空闲时复跑 ⇒ 78~96ms，断言绿；④ 同一语义变异体在两种负载下红点条数不同（并发多出 1 条性能红）。
- 证据：D-91 收尾轮独立复审（2026-11-12 第 5 轮）实测：矩阵并发时 M5 多出性能断言红（ms=2921）；空闲复测 ORIGINAL 3 次 0 FAIL（PERF 78 / 81 / 94ms）、M5 2 次 fail=3 且 PERF 96 / 92ms ⇒ 定性为**负载型假红**，与语义无关。
- 状态：已复现（**未修** —— 待派 sa-mechanism-fix，同一窗口下一轮）
- 修法方向：性能类断言必须**抗负载** —— 同一条件下**重复采样取最小值**（min-of-N）而不是单次采样；或与同进程内的小规模基线做相对比较。**不要**简单抬高阈值（那会把「秒级」这个保证一起放松）。另：变异体矩阵**不应并发跑**（它是串行语义验证，不是压测）。
- 还需要什么：需要确认 min-of-N 的 N 取值与采样成本；需要确认抗噪后 2000ms 阈值是否仍有意义。
- 来源：独立复审方（2026-11-12 第 5 轮复审，清单外问题第 3 条）｜ 严重度：P3 ｜ 归属层：工具层

### D-94
- 触发条件：升版时改了 `plugin/.minimax-plugin/plugin.json` 的 `version`，但没有同步 `plugin/CHANGELOG.md` / `plugin/README.md` / 根 `README.md` 里的版本字面量。
- 影响：**四处版本号会分叉** ⇒ 用户按 README 装的版本与自己以为的不一致；且发布流程**没有任何自动化断言**会报错 —— 这类漂移只能靠人眼发现。
- 复现步骤：① 只改 `plugin/.minimax-plugin/plugin.json` 的 `version`；② 跑 `tools/install-selftest/check-readme-consistency.mjs` ⇒ **PASS 131 / FAIL 0**（不报）；③ 手工 grep 三处文档 ⇒ 版本号仍是旧值。
- 证据：父会话 2026-11-12 实测 v0.5.9 发布产物 —— `tools/install-selftest/check-readme-consistency.mjs:31-32` 为 `const SRC_VERSION = String(manifest.version);` + `console.log('[版本] ' + SRC_VERSION);`，**`SRC_VERSION` 全文件只出现在这两行、从未参与任何判定**（同目录 `verify-seed.mjs:119` 只断言「安装副本 plugin.json 与源一致」，**不覆盖**文档里的版本字面量）。同轮实测：根 README 的「7 个 handler / 13 个脚本」**在本单之前就已漂移**（实际 8 / 14），发布前靠人工发现并修正。
- 状态：已复现（**未修** —— 要动 `tools/install-selftest/`，需单独一轮并由独立验收方复验）
- 修法方向：把「四处版本号全等」做成**常驻断言**（失败即非零退出）；顺带把 README 里那类**目录结构数字**（handler 数 / 脚本数）也纳入自动核对 —— 这两处漂移**已经真实发生过**，说明缺口不是理论问题。断言位置待定（`check-readme-consistency.mjs` 还是 `install-selftest/run-all.ps1`），且须保证**版本未变时也能跑**（每次回归都跑）。
- 还需要什么：需要确认断言的落点与「版本未变时也执行」的口径；需要确认改完后 `install-selftest` 的条数基线（现 6 套件 / 294 条 + 8 条对账）怎么变。
- 来源：v0.5.9 发布侧实测（父会话自行核 `SRC_VERSION` 只出现在 31/32 行）｜ 严重度：P3 ｜ 归属层：工具层

---

## 四、归属层分布与修复顺序建议

- P0/机制层：5 条
- P1/契约层：4 条
- P1/机制层：7 条
- P2/契约层：5 条
- P2/机制层：3 条

建议顺序：① 先清 P0 的 5 条静默放行（边界不报错 = 边界不存在）；② 再修 P1 中让「教训前置」真正生效的那条（CF-03）与让履历不可伪造的那条（RG-11）；③ 契约层统一为单一事实源（模板、编号命名空间、验收标准与产出标准必须同源）；④ P2 逐条消噪。

**未验证项**：所有「已复现」均为静态推演 + 活体探针，未实跑被审计脚本；安装目录与运行时缓存副本与仓库副本已比对确认逐字节一致（11/11 脚本），故「审计对象 ≠ 运行时对象」这一残留风险已排除。
---

### D-25
- 触发条件：worker 在 bash 命令里夹带账号级或对外可见的不可逆动作，且命令里**同时**含一个 scope 内的路径 token（让「取不到目标即 deny」这条规则不生效）。典型命令：`echo x >> .superagent/STATUS.md && mavis agent delete sa-victim`。
- 影响：**worker 可以绕过护栏删除账号级成员**（`mavis agent delete`）、改写成员（`mavis agent update`）、触发部署或 Mini App 发布。`mavis` 是本机真实存在的 CLI，命令文本会被 shell 真的执行 —— 这不是理论风险，是可执行的账号级不可逆动作。根因：`lib.mjs` 的 `DANGEROUS_COMMAND` 只覆盖固定几个对外命令（`git push`/`npm publish`/`docker push`/`terraform apply`/`kubectl apply`/`gh pr create`），不含账号级动作；而 `guard.mjs` 的 `dangerousByArgs` 只按**工具名 + 参数**判定（`mavis` 工具、`miniapp` 工具），bash 是自由文本命令，走不到那条分支。
- 复现步骤：用假 `PLUGIN_DATA` + 真 transcript 驱动**仓库版** `plugin/scripts/guard.mjs`（scope = `.superagent/STATUS.md`），喂合成 PreToolUse 载荷：① `bash` + `command="echo x >> .superagent/STATUS.md && mavis agent delete sa-victim"` → **ALLOW**；② `bash` + `command="mavis agent delete sa-victim"`（无路径 token）→ **ALLOW**；③ 对照组 `bash` + `command="echo x >> .superagent/STATUS.md && git push"` → **DENY**（`DANGEROUS_COMMAND` 生效）；④ `bash` + `mavis agent update` → **ALLOW**；⑤ `bash` + `website_deploy` → **ALLOW**；⑥ `bash` + 普通命令 `echo x >> .superagent/STATUS.md` → **ALLOW**（对照组，必须仍然放行）。
- 证据：活体探针输出逐行 —— `PROBE|P1-bash-in-scope-plus-agent-delete|ALLOW`、`PROBE|P2-bash-agent-delete-only|ALLOW`、`PROBE|P3-bash-in-scope-plus-git-push|DENY`、`PROBE|P4-bash-in-scope-plus-agent-update|ALLOW`、`PROBE|P5-bash-in-scope-plus-website-deploy|ALLOW`、`PROBE|P6-runcode-agent-delete|DENY`、`PROBE|P7-bash-in-scope-harmless|ALLOW`。探针工装：`C:/Users/yang2/AppData/Local/Temp/sar-probe-bash/probe.mjs`（假 PLUGIN_DATA + 真 transcript，驱动仓库版 guard）。**注意 P6**：机制层的复合判定对同一动作是 DENY 的 —— 判定逻辑本身没错，是**触发链路**没走到（见 D-26）。
- 状态：已复现
- 修法方向：bash 通道的危险判定必须按**命令形态**识别（CLI + 子命令 + 动作，如 `mavis agent delete` / `mavis agent update`），不能用「见到 delete 就拦」这种词匹配 —— 那会误伤 `rm build/out.txt` 这类普通路径操作；同时必须保留只读命令分流（`ls`/`cat`/`git log` 仍按读判定）。契约侧已在 S3 新增「bash 通道的危险操作形态」条款、S5.3 补「同一份清单必须在 bash 通道同样生效」。
- 还需要什么：无 —— 复现不依赖平台派发行为，纯机制层即可判定。
- 来源：v0.5.0 独立复验收尾时的运行时取证 ｜ 严重度：P0 ｜ 归属层：机制层

### D-26
- 触发条件：**把一次阴性观察写成了平台恒定事实** —— 2026-11-10 10:22 的子会话里外层 `run_code` 没被派发，据此判定「平台不对容器调用派发 PreToolUse」，并把这条写进了契约 S3、`scope.md`、README 与 RT-04。
- 影响：结论方向错了 —— 平台**会**为容器调用派发（14:29 与 15:10 的子会话实测当场 DENY），只是**派发与否随会话而变**。写错比没写更坏：文档把复合层标成「预留防线 / 当前不生效」，后人据此不再维护它；更严重的是它把「判定落在内层」这条正确的处置说成了「因为平台不派发所以不得不落内层」—— 依据错了，结论侥幸对，将来平台一旦统一派发或统一不派发，这套文档都会误导。
- 复现步骤：① **阴性样本**（2026-11-10 10:22，子会话 `mvs_b0accaba…`）：给活动 hook 树的 `scripts/guard.mjs` 装一行临时日志（把 `readStdin()` 收到的原始载荷追加到日志文件），并同步到安装副本（运行时从安装副本物化新树）；开一个新子会话，只做一次 `run_code` 调用（`return { probe: 'container-dispatch-check', n: 1 + 1 }`）与一次 `read` 调用；读日志 —— **只有 `read` 有条目，外层 `run_code` 没有任何条目**。② **金丝雀样本**（2026-11-10 15:10，子会话 `mvs_355c229f…`）：同一形状的调用，外层代码里放一个危险字符串常量（`const note = 'mavis agent delete';`）→ **被拒**，原文「[super-agent-router] 已拦截：在复合调用里执行了 agent delete（删除成员是账号级不可逆操作）。…」；纯计算对照组（`return { probe: 'canary-control', n: 1 + 1 }`）→ 放行。③ 14:29 的子会话 `mvs_20e67557…` 独立复现同一形态一次（拒绝原文逐字一致）。
- 证据：探针日志 `C:/Users/yang2/AppData/Local/Temp/sar-hook-log.jsonl` 条目分布 = `write 1 / bash 2 / read 1`，**无 run_code**（其中 read 条目来自探针子会话的容器内子调用，证明日志探针在该会话内正常工作）—— 这条阴性观察本身可信；反证来自运行时 transcript：会话 `mvs_20e67557…`（2026-11-10T06:29:58Z）与金丝雀复测会话 `mvs_355c229f…`（2026-11-10 15:10）的 `run_code` 工具结果里都带着**本插件自己的**拒绝原文，而该原文只可能由 `guard.mjs` 的 `tool_name === 'run_code'` 分支产生 ⇒ 平台确实派发了容器事件。缓存树逐棵核对：`run_code` 是 2026-11-10 08:19 才进入 matcher 的，11/9 物化的 60 棵树全部没有它，11/10 08:11 之后物化的树全部有。
- 状态：**已证伪并更正**（原结论「平台不派发」作废，改为「派发随会话而变」）
- 修法方向：文档四处同步更正 —— 契约 S3「容器调用的派发事实」、`references/scope.md` 复合工具章节的运行时事实注、`.superagent/lessons/_router.md` RT-04、`.superagent/STATUS.md` 的 v0.5.0 收尾段。处置不变但理由要改对：**(1) 危险操作与作用域的判定必须落在内层通道**（D-25 的修法）—— 理由不再是「平台不派发所以没办法」，而是「派发不可靠，不能当唯一防线」；**(2) `run_code` matcher 条目保留** —— 它在派发到的会话里确实生效；**(3) `mavis` 条目保留** —— 普通工具调用实测稳定被派发并判定。
- 还需要什么：需要把「哪个会话会被派发」钉到具体机制上 —— 已确认 `run_code` 于 08:19 才进 matcher、11/9 物化的 60 棵树都没有它（已逐棵核对），**推断**是 matcher 取自会话绑定的缓存树，因此老会话不派发、新会话派发；这一推断尚未逐棵验证，会影响「老会话里的 worker 到底有没有复合层保护」的判断。另外需要平台侧确认载荷里的代码字段名（当前机制读 `tool_input.code` / `program` / `script`）。
- 来源：v0.5.0 独立复验收尾时的运行时取证（**该结论已在本轮被证伪并更正**）｜ 严重度：P0（原判 P1 —— 它让整层防护的维护状态被误标）｜ 归属层：运行时事实（+ 文档）

### D-25b
- 触发条件：bash 命令用**带布尔开关的包装器**执行危险动作 —— `sudo -n mavis agent delete sa-x`、`env -i mavis agent delete sa-x`、`timeout 5 mavis agent delete sa-x`、`powershell -Command mavis agent delete sa-x`（未加引号）。
- 影响：D-25 的洞没被完全堵住 —— 这四条形态仍然 **ALLOW**，账号级成员删除可经包装器绕过。根因三处：① `lib.mjs` 的 `WRAPPER_VALUE_FLAGS` 把 `-n/-i/-e/-l/-s/-h/-d/-o` 一律当「带独立取值的开关」吞掉后一个 token，而 `sudo -n`、`env -i` 是**布尔开关不带值** —— 真正的命令词（`mavis`）被吞掉，命令位置找不到它；② `COMMAND_WRAPPERS` 是闭集，漏了 `timeout`、`powershell`/`pwsh`、`cmd /c`、`stdbuf`、`ionice` 等；③ `powershell -Command` 后面的整段没有被当作内层命令再判一次。
- 复现步骤：用假 PLUGIN_DATA + 真 transcript 驱动仓库版 guard（scope = `.superagent/STATUS.md`），喂上述四条合成 bash 载荷 → 观察 verdict 为 ALLOW（应为 DENY）。
- 证据：独立 verifier 复验（D-25 收窄单）实测：`sudo -n mavis agent delete sa-x`、`env -i mavis agent delete sa-x`、`timeout 5 mavis agent delete sa-x`、`powershell -Command mavis agent delete sa-x` 全部 ALLOW。对照：同一轮里 `sudo mavis agent delete`（无开关）、`env FOO=1 mavis agent delete`、`sh -c "mavis agent delete"`、`cat $(mavis agent delete)` 等 10 条包装形态全部 DENY。verifier 另注：`sudo`/`env`/`timeout`/`powershell` 在本机均存在（`mavis` 本身不在 PATH，但**判定层洞成立**，与 D-25 同一威胁模型）。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：带值开关改成**按包装器分别定义**（布尔开关不吞 token；只有 `sudo -u/-g/-p/-C/-r/-t`、`env -u/--unset/-C/--chdir` 这类真带值开关才吞）；`timeout` 的时长按**位置参数**处理；包装器集合补齐 `timeout`、`powershell`/`pwsh`、`cmd /c`、`stdbuf`、`ionice`、`setsid` 等；`powershell -Command`/`-c` 之后的整段按**内层命令**再判一次。查表不得一律小写化（`sudo -H` 与 `sudo -h` 语义不同）；认不出的开关按「宁可多判不可漏判」处理。
- 还需要什么：无 —— 判定层可独立验证，不需要真实执行这些命令。
- 来源：D-25 独立复验的残余发现 ｜ 严重度：P0 ｜ 归属层：机制层

### D-25c
- 触发条件：bash 命令形如 `mavis list agent delete` —— `agent` 不是 `mavis` 之后的**第一个**子命令，却因为「`mavis` 后面出现 `agent delete`」而被判成危险动作。
- 影响：**过度拦**。正常运维命令（先列再删的复合写法、`mavis agent list` 之类）被误判为账号级不可逆操作并拒答 —— 护栏误伤会让 worker 无路可走，最终绕过护栏（这正是上一轮 `run_code` 复合层误伤的教训）。
- 复现步骤：喂合成 bash 载荷 `mavis list agent delete` → 观察 verdict 为 DENY（应为 ALLOW）。
- 证据：独立 verifier 复验实测：`mavis list agent delete` 被拦；对照组 `mavis agent list` 未被拦（说明命中的是「`agent` 子命令非位置匹配」而不是别的分支）。verifier 措辞原文：「`mavis list agent delete` 被拦（`agent` 子命令非位置匹配，过度拦）」。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：`agent` 必须是 `mavis` 之后的**第一个**子命令才算 `mavis agent delete` / `mavis agent update`；位置之后的 `agent` 不构成危险形态。
- 还需要什么：无。
- 来源：D-25 独立复验的残余发现 ｜ 严重度：P1 ｜ 归属层：机制层

### D-25d
- 触发条件：bash 命令用**闭集包装器名单之外**的启动器执行危险动作 —— `exec mavis agent delete sa-x`、`taskset 0 mavis agent delete sa-x`、`watch -c mavis agent delete sa-x`、`at now mavis agent delete sa-x`、`parallel mavis agent delete sa-x`、`script -q -c "…" mavis`、`chroot . mavis agent delete sa-x`、`strace -f mavis agent delete sa-x` 等 17 条形态。
- 影响：账号级成员删除仍可绕过护栏。**根因不是漏了一个 `exec`** —— 是「命令位置」用**闭集包装器名单**实现：名单外的启动器被当成命令本身，后续 token 全部不再参与判定。补 10 个名字，下一个变体照样漏 —— 这是**结构性缺口**，也是 D-25b 的同根因族。
- 复现步骤：喂上述形态的合成 bash 载荷 → 观察 verdict 为 ALLOW（应为 DENY）。
- 证据：独立 verifier 实测 17 条形态全部 ALLOW；verifier 定位到 `plugin/scripts/lib.mjs` 的 `WRAPPER_SPECS`（14 键）与 `SHELL_PAYLOADS` 两张闭集表，`exec` 未列入（同类的 `command`/`builtin` 却列了）。本机 `mavis` 不在 PATH，未实际删成员，但**判定层洞成立**。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：**命令位置不再用闭集名单实现**，改为「数据段 / 执行段」二分 —— 段首命中**数据命令清单** → 段内其余 token 与引号内内容皆为数据；段首不是数据命令 → 段内**每个 token 都是命令候选**。由此 `exec` 及任何将来出现的包装器自动被覆盖。数据命令清单要尽量完整，但**不得收 `tar`/`unzip`/`zip`/`gzip`**（`--to-command` 会真执行，收进来等于开盲区）。另补启动器形态：`npx`/`bunx`、`npm`/`pnpm exec|dlx`、`yarn dlx` 之后的**首个程序参数**按命令位置判定。
- 还需要什么：无。
- 来源：D-25 残余闭环复验 ｜ 严重度：P0 ｜ 归属层：机制层

### D-25e
- 触发条件：bash 命令形态被**过度拦** —— ① `sh -c mavis agent delete sa-x`（**未加引号**）；② `command -v mavis agent delete sa-x`。
- 影响：护栏误伤。① 按 POSIX，`sh -c <string> [name [args...]]` —— `command_string` 只有 `mavis` 一个词，`agent delete sa-x` 是 `$0`/`$1` 位置参数，**执行的是没有子命令的 `mavis`**，不该按 `mavis agent delete` 拦；② `command -v` 是**查询**语义（打印命令路径），不执行任何东西，更不该拦。误伤会让 worker 无路可走，最终绕过护栏 —— 与上一轮 `run_code` 复合层误伤同源。
- 复现步骤：喂上述两条合成 bash 载荷 → 观察 verdict 为 DENY（应为 ALLOW）。
- 证据：独立 verifier 实测两条均被拦；verifier 定位根因：`lib.mjs:991` 的 `positions.push(fi + 1)` 把**载荷下标漏进外层位置表**；`lib.mjs:861` 把 `command` 的 `-v` 当普通 bool 开关。对照：`sh -c "mavis agent delete sa-x"`（带引号，单个 token 内含空格，整个 token 就是命令）**必须拦**。
- 状态：已修复（v0.5.0 内闭环）
- 修法方向：载荷取参按 **shell 语义** —— `sh`/`bash` 的 `-c` 只取**一个**参数作命令串，余下是位置参数，**不推进外层位置表**；`powershell`/`cmd` 取余下整段；base64 载荷解不出即拒绝；`command -v`/`-V` 按查询语义处理，该段无命令位置。
- 还需要什么：无。
- 来源：D-25 残余闭环复验 ｜ 严重度：P1 ｜ 归属层：机制层

### D-27
- 触发条件：用户用**口语化说法**表达编排意图 —— 「拆一下这块」「分头做」「各做各的」「同时做 A 和 B」「谁负责这块」「派谁去做」「几个人一起做」「帮我拆解这个任务」「这个要做两件事」「复审一下」「评审一下」「放到后台做」「一前一后两个人」「让 A 和 B 各自负责」「一边调研一边写」「实现和验证一起」「分一下工」「这两个能不能一起做」。
- 影响：**该走编排的轮次被静默放行，Router 完全不知道编排机制存在** —— 这一轮就退化成单点直做，多性质任务不做拆分、不做独立验收。实测漏判率 **83%（23 条应命中里漏 19 条）**，而误触发 **0 条** —— 粗筛偏保守到近乎失效。
- 复现步骤：1) 取 `plugin/scripts/gate.mjs` 的三个正则（`INTENT` / `SIGNAL` / `SCOPE_HINT`）；2) 喂上面 18 条口语化请求；3) 观察命中数为 0。判定式见「复现步骤」的工装：`C:/Users/yang2/AppData/Local/Temp/sar-gate-regex-test.mjs`（把当前三个正则原样复刻后跑 23 条样本）。
- 证据：父会话实测输出 —— `SUMMARY should_hit=23 missed=19 false_trigger=0`；漏判样本逐条列出（含长度）。根因两条：**① INTENT 只覆盖名词化/书面说法**（派工/组队/分工/验收/复盘），漏掉口语**动词短语**（拆一下/拆解/分头做/各做各的/同时做/谁负责/派谁/复审/评审/放到后台/几个人一起…）；**② `prompt.length > 40` 这个硬门槛把 SIGNAL 废掉了** —— SIGNAL 里的「同时/多个/各自/分别」本该接住这些说法，但中文口语指令通常只有 3~12 字。运行时侧佐证：本会话 36 个带 hook 注入的轮次里，gate **漏判 10 次**；**用户本轮这一句「好像还有点问题就是主动触发还有其他的你看看」（21 字）本身就是漏判样本**。另有断言缺口：回归只测了「一条长书面指令（命中）+ 一条单点提问（静默）」两个极端，**口语化编排请求一条都没测** —— 这就是漏判能长期存在的原因。
- 状态：**已修复（v0.5.1）**
- 修复后证据：判定抽到 `lib.mjs` 的 `judgeTriggerIntent()` 并导出（回归可 `import` 直接断言）；契约新增 **S11「触发语义」**。语料自测：A 档 23 条**漏判 0**（改前 19）、B 档 6 条误触发 0、C 档 7 条伪信号误触发 0。四组变异自检（`node tests/d27-mut-test.mjs`，常驻套件）：M1 回退词表 → 红 3 条；M2 恢复长度门槛 → 红 1 条；M3 去掉动作性限定 → 伪信号红 5 条；M4 常真桩对照 → B 档 6 条 + C 档 7 条全红；每组均核对 sha256 落盘与 `node --check`。九套回归对仓库副本与安装副本均 0 FAIL。
- 修法方向：① INTENT 补口语动词短语；② 去掉 `length > 40` 硬门槛，改用「信号词 + 动作性」判定；③ 判定函数从 `gate.mjs` 抽到 `lib.mjs` 导出，使回归能**直接 import 断言**；④ 未命中时**条件式**兜底注入一行极短提示（仅当「roster 存在且有专项成员且该成员有实战记录」时），对单点小改的工作区零成本；⑤ 载荷解析失败**不静默**（`parseInput` → `parseInputStrict` 或留痕）。契约侧新增「触发语义」条款（父会话落）。
- 还需要什么：需要平台侧确认 UserPromptSubmit 的派发时机与载荷形状是否稳定 —— 若载荷字段名变化，`prompt` 取空会导致「永远不命中」的静默失效（与 D-26 同族的「触发链路」问题）。
- 来源：用户反馈「主动触发还有其他的」后的定点排查 ｜ 严重度：P0 ｜ 归属层：机制层
- **后续（2026-11-10 独立验收）**：独立验收判 FAIL，发现**同族残留** —— ${BT}plugin/scripts/lib.mjs${BT} 的一段注释仍把「平台不对 run_code 容器派发 PreToolUse」当作现行事实陈述（与 guard.mjs 已改正的措辞自相矛盾）。已照 guard.mjs 的措辞改写并注明勿再写回。**教训：翻案不能只改「被指出的那一处」—— 同一句错误表述散落多个文件时，必须全仓 grep 同一措辞，而不是逐个文件改到验收不再提。**

### D-28
- 触发条件：父会话取消派工（`task_stop`）、中断派工，或子会话异常退出（非正常结束）。
- 影响：**并发名额泄漏到 TTL（2 小时）为止**。`MAX_ACTIVE_DISPATCHES = 6`，单会话连派 6 个 worker 再取消几个，后续派工会以「在飞派工已达上限」被拒 —— 表现为「机制突然不让我派工了」，而报错完全不指向真正原因。属于**活性问题**（不是安全问题：多占名额不放行，不放行越权操作）。
- 复现步骤：1) 父会话派出一个 worker；2) 用 `task_stop` 取消它；3) 读台账 `PLUGIN_DATA/dispatches.json`，该条 `state` 仍是 `active`；4) 在 TTL 内继续派满 6 个，第 7 个被「在飞派工已达上限」拒绝。
- 证据：本轮实测 —— 派工 `dsp_mwab22ks_4iccn9`（`sa-mechanism-fix`）被父会话 `task_stop` 取消后，台账 `state` 长时间停在 `active`，父会话只能靠**一次性临时脚本**手工调 `markDispatchAborted` 才把名额拿回来（`end_reason=parent_cancelled_task_no_delivery`）。**机制本身没有可用入口** —— `markDispatchAborted` 虽已从 lib.mjs 导出，但没有任何 CLI / 脚本 / 文档告诉调用方怎么用；契约 S6.2 第 2 条的三条路（正常结束 / 超时兜底 / 读时自愈）**没有一条覆盖取消场景**。
- 状态：**已修复（v0.5.2）**
- 修复后证据：新增 `plugin/scripts/release-slot.mjs`（契约 S6.2 第 5 条）+ 常驻回归 `tests/dispatch-release-test.mjs`（24 条断言，全绿，含「worker 不能调释放入口」这条安全属性）；入口 `node scripts/release-slot.mjs '{"dispatch_id":"dsp_xxx"}'` 或按 `parent_session_id` 批量释放。
- 修法方向：① 契约 S6.2 补第 5 条：取消场景由**发起方显式释放**，入口由插件自带；② 释放只把 `active` 翻成 `aborted`，`done` / `aborted` 的记录一个字节都不动；③ 目标不存在或台账读不出来时**报错退出**，不许静默成功 —— 否则调用方以为名额放掉了，实际还在占着；④ 台账条目里**没有子会话 id**，所以「自动探测子会话是否还活着」不可行，能自动拿到的只有终止事件而取消场景没有终止事件 —— 这条写进契约，免得下次又去做自动探测。
- 还需要什么：若平台将来提供「派工被取消」的事件（类似 SubagentStop 的取消态），应改为**事件驱动自动回收**，本入口退化为兜底。当前无平台事件可用。
- 来源：本轮「主动触发还有其他的」定点排查中实测暴露 ｜ 严重度：P2 ｜ 归属层：机制层

### D-29
- 触发条件：`writeGateTrace` 把留痕写到 `PLUGIN_DATA/hooks/super-agent-router/gate-trace.jsonl`，但运行时 PLUGIN_DATA **本身就是** `.../plugin-data/hooks/super-agent-router` —— 再拼一层就落到多套一层的怪路径。
- 影响：痕迹**确实写了**（机制没失效），但按文档给出的路径去找**找不到文件** —— 排查「为什么 gate 从不命中」的人会去 `PLUGIN_DATA/hooks/super-agent-router/gate-trace.jsonl` 找，那里是空的。**留痕存在却不可发现，等于半个静默失效。**
- 复现步骤：1) 设 PLUGIN_DATA=<运行时的 plugin-data 目录>；2) 用非法 JSON 喂 `plugin/scripts/gate.mjs`；3) 去 `PLUGIN_DATA/hooks/super-agent-router/gate-trace.jsonl` 找 —— 没有；4) 去 `PLUGIN_DATA/hooks/super-agent-router/hooks/super-agent-router/gate-trace.jsonl` 找 —— 在。
- 证据：本轮活体实测 —— 坏载荷跑完，实际落盘路径为 `C:\Users\yang2\.minimax\v2\plugin-data\hooks\super-agent-router\hooks\super-agent-router\gate-trace.jsonl`。
- 状态：**已修复（v0.5.2）**
- 修复后证据：写入目录改为「PLUGIN_DATA 已是插件专属目录时直接写它，否则才补一层」；新增回归断言（痕迹必须落在 PLUGIN_DATA 下一层，且不得产生多套一层的怪目录），挂在 `tests/e2e-test.mjs`。
- 修法方向：目录拼接不能假设「PLUGIN_DATA 是插件根」—— 它在不同上下文里含义不同（运行时=插件专属目录；测试里=整个 plugin-data 根），所以要**按目录名判断**而不是无条件拼接。
- 还需要什么：无。
- 来源：本轮 D-28 之后的链路活体复查 ｜ 严重度：P3 ｜ 归属层：机制层

### D-30
- 触发条件：`tests/d27-mut-test.mjs` 的 `copyPlugin()` 用**固定**临时目录名（`%TEMP%/sar-d27mut-<tag>`），拷贝前先 `fs.rmSync` 清空。
- 影响：**并发跑会假红**。两个实例同时跑全量回归（父会话与独立验收方各跑一份）时，后一个把前一个正在用的副本删掉重拷，前一个的 e2e 于是读到半拷状态，「基线副本全绿」这条断言报红 —— 而实现其实没问题。**会给假 FAIL 的测试比没有测试更危险**：它教人忽略红灯，下次真出问题时也会被当成老样子跳过。
- 复现步骤：1) 同时起两个 `node tests/d27-mut-test.mjs`；2) 观察其中一个报「基线副本全绿 :: FAIL …」。
- 证据：本轮实测 —— 父会话与验收方同时跑 `--all`，安装副本那份 d27-mut-test 报 `FAIL D-27 变异自检·基线副本全绿 :: FAIL 「搞定了，测试通过」被拦 | FAIL 条目缺字段时 block 并指明缺哪项 | FAIL 条目缺统计行时 block` —— 这三条是 **watchdog** 断言，与 D-27 判定毫无关系，正是被抹掉副本的受害者。修复后两个实例同时跑均 `>>> D27MUT ALL PASS`，干净复跑 exit 0。
- 状态：**已修复（v0.5.2）**
- 修复后证据：`copyPlugin()` 改用 `fs.mkdtempSync` 生成独立目录，退出时统一 `cleanup()` 回收；并发双跑实测均全绿。
- 修法方向：**任何测试工装的工作目录都必须唯一** —— 固定目录名 + 先删后拷 = 并发下互相踩。临时目录一律走 `mkdtempSync`（全仓复查：其余九套本来就用 `mkdtempSync`，只有这一套是固定名）。
- 还需要什么：无。
- 来源：本轮安装副本回归出现的假红，顺藤摸瓜 ｜ 严重度：P3 ｜ 归属层：机制层

### D-31
- 触发条件：派工 SCOPE 里出现 `.superagent/lessons/` 或 `.superagent/methods/` 下的条目（目录或文件都算）。
- 影响：读模式按「条目所在目录树」放宽 ⇒ worker 能读到**兄弟成员的错题本全文**与 **Router 私有账 `_router.md`**（实测 94 行未被拦）。方向是「教训被窃取而非分发」—— 用户担心的「成员互相篡位」正是这条。
- 复现步骤：1) 派一条 SCOPE 含 `.superagent/lessons/` 的工；2) worker read `.superagent/lessons/sa-orchestration-audit.md`；3) 未被拦，兄弟成员的规则全文到手。
- 证据：`sa-context-trace` 交付报告 `docs/audit/context-sharing.md`（CS-02/CS-03，本轮独立审计实测复现）。
- 状态：**已修复（v0.5.4）** —— `dispatch.mjs` 闸门 1b 拒派；成员自己那份由 guard 的 `exactPaths`（mode=exact）单独放行。
- 修法方向：私有记忆目录不得进 SCOPE；需要别人历史就走「Router 转写进 brief」。
- 还需要什么：无。
- 来源：本轮验证轮 A 路 ｜ 严重度：P1 ｜ 归属层：机制层

### D-32
- 触发条件：任何需要 Router 参考自己历史教训的场合。
- 影响：编排层的教训无处可去 —— 每份 brief 各写各的模板、编号各自从 01 开始，正是 `_router.md` 里 RT-02/RT-03 记的同型问题。契约 S9 与 `references/review.md` 都写着「由 SessionStart 注入 Router 上下文」，**代码从未实现**：文档声称已注入，实现零回流。
- 复现步骤：1) 读 `references/contract.md` 的 S9 与 `references/review.md` 相关段 → 都写着注入；2) `grep readRouterLessons path=plugin/scripts/` → 当时零命中；3) SessionStart 注入内容里没有任何编排层教训。
- 证据：`sa-context-trace` 报告 CS-04（文档与代码不符）；`plugin/scripts/lessons.mjs` 现已有 `readRouterLessons()`。
- 状态：**已修复（v0.5.4）** —— Router 私有账用 S1 七字段模板，不能复用抽「- **规则**：」的那条正则，故单开抽取函数。
- 修法方向：编排层与成员层各有一本错题本，回流通道也各有一条。
- 还需要什么：无。
- 来源：本轮验证轮 A 路 ｜ 严重度：P2 ｜ 归属层：契约层

### D-33
- 触发条件：worker 开工前想知道目标成员的「实战记录」。
- 影响：`references/scope.md` 写「实战记录注入给 worker」，代码从不注入 —— worker 拿不到履历，只拿得到教训。属**文档声称已实现、实际未实现**。
- 复现步骤：1) 读 `references/scope.md` 的实战记录段 → 写着注入给 worker；2) `dispatch.mjs` 只把 lessons 写进 brief，records 只在父会话侧汇总。
- 证据：`sa-context-trace` 报告 CS-05；README 的表述本来就是对的（履历是匹配时给 Router 的参考）。
- 状态：**已修复（v0.5.4）** —— 按实际实现改写 scope.md。
- 修法方向：分工要写清：worker 开工前需要**教训**，Router 匹配时需要**履历**。
- 还需要什么：无。
- 来源：本轮验证轮 A 路 ｜ 严重度：P3 ｜ 归属层：契约层

### D-34
- 触发条件：子代理撞到 scope 墙被拒。
- 影响：**没有恢复通道**。父会话只剩两个选择：改 brief 重新派工（重开一次派工，浪费名额与上下文），或者靠 worker 自己汇报才知道它卡在哪。本轮实测三名子代理（两名专项成员 + 验收方）都撞过这堵墙，父会话要靠 `task_append` 人工补口径才救回来 —— 机制在关键处靠人肉救场。
- 复现步骤：1) 派一条 SCOPE 不含目标路径的工；2) worker 访问目标路径被拒；3) 父会话查不到「它到底想访问什么」，只能等 worker 汇报或猜。
- 证据：本轮三路验证的实测（A 路、C 路报告正文均记有撞墙经过）。
- 状态：**已修复（v0.5.4）** —— 越界自动记账（`scope_requests[]`）+ `scope-amend.mjs` 一键批准；契约 S13.1/S13.2。
- 修法方向：自动的是**发现与记账**，批准权在父会话 —— 自动批准等于让被约束者自己决定边界。
- 还需要什么：无。
- 来源：用户诉求「子代理的权限有问题」 ｜ 严重度：P1 ｜ 归属层：机制层

### D-35
- 触发条件：给成员派一个范围较大的活。
- 影响：权限只有「逐路径白名单」一档。派大活要把每个路径都枚举出来，写漏一个就撞墙；机制里**根本没有「提权」这个动作** —— 用户要「把子代理的权限放开」时，机制只能靠人改 brief 重派。
- 复现步骤：1) 想让某成员在项目内自由读写；2) 机制里没有对应命令，只能逐条 `--dispatch --add` 或改 SCOPE 重新派工。
- 证据：本轮用户诉求原文；`scope-amend.mjs` 初版只有逐条扩权，无等级概念。
- 状态：**已修复（v0.5.4）** —— 权限等级 tier（`scoped` / `full`），契约 S13.3；full 仍不放开 `.superagent/`、工作区外路径与账号级不可逆动作。
- 修法方向：**每个成员都平等** —— 任何成员都可被管理员提权；但提权动作不在被约束者手里（否则授权模型当场被拆掉）。
- 还需要什么：无。
- 来源：用户诉求「把子代理的权限放开到自动审核」 ｜ 严重度：P1 ｜ 归属层：机制层

### D-36
- 触发条件：派工 SCOPE 里出现 `.superagent/` 下的**单个文件**条目（最常见的是 `ro: .superagent/roster.json`）。
- 影响：两条。① 读范围覆盖整棵目录树 —— 读模式对**文件条目**取「它所在的目录」当树根，所以 `ro: .superagent/roster.json` 的读范围是整个 `.superagent/`，能读到兄弟成员的错题本全文与方法论全文（D-31 只封了两个目录，这个口子照样漏）。② 写权限能改 `roster.json` 里的权限等级 ⇒ **自己给自己提权**。
- 复现步骤：1) 派一条 SCOPE 含 `ro: .superagent/roster.json` 的工；2) worker read `.superagent/lessons/<别人>.md` → 未被拦；3) worker write `.superagent/roster.json` → 若被授权即可把自己改成 full。
- 证据：本轮实现时对照 `lib.mjs` 的 `inScope` 读模式 treeRoot 规则得出；实测见 `tests/scope-amend-test.mjs` 的「派工不得覆盖 .superagent/」断言。
- 状态：**已修复（v0.5.4）** —— 派工闸门 1c 按**三种形态**分判：目录条目拒派、可写条目拒派、只读文件条目允许但**精确生效**（`inScope` 读模式遇 `.superagent/` 条目跳过树根展开）；私有记忆目录（lessons / methods）一律拒派（闸门 1b）；guard 另加第二道防线（brief 直接建边界时自己封）；full 等级也把这块挖掉。
- 修法方向：读模式按目录树放宽这条规则没法改（它是 S2 的既定语义），所以只能在**条目粒度**上分形态判 —— 一刀切拒派会把「读编排层状态文件」也堵死，一刀切放行会把兄弟成员的错题本漏出去。
- 还需要什么：无。
- 来源：本轮实现时自查 ｜ 严重度：P1 ｜ 归属层：机制层

### D-37
- 触发条件：账号里某成员已被删除（或从未创建），而 `.superagent/roster.json` 仍有其条目。
- 影响：派工被「正常」登记（`state: active`），目标不存在 → 子会话不启动 → ① 占用一个并发名额与一个累计名额；② **同 SCOPE 的其他正常派工被「组队冲突」误拦**；③ 错题本与履历照常注入 brief，外观完全正常 ⇒ **静默失效**，最长 2 小时。
- 复现步骤：1) 让名录里某成员在账号侧不存在；2) 按 `routing.md` 匹配流程派工给它；3) 台账写入成功，`task` 调用因成员不存在而失败；4) 再派一条 SCOPE 重叠的工 → 被「组队冲突」拒。
- 证据：`docs/audit/member-persistence.md` §7.2 MP-01（读码 + 全仓检索：`plugin/scripts/` 里没有任何脚本查询账号成员表）。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：`dispatch.mjs` 新增闸门 1d（写台账**之前**校验目标成员存在），账号名单由 `lib.mjs` 的共享函数一次算出；不存在即拒派且**台账零记录**。见 `docs/audit/fix-d37-d41.md`。
- 修法方向（原台账口径）：派工写台账**之前**校验目标成员存在（账号成员落盘在 `~/.minimax/agents/<name>/`，内置成员在 `~/.minimax/agents/.builtin/<name>/`），不存在即 deny；名单获取做成可复用的一次调用。
- **修法方向更正（v0.5.6 修复轮读码复核，按码写）**：台账与审计都假设「账号成员名单**总能取到**」，实测不是 —— 账号成员是**跨项目的账号级事实**，测试夹具（以及任何没带账号环境的环境）里根本没有它。若按「取不到就拒派」实现，整个编排会在没有账号环境的项目里全停摆。⇒ 实际改法：**名单不可得时不拒派，但必须留痕 + 必须在会话注入里披露**（不许静默）；名单可得时判定照常生效。残余风险见 **D-73**。
- 还需要什么：有账号级权限的会话做一次受控复现（跑 MP-01 的运行期后果），才能把「推断」升级为「已复现」。
- 来源：C 路成员审计 ｜ 严重度：P1 ｜ 归属层：机制层

### D-38
- 触发条件：任何时候需要知道「名录里有、账号里没有」的成员时。
- 影响：唯一能算出 stale 的代码（`roster.mjs reconcile`）① 只能手动跑 CLI，**没有任何 hook 或脚本调用它**；② 只 `stdout.write`，不写回名录、不阻断派工。名义上有陈旧检测工具，实际上陈旧成员只在 Router 自觉跑一次 list 时才可能被注意到 —— 工具存在但机制不生效。
- 复现步骤：1) `grep "reconcile" path=plugin/scripts/` → 只命中 `roster.mjs` 自身；2) 读 `cmdReconcile` → 输出后直接 `process.exit(0)`，无持久化副作用；3) `grep "stale"` → 无下游读取。
- 证据：`docs/audit/member-persistence.md` §7.2 MP-02。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：`session-start.mjs` 的注入里加「陈旧成员」小节，与派工侧**共用同一份计算**（`lib.mjs` 的 `staleRosterMembers()`）；派工到陈旧成员走 D-37 同一条路径被拒。见 `docs/audit/fix-d37-d41.md`。
- 修法方向（原台账口径）：把 reconcile 变成 SessionStart / 路由注入的固定一步，并让它产出**可被消费的结论**（陈旧名单随注入披露，或派工时拒绝）。
- **修法方向更正（v0.5.6 修复轮读码复核，按码写）**：reconcile 需要外部喂一份 agent 名单、只 `stdout.write`、不写回名录、不阻断派工 —— 直接把它接进注入，等于把「陈旧判定」继续挂在一个**只输出不消费**的函数上（那正是 MP-02 的病根）。⇒ 实际改法：陈旧名单在 `lib.mjs` 里**直接从账号成员目录算出**，注入侧与派工侧**共用这一份计算**；`roster.mjs` 一侧由 `sa-gate-integrity` 对齐。
- 还需要什么：无。
- 来源：C 路成员审计 ｜ 严重度：P2 ｜ 归属层：机制层

### D-39
- 触发条件：任意会话直接执行账号级的**建号子命令**。
- 影响：删除 / 改写成员被硬拦，**创建完全无闸门** ⇒ 任何会话都能往账号里塞成员，绕过 bootstrap 的造人闸门；账号成员集合与项目名录逐渐脱钩（是「名录有、账号无」的镜像面）。
- 复现步骤：1) `grep` 账号级动作判定段 → 危险动作只含删除成员与改写成员两种子命令，无创建；2) `guard.mjs` 的危险工具名表同样只登记两条，没有创建。
- 证据：`docs/audit/member-persistence.md` §7.2 MP-03。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：账号级**建号子命令**与删除/改写对称纳入危险动作 —— bash 通道按命令位置判、`mavis` 参数按参数判、复合层按内层工具判；父会话不受影响。名录登记侧（`roster.mjs register` 的存在性校验）由 `sa-gate-integrity` 并行处理。另：hooks 危险 matcher 里缺的建号工具名由父会话补齐（见 **D-74**）。见 `docs/audit/fix-d37-d41.md`。
- 修法方向（原台账口径）：建号纳入账号级危险动作（要求人工确认），并在 `roster.mjs register` 处补一条「该成员必须已存在于账号名单」的校验 —— 建号与登记必须成对。
- 还需要什么：无（账号级写动作不由 worker 执行）。
- 来源：C 路成员审计 ｜ 严重度：P2 ｜ 归属层：机制层

### D-40
- 触发条件：对 `ro:` 条目下的文件执行写通道操作。
- 影响：拦截消息写「以下路径不在白名单内：<path>」，而**同一条消息的 SCOPE 列表里就写着 `ro: <path>`** —— 按字面读，Router 会误以为「要加白名单」，进而把一个本可安全只读执行的动作升级成**可写**授权。
- 复现步骤：1) 在一条 SCOPE 含 `ro: plugin/scripts/roster.mjs` 的派工里执行该脚本；2) 读拦截消息：前半句列出全部 SCOPE（含这条），后半句称「不在白名单内」。
- 证据：`docs/audit/member-persistence.md` §7.2 MP-A1（拦截原文为亲眼见过，根因为推断）。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：拦截消息按**形态分型** —— 命中只读条目时说「在白名单内，但登记为只读条目……请去掉 `ro:` 后**重新派工**」，并撤掉「批准即可」的提示（批准等于把只读升级成可写，正是这条缺陷要防的）；真不在白名单内的仍是原句。见 `docs/audit/fix-d37-d41.md`。
- 修法方向（原台账口径）：拦截消息区分两种情形 ——「该路径不在白名单内」vs「该路径在白名单内但为只读条目，当前是写操作」，后者提示「去掉 `ro:` 重新派工」而不是「要加白名单」。
- 还需要什么：无。
- 来源：C 路成员审计 ｜ 严重度：P3 ｜ 归属层：机制层

### D-41
- 触发条件：在复合调用（`run_code` / `write`）的**载荷正文**里出现被禁账号级动作的字面形态 —— 哪怕只是被引用、被说明、被要求复现。
- 影响：审计者写复现步骤、引用拦截原文时**报告本身被拦**；审计产出无法落盘（本轮成文时亲身触发两次），且审计者为了绕过它容易改成模糊表述 —— **正好损害「每条可复现」这条底线**。同一机制两套口径：bash 通道已升级为「命令位置」判定，复合层仍是全文正则。
- 复现步骤：1) 在一条 SCOPE 含可写报告路径的派工里，用 `write` 写入含被禁子命令字面形态的正文；2) 观察拦截；3) 对照 `lib.mjs` 的 `detectDangerousAccountCommand`（按命令位置判定）与复合层的朴素正则 —— 口径不一致。
- 证据：`docs/audit/member-persistence.md` §7.2 MP-A2（拦截为亲眼见过，口径不一致为推断）。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：`lib.mjs` 新增 `detectDangerousInComposite`，复合层**按内层工具分形态判**（write/edit 载荷是数据、bash 的 command 交给命令位置判定、点名危险工具照拦）；`guard.mjs` 改为调用它。见 `docs/audit/fix-d37-d41.md`。
- 修法方向（原台账口径）：把复合层判定收敛到「命令位置」口径（至少对引号内 / 代码块内 / Markdown 引用内的字面量放行），并在拦截消息里说明「命中的是正文引用，不是执行动作」。
- **修法方向加强（v0.5.6 修复轮读码复核，按码写）**：「对引号内/代码块内/Markdown 引用内的字面量放行」是**文本启发式**，仍会把 write/edit 载荷里的正文当命令形态判（正文里出现被禁形态照样被拦）。⇒ 实际改法：**按内层工具分形态判** —— write/edit 的载荷是数据、整段不参与命令形态判定；bash 的 command 交给命令位置判定；点名危险工具照拦；字面量拼接按拼接结果判，不开口子。
- 还需要什么：一次对照实验（同一段正文，复合层 vs bash 通道）。
- 来源：C 路成员审计 ｜ 严重度：P2 ｜ 归属层：机制层

## 五、v0.5.4 修复状态（2026-11-10）

> **注：本节是 2026-11-10 那一轮的时点快照，不反映后续轮次的当前状态**；各条当前状态以「三、缺陷明细」里的「状态」行为准（D-37~D-41 的修复轮已完成，见明细段）。

本轮做三件事：**权限自动审核**（越界自动记账 + 一键批准）、**权限等级 tier**（成员平等，可被管理员提权）、
以及把「成员互相篡位」的口子彻底堵上（闸门 1c）。契约新增 S13。

| 编号 | 状态 | 说明 |
|---|---|---|
| D-31 | 已修复 | 派工闸门 1b：SCOPE 不得覆盖 `.superagent/lessons/` 与 `.superagent/methods/` |
| D-32 | 已修复 | `lessons.mjs` 新增 `readRouterLessons()`，SessionStart 注入编排层教训（契约 S9 声称已久、代码从未实现） |
| D-33 | 已修复 | `scope.md` 按实际实现改写：履历是匹配时给 Router 的参考，不进 worker |
| D-34 | 已修复 | 越界自动记账（台账 `scope_requests[]`）+ `scope-amend.mjs --list/--grant/--deny/--dispatch --add`；契约 S13.1/S13.2 |
| D-35 | 已修复 | 权限等级 tier（`scoped` / `full`），写在项目级 roster.json，提权留痕 changes.log；契约 S13.3 |
| D-36 | 已修复 | 派工闸门 1c：`.superagent/` 下任何条目（读或写）一律拒派；full 等级同把这块挖掉 |
| D-42 | 已修复 | 私有记忆的读范围漏洞：私有记忆路径除精确文件通道外，任何 scope 条目都不授予 |
| D-43 | 已修复 | 条目侧补相对式归一化：SCOPE 写绝对路径时，相对路径的目标也能命中 |
| D-37 | 待修 | 派工写台账前校验目标成员是否存在（账号成员目录 `~/.minimax/agents/<name>/`，内置在 `.builtin/`） |
| D-38 | 待修 | 把 roster reconcile 变成路由注入的固定一步，并让陈旧名单成为可被消费的结论 |
| D-39 | 待修 | 建号纳入账号级危险动作；`roster.mjs register` 补「必须已存在于账号名单」的校验 |
| D-40 | 待修 | 越界拦截消息区分「不在白名单内」与「在白名单内但为只读条目，当前是写操作」 |
| D-41 | 待修 | 复合层危险词判定收敛到「命令位置」口径，对正文引用放行 |

D-37~D-41 的证据与修法方向见 `docs/audit/member-persistence.md`（C 路成员审计），
本轮只入账未修 —— 它们是**账号级 / 判定口径**类问题，改动面比本轮的三项大，
留到下一轮按「先复核再动手」处理。

### D-42
- 触发条件：派工 SCOPE 里有一条**目录条目**，其读范围覆盖到 `.superagent/` —— 最典型的是 `ro: <工作区根>/`。
- 影响：**派工闸门拦不住它。** 闸门 1c 判的是「条目路径本身碰没碰 `.superagent/`」，
  而 `ro: <工作区根>/` 的路径本身不碰 —— 但读模式对目录条目会展开整棵树，
  于是它的读范围**连带把 `.superagent/lessons/` 也放开了** ⇒ 兄弟成员的错题本全文可读。
  方向仍是「教训被窃取而非分发」，正是用户担心的「成员互相篡位」那条路。
  洞的本质：**堵入口不够，读范围本身也要判** —— 一条合法条目可以合法地覆盖到私有目录。
- 复现步骤：1) 派一条 SCOPE 含 `ro: <工作区根>/` 的工；2) worker read `.superagent/lessons/<别人>.md`
  → 命中目录条目的读范围，未被拦；3) 对比：同一条目里并没有直接写 `.superagent/`，闸门 1c 无从拦起。
- 证据：本轮独立验收方实测（2026-11-10 16:4x）：派工带 `ro: <工作区根>/` 后，
  读兄弟成员的错题本被放行；修前 `inScope` 的读模式对目录条目只做前缀匹配，没有私有目录的排除。
- 状态：**已修复（v0.5.4）** —— `lib.mjs` 新增 `isPrivateMemoryPath()`：
  **私有记忆路径（`.superagent/lessons/`、`.superagent/methods/`）除精确文件通道（mode=exact）外，任何 scope 条目都不授予**；
  成员自己那份仍由 guard 的 `exactPaths` 放行。
- 修法方向：凡是「读范围比写范围大」的授权模型，都要在**范围层**判一次私有目录，不能只判**条目层**。
- 还需要什么：无。
- 来源：本轮独立验收方实测 ｜ 严重度：P1 ｜ 归属层：机制层

### D-43
- 触发条件：派工 SCOPE 写**绝对路径**（如 `ro: C:/Users/.../项目/`），而 worker 用**相对路径**调用工具（`read docs/x.md`）。
- 影响：目标一律不命中白名单 ⇒ worker 全程被误拦，而拦它的理由是「不在白名单内」——
  但那条白名单明明就写着这个项目。**契约 S2 声称「绝对路径会先折算成相对工作区的相对路径，两种写法都能命中」，
  以前只有「条目写相对路径」这一半成立**：目标侧折算过（rel 与 abs 两种都在比），条目侧只按写出来的样子比。
- 复现步骤：1) 派一条 SCOPE 含绝对目录项的工；2) worker `read docs/other.md`（相对）→ 被拦；
  3) 改成绝对路径调用 → 命中。**同一份白名单，两种写法两个结果。**
- 证据：本轮独立验收方实测发现（其 SCOPE 含 `ro: <工作区根>/`，相对路径调用被误拦）；
  修前 `lib.mjs` 的 `inScope` 里 `const e = normalizePath(raw)` 只取一种形式。
- 状态：**已修复（v0.5.4）** —— 条目侧同时按**绝对式与相对工作区的相对式**比；
  并补「条目是工作区根本身」这一情形（相对式为空 ⇒ 任何相对路径都在它之下）。
- 修法方向：**归一化要两端都做**。目标侧折算了、条目侧没折算，就是「同样的路径两种写法两个结果」的来源。
- 还需要什么：无。
- 来源：本轮独立验收方实测 ｜ 严重度：P1 ｜ 归属层：机制层

## 六、v0.5.0 修复状态（2026-11-10）

> **注：本节是 2026-11-10 那一轮的时点快照，不反映后续轮次的当前状态**；各条当前状态以「三、缺陷明细」里的「状态」行为准。

本轮按契约 `plugin/skills/super-agent-router/references/contract.md` 改造，独立验收见 `docs/audit/verification-v050.md`（35 条，30 成立 / 2 不成立 / 3 未验证，VERDICT FAIL → 修完复验）。

| 编号 | 状态 | 说明 |
|---|---|---|
| D-01 | 已修复 | transcript brief 解析兼容 `codex` 变体 |
| D-02 | 已修复 | bash 路径 token 不再把 `console.log` 当路径；目录型目标可识别 |
| D-03 | 已修复 | 未登记的文件类工具名一律按写判定；`mavis` 的 `agent delete` 按参数拦截 |
| D-04 | 已修复 | brief 解析改为按语义定位，不再只扫前 8 行 |
| D-05 | 已修复 | 去重键缺 `turn_id` 时不再抹掉其它记录 |
| D-06 | 部分修复 | **教训**已由 guard 直达 worker 上下文；**履历**按协议只给 Router 做匹配参考（分工，非遗漏） |
| D-07 | 已修复 | SCOPE 解析不出条目即拒绝派工 |
| D-08 | 文档解决 | 子会话不触发 SessionStart 是运行时事实，代码关不掉；已写进 `references/scope.md` 与 `references/brief.md` |
| D-09 | 已修复 | 写冲突检测扩到项目维度 |
| D-10 | 已修复 | 名额回收三条路：正常结束 / 超时兜底 / 读时自愈 |
| D-11 | 已修复 | watchdog 证据须为可核验的具体物 |
| D-12 | 已修复 | 台账用 routing id（`agent_key`）而非显示名做等值比较 |
| D-13 | 已修复 | `verified_by` 必须在台账里有 `state=done` 记录；写入时校验，读取时不管历史 |
| D-14 | 已修复 | 方法论/错题本改为精确文件放行（`mode='exact'`），不再展开整棵目录树 |
| D-15 | 部分修复 | gate 的措辞治理仍依赖 Router自觉，未代码强制 |
| D-16 | 已修复 | 写类工具取不到目标即拒绝（复合工具除外，契约 S3 已写明例外） |
| D-17 | 未修复（说明有误，已纠正） | **原「部分修复」说明与实现不符** —— 「已显示 N / 共 M」只在 gate **命中分支**里；漏判时 `process.exit(0)` 一个字都不输出，Router 完全不知道编排机制存在。本轮按 D-27 一起修 |
| D-18 | 已修复 | 错题本为空时显式说「0 条（是没栽过跟头，不是传递故障）」 |
| D-19 | 已修复 | 台账截断策略调整 |
| D-20 | 已修复 | 盘符绝对路径按真实路径校验存在性，报错保留盘符前缀 |
| D-21 | 已修复 | 段首/段尾定位统一为绝对索引 |
| D-22 | 已修复 | glob/grep 判定对象改为有效检索根，目录本身算命中 |
| D-23 | 已修复 | 台账不再写无人读取的 `unscoped` 等字段 |
| D-24 | 已修复 | 记录摘要取样不再按名录顺序截断，改为收齐→按战绩排序→取样→披露省略者 |
| D-25 | 已修复 | bash 通道按**命令形态**识别账号级动作（`mavis agent delete` / `mavis agent update` 等），12 条负例不误伤；独立复验 PASS_WITH_RESIDUAL，残余 D-25b / D-25c 已在本版闭环 |
| D-25b | 已修复 | 包装器开关改为按包装器分别定义（带值/布尔/位置参数分列），包装器集合补齐，载荷按两式取参并整体再判 |
| D-25c | 已修复 | 账号级 CLI 的子命令必须是第一个子命令：`mavis list agent delete` 不再被拦 |
| D-25d | 已修复 | **闭集包装器名单**改为「数据段/执行段」二分，`exec` 及任何新包装器自动覆盖；另补启动器（npx/npm exec/pnpm dlx）语义 |
| D-25e | 已修复 | 载荷取参按 shell 语义（`sh -c` 单参数、位置参数不推进外层）、`command -v` 查询语义，两例过度拦消除 |
| D-26 | 已证伪并更正（文档解决） | 原结论「平台**不对 `run_code` 容器派发 PreToolUse**」**作废**：实测平台会派发，但**随会话而变**（10:22 未派发 / 14:29、15:10 派发并当场 DENY）→ 复合层是**纵深防御的加成**而非唯一防线；判定落点仍在内层通道，契约 S3、`scope.md`、RT-04、STATUS 已同步更正 |

### 本轮新引入又修掉的一条

**`run_code` 复合判定误伤**（验收 V-02/V-04/V-07）：新加的 `run_code` 匹配项会把**整段代码文本**当命令文本扫路径，
于是注释里的 `//`、字符串常量里的 scope 外路径、引号里的命令串都被当成越界目标，
纯计算代码还会撞上「取不到目标就 deny」——实测三个正常代码被整次拒绝。

已按验收给的修法改成：**复合层只做危险操作判定（`dangerousInCode`），作用域判定交回内层调用**。
内层调用本来就被独立判定（V-05 实测内层 `bash` 被拦时外层 `run_code` 正常返回），所以复合层不再需要判作用域。

### 两条「改对了但没被锁住」的断言（验收 V-12/V-13）

- **V-12** 工具名兜底：原先无任何断言；已补 `upload_file` 等未登记文件类工具名按写判定且 scope 外必被拦的断言，回退实现后变红。
- **V-13** D-20 盘符路径：原先两条断言在旧实现下同样是绿的 —— 原因是**单盘机器上旧实现截掉盘符前缀后，剩下的根相对路径恰好指向同一个文件**。
  已改用 `subst` 挂载第二个盘符构造可区分场景，并补「报错必须保留盘符前缀」，回退后变红。

### 残余（未在本会话端到端验证）

线上安装副本在本次部署后才升级到 v0.5.0，而 **Hook 按会话激活** —— 本会话的 hook 缓存树仍是改前版本，
因此「真实 run_code 在新插件下的表现」需要在**新开会话**里再验一次（写 scope 内 / 写 scope 外 / 纯计算各一次）。
该边界由验收 V-32 记录，属环境边界而非产品失败。


---

## 七、独立复验与残留澄清（2026-11-10）

上一轮验收（`docs/audit/verification-v050.md`）判 FAIL 并给出三条改判条件。本轮补派独立 verifier 复验
（`docs/audit/verification-v050-recheck.md`，**VERDICT: PASS_WITH_RESIDUAL**）：三条改判条件全部以活体证据满足 ——
① 复合分支不再扫代码文本、不再套用「取不到目标即 deny」，17 组合成载荷全部按预期（改回改前语义后恰好 5 条复合断言变红）；
② V-12 与 D-20 两条断言在实现回退时确实变红（验收方首轮曾因把回退文件写到副本的错误位置而得到假绿，
自行发现后改为核对「套件实际加载的文件」的 sha256 + 行为级对照，重跑通过）；
③ 真实 `run_code` 三形态实测：scope 内写放行且文件建成、scope 外写被**内层**拦且文件未创建、纯计算放行。
8 套回归 243 条断言基线全绿。

复验报告列出的两条残留，其中**第一条在本轮被进一步查实并改判**：

| 残留项 | 复验时的结论 | 本轮查实 |
|---|---|---|
| 残留 1：外层 `run_code` 在真实运行时是否进入 PreToolUse 未能证实 | 「未验证」，两种候选解释无法区分 | **原「已坐实」结论已证伪并更正**：10:22 的日志探针阴性观察本身可信，但**推广错了** —— 14:29 与 15:10 的子会话实测平台**确实派发**并当场 DENY（金丝雀复测）。正确结论是「**派发随会话而变**」，不是平台恒定事实 → **D-26 改为「已证伪并更正」**；由它暴露的 bash 通道旁路仍记为 **D-25**（已闭环）。教训升级为：**单次阴性观察不能写成平台事实，写平台事实必须带金丝雀对照 + 时间戳 + 会话标识** |
| 残留 2：复合层断言对 HEAD 不具区分力 | 覆盖边界，非缺陷（区分力由 MUT-C 提供） | 维持原判 |

**方法论教训**（已进 Router 错题本 `.superagent/lessons/_router.md` 的 RT-04）：
**合成载荷只验证「判定逻辑」，不验证「触发链路」**，两者必须分开取证。
「机制对」与「链路通」是两个问题，合并成一个结论就会造出「防护存在」的假象 —— 这正是 D-25 长期没被发现的土壤。


---

## 八、D-25 的修复与复验（2026-11-10）

### 怎么发现的

D-25 不是台账里原有的条目，是**独立复验收尾时的运行时取证**坐实的：
用假 `PLUGIN_DATA` + 真 transcript 驱动仓库版 guard 做活体探针，发现
`echo x >> .superagent/STATUS.md && mavis agent delete sa-victim` 被放行。
而 `mavis` 是本机真实存在的 CLI，命令文本会被 shell 真的执行 —— **账号级成员删除可绕过护栏**。

**它为什么能躲过上一轮验收**：上一轮验收用的是「合成载荷驱动 guard 脚本」，判定逻辑是对的（DENY）；
但那层判定在真实运行时**是否被触发**当时没有独立证据，于是被当成了「已生效」。
合成载荷验的是**判定逻辑**，不验**触发链路**，两者必须分开取证（RT-04）。
（补充更正：后来据以推断的「平台不对容器派发」结论本身也是错的 —— 平台会派发，只是随会话而变。详见 D-26。）

### 修法与复验

修法：bash 通道按**命令形态**判定（命令位置上的「CLI + 子命令 + 动作」），
不按字样匹配；切命令段并识别命令替换，`sh -c`/`eval`/`sudo`/`env`/`xargs`/`find -exec` 包装与内层命令同判；
只读分流仅对无命令替换的命令生效。

独立复验结论 **PASS_WITH_RESIDUAL**：

| 项 | 结论 |
|---|---|
| 探针 P1/P2/P4/P5 | ALLOW → DENY；P3/P6 保持 DENY；P7 仍 ALLOW |
| 12 条负例 | 全部 ALLOW（无异常项） |
| 10 条包装形态 | 全部 DENY |
| 变异检验 | guard-test **11 条红**；另做 always-deny 桩对照（59 红）证明副本真被加载、无假绿 |
| 五套回归 | 197 断言全绿，0 FAIL |
| 残余 | **D-25b**（包装器布尔开关吞 token → 4 条形态仍放行）、**D-25c**（`mavis list agent delete` 过度拦） |

### 一条验收误判的澄清（留给下一个验收方）

复验方的 ACCEPT 五判「不成立」，理由是 `plugin/skills/.../contract.md` 与 `scope.md` 的 mtime
（10:50:37）晚于 D-25 的代码改动（lib 10:48:35 / guard 10:48:52 / guard-test 10:49:09），
于是判「本单越界改了 SCOPE 外文件」。

**这条不成立**：那两个文件是**父会话（Router）** 在同一时间窗内改的 —— 契约与参考文档按协议由父会话维护
（成员的 SCOPE 里没有它们，成员的方法论文件里也明写「不改协议文档与参考手册」）。
时间戳撞车是**父会话并行工作**造成的，不是成员越界。判定越界要看**谁写的**，不能只看 mtime ——
更稳的做法是比对内容归属与责任人，或在派工时把父会话的并行文档维护窗口告知验收方。

---

## 九、v0.5.5 修复轮：F1~F5 与 RG-01~RG-09（2026-11-10）

本节新增 21 条来自四处**互不通信**的独立来源，与前七节的编号体系并行。台账号由本会话统一分配，**原报告编号保留在各条的「来源」行**，追溯一律用下面的对照表，不要凭台账号顺序推断来源。

| 台账号 | 原编号 | 来源文档 |
|---|---|---|
| D-44 | F1 | `docs/audit/verification-v054.md`（v0.5.4 独立验收，VERDICT: FAIL） |
| D-45 | F2 | 同上 |
| D-46 | F3 | 同上 |
| D-47 | F4 | 同上 |
| D-48 | F5 | 同上 |
| D-49 | RG-01 | `docs/audit/lessons-persistence-and-isolation.md`（B 路错题本与记录闸门专项） |
| D-50 | RG-06 | 同上 |
| D-51 | RG-02 | 同上 |
| D-52 | RG-05 | 同上 |
| D-53 | RG-04 | 同上 |
| D-54 | RG-03 | 同上 |
| D-55 | RG-07 | 同上 |
| D-56 | RG-08 | 同上 |
| D-57 | RG-09 | 同上 |

**编号顺序说明**：台账号按「先验收五条 → 错题本专项中写入身份与内容口径优先、其余按 RG 序」分配，与原报告的 RG 序不完全一致。

### 本轮修复分工（文件所有权互不重叠）

| 专项成员 | 负责条目 | 文件所有权 |
|---|---|---|
| sa-mechanism-fix | D-44 / D-45 / D-46 / D-47 / D-48 / D-54 | `plugin/scripts/{guard,lib,scope-amend,dispatch}.mjs`、`tests/{guard,scope-amend}-test.mjs`、`plugin/README.md`、`plugin/CHANGELOG.md`、`references/{contract,scope}.md` |
| sa-gate-integrity | D-49 / D-50 / D-51 / D-52 / D-53 / D-55 / D-56 / D-57 | `plugin/scripts/{record-gate,lessons-gate,lessons,records,roster}.mjs`、`tests/{records,lessons}-test.mjs`、`references/records.md` |

两条纪律：① 成员不得改 `.superagent/`（私有状态目录）；② 成员不得 git commit/push —— 提交与发布由父会话执行。

### D-44
- 触发条件：worker 的 SCOPE 覆盖插件脚本目录（机制维护类成员的典型形态），worker 用 bash 执行 `scope-amend.mjs`。
- 影响：worker 可把自己提成 full 等级、可自批准自己产生的越界写请求；提权后写白名单外文件被放行。契约 S13.1/S13.3 与 README 的「批准权在父会话手里、worker 无权改自己的等级」被直接推翻。
- 复现步骤：1) 名录里 worker 等级 scoped，派工 SCOPE = 插件脚本目录；2) bash 跑 `scope-amend --tier full --agent 自己 --approver 自己` → 护栏 allow；3) 实际执行 → 退出码 0，名录 tier=full、授权人=自己，审计留痕写「by 自己」；4) 写白名单外文件 → allow。自批准路径同理（请求号由 guard 的拦截文案直接印给 worker）。
- 证据：验收方沙箱内端到端跑通（真实 scope-amend 脚本 + 真实台账格式）。根因两处：`scope-amend.mjs` 是**无调用者身份校验**的管理 CLI（`--approver` 只是命令行上的一个字符串，谁执行都算管理员）；护栏不把 scope-amend 当父会话专属工具，且拦截文案把**可执行的批准命令直接印给 worker**。
- 状态：已复现（验收方沙箱内端到端；活体 runtime 复现要改真实名录，属 FORBID，未做） → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：① guard 把 scope-amend（及任何改名录/台账的插件脚本）列为**父会话专属**，worker 上下文命中即 deny；② scope-amend 加调用者校验（`--grant` 的 approver 必须等于该派工的 `parent_session_id`；`--tier` 的 approver 必须是台账里存在过的父会话 id）；③ 若只做 ③，必须把契约 S13.3、README、scope-amend 头部「硬规矩 4」改成与 S13.5 一致的措辞，并停止把批准命令印给 worker。
- 还需要什么：需要父会话拍板「护栏级封堵」还是「文档降级 + 审计留痕」；两者都需要在验收时复核 `changes.log` 有没有成员给自己提权。
- 来源：v0.5.4 独立验收 F1 ｜ 严重度：P0 ｜ 归属层：机制层

### D-45
- 触发条件：一条越界请求对应的派工已 done 或 aborted，随后执行 `scope-amend --grant <请求号>`。
- 影响：对**已结束的派工**完成扩权，违反契约 S13.2 第 2 条与 README 的对应条款；台账上留下对死派工的授权记录。与「直接加条目」路径口径分裂（那条路径正确拒绝）。
- 复现步骤：派工 → 撞墙产生 pending 请求 → 把台账里该派工 `state` 改成 done → `--grant` 退出码 0、`ok=true`、added 非空；同样的「直接加条目」命令 → 退出码 1，文案「派工已结束」。
- 证据：`lib.mjs` 的 grantScopeRequest 只检查「记录还在不在」，不检查 `state`；`tests/scope-amend-test.mjs` 现有断言只覆盖「直接加条目」这一条路径 —— 回归没覆盖到不等于没缺陷。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：grantScopeRequest 找到派工记录后补一条与「直接加条目」同口径的 state 检查；补一条覆盖「批准请求」路径的回归断言。
- 还需要什么：无。
- 来源：v0.5.4 独立验收 F2 ｜ 严重度：P1 ｜ 归属层：机制层

### D-46
- 触发条件：full 等级成员访问编排层私有状态目录下的任何路径。
- 影响：拦截文案称目标「在**工作区之外**」（实际在工作区内），并建议父会话「批准该路径后重试」—— 而该批准永远不生效（写模式对私有目录一律不授写权），worker 反复撞墙形成噪音，把父会话引去做无效批准。
- 复现步骤：名录成员 `tier=full` → 写名录文件 → 拒语文案含「该成员是 full 等级…以下路径在**工作区之外**」，且带批准提示。
- 证据：验收方探针 A2.9~A2.12；文案出自 `guard.mjs` 的 full 分支两处。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：full 分支按目标是否落在私有目录分成两种文案 —— 私有目录 → 「目标在编排层私有状态目录内，full 等级也不放行」且**不打印批准提示**；工作区外 → 保留现文案与批准提示。
- 还需要什么：无。
- 来源：v0.5.4 独立验收 F3 ｜ 严重度：P2 ｜ 归属层：机制层

### D-47
- 触发条件：文档里写着会随实现漂移的具体数字或括注（断言条数、例外条数、权限规则）。
- 影响：同一件事在 README、契约、代码、scope.md 各说一套，验收方据此判「文档—代码不一致」「契约不是单一事实源」；已结束派工能否扩权、worker 能否自提权、断言条数、full 例外条数四项都出现过分裂。
- 复现步骤：逐处比对 `CHANGELOG.md`（**同文件并存 484 与 487 两个数**）、`README.md` 与契约 S13.2（已结束派工拒绝扩权）、契约 S13.3（worker 无权改自己的等级）、`scope.md`（写「三条例外」而契约已补成四条）与代码实际行为。
- 证据：验收方 A5/A7 逐条列出行号与原文；scope-amend 头部「硬规矩 4」给出的理由（闸门 1c 封掉了私有目录的写授权）**不成立** —— 1c 封得住「直接写」，封不住「执行 CLI」。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：① 文档断言要么改准，要么在代码里落地到能指到一行；② 「硬规矩 4」的理由换成真实理由；③ 口径由契约承担单一事实源，README 只引用不复述。
- 还需要什么：无。
- 来源：v0.5.4 独立验收 F4 ｜ 严重度：P3 ｜ 归属层：契约层

### D-48
- 触发条件：仓库副本改了但没有重跑部署，安装副本与运行时 hook 缓存树停留在旧版本。
- 影响：运行时行为与仓库一致（脚本逐文件 sha256 相同），但对外文档口径不一致（安装副本的 CHANGELOG 仍写「十套回归」）；验收方据此判「副本不一致」，实为部署动作缺失。
- 复现步骤：改仓库副本 → 不跑部署 → 逐文件 sha256 比对仓库插件包 / 安装副本 / 运行时缓存目录 → 27 个文件一致、CHANGELOG 一行不同。
- 证据：验收方 A1 的副本一致性核对（逐文件 sha256）。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：部署纳入发布工装的固定收尾步骤，部署后必须做三副本逐文件 sha256 核对，核对不过不算发布完成。
- 还需要什么：无。
- 来源：v0.5.4 独立验收 F5 ｜ 严重度：P3 ｜ 归属层：机制层

### D-49
- 触发条件：调用方在写入载荷里指定**别的成员名**（`agent` 字段），并让该写入动作发生在脚本内部。
- 影响：成员可以把「栽过哪」写进兄弟成员的错题本、把「做成过什么」写进兄弟成员的方法论文件。错题本与履历是**路由器匹配与派工前置**的依据，被篡改直接影响派工决策，且写入方拿不到任何拦截反馈。
- 复现步骤：1) `MINIMAX_PROJECT_DIR` 指向沙箱项目；2) 调用 `lessons-gate.mjs`，载荷 `agent='sa-victim'`；3) 返回 `{"ok":true,…,"entries":1}`；4) 读 `.superagent/lessons/sa-victim.md` → 文件被创建且含该条目。
- 证据：B 路探针 C7_13（`file_exists=true`）；`lessons-gate.mjs` 的目标路径 = `lessonsPath(payload.agent)`，无身份校验；`record-gate.mjs` 同构（`methodPath(agent)`），**未单独实证**。
- 状态：已复现（错题本侧亲眼所见；履历侧为推断） → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：写入目标不再由载荷独断 —— 由派工绑定（台账 binding 的 `agent_key`）决定，或在闸门内比对载荷 `agent` 与当前会话绑定成员，不一致即拒；同时把「写入者」写进条目本身以便审计。
- 还需要什么：需要机制 owner 给闸门一条可信的「当前调用者」来源（会话 id → 台账 binding）。
- 来源：B 路专项 RG-01 ｜ 严重度：P1 ｜ 归属层：机制层

### D-50
- 触发条件：成员错题本文件存在且有条目，但条目的「规则」行不是 `- **规则**：` 这个精确格式（历史文件、手写条目、S1 模板格式）。
- 影响：派工注入把这类成员说成「0 条（还没栽过跟头）」—— D-18 明确要区分的两种空值之外，**第三种空值（内容在但抽不出）被谎报成第一种**；Router/Worker 据此认为该成员是干净的，于是继续派同类活。
- 复现步骤：写 `sa-alt.md`（1 条条目，规则行写作 `- 规则：必须先回显口径`）→ 跑 `dispatch.mjs`（载荷 `agentName: sa-alt`）→ 注入文本为「sa-alt 的历史教训：0 条（该成员暂无错题本 —— 是「还没栽过跟头」，不是传递故障）」。
- 证据：B 路探针 A7；`lessons.mjs` 抽不出就返回空数组，`dispatch.mjs` 只看数组长度。
- 状态：已复现 → **已修（v0.5.5，已独立复验通过）**：三态实现（无错题本 / 空 / 有条目但抽不出 / 正常）与 6 条断言已补；**注入层接线由父会话补齐**（`dispatch.mjs:276-278` 改调 `lessonsStatusLine(name)`，注入层不再自己拼文案）—— 独立验收实测三态措辞正确（无错题本 → 「还没栽过跟头」；抽不出 → 点明「不是还没栽过跟头…待查」）。见 `docs/audit/fix-rg01-09.md` 与 `docs/audit/verification-v055.md`
- 修法方向：注入前分别判「文件是否存在 / 条目总数 / 抽出的规则条数」三个量，三种状态各给各的措辞（确实无错题本 / 错题本存在但读不出内容 = 通道故障待查）。
- 还需要什么：无。
- 来源：B 路专项 RG-06 ｜ 严重度：P2 ｜ 归属层：契约层

### D-51
- 触发条件：成员方法论文件在真正的「## 实战记录」段之前，正文里出现过字面串「## 实战记录」（引用、说明、模板片段）。
- 影响：新履历被写进**前一个段**（实测写进了「归属」段）；`readRecords` 按行首匹配只认真正的段 → **写进去却读不出来**（静默丢失，履历条数不增、摘要里看不到）；同时该段里的其他 `###` 被当成履历条数 → 20 条上限被提前触顶（实测记为 3 条，实际只有 1 条）。
- 复现步骤：方法论文件写「## 归属 … 详见 ## 实战记录 段 … ## 实战记录 …」，台账里放一个 `agent=verifier, state=done` 的派工行，跑 `record-gate.mjs`。
- 证据：B 路探针 B8（`records=3`，`readrecords` 只读到旧条目）；`record-gate.mjs` 用 `raw.indexOf(SECTION)`（**子串**）定位，`lessons.mjs` 用行首正则（**行首**）—— 两套口径并存。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：段首定位改为**行首锚定**（与 readRecords 同一正则），并把「定位段首」抽成 `lessons.mjs` 的单一导出、record-gate 与 readRecords 共用，从结构上消掉两套口径。
- 还需要什么：无。
- 来源：B 路专项 RG-02 ｜ 严重度：P1 ｜ 归属层：机制层

### D-52
- 触发条件：同一成员的错题本被两个及以上写入方同时追加（并行派工、复盘与闸门重跑撞车）。
- 影响：read-modify-write 无锁无原子性 → 后写者用旧快照覆盖先写者，条目**静默丢失**；每一次写入都返回 `ok:true`，调用方与复盘方都以为记上了。实测 8 次并发最多只落 5 条。
- 复现步骤：对同一 `agent` 并发启动 8 个 `lessons-gate.mjs` 进程 → 8 次全部 `ok:true`，最终文件条目数 7/6/5/8/8（5 轮）。
- 证据：B 路探针 A4（`writes_ok=8` 而 `entries_in_file=5..8`）；`lessons-gate.mjs` 读全文 → 拼串 → `fs.writeFileSync` 整体覆盖。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：改成**单次追加**（`appendFileSync`）或「写临时文件 + 原子 rename」并加文件锁；写入后回读校验条目数，不一致时报错而不是返回成功。
- 还需要什么：无。
- 来源：B 路专项 RG-05 ｜ 严重度：P1 ｜ 归属层：机制层

### D-53
- 触发条件：把「Router 的锅」写进条目的 `symptom`（现象）字段，而 `cause` 写成成员自己的失误。
- 影响：归因公平闸门放行 —— **编排层的锅仍然进了成员错题本**，S9 的实质要求（成员账上不背编排层的锅）被绕过。
- 复现步骤：载荷 `symptom='Router 给错了 brief，我只是照做，返工了'`、`cause='我漏了回显口径'`、其余合法字段 → 闸门返回 `ok:true`。
- 证据：B 路探针 C6b（`actual='放行'`）；`lessons-gate.mjs` 的归因判定只查 `cause + ' ' + rule`，不查 `symptom`。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：归因判定覆盖**全部自由文本字段**（symptom/cause/rule/next_time），豁免位同样逐字段适用，避免把「现象里提到 brief」误判成甩锅。
- 还需要什么：无。
- 来源：B 路专项 RG-04 ｜ 严重度：P2 ｜ 归属层：机制层

### D-54
- 触发条件：派工台账里存在**缺 `parent_session_id`** 的历史行（`lib.mjs` 的 legacy 迁移会把它们的状态一律改成 `done`）。
- 影响：`verified_by` 的「验收方真实存在」判据可被这样一行台账满足 —— 即使那一行真实状态是 `active`（验收根本没跑完）。履历于是能被一个「台账里存在同名行」的验收方背书，而这条背书正是 Router 匹配时的依据。
- 复现步骤：台账写 `{"dispatches":[{"dispatch_id":"d2","agent":"ghost","state":"active"}]}`（无 `parent_session_id`），跑 `record-gate.mjs` 且 `verified_by='ghost'` → 返回 `ok:true`，履历写入成功。
- 证据：B 路探针 B4；`lib.mjs` 的迁移把无 `parent_session_id` 的行 `state` 改成 `done`，`record-gate.mjs` 只按 `state=='done'` 判定。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：迁移不要改写真实状态语义（保留原字段），或让 `verified_by` 判据要求「`state=='done'` **且** 有 `parent_session_id` **且** 非 legacy」。
- 还需要什么：迁移在 `lib.mjs`，属机制 owner 范围。
- 来源：B 路专项 RG-03 ｜ 严重度：P1 ｜ 归属层：机制层

### D-55
- 触发条件：Router 自己的失误（brief 给错、边界没列全）需要沉淀时。
- 影响：S9 要求「改为记进 `_router.md`」，但全仓**没有任何写入闸门**：没有模板校验、没有编号校验、没有条数上限、没有写入留痕 —— 它是全仓唯一靠人工自觉维护的记录文件，格式漂移无人拦。
- 复现步骤：全仓检索 `_router` → 只有三处：`lessons.mjs` 读、`lessons-gate.mjs` 拒绝成员以 `_` 开头、`session-start.mjs` 注入；无任何写入路径。
- 证据：B 路 grep 输出；契约 S9 声称由 SessionStart 注入 —— **注入侧已实现且实测通过**，本条只针对写入侧。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：给 `_router.md` 加写入闸门（强制 S1 七字段齐全、编号前缀合法、条数上限、写入留痕），由 Router 侧调用；成员侧继续保持拒写。
- 还需要什么：无。
- 来源：B 路专项 RG-07 ｜ 严重度：P2 ｜ 归属层：契约层

### D-56
- 触发条件：同一批实战记录走「注入层」（`maxMembers=12`）与走「CLI 层」（默认 8）两条路。
- 影响：同一份数据两处给出不同结论 —— CLI 说「显示 8 / 共 11、省略 sa-m08、sa-m09、sa-m10」，注入层说「11 个全部显示」。口径不统一时，**验收看 CLI、运行时看注入**，会得出互相矛盾的判断。
- 复现步骤：沙箱 roster 造 11 个有记录的成员，跑 `node plugin/scripts/records.mjs summary`（输出 `shownMembers:8`、`omitted:[sa-m08,sa-m09,sa-m10]`），再调 `summarizeRecordsDetailed(3,12)`（输出 11 个、`truncated:false`）。
- 证据：B 路探针 D24；`records.mjs` 默认 8、`session-start.mjs` 与 `gate.mjs` 传 12、`roster.mjs` 的 `MAX_ROSTER=12`。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：把「取样名额」提成**单一常量**（与 `MAX_ROSTER` 绑定），CLI 默认值与注入层调用取同一个值；披露字段保持不变。
- 还需要什么：无。
- 来源：B 路专项 RG-08 ｜ 严重度：P2 ｜ 归属层：机制层

### D-57
- 触发条件：`roster.json` 里出现同名成员（手改文件绕过 `roster.mjs register` 的重名拒绝）。
- 影响：同一成员在实战记录摘要里出现两次（实测 `sa-m02` 出现两次，各带 `count:5`），既重复计数又白占一个名额；被挤掉的其他人就此少一个可见位置 —— 正是 D-24 想消除的那类「结构性不可见」。
- 复现步骤：roster 里写两个 `name='sa-m02'` 的成员，跑 `records.mjs summary` → `totalMembers=11`（真实成员 10 个），摘要里 `sa-m02` 出现两次。
- 证据：B 路探针 D24；`roster.mjs` 的 `listMembers` 只排序不去重。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：`listMembers` 按 name 去重（同名取一条并留痕），或 `readRoster` 读入时检测重名并显式报出异常。
- 还需要什么：无。
- 来源：B 路专项 RG-09 ｜ 严重度：P3 ｜ 归属层：机制层

### D-58
- 触发条件：管理员给某成员批了一条**精确文件**的只读扩权，路径落在编排层的两个私有记忆目录（lessons 目录与 methods 目录）之下 —— 例如模板文件、方法论文件的精确只读条目。
- 影响：护栏第二道防线的判定是「边界里只要出现私有记忆目录前缀就拒绝建立边界」，**没有区分两种形态**：目录条目（读模式会展开成整棵子树，放开兄弟成员的错题本全文 —— 这是它要防的）与精确文件条目（只放开这一个文件，不展开）。后果有两层：① 管理员批准的扩权是**死的**（批了也不生效，且没有任何提示说它被第二道防线吃掉了）；② **更糟** —— 第二道防线是在**建边界阶段** deny 的，边界建不起来 ⇒ 该 worker 的**每一次**工具调用都被拒，全线卡死，不只是那一个文件读不了。
- 复现步骤：派工正常进行 → 管理员批一条「模板文件精确只读」扩权 → 该 worker 的下一次任意工具调用即被拒（拒绝点在建边界，不在目标判定）→ 父会话把该扩权从台账撤下 → 立刻恢复。
- 证据：本轮实测（sa-gate-integrity 整轮工具调用被拦，撤下扩权后立即恢复）。两层口径不一致是根因：范围层的现行实现对私有记忆路径**一律不授予**，而防线的注释只针对「条目所在目录当树根」这一种风险 —— 于是「精确文件」与「目录条目」被混为一谈。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-f1-f5-rg03.md`
- 修法方向：第二道防线改成**按形态判**，与范围层同一口径 —— 只有**目录条目**才拒，精确文件条目不触发这道防线（放行与否仍由范围层决定，两层职责不重叠）；补两条回归断言（精确文件条目不触发防线 / 目录条目仍拒绝建边界），断言必须能区分改前改后。
- 还需要什么：无。
- 来源：本轮实测 ｜ 严重度：P1 ｜ 归属层：机制层

### D-59
- 触发条件：Windows 上用 `rename` 覆盖一个**正被其它进程打开**的目标文件（读句柄未共享删除）。
- 影响：`fs.renameSync` 抛 EPERM ⇒ 那条记录**根本没落盘**，而旧实现照样返回 `ok` —— 正是 D-52「静默丢条目」的形态。Linux 上 rename 覆盖总是成功，**这个坑只在 Windows 显形**。
- 复现步骤：16 个进程并发写同一个错题本文件（每次都走「临时文件 + rename」）→ 实测**有 2 次直接失败**，那两条记录没有落盘。
- 证据：记录闸门修复轮实测（`docs/audit/fix-rg01-09.md` D-52 一节第 1 条）。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：跨平台差异必须实测驱动 —— 这段重试在 Linux 上看不出价值，但删掉就等于「并发写在 Windows 上会静默少条目」。
- 还需要什么：无。
- 来源：B 路修复轮实测 ｜ 严重度：P1 ｜ 归属层：机制层

### D-60
- 触发条件：落盘后回读校验发现内容不符（并发覆盖、写到一半被别的进程覆盖）。
- 影响：校验失败时文件**已经被这一份快照覆盖**了 —— 校验只是「发现覆盖」，不是「避免覆盖」。不回滚的话，那一次失败写入就把前面所有条目一起抹掉（实测 16 并发丢到 15 条）；更隐蔽的是「整体覆盖」是先截断再写，**读取端会看到「方法论文件不存在」**，在读取端表现为「本来就没有」。
- 复现步骤：把并发写回退成「读全文 → 拼串 → 整体覆盖」，16 并发 × 3 轮 → 最少落盘 2 条，明确失败 3 条，首条失败原因是「方法论文件不存在」。
- 证据：记录闸门修复轮实测的 M12 变异体输出（`docs/audit/fix-rg01-09.md`）。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：**校验不是保护** —— 校验失败必须配一条恢复动作，否则「发现覆盖」等于「制造覆盖」。
- 还需要什么：无。
- 来源：B 路修复轮实测 ｜ 严重度：P1 ｜ 归属层：机制层

### D-61
- 触发条件：Windows 上锁文件**已存在且正被别的进程打开**时，排他创建（`open` with `wx`）报 ERROR_SHARING_VIOLATION。
- 影响：Node 把它映射成 **EPERM** 而不是 EEXIST ⇒ 并发写同一份账本会随机报「获取写锁失败：EPERM」—— **锁机制本身是对的却被误判成失败**。
- 复现步骤：并发写同一错题本，16 并发 × 多轮 → 随机出现「获取写锁失败：EPERM」，而锁文件此刻并不在被占用状态（`existsSync` 返回 false）。
- 证据：记录闸门修复轮实测（`docs/audit/fix-rg01-09.md` D-52 一节第 3 条）。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：见 `docs/audit/fix-rg01-09.md`
- 修法方向：**第一版修法（用 `existsSync` 区分「占用 vs 权限问题」）是错的** —— 杀毒软件扫描/清理锁文件时文件被标记 delete-pending，路径在目录里已经解析不到，`existsSync` 返回 false 而 `openSync` 报 EPERM。判据要按**错误码**分，不按文件系统观测分。
- 还需要什么：无。
- 来源：B 路修复轮实测 ｜ 严重度：P2 ｜ 归属层：机制层

### D-62
- 触发条件：多个写入方排队等同一把锁，且**持有者的重试窗口比等待超时更长**。
- 影响：等待超时（当时 15s）短于持有者重试窗口（约 8.8s）⇒ 排队中的写入方被**误判成失败**；且偷锁阈值（60s）与等待超时（15s）的相对关系也不对 —— 偷锁阈值必须**大于**等待超时，否则会把「还在用的锁」当陈旧锁偷走，两个写入方同时进临界区。
- 复现步骤：16 个写入方同时抢同一把锁（持有者遇 EPERM 走重试）→ 队尾写入方在 15s 处报「拿不到锁」。
- 证据：记录闸门修复轮实测（`docs/audit/fix-rg01-09.md` D-52 一节第 4 条）。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：实现见 `docs/audit/fix-rg01-09.md`；专属断言见 `docs/audit/fix-f02.md`（本轮补齐，见 D-66）。
- **判据更正（v0.5.6 修复轮自查）**：本条原来的「真正正确性条件」写的是「偷锁阈值 > 等待超时」—— **这条区分不了改前改后**（修复前偷锁 60s > 等待 15s 也满足它）。真正区分改前改后的是**等待超时的量级**：
  判据 = `LOCK_WAIT_TIMEOUT_MS >= MAX_ACTIVE_DISPATCHES × RENAME_RETRY_WINDOW_MS`（编排层同时最多 6 个派工在飞 × 持有者最坏临界区 8.8s = **52800ms**）。
  修复前 15000ms 只容得下 1 轮（第二个排队方即被误判失败）⇒ 15000 < 52800 ⇒ **红**；修复后 60000ms ⇒ 绿。
  「偷锁阈值 > 等待超时」这条仍保留，但它是**必要条件而非充分条件** —— 它防的是「偷走还在用的锁」，不是「误判排队方失败」。
- 还需要什么：无。
- 来源：B 路修复轮实测 ｜ 严重度：P2 ｜ 归属层：机制层

### D-63
- 触发条件：租约目录 `.leases/` 下同时存在**别的插件**的缓存树，而部署脚本对每一棵存在的树都执行全量同步。
- 影响：别人的插件树会被整棵覆盖成本插件的内容（实测那棵 superpowers 树 57 个文件 → 28 个），它的 skills / hooks / scripts 被删掉 —— 这是**跨插件破坏**，而且发生在别人的运行时里。
- 复现步骤：1) 列出 `.leases/` → 5 条租约，其中一棵树的 `.minimax-plugin/plugin.json` 的 name 是 `superpowers`（v6.2.8，57 个文件，含它自己的 session-start.ps1 / .sh）；2) 旧版部署脚本对这棵树也执行 §syncTree(SRC, dir)§，而 syncTree 会**删掉源里没有的文件**（removed++）。
- 证据：本轮部署后做三副本 sha256 核对时发现第 5 棵树内容与本插件完全不同；逐项核对确认该树当前未被污染（57 个文件里没有本插件的任何脚本），**本轮侥幸未造成破坏** —— 那棵树在部署之后才被运行时重建。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：部署脚本改为读每棵树自己的 manifest §name§ 判归属，不是本插件就**跳过并如实报出**；本轮输出为 §CACHE_SYNCED trees=4 skipped=1 [sha256-tree-v1-d9614e8f… -> superpowers]§。
- 修法方向：**破坏性同步必须先判归属** —— 「目录里有哪些文件」不是归属判据，manifest 的 name 才是；跳过也要**报出来**，静默跳过等于把破坏藏起来。
- 还需要什么：无。
- 来源：本轮实测 ｜ 严重度：P1 ｜ 归属层：工具层

### D-64
- 触发条件：回归用例调 `scope-amend.mjs` 时只传 `PLUGIN_DATA`、**没传 `MINIMAX_PROJECT_DIR`**，而扩权留痕 `appendChangeLog()` 写的项目根会回退到 `process.cwd()`。
- 影响：真实项目的变更账 `.superagent/changes.log` 里出现**测试夹具的假批准人**（`by mvs_parent`）与假授权记录 —— 审计账是「谁批准了什么」的唯一证据，被假记录污染后就不能直接当证据用。平时看不出来：扩权被当场拒时 `fail()` 提前退出，来不及写；一旦相关拒绝被回退（变异检验回退实现时），假记录就落进真账。
- 复现步骤：把「私有记忆目录扩权当场白拒」那条拒绝回退（变异体 M8）→ 跑 scope-amend 套件 → 真实项目的变更账每次多一行 `by mvs_parent`。
- 证据：发布专项实跑 `docs/audit/.tmp-fix/mutation-check.mjs` 时发现；变更账里实测有两行 `by mvs_parent | + ro: .superagent/methods/sa-other.md`（时间戳 11:00:36 与 11:05:43）。
- 状态：已复现 → **已修（v0.5.5，待独立复验）**：两处漏传 `MINIMAX_PROJECT_DIR` 的调用补齐（`tests/scope-amend-test.mjs` 的 D-58 用例与 `--dispatch --add` 批准人用例），并清掉已写入的两行假记录（保留 16 行真实留痕）。
- 修法方向：**测试夹具必须自带全套环境**，不能依赖被测程序的默认值 —— 审计类写入的默认值一旦回退到 cwd，就会污染真实账。
- 还需要什么：无。
- 来源：本轮实测 ｜ 严重度：P2 ｜ 归属层：工具层

### D-65
- 触发条件：worker 的 SCOPE 覆盖 `plugin/scripts/`，它执行**仓库副本**里的权威面脚本（如 `--tier full`）。
- 影响：整条提权链跑通 —— 名录里该成员变 full、变更账写下假批准人、下一次派工即按 full 生效。根因：拦截锚点是**运行中 guard 自己所在的那一份**（由 `process.argv[1]` 反推插件根），只覆盖缓存树/安装目录；「批准人校验」在 worker 手里不构成阻拦（worker 的派工原文里就带着父会话 id）。
- 复现步骤：派一条 SCOPE 覆盖插件脚本目录的工 → worker 用 bash 跑仓库副本的 `--tier full --agent 自己 --approver <父会话 id>` → 护栏放行 → 名录变 full。
- 证据：独立复验 `docs/audit/verification-v055.md` F-01（沙箱项目目录内复现，未碰真实名录）。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：归属判据改为**插件包身份**（`findPluginPackageRoot` / `readPluginPackageName` / `ownPackageAuthority`：所在目录树里有 `.minimax-plugin/plugin.json` 且包名一致）；**按 `process.argv[1]` 反推插件根的旧锚点整条废止**（它就是漏洞本身）；相对路径按多个根解析；家目录展开扩到四种写法并抽成纯函数单独断言。端到端探针实测：改前「ALLOW + 名录变 full + 变更账写假批准人」→ 改后「DENY + 名录不动 + 无留痕」。新增 10 条断言（改前 7 红）。见 `docs/audit/fix-f01-f04.md`。
- 修法方向：**拦截要按「这是不是本插件包里的官方脚本」判，不要按「运行中那一份的路径」判**；归属判据用插件包身份（manifest 在不在），不要用脚本名裸匹配（会误伤别的项目的同名文件）。
- 还需要什么：无。
- 来源：v0.5.5 独立复验 F-01 ｜ 严重度：P1 ｜ 归属层：机制层

### D-66
- 触发条件：把 D-59 / D-60 / D-62 的实现整段回退，或让 D-61 的判据失效。
- 影响：回归**一条都不红** —— 这四条修复处于「看起来有、其实没被钉住」的状态；下一个动并发写代码的人改坏它们，不会有人知道。D-61 更糟：只能靠 D-52 的并发断言**间接**暴露，且时敏（一次 2 红、一次 0 红）。
- 复现步骤：回退 rename 重试 / 回滚逻辑 / 超时常量 → 跑十一套回归 → 0 红；回退抢锁判据 → 跑同一套 → 概率性红。
- 证据：独立复验 `docs/audit/verification-v055.md` F-02（验收方自己回退实测）。修复报告本身也已如实写明「12 个变异体覆盖的是 D-49/51/52/53/55/56/57，D-59~D-62 是被 M4/M12 整段回退连带覆盖」。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：给 D-59~D-62 各配**专属且确定性**的断言 —— 用**可控故障注入**（`SAR_FAULT_INJECT`：`rename-eperm[:N]` / `lock-eperm[:N]` / `verify-fail`，默认关闭，生产路径实测逐字节相同、开销 1.06~1.11x 噪声量级）取代「撞概率」；D-52 那条并发断言从「条数 == 固定值」改成**不变量**（「说成功的集合 == 落盘的集合」）并加**起跑号牌**消除错峰。7 个变异体全部让目标断言变红（D-61 连跑 3 次每次红同两条，时敏消除）。见 `docs/audit/fix-f02.md`。
- 修法方向：**间接覆盖不算覆盖** —— 每条缺陷都要有一条只钉它自己的断言；靠概率撞出来的红不算数。
- 还需要什么：无。
- 来源：v0.5.5 独立复验 F-02 ｜ 严重度：P2 ｜ 归属层：机制层

### D-67
- 触发条件：台账的统计行 / 索引表 / 条目状态与实际内容脱节。
- 影响：台账是缺陷的**唯一索引**，不自洽时它就不再是索引：统计行写「P0 10 + D-26 未标严重度」而明细里 P0 其实是 11 条且 D-26 标着 P0；索引表只列 62 条（缺 D-25、D-26、D-25b~e）；D-50 的状态说「注入层接线未做」而代码早已接上 —— **台账开始说假话**。
- 复现步骤：数索引表的 `| D-xx |` 行（62）与明细区的条目块（68）→ 对不上；按明细逐条统计严重度 → 与统计行对不上；读 D-50 状态行 → 与 `dispatch.mjs` 实际代码相反。
- 证据：独立复验 `docs/audit/verification-v055.md` F-03（验收方自己发现并指出发布报告里已见过但没改）。
- 状态：已复现 → **已修（v0.5.6，父会话）**：统计行按逐条明细**重算**（P0 11 / P1 29 / P2 21 / P3 7，共 68 条），索引表补齐 6 条（68 行），D-50 状态改为「注入层接线由父会话补齐」；统计行加一句「统计以本表逐条明细为准，不得凭印象写数」。
- **复核（v0.5.6，父会话，脚本重算）**：统计行按逐条明细重算仍一致（P0 11 / P1 30 / P2 25 / P3 8，共 74 条）；索引补齐 **D-27~D-30** —— 这四条所在轮次（v0.5.1 / v0.5.2）没有独立的「修复状态」表，已在主表后加**补充索引**表，不再让它们只存在于明细段里。
- 修法方向：**台账的数要用脚本数，不要用印象写** —— 数字漂移是必然的，靠人记必然对不上。
- 还需要什么：无。
- 来源：v0.5.5 独立复验 F-03 ｜ 严重度：P2 ｜ 归属层：契约层

### D-68
- 触发条件：SCOPE 里写含空格的路径（绝对路径尤其常见）。
- 影响：`extractScopeDetail` 按空格切分 ⇒ 路径被切成两段，后半段被当成另一个条目 ⇒ 该白名单条目**静默不生效**（既不报错也不生效）。**本仓库自己的路径就含空格**（`…\mini code的插件\`），所以这不是理论问题。
- 复现步骤：派一条 SCOPE 含带空格的绝对路径的工 → worker 访问该路径 → 被拦（不在白名单内）；白名单里明明写着它。
- 证据：独立复验 `docs/audit/verification-v055.md` F-04。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：切分尊重路径里的空格（先按逗号切；片段以盘符开头或被引号包住时整体算一个条目；支持双引号包裹）；路径形态判定同步放开「盘符开头的整体算路径」；新增 8 条断言（改前 4 红），其中「读放行 / 写放行 / 对相对路径同样生效」三条验的是**白名单真的生效**而不只是「解析出一个条目」。见 `docs/audit/fix-f01-f04.md`。
- 修法方向：**路径不是词** —— 任何按空白符切路径的地方都要先问「路径里能不能有空白符」。修复者另补三条细节：① 截断后的**前半截仍会被收进白名单**（`C:\…\mini` 过得了路径形态判定 ⇒ 白名单里躺着一个看起来正常、永远匹配不上的条目，比整条丢掉更隐蔽）；② 含中文的路径走的是另一条分支（中文让路径形态判定失败，而收集器会把整条**丢弃**且不进 rejected ⇒ 白名单更窄且同样不报错）—— **只修切分不够，路径形态判定也要放开**；③ 被引号包裹的路径同样被截断 ⇒ 引号形态必须一并支持。
- 还需要什么：无。
- 来源：v0.5.5 独立复验 F-04 ｜ 严重度：P3 ｜ 归属层：机制层

### D-69
- 触发条件：同一父会话累计派工数达到硬编码上限（30）。
- 影响：父会话被**自己的历史锁死** —— 明明是「一轮做完又要做下一轮」的正常节奏，却再也派不出工；而机制给的处理建议是「新的任务组请开新会话」，可会话往往不由人决定（桌面端一轮对话就是一个会话）。
- 复现步骤：本会话累计派工达 30 → `task` 派工被闸门 3 直接拒：「本会话累计派工已达 30 个（上限 30）」。
- 证据：本轮实测（父会话为跑完 21 条修复与两轮复验，派工累计超限）。
- 状态：已复现 → **已修（v0.5.6，父会话）**：闸门 3 改为**管理员可调** —— 台账顶层 `limits.max_total_dispatches` 存在且为正数时用它，否则用默认 30（默认口径对其它会话**不变**）；管理员抬高这件事落在台账里（台账本身就是留痕），超限提示写明当前用的是哪个值。本轮管理员已把本会话上限显式抬到 60 并记下理由。
- 修法方向：**上限用来拦失控，不用来锁死正常节奏** —— 想调整就留一个显式、留痕、可回退的口子，而不是让机制自己悄悄失效或让人去开新会话绕开。
- 还需要什么：无。
- 来源：本轮实测 ｜ 严重度：P2 ｜ 归属层：机制层

### D-70
- 触发条件：上一轮（F-01）断言「家目录四种写法（`~` / `$HOME` / `%USERPROFILE%` / `$env:USERPROFILE%`）都被拒」成立，但**成立的原因不是它要验的那条规则**。
- 影响：断言**假绿** —— 命中的是 scope 层（越界拦截），不是权威面脚本规则；而家目录展开本身在旧锚点下**大半是死代码**（展开后的路径仍要与「运行中那一份」的根比对，家目录里的那份插件只有当运行中的 guard 恰好装在家目录那份插件上时才会命中）。上一轮验收报告里「4 种写法同样被拒」这个观察没错，但**归因错了** —— 结论「家目录展开已覆盖到位」是错的。
- 复现步骤：把 git HEAD 的 guard 装成插件包目录后跑探针 → 四种家目录写法**全部未命中**「权威面脚本」规则（命中的是 scope 层，理由文案是「越界拦截」而非「权威面脚本」）。
- 证据：F-01 修复轮的复核（`docs/audit/fix-f01-f04.md` §1.2 的 (d) 与 §1.5 改前输出，7 条红里有 4 条正是这四种写法）。
- 状态：已复现 → **已修（v0.5.6，待独立复验）**：判定锚点换成插件包身份后，四种家目录写法才真正由权威面规则命中；另把家目录展开抽成纯函数 `expandHomePath()` 单独断言 —— 否则「命令被拒」可能由别的分支命中，断言还会假绿。改前 7 红里就有这四条。见 `docs/audit/fix-f01-f04.md`。
- 修法方向：**断言要能指认是「哪条规则」在拦** —— 只断言「被拒」，不区分拒绝理由的断言，遇到别的分支命中就变假绿；把被测行为抽成纯函数单独断言。
- 还需要什么：无。
- 来源：F-01 修复轮自查 ｜ 严重度：P2 ｜ 归属层：机制层

### D-71
- 触发条件：项目里的 `.superagent/roster.json` 中，某成员的 `tier_granted_by` 写的是**自称**（如 `router`），而不是真实父会话 id。
- 影响：**文档口径与项目现状对不上** —— README 与契约都写着「批准人必须是**真实会话 id**，不能写 `router` 这种自称」，而项目自己的名录里就写着 `router`。读的人无从判断这条提权到底是谁批的。根因是机制**只校验新提权的批准人**（`scope-amend.mjs --tier` 的 approver 校验），**不校验名录里的历史值**。
- 复现步骤：读 `.superagent/roster.json` → 6 名 full 成员的 `tier_granted_by` = `router`；`node plugin/scripts/scope-amend.mjs --tiers` 同样报出 `granted_by: router`。
- 证据：父会话 v0.5.6 收尾时逐条核对留痕（亲眼所见）。这 6 条是 **v0.5.4 建立 tier 时的历史值** —— 当时的机制还没要求批准人必须是真实会话 id。
- 状态：已复现 → **已修（v0.5.6，父会话）**：6 名成员全部通过管理员 CLI **重新走了一遍授权**（先 `--tier scoped` 收回、再 `--tier full` 授予，批准人 = 真实父会话 id），名录里的 `tier_granted_by` / `tier_granted_at` 现在与真实留痕一致；`.superagent/changes.log` 留下 12 行真实记录（6 名 × 收回 + 授予）。
- 修法方向：**留痕字段要能追溯到人** —— 「机制校验新动作」不等于「历史数据自动干净」；规则升级了就要把存量数据对齐，否则文档与现状会长期对不上。
- 还需要什么：直接手改 `roster.json` 仍可写入任意批准人 —— worker 写不了（闸门 1c + 私有状态目录规则），父会话手改属管理员行为，靠验收时复核兜底。这一层是**诚实边界**，不写成「绝对不可能」。
- 来源：v0.5.6 收尾父会话实测 ｜ 严重度：P3 ｜ 归属层：契约层

### D-72
- 触发条件：交付文本里出现**否定式**产出陈述 —— 例如「`docs/audit/live-probe-outside.txt` 这个文件**没有创建**」。
- 影响：watchdog 的「声称产出」判定只按**肯定式动词**列表（改动 / 新增 / 新建 / 创建 / 写了 / 生成 / 产出 / 输出 / 修改 / 替换 / 删除）逐行扫，
  「没有创建」里含有「创建」⇒ 该行被当成产出声明 ⇒ 路径存在性校验失败 ⇒ **连续 block**。
  实质后果有两层：① **诚实的报告被打回重写**（worker 明明已经如实说明没做）；
  ② block 的消息是「要么真的创建它们，要么如实说明没做」—— 而 worker 已经在如实说明，闸门却仍在要求文件存在 ⇒
  **机制实际上在把成员往「真的去创建那个文件」的方向推**；那个文件若越界，就是机制把成员推过了边界。
- 复现步骤：派一条 SCOPE 很窄的活体探针，让它报告「白名单外的那个文件**没有创建**」→ SubagentStop 时 watchdog 发 block，要求该文件必须存在。
- 证据：**活体**（不是合成载荷）—— 探针子会话 `mvs_73441ff316ed4d2db69fe88e9b17eeb3`，2026-11-10T13:06:10Z 的 transcript 里 watchdog 的 block 消息原文与 worker 的三次如实说明；
  原始行见 `docs/audit/live-trigger-evidence.txt`（父会话从 transcript 逐行复制）。
- 状态：已复现（活体）→ **已修（v0.5.6，D-72 修复轮，待独立复验）**。修法方向：把「声称产出」与「否定式产出」分开 —— 否定式（没有 / 未 / 不该 / 不会 / 并非）出现的产出动词不算声明；
  路径存在性校验只对**肯定式产出**生效。
- 修法方向：**闸门要认得否定句** —— 「按动词表逐行扫」把语义压扁了，动词表越长误伤越多；否定式判定要单独一条，而不是靠加词绕过。
- 还需要什么：断言必须能区分「肯定式产出陈述 → 校验存在性」与「否定式产出陈述 → 不校验」，且必须能指认命中的是哪一条规则（否则假绿）。
- 来源：v0.5.6 活体探针实测 ｜ 严重度：P1 ｜ 归属层：机制层

### D-73
- 触发条件：运行时 `PLUGIN_DATA` 不指向本插件的专属目录（测试夹具、或运行时布局变化）。
- 影响：账号成员名单被判为不可得 ⇒ 派工的成员存在性判定**整体降级为不判**（放行 + 痕迹 + 注入披露）。
  派给不存在的成员重新变成**静默失效**：占掉并发与累计名额，后续同 SCOPE 的派工被组队冲突误拦。
- 复现步骤：① 用一个不指向本插件专属目录的 `PLUGIN_DATA` 跑 `dispatch.mjs`；
  ② 目标成员不在任何账号目录里 ⇒ 派工被放行；③ 台账里出现一条 `state:'active'` 的记录。
- 证据：`plugin/scripts/dispatch.mjs` 闸门 1d 的 else 分支（放行 + `writeGateTrace`）；`plugin/scripts/lib.mjs` 的 `accountAgentsRoot()`；
  `docs/audit/fix-d37-d41.md` §8 N-01（修复轮读码复核 + 实测）。
- 状态：已复现（读码 + 修复轮实测）→ **已修（v0.5.6，D-73 修复轮，待独立复验）**。
  修法：**不推翻 D-37 的取舍**（名单不可得时不拒派），改的是「降级本身」——
  存在性改成**三态**：`account_verified`（账号侧核验通过）/ `roster_declared`（项目名录声明存在）/
  `unverified`（既没核验过、也没登记过）；台账记录新增 `member_existence` 与 `degraded` 两个字段，
  `gate-trace.jsonl` 留一条带 session id / 目标成员 / 名单状态 / 原因的痕迹，派工注入里披露【降级提示】。
  降级派工**不占并发名额、不占累计名额、不参与 SCOPE 冲突判定**（既不挡别人、也不被别人挡）。
  见 `docs/audit/fix-d73.md`。
- **父会话裁决（本轮定案）**：降级成立条件 = 名单不可得 **且** 项目确实在用专项成员
  （名录读得到且非空，或名录读不出来）；**名录读得到但为空**时**不降级**，仍按正常路径占名额。
  理由：保住「组队冲突」闸门在**没有专项成员**的项目里的权威 —— 那类项目派工对象通常是内置成员，
  一律降级会让冲突闸门形同虚设；而名录读不出来时仍按「在用专项成员」处理（不能假设「项目没用专项成员」）。
  代价（诚实边界）：**名录读得到但为空**的项目里，派给不存在成员的派工仍会占名额、仍可能误拦后续派工。
  若将来要改成「名单不可得一律降级」，则 chain-test 的冲突闸门与名额上限断言必须显式提供
  `SAR_ACCOUNT_AGENTS_DIR` —— 那是「改夹具还是改口径」的取舍，**不是本轮能顺手做掉的事**。
- 修法方向：**降级不许静默，但也不许把闸门自己关掉** —— 「查不到就当不存在」会把存在性判定与冲突检测
  两个机制一起关掉；正确的形状是「存在性按三态记、名额与冲突按降级口径分开算」。
- 还需要什么：运行时 `PLUGIN_DATA` 的布局契约 —— 父会话已确认本机 `PLUGIN_DATA` = 
  `~/.minimax/v2/plugin-data/hooks/super-agent-router`（本插件专属目录），故**生产运行时判定生效**；
  风险只在夹具与布局变化时出现。
- 来源：机制修复轮 N-01 ｜ 严重度：P1 ｜ 归属层：机制层

### D-74
- 触发条件：平台侧存在名为「建号类」的工具 —— 本机工具清单里**确实有** `mavis_agent_create`。
- 影响：`plugin/hooks/hooks.json` 的危险 matcher 只登记删除/改写两个旧工具名 ⇒ 建号那个**不会被派给护栏** ⇒
  直接调用该工具建号**不被拦**（D-39 的 bash 通道与参数通道都拦不住这种形态 —— 那两条判的是命令文本与参数，不是工具名）。
- 复现步骤：读 `plugin/hooks/hooks.json` 的 PreToolUse 危险 matcher 组，与 `plugin/scripts/guard.mjs` 的 `DANGEROUS` 表对表 —— 表里有、matcher 里没有。
- 证据：同上；本机工具清单里确有建号工具（亲眼所见）。
- 状态：已复现（读码 + 本机工具清单）→ **已修（v0.5.6，父会话）**：matcher 补上建号工具名，表与 matcher 对称；
  随部署同步到安装副本与运行时缓存树（部署后以三副本 sha256 核对为准）。
- 修法方向：**表与 matcher 必须对称** —— 判定逻辑在脚本里、派发路由在 `hooks.json` 里，两处各写一份就会漂。
- 还需要什么：无。
- 来源：机制修复轮 N-02 ｜ 严重度：P1 ｜ 归属层：机制层

### D-75
- 触发条件：父会话用 `scope-amend.mjs --grant` 批准一条「只读条目上的写请求」。
- 影响：只读条目被追加一条可写条目 ⇒ D-40 想防的「只读动作升级成可写授权」在**管理员路径**上仍然成立
  （D-40 那轮只改了拦截措辞与提示，没动扩权入口）。
- 复现步骤：① 派一条只含 `ro:` 条目的工；② worker 对该路径发写请求（被拦、已记账）；
  ③ 父会话执行 `--grant`；④ 该路径的写请求随后被放行。
- 证据：`plugin/scripts/lib.mjs` 的 `grantScopeRequest()`；`docs/audit/fix-d37-d41.md` §8 N-03。
- 状态：推断（读码推出，未实跑 —— 扩权入口是父会话专属）→ **已修（v0.5.6，D-75 修复轮，待独立复验）**：
  管理员批准即授权升级（**保留能力** —— 用户要的就是「成员给管理员做事必须有权限」，堵死批准权会与这个诉求相反），
  但**必须在留痕与批准回执里写明「本次批准把该路径从只读升级为可写」**，不许静默升级。
- 修法方向：扩权入口要么对「已有只读条目」显式标注升级，要么直接拒批；**两者都要留痕**。
- 还需要什么：无（口径已定）。
- 来源：机制修复轮 N-03 ｜ 严重度：P2 ｜ 归属层：机制层

### D-76
- 触发条件：复合层载荷里把命令放进变量（`tools.bash({command: someVar})`）。
- 影响：复合层取不到命令文本 ⇒ 这条调用在复合层**判不了**（不拦）；真正执行时靠内层 bash 自己的 PreToolUse 拦（判定对象是真实实参）。
- 复现步骤：① 复合层载荷写成 `const c = '…'; await tools.bash({ command: c });`；② 复合层放行；
  ③ 内层 bash 载荷带上真实命令串时被拦。
- 证据：`plugin/scripts/lib.mjs` 的 `firstStringArg()`（取不到字面量就返回空串）；契约 S3「容器调发的派发事实」一节。
- 状态：已复现（读码 + 实现取舍）→ **已记为诚实边界**：复合层保持「不判」是对的
  （自由文本代码取不到目标不构成失守），但必须在报告与注入里把这条边界写清，不留成隐性缺口。
- 修法方向：边界要写出来；复合层是**纵深防御的加成**，判定落点仍在内层通道。
- 还需要什么：无。
- 来源：机制修复轮 N-04 ｜ 严重度：P3 ｜ 归属层：机制层

### D-77
- 触发条件：两个进程**同时**对派工台账做「读 → 改 → 写」。台账的写方有五个：`dispatch.mjs`（登记派工）、
  `guard.mjs`（写绑定、记越界）、`scope-amend.mjs`（批准/拒绝/提权）、`release-slot.mjs`（释放名额）、`watchdog.mjs`（派工收尾）。
- 影响：**丢记录，而且是静默丢** —— 丢的是「在飞派工」那一条时，「组队冲突」闸门就看不见它 ⇒
  另一个 worker 可以被派去写**同一处**，两个 worker 互相覆盖、验收也无从判断谁的改动生效 ——
  这正是闸门本身要防的那件事。同一批丢掉的还有那条派工的 tier 快照与教训注入
  （边界会退化成「只按 transcript 里的 brief 重建」，scope 仍拦，但 lessons 不注入）。
- 复现步骤：① 同时开两个进程各写一次台账（各读一次 → 各加一条 → 各写一次）；
  ② 后写的那个把先写的记录覆盖掉；③ 台账里少了一条，但文件**格式合法、内容看着正常** —— 读侧检测不出来。
- 证据：**活体**（本轮实测）—— 本会话派出的 `sa-mechanism-fix`（D-72 watchdog 那单，子会话 `mvs_12c5c8cfcb574787af7942acde493632`）
  **在台账里根本没有记录**（台账 38 条里查不到它的 dispatch_id / scope / session），而该子会话确实在跑、确实在改文件。
  代码侧：`plugin/scripts/lib.mjs` 的 `writeLedger()` 是裸 `fs.writeFileSync` —— **无锁、无临时文件+原子替换、无回读校验**。
  对照：D-52 已经给错题本的写路径上了「跨进程锁 + 临时文件 + 回读校验 + 回滚」，**派工台账这条写路径没有同款待遇**。
- 状态：已复现（活体 + 读码）→ **已修（v0.5.6，D-77 修复轮，待独立复验）**：
  `lib.mjs` 新增 `withLedgerLock()`（排他创建锁文件 `wx` = 原子地「只有一个人拿到」）与
  `updateLedger(mutator)` 统一写入口 —— **锁内重新读盘** → 锁内改 → 同目录临时文件 + 原子 rename →
  回读校验（逐字一致）→ 不一致即**回滚到写前状态**并报错（规则编号 `R-LEDGER-VERIFY-FAILED` 等，
  断言按编号指认命中的是哪条规则，不按文案关键词）。
  五个写方共 11 处 `writeLedger()` 调用全部改走统一入口；dispatch 的**组队闸门 2/3 判定整体搬进临界区**
  （以前「读台账→判定→写台账」不是原子的，两个并发派工可以同时通过冲突检测）。
  watchdog 只碰台账写路径，D-72 的四层产出判定一字未动。见 `docs/audit/fix-d77.md`。
- 修法方向：**读-改-写必须整体串行化**，光把「写」做成原子替换不够 —— 后写的进程拿到的仍是旧快照。
  正确形态是提供一个 `updateLedger(mutator)` 之类的入口：取跨进程锁 → **重新读盘** → 在锁内做修改 → 临时文件+原子替换 → 回读校验 → 释放；
  五个写方全部改走这个入口（锁与原子写可复用 `lessons.mjs` 已有的那套，见 D-52）。
- 修法方向（反面）：**不要**靠「写完再读一遍台账，发现少记录就补」来兜底 —— 补写的那条已经被覆盖的记录可能带着错误的字段，补回去反而更糟。
- 还需要什么：锁的持有时间要短（台账文件小，锁住「读+改+写」这一小段即可），别把网络/子进程调用放进临界区。
- 来源：v0.5.6 活体实测（父会话核对派工台账时发现） ｜ 严重度：P1 ｜ 归属层：机制层

### D-82
- 触发条件：Windows 上存在「`super-agent-router`」与「`super-agent-router `」（**末尾多一个空格**）两个目录 ——
  Windows 允许目录名带尾随空格，两者可以同时存在。
  判据 `isPluginOwnDataDir()` 原本先对整条路径 `trim()` 再取 `basename` ⇒ 尾随空格被吃掉 ⇒
  带空格的目录被误判成插件专属数据目录。
- 影响：运行时若 `PLUGIN_DATA` 指向那个（空的）目录，`readLedger()` 读到的是**空台账** ——
  **格式合法、内容看着正常**，读侧检测不出来 ⇒
  「记录丢了 ⇒ 视同没有在飞派工」⇒ **冲突检测与名额检测全盲**（D-10 那一族的静默失效）。
  另外：那个目录会被当成账号事实来源（`accountAgentsRoot()` 复用同一判定），
  于是账号成员名单也可能被指到错误的根上。
- 复现步骤：① 建目录 `…/hooks/super-agent-router `（尾随空格）；② `isPluginOwnDataDir('…/hooks/super-agent-router ')` 返回 **true**；
  ③ 该目录里没有台账 ⇒ `readLedger()` 返回空数组但 `readable: true`。
- 证据：**活体**（本轮实测）—— 父会话用 `cmd /c 'set PLUGIN_DATA=…'` 喂环境变量时，cmd 把**尾随空格带进了变量值**，
  实际创建了第二个目录；随后清理该目录时，`mavis-trash.cmd` 的 `%*` 传参把尾随空格 **trim 掉**，
  导致**误删了正常的那个目录**（台账文件 `dispatches.json` 一度消失）—— 已从回收站完整恢复
  （39 条派工 / 41 条 binding / 61 条待审请求，计数与原值一致）。
- 状态：已复现（活体 + 读码）→ **已修（v0.5.6，父会话）**：判定改为「先剥尾部分隔符、**不剥空格**，再按目录名逐字比」；
  补 5 条专属断言（`tests/scope-test.mjs`，指向**仓库副本**而非安装副本，避免部署时差造成假红）。
- 修法方向：**目录名的比较必须逐字** —— 先 `trim()` 整条路径会把「不同的目录」折叠成「同一个」。
  同族提醒：`path.basename()` **不** trim 尾随空格，这一点很容易被想当然地忘掉。
- 还需要什么：`mavis-trash.cmd` 的 `%*` 传参对**尾随空格路径**不可靠（会 trim），
  且它会**删错目录**（把 trim 后的路径当成目标）—— 这属于宿主工具的缺陷，
  父会话已用「直接调 `mavis-trash.js`」绕过，但**根治要宿主侧修**（用 `%*` 的引号传参或改用 stdin）。
- 来源：v0.5.6 收尾实测（父会话清理重复目录时误删真台账并当场发现） ｜ 严重度：P1 ｜ 归属层：机制层

### D-83
- 触发条件：只读条目写作 `ro: docs/other.md`，而请求路径写作 **`./docs/other.md`** 或 **`docs//other.md`**
  （指向同一个文件，写法不同）。
- 影响：升级检测按路径**写法逐字**比较 ⇒ 别名写法**匹配不上** ⇒ 授权确已升级为可写，
  但回执 `upgraded_paths` 为空、变更账无升级标注 ⇒ **D-75 刚堵上的「静默升级」以别名形态复活**。
- 复现步骤：① 项目内存在只读条目 `ro: docs/other.md`；② 会话请求写 `./docs/other.md`；
  ③ 管理员 `--grant` 批准 ⇒ 升级生效，但回执 `upgraded_paths` 为空。
- 证据：`docs/audit/fix-d75.md` §7 N-01；探针 `docs/audit/.tmp-d75/probe-forms.mjs`（修复前 `./` 与 `//` 写法不命中、修复后命中）。
- 状态：已复现 → **已修（v0.5.6，D-75 修复轮）**：新增 `canonicalPathKey` / `canonicalScopeEntries`，
  升级检测在**归一后的条目**上判定（仍复用 `inScope` / `readOnlyScopeHit`，不另起一套匹配口径）；
  变更账去重键同步改为归一路径，避免同一文件不同写法重复记账。
- 修法方向：**「是不是同一个文件」不能用字符串相等判** —— 同族教训与 D-75 那轮自查发现的两条同源。
- 还需要什么：`canonicalPathKey` **不解析 `..`**（故意不解析，避免把 `../x` 与 `x` 误判成同一文件 ——
  把不存在的升级写进回执，比漏写更危险）。这是诚实边界。
- 来源：D-75 轮 N-01 ｜ 严重度：P2 ｜ 归属层：机制层

### D-84
- 触发条件：变更账写入失败（权限 / 磁盘 / 路径问题）而**批准本身成功**。
- 影响：口径「变更账必须写明升级」在写失败时**静默失效** ⇒ 回执无任何提示 ⇒
  读回执的人以为「已记账」，实际账上没有 ⇒ 等价于静默放行。
- 复现步骤：① 制造变更账写失败（如把变更账设为只读 / 指向不可写路径）；
  ② 执行 `--grant` 批准；③ 批准生效，但回执里没有任何「没记上」的提示。
- 证据：`docs/audit/fix-d75.md` §7 N-02；改动前 `scope-amend.mjs` 两分支均未使用 `appendChangeLog()` 的返回值。
- 状态：已复现 → **已修（v0.5.6，D-75 修复轮）**：回执新增 `audit_logged: boolean`，
  `--grant` 与 `--dispatch --add` 两处都接住返回值，写失败必须报出。
- 修法方向：**「尽力而为的留痕」必须能看出它没成功** —— 静默吞掉失败 = 留痕承诺作废。
- 还需要什么：变更账写失败时**批准不回滚**（避免半回滚），仅回执报 `audit_logged: false`；
  此时回执与账本可能不一致，需人工看该字段 —— 这是诚实边界，不是漏判。
- 来源：D-75 轮 N-02 ｜ 严重度：P2 ｜ 归属层：机制层

### D-85
- 触发条件：bash 命令里带 **`> /dev/null`** 这类重定向到空设备（Windows 上是 `> NUL`）。
- 影响：`extractWriteTargets()` 把 `/dev/null` 当成写目标 ⇒ 护栏判它「不在白名单内」⇒
  台账里记一条**越界请求** ⇒ 管理员的待审清单多一条**用不上的**噪声（空设备既不在工作区、也不该被当成项目资产），
  **并且可能把真正的越界请求淹在噪声里**。
  ⚠️ 更正（v0.5.6 独立复验 F-05 实测）：这条请求**是能被批准的** —— `--grant` 返回 `ok:true`、`added:["/dev/null"]`、`audit_logged:true`，
  即空设备会被真的写进 scope。**因此残余不是「永远无法批准」，而是「批准它毫无意义 + 拦截文案给出的批准命令是无意义的」** ——
  按旧表述去修会修错方向。
- 复现步骤：① 任意 bash 命令写成 `node xxx.mjs > /dev/null`；② 护栏放行（full 等级）或记账（其它等级）；
  ③ `scope-amend.mjs --list` 里出现 target = `/dev/null` 的待审项。
- 证据：v0.5.6 收尾实测的台账待审项 `req_mwasyzrh_v934wl`（父会话实际收到并处理过）。
- 状态：已复现 → **已修（v0.5.7）**：空设备（`/dev/null` / `/dev/zero` / `/dev/stdout` / `/dev/stderr` / `/dev/stdin` / `NUL` / `$null`）从**写目标提取**与**判定对象**两处剔掉 —— 不再记越界请求，也不再给出无意义的批准命令；真实路径越界照拦、真实写动词仍算写、重定向目标解析不出仍兜底拒绝。
  **诚实边界**：① 只堵「产生侧」—— 台账里**已有**的历史 `/dev/null` 待审项仍需人工在待审清单里拒绝；② `dd of=/dev/null` 这种 `of=` 参数形态仍判 DENY（保守方向）；③ `tee /dev/null` 由 DENY 变 ALLOW（用户可观测的行为变化）；④ `/dev/urandom` 与 `/dev/random` 是真实设备，**刻意不收**。
- 修法方向：**空设备不是写目标** —— 从写目标提取里排除 `/dev/null`、`/dev/stdout`、`/dev/stderr`、`NUL`。
  这与「取不到目标就拒绝」那条规则同源：判定要认得**形态**，不是靠列举。
- 还需要什么：排除清单要同时覆盖 POSIX 与 Windows 两种写法（`NUL` 大小写不敏感）。
- 来源：v0.5.6 收尾实测（父会话）+ v0.5.6 独立复验 F-05 ｜ 严重度：P3 ｜ 归属层：机制层

### D-78
- 触发条件：交付文本里同一**行**既有产出动词、又有与该动词无关的路径 —— 典型是**引用护栏自己的拒绝原文**（原文含「如确需修改」+ 越界路径），或同一行里先写「输出 X」再写「Y 不存在」。
- 影响：该行里**所有**路径都被当成「声称产出」⇒ 存在性校验失败 ⇒ 诚实的报告被 block。
  与 D-72 的否定式触发条件**互相独立**（不需要任何否定词），也不需要子句分隔符。
- 复现步骤：交付文本写一行「已创建 src/real.ts。护栏拒绝原文：……以下路径不在白名单内：docs/audit/ghost.txt。如确需修改……」（真实例子见活体 report-1）→ watchdog 要求 `docs/audit/ghost.txt` 存在。
- 证据：活体子会话 `mvs_73441ff316ed4d2db69fe88e9b17eeb3`，2026-11-10T13:05:07.914Z 的 block 消息；改前实现 `plugin/scripts/watchdog.mjs` 的 `claimedPaths()`（行过滤 → 剥引用子句 → **拼行**后抽路径）。
- 状态：已复现 → **已修（v0.5.6，D-72 修复轮）**：路径归属从「行」改成「**子句**」—— 路径由它所在子句里的产出动词认领，认领它的动词若非断言则该路径不是声称产出。
- 修法方向：路径归属的粒度必须与判定单元一致 —— 判定已经按「否定式 / 非断言语境」分到子句级，归属却还停在行级，两层粒度不一致 ⇒ 词表判对了也会被归属层拖回误拦。
- 还需要什么：无，代码路径已确定。
- 来源：D-72 轮 N-01 ｜ 严重度：P2 ｜ 归属层：机制层

### D-79
- 触发条件：watchdog 的四条 block 消息都不带规则编号 —— 收到 block 的人（成员、父会话、验收方）无法区分「空交付」「无证据」「声称产出但文件不存在」「条目格式不合规」。
- 影响：诊断只能靠猜文案关键词；验收断言若只判「被拦」，就会在命中**别的**分支时假绿（同族教训 D-70：「断言要能指认是哪条规则在拦」）。
- 复现步骤：跑一条只命中 `R-NO-EVIDENCE` 的载荷（如「搞定了，测试通过」）与一条只命中 `R-CLAIM-PATH-MISSING` 的载荷 → 改前两条消息除了内容不同、没有可机器识别的标识。
- 证据：改前 `plugin/scripts/watchdog.mjs` 的 `block(reason)` 只有 `{decision, reason}`；改后消息形如 `[super-agent-router] [规则 R-NO-EVIDENCE] ……`。
- 状态：已复现 → **已修（v0.5.6，D-72 修复轮）**：四条 block 消息各带稳定的规则编号（`R-CLAIM-PATH-MISSING` / `R-NO-EVIDENCE` / `R-EMPTY-DELIVERY` / `R-ENTRY-FORMAT`），断言按编号判定而不是按文案关键词判定。
- 修法方向：**可机器识别的规则编号**是断言能「指认命中哪条规则」的最低条件 —— 文案会变，编号不会。
- 还需要什么：无，代码路径已确定。
- 来源：D-72 轮 N-02 ｜ 严重度：P3 ｜ 归属层：机制层

### D-80
- 触发条件：交付文本里出现**家目录写法**的路径（`~/` / `$HOME/` / `%USERPROFILE%/`），而 `lib.mjs` 的 `absolutizePath()` **不展开家目录** —— 它只认盘符与 `/` 开头，其余一律拼到工作区根下。
- 影响：**真实存在的文件被判成「不存在」** ⇒ 路径存在性校验失败 ⇒ 诚实的报告被 block。活体证据：本轮修复完成后的交付报告被当场拦下，被判「不存在」的正是**确实存在**的安装副本 `~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs`。
- 复现步骤：交付文本写「已创建 ~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs」→ watchdog 要求 `<工作区根>/~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs` 存在 → 必拦。
- 证据：`docs/audit/fix-d72.md` §2.2 的 block 消息（活体）与 `docs/audit/.tmp-d72/real-root-repro.mjs` 的逐字复现；代码位置 `plugin/scripts/lib.mjs` 的 `absolutizePath()`（不展开 `~`）与改前 `plugin/scripts/watchdog.mjs` 的 `claimedPaths()`。
- 状态：已复现 → **已修（v0.5.7）**：家目录展开**下沉**到 `lib.mjs` 的 `absolutizePath()` 内部 —— 展开发生在「拼工作区根」**之前**，调用方不必各自记得展开；`expandHomePath(p, home)` 的签名与语义未变；取不到家目录时退回「不展开」，不造路径。
  **诚实边界**：**用户可见症状本次没有翻转** —— watchdog 链路改前改后完全相同（独立验收实测）。这次修的是 **lib 层的潜在复发口**（下一个拿 `absolutizePath()` 判存在性的脚本会重蹈覆辙），**不是**「此前家目录写法会被误拦」。
- 修法方向：**家目录展开是判定的一环，不是字符串美化** —— `guard.mjs` 侧早就因此把 `expandHomePath()` 抽成纯函数（见 **D-65 的修复轮**：判定锚点换成插件包身份后，把家目录展开抽成纯函数 `expandHomePath()`；以及 **D-70**：上一轮「四种家目录写法都被拦」的断言是假绿），存在性校验这一侧漏了；应把展开放进「解析成绝对路径」的那一步，而不是每个调用方各自记得展开。
- 还需要什么：无。已下沉到 `absolutizePath()` 内部（v0.5.7），并把该硬规矩写进契约 S8.1 第 3 条。
- 来源：D-72 轮 N-03 ｜ 严重度：P2 ｜ 归属层：机制层

### D-81
- 触发条件：交付文本里出现**通配符路径**（`src/*.ts`、`.../sha256-tree-v1-*/scripts/watchdog.mjs`）—— 改前的路径正则字符类里没有通配符，路径 token 会**从中间被截断**。
- 影响：截出来的碎片（`.../sha256-tree-v1-*/scripts/watchdog.mjs` → `/scripts/watchdog.mjs`）被当成「声称产出的文件」→ 必假 → 诚实的报告被 block；碎片还可能被当成**工作区外**的路径，指认一个成员根本没提过的文件。
- 复现步骤：交付文本写「已创建 ~/.minimax/v2/plugin-hook-cache/sha256-tree-v1-*/scripts/watchdog.mjs」→ watchdog 要求 `/scripts/watchdog.mjs` 存在 → 必拦。
- 证据：`docs/audit/fix-d72.md` §2.2 的 block 消息（活体，第二个被判「不存在」的路径就是那个碎片）；代码位置改前 `plugin/scripts/watchdog.mjs` 的 `PATH_TOKEN`（字符类无 `*?`）。
- 状态：已复现 → **已修（v0.5.6，D-72 修复轮）**：通配符进路径字符类（模式被**整体**认出来，不再截断），且含通配符的 token 是**模式**、不是文件，不参与逐文件存在性校验。
- 修法方向：**模式不是文件** —— 逐文件的存在性校验对 glob 没有意义，判它「不存在」必然是假阳性；但模式必须被整体识别，否则截断碎片会继续冒充文件。
- 还需要什么：glob 声明（「已创建 src/*.ts」）目前**不做**「至少命中一个文件」的校验 —— 这是诚实的边界，不是漏判：逐文件的产出核对不适用于模式。若父会话认为需要，应另立一条「模式至少命中一个」的规则并单独断言。
- 来源：D-72 轮 N-04 ｜ 严重度：P2 ｜ 归属层：机制层

### 本轮新增 D-44~D-85 的修复状态（待复验）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-44 | 已修（待独立复验） | sa-mechanism-fix |
| D-45 | 已修（待独立复验） | sa-mechanism-fix |
| D-46 | 已修（待独立复验） | sa-mechanism-fix |
| D-47 | 已修（待独立复验） | sa-mechanism-fix |
| D-48 | 已修（待独立复验） | sa-mechanism-fix |
| D-54 | 已修（待独立复验） | sa-mechanism-fix |
| D-58 | 已修（待独立复验） | sa-mechanism-fix |
| D-49 | 已修（待独立复验） | sa-gate-integrity |
| D-50 | 已修（待独立复验） | sa-gate-integrity |
| D-51 | 已修（待独立复验） | sa-gate-integrity |
| D-52 | 已修（待独立复验） | sa-gate-integrity |
| D-53 | 已修（待独立复验） | sa-gate-integrity |
| D-55 | 已修（待独立复验） | sa-gate-integrity |
| D-56 | 已修（待独立复验） | sa-gate-integrity |
| D-57 | 已修（待独立复验） | sa-gate-integrity |
| D-59 | 已修（待独立复验） | sa-gate-integrity |
| D-60 | 已修（待独立复验） | sa-gate-integrity |
| D-61 | 已修（待独立复验） | sa-gate-integrity |
| D-62 | 已修（待独立复验） | sa-gate-integrity |
| D-63 | 已修（待独立复验） | 父会话（部署工具） |
| D-64 | 已修（待独立复验） | 父会话（测试夹具） |
| D-65 | 已修（待独立复验） | sa-mechanism-fix |
| D-66 | 已修（待独立复验） | sa-gate-integrity |
| D-67 | 已修（父会话） | 父会话（台账） |
| D-68 | 已修（待独立复验） | sa-mechanism-fix |
| D-69 | 已修（父会话） | 父会话（派工上限） |
| D-70 | 已修（待复验） | sa-mechanism-fix |
| D-71 | 已修（父会话） | 父会话（权限留痕对齐） |
| D-72 | 已修（待独立复验） | sa-mechanism-fix（watchdog 否定式判定） |
| D-78 | 已修（待独立复验） | sa-mechanism-fix（子句级归属） |
| D-79 | 已修（待独立复验） | sa-mechanism-fix（block 规则编号） |
| D-80 | 已修（v0.5.7，**已独立复验 PASS** — `verification-v061.md`） | sa-mechanism-fix（展开下沉到 absolutizePath 内部） |
| D-81 | 已修（待独立复验） | sa-mechanism-fix（通配符按模式整体识别） |
| D-82 | 已修（待独立复验） | 父会话（目录名逐字比较 + 5 条专属断言） |
| D-75 | 已修（待独立复验） | sa-mechanism-fix（升级显式留痕 + 别名归一） |
| D-83 | 已修（待独立复验） | sa-mechanism-fix（路径写法归一） |
| D-84 | 已修（待独立复验） | sa-mechanism-fix（audit_logged 不静默） |
| D-85 | 已修（v0.5.7，**已独立复验 PASS** — `verification-v061.md`） | sa-mechanism-fix（空设备从写目标与判定对象里排除） |
| D-73 | 已修（待独立复验） | sa-mechanism-fix（三态存在性 + 降级口径，父会话裁决降级成立条件） |
| D-74 | 已修（父会话） | 父会话（hooks 危险 matcher 对称） |
### D-86 的修复状态（2026-11-12，独立复验两轮 PASS；**活体拦截证据待客户端重启后补**）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-86 | 已修（独立复验两轮 PASS：语义变异体均恰好对应断言转红 / 60 份真实 transcript 误拦 0；先前写「12+10 变异体全红」但仓库内无这 22 个变异体实体，已改为可核口径）；**活体拦截仍未取到（D-91 已修 ⇒ 阻断原因不再是「机制错位」，下一步是「装进插件目录 → 重启客户端 → 重跑活体探针」）** | sa-mechanism-fix（无进展重复调用闸门 `loop-gate.mjs`；D-91 修法同属本专项） |
### D-87 的状态（2026-11-12，已复现未修）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-87 | 已复现（未修） | **暂不排期**（2026-11-12 用户决定：v0.5.9 就此收口；将来若开，版本号 **patch = v0.5.10**） |
| D-76 | 已记为诚实边界 | — |
| D-77 | 已修（待独立复验） | sa-mechanism-fix（统一写入口 + 锁内重读 + 回滚） |
### D-88 的状态（2026-11-12，已复现；**本仓库侧告知已做**；宿主侧未修）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-88 | 已复现 → **宿主侧行为已实锤**（客户端重启后活体树确实换到含 `loop-gate.mjs` 的新树 `1212d9fa…`，「必须重启才生效」由推断升级为已证；**宿主侧本身仍不可修**）；**本仓库侧已做（v0.5.8）**：install.ps1 / 根 README / plugin README / CHANGELOG 四处均写明「升级后必须重启客户端」并给出自证办法 | 父会话（派工 + 文档口径） |
### D-89 的状态（2026-11-12，已复现；待派工给机制专项）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-89 | 已复现（未修 —— matcher 漏 `task_append` + 追加轮无身份来源） | **暂不排期**（2026-11-12 用户决定：v0.5.9 就此收口；将来若开，版本号 **patch = v0.5.10**） |
### D-90 的状态（2026-11-12，已复现未修）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-90 | 已复现（未修 —— 工具口径缺口：`ledger-check` 不比状态文字；修法要动 `ledger-check.mjs` 与 `tests/ledger-test.mjs`，需单独一轮并由独立验收方复验） | **暂不排期**（2026-11-12 用户决定：v0.5.9 就此收口；将来若开，版本号 **patch = v0.5.10**） |
### D-91 的状态（2026-11-12，已修，独立复验在飞）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-91 | **已修（独立复审第 4/5 轮均达成判定；收尾轮补断言；发布复审 PASS-with-conditions）** —— 择一计数（`pickNamespace()` :345）+ 绝不混数 + 不可比即打断不计（`innerComparable()` :321）；父会话已独立复跑 + **独立复审第 4 轮 PASS（机制层，AC1~AC8 全达成）**：44 条断言全 PASS、全量 **14 套 / 897 条 / 0 FAIL**、夹具与真实 transcript 字节级前缀一致（32239 B 全等）、真实回放内层第 6 次 DENY / 外层第 6 次 DENY / grep 连跑 29 次仍 ALLOW。**活体拦截证据仍未取到**（需装 + 重启客户端 + 重跑探针）。**复审附带的覆盖缺口**：① 「不可比边界」这条语义**仓库里零断言钉住**（变异体 M2/M4/M8 全绿）—— 实现经复审自造夹具 F1/F2 证明正确 ⇒ 是**覆盖缺口非功能缺陷**；② PTC 路径只有 1 条可证伪断言（M1/M6/M7 三种语义全红同一条）⇒ 红/绿无法定位是哪层坏了。 两条待补断言**已补**：收尾轮新增 10 条（44 → 54），再经 D-93 抗负载改为 **55 条**；6 个语义变异体各有**专属锚点**（择一 / 取内层 / 可比性三层可分别观察），变异矩阵定义已落盘 `tests/fixtures/d91-mutation-matrix.md`（矩阵**串行**跑、MISS = 0）。 | sa-mechanism-fix（无进展重复调用闸门 `loop-gate.mjs`） |
### D-92 的状态（2026-11-12，已修【协议层】；程序层待做）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-92 | **已修（协议层）**：契约新增 S4.6「一个项目一个窗口（项目级覆盖检查）」+ `SKILL.md` 铁律第 9 条 + 复用登记表补「项目」维度；**程序层未做**（派工台账还没有「项目键」，复用提示仍只说「有 N 个会话覆盖」而不指出该追加哪一个） | 协议层：父会话（已做）｜ 程序层：**暂不排期**（2026-11-12 用户决定：v0.5.9 就此收口；将来若开，版本号 **patch = v0.5.10**；与 D-89 同轮对齐台账 schema） |
### D-93 的状态（2026-11-12，已复现未修）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-93 | **已修（v0.5.9）** —— 性能断言改为 **min-of-7 取最小值 + 与同规模小基线的相对倍数（≤ 20×）**，**阈值 2000ms 未动**（不靠抬阈值换稳定）；实测：空闲 min 81ms / 倍数 1.62；**满载（24 忙循环占满 8 核）单次采样最高 3436ms 必越阈，而 min-of-7 = 1291ms、倍数 1.00 ⇒ 断言绿**；两种负载下套件均 **55 PASS / 0 FAIL**，全量 **14 套 / 898 条 / 0 FAIL**。**D-87 / D-89 / D-92 程序层仍未做**（另轮） | sa-mechanism-fix（性能断言） |
### D-94 的状态（2026-11-12，已复现未修）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-94 | 已复现（未修 —— 「版本号四处一致」与 README 结构数字都缺自动化断言） | **暂不排期**（2026-11-12 用户决定：v0.5.9 就此收口；将来若开，版本号 **patch = v0.5.10**） |
### D-95 的状态（2026-11-12，已修（发布前））

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-95 | **已修（v0.5.9 发布前）** —— CHANGELOG 改为「真实 transcript 是**跨行交替**（同含行 = 0）」的实话，并单列合成夹具的用途与「真实中不存在」标注；两份 README 相关表述同步；用户视角那句「它会被拦下来」收紧为「**按已坐实的判定逻辑**」并当场点出「活体拦截证据仍未取到」。**遗留**：尚无自动化断言挡住「文档口径与原始数据不符」（与 D-94 同族，留下一轮） | 契约层：父会话（已做）｜ 自动化断言：待派工 |
### D-96 的状态（2026-11-12，已修（发布前））

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-96 | **已修（v0.5.9 发布前）** —— 索引表 D-91 / D-93 / D-92 三条长行**合并回单行**并补上收尾竖线，索引表恢复为**一个连续块**（100 行），统计口径同步为 **100 条**。**遗留**：`ledger-check` 仍只取第一块（`blocks.find()`），**尚无「索引表必须只有一个连续块」的检查**（下一轮与 D-90 / D-94 同批做） | 契约层：父会话（已做）｜ 工具层检查：待派工 | **本轮沿用的一条纪律**：D-44 与 D-49 属「脚本层绕过」（worker 落盘脚本后脚本内部的 fs 写入不受 hook 约束）。 契约 S13.5 已声明「hook 是护栏不是沙箱」，但 README/契约里曾写着「worker 无权改自己的等级」这种**指不到一行代码**的断言 —— 本轮的收口方式是：**要么在代码里封堵到能指到一行，要么把断言改成与 S13.5 一致的措辞**，两条路都不接受「文档说有、代码没做」。 （D-44 / D-49 的最终状态以修复报告与独立复验为准；台账状态由父会话在收到报告后逐条更新，不接受成员自述。） |
### D-97 的状态（2026-11-12，已复现未修）

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-97 | **已复现（未修）** —— v0.5.9 装好 + 重启客户端后**活体证实**：缓存树换绑 `sha256-tree-v1-6a84c9cb…`（与仓库逐字节一致）、guard 在全新子会话**当场拦下**越界写（带出活体树路径）⇒ **hook 链活着、升级确实生效**；但 **loop-gate 在活体 6 次逐字相同调用下仍零拦截** —— 根因：**宿主喂给 hook 的 `transcript_path` 是 Claude 兼容投影**（`%TEMP%/minimax-plugin-hooks/transcripts/<sha256(sessionId).slice(0,32)>.compatible.jsonl`），**里面没有 `details.ptc.child_calls[]`**、tool call 又是 `tool_use`/`input` ⇒ 解析器在活体文件上 owned=0 ⇒ 连续数恒 0；D-91 的夹具取自会话 `messages.jsonl` ⇒ **夹具与运行时形态不同源**（单元测试绿、活体零拦截）。**D-91 的修法方向正确，错在输入文件取错。** | sa-mechanism-fix（无进展重复调用闸门 `loop-gate.mjs`；与 D-91 同族，**是否开这一轮由用户拍板，版本号由用户定**） |
### D-98 的状态（2026-11-12，已复现（宿主侧不可修））

| 台账号 | 状态 | 责任专项 |
|---|---|---|
| D-98 | **已复现（宿主侧不可修）** —— 客户端重启后，**续接的旧子会话**里插件 PreToolUse 的两道闸门**都不生效**（越界写当场放行、重复调用闸门不拦），**同一时刻新建的子会话**两道都生效；本地用同一份绑定回放两个会话 ⇒ 判定**逐字相同（都 deny）** ⇒ 差别在宿主侧派发，不在插件代码。**本仓库侧要做的**：① 活体验证一律**新建子会话**，不许拿续接会话当活体证据；② 对外文档如实交代这条宿主边界 | 宿主侧（**本仓库不可修**，留证据 + 操作规则）｜ 父会话：把操作规则写进本项目验证纪律 |

