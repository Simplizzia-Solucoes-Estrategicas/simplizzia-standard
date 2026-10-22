# Padrão Simplizzia · plugin `sz` para Claude Code

Plugin que aplica o padrão de qualidade e segurança nos projetos da Simplizzia. Quem não programa não precisa lembrar de nenhum comando. O plugin injeta as regras em cada sessão, bloqueia o que enfraquece o padrão, confere tipos e lint antes do agente dizer que terminou, e exige uma revisão da versão exata que vai subir. O CI roda as checagens mecânicas e decide o que publica, o que trava e o que espera aprovação do lead. Nenhum projeto precisa de variável ou segredo para o padrão funcionar.

Versão 0.1.0, anterior à Fase 0 (baseline). Leia "Não testado" antes de liberar para a equipe.

## Publicar o padrão (uma vez, o lead)

Descompacte o zip e entre na pasta. No PowerShell: `Expand-Archive simplizzia-standard.zip -DestinationPath .` e depois `cd simplizzia-standard`.

Abra `plugins/sz/config.json` e preencha `leadGithub` com o seu login do GitHub. Sem ele, ninguém consegue aprovar deploy nem alterar arquivo protegido, nem você. Confira também `githubOrg` e `standardRepo`: se a organização ou o nome do repositório forem outros, é só trocar ali. O CI de cada projeto novo aponta para o que estiver em `standardRepo`.

Crie o repositório privado na organização e suba o conteúdo:

```
git init
git add -A
git commit -m "chore: padrão Simplizzia 0.1.0"
gh repo create Simplizzia-Solucoes-Estrategicas/simplizzia-standard --private --source . --remote origin --push
```

Por último, no GitHub, abra o repositório do padrão e vá em Settings, Actions, General. Na seção Access, no fim da página, marque a opção que libera o acesso para os repositórios da organização. É isso que deixa o CI de cada projeto usar as checagens daqui sem token.

## Instalar em cada máquina

A pessoa precisa de Node 20 ou mais novo, Git, Claude Code e acesso de leitura ao repositório do padrão. Um teste simples de acesso: se `git clone https://github.com/Simplizzia-Solucoes-Estrategicas/simplizzia-standard` funciona na máquina dela, a instalação também funciona. Se não funcionar, `gh auth login` costuma resolver, porque configura a credencial do git junto.

Com isso, são dois comandos no terminal:

```
claude plugin marketplace add Simplizzia-Solucoes-Estrategicas/simplizzia-standard
claude plugin install sz@simplizzia
```

Os mesmos comandos funcionam dentro do Claude Code como `/plugin marketplace add …` e `/plugin install …`. Para conferir, abra o Claude Code em qualquer pasta e digite `/sz`: devem aparecer `new-project`, `audit`, `review` e `fix`.

Para distribuir uma atualização, suba o `version` em `plugins/sz/.claude-plugin/plugin.json` e dê push. Em cada máquina:

```
claude plugin marketplace update simplizzia
claude plugin update sz@simplizzia
```

As checagens do CI não dependem disso: elas saem direto do repositório (ref `main`, configurável em `standardRef`), então todo projeto usa a versão nova no push seguinte.

## O que tem aqui

