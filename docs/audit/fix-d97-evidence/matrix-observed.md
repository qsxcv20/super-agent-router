
## 实测结果（2026-11-12，node tests/fixtures/d97-mutation-matrix.mjs .）

```
基线：pass=64 fail=0 exit=0
M-D97a 投影口径不生效：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D97b 对齐层恒判不匹配：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-D97c 当前调用被计入（差一）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-D97d 动态参数当可比：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=4
```

读法（与 D-91 矩阵同口径，三列分开）：

- **MISS=0** ⇒ 4 个变异体**全部**被各自的专属锚点断言抓住，没有漏网的语义破坏。
- **EXTRA-RED(2)** 的两个（M-D97b / M-D97c）不是漏网，是**分层断言的正常牵连**：
  破坏「对齐层」或「计数层」时，依赖同一层的端到端断言与阈值边界断言会一起红。
- 输出留档：docs/audit/.tmp-d97/d97-mutation-matrix-output.txt。