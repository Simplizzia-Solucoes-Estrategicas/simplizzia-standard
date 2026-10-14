---
name: review
description: Use when the user says the work is finished or wants to publish, deploy, send to a client or open a pull request ("tá pronto", "terminei", "pode publicar", "posso subir?", "manda pro cliente"), and when a push is blocked because the review of the current version is missing or outdated.
context: fork
allowed-tools: Read, Grep, Glob, Write, Bash(node:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)
---

# Review

Reviews the change (not the whole project) before it goes out, in a context separate from the session that wrote the code, so the author's reasoning does not steer the verdict. Never ask questions and never edit application code during a review. It ends with a seal: CI and the push guard accept only a push whose content matches the reviewed content.

## Mechanical results

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" --scope changes --json-out .sz/reports/verify.json`

If the block above is empty or shows an error, run that command yourself before anything else: the seal requires `.sz/reports/verify.json` produced from the current content.

## Judgment pass

The tier is in `.sz/project.json`; the base commit is `base` in `.sz/reports/verify.json`. List the changed files (`git diff <base> --stat` and `git status`) and read each one in full, not only the diff hunks.

**Judge the change, not the project.** A finding counts only when the change introduced it or made it worse. Problems that were already there (a vulnerable framework version, an old file outside the diff, a missing database setup) go in a "Pré-existentes" section of the report and never raise `maxSeverity`; `verify.json` already keeps its own in `preExisting`. Decisions the change asks the lead for (an open question in a spec) are listed, not findings.

**Documentation only** (`docsOnly: true` in `verify.json`): skip steps 2 and 3. Check only for secrets, real personal data and links to private material, then seal.

1. **Security** (`${CLAUDE_PLUGIN_ROOT}/references/security.md`): items 2, 3, 5, 7 and 8 for every change; items 1, 4 and 6 when migrations, env, auth or config changed.
2. **Workarounds** (`quality.md`): swallowed errors, fallbacks hiding missing values, retries or timeouts covering races, duplicated functions, hardcoded values, weakened checks. A workaround without a linked issue is ALTO.
3. **Structure** (`architecture.md`): the right door for each data access, placement, promotion on second use.
4. **Claims against evidence.** Commit messages that say "fix", "tested" or "done" need evidence in the code: the cause actually removed, the case actually handled. A claim the code does not back is a finding.

## Outputs, in this order

1. `.sz/reports/review.md`: the report in the "Revisão" format of `${CLAUDE_PLUGIN_ROOT}/references/report.md`, in Portuguese.
2. `.sz/reports/verdict.json`: exactly the schema in `report.md`. `maxSeverity` is the highest of `summary.maxSeverity` in `verify.json` and your own findings about the change; pre-existing problems stay out.
3. The seal: `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" --seal`. If it refuses (content changed, typecheck or lint failing), report why and stop; never work around it.
4. Your final message, in Portuguese, 3 to 6 lines: what blocks, what will wait for the lead, what is fine, and that `.sz/review.json` must be committed together with the reviewed code before the push.

## Decision (the rule CI applies)

- **travar**: typecheck or lint failed, or anything CRÍTICO introduced by the change.
- **aprovação do lead**: anything ALTO introduced by the change; tier 2 or 3 touching sensitive zones; the first deploy of a tier 2 or 3 project; any tier 3 code change.
- **publicar**: everything else, including documentation-only changes and changes whose only problems are pre-existing.

## Stop if you catch yourself

- Saying it looks good without having read the changed files.
- Lowering a severity because the change is small or someone is in a hurry.
- Raising one because of something the change did not touch.
- Fixing code during the review. Report now; fixing is a separate step, and it requires a new review.
