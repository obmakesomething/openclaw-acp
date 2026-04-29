import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.understand-anything',
  '.next',
  '.turbo',
  '.cache',
  'logs',
]);

function toPosix(p) {
  return p.split(path.sep).join(path.posix.sep);
}

function detectFileCategory(relPath) {
  const lower = relPath.toLowerCase();
  const base = path.posix.basename(lower);

  if (lower.startsWith('docs/')) return 'docs';
  if (lower.startsWith('references/')) return 'docs';
  if (lower.startsWith('reports/')) return 'docs';
  if (lower.startsWith('tests/')) return 'code';
  if (lower.startsWith('src/')) return 'code';
  if (lower.startsWith('bin/')) return 'code';
  if (lower.startsWith('scripts/')) return 'script';

  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'infra';
  if (lower.startsWith('.github/workflows/')) return 'infra';

  if (base === 'readme.md' || base.endsWith('.md') || base.endsWith('.rst') || base.endsWith('.txt')) return 'docs';

  // config-ish
  if (
    base === 'package.json' ||
    base === 'package-lock.json' ||
    base === 'tsconfig.json' ||
    base.endsWith('.json') ||
    base.endsWith('.yml') ||
    base.endsWith('.yaml') ||
    base.endsWith('.toml') ||
    base.endsWith('.env') ||
    base.endsWith('.ini')
  ) {
    return 'config';
  }

  // data-ish
  if (base.endsWith('.csv') || base.endsWith('.tsv') || base.endsWith('.ndjson')) return 'data';

  // markup
  if (base.endsWith('.html') || base.endsWith('.css')) return 'markup';

  // code default for common extensions
  if (base.endsWith('.ts') || base.endsWith('.tsx') || base.endsWith('.js') || base.endsWith('.jsx') || base.endsWith('.mjs') || base.endsWith('.cjs')) {
    return 'code';
  }

  return 'data';
}

function detectLanguages(files) {
  const langs = new Set();
  for (const f of files) {
    const ext = path.posix.extname(f.path).toLowerCase();
    const base = path.posix.basename(f.path).toLowerCase();
    if (base === 'dockerfile') langs.add('dockerfile');
    if (ext === '.ts' || ext === '.tsx') langs.add('typescript');
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') langs.add('javascript');
    if (ext === '.json') langs.add('json');
    if (ext === '.md' || ext === '.rst' || ext === '.txt') langs.add('markdown');
    if (ext === '.yml' || ext === '.yaml') langs.add('yaml');
    if (ext === '.sh') langs.add('shell');
    if (ext === '.css') langs.add('css');
    if (ext === '.html') langs.add('html');
  }
  return Array.from(langs).sort();
}

function readMaybeText(content) {
  // Skip likely-binary files
  if (content.includes('\u0000')) return null;
  return content;
}

const IMPORT_RE = [
  /\bimport\s+[^;]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function isLocalImport(spec) {
  return spec.startsWith('.') || spec.startsWith('..');
}

async function fileExists(absPath) {
  try {
    const st = await fs.stat(absPath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function resolveImport(fromRel, spec) {
  const fromDirAbs = path.resolve(PROJECT_ROOT, path.posix.dirname(fromRel));
  const candidateBase = path.resolve(fromDirAbs, spec);

  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}.js`,
    `${candidateBase}.jsx`,
    `${candidateBase}.mjs`,
    `${candidateBase}.cjs`,
    path.join(candidateBase, 'index.ts'),
    path.join(candidateBase, 'index.tsx'),
    path.join(candidateBase, 'index.js'),
    path.join(candidateBase, 'index.jsx'),
  ];

  for (const abs of candidates) {
    if (await fileExists(abs)) {
      const rel = toPosix(path.relative(PROJECT_ROOT, abs));
      return rel;
    }
  }

  return null;
}

async function walk(dirAbs) {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.github') {
      // keep dotfiles, but skip dot-directories except .github
    }

    const full = path.join(dirAbs, ent.name);
    const rel = toPosix(path.relative(PROJECT_ROOT, full));

    if (ent.isDirectory()) {
      if (EXCLUDED_DIRS.has(ent.name)) continue;
      out.push(...(await walk(full)));
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

async function countLines(absPath) {
  try {
    const buf = await fs.readFile(absPath, 'utf8');
    const text = readMaybeText(buf);
    if (text == null) return 0;
    if (!text) return 0;
    return text.split('\n').length;
  } catch {
    return 0;
  }
}

async function buildImportMap(files) {
  const importMap = {};
  const codeFiles = files.filter((f) => f.fileCategory === 'code' || f.fileCategory === 'script');

  for (const f of codeFiles) {
    const abs = path.resolve(PROJECT_ROOT, f.path);
    const ext = path.posix.extname(f.path).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      importMap[f.path] = [];
      continue;
    }

    let text;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch {
      importMap[f.path] = [];
      continue;
    }

    const specs = new Set();
    for (const re of IMPORT_RE) {
      let m;
      while ((m = re.exec(text))) {
        if (m[1]) specs.add(m[1]);
      }
    }

    const resolved = [];
    for (const spec of specs) {
      if (!isLocalImport(spec)) continue;
      const target = await resolveImport(f.path, spec);
      if (target) resolved.push(target);
    }

    importMap[f.path] = resolved.sort();
  }

  return importMap;
}

async function main() {
  const allPaths = await walk(PROJECT_ROOT);

  // Filter out huge / noisy files by extension
  const filtered = allPaths.filter((p) => {
    const lower = p.toLowerCase();
    if (lower.endsWith('.log')) return false;
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp')) return false;
    if (lower.endsWith('.pdf')) return false;
    return true;
  });

  const files = [];
  for (const rel of filtered) {
    const abs = path.resolve(PROJECT_ROOT, rel);
    const sizeLines = await countLines(abs);
    files.push({
      path: rel,
      sizeLines,
      fileCategory: detectFileCategory(rel),
    });
  }

  const importMap = await buildImportMap(files);

  const pkgPath = path.resolve(PROJECT_ROOT, 'package.json');
  let projectName = path.posix.basename(PROJECT_ROOT);
  let projectDescription = '';
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    if (pkg.name) projectName = pkg.name;
    if (pkg.description) projectDescription = pkg.description;
  } catch {
    // ignore
  }

  const languages = detectLanguages(files);
  const frameworks = [];

  const out = {
    projectName,
    projectDescription,
    languages,
    frameworks,
    complexityEstimate: files.length > 400 ? 'complex' : files.length > 150 ? 'moderate' : 'simple',
    files,
    importMap,
  };

  await fs.writeFile(path.resolve(PROJECT_ROOT, '.understand-anything/intermediate/scan-result.json'), JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
