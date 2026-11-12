// 成员持久身份口径的语义变异体矩阵执行器（契约 S16）
//
// 用法: node tests/fixtures/member-identity-mutation-matrix.mjs <repoDir>
//
// 纪律（承 D-91 / D-97 / 零欠账轮的既有口径）：
//   1) 变异必须跑在**字节级副本**上（fs.cpSync），禁止改真实仓库。
//   2) 每个副本先独立跑 node --check：exit!=0 只记「变异体无效」，不算断言红。
//   3) 基线（未变异）必须全绿，否则矩阵结论无意义。
//   4) 串行执行，不并发。
//   5) 三列分开报：专属锚点红 / EXTRA-RED / 总红数。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(process.argv[2] || '.');
const SUITE_REL = path.join('tests', 'member-identity-test.mjs');
const TARGET_REL = path.join('tools', 'member-identity-check.mjs');

// 复制清单：套件要读到的全部东西。
// plugin/ 必须在清单里 —— 检查器的「仓库自有资产豁免」要读仓库里的文件清单
// （plugin/scripts/lib.mjs 等），少了它副本里的判定与真仓库不一致 ⇒ 矩阵结论失真。
const COPY_DIRS = ['tests', 'tools', 'plugin'];

export const MUTANTS = [
  {
    id: 'M-MIa', defect: 'S16',
    desc: '完全不检查（检测循环被清空）',
    anchor: '  for (const f of FORBIDDEN_FEATURES) {',
    mutant: '  for (const f of []) {',
    expect: 'MI-C1 脏账号目录 ⇒ 退出码非 0'
  },
  {
    id: 'M-MIb', defect: 'S16',
    desc: '只查版本号、放过其它',
    anchor: 'export const FORBIDDEN_FEATURES = FEATURE_SPECS.map((f) => ({',
    mutant: "export const FORBIDDEN_FEATURES = FEATURE_SPECS.filter((x) => x.id === 'version').map((f) => ({",
    expect: 'MI-C12 只有非版本类残留 ⇒ 退出码非 0'
  },
  {
    id: 'M-MIc', defect: 'S16',
    desc: '账号目录不可用也判失败（把「没查」当成「查出不干净」）',
    anchor: '  if (result.hits.length) return 1;',
    mutant: '  if (result.hits.length || !result.agents.available) return 1;',
    expect: 'MI-F1 账号目录不存在 ⇒ 退出码 0'
  },
  {
    id: 'M-MId', defect: 'S16',
    desc: '命中项不报原文（人看不出该删什么）',
    anchor: "    '     原文：' + h.text,",
    mutant: "    '     命中',",
    expect: 'MI-E3 命中项输出里有命中的原文'
  },
  {
    id: 'M-MIe', defect: 'S16',
    desc: '命中项不报行号（人定位不到该删哪一行）',
    anchor: "    '  ' + (i + 1) + '. ' + h.file + ':' + h.line,",
    mutant: "    '  ' + (i + 1) + '. ' + h.file,",
    expect: 'MI-E2 命中项输出里有行号'
  },
  {
    id: 'M-MIf', defect: 'S16',
    desc: '名录不查 created_for（能力化表述那条规矩的主战场失守）',
    anchor: "export const ROSTER_FIELDS = ['created_for', 'owns', 'accepts', 'reject', 'method'];",
    mutant: "export const ROSTER_FIELDS = ['owns', 'accepts', 'reject', 'method'];",
    expect: 'MI-D2 命中的字段是 created_for'
  },
  {
    id: 'M-MIg', defect: 'S16-规则5',
    desc: '宿主配置字段也参与判定（defaultWorkspaceDir 的盘符路径又被当成残留）',
    anchor: '  return HOST_CONFIG_KEYS.some((h) => h.id.toLowerCase() === k || h.id.toLowerCase() === leaf);',
    mutant: '  return HOST_CONFIG_KEYS.length === 0;',
    expect: 'MI-H1 front matter 的宿主配置字段'
  },
  {
    id: 'M-MHh', defect: 'S16-规则5',
    desc: 'description 不参与判定（提示词本体少了一块）',
    anchor: "  if (k === 'description') return 'description';",
    mutant: "  if (k === 'description') return 'host-config';",
    expect: 'MI-H2 front matter 里只有 description 参与判定'
  },
  {
    id: 'M-MHi', defect: 'S16-规则5',
    desc: 'front matter 未闭合时静默放过（结构认不出就当宿主配置）',
    anchor: '  if (end < 0) return out;',
    mutant: "  if (end < 0) { out.fill('host-config'); return out; }",
    expect: 'MI-H3 front matter 未闭合 ⇒ 全文按正文扫'
  },
  {
    id: 'M-MHj', defect: 'S16-规则6',
    desc: '让渡句不豁免一次性措辞（合规写法被当成残留）',
    anchor: '        const delegated = sent ? isDelegationSentence(line.slice(sent[0], sent[1])) : false;',
    mutant: '        const delegated = false;',
    expect: 'MI-H5 让渡句（由 brief 决定 / 由 brief 给出 / 路径随任务变）不算残留'
  },
  {
    id: 'M-MHk', defect: 'S16-规则6',
    desc: '让渡句豁免整句（含具体标识 ⇒ 规则 6 第二句被丢掉）',
    anchor: '      if (f.suppressibleByDelegation) {',
    mutant: '      if (true) {',
    expect: 'MI-H6 让渡句不豁免具体标识'
  },
  {
    id: 'M-MIl', defect: 'S16-规则7',
    desc: '不认裸脚本 / 配置文件名（具体标识覆盖面只剩文档类）',
    anchor: "  if (!hasSep && isConcreteFileName(t)) return 'concrete-file';",
    mutant: "  if (!hasSep && isConcreteFileName(t)) return null;",
    expect: 'MI-H7 具体标识覆盖脚本与配置文件名'
  },
  {
    id: 'M-MIm', defect: 'S16-规则7',
    desc: '不认带目录段的相对路径（具体路径覆盖面只剩裸文件名）',
    anchor: '  if (isConcreteFileName(lastSegment)) return true;',
    mutant: '  if (false) return true;',
    expect: 'MI-H8 具体标识覆盖带目录段的相对路径'
  },
  {
    id: 'M-MIn', defect: 'S16-规则7',
    desc: '仓库相对引用不再豁免（机制自己的路径被当成残留）',
    anchor: "  { id: 'repo-relative', why: '仓库相对引用（以 plugin/ docs/ tests/ tools/ .superagent/ 开头且不含盘符）：机制自身的稳定资产，不是本次任务的坐标。', re: /(?:^|[^A-Za-z0-9_])(?:plugin|docs|tests|tools|\\.superagent)[\\\\/]/i },",
    mutant: "  { id: 'repo-relative', why: '仓库相对引用（以 plugin/ docs/ tests/ tools/ .superagent/ 开头且不含盘符）：机制自身的稳定资产，不是本次任务的坐标。', re: /(?!x)x/i },",
    expect: 'MI-H9 豁免仓库相对引用'
  },
  {
    id: 'M-MIo', defect: 'S16-规则7',
    desc: '通配形态不再豁免（*.receipt.json 被当成具体文件名）',
    anchor: "  { id: 'wildcard-pattern', why: '通配形态（如 *.receipt.json）指向的是「一类文件」，不是某一个具体文件名。', re: /[*?]/ },",
    mutant: "  { id: 'wildcard-pattern', why: '通配形态（如 *.receipt.json）指向的是「一类文件」，不是某一个具体文件名。', re: /(?!x)x/ },",
    expect: 'MI-H10 豁免通配形态'
  },
  {
    id: 'M-MIp', defect: 'S16-规则7',
    desc: '相对路径判据放宽（只要含分隔符就算路径 ⇒ 自然语言枚举全被误报）',
    anchor: '  if (hasSep && isRelativeDirPath(last, endsWithSep, headSegs.length > 0)) return \'relative-path\';',
    mutant: "  if (hasSep) return 'relative-path';",
    expect: 'MI-H11 自然语言里的斜杠枚举'
  },
  {
    id: 'M-MIq', defect: 'S16-规则7',
    desc: '仓库自有资产不再豁免（机制自己的 lib.mjs 被当成某一单的交付物）',
    anchor: "  { id: 'repo-own-asset', why: '裸文件名（**无目录段**）在本仓库内**确实存在同名文件** ⇒ 它是机制自身的稳定资产（规则 1 禁的是「本次任务的」标识，不是机制自己的文件）；契约规则 7 末段 contract.md:883-886。', test: (t) => isBareFileName(t) && isRepoAsset(basenameOf(t)) }",
    mutant: "  { id: 'repo-own-asset', why: '裸文件名（**无目录段**）在本仓库内**确实存在同名文件** ⇒ 它是机制自身的稳定资产（规则 1 禁的是「本次任务的」标识，不是机制自己的文件）；契约规则 7 末段 contract.md:883-886。', test: (t) => false }",
    expect: 'MI-H12 豁免仓库自有资产'
  },
  {
    id: 'M-MIr', defect: 'S16-规则5',
    desc: '未知 front matter 键也跳过（把「未知键 fail-closed」改回静默放行）',
    anchor: "  return 'front-matter';",
    mutant: "  return 'host-config';",
    expect: 'MI-H13 未知 front matter 键按 fail-closed 处理'
  },
  {
    id: 'M-MIs', defect: 'S16-规则7',
    desc: '仓库自有资产豁免不区分目录段（带目录段的相对路径也被放过）',
    anchor: "  return !/[\\\\/]/.test(String(text || ''));",
    mutant: "  return true;",
    expect: 'MI-H14 仓库自有资产豁免只给无目录段的裸文件名'
  }
];

