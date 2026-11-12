// 打 tag + 发 GitHub Release + 上传 zip 资产（GitHub Data API 通道，不依赖 git push）
//
// 为什么不用 git push：本机 github.com:443 直连不通（api.github.com 通），
// 而且本地历史与远端历史是**两条分叉的链**（git merge-base HEAD origin/main 为空），
// push 会毁掉已发布的历史。改走 API：建 ref → 建 release → 上传资产。
//
// 前置（顺序不能换）：
//   1) git add -A && git commit        —— sync-github.mjs 从 **HEAD 的 blob** 取内容，
//                                        未提交的新文件不会进包
//   2) node tools/sync-github.mjs      —— 同步文件并更新 main
//   3) node tools/verify-github.mjs    —— 逐文件比对 blob sha（不只比文件名）
//   4) git archive --format=zip --prefix=super-agent-router-<v> HEAD -o <zip>
//   5) node tools/release-github.mjs --version <v> --body <md> --zip <zip> [--dry-run]
//
// 用法：
//   node tools/release-github.mjs --version v0.5.9 --body body.md --zip pkg.zip --dry-run
//   node tools/release-github.mjs --version v0.5.9 --body body.md --zip pkg.zip
//
// 注意：token 只从凭据管理器读，不落盘、不打印。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const argv = process.argv.slice(2);
function arg(flag) { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; }
const VERSION = arg('--version');
const BODY_FILE = arg('--body');
const ZIP_FILE = arg('--zip');
const DRY = argv.includes('--dry-run');
if (!VERSION || !BODY_FILE || !ZIP_FILE) {
  console.error('缺少 --version / --body / --zip');
  process.exit(2);
}

const OWNER = process.env.SAR_GH_OWNER || 'qsxcv20';
const REPO_NAME = process.env.SAR_GH_REPO || 'super-agent-router';
const MARK = '<<<HTTPSTATUS>>>';

function getToken() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 30000
  });
  return ((r.stdout || '').match(/^password=(.*)$/m) || [])[1] || '';
}
const token = getToken();
if (!token) { console.error('找不到 GitHub 凭据'); process.exit(1); }

