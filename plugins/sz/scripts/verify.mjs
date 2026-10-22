#!/usr/bin/env node
// Mechanical checks of the Simplizzia standard, shared by /sz:audit, /sz:review and CI.
//
//   node verify.mjs [--scope project|changes] [--base <ref>] [--since-deploy] [--format md|json]
//                   [--json-out <file>] [--skip-gates] [--offline] [--cwd <dir>]
//   node verify.mjs --seal                 end of a review: seals the reviewed content
//   node verify.mjs --ci-protected --base <ref> --actor <login> [--lead <login>]
//   node verify.mjs --route --verify <verify.json> [--actor <login>] [--event <name>] [--head <sha>]
//
// It reports; it never edits project files. Only --json-out writes, and only where told.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  ADMIN_ALLOWED,
  classify,
  CODE_EXTENSIONS,
  contentHash,
  isDocsOnly,
  isEnvFile,
  loadConfig,
  mask,
  matchesAny,
  pluginVersion,
  PROTECTED,
  PUBLIC_SECRET_ENV,
  run,
  SEAL_FILE,
  sealStatus,
  SECRET_PATTERNS,
  SENSITIVE,
  SERVICE_KEY_NAMES,
} from './lib.mjs';

const SEVERITIES = ['CRITICO', 'ALTO', 'MEDIO'];
const LABEL = { CRITICO: 'CRÍTICO', ALTO: 'ALTO', MEDIO: 'MÉDIO' };
const MAX_LINES = 200;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.vercel', '.sz-standard']);
const GENERATED = ['**/database.types.ts', 'next-env.d.ts', '**/*.min.js', 'package-lock.json'];

const { values: args } = parseArgs({
  options: {
    scope: { type: 'string', default: 'project' },
    base: { type: 'string' },
    format: { type: 'string', default: 'md' },
    'json-out': { type: 'string' },
    'skip-gates': { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    'since-deploy': { type: 'boolean', default: false },
    cwd: { type: 'string' },
    'ci-protected': { type: 'boolean', default: false },
    actor: { type: 'string', default: '' },
    lead: { type: 'string', default: '' },
    route: { type: 'boolean', default: false },
    verify: { type: 'string' },
    seal: { type: 'boolean', default: false },
    event: { type: 'string', default: '' },
    head: { type: 'string', default: '' },
  },
});

// ---------- git and files ----------

function safeRef(ref) {
  return typeof ref === 'string' && /^[\w./~^@-]+$/.test(ref) && !/^0+$/.test(ref) ? ref : null;
}

function resolveBase(root, requested) {
  const candidates = [safeRef(requested), 'origin/main', 'main', 'origin/master', 'master', 'HEAD~1'];
  for (const candidate of candidates) {
    if (candidate !== null && run(`git rev-parse --verify --quiet "${candidate}^{commit}"`, root, 10_000).code === 0) {
      return candidate;
    }
  }
  return null;
}

function gitList(root, command) {
  const result = run(command, root, 30_000);
  return result.code === 0 ? result.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : null;
}

function walk(root, dir = '', found = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, dir === '' ? entry.name : `${dir}/${entry.name}`, found);
    } else {
      found.push(dir === '' ? entry.name : `${dir}/${entry.name}`);
    }
  }
  return found;
}

function listFiles(root) {
  const tracked = gitList(root, 'git ls-files');
  if (tracked === null) return { all: walk(root), tracked: [] };
  const untracked = (gitList(root, 'git ls-files --others --exclude-standard') ?? []).filter((file) => !file.startsWith('.sz-standard/'));
  return { all: [...new Set([...tracked, ...untracked])], tracked };
}

function changedFiles(root, base, includeWorkingTree) {
  const committed = gitList(root, `git diff --name-only "${base}" HEAD`) ?? [];
  if (!includeWorkingTree) return committed;
  const working = gitList(root, 'git diff --name-only HEAD') ?? [];
  const untracked = gitList(root, 'git ls-files --others --exclude-standard') ?? [];
  return [...new Set([...committed, ...working, ...untracked])];
}

