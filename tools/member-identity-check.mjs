#!/usr/bin/env node
// 成员持久身份口径检查（契约 S16：成员的持久身份只放通用能力）
//
// 为什么要有它（与 D-94 同族的洞）：
//   专项成员是**运行时创建、永久存在**的 —— 账号级 `~/.minimax/agents/<名>/agent.md`
//   + 项目级 `.superagent/roster.json`。所以它的持久层必须与「这一次的任务」严格分开。
//   以前这条口径只写在协议里（契约 S16 / references/bootstrap.md 的造人闸门），
//   **没有任何东西守着它** ⇒ 有人把「《人工智能导论》实验一/二/四」「任务书在 Q:\…」
//   「开工前先读 00_共用事实底稿.md」写进持久提示词时，没有任何人报错。
//   后果有两层：① 别的任务复用不了这个成员；② 下次派工时它会照着去找一个已不存在的路径。
//
// 判据的唯一出处：契约 S16（`plugin/skills/super-agent-router/references/contract.md`）。
// 本脚本只把 S16 落成可执行的检查，**不改协议、不改口径**。
//
// 第二轮（对齐 S16 规则 5/6/7）修的是**判定区域 / 让渡句 / 具体标识覆盖面**三处口径。
// 第一轮在真实账号目录上把 9 个成员的持久提示词扫出 14 处命中，逐条核对原文后发现
// **全是误报**，两类：
//   (A) 9 处是 front matter 里的宿主配置字段（`x-mavis.defaultWorkspaceDir: Q:\…`）——
//       它是宿主配置，不是提示词内容（契约规则 5）。
//   (B) 5 处是「这次做哪几个实验、要交付哪些文件，一律由 brief 决定」这类**合规让渡句**——
//       它恰恰是契约规则 6 要求的正确写法。
// ⇒ 误报不是「宽一点就好」的问题：判据落空时必须**拒绝**，而不是把正确写法也当成残留。
//
// 四张表是「判据只有一份」的落地（契约 :888-892 要求唯一出处，扩展只改表不改分支）：
//   FEATURE_SPECS      —— 禁什么（特征 → 判法 → 为什么禁）
//   HOST_CONFIG_KEYS   —— 哪些字段算宿主配置（规则 5，contract.md:867-874）
//   DELEGATION_MARKERS —— 哪些句子算让渡句（规则 6，contract.md:875-877）
//   PATH_EXEMPTIONS    —— 哪些路径形态豁免（规则 7，contract.md:878-886）
//
// 口径（逐条写清，后来者才知道「为什么不是更简单的那个写法」）：
//   1. 扫两处持久层：
//        · 项目级 `.superagent/roster.json` 里 `source == 'runtime'` 的成员字段
//          （`created_for` 必查；`owns`/`accepts`/`reject`/`method` 混入任务专属内容也要报）；
//        · 账号级 `<账号成员目录>/<名>/agent.md` 的 description 与正文。
//   2. **判定区域 = 提示词本体**（规则 5，contract.md:867-874）：front matter 里只有
//      `description` 参与；`name`/`displayName`/`x-mavis.defaultWorkspaceDir`/`model`/`effort`
//      是宿主配置，不参与；**未列入宿主配置表的键照常参与判定**（contract.md:872-874）；
//      front matter **没闭合**时无法判定结构 ⇒ 全文按正文扫（fail-closed，不静默放过）。
//   3. **让渡句不算残留**（规则 6，contract.md:875-877），但让渡句**不豁免具体标识**：
//      路径 / 文件名 / 项目名 / 批次号 / 版本号 / 缺陷编号出现在让渡句里照样判残留。
//   4. **具体标识覆盖脚本与相对目录**（规则 7，contract.md:878-886）：`.py/.mjs/.js/.ts/.sh/.ps1/.bat/.json/.yml/.yaml`
//      同样算具体文件名；带目录段的相对路径同样算具体路径；
//      豁免仓库相对引用与方法论 / 错题本路径；
//      **仓库自有资产**：只有**裸文件名（无目录段）**、且该文件名在本仓库内**确实存在同名文件**
//      才豁免（contract.md:883-886）—— 判定依据是「文件是否真实存在」，**不另抄名单**。
//   5. 命中必须报**文件 + 行号 + 命中的原文 + 属于哪条禁止特征** —— 人要能一眼看出该删什么。
//   6. **账号目录不可用 ≠ 通过，也 ≠ 失败**：目录不存在（别的机器 / CI）时打印
//      「跳过：账号成员目录不可用」并**退出码 0**，但**不许**打印「通过」——
//      那是把「没查」说成「查过了」。
//   7. **名录读不出来 = 判据不可信 ⇒ 拒绝**（退出码 3）：名单读不到就不能断言「持久层干净」。
//
// 用法：
//   node tools/member-identity-check.mjs                        # 扫项目名录 + 默认账号目录
//   node tools/member-identity-check.mjs --agents-dir <path>    # 指定账号成员目录
//   node tools/member-identity-check.mjs --roster <path>        # 指定名录文件
//   node tools/member-identity-check.mjs --json                 # 机器可读输出
//
// 退出码：0 = 无残留（或账号目录跳过且名录干净）／1 = 命中残留／2 = 用法错误／3 = 名录不可用
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.SAR_REPO_DIR || path.resolve(HERE, '..');