// 必须读 HTTP 状态码：curl 的**进程退出码**是 0（哪怕 HTTP 404），别拿它当状态码用。
function api(url, method, bodyFile, extraHeaders) {
  const args = ['-s', '--max-time', '120', '-X', method,
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  for (const h of (extraHeaders || [])) args.push('-H', h);
  if (bodyFile) args.push('--data-binary', '@' + bodyFile);
  args.push('-w', '\n' + MARK + '%{http_code}', url);
  const res = spawnSync('curl.exe', args, { encoding: 'utf8', timeout: 300000, maxBuffer: 100 * 1024 * 1024 });
  const raw = res.stdout || '';
  const idx = raw.lastIndexOf(MARK);
  const http = idx >= 0 ? parseInt(raw.slice(idx + MARK.length).trim(), 10) : 0;
  const bodyText = idx >= 0 ? raw.slice(0, idx) : raw;
  let j = null; try { j = JSON.parse(bodyText); } catch (e) {}
  return { http: http, json: j, raw: bodyText };
}
const AP = 'https://api.github.com';
const TMPDIR = process.env.TMP || process.env.TEMP || '.';

function step(label, fn) {
  console.log('\n=== ' + label + ' ===');
  const out = fn();
  console.log(JSON.stringify(out, null, 2));
  if (out && out.__fatal) { console.error('ABORT at ' + label); process.exit(1); }
  return out;
}

// ── 0. 前置：读远端 main；看 tag / release 是否已存在 ──
const mainRef = step('0. 读远端 main 引用', () => {
  const r = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/git/ref/heads/main', 'GET', null);
  if (r.http !== 200 || !r.json || !r.json.object) {
    return { __fatal: true, http: r.http, body: (r.json || {}).message };
  }
  return { sha: r.json.object.sha };
});
const targetSha = mainRef.sha;
const existingTag = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/git/ref/tags/' + VERSION, 'GET', null);
const existingRel = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/releases/tags/' + VERSION, 'GET', null);
console.log('\n[前置] 远端 main=' + targetSha.slice(0, 10) +
  ' | tag已存在=' + (existingTag.http === 200) +
  ' | release已存在=' + (existingRel.http === 200) +
  ' | zip=' + fs.statSync(ZIP_FILE).size + 'B');

if (DRY) {
  console.log('\n=== DRY-RUN（只读，不会改任何远端状态）===');
  console.log('1) POST /git/refs {ref: refs/tags/' + VERSION + ', sha: ' + targetSha + '}');
  console.log('2) POST /releases {tag_name: ' + VERSION + ', name: ' + VERSION + ', draft:false}');
  console.log('3) POST uploads.github.com/.../assets?name=super-agent-router-' + VERSION + '.zip');
  console.log('4) GET /releases/tags/' + VERSION + ' 自检');
  process.exit(0);
}

// ── 1. 建 tag（轻量引用，obj type = commit，与 v0.5.7 同形）──
step('1. 建 tag refs/tags/' + VERSION, () => {
  if (existingTag.http === 200) {
    if (existingTag.json.object.sha !== targetSha) {
      return { __fatal: true, why: 'tag 已存在但指向不同 sha', have: existingTag.json.object.sha, want: targetSha };
    }
    return { skipped: true, sha: existingTag.json.object.sha };
  }
  const bf = TMPDIR + '\\sar-tag-body.json';
  fs.writeFileSync(bf, JSON.stringify({ ref: 'refs/tags/' + VERSION, sha: targetSha }), 'utf8');
  const r = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/git/refs', 'POST', bf, ['-H', 'Content-Type: application/json']);
  if (r.http !== 201) return { __fatal: true, http: r.http, body: (r.json || {}).message };
  return { created: true, ref: r.json.ref, objType: r.json.object.type, sha: r.json.object.sha };
});

// ── 2. 建 Release ──
const rel = step('2. 建 Release', () => {
  if (existingRel.http === 200) return { skipped: true, id: existingRel.json.id };
  const bf = TMPDIR + '\\sar-rel-body.json';
  fs.writeFileSync(bf, JSON.stringify({
    tag_name: VERSION, name: VERSION,
    body: fs.readFileSync(BODY_FILE, 'utf8'),
    draft: false, prerelease: false
  }), 'utf8');
  const r = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/releases', 'POST', bf, ['-H', 'Content-Type: application/json']);
  if (r.http !== 201) return { __fatal: true, http: r.http, body: (r.json || {}).message };
  return { created: true, id: r.json.id, url: r.json.html_url };
});

// ── 3. 上传 zip 资产 ──
step('3. 上传 zip 资产', () => {
  if (existingRel.http === 200 && (existingRel.json.assets || []).length) {
    return { skipped: true, assets: existingRel.json.assets.map((a) => a.name) };
  }
  const name = 'super-agent-router-' + VERSION + '.zip';
  const r = api('https://uploads.github.com/repos/' + OWNER + '/' + REPO_NAME + '/releases/' + rel.id + '/assets?name=' + name,
    'POST', ZIP_FILE, ['-H', 'Content-Type: application/zip']);
  let j = null; try { j = JSON.parse(r.raw); } catch (e) {}
  if (r.http !== 201 || !j || !j.id) return { __fatal: true, http: r.http, raw: (r.raw || '').slice(0, 600) };
  return { uploaded: true, name: j.name, size: j.size, download: j.browser_download_url };
});

// ── 4. 自检：tag 必须指向 main 的那个 commit、Release 非草稿、资产恰好 1 个 ──
step('4. 自检', () => {
  const t = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/git/ref/tags/' + VERSION, 'GET', null);
  const r = api(AP + '/repos/' + OWNER + '/' + REPO_NAME + '/releases/tags/' + VERSION, 'GET', null);
  const out = {
    tag: t.http === 200
      ? { ref: t.json.ref, objType: t.json.object.type, sha: t.json.object.sha, matchesMain: t.json.object.sha === targetSha }
      : { http: t.http },
    release: r.http === 200
      ? {
          id: r.json.id, tag: r.json.tag_name, draft: r.json.draft, prerelease: r.json.prerelease,
          bodyLen: (r.json.body || '').length,
          assets: (r.json.assets || []).map((a) => ({ name: a.name, size: a.size })),
          url: r.json.html_url, published_at: r.json.published_at
        }
      : { http: r.http }
  };
  out.__fatal = !(out.tag && out.tag.objType === 'commit' && out.tag.matchesMain &&
    out.release && out.release.draft === false && out.release.assets.length === 1);
  return out;
});
console.log('\nRELEASE_OK');