| Peça | O que faz | Quando roda |
|---|---|---|
| `scripts/context.mjs` | Injeta as regras do padrão, ou as de projeto legado | Início de toda sessão; silencioso fora de projetos da Simplizzia |
| `scripts/guard.mjs` | Bloqueia edição de config protegida, segredo no código, `eslint-disable`, `@ts-ignore`, cliente admin fora do lugar, RLS desligado, push forçado, `--no-verify`, deploy local e push sem revisão válida | Antes de cada edição ou comando do agente |
| `scripts/check.mjs` | Roda typecheck e lint; se falhar, o agente não pode encerrar | Quando o agente vai terminar a resposta |
| `scripts/verify.mjs` | Checagens mecânicas, selo da revisão, arquivos protegidos e roteamento do CI | No audit, no review e no CI |
| `scripts/scaffold.mjs` | Aplica o padrão num projeto recém-criado pelo create-next-app | Dentro do `/sz:new-project` |
| `action.yml` | As checagens de CI compartilhadas por todos os projetos | A cada push nos projetos |
| `skills/new-project` | Entrevista, nível, brief, scaffold e repositório na organização | Pedido de sistema novo ou pasta vazia |
| `skills/audit` | Diagnóstico só-leitura de projeto existente | Só manual: `/sz:audit` |
| `skills/review` | Revisão da mudança em contexto separado, relatório e selo | "tá pronto", "pode publicar", push bloqueado |
| `skills/fix` | Causa raiz antes de mexer, limite de 3 tentativas, paliativo só declarado | Erro, "não funciona", check falhando |
| `templates/project` | Lint, CLAUDE.md, marcador, CI, `src/lib` inteiro e proxy | Copiado pelo scaffold |
| `references/` | Regras (architecture, quality, security, supabase, report, glossary) e `example/`, uma feature completa | Lidas pelo agente quando precisa |

## Como a revisão chega ao CI

A revisão roda na máquina de quem está trabalhando, com o Claude Code da própria pessoa, num subagente que não enxerga a conversa. Assim ele não herda as justificativas de quem escreveu o código. No fim, um script grava `.sz/review.json` com o hash do conteúdo revisado e a maior gravidade encontrada. Ele se recusa a gravar se o código mudou depois da checagem mecânica ou se typecheck e lint estão falhando.

O guard só libera o push quando o commit carrega um selo que bate com o próprio conteúdo. O agente cuida disso sozinho: quando o push é bloqueado, ele roda a revisão e tenta de novo.

No CI, se o selo bate, a gravidade dele entra na decisão. Se falta ou está desatualizado, o deploy vai para a aprovação do lead, sem travar. É o que acontece com push feito fora do Claude Code e com o primeiro push de todo projeto novo.

Uma mudança é julgada pelo que ela introduz. Problemas que já estavam no projeto (uma versão vulnerável do Next, um arquivo antigo fora do padrão) aparecem no resumo como pré-existentes e não travam nem mandam para aprovação. Mudanças só de documentação (`*.md`, `docs/`) não precisam de revisão nem de selo, e editar documentação depois da revisão não invalida o selo. Em pull request, o CI diz se dá para fazer merge; a pergunta sobre deploy só aparece no push para a `main`, e enquanto o deploy do projeto não estiver configurado o job de deploy nem roda.

O selo protege contra esquecimento e pressa, não contra alguém decidido a burlar. Contra isso, vale a aprovação do lead nas zonas sensíveis.

## Fluxo

Quem não programa abre o Claude Code numa pasta vazia e pede o sistema. O `new-project` conduz a entrevista, mostra o brief para confirmar, cria o projeto e o repositório. Daí em diante a pessoa trabalha normalmente: os hooks seguram o que não pode, e o agente não encerra com erro de tipo ou lint. Quando ela diz que está pronto ou pede para subir, a revisão roda e explica o que trava e o que vai esperar o lead. O push dispara o CI, que decide o destino. O push vai direto para a `main`: ninguém da equipe precisa saber o que é branch ou pull request. A sua aprovação vale para o deploy, não para o código entrar na `main`, e o que fica esperando você continua esperando a cada push seguinte até você publicar, porque o CI julga tudo o que ainda não foi para o ar desde o último deploy. Se a `main` dos projetos tiver proteção de branch exigindo pull request, desligue, senão o push da equipe é recusado.

O lead roda `/sz:audit` nos projetos antigos e aprova deploys quando o CI pede, rodando o workflow do projeto manualmente com `deploy = true`. Também concede exceções de lint como override por arquivo no `eslint.config.mjs` do projeto, porque comentário inline está desligado. E roda no próprio terminal os comandos que o guard bloqueia para o agente, como `supabase db push`.