// 项目级名录（项目状态层，路由的唯一依据）。
export const DEFAULT_ROSTER = path.join(REPO_ROOT, '.superagent', 'roster.json');

// 账号成员目录：口径与 plugin/scripts/lib.mjs 的 accountAgentsRoot() **完全一致**
//   ① SAR_ACCOUNT_AGENTS_DIR —— 显式指定（指向 agents 目录本身）；
//   ② 否则取 <用户主目录>/.minimax/agents。
// 不另造一套定位口径 —— 两处各写各的，迟早分叉。
export function defaultAgentsDir() {
  const explicit = String(process.env.SAR_ACCOUNT_AGENTS_DIR || '').trim();
  if (explicit) return explicit;
  return path.join(os.homedir(), '.minimax', 'agents');
}

// ── 宿主配置键表（契约 S16 规则 5，contract.md:867-874）────────────────
//
// 为什么是一张表而不是一堆 if：契约说「判据表只有一份」，这张表就是
// 「哪些字段算宿主配置」的唯一出处；将来宿主加字段时**往表里加一条**，
// 不要去改判定分支（改分支 = 口径散开 = 迟早分叉）。
//
// 契约规则 5 末段（contract.md:872-874）写死了「**未知键按 fail-closed 处理**」：
// 未列入这张表的 front matter 键**照常参与判定** —— 否则「把路径写进一个谁都没见过的键」
// 就成了一条永远查不出的暗道。本表是豁免的唯一名单：**不在表里 = 要判**。
export const HOST_CONFIG_KEYS = [
  { id: 'name', why: '成员稳定名（sa-xxx）：跨任务不变，还是兄弟成员分工的锚点，不是本次任务的坐标。' },
  { id: 'displayName', why: '宿主显示名：界面上的标签，不是提示词内容。' },
  { id: 'defaultWorkspaceDir', why: '宿主工作目录：指向该成员**自己所属项目**的稳定目录，不是某一次任务的坐标；会话实际打开哪个目录由派工时的 SCOPE 与工作目录决定。' },
  { id: 'x-mavis', why: '宿主命名空间键：其下的 displayName / defaultWorkspaceDir 同属宿主配置。' },
  { id: 'model', why: '宿主模型配置：与提示词内容无关。' },
  { id: 'effort', why: '宿主推理档位配置：与提示词内容无关。' }
];

// ── 让渡标记表（契约 S16 规则 6，contract.md:875-877）────────────────
//
// 为什么是一张表而不是一堆 if：让渡句的判定必须能**逐条断言、逐条打掉**。
// 命中任一标记的句子 ⇒ 该句里的「一次性措辞」不报（规则 6 第一句）。
// 注意：让渡**只豁免措辞**，不豁免具体标识（规则 6 第二句）—— 那由扫描分支分开判。
export const DELEGATION_MARKERS = [
  { id: 'by-brief-decide', why: '「……由 brief 决定」：把这一单的决定权交回派工方，正是规则 6 要求的写法。', re: /由\s*brief\s*(?:决定|确定|定)/i },
  { id: 'by-brief-give', why: '「……由 brief 给出」：把「读什么 / 交付什么」交回派工方，正是规则 6 要求的写法。', re: /由\s*brief\s*(?:给出|提供|指定)/i },
  { id: 'path-follows-task', why: '「路径随任务变」：明说路径不是固定坐标，正是规则 6 要求的写法。', re: /随任务变/ },
  { id: 'by-dispatch-decide', why: '「由派工决定」：把决定权交回派工方。', re: /由\s*派工(?:单)?\s*(?:决定|给出|提供)/i }
];

