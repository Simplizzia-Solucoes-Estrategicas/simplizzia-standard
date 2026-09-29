#!/usr/bin/env node
// Stop hook. When the agent tries to finish a turn in a standard project, runs typecheck and
// lint (only if files changed since the last passing run) and blocks finishing on failure.
// The second consecutive block is skipped (stop_hook_active) so the agent never loops;
// the user gets a warning and CI still blocks the deploy.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classify, readHookInput, run } from './lib.mjs';

const SCRIPTS = ['typecheck', 'lint'];

function fingerprint(root) {
  const hash = createHash('sha1');
  hash.update(run('git status --porcelain=v1', root, 15_000).stdout);
  hash.update(run('git diff HEAD', root, 15_000).stdout);
  const untracked = run('git ls-files --others --exclude-standard', root, 15_000).stdout.split('\n').filter(Boolean);
  for (const file of untracked) {
    try {
      const stat = statSync(join(root, file));
      hash.update(`${file}:${String(stat.size)}:${String(stat.mtimeMs)}`);
    } catch {
      hash.update(`${file}:missing`);
    }
  }
  return hash.digest('hex');
}

function stampFile(root) {
  return join(tmpdir(), `sz-check-${createHash('sha1').update(root).digest('hex').slice(0, 16)}`);
}

function lastLines(text, count) {
  const lines = text.trim().split('\n');
  return lines.length <= count ? lines.join('\n') : ['…', ...lines.slice(-count)].join('\n');
}

async function main() {
  const input = await readHookInput();
  const project = classify(typeof input.cwd === 'string' ? input.cwd : process.cwd());
  if (project.kind !== 'standard') return;
  const packageFile = join(project.root, 'package.json');
  if (!existsSync(packageFile) || !existsSync(join(project.root, 'node_modules'))) return;
  const scripts = JSON.parse(readFileSync(packageFile, 'utf8')).scripts ?? {};
  if (!SCRIPTS.every((name) => typeof scripts[name] === 'string')) return;

  const stamp = stampFile(project.root);
  const current = fingerprint(project.root);
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === current) return;

  const failures = [];
  for (const name of SCRIPTS) {
    const result = run(`npm run --silent ${name}`, project.root, 140_000);
    if (result.code !== 0) failures.push({ name, output: `${result.stdout}\n${result.stderr}` });
  }
  if (failures.length === 0) {
    writeFileSync(stamp, current);
    return;
  }

  const names = failures.map((failure) => failure.name).join(' e ');
  if (input.stop_hook_active === true) {
    process.stdout.write(
      JSON.stringify({
        systemMessage: `sz: ainda há erros de ${names}. O CI vai barrar a publicação até isso ser corrigido.`,
      }),
    );
    return;
  }
  const details = failures.map((failure) => `## npm run ${failure.name}\n${lastLines(failure.output, 60)}`).join('\n\n');
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: `The project does not pass the standard checks. Fix the causes (never silence a rule, never edit lint or tsconfig), then run \`npm run check\` and show the output before finishing.\n\n${details}`,
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`sz: check hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
