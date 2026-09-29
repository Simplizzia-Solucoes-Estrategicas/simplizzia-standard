---
name: audit
description: Use only when explicitly invoked to audit an existing Simplizzia project against the standard.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(git log:*), Bash(git ls-files:*), Bash(git show:*), Bash(npm audit:*)
disallowed-tools: Edit, Write, MultiEdit, NotebookEdit
---

# Audit

Read-only diagnosis of an existing project. You never change a file during an audit, not even an obvious one-line fix: the report is the deliverable. It goes in the chat, in Brazilian Portuguese, in the "Auditoria" format of `${CLAUDE_PLUGIN_ROOT}/references/report.md`.

## Mechanical results

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" --scope project`

If the block above is empty or shows an error, run that command yourself. It can take a minute (typecheck, lint, npm audit).

## Judgment pass

1. **Security.** Read `${CLAUDE_PLUGIN_ROOT}/references/security.md` and go through the 8 items in the code itself, not only in the mechanical output. Supabase projects: also read `supabase.md`. Without database access, the live state of item 1 is NÃO VERIFICÁVEL, and the report includes the audit queries for the lead to run.
2. **Structure and quality.** Read `architecture.md` and `quality.md`. Standard projects (with `.sz/project.json`): list the deviations. Legacy projects: do not demand the standard's structure; judge security and maintainability, and write the "Não replicar" section.
3. **Recommendation.** manter, corrigir itens X, migrar para o template, or aposentar. Weigh risk against how alive the project is (`git log --since="3 months ago" --oneline -n 20`) and say what the recommendation is based on.

## Rules

- Quote the code excerpt, never only a line number.
- Never mark an item OK without having looked; say where you looked.
- A leaked secret is CRÍTICO, and its fix starts with rotating the key.
- Detail at most the 10 most important problems; group the rest with counts.
- If asked to fix something mid-audit, finish the report first. Fixing is a separate step.
