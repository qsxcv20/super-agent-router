// 零欠账收口轮语义变异体矩阵执行器（D-87 / D-89 / D-90 / D-94 / D-110）
//
// 用法: node tests/fixtures/zero-debt-mutation-matrix.mjs <repoDir>
//
// 纪律（承 D-91 / D-97 的既有口径）：
//   1) 变异必须跑在**字节级副本**上（fs.cpSync / copyFileSync），禁止改真实仓库。
//   2) 每个副本先独立跑 node --check：exit!=0 只记「变异体无效」，不算断言红。
//   3) 基线（未变异）必须全绿，否则矩阵结论无意义。
//   4) 串行执行，不并发。
//   5) 三列分开报：专属锚点红 / EXTRA-RED / 总红数。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(process.argv[2] || '.');
const SUITE_REL = path.join('tests', 'zero-debt-test.mjs');

// 复制清单：套件要读到的全部东西（不多不少，避免把 .git / 临时目录也搬一遍）。
const COPY_FILES = [
  ['README.md', 'README.md'],
  [path.join('docs', 'audit', 'defect-ledger.md'), path.join('docs', 'audit', 'defect-ledger.md')]
];
const COPY_DIRS = ['plugin', 'tests', 'tools'];

export const MUTANTS = [
  // ── D-87：后台任务通道的归属判定 ─────────────────────────
  {
    id: 'M-D87a', defect: 'D-87',
    desc: '归属查不到也放行（fail-open）',
    file: path.join('plugin', 'scripts', 'guard.mjs'),
    anchor: "    deny('[super-agent-router] 越界拦截：后台任务 ' + taskId + ' 的**归属查不到**。' +",
    mutant: "    allow(injected); process.exit(0); deny('[super-agent-router] 越界拦截：后台任务 ' + taskId + ' 的**归属查不到**。' +",
    expect: 'D-87-A4 归属查不到的后台任务 ⇒ 拒绝（取不到归属即拒绝）'
  },
  {
    id: 'M-D87b', defect: 'D-87',
    desc: '载荷里没有 task_id 也放行',
    file: path.join('plugin', 'scripts', 'guard.mjs'),
    anchor: "    deny('[super-agent-router] 越界管控无法执行：' + tool + ' 没有可判定的 task_id。' +",
    mutant: "    allow(injected); process.exit(0); deny('[super-agent-router] 越界管控无法执行：' + tool + ' 没有可判定的 task_id。' +",
    expect: 'D-87-A6 task_output 载荷里没有 task_id ⇒ 拒绝（取不到目标即拒绝）'
  },
  {
    id: 'M-D87c', defect: 'D-87',
    desc: '后台任务三件套整体不参与判定',
    file: path.join('plugin', 'scripts', 'guard.mjs'),
    anchor: "  if (TASK_SESSION_TOOLS.includes(toolName)) return 'task';",
    mutant: "  if (false) return 'task';",
    expect: 'D-87-A2 读别的成员的后台任务输出 ⇒ 拒绝'
  },
  {
    id: 'M-D87d', defect: 'D-87',
    desc: '同成员判定写反',
    file: path.join('plugin', 'scripts', 'guard.mjs'),
    anchor: "  if (owner && ownerKey && myKey && ownerKey === myKey) {",
    mutant: "  if (owner && ownerKey && myKey && ownerKey !== myKey) {",
    expect: 'D-87-A1 读自己成员的后台任务输出 ⇒ 放行'
  },
  // ── D-89：追加轮的登记与名额组 ────────────────────────────
  {
    id: 'M-D89a', defect: 'D-89',
    desc: '追加轮反查不到原派工也放行',
    file: path.join('plugin', 'scripts', 'dispatch.mjs'),
    anchor: "    deny('[super-agent-router] 追加轮无法登记：派工台账里查不到 task_id=' + appendTaskId + ' 对应的派工条目。' +",
    mutant: "    process.exit(0); deny('[super-agent-router] 追加轮无法登记：派工台账里查不到 task_id=' + appendTaskId + ' 对应的派工条目。' +",
    expect: 'D-89-B3 追加轮查不到原派工 ⇒ 拒绝（载荷里没有 agent 身份，反查不到就是判不出边界）'
  },
  {
    id: 'M-D89b', defect: 'D-89',
    desc: '追加轮不继承原派工的名额组（自己占一个名额）',
    file: path.join('plugin', 'scripts', 'dispatch.mjs'),
    anchor: "      slot_group: group,",
    mutant: "      slot_group: appendId,",
    expect: 'D-89-B7 追加轮与原派工共用名额组（不重复占名额、也不提前释放）'
  },
  {
    id: 'M-D89c', defect: 'D-89',
    desc: '追加轮被当成新的一份工作（消耗累计派工额度）',
    file: path.join('plugin', 'scripts', 'dispatch.mjs'),
    anchor: "    return { result: { appendId } };",
    mutant: "    bumpDispatchCounter(cur, owner.parent_session_id);\n    return { result: { appendId } };",
    expect: 'D-89-B10 追加轮不消耗累计派工额度（同一份工作的下一轮）'
  },
  {
    id: 'M-D89d', defect: 'D-89',
    desc: '子会话绑定不改指追加条目（回收的是已结束的原派工）',
    file: path.join('plugin', 'scripts', 'dispatch.mjs'),
    anchor: "      if (bind) bind.dispatch_id = appendId;",
    mutant: "      if (bind) { /* 变异：绑定不改指追加条目 */ }",
    expect: 'D-89-B9 子会话绑定改指追加条目（SubagentStop 回收的是追加轮，不是已结束的原派工）'
  },
  {
    id: 'M-D89e', defect: 'D-89',
    desc: '名额组去重失效（每条记录各算一个名额组）',
    file: path.join('plugin', 'scripts', 'lib.mjs'),
    anchor: "  return String((d && (d.slot_group || d.dispatch_id)) || '');",
    mutant: "  return String((d && d.dispatch_id) || '');",
    expect: 'D-89-B16 同组去重：两条都在飞时，在飞名单里只有 1 条（自己跟自己不算组队冲突）'
  },
  // ── D-90：台账状态一致性 ────────────────────────────────
  {
    id: 'M-D90a', defect: 'D-90',
    desc: '一条状态塞两个结论不再判红',
    file: path.join('tools', 'ledger-check.mjs'),
    anchor: "      if (rest.indexOf(v) >= 0) {",
    mutant: "      if (false) {",
    expect: 'D-90-C7 一条状态塞两个结论 ⇒ status-vocab 转红'
  },
  {
    id: 'M-D90b', defect: 'D-90',
    desc: '索引行状态不再与明细逐字比对',
    file: path.join('tools', 'ledger-check.mjs'),
    anchor: "    const cell = row.cells[STATUS_COLUMN_INDEX] || '';\n    if (cell !== want) {",
    mutant: "    const cell = row.cells[STATUS_COLUMN_INDEX] || '';\n    if (false) {",
    expect: 'D-90-C5 索引行状态与明细段不一致 ⇒ status-consistency 转红'
  },
  {
    id: 'M-D90c', defect: 'D-90',
    desc: '统计行的状态计数不再由明细重算',
    file: path.join('tools', 'ledger-check.mjs'),
    anchor: "      if (claimed !== counts[v]) {",
    mutant: "      if (false) {",
    expect: 'D-90-C8 统计行的状态计数与明细重算不符 ⇒ status-stats 转红'
  },
  {
    id: 'M-D90d', defect: 'D-90',
    desc: '「未修」不再单独点名（零欠账第一条失效）',
    file: path.join('tools', 'ledger-check.mjs'),
    anchor: "    if (w === '未修') {",
    mutant: "    if (false) {",
    expect: 'D-90-C9 有条缺陷状态写成「未修」⇒ no-unfixed 转红（零欠账第 1 条）'
  },
  {
    id: 'M-D90e', defect: 'D-90',
    desc: '索引表折行检测不到（识别不出索引形状的孤立行）',
    file: path.join('tools', 'ledger-check.mjs'),
    anchor: "    const isIndexShaped = (cells) => cells.length >= 5 && isDId(cells[0]) &&\n      /^P[0-3]$/.test(cells[2]) && /层$/.test(cells[3]);",
    mutant: "    const isIndexShaped = (cells) => false;",
    expect: 'D-90-C10 索引表被折行断成两块 ⇒ index-single-block 转红'
  },
  {
    id: 'M-D90f', defect: 'D-90',
    desc: '模板里的状态字段不再与契约词表对账（旧词表可回流）',
    file: path.join('tools', 'ledger-check.mjs'),
    anchor: "      if (!vocab.includes(head)) {",
    mutant: "      if (false) {",
    expect: 'D-90-C11 模板里的状态字段含词表外的旧词 ⇒ template-status-vocab 转红'
  },
  // ── D-94：版本字面量与目录结构数字 ────────────────────────
  {
    id: 'M-D94a', defect: 'D-94',
    desc: '版本一致性断言被摘掉（恒过）',
    file: path.join('tools', 'install-selftest', 'check-version-consistency.mjs'),
    anchor: "function check(name, cond, detail = '') {",
    mutant: "function check(name, cond, detail = '') {\n  if (String(name).indexOf('== plugin.json') >= 0) cond = true;",
    expect: 'D-94-D3 根 README 的版本字面量与 plugin.json 不一致 ⇒ 退出码非 0'
  },
  {
    id: 'M-D94b', defect: 'D-94',
    desc: 'handler 数不再与实际文件对账',
    file: path.join('tools', 'install-selftest', 'check-version-consistency.mjs'),
    anchor: "  !!rootHandlers && Number(rootHandlers) === handlerGroups,",
    mutant: "  !!rootHandlers,",
    expect: 'D-94-D5 README 的 handler 数与实际不符 ⇒ 退出码非 0'
  },
  {
    id: 'M-D94c', defect: 'D-94',
    desc: '脚本数不再与实际文件对账',
    file: path.join('tools', 'install-selftest', 'check-version-consistency.mjs'),
    anchor: "  !!rootScripts && Number(rootScripts) === scriptCount,",
    mutant: "  !!rootScripts,",
    expect: 'D-94-D9 README 的脚本数与实际不符 ⇒ 退出码非 0'
  },
  // ── D-110：造故障的手法（版本号派生 + 字节自检）自己会不会坏 ──────────
  {
    id: 'M-D110a', defect: 'D-110',
    desc: '版本派生改回写死（下次升版就复发）',
    file: path.join('tests', 'zero-debt-test.mjs'),
    anchor: "  return m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);",
    mutant: "  return '0.5.12';",
    expect: 'D-110-D1 注入用的版本号必须从当前版本派生'
  },
  {
    id: 'M-D110b', defect: 'D-110',
    desc: '替换手法退化成空操作（字节没变 ⇒ 假故障没造成）',
    file: path.join('tests', 'zero-debt-test.mjs'),
    anchor: "  return String(manifestText || '').replace(/(\"version\"\\s*:\\s*\")([^\"]+)(\")/, (m, a, v, c) => a + next + c);",
    mutant: "  return String(manifestText || '');",
    expect: 'D-110-D2 造故障手法自检 · manifest 升版'
  }
];

function copyRepo(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const [src, rel] of COPY_FILES) {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, src), to);
  }
  for (const d of COPY_DIRS) {
    fs.cpSync(path.join(REPO, d), path.join(dest, d), { recursive: true });
  }
}

// 套件自身的 PASS/FAIL 行是「FAIL 」+ 一个空格；被调用的子套件是「FAIL  」（两空格）。
// 只认前者，否则子套件的输出会把总红数算错。
function runSuite(repoRoot) {
  const r = spawnSync(process.execPath, [path.join(repoRoot, SUITE_REL)], {
    cwd: repoRoot, encoding: 'utf8', timeout: 900000,
    env: Object.assign({}, process.env, { SAR_REPO_DIR: repoRoot, SAR_PLUGIN_ROOT: 'plugin' })
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-zero-debt-mut-'));
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
  const gf = path.join(dir, m.file);
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
