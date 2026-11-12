// 成员持久身份口径的专属回归（契约 S16）
//
// 测什么：把「成员的持久层只放通用能力」这条规矩变成**机器能查的东西**。
// 专项成员是运行时创建、永久存在的（账号级 agent.md + 项目级 roster.json），
// 提示词里一旦写进「《人工智能导论》实验一/二/四」「任务书在 Q:\…」「开工前先读 00_共用事实底稿.md」
// 这类一次性内容，成员就被钉死在那一单 —— 别的任务复用不了，下次它还会照着去找一个已不存在的路径。
//
// 断言不许恒绿：每组断言都配了**语义变异体**（tests/fixtures/member-identity-mutation-matrix.mjs），
// 变异体把检测规则退化成旧行为（不检查 / 只查版本号 / 跳过当失败 / 不报行号 / 不查 created_for）
// ⇒ 本套件的**专属断言**必须转红。
//
// 注意：真实账号目录的扫描**不进常驻回归**（它依赖本机状态，别的机器会缺目录）。
// 本套件全部使用**合成夹具**；真实路径的取证由父会话单独执行：
//   node tools/member-identity-check.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_FEATURES, FEATURE_IDS, ROSTER_FIELDS, scanText,
  HOST_CONFIG_KEYS, DELEGATION_MARKERS, PATH_EXEMPTIONS, classifyAgentLines
} from '../tools/member-identity-check.mjs';

const REPO = path.resolve(process.env.SAR_REPO_DIR || process.cwd());
const FIX = path.join(REPO, 'tests', 'fixtures', 'member-identity');
const CHECK = path.join(REPO, 'tools', 'member-identity-check.mjs');
const A = (n) => path.join(FIX, 'agents', n);
const R = (n) => path.join(FIX, 'roster', n);

let fail = 0;
// 详情里的换行必须压掉：断言详情会带子进程（检查器）的原始输出，
// 若原样打印，它的 "FAIL …" 行会**独立成行** ⇒ 被行式扫描器
// （tools/run-tests.mjs 与本单的变异矩阵执行器）误记成套件失败。
const ok = (l, c, e = '') => {
  if (!c) fail++;
  const detail = e === '' ? '' : ' :: ' + String(e).replace(/\r?\n/g, ' | ');
  console.log((c ? 'PASS ' : 'FAIL ') + l + detail);
};

