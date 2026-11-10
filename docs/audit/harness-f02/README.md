# F-02 变异检验工装（进版本库，理由：证据链不能住在会被忽略的目录里）

上一轮这套工装放在 §docs/audit/.tmp-f02/§，而 §.gitignore§ 的 §docs/audit/.tmp-*/§ 规则把它排除了 ——
于是「变异表 + 检验脚本」不会进版本库，第三方无法复跑，证据链断在仓库外。
本目录是它的**受版本控制的副本**（路径深度与原目录一致，脚本里的相对定位无需改动）。

## 怎么跑

```
# 跑全部变异体（先跑基线，再逐个回退 → 对应断言必须变红）
node docs/audit/harness-f02/mutation-check.mjs

# 只跑某几个
node docs/audit/harness-f02/mutation-check.mjs M1 M3
```

## 文件

| 文件 | 作用 |
|---|---|
| §mutation-check.mjs§ | 变异检验主体：把 §plugin/§ 与 §tests/§ 复制到系统临时目录，逐个回退一处修复并跑对应套件，统计变红的断言（**仓库工作树零改动**） |
| §mutations.json§ | 外置的变异定义表（长字符串内嵌在脚本里时转义层数是主要故障源） |
| §run-suite.mjs§ | 在沙箱里跑某个套件的包装 |
| §probe-fault-neutrality.mjs§ | 故障注入钩子的「中性」探针：钩子关 / 空转时落盘逐字节相同、开销在噪声量级 |
| §probe-barrier.mjs§ | 并发写入的屏障探针 |
| §orig-lessons.mjs§ / §orig-records.mjs§ | 变更前的原始片段备份（供对照） |

**故障注入钩子**（§SAR_FAULT_INJECT§，仅测试可见，默认关闭）：
§rename-eperm[:N]§ / §lock-eperm[:N]§ / §verify-fail§；批次号用 §SAR_FAULT_RUN§ 切换。
生产环境请显式清空该变量（见契约 S7）。
