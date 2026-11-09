// 一键推送脚本：等 gh 授权完成后运行
// 用法：node _push.mjs [public|private]
import { spawnSync } from 'node:child_process';

const WS = 'C:\\Users\\yang2\\Documents\\MiniMax\\mini code的插件';
const VISIBILITY = process.argv[2] === 'public' ? 'public' : 'private';
const REPO = 'super-agent-router';

const cleanEnv = { ...process.env };
for (const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) delete cleanEnv[k];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: WS, encoding: 'utf8', env: cleanEnv, timeout: 120000, ...opts });
  return { out: ((r.stdout || '') + (r.stderr || '')).trim(), code: r.status };
}

console.log('=== 1. 检查 gh 认证 ===');
const auth = run('gh', ['auth', 'status']);
if (auth.code !== 0) {
  console.log('未认证:\n' + auth.out);
  process.exit(1);
}
console.log(auth.out.split('\n').slice(0, 3).join('\n'));

console.log('\n=== 2. 创建远程仓库 ===');
const view = run('gh', ['repo', 'view', REPO]);
if (view.code === 0) {
  console.log('仓库已存在，复用');
} else {
  const create = run('gh', ['repo', 'create', REPO, '--' + VISIBILITY, '--description', 'Super-agent 编排：路由/组队/派工/scope 拦截/独立验收/错题本闭环', '--source', '.', '--remote', 'origin', '--push']);
  console.log(create.out);
  if (create.code !== 0) { console.log('创建失败 exit=' + create.code); process.exit(1); }
}

console.log('\n=== 3. 确认推送结果 ===');
const remote = run('git', ['remote', '-v']);
console.log(remote.out || '(无 remote)');
const status = run('git', ['status', '-sb']);
console.log(status.out);
const repo = run('gh', ['repo', 'view', '--json', 'name,visibility,url']);
console.log(repo.out);
