// 插件包全量同步：仓库 plugin/ → 安装目录 → 运行时 Hook 缓存
// 用法：node tools/deploy-plugin.mjs
//
// v0.4.0 修正（实战验收查出的高severity问题）：
// 早期版本只同步 4 个脚本 + hooks.json，清单文件 .minimax-plugin/plugin.json
// 永远停在旧版本 —— 机制生效了，但「版本身份」没发布出去，
// 用户在安装目录里看到的仍是旧版本号与旧描述。改成全量同步：
// 仓库 plugin/ 里有什么，安装目录里就是什么。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SRC = path.join(ROOT, 'plugin');
const HOME = process.env.USERPROFILE;
const INST = path.join(HOME, '.minimax', 'plugins', 'super-agent-router');
const CACHE = path.join(HOME, '.minimax', 'v2', 'plugin-hook-cache');
const LEASES = path.join(CACHE, '.leases');
// 本插件在 manifest 里的 name —— 缓存树归属靠它判定，不能靠「目录里有哪些文件」。
const PLUGIN_NAME = 'super-agent-router';

let copied = 0;
let removed = 0;

function syncTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const keep = new Set();
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) {
      keep.add(e.name + '/');
      syncTree(s, d);
      continue;
    }
    keep.add(e.name);
    try { fs.chmodSync(d, 0o666); } catch (err) {}
    fs.copyFileSync(s, d);
    copied++;
  }
  for (const e of fs.readdirSync(to, { withFileTypes: true })) {
    if (keep.has(e.name) || keep.has(e.name + '/')) continue;
    try { fs.rmSync(path.join(to, e.name), { recursive: true, force: true }); removed++; } catch (err) {}
  }
}

syncTree(SRC, INST);
process.stdout.write('INSTALLED_SYNCED copied=' + copied + ' removed=' + removed + '\n');

// 只同步**属于本插件**的缓存树。
//
// 为什么必须判归属（D-63）：租约目录 .leases/ 下同时躺着**别的插件**的树
//（实测有一棵是 superpowers 6.2.8，57 个文件、含它自己的 skills/ 与 hooks/）。
// 以前这里对每一棵存在的树都执行 syncTree(SRC, dir) —— syncTree 会
// **删掉源里没有的文件**（removed++），等于把别人的插件整棵覆盖成我们的内容。
// 本轮实测侥幸没出事（那棵树在部署之后才被运行时重建），但这是**靠运气**不是靠机制。
//
// 判据：读那棵树自己的 .minimax-plugin/plugin.json 的 name 字段；
// 读不出来或不是本插件 → 跳过并如实报出来，不猜。
const trees = fs.existsSync(LEASES) ? fs.readdirSync(LEASES) : [];
let treeCount = 0;
const skipped = [];
for (const t of trees) {
  const dir = path.join(CACHE, t);
  if (!fs.existsSync(dir)) continue;
  let owner = '';
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.minimax-plugin', 'plugin.json'), 'utf8'));
    owner = String(m.name || '');
  } catch (e) {
    owner = '(读不出插件名)';
  }
  if (owner !== PLUGIN_NAME) {
    skipped.push(t + ' -> ' + owner);
    continue;
  }
  syncTree(SRC, dir);
  treeCount++;
}
process.stdout.write('CACHE_SYNCED trees=' + treeCount +
  ' skipped=' + skipped.length + (skipped.length ? ' [' + skipped.join(', ') + ']' : '') + '\n');

const manifest = JSON.parse(fs.readFileSync(path.join(INST, '.minimax-plugin', 'plugin.json'), 'utf8'));
process.stdout.write('INSTALLED_VERSION=' + manifest.version + '\n');
