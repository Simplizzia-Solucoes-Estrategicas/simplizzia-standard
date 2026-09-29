# Code quality

## Size and responsibility

Lint limits: 200 lines per file, 80 per function, complexity 10, nesting depth 3, one component per file, JSX depth 6. They are tripwires, not the goal.

When one trips, name the responsibilities inside the file. Each one becomes its own file: a subcomponent in the screen folder, a hook in `*.hook.ts`, a pure function in `lib/` or `data/`. Never split into `Part1`/`Part2`, and never move code around just to pass the count.

A file does too much when its name needs "and", when props exist only to be passed down, or when one component fetches, transforms and renders.

## Types

- `any` never. `unknown` only at boundaries (request bodies, `JSON.parse`, third-party responses, route params), immediately parsed with a schema.
- `as` never, except `as const`. `!` never. When the compiler doubts, prove it: narrow, parse, or restructure. For a value that must exist (current user, required param), use a function that returns it or stops (`requireUser()`).
- Types are derived, never redeclared: `Input`/`Output` of `v` schemas; rows from `database.types` with `Pick`/`Omit`.
- Generics for code that is really generic, never to quiet an error.
- Exported functions in `src/lib` and `src/data` declare parameter and return types.

## Effects

`useEffect` only syncs with something outside React: subscriptions, timers, browser APIs, third-party widgets.

| Temptation | Do instead |
|---|---|
| Derive a value from props or state | Compute it during render (`useMemo` only if measured slow) |
| React to a click or submit | Do it in the event handler |
| Load data for a screen | Server Component calling a query |
| Reset state when a prop changes | `key={prop}` on the component |
| Tell the parent something happened | Call its callback inside the event handler |

Effects live in `*.hook.ts` or `src/hooks/`, with the full dependency list (`exhaustive-deps` is an error).

## No workarounds

A workaround makes the symptom disappear and keeps the cause. Examples: a `try/catch` that swallows; `?? ''` or `|| 0` hiding a value that should exist; a cast, `!` or `any` to quiet the compiler; a retry or `setTimeout` covering a race; disabling a check (lint, types, RLS, build errors); copying a function instead of fixing it; hardcoding a value the system should compute; editing generated files.

1. Before changing code to fix a bug, state the root cause in one sentence.
2. If the real fix is out of reach now, tell the user, present both options with their cost, and if the workaround is chosen, open a GitHub issue (cause, workaround, real fix) and reference it in the commit message. Never a TODO comment.
3. After three failed attempts, stop, summarize what was tried and learned, and ask the user to call the lead.

| Thought | Reality |
|---|---|
| "Just to get it working, I'll clean it up later" | Later never comes. A workaround without an issue is hidden debt. |
| "The compiler is being dumb, the type is right" | Then prove it with narrowing or a schema. |
| "It's an internal endpoint, it doesn't need auth" | Every route and action is reachable from the internet. |
| "The user is in a hurry" | Show the trade-off; the user decides with the facts. |
| "I'll disable the rule just for this line" | Inline config is off. File-level exceptions come from the lead. |

This table is provisional: it grows with the excuses agents actually produce in Simplizzia projects.

## Language and names

- English for code, identifiers, files, folders, comments and commits. Portuguese for UI text and conversation.
- Business terms follow the glossary (base in `glossary.md`, project terms in the project's `CLAUDE.md`). One code name per concept; never alternate synonyms. Terms with no faithful translation stay in Portuguese: `cpf`, `cnpj`, `cep`, `pix`, `boleto`.
- File and folder names in ASCII only.
- Legacy projects keep the language they already use; never translate them.

## Comments

Explain why (a business rule, a constraint, a non-obvious decision), never what the code already says. No commented-out code. No TODO, FIXME or HACK (lint blocks them): open an issue.
