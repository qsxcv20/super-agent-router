// 远端内容核对：GitHub tree 递归列 blob，与本地提交内 blob sha 逐文件比对
//
// 为什么必须逐文件比 sha 而不是比文件名：
//   远端 tree 的 path 列表对得上，只能证明「文件集合一致」，
//   证明不了「内容一致」—— 行尾（CRLF/LF）、编码、大小写都可能不同。
//   git blob sha = sha1('blob <len>\0' + content)，内容一字节不同 sha 就不同，
//   所以逐文件比对 blob sha 是最硬的内容级证据。
//
// 用法：node tools/verify-github.mjs
// 退出码 0 = 完全一致；1 = 有差异（打印差异明细）

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const WS = process.cwd();
const OWNER = process.env.SAR_GH_OWNER || 'qsxcv20';
const REPO_NAME = process.env.SAR_GH_REPO || 'super-agent-router';
const BRANCH = process.env.SAR_GH_BRANCH || 'main';
const MARK = '<<<HTTPSTATUS>>>';

function getToken() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 30000
  });
  return ((r.stdout || '').match(/^password=(.*)$/m) || [])[1] || '';
}

const token = getToken();
if (!token) { console.error('找不到 GitHub 凭据'); process.exit(1); }

function api(pathname) {
  const res = spawnSync('curl.exe', [
    '-s', '--max-time', '120',
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-w', '\n' + MARK + '%{http_code}',
    'https://api.github.com' + pathname
  ], { encoding: 'utf8', timeout: 180000, maxBuffer: 100 * 1024 * 1024 });
  const raw = res.stdout || '';
  const idx = raw.lastIndexOf(MARK);
  const status = idx >= 0 ? parseInt(raw.slice(idx + MARK.length).trim(), 10) : 0;
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  let j = null;
  try { j = JSON.parse(bodyText); } catch (e) {}
  return { status, json: j };
}

// 本地：HEAD 提交内的全部 blob（用 git ls-tree 读提交里的 sha，不用工作区 hash-object）
const lt = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', 'HEAD'], { cwd: WS, encoding: 'utf8' });
const local = new Map();
for (const rec of (lt.stdout || '').split('\0').filter(Boolean)) {
  const m = rec.match(/^(\d+) blob ([0-9a-f]{40})\t(.*)$/);
  if (m) local.set(m[3], m[2]);
}

// 远端：分支 head 提交的 tree 递归展开
const ref = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/ref/heads/' + BRANCH);
if (ref.status !== 200) { console.error('取远端引用失败: ' + ref.status + ' ' + (ref.json && ref.json.message)); process.exit(1); }
const headSha = ref.json.object.sha;
const commit = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/commits/' + headSha);
const treeSha = commit.json.tree.sha;
const tree = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/trees/' + treeSha + '?recursive=1');
const remote = new Map();
for (const e of (tree.json && tree.json.tree ? tree.json.tree : [])) {
  if (e.type === 'blob') remote.set(e.path, e.sha);
}
const truncated = !!(tree.json && tree.json.truncated);

console.log('远端 head   : ' + headSha);
console.log('本地 HEAD   : ' + spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WS, encoding: 'utf8' }).stdout.trim());
console.log('远端文件数  : ' + remote.size + (truncated ? ' (tree 截断，结果不完整!)' : ''));
console.log('本地文件数  : ' + local.size);

const onlyLocal = [...local.keys()].filter(p => !remote.has(p));
const onlyRemote = [...remote.keys()].filter(p => !local.has(p));
const diffSha = [...local.keys()].filter(p => remote.has(p) && remote.get(p) !== local.get(p));

let bad = 0;
if (truncated) { console.error('!! 远端 tree 被截断，核对结果不可信'); bad++; }
if (onlyLocal.length) { console.error('本地有远端没有: ' + onlyLocal.length); onlyLocal.slice(0, 20).forEach(p => console.error('   + ' + p)); bad++; }
if (onlyRemote.length) { console.error('远端有本地没有: ' + onlyRemote.length); onlyRemote.slice(0, 20).forEach(p => console.error('   - ' + p)); bad++; }
if (diffSha.length) { console.error('内容 sha 不一致: ' + diffSha.length); diffSha.slice(0, 20).forEach(p => console.error('   ! ' + p + '  local=' + local.get(p) + ' remote=' + remote.get(p))); bad++; }

const same = [...local.keys()].filter(p => remote.has(p) && remote.get(p) === local.get(p)).length;
console.log('逐文件 sha 一致: ' + same + ' / ' + local.size);
console.log(bad === 0 ? '>>> GITHUB VERIFY ALL MATCH' : '>>> GITHUB VERIFY MISMATCH');
process.exit(bad === 0 ? 0 : 1);
