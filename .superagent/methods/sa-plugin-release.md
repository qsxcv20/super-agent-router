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

