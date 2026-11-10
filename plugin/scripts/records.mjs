// 实战记录摘要（匹配阶段给 Router 参考）
//
// 与错题本的分工：
//   错题本 -> 派工时前置给 Worker（上次栽在哪）
//   实战记录 -> 匹配阶段给 Router 参考（这人到底做成过什么）
//
// 重要：这里只做「参考注入」，绝不自动改写 roster.json 的 owns。
// 归属声明是人工可审计的资产；让模型根据战绩自行收窄 owns，
// 等于让系统自己给自己发权限 —— 不可审计，也不可追责。
//
// 取样口径（契约 S7.3 / 缺陷 D-24）：
//   旧口径 = 沿名录顺序遍历，凑满 maxMembers 就 break ——
//   排在名录第 7 位以后的成员**结构性不可见**：不是因为战绩不够，
//   而是因为「在名录里排得靠后」。这不是排序偏好，是系统性失明。
//   新口径 = 三步，每一步都可验算：
//     1. 先把「有记录的成员」**全部**收集出来（不再按名录顺序提前 break）；
//     2. 按「成果条数降序 → 同条数按名字升序」排序后取前 maxMembers；
//     3. 把被省略的成员**显式披露**（omitted / totalMembers / truncated）。
//   排序键为什么不用 owns 相关度：相关度排序需要调用方传查询上下文，
//     本函数没有查询参数，凭空猜一个「相关」只会造出不可复现的口径；
//     「成果条数」是可验算的确定性代理值，同条数用名字兜底保证无并列歧义。
//   披露为什么必须做：截断本身不可避免（上下文有预算），
//     但静默截断会让注入文本读起来像全集 —— 那是在骗 Router，
//     也会让「靠后的成员不可见」重新变成一个没人知道的事实。
//
// 用法：
//   node scripts/records.mjs summary        列出所有成员的实战记录摘要
//   node scripts/records.mjs <agent>        列出单个成员的实战记录
//
// 注意：本文件同时被 gate.mjs 当库 import。
// CLI 分支必须只在「直接运行时」执行，否则 import 它的进程会被 exit(0) 干掉。

import { pathToFileURL } from 'node:url';
import { readRecords } from './lessons.mjs';
import { rosterPath, readRoster, listMembers, MAX_ROSTER } from './roster.mjs';

// 名录的读法只有一份 —— roster.mjs 是唯一出处。
// 这里原样再导出，是为了让按 rosterPath / readRoster 引用本模块的老调用方不受影响。
export { rosterPath, readRoster };

// 每个成员最多带 N 条最近的记录，避免注入膨胀。
//
// 返回值里除 members 外还带披露字段（totalMembers / shownMembers / omitted /
// truncated / rosterCap），让调用方能如实写「已显示 N / 共 M」，
// 而不是让注入文本读起来像全集。
export function summarizeRecordsDetailed(maxPerMember = 3, maxMembers = 8) {
  const roster = readRoster();
  const withRecords = [];
  // 第 1 步：把有记录的成员全部收齐 —— 这里**不能**提前 break（D-24 的成因）
  for (const m of listMembers(roster)) {
    const recs = readRecords(m.name);
    if (!recs.length) continue;
    withRecords.push({
      name: m.name,
      owns: m.owns || '',
      count: recs.length,
      // 记录按时间正序写入，末尾最新
      records: recs.slice(-maxPerMember).reverse()
    });
  }
  // 第 2 步：排序后再取。成果条数降序（相关度代理），同条数按名字升序（确定性）
  withRecords.sort((a, b) =>
    (b.count - a.count) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const shown = withRecords.slice(0, maxMembers);
  const omitted = withRecords.slice(maxMembers).map((x) => x.name);
  // 第 3 步：披露。省略了谁、共多少人，一并交出去
  return {
    members: shown,
    totalMembers: withRecords.length,
    shownMembers: shown.length,
    omitted,
    truncated: omitted.length > 0,
    maxPerMember,
    maxMembers,
    // 名录上限：maxMembers >= rosterCap 时，不可能有成员被名额挤掉
    rosterCap: MAX_ROSTER
  };
}

// 向后兼容：老调用方（gate.mjs / session-start.mjs / dispatch.mjs）只要一个数组。
// 需要披露信息的调用方请用 summarizeRecordsDetailed()。
export function summarizeRecords(maxPerMember = 3, maxMembers = 8) {
  return summarizeRecordsDetailed(maxPerMember, maxMembers).members;
}

// 判断是否直接运行本文件（而非被 import）
function isMain() {
  try {
    if (!process.argv[1]) return false;
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'summary') {
    process.stdout.write(JSON.stringify(summarizeRecordsDetailed(), null, 2));
  } else if (argv[0]) {
    process.stdout.write(JSON.stringify({
      agent: argv[0],
      records: readRecords(argv[0])
    }, null, 2));
  } else {
    process.stdout.write('usage: records.mjs summary|<agent>');
  }
  process.exit(0);
}