function readText(root, rel) {
  try {
    const buffer = readFileSync(join(root, rel));
    if (buffer.length > 1_000_000 || buffer.subarray(0, 8000).includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function excerpt(text, index, secret = false) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  const line = text.slice(start, end === -1 ? undefined : end).trim();
  return secret ? '[conteúdo omitido: segredo]' : line.slice(0, 200);
}

// ---------- findings ----------

const findings = [];
const notes = [];

function add(severity, id, title, file, detail = '', snippet = '') {
  findings.push({ severity, id, title, file, detail, excerpt: snippet });
}

function firstMatch(text, re) {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return global.exec(text);
}

function isSrcCode(rel) {
  return rel.startsWith('src/') && CODE_EXTENSIONS.test(rel) && !rel.endsWith('.sql');
}

function checkSecrets(rel, text) {
  if (isEnvFile(rel)) return;
  for (const { id, re } of SECRET_PATTERNS) {
    const match = firstMatch(text, re);
    if (match !== null) {
      add('CRITICO', 'secret-in-code', 'Segredo no código', rel, `${id}: ${mask(match[0])}. Trocar a chave (ela já vazou) e mover para variável de ambiente.`, excerpt(text, match.index, true));
    }
  }
}

function checkPublicEnv(rel, text) {
  const match = firstMatch(text, PUBLIC_SECRET_ENV);
  if (match !== null) {
    add('ALTO', 'public-secret-env', 'Variável pública carregando segredo', rel, `${match[0]} vai para o navegador.`, excerpt(text, match.index));
  }
}

function checkKeysAndAdmin(rel, text) {
  if (!isSrcCode(rel)) return;
  const key = firstMatch(text, SERVICE_KEY_NAMES);
  if (key !== null && !['src/lib/env.ts', 'src/lib/supabase/admin.ts'].includes(rel)) {
    add('ALTO', 'service-key-outside', 'Chave secreta do Supabase fora do lugar', rel, 'Ela ignora RLS; só src/lib/supabase/admin.ts usa.', excerpt(text, key.index));
  }
  const admin = firstMatch(text, /@\/lib\/supabase\/admin/);
  if (admin !== null && !matchesAny(rel, ADMIN_ALLOWED)) {
    add('ALTO', 'admin-import-outside', 'Cliente admin importado fora de webhook/cron', rel, 'O cliente admin ignora RLS.', excerpt(text, admin.index));
  }
}

const HTTP_METHODS = '(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)';

function checkServerActions(rel, text) {
  if (!isSrcCode(rel)) return;
  const topLevel = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use server\1/.test(text);
  if (!topLevel) {
    const inline = firstMatch(text, /(['"])use server\1/);
    if (inline !== null) {
      add('ALTO', 'inline-server-action', 'Server Action inline, fora do action client', rel, 'Mova para src/data/<domain>/actions.ts usando authActionClient.', excerpt(text, inline.index));
    }
    return;
  }
  for (const match of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g)) {
    add('ALTO', 'raw-server-action', 'Server Action sem action client', rel, `${match[1]} não passa pela autenticação nem pelo schema.`, excerpt(text, match.index));
  }
  for (const match of text.matchAll(/export\s+const\s+(\w+)\s*=(?!\s*(?:authActionClient|publicActionClient)\b)\s*([^\s(]+)/g)) {
    add('ALTO', 'raw-server-action', 'Server Action sem action client', rel, `${match[1]} é criada com ${match[2]}.`, excerpt(text, match.index));
  }
  for (const match of text.matchAll(/export\s+const\s+(\w+)\s*=\s*publicActionClient\b/g)) {
    add('MEDIO', 'public-action', 'Ação pública (sem login)', rel, `${match[1]}: confirmar que precisa ser pública e que tem limite de uso.`, excerpt(text, match.index));
  }
}

function checkRouteHandlers(rel, text) {
  if (!/^(?:src\/)?app\/.*\/route\.[jt]s$/.test(rel)) return;
  for (const match of text.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${HTTP_METHODS})\\b`, 'g'))) {
    add('ALTO', 'raw-route-handler', 'Route handler sem o wrapper route()', rel, `${match[1]} não declara modo de acesso.`, excerpt(text, match.index));
  }
  for (const match of text.matchAll(new RegExp(`export\\s+const\\s+(${HTTP_METHODS})\\s*=(?!\\s*route\\.(?:user|webhook|cron|public)\\()`, 'g'))) {
    add('ALTO', 'raw-route-handler', 'Route handler sem o wrapper route()', rel, `${match[1]} não passa por route.user/webhook/cron/public.`, excerpt(text, match.index));
  }
  for (const match of text.matchAll(new RegExp(`export\\s+const\\s+(${HTTP_METHODS})\\s*=\\s*route\\.public\\(`, 'g'))) {
    add('MEDIO', 'public-route', 'Rota pública', rel, `${match[1]}: confirmar que precisa ser pública e que tem limite de uso.`, excerpt(text, match.index));
  }
}

function checkQuality(rel, text) {
  if (!isSrcCode(rel)) return;
  const escapes = [
    [/@ts-(?:ignore|expect-error|nocheck)/, 'Compilador silenciado'],
    [/eslint-disable/, 'Regra de lint desligada no código'],
    [/(?::\s*any\b|\bas\s+any\b|<any>)/, 'Uso de any'],
    [/\b(?:TODO|FIXME|HACK|XXX)\b/, 'Pendência escondida em comentário (deveria ser issue)'],
  ];
  for (const [re, title] of escapes) {
    const match = firstMatch(text, re);
    if (match !== null) add('MEDIO', 'escape-hatch', title, rel, '', excerpt(text, match.index));
  }
  if (rel !== 'src/lib/env.ts') {
    const env = firstMatch(text, /process\.env/);
    if (env !== null) add('MEDIO', 'process-env', 'process.env fora de src/lib/env.ts', rel, '', excerpt(text, env.index));
  }
  const isHookFile = /\.hook\.tsx?$/.test(rel) || rel.startsWith('src/hooks/');
  const effect = firstMatch(text, /\buse(?:Layout)?Effect\s*\(/);
  if (!isHookFile && effect !== null) {
    add('MEDIO', 'effect-location', 'useEffect fora de arquivo *.hook.ts ou src/hooks/', rel, '', excerpt(text, effect.index));
  }
  if (/^src\/(?:screens|components)\//.test(rel) && !rel.startsWith('src/components/ui/')) {
    const hex = firstMatch(text, /["'`[][^"'`\]\n]*#[0-9a-fA-F]{3,8}\b/);
    if (hex !== null) add('MEDIO', 'hex-color', 'Cor em hex em vez de token', rel, '', excerpt(text, hex.index));
  }
}

function lineCount(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

// ---------- migrations (Supabase) ----------

function tableName(raw) {
  const parts = raw.replace(/"/g, '').toLowerCase().split('.');
  return parts.length === 2 ? `${parts[0]}.${parts[1]}` : `public.${parts[0]}`;
}

function checkMigrations(root, files, changed) {
  const migrations = files.filter((file) => /^supabase\/migrations\/.*\.sql$/.test(file)).sort();
  if (migrations.length === 0) return;
  const created = new Map();
  const secured = new Set();
  for (const rel of migrations) {
    const sql = readText(root, rel) ?? '';
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi)) created.set(tableName(match[1]), rel);
    for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w".]+)\s+enable\s+row\s+level\s+security/gi)) secured.add(tableName(match[1]));
    if (changed !== null && !changed.includes(rel)) continue;
    for (const statement of sql.split(';')) {
      const lower = statement.toLowerCase();
      if (/disable\s+row\s+level\s+security/.test(lower)) add('CRITICO', 'rls-disabled', 'RLS desligado', rel, '', statement.trim().slice(0, 200));
      if (/using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/.test(lower)) add('ALTO', 'policy-allows-all', 'Política que libera tudo', rel, 'Só aceitável em leitura pública intencional, confirmada pelo lead.', statement.trim().slice(0, 200));
      if (/create\s+(?:or\s+replace\s+)?view\b/.test(lower) && !/security_invoker/.test(lower)) add('ALTO', 'view-bypasses-rls', 'View sem security_invoker (ignora RLS)', rel, '', statement.trim().slice(0, 200));
      if (/security\s+definer/.test(lower)) add('MEDIO', 'security-definer', 'Função security definer (roda com permissão do dono)', rel, 'Conferir search_path e quem pode chamar.', statement.trim().slice(0, 200));
      if (/storage\.buckets/.test(lower) && /\btrue\b/.test(lower)) add('ALTO', 'public-bucket', 'Bucket de storage possivelmente público', rel, '', statement.trim().slice(0, 200));
    }
  }
  for (const [table, rel] of created) {
    if (!table.startsWith('public.') || secured.has(table)) continue;
    if (changed !== null && !changed.includes(rel)) continue;
    add('ALTO', 'table-without-rls', 'Tabela sem RLS nas migrations', rel, `${table}: sem "enable row level security". Confirmar no banco.`);
  }
}

// ---------- gates, audit, dependencies ----------

function runGate(root, name, fallback) {
  const scripts = readPackage(root)?.scripts ?? {};
  if (!existsSync(join(root, 'node_modules'))) return { status: 'skip', output: 'Dependências não instaladas (rode npm ci).' };
  const command = typeof scripts[name] === 'string' ? `npm run --silent ${name}` : fallback;
  if (command === null) return { status: 'skip', output: `Sem script "${name}".` };
  const result = run(command, root, 300_000);
  const output = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-40).join('\n');
  return { status: result.code === 0 ? 'pass' : 'fail', output };
}

function readPackage(root) {
  const text = readText(root, 'package.json');
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function checkAudit(root) {
  if (args.offline || readPackage(root) === null || !existsSync(join(root, 'package-lock.json'))) return;
  const result = run('npm audit --json --omit=dev', root, 120_000);
  try {
    const counts = JSON.parse(result.stdout).metadata?.vulnerabilities ?? {};
    const serious = (counts.high ?? 0) + (counts.critical ?? 0);
    if (serious > 0) add('ALTO', 'vulnerable-dependency', 'Dependência com vulnerabilidade alta ou crítica', 'package-lock.json', `${String(counts.critical ?? 0)} crítica(s), ${String(counts.high ?? 0)} alta(s). Rode npm audit para detalhes.`);
  } catch {
    notes.push('npm audit não rodou (sem rede ou saída inválida).');
  }
}

function dependencyNames(pkg) {
  return new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})]);
}

function newDependencies(root, base) {
  const before = run(`git show "${base}:package.json"`, root, 15_000);
  if (before.code !== 0) return [];
  let previous;
  try {
    previous = dependencyNames(JSON.parse(before.stdout));
  } catch {
    return [];
  }
  return [...dependencyNames(readPackage(root))].filter((name) => !previous.has(name));
}

// ---------- deploy-aware base ----------

const DEPLOY_PLACEHOLDER = 'Deploy ainda não configurado';

function deployConfigured(root) {
  const script = readPackage(root)?.scripts?.deploy;
  return typeof script === 'string' && !script.includes(DEPLOY_PLACEHOLDER);
}

function lastDeployTag(root) {
  const result = run('git describe --tags --abbrev=0 --match "deploy-*" HEAD', root, 10_000);
  return result.code === 0 ? result.stdout.trim() : null;
}

function rootCommit(root) {
  const result = run('git rev-list --max-parents=0 HEAD', root, 10_000);
  return result.code === 0 ? (result.stdout.trim().split('\n').pop() ?? null) : null;
}

// Once a project deploys, a change is everything not yet deployed: a change waiting for the
// lead stays in the next push's verdict instead of riding along with a harmless push. Before
// the first deploy the whole project since creation is pending; with no deploy configured,
// nothing ships, so the fallback (the push range, or origin/main locally) is enough.
function deployBase(root, fallback) {
  const tag = lastDeployTag(root);
  if (tag !== null) return tag;
  if (deployConfigured(root)) return rootCommit(root) ?? fallback;
  return fallback;
}

// ---------- main verification ----------

function bySeverity(a, b) {
  return SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
}

function introducedBy(changed, finding) {
  if (finding.id === 'vulnerable-dependency') return changed.includes('package-lock.json');
  return changed.some((file) => file === finding.file || file.startsWith(`${finding.file}/`));
}

function separatePreExisting(changed) {
  const kept = findings.filter((finding) => introducedBy(changed, finding));
  const old = findings.filter((finding) => !introducedBy(changed, finding));
  findings.length = 0;
  findings.push(...kept);
  return old;
}

function verify() {
  const project = classify(args.cwd ?? process.cwd());
  const { root } = project;
  const scope = args.scope === 'changes' ? 'changes' : 'project';
  // Local reviews (no --base) and pushes to main (--since-deploy) judge what is not deployed yet;
  // pull requests pass their own base.
  const requested = args['since-deploy'] || args.base === undefined ? deployBase(root, args.base) : args.base;
  const base = scope === 'changes' ? resolveBase(root, requested) : null;
  if (scope === 'changes' && base === null) notes.push('Sem commit base para comparar; analisado o projeto inteiro.');
  const files = listFiles(root);
  const changed = base === null ? null : changedFiles(root, base, !process.env.CI);
  const targets = (changed ?? files.all).filter((rel) => existsSync(join(root, rel)) && !matchesAny(rel, GENERATED));

  for (const rel of files.tracked) {
    if (isEnvFile(rel) && !rel.endsWith('.env.example')) add('CRITICO', 'env-tracked', 'Arquivo .env versionado no git', rel, 'Remover do git e trocar todas as chaves que estavam nele.');
  }
  if (/[^\x20-\x7e]/.test(files.all.join(''))) {
    for (const rel of files.all.filter((file) => /[^\x20-\x7e]/.test(file))) add('MEDIO', 'non-ascii-path', 'Nome de arquivo com acento ou caractere especial', rel);
  }
  for (const dir of ['src/pages', 'pages']) {
    if (existsSync(join(root, dir))) add('ALTO', 'pages-router-dir', 'Pasta pages/ num projeto App Router', dir, 'Cada arquivo ali vira rota pública. Use src/screens/.');
  }
  for (const file of ['src/middleware.ts', 'middleware.ts']) {
    if (existsSync(join(root, file))) add('MEDIO', 'middleware-file', 'middleware.ts no Next 16', file, 'O nome atual é src/proxy.ts.');
  }

  const sizes = [];
  for (const rel of targets) {
    const text = readText(root, rel);
    if (text === null) continue;
    checkSecrets(rel, text);
    if (!CODE_EXTENSIONS.test(rel) && !isEnvFile(rel)) continue;
    checkPublicEnv(rel, text);
    checkKeysAndAdmin(rel, text);
    checkServerActions(rel, text);
    checkRouteHandlers(rel, text);
    checkQuality(rel, text);
    if (isSrcCode(rel) && !rel.startsWith('src/components/ui/')) sizes.push({ file: rel, lines: lineCount(text) });
  }
  for (const { file, lines } of sizes.filter((entry) => entry.lines > MAX_LINES)) {
    add('MEDIO', 'large-file', `Arquivo com ${String(lines)} linhas`, file, `Limite do padrão: ${String(MAX_LINES)}. Dividir por responsabilidade.`);
  }
  checkMigrations(root, files.all, changed);

  const pkg = readPackage(root);
  const usesSupabase = existsSync(join(root, 'supabase')) || [...dependencyNames(pkg)].some((name) => name.startsWith('@supabase/'));
  if (usesSupabase) notes.push('Estado real do banco (RLS, políticas, buckets, cadastro aberto) NÃO VERIFICÁVEL daqui: rode as queries de references/supabase.md com acesso ao banco.');

  const gates = args['skip-gates']
    ? { typecheck: { status: 'skip', output: 'Pulado (rodado antes no CI).' }, lint: { status: 'skip', output: 'Pulado (rodado antes no CI).' } }
    : { typecheck: runGate(root, 'typecheck', existsSync(join(root, 'tsconfig.json')) ? 'npx --no-install tsc --noEmit' : null), lint: runGate(root, 'lint', null) };
  checkAudit(root);

  let sensitiveZones = [];
  let dependenciesAdded = [];
  let protectedChanged = [];
  if (changed !== null && base !== null) {
    dependenciesAdded = newDependencies(root, base);
    sensitiveZones = changed.filter((rel) => matchesAny(rel, SENSITIVE));
    if (dependenciesAdded.length > 0) sensitiveZones.push('package.json (dependências novas)');
    protectedChanged = changed.filter((rel) => matchesAny(rel, PROTECTED));
  }

  // A change is judged on what it introduces. Problems that were already in the project (a
  // vulnerable dependency, an old pages/ folder) are listed apart and do not gate this change.
  const preExisting = changed === null ? [] : separatePreExisting(changed);
  findings.sort(bySeverity);
  preExisting.sort(bySeverity);
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, findings.filter((item) => item.severity === severity).length]));
  const report = {
    tool: 'sz-verify',
    version: pluginVersion(),
    generatedAt: new Date().toISOString(),
    root,
    scope,
    base,
    contentHash: contentHash(root),
    project: { kind: project.kind, tier: project.marker?.tier ?? null, standardVersion: project.marker?.standardVersion ?? null },
    gates,
    findings,
    preExisting,
    changedFiles: changed,
    docsOnly: changed !== null && isDocsOnly(changed),
    sensitiveZones,
    newDependencies: dependenciesAdded,
    protectedChanged,
    stats: {
      filesScanned: targets.length,
      largestFiles: sizes.sort((a, b) => b.lines - a.lines).slice(0, 5),
      filesOverLimit: sizes.filter((entry) => entry.lines > MAX_LINES).length,
    },
    notes,
    summary: {
      gatesPassed: Object.values(gates).every((gate) => gate.status !== 'fail'),
      maxSeverity: SEVERITIES.find((severity) => counts[severity] > 0) ?? 'NENHUMA',
      counts,
    },
  };
  if (args['json-out'] !== undefined) {
    mkdirSync(dirname(args['json-out']), { recursive: true });
    writeFileSync(args['json-out'], `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(args.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : toMarkdown(report));
}

function toMarkdown(report) {
  const icon = { pass: 'passou', fail: 'FALHOU', skip: 'não rodou' };
  const lines = [
    `# Verificação mecânica (sz ${report.version})`,
    '',
    `Escopo: ${report.scope === 'changes' ? `mudanças desde ${String(report.base)}` : 'projeto inteiro'} · Projeto: ${report.project.kind}${report.project.tier === null ? '' : ` · nível ${String(report.project.tier)}`}`,
    `Maior gravidade: ${LABEL[report.summary.maxSeverity] ?? 'nenhuma'} · Críticos: ${String(report.summary.counts.CRITICO)} · Altos: ${String(report.summary.counts.ALTO)} · Médios: ${String(report.summary.counts.MEDIO)}`,
    '',
    '## Gates',
  ];
  for (const [name, gate] of Object.entries(report.gates)) {
    lines.push(`- ${name}: ${icon[gate.status]}`);
    if (gate.status === 'fail') lines.push('', '```', gate.output, '```', '');
  }
  lines.push('', '## Achados');
  if (report.findings.length === 0) lines.push('- Nenhum achado mecânico.');
  for (const item of report.findings) {
    lines.push(`- [${LABEL[item.severity]}] ${item.title} · ${item.file}${item.detail === '' ? '' : ` · ${item.detail}`}`);
    if (item.excerpt !== '') lines.push(`  \`${item.excerpt.replace(/`/g, "'")}\``);
  }
  if (report.preExisting.length > 0) {
    lines.push('', '## Pré-existentes (já estavam no projeto, não contam nesta mudança)');
    for (const item of report.preExisting) lines.push(`- [${LABEL[item.severity]}] ${item.title} · ${item.file}${item.detail === '' ? '' : ` · ${item.detail}`}`);
  }
  if (report.scope === 'changes') {
    lines.push('', '## Zonas sensíveis tocadas', ...(report.sensitiveZones.length === 0 ? ['- Nenhuma.'] : report.sensitiveZones.map((zone) => `- ${zone}`)));
  }
  lines.push('', '## Tamanho', `- Arquivos acima de ${String(MAX_LINES)} linhas: ${String(report.stats.filesOverLimit)}`);
  for (const entry of report.stats.largestFiles) lines.push(`- ${entry.file}: ${String(entry.lines)}`);
  if (report.notes.length > 0) lines.push('', '## Observações', ...report.notes.map((note) => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

// ---------- CI modes ----------

function ciProtected() {
  const project = classify(args.cwd ?? process.cwd());
  const base = resolveBase(project.root, args.base);
  if (base === null) return;
  const touched = changedFiles(project.root, base, false).filter((rel) => matchesAny(rel, PROTECTED));
  if (touched.length === 0) return;
  const lead = args.lead !== '' ? args.lead : project.config.leadGithub;
  if (lead !== '' && args.actor === lead) {
    process.stdout.write(`Arquivos protegidos alterados pelo lead (${args.actor}): ${touched.join(', ')}\n`);
    return;
  }
  process.stderr.write(`Arquivos protegidos do padrão foram alterados por ${args.actor || 'alguém'}: ${touched.join(', ')}.\nSó o lead (${lead || 'leadGithub vazio no config.json do padrão'}) pode alterá-los.\n`);
  process.exit(1);
}

function readJson(file) {
  return file !== undefined && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function highest(severities) {
  return SEVERITIES.find((severity) => severities.includes(severity)) ?? 'NENHUMA';
}

const SEAL_REASON = {
  missing: 'revisão local ausente (push feito sem a skill sz:review, ou fora do Claude Code)',
  stale: 'revisão local desatualizada: o código mudou depois da revisão',
};

const HEADINGS = {
  pull_request: { publish: 'pode fazer merge', 'lead-approval': 'merge depois da revisão do lead', block: 'TRAVADO' },
  push: {
    publish: 'publicar',
    'no-deploy': 'aprovado · deploy ainda não configurado, nada foi publicado',
    'lead-approval': 'aguardando aprovação do lead',
    block: 'TRAVADO',
  },
};

// Decides what happens to a change. On a pull request the question is whether it can be merged;
// on a push to main, whether it can be deployed. Documentation-only changes skip the review seal.
function route() {
  const report = readJson(args.verify);
  if (report === null) throw new Error('--route precisa de --verify <verify.json>');
  const project = classify(args.cwd ?? process.cwd());
  const event = args.event !== '' ? args.event : (process.env.GITHUB_EVENT_NAME ?? 'push');
  const isPullRequest = event === 'pull_request';
  const docsOnly = report.docsOnly === true;
  const review = sealStatus(project.root, { ref: safeRef(args.head) ?? 'HEAD' });
  const tier = report.project.tier ?? 1;
  const sealSeverity = !docsOnly && review.status === 'valid' ? review.seal.maxSeverity : null;
  const max = highest([report.summary.maxSeverity, sealSeverity]);
  const canDeploy = deployConfigured(project.root);
  const firstDeploy = run('git tag --list "deploy-*"', project.root, 10_000).stdout.trim() === '';
  const actor = args.actor !== '' ? args.actor : (process.env.GITHUB_ACTOR ?? '');
  const isLead = project.config.leadGithub !== '' && actor === project.config.leadGithub;
  const reasons = [];
  let decision = 'publish';
  if (!report.summary.gatesPassed) reasons.push('typecheck ou lint falhou');
  if (max === 'CRITICO') reasons.push('achado CRÍTICO');
  if (reasons.length > 0) {
    decision = 'block';
  } else {
    if (max === 'ALTO') reasons.push('achado ALTO');
    if (!docsOnly && review.status !== 'valid') reasons.push(SEAL_REASON[review.status]);
    if (tier >= 2 && report.sensitiveZones.length > 0) reasons.push(`zonas sensíveis: ${report.sensitiveZones.join(', ')}`);
    if (!isPullRequest && canDeploy && tier >= 2 && firstDeploy) reasons.push('primeiro deploy de projeto nível 2+');
    if (!docsOnly && tier >= 3) reasons.push('projeto nível 3');
    if (reasons.length > 0) decision = 'lead-approval';
  }
  if (decision !== 'block' && !isPullRequest && !canDeploy) {
    // Nothing ships until the lead configures the deploy, so nothing can wait for the lead
    // either; the first deploy judges everything since the project was created.
    decision = 'no-deploy';
    reasons.splice(0, reasons.length, ...reasons.filter((reason) => reason === 'achado ALTO'));
  }
  const headings = isPullRequest ? HEADINGS.pull_request : HEADINGS.push;
  const old = Array.isArray(report.preExisting) ? report.preExisting : [];
  const summary = [
    `## Decisão: ${headings[decision]}`,
    '',
    `Nível ${String(tier)} · maior gravidade desta mudança: ${LABEL[max] ?? 'nenhuma'}${docsOnly ? ' · só documentação' : ''}`,
    ...reasons.map((reason) => `- ${reason}`),
    ...(decision === 'lead-approval' && !isPullRequest ? ['', 'Para publicar: o lead revisa o relatório e roda o workflow manualmente com deploy = true.'] : []),
    ...(old.length > 0
      ? ['', `Problemas que já existiam no projeto (não contam nesta mudança): ${String(old.length)}`, ...old.slice(0, 5).map((item) => `- [${LABEL[item.severity]}] ${item.title} · ${item.file}`)]
      : []),
  ].join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `decision=${decision}\nis_lead=${String(isLead)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  process.stdout.write(`${summary}\n`);
  if (decision === 'block') process.exit(1);
}

// End of a review. Refuses to seal when the mechanical check ran on other content, when the
// verdict predates it, or when typecheck/lint failed: the seal only describes a real review.
function seal() {
  const project = classify(args.cwd ?? process.cwd());
  const verifyFile = join(project.root, '.sz', 'reports', 'verify.json');
  const verdictFile = join(project.root, '.sz', 'reports', 'verdict.json');
  const report = readJson(verifyFile);
  const verdict = readJson(verdictFile);
  if (report === null || verdict === null) throw new Error('faltam .sz/reports/verify.json e verdict.json: rode a skill sz:review antes de selar.');
  const current = contentHash(project.root);
  if (current === null) throw new Error('não consegui calcular o hash do conteúdo (o projeto está num repositório git?).');
  if (report.contentHash !== current) throw new Error('o código mudou depois da verificação mecânica: rode a revisão de novo.');
  if (statSync(verdictFile).mtimeMs < statSync(verifyFile).mtimeMs) throw new Error('verdict.json é anterior à verificação mecânica: termine a revisão antes de selar.');
  if (![...SEVERITIES, 'NENHUMA'].includes(verdict.maxSeverity)) throw new Error('verdict.json sem maxSeverity válido (CRITICO, ALTO, MEDIO ou NENHUMA).');
  if (!report.summary.gatesPassed) throw new Error('typecheck ou lint falhando: corrija antes de selar.');
  const content = {
    contentHash: current,
    maxSeverity: highest([verdict.maxSeverity, report.summary.maxSeverity]),
    findings: Array.isArray(verdict.findings) ? verdict.findings.length : 0,
    reviewedAt: new Date().toISOString(),
    standardVersion: project.marker?.standardVersion ?? null,
    plugin: pluginVersion(),
  };
  writeFileSync(join(project.root, SEAL_FILE), `${JSON.stringify(content, null, 2)}\n`);
  process.stdout.write(`Selo gravado (maior gravidade: ${LABEL[content.maxSeverity] ?? 'nenhuma'}). Commite ${SEAL_FILE} junto com o código antes do push.\n`);
}

try {
  if (args.seal) seal();
  else if (args['ci-protected']) ciProtected();
  else if (args.route) route();
  else verify();
} catch (error) {
  process.stderr.write(`sz verify: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