// ── 路径豁免表（契约 S16 规则 7，contract.md:878-886）────────────────
//
// 为什么是一张表：豁免口径必须能逐条断言（每条豁免各有一个专属夹具与专属变异体），
// 也必须能一眼看出「到底豁免了什么、为什么豁免」。
//
// 契约规则 7 末段（contract.md:883-886）对「仓库自有资产」写死了三件事，本表逐条照做：
//   ① 豁免**只给裸文件名（无目录段）** —— 带目录段的相对路径照判（见 isBareFileName）；
//   ② 判定依据是「该裸文件名在本仓库内**确实存在同名文件**」，**不另抄名单**；
//   ③ 仓库里并不存在的同名（如 wordcount.py / receipt.json）**仍照判**。
export const PATH_EXEMPTIONS = [
  { id: 'method-or-lessons', why: '方法论 / 错题本路径：成员自己的稳定引用，换任务也不变。', re: /\.superagent[\\/](?:methods|lessons)[\\/]/i },
  { id: 'repo-relative', why: '仓库相对引用（以 plugin/ docs/ tests/ tools/ .superagent/ 开头且不含盘符）：机制自身的稳定资产，不是本次任务的坐标。', re: /(?:^|[^A-Za-z0-9_])(?:plugin|docs|tests|tools|\.superagent)[\\/]/i },
  { id: 'wildcard-pattern', why: '通配形态（如 *.receipt.json）指向的是「一类文件」，不是某一个具体文件名。', re: /[*?]/ },
  { id: 'repo-own-asset', why: '裸文件名（**无目录段**）在本仓库内**确实存在同名文件** ⇒ 它是机制自身的稳定资产（规则 1 禁的是「本次任务的」标识，不是机制自己的文件）；契约规则 7 末段 contract.md:883-886。', test: (t) => isBareFileName(t) && isRepoAsset(basenameOf(t)) }
];

// 仓库自有资产的判定范围：机制自身的目录（插件包 / 工装 / 回归 / 审计 / 私有记忆）。
// 契约规则 7 末段（contract.md:886）要求「**不另抄一份名单**：判定依据是
// 「文件在本仓库内是否真实存在」」⇒ 这里现场遍历出仓库里**真实存在的文件名集合**，
// 不硬编码任何名单，也不按「文件名长得像代码」猜。
// 读不到 ⇒ 不豁免（fail-closed：不能证明是自家资产，就不能放过）。
const ASSET_DIRS = ['plugin', 'tools', 'tests', 'docs', '.superagent'];

let assetIndexCache = null;
export function repoAssetIndex() {
  if (assetIndexCache) return assetIndexCache;
  const set = new Set();
  for (const d of ASSET_DIRS) walkDir(path.join(REPO_ROOT, d), set, 0);
  assetIndexCache = set;
  return set;
}
function walkDir(dir, set, depth) {
  if (depth > 8) return;
  let entries = null;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 读不到 ⇒ 不能证明它是自家资产 ⇒ 不豁免（不许把「取不到」当成「是自家的」）
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(p, set, depth + 1);
    else if (ent.isFile()) set.add(ent.name.toLowerCase());
  }
}
export function isRepoAsset(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  return repoAssetIndex().has(n);
}

// 「裸文件名（无目录段）」判定 —— 契约规则 7 末段（contract.md:883-886）：
// 仓库自有资产的豁免**只给裸文件名**；带目录段的相对路径（工具\contract.md）
// 照判 —— 否则某单的相对路径只要末段与仓库里某个文件同名，就会被静默放过。
export function isBareFileName(text) {
  return !/[\\/]/.test(String(text || ''));
}

// 取「最后一段」：路径分隔符之后、空格之后的最后一段（用于查仓库自有资产）。
export function basenameOf(t) {
  const s = String(t || '');
  const cut = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  let b = cut >= 0 ? s.slice(cut + 1) : s;
  const sp = b.lastIndexOf(' ');
  if (sp >= 0) b = b.slice(sp + 1);
  return b.toLowerCase();
}

// 命中某条豁免 ⇒ 返回豁免 id；没有豁免 ⇒ 空串。
export function exemptionFor(text) {
  const t = String(text || '');
  for (const ex of PATH_EXEMPTIONS) {
    if (ex.re) {
      if (new RegExp(ex.re.source, ex.re.flags.replace('g', '')).test(t)) return ex.id;
    } else if (ex.test && ex.test(t)) {
      return ex.id;
    }
  }
  return '';
}

