---
name: new-project
description: Use when someone asks for a new system, app, site, internal tool or automation ("quero um sisteminha", "cria um app pra", "preciso de uma ferramenta que"), or before writing application code in a folder that is empty or has no .sz/project.json.
argument-hint: "[nome-do-projeto]"
allowed-tools: Bash(node:*), Bash(npx --yes create-next-app@*), Bash(npm install:*), Bash(npm run check:*), Bash(git init:*), Bash(git add:*), Bash(git commit:*), Bash(gh auth status:*), Bash(gh repo create:*)
---

# New project

Three moves: interview (facts), scaffold (rules, copied by a script), repository (company GitHub). You gather facts. You never write the standard's rules or configuration yourself.

## Setup facts

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.mjs" --info`

If the block above is empty, run that command yourself before continuing.

## 1. Interview

Brazilian Portuguese, one question at a time, plain words, examples when the person hesitates. Never ask about technology: the stack is fixed.

- **Objetivo**: what problem, for whom, and what "working" means, in one sentence.
- **Quem usa**: internal team, clients or public; how many people; how they log in.
- **Dados**: what gets stored. Ask explicitly about nome, telefone, e-mail, CPF, endereço, dados de clientes, valores.
- **Integrações**: systems it reads from or writes to (WhatsApp, Trello, planilhas, pagamento, e-mail).
- **Fora do escopo**: what this first version will not do.
- **Glossário**: the words the team uses for the main things (cliente, pedido, orçamento…).

## 2. Tier

Decide from the answers. "Não sei" or a vague answer about data counts as personal data.

- **3**: moves money, charges, pays, or acts in a third-party system on someone's behalf (sends WhatsApp messages to clients, creates charges). Do not scaffold. Tell the user this project belongs to the lead and give them the brief to hand over.
- **2**: stores personal data (anyone identifiable) or client data, or people outside the company log in.
- **1**: internal use, no personal data.

## 3. Brief

Write it in Portuguese as a short list: the six interview lines, the tier and why, and the glossary as `termo → code_name` (base names in `${CLAUDE_PLUGIN_ROOT}/references/glossary.md`). Show it and ask for explicit confirmation. Adjust and show again until confirmed. Nothing is created before that.

## 4. Scaffold

- **Folder.** If the setup facts say the current folder is empty and its name is valid, create the project in it (folder `.`). Otherwise create a subfolder with a kebab-case ASCII name taken from the objective (confirm it with the user).
- Run the create command from the setup facts exactly, with the chosen folder.
- Save the confirmed brief as `brief.md` inside the project folder, then run:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.mjs" --dir <folder> --tier <n> --brief <folder>/brief.md --install`
  Then delete `<folder>/brief.md`; the script keeps its copy in `.sz/brief.md`.
- On any failure, show the error and stop. Never recreate the setup by hand.

## 5. Repository

In the project folder:

```
git init
git add -A
git commit -m "chore: create project from the Simplizzia standard"
gh repo create <organization>/<folder-name> --private --source . --remote origin --push
```

`<organization>` comes from the setup facts. If `gh` is missing, not logged in, or has no permission in the organization, keep the local project and tell the user to call the lead to create the repository.

## 6. Finish

Run `npm run check` and show the output. Then tell the user, in Portuguese:
- what was created and where;
- the tier and what it means for deploys (tier 2: the lead approves the first deploy and sensitive changes);
- the next step: describe the first screen they need.

If the project is in a subfolder, or was created in this session, tell them to close and reopen Claude Code inside the project folder: the standard's full rules load at the start of a session.

## Stop if you catch yourself

- Writing application code before the brief is confirmed.
- Writing or "simplifying" eslint, tsconfig, CI or `.sz` files by hand.
- Switching stack because the user named one ("faz em Python", "usa Firebase"). The standard is fixed; exceptions are the lead's decision.
- Scaffolding a tier 3 project.
