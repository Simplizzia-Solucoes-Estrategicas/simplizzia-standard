// Shared helpers for the sz hooks and scripts. Node 20+, no dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Files the agent must never edit in a standard project. Changing them is the lead's call.
export const PROTECTED = [
  'eslint.config.*',
  'tsconfig*.json',
  '.github/**',
  '.sz/project.json',
  '.sz/brief.md',
  '.claude/settings.json',
];

// Written only by `verify.mjs --seal` at the end of a review. Agents may not edit it directly,
// but it is not lead-only: every reviewed push carries a new one.
export const SEAL_FILE = '.sz/review.json';
export const AGENT_PROTECTED = [...PROTECTED, SEAL_FILE];

// Paths whose changes need the lead's eyes before a tier 2+ deploy.
export const SENSITIVE = [
  'src/lib/action-client.ts',
  'src/lib/route.ts',
  'src/lib/auth.ts',
  'src/lib/env.ts',
  'src/lib/supabase/**',
  'src/proxy.ts',
  'supabase/migrations/**',
  'next.config.*',
  'eslint.config.*',
  'tsconfig*.json',
  '.github/**',
  '.sz/project.json',
];

// The admin (secret key) client may only be imported from these places.
export const ADMIN_ALLOWED = ['src/app/api/**', 'src/data/**/admin.ts', 'src/lib/supabase/admin.ts'];

export const SECRET_PATTERNS = [
  { id: 'supabase-secret-key', re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { id: 'stripe-live-key', re: /sk_live_[A-Za-z0-9]{16,}/ },
  { id: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: 'openai-key', re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

// A public-prefixed variable carrying something secret ends up in the browser bundle.
export const PUBLIC_SECRET_ENV =
  /\b(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|TOKEN|PASSWORD)[A-Z0-9_]*\b/;

export const SERVICE_KEY_NAMES = /\b(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/;

export const CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|sql)$/;

export function loadConfig() {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'config.json'), 'utf8'));
}

export function pluginVersion() {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw === '' ? {} : JSON.parse(raw);
}

// Runs a shell command. A single string with shell: true behaves the same on Windows and Unix.
export function run(command, cwd, timeoutMs = 120_000) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

export function gitRoot(cwd) {
  const result = run('git rev-parse --show-toplevel', cwd, 10_000);
  return result.code === 0 ? result.stdout.trim() : null;
}

export function loadMarker(root) {
  const file = join(root, '.sz', 'project.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { invalid: true, error: error instanceof Error ? error.message : String(error) };
  }
}

const IGNORED_WHEN_EMPTY = new Set(['.git', '.claude', '.DS_Store', 'Thumbs.db', '.vscode', '.idea']);

export function isEmptyDir(dir) {
  try {
    return readdirSync(dir).every((name) => IGNORED_WHEN_EMPTY.has(name));
  } catch {
    return false;
  }
}

export function remoteUrl(root) {
  const result = run('git remote get-url origin', root, 10_000);
  return result.code === 0 ? result.stdout.trim() : '';
}

export function belongsToOrg(url, org) {
  return new RegExp(`github\\.com[:/]${escapeRegExp(org)}/`, 'i').test(url);
}

// standard: has .sz/project.json · empty: about to become a project · legacy: org repo
// created before the standard · other: not ours (hooks stay silent).
export function classify(cwd) {
  const config = loadConfig();
  const root = gitRoot(cwd) ?? cwd;
  const marker = loadMarker(root);
  if (marker !== null) return { kind: 'standard', root, marker, config };
  if (isEmptyDir(cwd)) return { kind: 'empty', root: cwd, marker: null, config };
  if (belongsToOrg(remoteUrl(root), config.githubOrg)) return { kind: 'legacy', root, marker: null, config };
  return { kind: 'other', root, marker: null, config };
}

export function toPosix(path) {
  return path.split(sep).join('/');
}

export function relativePosix(root, file) {
  return toPosix(relative(root, file));
}

// Minimal glob: ** (any depth), * (inside one segment), ? and {a,b}.
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '{') {
      const end = glob.indexOf('}', index);
      source += `(?:${glob.slice(index + 1, end).split(',').map(escapeRegExp).join('|')})`;
      index = end;
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function git(root, args, env = process.env) {
  const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? 1, stdout: result.stdout ?? '' };
}

// Tree hash of the project content as git sees it (ignored files excluded, seal excluded).
// fromHead: the committed tree, which is what a push sends and what CI checks out.
// Otherwise: the working tree, committed or not. Starting from HEAD keeps the committed file
// modes, and git's own normalization keeps Windows line endings from changing the hash.
export function contentHash(root, { fromHead = false } = {}) {
  const index = join(tmpdir(), `sz-index-${String(process.pid)}-${String(Date.now())}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const hasHead = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).code === 0;
    if (git(root, hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], env).code !== 0) return null;
    if (!fromHead && git(root, ['add', '-A'], env).code !== 0) return null;
    git(root, ['rm', '--cached', '--quiet', '--ignore-unmatch', SEAL_FILE], env);
    const tree = git(root, ['write-tree'], env);
    return tree.code === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(index, { force: true });
  }
}

export function readSeal(root, { fromHead = false } = {}) {
  let raw = null;
  if (fromHead) {
    const shown = git(root, ['show', `HEAD:${SEAL_FILE}`]);
    raw = shown.code === 0 ? shown.stdout : null;
  } else if (existsSync(join(root, SEAL_FILE))) {
    raw = readFileSync(join(root, SEAL_FILE), 'utf8');
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { invalid: true };
  }
}

// valid: the seal describes exactly this content · stale: content changed after the review
// · missing: never reviewed (or the seal was not committed, when fromHead).
export function sealStatus(root, options = {}) {
  const seal = readSeal(root, options);
  if (seal === null || seal.invalid === true) return { status: 'missing', seal: null };
  return { status: seal.contentHash === contentHash(root, options) ? 'valid' : 'stale', seal };
}

export function isEnvFile(path) {
  return /(?:^|\/)\.env(?:\.|$)/.test(path);
}

export function mask(secret) {
  return `${secret.slice(0, 6)}…`;
}