// ── 禁止特征表（特征 → 判法 → 为什么禁）────────────────
//
// 为什么是一张表而不是一堆 if：这张表要能被**逐条断言**（每条特征都有专属夹具与专属变异体），
// 散成 if 之后就没法枚举、也没法在评审里一眼看出「一共禁了几类、每类为什么禁」。
//
// kind 的两种判法：
//   'regex' —— 用正则在线上找候选（措辞类 / 命名类 / 绝对路径）。
//   'span'  —— 先把行切成「路径片段」，再按片段形态判（相对目录 / 裸文件名）。
//              为什么路径类要单独一套：自然语言里到处是斜杠（「编造年代/日期/参数/引文/访问记录」
//              「HTMT/AVE/CR」「用代码/PIL」），只有「含扩展名或以分隔符结尾」才算具体路径。
//
// group 的作用：同组特征**互相抑制**（避免同一个文件名被报两次），
// 不同组不抑制（一个短语同时踩了两条特征，两条都该报出来）。
const FILE_EXT_RE = /\.(?:md|txt|docx|xlsx|pptx|csv|pdf|py|mjs|js|ts|sh|ps1|bat|json|yml|yaml)$/i;
const ABS_DRIVE_RE = /^[A-Za-z]:[\\/]/;

const FEATURE_SPECS = [
  {
    id: 'abs-path',
    title: '盘符绝对路径',
    group: 'path',
    kind: 'regex',
    pathAware: true,
    why: '工作区路径钉进持久层 = 成员下次照着去找一个已不存在的位置；账号级文件对所有项目可见，还会泄漏别的项目的目录结构。',
    // 前置否定环视：URL 里的 "https://" 的 "s:/" 不能被当成盘符路径。
    re: /(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`，。；：、）)]*/g
  },
  {
    id: 'relative-path',
    title: '带目录段的相对路径',
    group: 'path',
    kind: 'span',
    pathAware: true,
    why: '规则 7：带目录段的相对路径（如 工具\\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。'
  },
  {
    id: 'numbered-file',
    title: '带编号前缀的具体文件',
    group: 'file-name',
    kind: 'regex',
    pathAware: true,
    why: '「00_共用事实底稿.md」这类带编号前缀的文件是一次性交付物清单，不是能力。',
    re: /\d{1,3}[_-][^\s"'`，。；：、）)]*\.(?:md|txt|docx|xlsx|pptx|csv|pdf|json|py|mjs|js|ts)\b/gi
  },
  {
    id: 'cn-deliverable-file',
    title: '中文交付物文件名',
    group: 'file-name',
    kind: 'regex',
    pathAware: true,
    why: '具体文件名属于一次性层（派工 brief / 对话框）；写进持久层会让成员下次去找一个不存在的文件。',
    re: /[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9_\-]{2,}\.(?:md|txt|docx|xlsx|pptx|csv|pdf)\b/gi
  },
  {
    id: 'concrete-file',
    title: '具体文件名（脚本 / 配置 / 文档）',
    group: 'file-name',
    kind: 'span',
    pathAware: true,
    why: '规则 7：具体文件名不限于文档类 —— .py/.mjs/.js/.ts/.sh/.ps1/.bat/.json/.yml/.yaml 同样算「具体文件名」。'
  },
  {
    id: 'must-read-non-method',
    title: '开工前必读的非方法论路径',
    group: 'wording',
    kind: 'regex',
    pathAware: true,
    why: '方法论路径是允许的（那是「这类活怎么做」）；但「开工前必须先读」后面跟着一份一次性交付物，就是把那一单钉进了持久层。',
    re: /开工前(?:必须)?先读\s+(?!\.superagent[\\/])[^\s，。；、)）]+/g
  },
  {
    id: 'project-title',
    title: '书名号项目名',
    group: 'naming',
    kind: 'regex',
    why: '《…》是某一个具体项目的名字，属于一次性层。',
    re: /《[^》]{2,}》/g
  },
  {
    id: 'batch-no',
    title: '批次 / 实验编号',
    group: 'naming',
    kind: 'regex',
    why: '「实验一/二/四」这类编号是这一次的任务坐标；钉进持久层 = 这个成员只认那一单。',
    re: /(?:实验|批次|课题|考题|试卷)\s*[一二三四五六七八九十百零〇\d]+/g
  },
  {
    id: 'version',
    title: '版本号',
    group: 'naming',
    kind: 'regex',
    why: '版本号是一次性交付物的时间坐标；写进持久层会让成员以为自己只支持那个版本。',
    // 前导最多两位 —— 「2026.11.12」这种日期不是版本号，不该报。
    re: /\bv?\d{1,2}\.\d{1,3}\.\d{1,3}\b/g
  },
  {
    id: 'defect-id',
    title: '缺陷编号',
    group: 'naming',
    kind: 'regex',
    why: 'D-xx 是一次性台账坐标，不是能力口径。',
    re: /\bD-\d{2,3}[a-z]?\b/g
  },
  {
    id: 'one-off-wording',
    title: '一次性措辞',
    group: 'wording',
    kind: 'regex',
    suppressibleByDelegation: true,
    why: '「本次任务」「这次要交付」「任务书在」这类措辞把成员钉死在那一单；但让渡句里的同类措辞是合规写法（规则 6）。',
    re: /(?:本次(?:任务|交付|要)|这次(?:要|做|交付|处理|完成|读)|任务书(?:在|位于|路径|:|：)|这一单)/g
  }
];

