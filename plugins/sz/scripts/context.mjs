#!/usr/bin/env node
// SessionStart hook. Injects the Simplizzia standard into sessions opened in a Simplizzia
// project (or in an empty folder about to become one) and stays silent everywhere else,
// so it never leaks into repositories that are not the company's.
import { join } from 'node:path';

import { classify, PLUGIN_ROOT, pluginVersion, readHookInput } from './lib.mjs';

const refs = join(PLUGIN_ROOT, 'references');

function coreRules(lead) {
  return [
    'Non-negotiable (hooks, lint and CI enforce most of these; never look for a way around them):',
    '1. Never weaken a check to make something pass: no `any`, no `as` except `as const`, no `!`, no @ts-ignore or @ts-expect-error, no eslint-disable, no edits to eslint/tsconfig/CI/.sz files. When a check blocks you, fix the cause or stop and explain it to the user.',
    '2. Every Server Action is built with authActionClient (publicActionClient only for truly public forms) and an input schema. Every route handler is wrapped by route.user, route.webhook, route.cron or route.public. Business logic lives in src/data/<domain>/.',
    '3. Data from outside (request body, API response, JSON.parse, storage, search params) enters as `unknown` and is parsed with a schema before use. Types come from schemas or from the generated database types; never redeclare them.',
    '4. Never disable RLS, never use the Supabase secret key outside src/lib/supabase/admin.ts (importable only from src/app/api/** and src/data/**/admin.ts), never create public storage buckets, never commit .env files or secrets.',
    `5. Fix root causes. Before changing code to fix a bug, tell the user the cause in one sentence. After 3 failed attempts, stop and ask the user to call ${lead}. No hidden workarounds: if the real fix is out of reach, present the options and, if a workaround is chosen, open a GitHub issue for it.`,
    '6. Small single-purpose files. Split by responsibility, never by size. Search for an existing component, hook or util before creating one; a piece used by a second screen moves to src/components/ or src/data/.',
    '7. Before saying something is done, run `npm run check` and show its output. Before pushing, run the sz:review skill: a push without a current review seal is blocked.',
  ].join('\n');
}

function referencesLine() {
  return [
    `Read before creating files: ${join(refs, 'architecture.md')} (structure, doors, recipes).`,
    `Code quality: ${join(refs, 'quality.md')}. Security: ${join(refs, 'security.md')}. Supabase: ${join(refs, 'supabase.md')}.`,
    `Working example of a full feature: ${join(refs, 'example')}.`,
  ].join('\n');
}

function tierNote(tier, lead) {
  if (tier === 3) return `Tier 3: this project belongs to ${lead}. Propose and explain changes; never deploy.`;
  if (tier === 2) {
    return `Tier 2: this project handles personal or client data (LGPD applies). Changes to sensitive paths (src/lib/**, src/proxy.ts, supabase/migrations/**, dependencies, config) wait for ${lead}'s approval before deploy; CI routes them.`;
  }
  return 'Tier 1: internal tool without personal data. CI decides deploys; security rules still apply in full.';
}

function standardContext({ marker, config }) {
  const lines = [
    `# Simplizzia standard · sz ${pluginVersion()} · project tier ${String(marker.tier)}`,
    'Talk to the user in Brazilian Portuguese. Code, identifiers, file and folder names, comments and commits in English; UI text in Portuguese. Business terms follow the glossary in CLAUDE.md.',
    `Next.js is pinned to ${config.nextVersion} (App Router, src/proxy.ts instead of middleware). Its version-matched docs live in node_modules/next/dist/docs; read them instead of relying on memory.`,
    tierNote(marker.tier, config.leadName),
    '',
    coreRules(config.leadName),
    '',
    referencesLine(),
  ];
  if (marker.invalid === true) {
    lines.push('', `.sz/project.json is unreadable (${marker.error}). Stop and ask the user to call ${config.leadName}.`);
  } else if (marker.standardVersion !== config.standardVersion) {
    lines.push(
      '',
      `This project was created with standard ${marker.standardVersion}; the current one is ${config.standardVersion}. Apply current rules to new code; do not restructure existing code unless asked.`,
    );
  }
  return lines.join('\n');
}

function legacyContext({ config }) {
  return [
    '# Simplizzia standard · legacy project (no .sz/project.json)',
    'Talk to the user in Brazilian Portuguese.',
    'This project predates the standard. Follow the conventions already present here; do not restructure, rename or migrate anything unless the user asks. Consistency inside the project beats the general standard.',
    'Security and honesty rules still apply:',
    coreRules(config.leadName)
      .split('\n')
      .filter((line) => /^(?:1|4|5|7)\. /.test(line))
      .join('\n'),
    `If this project has not been audited yet, suggest that ${config.leadName} runs /sz:audit.`,
  ].join('\n');
}

function emptyContext({ config }) {
  return [
    '# Simplizzia standard (sz plugin)',
    'This folder is empty. If the user asks for a system, app, site, tool or automation, invoke the sz:new-project skill before writing anything. Do not create application files outside that flow.',
    `Talk to the user in Brazilian Portuguese. The lead is ${config.leadName}.`,
  ].join('\n');
}

function buildContext(project) {
  if (project.kind === 'standard') return standardContext(project);
  if (project.kind === 'legacy') return legacyContext(project);
  if (project.kind === 'empty') return emptyContext(project);
  return null;
}

async function main() {
  const input = await readHookInput();
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const text = buildContext(classify(cwd));
  if (text === null) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }),
  );
}

main().catch((error) => {
  process.stderr.write(`sz: context hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
