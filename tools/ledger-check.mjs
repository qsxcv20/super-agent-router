#!/usr/bin/env node
// 缺陷台账自洽检查（**严格**解析）
//
// 为什么要有它：台账的「统计行」是人写的，「明细区」也是人写的 ——
// 两份数据只要有一处漂移，统计行就在骗人。独立验收 F-03 实测过两处：
//   ① 索引表里有一行含**未转义竖线**（`mavis agent delete|update`），严格解析按 `|` 切列
//      把那一行切成 8 列而不是 5 列 ⇒ 那行被丢弃 ⇒ 索引表比明细区少一条；
//   ② 有 7 条明细段没有「来源/严重度」行 ⇒ 明细区**根本算不出**统计行那个分布。
// 统计行自己写着「统计以本表逐条明细为准」—— 做不到那句话，就是账不实。
//
// 为什么必须**严格**：上一版的临时脚本（docs/audit/.tmp-parent/ledger-check.mjs）
// 用宽松正则挑行，**恰恰漏掉了**上面第 ① 类问题 —— 漏掉问题的检查等于没检查。
// 本脚本的口径写死在下面，改口径 = 改判据，必须显式改这里。
//
// 口径（逐条写清，后来者才知道「为什么不是更简单的那个写法」）：
//   1. 表格行按 Markdown 规则切列：**未转义的 `|` 是列分隔符**，`\|` 是字面竖线。
//      索引表的每一行必须正好 5 列 —— 多一列就说明单元里塞了没转义的竖线。
//   2. 明细段只认「## 三、缺陷明细」**之后**的 `### D-xx` 标题
//      （第二节的模板代码块里也有 `### D-01`，那不是明细）。
//   3. 严重度只认明细段自己的「来源：… ｜ 严重度：Pn ｜ 归属层：…」行 ——
//      统计行的数字**不能**反过来当严重度的来源（那是拿结论证明结论）。
//   4. 「修复状态表」= 所有表头含「状态」的表的**并集**（台账按修复轮分了好几张表，
//      单独任何一张都不是全集；并集才对应「每个 D 都有状态」）。
//   5. 严重度分布要从**明细**重算，再与统计行**逐字**比 —— 不给容差、不看索引表。
//
// 用法：
//   node tools/ledger-check.mjs             # 检查仓库里的台账
//   node tools/ledger-check.mjs <文件>      # 检查指定文件（变异体检查用）
//   node tools/ledger-check.mjs --json      # 机器可读输出
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.SAR_REPO_DIR || path.resolve(HERE, '..');
export const DEFAULT_LEDGER = path.join(REPO_ROOT, 'docs', 'audit', 'defect-ledger.md');

export const CHECK_IDS = [
  'index-columns',
  'sets-equal',
  'severity-distribution',
  'detail-meta-line',
  'detail-count',
  'no-duplicate-d'
];

// ── Markdown 表格行的严格切列 ────────────────────────────────
// 为什么不用 line.split('|')：那样切不开 `\|`（转义竖线），
// 也看不出「单元里多塞了一个没转义的竖线」—— 恰恰是 F-03 查出的那类问题。
export function splitRow(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

const isDId = (s) => /^D-[0-9]+[a-z]?$/.test(String(s || '').trim());
const isTableLine = (l) => /^\s*\|/.test(l);
const isSeparatorRow = (l) => /^\|[\s:|-]+\|$/.test(String(l || '').trim());

function tableBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i])) {
      const start = i;
      const block = [];
      while (i < lines.length && isTableLine(lines[i])) { block.push(lines[i]); i++; }
      out.push({ startLine: start + 1, block });
    } else i++;
  }
  return out;
}