// 规则表：一处定义、处处引用（要改口径就改这张表，别散成 if）。
export const FORBIDDEN_FEATURES = FEATURE_SPECS.map((f) => ({
  id: f.id,
  title: f.title,
  group: f.group,
  why: f.why,
  kind: f.kind,
  re: f.re ? new RegExp(f.re.source, f.re.flags) : null,
  pathAware: !!f.pathAware,
  suppressibleByDelegation: !!f.suppressibleByDelegation
}));

export const FEATURE_IDS = FORBIDDEN_FEATURES.map((f) => f.id);

// 名录里要查的成员字段（created_for 是「能力化表述」那条规矩的主战场，必查）。
export const ROSTER_FIELDS = ['created_for', 'owns', 'accepts', 'reject', 'method'];

// ── 文本扫描 ────────────────────────────────────────────────
//
// 命中按「特征表的先后顺序」认领区间：同组特征互相抑制（一个文件名不报两次），
// 不同组不抑制（一个短语踩了两条特征，两条都报）。
export function scanText(text, ctx = {}) {
  const file = String(ctx.file || '');
  const region = String(ctx.region || '正文');
  const lineBase = Number(ctx.lineBase || 0);
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const hits = [];
  lines.forEach((line, idx) => {
    const lineHits = scanLine(line, { file, region });
    for (const h of lineHits) {
      h.line = lineBase + idx + 1;
      hits.push(h);
    }
  });
  return hits;
}

// 行内片段：把一行切成「像路径的连续片段」。
// 路径字符集里含中文 —— 因为「工具\aigc_tts.py」的第一段是中文目录名。
const PATH_CHAR_RE = /[A-Za-z0-9_\-.~$@\\/:?*\u4e00-\u9fff]/;
export function pathSpans(line) {
  const out = [];
  let i = 0;
  const s = String(line || '');
  while (i < s.length) {
    if (!PATH_CHAR_RE.test(s[i])) { i++; continue; }
    const start = i;
    while (i < s.length && PATH_CHAR_RE.test(s[i])) i++;
    out.push({ s: start, e: i, text: s.slice(start, i) });
  }
  return out;
}

// 片段 → 判据种类（一个片段只归一类 ⇒ 同一个路径不会被报两次）。
export function classifySpan(span) {
  const t = String(span && span.text ? span.text : span);
  if (ABS_DRIVE_RE.test(t)) return 'abs-path';
  const segs = t.split(/[\\/]/);
  const hasSep = segs.length > 1;
  const last = segs[segs.length - 1];
  const endsWithSep = /[\\/]$/.test(t);
  // 目录段必须真有内容：孤立分隔符（"SCOPE / GOAL" 里那个 /）不是路径。
  const headSegs = segs.slice(0, segs.length - 1).filter((x) => x !== '');
  if (hasSep && isRelativeDirPath(last, endsWithSep, headSegs.length > 0)) return 'relative-path';
  if (!hasSep && isConcreteFileName(t)) return 'concrete-file';
  return null;
}

// 「带目录段的相对路径」要同时满足：末段是具体文件名，或整段以分隔符结尾且前面真有目录段。
// 为什么不能只要「含分隔符」：自然语言里全是斜杠枚举（「编造年代/日期/参数/引文/访问记录」）。
export function isRelativeDirPath(lastSegment, endsWithSep, hasDirSegment) {
  if (isConcreteFileName(lastSegment)) return true;
  return !!endsWithSep && !!hasDirSegment;
}

// 「具体文件名」= 带已知扩展名（含规则 7 点名的脚本 / 配置扩展名）。
export function isConcreteFileName(seg) {
  return FILE_EXT_RE.test(String(seg || ''));
}

