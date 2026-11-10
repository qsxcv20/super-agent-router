// 缺陷台账自洽检查回归（tests/ledger-test.mjs）
//
// 验证这些事：
//   1. 仓库里的**真实台账**通过严格自洽检查（口径见 tools/ledger-check.mjs 头注释）
//   2. 每个变异体（把台账故意改坏）都让对应检查**转红** ⇒ 证明这套断言不是恒绿
//
// 两种模式：
//   node tests/ledger-test.mjs                    # 基线 + 变异体（默认，回归跑这个）
//   $env:SAR_MUTATION_LEDGER='1'; node tests/ledger-test.mjs   # 只跑变异体
//
// **不动真实台账**：所有变异都在系统临时目录的**副本**上做，
// 仓库里的 docs/audit/defect-ledger.md 一个字节都不改。
// 夹具自带完整环境（MINIMAX_PROJECT_DIR / PLUGIN_DATA 指到临时目录）⇒ 不污染真实变更账。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLedger, splitRow } from '../tools/ledger-check.mjs';

const REPO = process.env.SAR_REPO_DIR || process.cwd();
const LEDGER = path.join(REPO, 'docs', 'audit', 'defect-ledger.md');

// 夹具环境：全部指到临时目录（D-64 同族纪律 —— 夹具不带全套环境就会写到真实项目里去）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-ledger-'));
process.env.MINIMAX_PROJECT_DIR = path.join(TMP, 'proj');
process.env.PLUGIN_DATA = path.join(TMP, 'data');
fs.mkdirSync(process.env.MINIMAX_PROJECT_DIR, { recursive: true });
fs.mkdirSync(process.env.PLUGIN_DATA, { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };
const warn = (l) => console.log('WARN ' + l);

// ── 已登记的已知缺口 ────────────────────────────────────────
// 台账是**父会话的资产**（编号与状态由父会话统一分配），本单不改它。
// 但「台账自洽」是硬要求 —— 独立验收 F-03 判 FAIL 就是因为统计行与明细区对不上。
//
// 口径：偏差集合必须**是**本清单的子集 —— 出现清单之外的新偏差 ⇒ 立刻转红。
// 台账再出现不自洽时，把新偏差登记进来（key + why + fix），套件就「认得」它；
// 不登记的新偏差一律转红。登记项若被修好（不再出现），套件打印 WARN 提示删掉
// —— 不转红，避免「已修但仍挂着」的假账把回归拖成红的。
//
// **本清单当前为空**：上一轮登记的 3 条已由父会话修完，按上面这条规矩删掉 ——
//   ① detail-meta-line:D-81（D-81 的「来源/严重度」行被放在文件末尾，脱离了自己的段）
//   ② severity-distribution:P2（由 ① 连带：明细重算 30 vs 统计行 31）
//   ③ no-duplicate-d:D-75（状态表里 D-75 两行且状态互相矛盾）
// 闭环记录见 docs/audit/ledger-check.md §4（**别删那段**：它记着台账天生不自洽这件事
// 是怎么被发现的 —— 免得下一版以为「台账本来就不会错」）。
const KNOWN_GAPS = [];

const KNOWN_KEYS = new Set(KNOWN_GAPS.map((g) => g.key));
const gapWhy = (key) => (KNOWN_GAPS.find((g) => g.key === key) || { why: '' }).why;

// ── 基线：真实台账 ──────────────────────────────────────────
function runBaseline() {
  ok('台账文件可读（' + LEDGER + '）', fs.existsSync(LEDGER), LEDGER);
  if (!fs.existsSync(LEDGER)) return;
  const text = fs.readFileSync(LEDGER, 'utf8');
  const res = checkLedger(text);
  const summary = res.summary;

  ok('台账结构件齐全（统计行 / 索引表 / 明细段 / 状态表）',
    !!summary.statsLine && summary.indexRows > 0 && summary.detailCount > 0 && summary.statusUnion > 0,
    JSON.stringify(summary));

  // 每一条检查：**新增**偏差必须为空（已登记的已知缺口不算新增）
  for (const c of res.checks) {
    const fresh = c.deviations.filter((d) => !KNOWN_KEYS.has(d.key));
    const known = c.deviations.filter((d) => KNOWN_KEYS.has(d.key));
    ok('台账检查 ' + c.id + '：没有新增偏差' + (known.length ? '（已登记的已知缺口 ' + known.length + ' 处）' : ''),
      fresh.length === 0,
      fresh.length ? fresh.map((d) => d.message).join(' | ') : (known.length ? known.map((d) => d.key).join(',') : ''));
  }

  // 总闸门：全部偏差都必须已登记（清单为空 ⇒ 期望台账零偏差）
  const fresh = res.deviations.filter((d) => !KNOWN_KEYS.has(d.key));
  ok(KNOWN_GAPS.length
    ? '台账没有新出现的不自洽（全部偏差都在已登记清单里）'
    : '台账零偏差（已知缺口清单为空：台账一旦不自洽就应当转红）', fresh.length === 0,
    fresh.length ? fresh.map((d) => d.key + ' :: ' + d.message).join(' | ') : '');

  // 已登记但已经不存在的缺口 = 失效钉住项 ⇒ 提示父会话清理（不转红）
  const present = new Set(res.deviations.map((d) => d.key));
  const stale = [...KNOWN_KEYS].filter((k) => !present.has(k));
  if (stale.length) {
    warn('已登记的已知缺口里有 ' + stale.length + ' 项已不存在（台账已被修好或改了写法）⇒ 请把 KNOWN_GAPS 里对应条目删掉：' + stale.join(', '));
  } else {
    ok('已知缺口清单与台账现状一致（没有失效钉住项）', true);
  }

  // 逐条打印已登记的缺口（让人一眼看见台账现在哪里不实）
  for (const d of res.deviations) {
    if (KNOWN_KEYS.has(d.key)) {
      console.log('PASS 台账已登记的已知缺口 :: ' + d.key + ' :: ' + d.message + ' :: ' + gapWhy(d.key));
    }
  }
}

// ── 变异体：把台账故意改坏 ⇒ 对应检查必须转红 ────────────────
// 每个变异体都在**副本**上做；改的是「台账这份数据」，不是检查器。
const MUTATIONS = [
  {
    id: 'M1',
    check: 'index-columns',
    desc: '索引表某一行塞进**未转义竖线**（F-03 的第 ① 类问题：行被切成 8 列而不是 5 列）',
    apply(text) {
      const lines = text.split(/\r\n|\r|\n/);
      const head = lines.findIndex((l) => splitRow(l)[0] === '台账编号');
      if (head < 0) return text;
      for (let i = head + 2; i < lines.length; i++) {
        if (!/^\s*\|/.test(lines[i])) break;
        lines[i] = lines[i].replace(/\|\s*$/, ' | 追加一列（未转义竖线阳性样本） |');
        return lines.join('\n');
      }
      return text;
    }
  },
  {
    id: 'M2',
    check: 'detail-meta-line',
    desc: '删掉一条明细段的「来源/严重度/归属层」行',
    apply(text) {
      const lines = text.split(/\r\n|\r|\n/);
      const start = lines.findIndex((l) => /^##\s+三、缺陷明细/.test(l));
      if (start < 0) return text;
      for (let i = start + 1; i < lines.length; i++) {
        if (!/^###\s+D-/.test(lines[i])) continue;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^#{2,3}\s/.test(lines[j])) break;
          if (/^-\s*来源：/.test(lines[j])) { lines.splice(j, 1); return lines.join('\n'); }
        }
      }
      return text;
    }
  },
  {
    id: 'M3',
    check: 'severity-distribution',
    desc: '把统计行的严重度分布改坏（明细重算与统计行不再一致）',
    apply(text) {
      const lines = text.split(/\r\n|\r|\n/);
      const i = lines.findIndex((l) => l.indexOf('条目统计') !== -1);
      if (i < 0) return text;
      const before = lines[i];
      lines[i] = lines[i].replace(/(P1\s*)\d+(\s*条)/, '$1999$2');
      return lines[i] === before ? text : lines.join('\n');
    }
  },
  {
    id: 'M4',
    check: 'sets-equal',
    desc: '删掉索引表里的一个 D 号（三个集合不再相同）',
    apply(text) {
      const lines = text.split(/\r\n|\r|\n/);
      const head = lines.findIndex((l) => splitRow(l)[0] === '台账编号');
      if (head < 0) return text;
      let last = -1;
      for (let i = head + 2; i < lines.length; i++) {
        if (!/^\s*\|/.test(lines[i])) break;
        last = i;
      }
      if (last < 0) return text;
      lines.splice(last, 1);
      return lines.join('\n');
    }
  },
  {
    id: 'M5',
    check: 'no-duplicate-d',
    desc: '在状态表里给一个 D 号补一行**状态矛盾**的重复行',
    apply(text) {
      const lines = text.split(/\r\n|\r|\n/);
      const head = lines.findIndex((l) => splitRow(l).indexOf('状态') !== -1 && splitRow(l)[0] === '台账号');
      if (head < 0) return text;
      for (let i = head + 2; i < lines.length; i++) {
        if (!/^\s*\|/.test(lines[i])) break;
        const cells = splitRow(lines[i]);
        lines.splice(i + 1, 0, '| ' + cells[0] + ' | 口径已定，待实现（变异体：重复行，状态与上一行矛盾） | 待派 |');
        return lines.join('\n');
      }
      return text;
    }
  },
  {
    id: 'M6',
    check: 'severity-distribution',
    desc: '把一条明细自己的严重度改掉（明细重算与统计行不再一致）',
    apply(text) {
      const lines = text.split(/\r\n|\r|\n/);
      const start = lines.findIndex((l) => /^##\s+三、缺陷明细/.test(l));
      if (start < 0) return text;
      for (let i = start + 1; i < lines.length; i++) {
        if (!/^###\s+D-/.test(lines[i])) continue;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^#{2,3}\s/.test(lines[j])) break;
          const m = lines[j].match(/^(.*严重度：\s*)(P[0-3])(.*)$/);
          if (m) {
            lines[j] = m[1] + (m[2] === 'P0' ? 'P1' : 'P0') + m[3];
            return lines.join('\n');
          }
        }
      }
      return text;
    }
  }
];

function runMutations() {
  const text = fs.readFileSync(LEDGER, 'utf8');
  const base = checkLedger(text);
  const baseKeys = new Set(base.deviations.map((d) => d.key));
  for (const mut of MUTATIONS) {
    const mutated = mut.apply(text);
    const applied = mutated !== text;
    ok('变异体 ' + mut.id + ' 确实改到了台账（' + mut.desc + '）', applied,
      applied ? '' : '变异体没命中目标 —— 变异体本身坏了（台账结构变了？）');
    if (!applied) continue;
    const res = checkLedger(mutated);
    const c = res.checks.find((x) => x.id === mut.check);
    const fresh = c ? c.deviations.filter((d) => !baseKeys.has(d.key)) : [];
    ok('变异体 ' + mut.id + ' 让检查 ' + mut.check + ' 转红（出现了基线没有的偏差）',
      !!c && !c.ok && fresh.length > 0,
      '新偏差=' + fresh.map((d) => d.key + ' :: ' + d.message).join(' | '));
    // 副本用完即弃：真实台账从头到尾没被写过
  }
  const after = fs.readFileSync(LEDGER, 'utf8');
  ok('变异过程中真实台账逐字节未变', after === text, '');
}

if (process.env.SAR_MUTATION_LEDGER === '1') {
  runMutations();
} else {
  runBaseline();
  runMutations();
}

console.log(fail === 0 ? '>>> LEDGER ALL PASS' : '>>> LEDGER FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