O script `deploy` de cada projeto começa falhando de propósito, com uma mensagem, até o lead definir o destino (Vercel ou VPS) e colocar as credenciais da hospedagem como segredos do repositório. Essa é a única configuração por projeto. O primeiro deploy de nível 2 sempre espera aprovação; os seguintes só esperam quando há achado ALTO, zona sensível alterada ou revisão faltando.

## O que foi testado

Tudo abaixo rodou numa app real gerada pelo create-next-app 16.4.1, com as dependências instaladas.

- **Scaffold.** Templates e o exemplo de clientes passam no typecheck e no lint estrito. O typecheck roda `next typegen`, que valida a assinatura dos route handlers.
- **Lint.** Um arquivo com 10 violações foi barrado nas 10.
- **Guard.** 28 casos, todos certos, incluindo os que precisam passar.
- **Selo.** 9 casos:
  - push bloqueado sem revisão, com revisão não commitada e com código alterado depois da revisão;
  - selo recusado sem os arquivos da revisão e quando a checagem mecânica rodou sobre outro conteúdo;
  - edição direta do selo bloqueada, tanto pela ferramenta de escrita quanto por redirecionamento no terminal;
  - push liberado com o selo certo commitado.
- **Roteamento do CI.** Selo desatualizado ou ausente pede aprovação. O primeiro deploy de nível 2 pede aprovação, o seguinte publica, e o lead é reconhecido pelo `config.json`. Arquivo protegido alterado por outra pessoa falha.
- **Workflow do projeto.** Gerado pelo scaffold e aprovado pelo actionlint; a action compartilhada foi conferida na estrutura.
- **CLI real.** `claude plugin validate --strict` passa no marketplace, no plugin e nas skills, incluindo o `context: fork` da revisão. A instalação reconhece 4 skills e 3 hooks.

## Não testado (faça antes de liberar)

1. **Sessão real.** Pasta vazia, pedido de sistema. Confira se o `new-project` dispara e se o bloco "Setup facts" vem preenchido.
2. **Revisão e push.** Faça uma mudança, peça para subir, e confira três coisas: o push é bloqueado, a revisão roda em contexto separado, e o selo é gravado e commitado.
3. **Windows.** Na sua máquina e numa da equipe, de preferência com espaço no caminho do usuário.
4. **Auditoria só-leitura.** Peça uma edição no meio de um `/sz:audit` e confira se o `disallowed-tools` bloqueia.
5. **CI real.** O primeiro projeto real confirma se o runner baixa a action do repositório privado e se os caminhos até os scripts batem.
6. **Supabase de verdade.** Login, action e RLS com dois usuários.

## Limitações conhecidas

- **Guard e verify pegam padrões, não intenção.** O caso óbvio para; o disfarçado passa.
- **Rate limiting não vem pronto.** Rota e ação pública aparecem em todo relatório.
- **Textos ainda não calibrados.** As tabelas de racionalização das skills são provisórias, e o glossário base é sugestão: revise.
- **`src/components/ui` tem regras relaxadas** porque é código gerado pelo shadcn.
- **Mudança imediata no CI.** Com `standardRef` em `main`, uma mudança no padrão vale para todos os projetos no push seguinte. Se preferir liberar aos poucos, use uma tag (por exemplo `v0`) e mova a tag quando quiser publicar.

## Teste de fumaça (ao trocar versões)

1. `npx --yes create-next-app@<versão> teste --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`
2. `node plugins/sz/scripts/scaffold.mjs --dir teste --tier 2 --brief <um brief qualquer> --install`
3. Copie `plugins/sz/references/example/` por cima do `teste/`, entre nele e rode `npm run check`. Tem que passar sem erro nem aviso.

## Próximos passos

1. **Fase 0.** Baseline sem o plugin nos 4 cenários: segredo no código, RLS sob pressão, pedido vago de agendador no WhatsApp e falsa conclusão. O `claude plugin eval` roda casos com e sem o plugin e compara. As racionalizações reais viram as tabelas das skills.
2. **Projetos existentes.** `/sz:audit` em 2 ou 3 deles.
3. **Repositório-template.** Com o exemplo vivo dentro, quando o fluxo estiver estável.
