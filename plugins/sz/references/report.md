# Report format

Reports are read by people: write them in Brazilian Portuguese, in plain words, explaining any technical term the first time. Problems go from most to least severe. Detail at most the 10 most important; group the rest with counts.

## Template

```markdown
# {Auditoria | Revisão} · {projeto} · {data}
Nível {n} · padrão {versão} · escopo: {projeto inteiro | mudanças desde <ref>}

## Veredito
- Checagens automáticas: typecheck {passou | falhou | não rodou}, lint {passou | falhou | não rodou}
- Maior gravidade: {CRÍTICO | ALTO | MÉDIO | nenhuma}
- Zonas sensíveis tocadas: {lista | nenhuma}                      (revisão)
- Decisão: {publicar | travar | aprovação do lead}               (revisão)
- Recomendação: {manter | corrigir itens X, Y | migrar para o template | aposentar}   (auditoria)

## Problemas
### [CRÍTICO] Título curto
- Onde: `caminho/do/arquivo`
- Trecho:
  ```
  código citado
  ```
- Risco: consequência concreta ("qualquer pessoa logada lê os clientes das outras").
- Correção: o que fazer.

## Segurança
| # | Item | Status | Onde olhei / o que faltou |
|---|---|---|---|
| 1 | Acesso ao banco (RLS) | PROBLEMA · OK · NÃO VERIFICÁVEL | … |
| 2 | Autorização só na interface | | |
| 3 | Registros de outras pessoas (IDOR) | | |
| 4 | Segredos | | |
| 5 | Validação de entrada e injeção | | |
| 6 | Cadastro aberto | | |
| 7 | Operações caras expostas | | |
| 8 | Dados pessoais em logs e erros | | |

## Qualidade
Achados MÉDIO agrupados por tipo (tamanho, efeitos, cores, pendências), com contagem.

## Pré-existentes                                                 (revisão)
Problemas que já estavam no projeto e que esta mudança não criou nem piorou. Não contam na decisão; ficam aqui para o lead acompanhar.

## Não replicar                                                   (auditoria de projeto vivo)
Padrões deste projeto que código novo não deve copiar, um por linha, prontos para colar no CLAUDE.md do projeto.
```

## verdict.json (review only)

Written to `.sz/reports/verdict.json`. The seal script reads `maxSeverity` from it; keep the keys and values exactly as below (no accents in values).

```json
{
  "maxSeverity": "CRITICO | ALTO | MEDIO | NENHUMA",
  "findings": [{ "severity": "ALTO", "title": "…", "file": "src/…" }],
  "securityItems": { "1": "OK", "2": "OK", "3": "PROBLEMA", "4": "OK", "5": "OK", "6": "NAO_VERIFICAVEL", "7": "OK", "8": "OK" },
  "standardVersion": "value of standardVersion in .sz/project.json"
}
```

`maxSeverity` is the highest among your findings about the change and `summary.maxSeverity` in `verify.json` (which already excludes pre-existing problems).
