---
name: fix
description: Use when something is broken or behaving wrong ("deu erro", "não funciona", "quebrou", "sumiu", "travou", "tá estranho"), when the user pastes an error message or stack trace, and when a check fails (npm run check, build, CI).
---

# Fix

A fix removes the cause. Anything that only makes the symptom disappear is a workaround, and workarounds are never hidden.

## The rule

No code change before you can state the cause in one sentence and have told it to the user in plain Portuguese. Example: "o erro acontece porque a lista chega vazia quando o cliente não tem pedidos, e a tela supõe que sempre tem."

## Steps

1. Read the whole error: message, stack, the first line that points to our code.
2. Reproduce it before changing anything: run the command, open the page, call the action. If you cannot reproduce it, say so and ask what the user did.
3. Trace back to the origin: where does the wrong value or the wrong call come from? Fix it there, not where it explodes.
4. State the cause (the rule above). Then change the code.
5. Verify with the same reproduction and with `npm run check`. Show the output.
6. If tests exist for this area, add the case that failed.

## Three attempts

Count your attempts. After the third fix that did not work, stop changing code. Tell the user, in Portuguese, what you tried, what you learned about the cause, and that the lead should look at it. No fourth variation.

## When the real fix is out of reach

External system bug, a migration or config only the lead can change, missing information. Tell the user both options with their cost and let them choose:
- **real fix**: what it takes and who does it;
- **workaround**: what it hides and what can go wrong.

If they choose the workaround, implement it visibly (a named function, a comment saying why), open an issue with the cause, the workaround and the real fix (`gh issue create --title "…" --body "…"`), and reference the issue number in the commit message. If `gh` is unavailable, write the issue text for the user to send to the lead.

## Not fixes

| Symptom hider | Instead |
|---|---|
| `try/catch` that swallows or only logs | Handle the case, or let the error surface |
| `?? ''`, `\|\| 0`, optional chaining to silence `undefined` | Find why it is undefined; parse at the boundary |
| `as`, `!`, `any`, `@ts-expect-error` | Narrow or parse; fix the type where it originates |
| `setTimeout`, retry, sleep | Find the race or the missing `await` |
| Editing lint, tsconfig, RLS or build config | The check found a real problem: fix it |
| Copying the function and changing the copy | Fix the original and its callers |
| Hardcoding the value that came out wrong | Fix what computes it |

## Rationalizations (provisional)

| Thought | Reality |
|---|---|
| "It works now" | Did the cause go away, or only the symptom? |
| "Small change, no need to reproduce" | Without a reproduction you cannot know it is fixed. |
| "One more try" (the fourth) | Stop. Three is the limit. |
| "The user wants it fast" | Show the trade-off; the user chooses. |
