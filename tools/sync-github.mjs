// 一键同步到 GitHub（GitHub API 通道，不依赖 git push 的网络路径）
//
// 为什么不用 git push：本机 github.com:443 直连不通（api.github.com 通），
// 所以 git 走 HTTPS 推送会超时。改用 Git Data API 走 api.github.com，绕开该限制。
//
// 用法：node tools/sync-github.mjs
//   - 从 Windows 凭据管理器取已存的 GitHub PAT（git credential fill）
//   - 建仓（不存在时，private）
//   - 上传全部 git 跟踪文件 → tree → commit → 更新 main 引用
//
// 注意：token 只从凭据管理器读，不落盘、不打印。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WS = process.cwd();
const OWNER = process.env.SAR_GH_OWNER || 'qsxcv20';
const REPO_NAME = process.env.SAR_GH_REPO || 'super-agent-router';
const BRANCH = 'main';
const MARK = '<<<HTTPSTATUS>>>';

function getToken() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 30000
  });
  const pw = ((r.stdout || '').match(/^password=(.*)$/m) || [])[1];
  if (!pw) {
    console.error('找不到 GitHub 凭据。先在浏览器登录一次 GitHub 让凭据管理器存下 PAT。');
    process.exit(1);
  }
  return pw;
}

const token = getToken();
const TMP = path.join(WS, '.git-sync-tmp');
fs.mkdirSync(TMP, { recursive: true });

function api(pathname, method, bodyObj) {
  const args = ['-s', '--max-time', '120', '-X', method,
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-w', '\n' + MARK + '%{http_code}'];
  if (bodyObj) {
    const bf = path.join(TMP, 'body.json');
    fs.writeFileSync(bf, JSON.stringify(bodyObj), 'utf8');
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@' + bf);
  }
  args.push('https://api.github.com' + pathname);
  const res = spawnSync('curl.exe', args, { encoding: 'utf8', timeout: 180000, maxBuffer: 100 * 1024 * 1024 });
  const raw = res.stdout || '';
  const idx = raw.lastIndexOf(MARK);
  const status = idx >= 0 ? parseInt(raw.slice(idx + MARK.length).trim(), 10) : 0;
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  let j = null;
  try { j = JSON.parse(bodyText); } catch (e) {}
  return { status: status, json: j, raw: bodyText };
}

const ls = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { cwd: WS, encoding: 'utf8' });
const files = (ls.stdout || '').split('\0').filter(Boolean);
console.log('待同步文件: ' + files.length);

// 1. 仓库
let chk = api('/repos/' + OWNER + '/' + REPO_NAME, 'GET', null);
if (chk.status === 404) {
  const c = api('/user/repos', 'POST', {
    name: REPO_NAME, private: true, auto_init: false,
    description: 'Super-agent 编排：路由/组队/派工/scope 拦截/独立验收，错题本记失败、实战记录记成功'
  });
  if (c.status !== 201) { console.error('建仓失败: ' + (c.json && c.json.message)); process.exit(1); }
  console.log('已创建仓库: ' + c.json.full_name);
} else {
  console.log('仓库已存在: ' + (chk.json && chk.json.full_name));
}

// 2. 引导提交（空仓库禁止建 blob）
let ref = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/ref/heads/' + BRANCH, 'GET', null);
let baseSha = ref.json && ref.json.object ? ref.json.object.sha : null;
if (!baseSha) {
  const init = api('/repos/' + OWNER + '/' + REPO_NAME + '/contents/README.md', 'PUT', {
    path: 'README.md', message: 'chore: init', branch: BRANCH,
    content: Buffer.from('# ' + REPO_NAME + '\n\n详见仓库内 README.md。\n', 'utf8').toString('base64')
  });
  if (init.status !== 200 && init.status !== 201) { console.error('引导提交失败: ' + (init.json && init.json.message)); process.exit(1); }
  ref = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/ref/heads/' + BRANCH, 'GET', null);
  baseSha = ref.json.object.sha;
  console.log('引导提交完成');
}
const baseCommit = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/commits/' + baseSha, 'GET', null);
const baseTree = baseCommit.json.tree.sha;

// 3. blob
//
// 内容必须取**提交里的 blob**，不能读工作区文件：
// git 在 add 时会按 .gitattributes / autocrlf 把 CRLF 归一成 LF 存进提交，
// 工作区那份可能仍是 CRLF —— 直接上传工作区字节，远端 blob 就与提交 blob 不一致
// （实测过一次：verification-v050.md 远端 sha 与 HEAD sha 不同，内容等价但行尾不同）。
// 用 git cat-file blob 取的是提交里的原始字节，与 git blob sha 天然对齐。
const entries = [];
for (const rel of files) {
  const b64 = spawnSync('git', ['cat-file', 'blob', 'HEAD:' + rel], { cwd: WS, maxBuffer: 64 * 1024 * 1024 }).stdout.toString('base64');
  const r = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/blobs', 'POST', { content: b64, encoding: 'base64' });
  if (r.status !== 201) { console.error('blob 失败 ' + rel + ': ' + (r.json && r.json.message)); process.exit(1); }
  entries.push({ path: rel, mode: '100644', type: 'blob', sha: r.json.sha });
}
console.log('blob 上传: ' + entries.length);

// 3.5 清理远端孤儿：本地已删且从未被 git 跟踪的文件，git ls-files 看不见，
//     base_tree 也不会自动删，必须显式传 sha:null 才会真删。
const localSet = new Set(files);
const remoteTree = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/trees/' + baseTree + '?recursive=1', 'GET', null);
const orphans = (remoteTree.json && remoteTree.json.tree ? remoteTree.json.tree : [])
  .filter(function (e) { return e.type === 'blob' && !localSet.has(e.path); })
  .map(function (e) { return { path: e.path, mode: '100644', type: 'blob', sha: null }; });
if (orphans.length) {
  console.log('清理远端孤儿: ' + orphans.length + ' 个 -> ' + orphans.map(function (o) { return o.path; }).join(', '));
}
for (const o of orphans) entries.push(o);

// 4. tree + commit + ref
const tr = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/trees', 'POST', { base_tree: baseTree, tree: entries });
if (tr.status !== 201) { console.error('tree 失败: ' + (tr.json && tr.json.message)); process.exit(1); }
const cm = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/commits', 'POST', {
  message: 'chore: 同步 ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
  tree: tr.json.sha, parents: [baseSha],
  author: { name: 'yang2', email: 'yang2@users.noreply.github.com', date: new Date().toISOString() }
});
if (cm.status !== 201) { console.error('commit 失败: ' + (cm.json && cm.json.message)); process.exit(1); }
const ur = api('/repos/' + OWNER + '/' + REPO_NAME + '/git/refs/heads/' + BRANCH, 'PATCH', { sha: cm.json.sha, force: false });
if (ur.status !== 200) { console.error('更新引用失败: ' + (ur.json && ur.json.message)); process.exit(1); }

fs.rmSync(TMP, { recursive: true, force: true });
console.log('同步完成 -> https://github.com/' + OWNER + '/' + REPO_NAME + '  commit=' + cm.json.sha.slice(0, 10));