function runCheck(args) {
  const r = spawnSync('node', [CHECK].concat(args), { cwd: REPO, encoding: 'utf8', timeout: 60000 });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
function runJson(args) {
  const r = runCheck(args.concat(['--json']));
  try { return Object.assign({ exitCode: r.code }, JSON.parse(r.out)); }
  catch (e) { return { exitCode: r.code, parseError: String(e), out: r.out }; }
}
const hitsOf = (res) => (Array.isArray(res.hits) ? res.hits : []);
const hasFeature = (res, id) => hitsOf(res).some((h) => h.feature === id);
const featuresOf = (res) => [...new Set(hitsOf(res).map((h) => h.feature))];

console.log('[套件] 成员持久身份口径（契约 S16）：持久层只放通用能力');

// ══════════════════════════════════════════════════════════════
// A. 禁止特征表本身（可枚举 ⇒ 每条都能被单独断言、单独打掉）
// ══════════════════════════════════════════════════════════════
{
  ok('MI-A1 禁止特征是一张可枚举的表（≥ 11 条）', FORBIDDEN_FEATURES.length >= 11,
    '条数=' + FORBIDDEN_FEATURES.length);
  ok('MI-A2 每条特征都有 id / title / group / why / kind 五个字段',
    FORBIDDEN_FEATURES.every((f) => f.id && f.title && f.group && f.why && f.kind),
    JSON.stringify(FORBIDDEN_FEATURES.filter((f) => !(f.id && f.title && f.group && f.why && f.kind)).map((f) => f.id)));
  ok('MI-A3 特征 id 唯一（表里没有两条同名的判据）',
    new Set(FEATURE_IDS).size === FEATURE_IDS.length, FEATURE_IDS.join(','));
  ok('MI-A4 每条特征都写清了「为什么禁」（why 非空且足够长）',
    FORBIDDEN_FEATURES.every((f) => String(f.why || '').length >= 10),
    JSON.stringify(FORBIDDEN_FEATURES.filter((f) => String(f.why || '').length < 10).map((f) => f.id)));
  ok('MI-A5 每条正则型特征的正则都能编译（表里没有写坏的正则）',
    FORBIDDEN_FEATURES.filter((f) => f.kind === 'regex').every((f) => { try { new RegExp(f.re.source, f.re.flags); return true; } catch { return false; } }),
    '');
  ok('MI-A6 判据形态不许半拉子：regex 型必须带正则，span 型必须不带',
    FORBIDDEN_FEATURES.every((f) => (f.kind === 'span') ? !f.re : !!f.re),
    JSON.stringify(FORBIDDEN_FEATURES.filter((f) => (f.kind === 'span') ? !!f.re : !f.re).map((f) => f.id)));
}

// ══════════════════════════════════════════════════════════════
// B. 不得误报（这些是合法的持久层内容）
// ══════════════════════════════════════════════════════════════
{
  const clean = runJson(['--agents-dir', A('clean'), '--roster', R('clean.json')]);
  ok('MI-B1 干净夹具 ⇒ 退出码 0', clean.exitCode === 0, 'exit=' + clean.exitCode + ' ' + (clean.out || '').slice(0, 200));
  ok('MI-B2 干净夹具 ⇒ 零命中', hitsOf(clean).length === 0, JSON.stringify(featuresOf(clean)));

  const noHits = (text) => scanText(text, { file: 'inline' }).length === 0;
  ok('MI-B3 方法论 / 错题本路径不触发任何特征',
    noHits('方法论：开工前必须先读 .superagent/methods/sa-image-design.md，严格按其中的「方法」执行') &&
    noHits('已知易错：读 .superagent/lessons/sa-image-design.md（若存在）'), '');
  ok('MI-B4 契约与台账的仓库相对路径不触发任何特征',
    noHits('参考：契约 plugin/skills/super-agent-router/references/contract.md 的 S16；台账 docs/audit/defect-ledger.md。'), '');
  ok('MI-B5 兄弟成员的稳定名不触发任何特征',
    noHits('与兄弟成员的分工：与 sa-aigc-text、sa-media-pack 分工明确；边界不清时找 Router。'), '');
  ok('MI-B6 通用能力词不触发任何特征',
    noHits('角色：图像设计专项；职责边界：做视觉方案、版式与出图前的口径回显；不做图像生成与模型训练'), '');
  ok('MI-B7 URL 不被当成盘符路径（https:// 的 "s:/" 不是路径）',
    !hasFeature({ hits: scanText('参考 https://example.com/docs 的说明', { file: 'inline' }) }, 'abs-path'),
    JSON.stringify(scanText('参考 https://example.com/docs 的说明', { file: 'inline' }).map((h) => h.feature)));
  ok('MI-B8 日期不是版本号（2026.11.12 不该被当成版本）',
    !hasFeature({ hits: scanText('成稿日期 2026.11.12 定稿', { file: 'inline' }) }, 'version'),
    JSON.stringify(scanText('成稿日期 2026.11.12 定稿', { file: 'inline' }).map((h) => h.feature)));
}

// ══════════════════════════════════════════════════════════════
// C. 脏账号目录：每条禁止特征各有一条专属断言
// ══════════════════════════════════════════════════════════════
{
  const dirty = runJson(['--agents-dir', A('dirty'), '--roster', R('clean.json')]);
  ok('MI-C1 脏账号目录 ⇒ 退出码非 0（持久层有一次性残留）', dirty.exitCode !== 0,
    'exit=' + dirty.exitCode + ' ' + (dirty.out || '').slice(0, 200));
  ok('MI-C2 盘符绝对路径被报出来', hasFeature(dirty, 'abs-path'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C3 带编号前缀的具体文件被报出来', hasFeature(dirty, 'numbered-file'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C4 一次性措辞被报出来', hasFeature(dirty, 'one-off-wording'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C5 书名号项目名被报出来', hasFeature(dirty, 'project-title'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C6 批次 / 实验编号被报出来', hasFeature(dirty, 'batch-no'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C7 版本号被报出来', hasFeature(dirty, 'version'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C8 缺陷编号被报出来', hasFeature(dirty, 'defect-id'), JSON.stringify(featuresOf(dirty)));
  ok('MI-C9 开工前必读的非方法论路径被报出来', hasFeature(dirty, 'must-read-non-method'), JSON.stringify(featuresOf(dirty)));

  const cn = runJson(['--agents-dir', A('cn-file'), '--roster', R('clean.json')]);
  ok('MI-C10 中文交付物文件名被报出来（无编号前缀的那一种）', hasFeature(cn, 'cn-deliverable-file'), JSON.stringify(featuresOf(cn)));

  const onlyVer = runJson(['--agents-dir', A('version-only'), '--roster', R('clean.json')]);
  ok('MI-C11 只有版本号残留 ⇒ 退出码非 0', onlyVer.exitCode !== 0, 'exit=' + onlyVer.exitCode);

  const nonVer = runJson(['--agents-dir', A('nonversion'), '--roster', R('clean.json')]);
  ok('MI-C12 只有非版本类残留 ⇒ 退出码非 0（不许只查版本号）', nonVer.exitCode !== 0,
    'exit=' + nonVer.exitCode + ' ' + JSON.stringify(featuresOf(nonVer)));

  const lineNos = hitsOf(dirty).map((h) => h.line).filter((n) => Number.isInteger(n) && n > 0);
  ok('MI-C13 命中项带真实行号（人能一眼定位到该删哪一行）',
    lineNos.length === hitsOf(dirty).length && lineNos.length > 0,
    'lines=' + JSON.stringify([...new Set(lineNos)]));
}

// ══════════════════════════════════════════════════════════════
// D. 脏项目级名录
// ══════════════════════════════════════════════════════════════
{
  const dirty = runJson(['--agents-dir', A('clean'), '--roster', R('dirty.json')]);
  ok('MI-D1 脏名录 ⇒ 退出码非 0', dirty.exitCode !== 0, 'exit=' + dirty.exitCode);
  ok('MI-D2 命中的字段是 created_for（那条规矩的主战场）',
    hitsOf(dirty).some((h) => h.region === 'created_for'), JSON.stringify(hitsOf(dirty).map((h) => h.region)));
  ok('MI-D3 命中项带成员名（知道是哪个成员脏）',
    hitsOf(dirty).some((h) => h.member === 'sa-aigc-text'), JSON.stringify(hitsOf(dirty).map((h) => h.member)));
  ok('MI-D4 名录与账号目录是两处独立扫描（脏名录 + 脏账号目录都要红）',
    runJson(['--agents-dir', A('dirty'), '--roster', R('dirty.json')]).exitCode !== 0, '');
  ok('MI-D5 名录要查的字段含 created_for',
    ROSTER_FIELDS.indexOf('created_for') >= 0, ROSTER_FIELDS.join(','));
}

// ══════════════════════════════════════════════════════════════
// E. 输出形态（人要能一眼看出该删什么）
// ══════════════════════════════════════════════════════════════
{
  const r = runCheck(['--agents-dir', A('dirty'), '--roster', R('clean.json')]);
  ok('MI-E1 命中项输出里有文件名', r.out.indexOf('agent.md') >= 0, r.out.slice(-200));
  ok('MI-E2 命中项输出里有行号', /agent\.md:\d+/.test(r.out), r.out.slice(-200));
  // 断言盯的是「原文：」标签 + 命中原文 —— 只搜文件名会被特征表 why 里的示例文字顶住。
  ok('MI-E3 命中项输出里有命中的原文（带「原文：」标签）',
    /原文：\s*开工前必须先读 00_共用事实底稿\.md/.test(r.out), r.out.slice(-200));
  ok('MI-E4 命中项输出里有特征 id', r.out.indexOf('numbered-file') >= 0, r.out.slice(-200));
  ok('MI-E5 命中项输出里写了「为什么禁」', r.out.indexOf('为什么禁') >= 0, r.out.slice(-200));
}

// ══════════════════════════════════════════════════════════════
// F. 跳过语义（账号目录不可用 ≠ 通过，也 ≠ 失败）
// ══════════════════════════════════════════════════════════════
{
  const missing = runCheck(['--agents-dir', path.join(FIX, 'agents', 'no-such-dir'), '--roster', R('clean.json')]);
  ok('MI-F1 账号目录不存在 ⇒ 退出码 0（没查 ≠ 失败）', missing.code === 0, 'exit=' + missing.code);
  ok('MI-F2 账号目录不存在 ⇒ 输出「跳过：账号成员目录不可用」',
    missing.out.indexOf('跳过：账号成员目录不可用') >= 0, missing.out.slice(0, 300));
  ok('MI-F3 账号目录不存在时**不许**输出「检查通过」的结论行（那是把「没查」说成「查过了」）',
    missing.out.indexOf('>>> 成员持久身份口径检查通过') < 0, missing.out.slice(0, 300));
  ok('MI-F4 账号目录不存在时，结论行如实写「账号级未检查」',
    missing.out.indexOf('账号级未检查') >= 0, missing.out.slice(0, 300));
  const missingDirty = runCheck(['--agents-dir', path.join(FIX, 'agents', 'no-such-dir'), '--roster', R('dirty.json')]);
  ok('MI-F5 账号目录不存在时，名录脏仍然要红（跳过 ≠ 放行）', missingDirty.code !== 0, 'exit=' + missingDirty.code);
}

// ══════════════════════════════════════════════════════════════
// G. 其它边界
// ══════════════════════════════════════════════════════════════
{
  const empty = runJson(['--agents-dir', A('empty'), '--roster', R('clean.json')]);
  ok('MI-G1 账号目录可用但没有成员 ⇒ 退出码 0 且零命中',
    empty.exitCode === 0 && hitsOf(empty).length === 0, 'exit=' + empty.exitCode);
  const noRoster = runJson(['--agents-dir', A('clean'), '--roster', path.join(FIX, 'roster', 'no-such-file.json')]);
  ok('MI-G2 名录读不到 ⇒ 退出码非 0（判据不可信 ⇒ 拒绝，不放行）', noRoster.exitCode !== 0, 'exit=' + noRoster.exitCode);
  const badRoster = path.join(FIX, 'roster', 'broken.json');
  fs.writeFileSync(badRoster, '{ this is not json ', 'utf8');
  const broken = runJson(['--agents-dir', A('clean'), '--roster', badRoster]);
  ok('MI-G3 名录不是合法 JSON ⇒ 退出码非 0', broken.exitCode !== 0, 'exit=' + broken.exitCode);
  fs.rmSync(badRoster, { force: true });
  const badFlag = runCheck(['--agents-dir']);
  ok('MI-G4 参数缺值 ⇒ 退出码 2（不许静默忽略一个写坏的参数）', badFlag.code === 2,
    'exit=' + badFlag.code + ' ' + badFlag.out.slice(0, 160));
}

// ══════════════════════════════════════════════════════════════
// H. 契约 S16 规则 5 / 6 / 7 的判据（第二轮：判定区域 / 让渡句 / 具体标识覆盖面）
//
//   规则 5（contract.md:867-871）：判定区域 = 提示词本体。front matter 里只有
//     `description` 参与；`name`/`displayName`/`x-mavis.defaultWorkspaceDir`/`model`/`effort`
//     是宿主配置，不参与；front matter 没闭合 ⇒ 全文按正文扫（fail-closed）。
//   规则 6（contract.md:872-874）：让渡句不算残留，但让渡句**不豁免具体标识**。
//   规则 7（contract.md:875-879）：具体标识覆盖脚本与相对目录；豁免仓库相对引用与方法论/错题本路径。
//
//   每条新判据一条专属断言，都能被 tests/fixtures/member-identity-mutation-matrix.mjs
//   里的对应变异体**单独打红**（见矩阵 M-MIg ~ M-MIq）。
// ══════════════════════════════════════════════════════════════
{
  const scanFixture = (name) => runJson(['--agents-dir', A(name), '--roster', R('clean.json')]);

  // ── 三张判据表本身可枚举（契约 :881-885「判据表只有一份」）──
  ok('MI-H0 规则 5/6/7 的三张判据表都可枚举，且每条都有 id 与 why',
    HOST_CONFIG_KEYS.length >= 5 && HOST_CONFIG_KEYS.every((x) => x.id && x.why) &&
    DELEGATION_MARKERS.length >= 3 && DELEGATION_MARKERS.every((x) => x.id && x.why && x.re) &&
    PATH_EXEMPTIONS.length >= 3 && PATH_EXEMPTIONS.every((x) => x.id && x.why),
    'host=' + HOST_CONFIG_KEYS.length + ' delegation=' + DELEGATION_MARKERS.length + ' exemption=' + PATH_EXEMPTIONS.length);
  ok('MI-H0b 宿主配置键表含契约点名的五个字段（name / displayName / defaultWorkspaceDir / model / effort）',
    ['name', 'displayName', 'defaultWorkspaceDir', 'model', 'effort'].every((k) => HOST_CONFIG_KEYS.some((x) => x.id === k)),
    HOST_CONFIG_KEYS.map((x) => x.id).join(','));
  ok('MI-H0c 规则 7 的两个新判据（relative-path / concrete-file）在特征表里',
    FEATURE_IDS.indexOf('relative-path') >= 0 && FEATURE_IDS.indexOf('concrete-file') >= 0,
    FEATURE_IDS.join(','));

  // ── 规则 5：判定区域 = 提示词本体 ──
  const hostCfg = scanFixture('host-config');
  ok('MI-H1 front matter 的宿主配置字段（defaultWorkspaceDir 的盘符路径 / model 的斜杠）不参与残留判定 ⇒ 零命中',
    hitsOf(hostCfg).length === 0 && hostCfg.exitCode === 0,
    'exit=' + hostCfg.exitCode + ' ' + JSON.stringify(featuresOf(hostCfg)));

  const descPath = scanFixture('desc-path');
  ok('MI-H2 front matter 里只有 description 参与判定：description 里的盘符路径必须报红',
    hitsOf(descPath).some((h) => h.feature === 'abs-path' && h.region === 'description'),
    JSON.stringify(hitsOf(descPath).map((h) => h.feature + '@' + h.region)));

  const unclosed = scanFixture('unclosed-fm');
  ok('MI-H3 front matter 未闭合 ⇒ 全文按正文扫（fail-closed，不许静默放过宿主配置行里的路径）',
    hitsOf(unclosed).some((h) => h.feature === 'abs-path'),
    JSON.stringify(hitsOf(unclosed).map((h) => h.feature + '@' + h.region)));

  const cls = classifyAgentLines([
    '---', 'name: sa-x', 'description: 能力化描述', 'x-mavis:', '  defaultWorkspaceDir: Q:\\x', '---', '', '正文一行'
  ]);
  ok('MI-H4 区域分类函数本身：front matter 里只有 description 参与，其余宿主配置键标成 host-config，之后是正文',
    cls[2] === 'description' && cls[4] === 'host-config' && cls[7] === '正文',
    JSON.stringify(cls));

  // ── 规则 6：让渡句不算残留，但让渡句不豁免具体标识 ──
  const deleg = scanFixture('delegation');
  ok('MI-H5 让渡句（由 brief 决定 / 由 brief 给出 / 路径随任务变）不算残留 ⇒ 零命中',
    hitsOf(deleg).length === 0 && deleg.exitCode === 0,
    'exit=' + deleg.exitCode + ' ' + JSON.stringify(featuresOf(deleg)));

  const delegId = scanFixture('delegation-id');
  ok('MI-H6 让渡句不豁免具体标识：同一句里的盘符路径 / 相对路径 / 版本号照报',
    hitsOf(delegId).some((h) => h.feature === 'abs-path') &&
    hitsOf(delegId).some((h) => h.feature === 'relative-path') &&
    hitsOf(delegId).some((h) => h.feature === 'version'),
    JSON.stringify(hitsOf(delegId).map((h) => h.feature + '::' + h.text)));
  ok('MI-H6b 让渡句里的「一次性措辞」本身不报（豁免只针对措辞，不针对具体标识）',
    !hitsOf(delegId).some((h) => h.feature === 'one-off-wording'),
    JSON.stringify(hitsOf(delegId).map((h) => h.feature)));

  // ── 规则 7：具体标识覆盖脚本与相对目录 ──
  const scriptPath = scanFixture('script-path');
  ok('MI-H7 具体标识覆盖脚本与配置文件名：裸 wordcount.py 必须报红',
    hitsOf(scriptPath).some((h) => h.feature === 'concrete-file' && /wordcount\.py/.test(h.text)),
    JSON.stringify(hitsOf(scriptPath).map((h) => h.feature + '::' + h.text)));
  ok('MI-H8 具体标识覆盖带目录段的相对路径：工具\\ 目录 与 工具\\aigc_tts.py 都必须报红',
    hitsOf(scriptPath).some((h) => h.feature === 'relative-path' && /工具\\$/.test(h.text)) &&
    hitsOf(delegId).some((h) => h.feature === 'relative-path' && /aigc_tts\.py/.test(h.text)),
    JSON.stringify(hitsOf(scriptPath).map((h) => h.feature + '::' + h.text)) + ' | ' +
    JSON.stringify(hitsOf(delegId).map((h) => h.feature + '::' + h.text)));

  const repoRel = scanFixture('repo-rel');
  ok('MI-H9 豁免仓库相对引用（plugin/ docs/ tests/ tools/ .superagent/ 开头且不含盘符）⇒ 零命中',
    hitsOf(repoRel).length === 0 && repoRel.exitCode === 0,
    'exit=' + repoRel.exitCode + ' ' + JSON.stringify(featuresOf(repoRel)));

  const wildcard = scanFixture('wildcard');
  ok('MI-H10 豁免通配形态（*.receipt.json 指向的是一类文件，不是某一个）⇒ 零命中',
    hitsOf(wildcard).length === 0 && wildcard.exitCode === 0,
    'exit=' + wildcard.exitCode + ' ' + JSON.stringify(featuresOf(wildcard)));

  const natural = scanFixture('natural-sep');
  ok('MI-H11 自然语言里的斜杠枚举（编造年代/日期/参数…、HTMT/AVE/CR、用代码/PIL）不是具体路径 ⇒ 零命中',
    hitsOf(natural).length === 0 && natural.exitCode === 0,
    'exit=' + natural.exitCode + ' ' + JSON.stringify(featuresOf(natural)));

  const repoAsset = scanFixture('repo-asset');
  ok('MI-H12 豁免仓库自有资产（契约规则 7 末段：裸文件名 lib.mjs 在本仓库内确实存在同名文件 ⇒ 不算「本次任务的」具体文件名）⇒ 零命中',
    hitsOf(repoAsset).length === 0 && repoAsset.exitCode === 0,
    'exit=' + repoAsset.exitCode + ' ' + JSON.stringify(featuresOf(repoAsset)));

  const unknownKey = scanFixture('unknown-key');
  ok('MI-H13 未知 front matter 键按 fail-closed 处理（契约规则 5 末段）：未列入宿主配置表的键照常参与判定 ⇒ 路径必须报红',
    hitsOf(unknownKey).some((h) => h.feature === 'abs-path' && h.region === 'front-matter'),
    JSON.stringify(hitsOf(unknownKey).map((h) => h.feature + '@' + h.region + '::' + h.text)));

  const assetPath = scanFixture('repo-asset-path');
  ok('MI-H14 仓库自有资产豁免只给无目录段的裸文件名（契约规则 7 末段）：带目录段的相对路径照报',
    hitsOf(assetPath).some((h) => h.feature === 'relative-path' && /contract\.md/.test(h.text)),
    JSON.stringify(hitsOf(assetPath).map((h) => h.feature + '@' + h.region + '::' + h.text)));
}

console.log('');
console.log(fail === 0 ? '>>> MEMBER-IDENTITY ALL PASS' : '>>> MEMBER-IDENTITY FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
