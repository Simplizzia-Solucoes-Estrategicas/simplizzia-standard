#!/usr/bin/env node
// PreToolUse hook. Blocks edits and shell commands that weaken the standard. Exit code 2
// blocks the tool call and sends stderr to Claude, which explains it to the user.
// Acts only in Simplizzia projects and in empty folders; silent elsewhere.
import { isAbsolute, join } from 'node:path';

import {
  ADMIN_ALLOWED,
  AGENT_PROTECTED,
  classify,
  CODE_EXTENSIONS,
  isEnvFile,
  matchesAny,
  PUBLIC_SECRET_ENV,
  readHookInput,
  relativePosix,
  readSeal,
  SEAL_FILE,
  sealStatus,
  SECRET_PATTERNS,
  SERVICE_KEY_NAMES,
} from './lib.mjs';

class Blocked extends Error {}

function deny(message) {
  throw new Blocked(message);
}

function newContent(toolName, input) {
  if (toolName === 'Write') return input.content ?? '';
  if (toolName === 'Edit') return input.new_string ?? '';
  if (toolName === 'MultiEdit') return (input.edits ?? []).map((edit) => edit.new_string ?? '').join('\n');
  if (toolName === 'NotebookEdit') return input.new_source ?? '';
  return '';
}

function checkSecrets(rel, content) {
  if (isEnvFile(rel)) return;
  for (const { id, re } of SECRET_PATTERNS) {
    if (re.test(content)) {
      deny(`Bloqueado: o conteúdo de ${rel} parece conter um segredo (${id}). Segredo mora em variável de ambiente (.env.local, fora do git), lida por src/lib/env.ts.`);
    }
  }
}

function checkCode(project, rel, content) {
  const lead = project.config.leadName;
  if (PUBLIC_SECRET_ENV.test(content)) {
    deny(`Bloqueado: variável com prefixo público carregando segredo em ${rel}. Tudo que começa com NEXT_PUBLIC_ vai pro navegador.`);
  }
  if (/disable\s+row\s+level\s+security/i.test(content)) {
    deny('Bloqueado: desligar RLS expõe a tabela inteira. Corrija a política em vez de desligar a proteção.');
  }
  if (project.kind !== 'standard' || !CODE_EXTENSIONS.test(rel)) return;
  if (/eslint-disable/.test(content)) {
    deny('Bloqueado: eslint-disable não vale neste padrão. Corrija o que a regra apontou; se a regra estiver errada para este caso, explique ao usuário e peça a exceção ao ' + lead + '.');
  }
  if (/@ts-(?:ignore|nocheck|expect-error)/.test(content)) {
    deny('Bloqueado: @ts-ignore/@ts-expect-error cala o compilador. Corrija o tipo ou valide o dado com schema.');
  }
  if (/ignoreBuildErrors|ignoreDuringBuilds/.test(content)) {
    deny('Bloqueado: desligar a checagem de tipos ou de lint no build esconde o erro em vez de corrigir.');
  }
  if (SERVICE_KEY_NAMES.test(content) && !['src/lib/env.ts', 'src/lib/supabase/admin.ts'].includes(rel)) {
    deny('Bloqueado: a chave secreta do Supabase só é lida em src/lib/env.ts e usada em src/lib/supabase/admin.ts.');
  }
  if (/@\/lib\/supabase\/admin/.test(content) && !matchesAny(rel, ADMIN_ALLOWED)) {
    deny('Bloqueado: o cliente admin ignora RLS. Só src/app/api/** (webhook e cron) e src/data/**/admin.ts podem importá-lo.');
  }
}

function checkFileEdit(project, toolName, input) {
  const filePath = input.file_path ?? input.notebook_path;
  if (typeof filePath !== 'string') return;
  const absolute = isAbsolute(filePath) ? filePath : join(project.root, filePath);
  const rel = relativePosix(project.root, absolute);
  if (rel.startsWith('..')) return;
  if (project.kind === 'standard' && rel === SEAL_FILE) {
    deny(`Bloqueado: ${SEAL_FILE} é gravado só pelo script de selo, no fim da skill sz:review.`);
  }
  if (project.kind === 'standard' && matchesAny(rel, AGENT_PROTECTED)) {
    deny(`Bloqueado: ${rel} é arquivo protegido do padrão (lint, tipos, CI ou marcador do projeto). Corrija a causa do problema em vez da configuração; se a mudança for mesmo necessária, peça ao ${project.config.leadName}.`);
  }
  const content = newContent(toolName, input);
  if (content === '') return;
  checkSecrets(rel, content);
  checkCode(project, rel, content);
}

