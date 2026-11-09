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
// 用法：
//   node scripts/records.mjs summary        列出所有成员的实战记录摘要
//   node scripts/records.mjs <agent>        列出单个成员的实战记录
//
// 注意：本文件同时被 gate.mjs 当库 import。
// CLI 分支必须只在「直接运行时」执行，否则 import 它的进程会被 exit(0) 干掉。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectDir, readRecords } from './lessons.mjs';

export function rosterPath() {
  return path.join(projectDir(), '.superagent', 'roster.json');
}

export function readRoster() {
  try {
    const r = JSON.parse(fs.readFileSync(rosterPath(), 'utf8'));
    if (!Array.isArray(r.members)) r.members = [];
    return r;
  } catch {
    return { members: [] };
  }
}

// 每个成员最多带 N 条最近的记录，避免注入膨胀
export function summarizeRecords(maxPerMember = 3, maxMembers = 8) {
  const roster = readRoster();
  const out = [];
  for (const m of roster.members) {
    const recs = readRecords(m.name);
    if (!recs.length) continue;
    out.push({
      name: m.name,
      owns: m.owns || '',
      count: recs.length,
      // 记录按时间正序写入，末尾最新
      records: recs.slice(-maxPerMember).reverse()
    });
    if (out.length >= maxMembers) break;
  }
  return out;
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
    process.stdout.write(JSON.stringify({ members: summarizeRecords() }, null, 2));
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