function copyRepo(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const d of COPY_DIRS) {
    fs.cpSync(path.join(REPO, d), path.join(dest, d), { recursive: true });
  }
}

function runSuite(repoRoot) {
  const r = spawnSync(process.execPath, [path.join(repoRoot, SUITE_REL)], {
    cwd: repoRoot, encoding: 'utf8', timeout: 300000,
    env: Object.assign({}, process.env, { SAR_REPO_DIR: repoRoot })
  });
  const raw = (r.stdout || '') + (r.stderr || '');
  const ls = raw.split(/\r?\n/);
  const failLines = ls.filter((l) => /^FAIL (?! )/.test(l));
  const passLines = ls.filter((l) => /^PASS (?! )/.test(l));
  return {
    pass: passLines.length,
    fail: failLines.length,
    fails: failLines.map((l) => l.slice(5).split(' :: ')[0]),
    exit: r.status,
    raw
  };
}

// 定义段导出：node tests/fixtures/member-identity-mutation-matrix.mjs . --emit-md
// 目的：让 **定义文件里的锚点原文与执行器逐字同源** —— 手抄锚点迟早分叉，
// 而分叉的锚点 = 不可复现的矩阵结论（错题本 2026-11-12 那条铁律）。
function emitDefinitions() {
  const F = '`'.repeat(3);
  const I = '`';
  const out = [];
  out.push('# 成员持久身份口径的语义变异体矩阵定义（契约 S16）');
  out.push('');
  out.push('> 承 D-91 / D-97 / 零欠账轮的既有做法（tests/fixtures/d91-mutation-matrix.md、');
  out.push('> d97-mutation-matrix.md、zero-debt-mutation-matrix.md）：');
  out.push('> 变异体矩阵是「断言到底会不会红」的证明 —— 只存在于某个人的临时脚本里，');
  out.push('> 矩阵结论就既不可采信也不可反驳。本文件把每个变异体的**锚点原文、改成什么、');
  out.push('> 期望红哪条断言**逐字固定下来。');
  out.push('>');
  out.push('> **配套执行器**：tests/fixtures/member-identity-mutation-matrix.mjs（串行执行，不并发）。');
  out.push('> **被测套件**：tests/member-identity-test.mjs（用 SAR_REPO_DIR 指向变异副本）。');
  out.push('> 变异跑在**字节级副本**上（fs.cpSync），真实仓库一个字节都不动。');
  out.push('>');
  out.push('> **本文件由执行器导出**（' + I + 'node tests/fixtures/member-identity-mutation-matrix.mjs . --emit-md' + I + '），');
  out.push('> 锚点原文与执行器里的 MUTANTS 数组**逐字同源** —— 手抄锚点迟早分叉，');
  out.push('> 而分叉的锚点 = 不可复现的矩阵结论。');
  out.push('');
  out.push('## 判定口径（三列分开报）');
  out.push('');
  out.push('| 列名 | 含义 |');
  out.push('|---|---|');
  out.push('| 专属锚点红 | 本变异体**指定**的那条断言是否转红 |');
  out.push('| EXTRA-RED | 除专属锚点外额外转红的条数 |');
  out.push('| 总红数 | 套件 FAIL 断言总条数 |');
  out.push('');
  out.push('判定：专属锚点红=是 且 总红数=1 ⇒ 恰好红一条；专属锚点红=是 且 总红数>1 ⇒ EXTRA-RED(N)；');
  out.push('专属锚点红=否 ⇒ MISS（致命：该变异体没被任何断言抓住 ⇒ 矩阵退出码非 0）。');
  out.push('');
  out.push('**计数口径的坑**：套件断言的详情里会带子进程（检查器）的原始输出。');
  out.push('若详情原样打印，它的 ' + I + 'FAIL …' + I + ' 行会**独立成行** ⇒ 被行式扫描器');
  out.push('（tools/run-tests.mjs 与本执行器）误记成套件失败。');
  out.push('所以本套件的 ' + I + 'ok()' + I + ' 把详情里的换行压成 ' + I + ' | ' + I + ' —— 这不是洁癖，是**计数正确性**的前提。');
  out.push('');
  out.push('## 变异体清单（' + MUTANTS.length + ' 个）');
  out.push('');
  for (const m of MUTANTS) {
    out.push('### ' + m.id + ' · ' + m.desc);
    out.push('- 缺陷：契约 ' + m.defect + '。描述：' + m.desc + '。');
    out.push('- 文件：tools/member-identity-check.mjs');
    out.push('- 锚点（原文，独一命中）：');
    out.push(F);
    out.push(m.anchor);
    out.push(F);
    out.push('- 改成：');
    out.push(F);
    out.push(m.mutant);
    out.push(F);
    out.push('- 期望红：**' + m.expect + '**');
    out.push('');
  }
  out.push('## 复跑命令');
  out.push('');
  out.push(F);
  out.push('node tests/fixtures/member-identity-mutation-matrix.mjs .');
  out.push(F);
  out.push('');
  out.push('<!-- 实测结果段：跑完矩阵后把归档输出回填到这里 -->');
  out.push('');
  return out.join('\n');
}

