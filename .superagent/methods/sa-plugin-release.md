# sa-plugin-release

## 归属

插件包版本发布：把版本号、描述、变更记录、发布说明与**包内自洽性**一次做对，
并给出可复核的一致性证据。不是「改改文案」，是「让发布出去的东西经得起对照」。

## 适用

- 插件包有改动需要升版
- CHANGELOG 缺失，或与实际改动脱节
- 怀疑包内引用已经对不上：hooks.json 指向的脚本不在了、plugin.json 声明的文件名变了

## 不适用

- 改 Hook 判定逻辑本身（guard / dispatch / gate 的规则）—— 那是机制改动，不是发布
- GitHub 推送等对外可见动作 —— 按协议由 Router 发起，worker 不碰
- 业务代码改动

## 方法

1. 读 `plugin/.minimax-plugin/plugin.json`，确认当前版本号与当前描述。
   描述要反映**这个版本真实做了什么**，不是上一版换了句话。
2. 读 `plugin/hooks/hooks.json`，把它引用的每一个脚本路径与 `plugin/scripts/`
   下的实际文件逐个对照。**缺任何一个都要报出来**，不能视而不见 ——
   引用悬空是包不自洽最常见的一种。
3. 版本号按语义化递增：破坏性变更升 minor，纯新增或修复升 patch。
   把本次行为变更摘要写进 `description`，只写真正落地的能力。
4. 写 CHANGELOG。每条必须含三要素：**改了什么 / 为什么 / 怎么验证**。
   「优化了若干问题」这种句子不可复核，不许写。
5. 写面向使用者的 README：装在哪、怎么装、怎么确认 Hook 真的生效、
   不生效时按什么顺序查。写用户视角，不写开发视角。
6. 自检三件事：版本号在 plugin.json 与 CHANGELOG 顶部一致；
   hooks.json 引用的脚本都存在；README 没有承诺尚未实现的能力。

## 验收清单

- [ ] plugin.json 的 version 与 CHANGELOG 顶部条目版本号一致
- [ ] plugin.json 的 description 覆盖本次全部行为变更，且未承诺未实现的能力
- [ ] CHANGELOG 每条都含「改了什么 / 为什么 / 怎么验证」三要素
- [ ] hooks.json 引用的每个脚本在 plugin/scripts/ 下都真实存在
- [ ] README 说明安装位置、启用验证方法、故障排查路径
- [ ] 全程只改动 SCOPE 内的文件

## 易错

- 只看 plugin.json 不看 hooks.json，引用悬空查不出来
- CHANGELOG 写成流水账，验收时无法逐条核对
- 版本号在两个文件里各写各的，发布出去对不上
- 把「改了文案」当发布，跳过包内自洽性检查

## 实战记录

<验收通过的成果由 record-gate.mjs 写入；首次为空>

### 2026-11-09 · 插件包版本发布 · 把插件包升到 v0.4.0 并补齐发布说明
- 做法：先核对 manifest 与 hooks.json 引用的脚本是否都存在，再同步版本号与描述、产出 CHANGELOG 与面向使用者的 README；独立验收查出的 5 个问题当场修掉后收窄 brief 重派验收
- 证据：plugin/CHANGELOG.md 顶部 0.4.0 条目与 plugin/README.md；由独立 verifier 复验通过（7 项全过，F-1～F-5 已修）
- 验收：verifier

### 2026-11-10 · 插件包版本发布（版本号 / CHANGELOG / 面向使用者 README / 包内自洽性） · 把插件包升到 v0.5.0 并补齐发布说明
- 做法：先核对 manifest 与 hooks.json 引用的脚本是否都存在，再同步版本号与描述；CHANGELOG 每条含改了什么/为什么/怎么验证；brief 里失实的表述按实际实现改写，复验收尾时又按验收意见收窄修正了复合层措辞
- 证据：plugin/.minimax-plugin/plugin.json version=0.5.0；plugin/CHANGELOG.md +449 行；plugin/README.md +94/-5（含复合层措辞修正 1 行）；docs/audit/verification-v050-recheck.md 的 D1/D2/D3（版本一致、引用脚本全在、README 未承诺未实现能力）
- 验收：verifier