export function parseLedger(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const blocks = tableBlocks(lines);

  // 统计行：含「条目统计」的那一行
  let stats = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('条目统计') === -1) continue;
    const total = lines[i].match(/总计\s*\**\s*(\d+)\s*\**\s*条/);
    const sev = {};
    for (const s of ['P0', 'P1', 'P2', 'P3']) {
      const m = lines[i].match(new RegExp(s + '\\s*\\**\\s*(\\d+)\\s*\\**\\s*条'));
      sev[s] = m ? parseInt(m[1], 10) : null;
    }
    stats = { line: i + 1, raw: lines[i], total: total ? parseInt(total[1], 10) : null, severity: sev };
    break;
  }

  // 严重度索引表：表头第一格是「台账编号」
  const idxBlock = blocks.find((b) => splitRow(b.block[0])[0] === '台账编号');
  const indexRows = [];
  let indexTable = null;
  if (idxBlock) {
    const sepOk = isSeparatorRow(idxBlock.block[1]);
    for (let k = 2; k < idxBlock.block.length; k++) {
      const cells = splitRow(idxBlock.block[k]);
      indexRows.push({ line: idxBlock.startLine + k, raw: idxBlock.block[k], cells });
    }
    indexTable = { startLine: idxBlock.startLine, header: idxBlock.block[0], sepOk, rows: indexRows };
  }

  // 修复状态表：表头含「状态」的那几张（并集才对应「每个 D 都有状态」）
  const statusTables = [];
  for (const b of blocks) {
    const head = splitRow(b.block[0]);
    if (head.indexOf('状态') === -1) continue;
    const rows = [];
    for (let k = 2; k < b.block.length; k++) {
      const cells = splitRow(b.block[k]);
      rows.push({ line: b.startLine + k, raw: b.block[k], cells });
    }
    statusTables.push({ startLine: b.startLine, header: b.block[0], rows });
  }

  // 明细段：只认「## 三、缺陷明细」之后的 ### D-xx
  const detailStart = lines.findIndex((l) => /^##\s+三、缺陷明细/.test(l));
  const details = [];
  if (detailStart >= 0) {
    for (let k = detailStart + 1; k < lines.length; k++) {
      const m = lines[k].match(/^###\s+(D-[0-9]+[a-z]?)\s*$/);
      if (!m) continue;
      const id = m[1];
      let meta = null;
      let metaLine = null;
      for (let j = k + 1; j < lines.length; j++) {
        if (/^#{2,3}\s/.test(lines[j])) break;
        const mm = lines[j].match(/^-\s*来源：(.+?)｜\s*严重度：\s*(P[0-3])([^｜]*)｜\s*归属层：\s*(.+)$/);
        if (mm && !meta) {
          meta = { source: mm[1].trim(), severity: mm[2], note: mm[3].trim(), layer: mm[4].trim() };
          metaLine = j + 1;
        }
      }
      details.push({ id, line: k + 1, meta, metaLine });
    }
  }

  return { lines, stats, indexTable, statusTables, details, detailStartLine: detailStart + 1 };
}

// ── 六条检查 ─────────────────────────────────────────────────
export function checkLedger(text) {
  const p = parseLedger(text);
  const checks = {};
  const add = (id, deviation) => {
    if (!checks[id]) checks[id] = { id, ok: true, deviations: [] };
    if (deviation) { checks[id].ok = false; checks[id].deviations.push(deviation); }
  };

  // ① 严重度索引表：每行必须正好 5 列
  if (!p.indexTable) {
    add('index-columns', { key: 'index-columns:table-missing', message: '找不到严重度索引表（表头第一格应为「台账编号」）' });
  } else {
    if (!p.indexTable.sepOk) {
      add('index-columns', { key: 'index-columns:separator', line: p.indexTable.startLine + 1, message: '索引表缺合法的分隔行（|---|---|）' });
    }
    for (const row of p.indexTable.rows) {
      if (row.cells.length !== 5) {
        add('index-columns', {
          key: 'index-columns:line-' + row.line,
          line: row.line,
          message: '索引表第 ' + row.line + ' 行不是 5 列（实为 ' + row.cells.length + ' 列）—— 单元里多半塞了未转义的竖线：' + row.raw.trim()
        });
      }
    }
  }

  // ② 三个 D 号集合必须完全相同（索引表 / 明细段 / 修复状态表并集）
  const indexIds = p.indexTable ? p.indexTable.rows.map((r) => r.cells[0]).filter(isDId) : [];
  const detailIds = p.details.map((d) => d.id);
  const statusIds = [];
  for (const t of p.statusTables) for (const r of t.rows) if (isDId(r.cells[0])) statusIds.push(r.cells[0]);
  const sets = { index: indexIds, detail: detailIds, status: statusIds };
  const union = new Set([...indexIds, ...detailIds, ...statusIds]);
  for (const name of ['index', 'detail', 'status']) {
    const have = new Set(sets[name]);
    for (const id of union) {
      if (!have.has(id)) {
        add('sets-equal', { key: 'sets-equal:missing:' + name + ':' + id, message: '「' + name + '」集合里缺 ' + id + '（其它集合里有）' });
      }
    }
    for (const id of have) {
      if (!union.has(id)) {
        add('sets-equal', { key: 'sets-equal:extra:' + name + ':' + id, message: '「' + name + '」集合里多了 ' + id + '（其它集合里没有）' });
      }
    }
  }

  // ③ 严重度分布：从明细重算，与统计行逐字比
  if (!p.stats || p.stats.total === null) {
    add('severity-distribution', { key: 'severity-distribution:stats-missing', message: '找不到「条目统计」行或读不出「总计 N 条」' });
  } else {
    const computed = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const d of p.details) if (d.meta) computed[d.meta.severity]++;
    for (const s of ['P0', 'P1', 'P2', 'P3']) {
      const claimed = p.stats.severity[s];
      if (claimed === null) {
        add('severity-distribution', { key: 'severity-distribution:' + s + ':unparsable', message: '统计行里读不出 ' + s + ' 的条数：' + p.stats.raw.trim() });
      } else if (claimed !== computed[s]) {
        add('severity-distribution', {
          key: 'severity-distribution:' + s,
          line: p.stats.line,
          message: s + ' 分布对不上：明细重算 ' + computed[s] + ' 条，统计行写 ' + claimed + ' 条（统计行第 ' + p.stats.line + ' 行）'
        });
      }
    }
  }

  // ④ 每条明细段都要有一行「来源：… ｜ 严重度：Pn ｜ 归属层：…」
  for (const d of p.details) {
    if (!d.meta) {
      add('detail-meta-line', { key: 'detail-meta-line:' + d.id, line: d.line, message: '明细段 ' + d.id + '（第 ' + d.line + ' 行）没有「来源：… ｜ 严重度：Pn ｜ 归属层：…」行' });
    }
  }

  // ⑤ 明细区条数 = 统计行的「总计」
  if (!p.stats || p.stats.total === null) {
    add('detail-count', { key: 'detail-count:stats-missing', message: '找不到「条目统计」行或读不出「总计 N 条」' });
  } else if (p.details.length !== p.stats.total) {
    add('detail-count', {
      key: 'detail-count',
      line: p.stats.line,
      message: '明细区 ' + p.details.length + ' 条 ≠ 统计行总计 ' + p.stats.total + ' 条'
    });
  }

  // ⑥ 同一张表里同一个 D 号不得出现两次（两次 = 两个互相矛盾的状态）
  const dupSeen = [];
  for (const t of p.statusTables) {
    const seen = new Map();
    for (const r of t.rows) {
      const id = r.cells[0];
      if (!isDId(id)) continue;
      if (seen.has(id)) dupSeen.push({ id, table: t.startLine, lines: [seen.get(id).line, r.line], statuses: [seen.get(id).cells[1], r.cells[1]] });
      else seen.set(id, r);
    }
  }
  const seenIdx = new Map();
  for (const r of (p.indexTable ? p.indexTable.rows : [])) {
    const id = r.cells[0];
    if (!isDId(id)) continue;
    if (seenIdx.has(id)) dupSeen.push({ id, table: p.indexTable.startLine, lines: [seenIdx.get(id).line, r.line], statuses: ['索引表', '索引表'] });
    else seenIdx.set(id, r);
  }
  for (const d of dupSeen) {
    add('no-duplicate-d', {
      key: 'no-duplicate-d:' + d.id,
      line: d.lines[1],
      message: d.id + ' 在第 ' + d.table + ' 行的表里出现两次（第 ' + d.lines[0] + ' 行与第 ' + d.lines[1] + ' 行）' +
        (d.statuses[0] !== d.statuses[1] ? '，且状态互相矛盾：「' + d.statuses[0] + '」 vs 「' + d.statuses[1] + '」' : '')
    });
  }

  const deviations = [];
  for (const id of CHECK_IDS) {
    const c = checks[id] || { id, ok: true, deviations: [] };
    for (const d of c.deviations) deviations.push({ check: id, ...d });
  }
  return {
    ok: deviations.length === 0,
    checks: CHECK_IDS.map((id) => checks[id] || { id, ok: true, deviations: [] }),
    deviations,
    summary: {
      statsLine: p.stats ? p.stats.line : null,
      indexRows: p.indexTable ? p.indexTable.rows.length : 0,
      detailCount: p.details.length,
      statusUnion: statusIds.length,
      indexIds: indexIds.length
    }
  };
}

export function checkLedgerFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    return { ok: false, error: '读不到台账文件：' + (e && e.message ? e.message : String(e)), checks: [], deviations: [] };
  }
  return checkLedger(text);
}

// ── CLI ──────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const asJson = args.indexOf('--json') !== -1;
  const target = args.find((a) => a !== '--json');
  const file = target ? path.resolve(target) : DEFAULT_LEDGER;
  const res = checkLedgerFile(file);
  if (asJson) {
    process.stdout.write(JSON.stringify({ file, ...res }, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
  console.log('台账：' + file);
  console.log('摘要：' + JSON.stringify(res.summary));
  for (const c of res.checks) {
    console.log((c.ok ? 'PASS ' : 'FAIL ') + '台账检查 ' + c.id + (c.ok ? '' : '（' + c.deviations.length + ' 处）'));
    for (const d of c.deviations) console.log('       ' + d.message);
  }
  console.log(res.ok ? '>>> 台账自洽' : '>>> 台账不自洽（' + res.deviations.length + ' 处）');
  process.exit(res.ok ? 0 : 1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