const COMMAND_RULES = [
  { re: /--no-verify\b/, message: 'Bloqueado: --no-verify pula as verificações do git.' },
  { re: /\bgit\s+push\b.*(?:\s-f\b|--force)/, message: 'Bloqueado: push forçado reescreve o histórico do repositório.' },
  { re: /\bgit\s+reset\s+--hard\b/, message: 'Bloqueado: reset --hard apaga trabalho não salvo. Explique ao usuário o que precisa ser desfeito.' },
  { re: /\bsupabase\s+db\s+(?:push|reset\b.*--linked)/, message: 'Bloqueado: mudança direta no banco remoto. Migration entra pelo repositório e quem aplica é o lead.' },
  { re: /\b(?:drop\s+(?:table|schema|database)|truncate\s+table)\b/i, message: 'Bloqueado: comando destrutivo no banco.' },
  { re: /disable\s+row\s+level\s+security/i, message: 'Bloqueado: desligar RLS expõe a tabela inteira.' },
  { re: /\bvercel\b.*--prod\b/, message: 'Bloqueado: produção só sai pelo pipeline, nunca da máquina local.' },
  { re: /\bgit\s+add\b.*\.env(?!\.example)\b/, message: 'Bloqueado: arquivo .env não entra no git.' },
];

const PROTECTED_NAME = String.raw`(?:eslint\.config\.[cm]?[jt]s|tsconfig[\w.-]*\.json|\.github[\\/]|\.sz[\\/](?:project\.json|brief\.md|review\.json)|\.claude[\\/]settings\.json)`;
// Redirection or tee whose target is a protected file (reading one, like `tsc -p tsconfig.json 2>&1`, is fine).
const REDIRECT_TO_PROTECTED = new RegExp(String.raw`(?:>>?|\btee\s+(?:-a\s+)?)\s*["']?[^\s"'|;&]*` + PROTECTED_NAME);
const MUTATING_COMMAND = /\b(?:sed\s+-i|perl\s+-pi|mv|cp|rm|Set-Content|Out-File|Add-Content|Remove-Item|git\s+(?:checkout|restore))\b/;

// A push sends HEAD, so HEAD must carry a seal that matches its own content.
function checkPush(project) {
  const committed = sealStatus(project.root, { fromHead: true });
  if (committed.status === 'valid') return;
  const local = sealStatus(project.root);
  if (local.status === 'valid') {
    deny(`Bloqueado: a revisão está feita, mas ${SEAL_FILE} não foi commitado. Commite o arquivo (junto com o código revisado) e tente o push de novo.`);
  }
  if (readSeal(project.root) === null) {
    deny('Bloqueado: esta versão ainda não foi revisada. Rode a skill sz:review, commite o .sz/review.json que ela gera e tente o push de novo.');
  }
  deny('Bloqueado: o código mudou depois da última revisão. Rode a skill sz:review de novo, commite o .sz/review.json e tente o push.');
}

function checkCommand(project, input) {
  const command = typeof input.command === 'string' ? input.command : '';
  for (const { re, message } of COMMAND_RULES) {
    if (re.test(command)) deny(message);
  }
  if (project.kind !== 'standard') return;
  if (/\bgit\s+push\b/.test(command)) checkPush(project);
  const touchesProtected =
    REDIRECT_TO_PROTECTED.test(command) ||
    (MUTATING_COMMAND.test(command) && new RegExp(PROTECTED_NAME).test(command));
  if (touchesProtected) {
    deny(`Bloqueado: este comando altera um arquivo protegido do padrão. Se a mudança for necessária, peça ao ${project.config.leadName}.`);
  }
}

async function main() {
  const input = await readHookInput();
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const project = classify(cwd);
  if (project.kind === 'other') return;
  const toolInput = input.tool_input ?? {};
  if (input.tool_name === 'Bash') checkCommand(project, toolInput);
  else checkFileEdit(project, input.tool_name, toolInput);
}

main().catch((error) => {
  if (error instanceof Blocked) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  // A bug in the guard must not freeze everyone's work: report it and let the tool run.
  process.stderr.write(`sz: guard hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
