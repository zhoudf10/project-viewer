// 构建脚本：把 datas/<项目名>/.ai_machine/*.json 转成可直接用 file:// 打开的 classic JS 数据文件。
// 用法：node system/tools/build.mjs
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const datasDir = path.join(root, 'datas');
const outDir = path.join(root, 'system', 'data');

const readJson = async (file) => {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

// 项目目录下允许存在的输出文件，扫描源码时跳过
const OUTPUT_FILES = new Set([
  'knowledge-graph.json', 'domain-graph.json', 'meta.json',
  'config.json', 'config.js', 'fingerprints.json',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'out', '.idea', '.vscode']);

// 递归收集源码文本。sourceRoot 为相对项目目录的根（'source' 或 ''）。
async function collectSources(dir, sourceRoot) {
  const base = path.join(dir, sourceRoot);
  const files = {};
  let count = 0;
  let skipped = 0;

  async function walk(absDir, relDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? relDir + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!relDir && OUTPUT_FILES.has(entry.name)) continue;
      const raw = await readFile(abs);
      if (raw.includes(0)) { skipped++; continue; }
      files[rel] = raw.toString('utf8');
      count++;
    }
  }

  await walk(base, '');
  return { files, count, skipped };
}

const statOf = (graph) => {
  if (!graph) return null;
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
    edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
    layers: Array.isArray(graph.layers) ? graph.layers.length : 0,
    tour: Array.isArray(graph.tour) ? graph.tour.length : 0,
  };
};

async function buildProject(dirName) {
  const dir = path.join(datasDir, dirName);
  const projectFiles = new Set(await readdir(dir));
  const dataDir = projectFiles.has('.ai_machine') ? path.join(dir, '.ai_machine') : dir;
  const files = new Set(await readdir(dataDir));
  const knowledge = files.has('knowledge-graph.json')
    ? await readJson(path.join(dataDir, 'knowledge-graph.json'))
    : null;
  const domain = files.has('domain-graph.json')
    ? await readJson(path.join(dataDir, 'domain-graph.json'))
    : null;
  if (!knowledge && !domain) {
    console.warn(`[skip] ${dirName}：缺少 knowledge-graph.json 与 domain-graph.json`);
    return null;
  }
  const meta = files.has('meta.json') ? await readJson(path.join(dataDir, 'meta.json')) : null;
  const config = files.has('config.json') ? await readJson(path.join(dataDir, 'config.json')) : null;

  // 源码：优先 datas/<项目>/source，其次项目根目录（跳过分析输出文件）
  const hasSourceDir = projectFiles.has('source');
  const rootCandidates = [...projectFiles].filter((name) => !OUTPUT_FILES.has(name) && !name.startsWith('.'));
  let sourceRoot = '';
  let sources = { files: {}, count: 0, skipped: 0 };
  if (hasSourceDir) {
    sourceRoot = 'source';
    sources = await collectSources(dir, 'source');
  } else if (rootCandidates.length) {
    sources = await collectSources(dir, '');
  }

  const sourcesFile = path.join(outDir, `${dirName}-sources.js`);
  if (sources.count > 0) {
    await writeFile(
      sourcesFile,
      `/* 由 system/tools/build.mjs 自动生成，请勿手工修改 */\n` +
        `(window.UA_SOURCES = window.UA_SOURCES || {})[${JSON.stringify(dirName)}] = ` +
        `${JSON.stringify({ root: sourceRoot, files: sources.files })};\n`,
      'utf8'
    );
  } else {
    await rm(sourcesFile, { force: true });
  }

  const base = knowledge || domain;
  const project = base.project || {};
  const id = dirName;
  const entry = {
    id,
    name: project.name || dirName,
    description: project.description || '',
    languages: project.languages || [],
    frameworks: project.frameworks || [],
    analyzedAt: project.analyzedAt || (meta && meta.lastAnalyzedAt) || null,
    gitCommitHash: project.gitCommitHash || (meta && meta.gitCommitHash) || null,
    hasKnowledge: Boolean(knowledge),
    hasDomain: Boolean(domain),
    stats: {
      knowledge: statOf(knowledge),
      domain: statOf(domain),
    },
    analyzedFiles: meta && Number.isFinite(meta.analyzedFiles) ? meta.analyzedFiles : null,
    hasSources: sources.count > 0,
    sourceRoot,
    sourceFiles: sources.count,
    sourceSkipped: sources.skipped,
  };

  const payload = { id, knowledge, domain, meta, config };
  await writeFile(
    path.join(outDir, `${id}.js`),
    `/* 由 system/tools/build.mjs 自动生成，请勿手工修改 */\n` +
      `(window.UA_DATA = window.UA_DATA || {})[${JSON.stringify(id)}] = ${JSON.stringify(payload)};\n`,
    'utf8'
  );
  return entry;
}

async function main() {
  // 兼容旧目录结构：如果根目录下存在项目文件夹，给出提示（不自动搬运）
  const rootNames = await readdir(root, { withFileTypes: true });
  for (const item of rootNames) {
    if (!item.isDirectory()) continue;
    if (['system', 'package', 'datas', 'node_modules'].includes(item.name)) continue;
    console.warn(`[提示] 根目录下的 "${item.name}" 不会被读取，请移动到 datas/ 下`);
  }

  await mkdir(outDir, { recursive: true });
  const entries = (await readdir(datasDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();

  const projects = [];
  for (const name of entries) {
    try {
      const entry = await buildProject(name);
      if (entry) projects.push(entry);
    } catch (err) {
      console.error(`[error] ${name}: ${err.message}`);
    }
  }

  // 清理已删除项目的旧数据文件
  const expected = new Set();
  projects.forEach((p) => {
    expected.add(`${p.id}.js`);
    expected.add(`${p.id}-sources.js`);
  });
  for (const file of await readdir(outDir)) {
    if (!file.endsWith('.js') || expected.has(file)) continue;
    await rm(path.join(outDir, file), { force: true });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    projects,
  };
  await writeFile(
    path.join(root, 'system', 'manifest.js'),
    `/* 由 system/tools/build.mjs 自动生成，请勿手工修改 */\n` +
      `window.UA_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`,
    'utf8'
  );
  console.log(`构建完成：${projects.length} 个项目 -> system/manifest.js, system/data/*.js`);
  for (const p of projects) {
    const k = p.stats.knowledge;
    const d = p.stats.domain;
    console.log(
      `  - ${p.id}：知识图谱 ${k ? `${k.nodes} 节点/${k.edges} 边` : '无'}；` +
        `领域图谱 ${d ? `${d.nodes} 节点/${d.edges} 边` : '无'}；` +
        `源码 ${p.hasSources ? `${p.sourceFiles} 个文件（datas/${p.id}/${p.sourceRoot || ''}）` : '未提供'}`
    );
  }
}

async function run() {
  await main();
  if (!process.argv.includes('--watch')) return;

  let timer = null;
  let busy = false;
  const rebuild = async () => {
    if (busy) return;
    busy = true;
    try {
      await main();
    } catch (err) {
      console.error('[watch] 重建失败：', err.message);
    } finally {
      busy = false;
    }
  };
  watch(datasDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 300);
  });
  console.log('[watch] 正在监听 datas/，变动后自动重建；刷新浏览器即可看到新项目');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