### 2026-11-10 · 插件包版本发布：版本号与描述同步、CHANGELOG 与面向使用者的 README 产出、包内自洽性校验 · 插件包版本发布 v0.5.6（版本号 / CHANGELOG / 面向使用者 README / 包内自洽性）
- 做法：先核对 manifest 与 hooks.json 引用的脚本是否都存在，再同步版本号与描述；CHANGELOG 每条含改了什么/为什么/怎么验证；README 写用户视角并如实交代 D-80 残余与 D-76 设计边界；发布说明写在可写目录，正式路径由父会话转写
- 证据：plugin/.minimax-plugin/plugin.json version=0.5.6；plugin/CHANGELOG.md 顶部 0.5.6 段 8 个变更块；plugin/README.md 新增「会话复用：省上下文的纪律」一节与排查清单第 12/13 条；docs/audit/release-v056.md；独立复验 docs/audit/verification-v056.md 判版本/CHANGELOG/README 三项 PASS
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-10T17:17:22.363Z

### 2026-11-10 · 插件包版本发布 v0.5.7（版本号 / description / CHANGELOG / README 诚实边界 / 包内自洽） · 插件包版本发布：版本号与描述同步、CHANGELOG 与面向使用者的 README 产出、包内自洽性校验
- 做法：先核对 manifest 与 hooks.json 引用的脚本都存在，再同步版本号与 description；四处「说反了」的诚实边界一起改（CHANGELOG 的 v0.5.6 历史段原文保留、只在段末追加指向 0.5.7 的一句）；发布说明按验收方实测口径写 —— 不夸大 D-80、不笼统写「空设备一律放行」，两条用户可观测变化都写明
- 证据：plugin/.minimax-plugin/plugin.json version=0.5.7；plugin/CHANGELOG.md 顶部 0.5.7 段；plugin/README.md 新增「空设备：> /dev/null 不再被当成写目标（v0.5.7）」一节与 tee / dd 对照表；docs/audit/release-v057.md；包内自洽 35 条断言 0 FAIL（改前基线跑出 6 条 FAIL，说明不是恒绿空断言）
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-10T22:07:02.407Z

### 2026-11-11 · 插件包版本发布：版本号与描述同步、CHANGELOG 与面向使用者的 README 产出、包内自洽性校验 · 插件包公开发布：一键安装 / 卸载脚本 + 安装脚本自测进仓库（v0.5.7 公开分发）
- 做法：先把安装/卸载的每条行为写成断言再动脚本；尾随空白与路径非法字符一律 fail closed，绝不静默改写用户给的路径；自测条数用机器标记与头部、README、实测四方互相对账；每轮修复都由独立验收方按「触发方式」复验，断言必须能被证伪（造变异体确认它会红）
- 证据：独立验收五轮 docs/audit/verification-v062..v066.md（末轮 VERDICT PASS）；安装脚本自测 6 套件 294 条 + 8 条条数对账 0 FAIL，纯 ASCII 与含空格含中文两种 TEMP 形态均绿；插件回归 13 套 836 条 0 FAIL；GitHub Release v0.5.7 已发布（仓库已转 public）
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-11T06:15:02.168Z

### 2026-11-12 · 插件包版本发布：版本号与描述同步、CHANGELOG 与面向使用者的 README 产出、包内自洽性校验 · 发布 v0.5.10：修 D-99 安装器幂等判断（同版本改码重装不生效），并公开发布 GitHub Release
- 做法：幂等判断从「版本号相等」改成「逐文件 SHA256 内容相等」，复用安装器已有的 Get-FileMap / Compare-FileMaps，另加 -Force；先把每条行为写成断言再动脚本，并配语义变异对照证明断言会红；发布走 git archive 打 zip（内容严格 = 该 commit 的 tree）再发 Release。
- 证据：install.ps1 第 6 节 :331-360；tools/install-selftest/install-idempotency-test.ps1（24 条断言，退回版本号口径的变异体必红）+ run-all.ps1（7 套件 / 331 条 / 0 FAIL）；plugin/CHANGELOG.md 的 0.5.10 段；docs/audit/release-v0510.md、docs/audit/verification-v0510.md（VERDICT PASS_WITH_CONDITIONS）；GitHub Release v0.5.10（tag c3586a70d7，资产 1,722,102 B，185/185 blob sha 一致）
- 验收：verifier
- 写入者：parent:mvs_9bdda202ae274c909a5b4352fc45a471 · 会话 mvs_9bdda202ae274c909a5b4352fc45a471 · 2026-11-12T11:53:12.780Z