// 句界（让渡句按句判定：句内含让渡标记 ⇒ 该句的一次性措辞不报）。
const SENTENCE_DELIMS = '。！？；!?;';
export function sentenceRanges(line) {
  const s = String(line || '');
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (SENTENCE_DELIMS.indexOf(s[i]) >= 0) { out.push([start, i + 1]); start = i + 1; }
  }
  if (start < s.length) out.push([start, s.length]);
  return out;
}
function sentenceAt(ranges, pos) {
  for (const r of ranges) if (pos >= r[0] && pos < r[1]) return r;
  return null;
}
export function isDelegationSentence(text) {
  const t = String(text || '');
  for (const mk of DELEGATION_MARKERS) {
    if (new RegExp(mk.re.source, mk.re.flags.replace('g', '')).test(t)) return true;
  }
  return false;
}

// 以命中位置为中心，向两侧扩到「路径片段」边界（用于判豁免）。
function expandSpan(line, s, e) {
  let a = s;
  let b = e;
  while (a > 0 && PATH_CHAR_RE.test(line[a - 1])) a--;
  while (b < line.length && PATH_CHAR_RE.test(line[b])) b++;
  return { s: a, e: b, text: line.slice(a, b) };
}

function scanLine(line, ctx) {
  const hits = [];
  const claimed = [];
  const spans = pathSpans(line);
  const sentences = sentenceRanges(line);
  for (const f of FORBIDDEN_FEATURES) {
    if (f.kind === 'span') {
      for (const sp of spans) {
        if (classifySpan(sp) !== f.id) continue;
        if (exemptionFor(sp.text)) continue;
        if (claimed.some((c) => c.group === f.group && sp.s < c.e && sp.e > c.s)) continue;
        claimed.push({ s: sp.s, e: sp.e, group: f.group });
        hits.push({ file: ctx.file, line: 0, text: sp.text, feature: f.id, title: f.title, why: f.why, region: ctx.region });
      }
      continue;
    }
    const re = new RegExp(f.re.source, f.re.flags);
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      const s = m.index;
      const e = m.index + m[0].length;
      if (f.pathAware) {
        const sp = expandSpan(line, s, e);
        if (exemptionFor(sp.text)) continue;
      }
      if (f.suppressibleByDelegation) {
        const sent = sentenceAt(sentences, s);
        const delegated = sent ? isDelegationSentence(line.slice(sent[0], sent[1])) : false;
        if (delegated) continue;
      }
      if (claimed.some((c) => c.group === f.group && s < c.e && e > c.s)) continue;
      claimed.push({ s, e, group: f.group });
      hits.push({ file: ctx.file, line: 0, text: m[0], feature: f.id, title: f.title, why: f.why, region: ctx.region });
    }
  }
  return hits;
}

// ── agent.md 的区域判定（契约 S16 规则 5，contract.md:867-874）────────────────
//
// 判定区域 = 提示词本体：front matter 里只有 `description` 参与残留判定，
// `name` / `displayName` / `x-mavis.defaultWorkspaceDir` / `model` / `effort`
// 是**宿主配置**（那是宿主读的配置，不是给模型看的提示词）⇒ 不参与。
//
// 形态容忍与 fail-closed：
//   · 没有 front matter（裸 Markdown）⇒ 全文按正文扫；
//   · front matter **未闭合** ⇒ 无法判定结构 ⇒ 全文按正文扫（宁可多报，不静默放过）；
//   · front matter 里**未知键** ⇒ **照常参与判定**（契约规则 5 末段 contract.md:872-874
//     「未知键按 fail-closed 处理」：否则「把路径写进一个谁都没见过的键」就成了一条
//     永远查不出的暗道）。判据只有一句话：**该键不在 HOST_CONFIG_KEYS 表里**
//     （见 regionForKey / isHostConfigKey）—— 不是「只跳过那五种已知字段」凑出来的效果。
//     要豁免就往 HOST_CONFIG_KEYS 里加一行（表是唯一出处，contract.md:874）。
export function classifyAgentLines(lines) {
  const out = new Array(lines.length).fill('正文');
  if (!lines.length) return out;
  if (String(lines[0]).trim() !== '---') return out;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (String(lines[i]).trim() === '---') { end = i; break; }
  }
  if (end < 0) return out;
  let curKey = '';
  let curIndent = 0;
  let blockMode = false;
  for (let i = 1; i < end; i++) {
    const raw = String(lines[i]);
    const km = raw.match(/^(\s*)([^:\s][^:]*?)\s*:(.*)$/);
    if (km) {
      curKey = km[2].trim();
      curIndent = km[1].length;
      blockMode = /^[|>][-+]?\d*$/.test(km[3].trim());
      out[i] = regionForKey(curKey);
      continue;
    }
    if (/^\s*$/.test(raw)) {
      if (!blockMode) curKey = '';
      continue;
    }
    const indent = (raw.match(/^\s*/) || [''])[0].length;
    if (curKey && (blockMode || indent > curIndent)) {
      out[i] = regionForKey(curKey);
      continue;
    }
    out[i] = 'front-matter';
  }
  return out;
}