if (process.argv.indexOf('--emit-md') >= 0) {
  process.stdout.write(emitDefinitions());
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mi-mut-'));
const base = path.join(tmp, 'base');
copyRepo(base);
const b = runSuite(base);
console.log('基线：pass=' + b.pass + ' fail=' + b.fail + ' exit=' + b.exit);
if (b.fail !== 0 || b.exit !== 0) {
  console.log('基线不绿 ⇒ 矩阵结论无意义，终止');
  console.log(b.raw.split(/\r?\n/).filter((l) => /^FAIL (?! )/.test(l)).join('\n'));
  process.exit(2);
}

let miss = 0;
let extraTotal = 0;
for (const m of MUTANTS) {
  const dir = path.join(tmp, m.id);
  copyRepo(dir);
  const gf = path.join(dir, TARGET_REL);
  const src = fs.readFileSync(gf, 'utf8');
  const crlf = src.indexOf('\r\n') >= 0;
  const anchor = crlf ? m.anchor.replace(/\n/g, '\r\n') : m.anchor;
  const mutant = crlf ? m.mutant.replace(/\n/g, '\r\n') : m.mutant;
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) {
    console.log(m.id + ' ' + m.desc + '：锚点命中 ' + hits + ' 次（必须恰好 1 次）⇒ 变异体无效');
    miss += 1;
    continue;
  }
  fs.writeFileSync(gf, src.replace(anchor, mutant), 'utf8');
  const chk = spawnSync(process.execPath, ['--check', gf], { encoding: 'utf8' });
  if (chk.status !== 0) {
    console.log(m.id + ' ' + m.desc + '：node --check exit=' + chk.status + ' ⇒ 变异体无效');
    miss += 1;
    continue;
  }
  const r = runSuite(dir);
  const hit = r.fails.some((l) => l.indexOf(m.expect) >= 0);
  const extra = Math.max(0, r.fail - 1);
  extraTotal += extra;
  const verdict = hit ? (r.fail === 1 ? '恰好红一条' : 'EXTRA-RED(' + extra + ')') : 'MISS';
  console.log(m.id + ' [' + m.defect + '] ' + m.desc + '：套件 pass=' + r.pass + ' fail=' + r.fail +
    ' 专属锚点红=' + (hit ? '是' : '否') + ' EXTRA-RED=' + extra + ' 总红数=' + r.fail + ' 判定=' + verdict);
  for (const l of r.fails) console.log('   RED ' + l);
  if (!hit) miss += 1;
}
console.log('MUT-CHECK 结束：MISS=' + miss + '  EXTRA-RED 合计=' + extraTotal);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(miss === 0 ? 0 : 1);
