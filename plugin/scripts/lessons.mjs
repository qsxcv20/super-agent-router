// 错题本与实战记录检索（插件侧）
// 从项目工作区的 .superagent/ 读取成员的历史教训与方法论。
// 插件包是只读的，教训与履历数据永远在项目里 —— 跨项目各看各的。
import fs from 'node:fs';
import path from 'node:path';

export function projectDir() {
  return process.env.MINIMAX_PROJECT_DIR || process.cwd();
}

export function lessonsDir() {
  return path.join(projectDir(), '.superagent', 'lessons');
}

export function lessonsPath(name) {
  const safe = String(name || '').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(lessonsDir(), safe + '.md');
}

export function methodsDir() {
  return path.join(projectDir(), '.superagent', 'methods');
}

export function methodPath(name) {
  const safe = String(name || '').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(methodsDir(), safe + '.md');
}

// 只取「规则」段 —— 那是下次派工能直接执行的一条判断。
// 现象/根因是背景，对派工无用，只占上下文。
export function readLessons(name) {
  let raw;
  try { raw = fs.readFileSync(lessonsPath(name), 'utf8'); } catch { return []; }
  const rules = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^-\s*\*\*规则\*\*[：:]\s*(.+)$/);
    if (m) rules.push(m[1].trim());
  }
  return rules;
}

export function countEntries(name) {
  let raw;
  try { raw = fs.readFileSync(lessonsPath(name), 'utf8'); } catch { return 0; }
  const m = raw.match(/^##\s+\d{4}-\d{2}-\d{2}\s+·/gm);
  return m ? m.length : 0;
}

// 实战记录（履历）：写在方法论文件的「实战记录」段里。
// 镜像关系：错题本记「栽过哪」（失败，下次前置），
//           实战记录记「做成过什么」（成功，下次匹配更准）。
export function readRecords(name) {
  let raw;
  try { raw = fs.readFileSync(methodPath(name), 'utf8'); } catch { return []; }
  const out = [];
  let cur = null;
  let inRecords = false;
  for (const line of raw.split(/\r?\n/)) {
    // 二级标题是段落边界；三级标题（###）属于段内条目，不切段
    if (/^##\s+/.test(line)) {
      inRecords = /实战记录/.test(line);
      continue;
    }
    if (!inRecords) continue;
    const h = line.match(/^###\s+(.+)$/);
    if (h) { cur = { title: h[1].trim(), approach: '', evidence: '', verified: '' }; out.push(cur); continue; }
    const a = line.match(/^-\s*做法[：:]\s*(.+)$/);
    if (a && cur) { cur.approach = a[1].trim(); continue; }
    const e = line.match(/^-\s*证据[：:]\s*(.+)$/);
    if (e && cur) { cur.evidence = e[1].trim(); continue; }
    const v = line.match(/^-\s*验收[：:]\s*(.+)$/);
    if (v && cur) { cur.verified = v[1].trim(); continue; }
  }
  return out;
}