// 键 → 区域：`description` 参与；**在宿主配置表里**的键不参与；
// **不在表里**的键照常参与（契约规则 5 末段 contract.md:872-874「未知键按 fail-closed 处理」）。
// 判据只有一条：**该键在不在 HOST_CONFIG_KEYS 表里** —— 不靠「只跳过五种已知字段」凑效果。
export function regionForKey(key) {
  const k = String(key || '').trim();
  if (k === 'description') return 'description';
  if (isHostConfigKey(k)) return 'host-config';
  return 'front-matter';
}

// 宿主配置键判定：**该键在不在 HOST_CONFIG_KEYS 表里**（契约规则 5，contract.md:867-874）。
// 整名命中，或点分写法的最后一段命中（x-mavis.defaultWorkspaceDir → defaultWorkspaceDir）。
export function isHostConfigKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return false;
  const leaf = k.indexOf('.') >= 0 ? k.slice(k.lastIndexOf('.') + 1) : k;
  return HOST_CONFIG_KEYS.some((h) => h.id.toLowerCase() === k || h.id.toLowerCase() === leaf);
}

export function scanAgentFile(text, fileLabel) {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const regions = classifyAgentLines(lines);
  const hits = [];
  lines.forEach((line, idx) => {
    if (regions[idx] === 'host-config') return; // 宿主配置不参与判定
    const lineHits = scanText(line, { file: fileLabel, region: regions[idx] });
    for (const h of lineHits) {
      h.line = idx + 1;
      hits.push(h);
    }
  });
  return hits;
}

// ── 项目级名录 ──────────────────────────────────────────────
export function scanRoster(rosterPath) {
  let raw = '';
  try {
    raw = fs.readFileSync(rosterPath, 'utf8');
  } catch (e) {
    return {
      ok: false,
      error: '名录读不到：' + (e && e.message ? e.message : String(e)) +
        ' —— 名单读不出来 = 判据不可信，此处不放行（不许把「读不到」当成「干净」）。',
      hits: [],
      memberCount: 0,
      runtimeCount: 0
    };
  }
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      error: '名录不是合法 JSON：' + (e && e.message ? e.message : String(e)),
      hits: [],
      memberCount: 0,
      runtimeCount: 0
    };
  }
  const members = Array.isArray(obj && obj.members) ? obj.members : [];
  const rawLines = raw.split(/\r\n|\r|\n/);
  const hits = [];
  let runtimeCount = 0;
  for (const m of members) {
    if (!m || typeof m !== 'object') continue;
    if (String(m.source || '') !== 'runtime') continue;
    runtimeCount += 1;
    const nameLine = findMemberLine(rawLines, String(m.name || ''));
    for (const field of ROSTER_FIELDS) {
      const v = m[field];
      if (v === null || v === undefined || v === '') continue;
      const fieldLine = findFieldLine(rawLines, nameLine, field);
      const found = scanText(String(v), {
        file: '.superagent/roster.json',
        region: field,
        lineBase: Math.max(0, fieldLine - 1)
      });
      for (const h of found) h.member = String(m.name || '');
      hits.push(...found);
    }
  }
  return { ok: true, error: '', hits, memberCount: members.length, runtimeCount };
}

// 在原始文本里定位某个成员名所在的行（-1 = 没找到）。
export function findMemberLine(rawLines, name) {
  if (!name) return -1;
  const needle = '"' + name + '"';
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].indexOf(needle) >= 0 && /"name"\s*:/.test(rawLines[i])) return i + 1;
  }
  return -1;
}

// 在成员块内定位某个字段所在的行（-1 = 没找到）。
export function findFieldLine(rawLines, fromLine, field) {
  const needle = '"' + field + '"';
  for (let i = Math.max(0, fromLine - 1); i < rawLines.length; i++) {
    if (rawLines[i].indexOf(needle) >= 0) return i + 1;
  }
  return -1;
}

// ── 账号级成员目录 ──────────────────────────────────────────
export function scanAgentsDir(dir) {
  const empty = { available: false, error: '', hits: [], members: [] };
  if (!dir) {
    return Object.assign({}, empty, {
      error: '账号成员目录未确定（--agents-dir 未给，且默认位置不可用）'
    });
  }
  let entries = null;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return Object.assign({}, empty, {
      error: '账号成员目录读不到：' + (e && e.message ? e.message : String(e))
    });
  }
  const hits = [];
  const members = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // 隐藏目录（.builtin 等）是宿主自带的，不属于本项目的成员 —— 不扫。
    if (ent.name.charAt(0) === '.') continue;
    const f = path.join(dir, ent.name, 'agent.md');
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue; // 没有 agent.md 的目录不是账号成员
    }
    members.push(ent.name);
    hits.push(...scanAgentFile(text, '<账号成员目录>/' + ent.name + '/agent.md'));
  }
  return { available: true, error: '', hits, members };
}

// ── 总检查 ──────────────────────────────────────────────────
export function runCheck(opts = {}) {
  const rosterPath = opts.rosterPath || DEFAULT_ROSTER;
  const agentsDir = opts.agentsDir === undefined ? defaultAgentsDir() : opts.agentsDir;
  const roster = scanRoster(rosterPath);
  const agents = scanAgentsDir(agentsDir);
  const hits = [...roster.hits, ...agents.hits];
  return {
    ok: roster.ok && hits.length === 0,
    roster,
    agents,
    hits,
    rosterPath,
    agentsDir
  };
}

// 退出码口径：名录不可用 ⇒ 3（判据不可信）；有残留 ⇒ 1；否则 0。
// 账号目录不可用**不**单独产生非 0 —— 那是「没查」，不是「查出不干净」。
export function exitCodeFor(result) {
  if (!result.roster.ok) return 3;
  if (result.hits.length) return 1;
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────
export function formatHit(h, i) {
  return [
    '  ' + (i + 1) + '. ' + h.file + ':' + h.line,
    '     原文：' + h.text,
    '     特征：' + h.feature + ' · ' + h.title + '（区域：' + (h.region || '正文') + '）',
    '     为什么禁：' + h.why
  ].join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.indexOf('--json') !== -1;
  let agentsDir = undefined;
  let rosterPath = undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--agents-dir' && flag !== '--roster') continue;
    const v = argv[i + 1];
    // 参数缺值 ⇒ 用法错误（退出码 2）：不许静默忽略一个写坏的参数。
    if (!v || v.startsWith('--')) {
      process.stderr.write('用法错误：' + flag + ' 需要一个路径参数\n' +
        '用法：node tools/member-identity-check.mjs [--agents-dir <path>] [--roster <path>] [--json]\n');
      process.exit(2);
    }
    if (flag === '--agents-dir') agentsDir = v;
    else rosterPath = v;
    i += 1;
  }
  const result = runCheck({
    rosterPath: rosterPath ? path.resolve(rosterPath) : DEFAULT_ROSTER,
    agentsDir: agentsDir === undefined ? undefined : path.resolve(agentsDir)
  });
  const code = exitCodeFor(result);
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: result.ok,
      exitCode: code,
      rosterPath: result.rosterPath,
      rosterOk: result.roster.ok,
      rosterError: result.roster.error,
      agentsAvailable: result.agents.available,
      agentsError: result.agents.error,
      members: result.agents.members,
      hits: result.hits
    }, null, 2));
    process.exit(code);
  }
  console.log('成员持久身份口径检查（契约 S16）');
  console.log('名录：' + result.rosterPath + '（' + result.roster.memberCount + ' 名成员，其中 source=runtime 的 ' +
    result.roster.runtimeCount + ' 名）');
  if (!result.roster.ok) {
    console.log('FAIL 判据不可用：' + result.roster.error);
    console.log('>>> 成员持久身份口径检查不通过（名录不可用）');
    process.exit(code);
  }
  if (!result.agents.available) {
    console.log('跳过：账号成员目录不可用（' + result.agents.error + '）—— 账号级残留**本次未检查**（这不是「通过」）。');
  } else {
    console.log('账号成员目录：' + result.agentsDir + '（' + result.agents.members.length + ' 个成员：' +
      (result.agents.members.join('、') || '（无）') + '）');
  }
  if (!result.hits.length) {
    if (!result.agents.available) {
      console.log('>>> 项目级名录无残留；账号级未检查');
    } else {
      console.log('>>> 成员持久身份口径检查通过（0 处残留）');
    }
    process.exit(code);
  }
  console.log('FAIL 命中 ' + result.hits.length + ' 处任务专属残留（持久层只放通用能力，契约 S16）：');
  result.hits.forEach((h, i) => console.log(formatHit(h, i)));
  console.log('>>> 成员持久身份口径检查不通过（' + result.hits.length + ' 处残留）');
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
