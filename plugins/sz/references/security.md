# Security checklist

Each item gets a status: **PROBLEMA**, **OK** or **NÃO VERIFICÁVEL**. Never mark OK without having looked, and say where you looked. Quote the code excerpt (line numbers drift). NÃO VERIFICÁVEL always comes with what would make it verifiable (access, query, dashboard screen).

Severity:
- **CRÍTICO**: exploitable now, or data or a secret is already exposed.
- **ALTO**: exploitable with little effort or under plausible conditions.
- **MÉDIO**: weakens a defense; hygiene.

`verify.mjs` already covers what a pattern can catch (secrets, raw actions and routes, admin imports, RLS in migrations). This checklist is for what needs reading and judgment.

## 1. Database access control
- Every table in `public` has RLS enabled and a policy per operation that checks ownership (`(select auth.uid()) = owner_id`) or membership.
- `using (true)` / `with check (true)` only for intentional public reads, confirmed by the lead.
- Views with `security_invoker = true`. `security definer` functions with a fixed `search_path` and restricted execution.
- Secret (service role) key only in server code for webhooks and cron.
- Firebase projects: rules not left in test mode (`allow read, write: if true`).

Where: migrations and `database.types.ts`. The live database needs the queries in `supabase.md`; without access, the live state is NÃO VERIFICÁVEL.

## 2. Authorization only in the interface
Hidden buttons and client-side redirects protect nothing. Every action and route checks the session on the server (`authActionClient`, `route.user`) and ownership in the query.

## 3. Other people's records (IDOR)
Every id coming from the client (URL, form, body) is checked against the current user: an RLS policy or an explicit owner filter. Look first at update and delete by id, and at detail pages.

## 4. Secrets
No secret in code or in `NEXT_PUBLIC_` variables; publishable (anon) keys are public by design. A leaked secret (in the repository history, in a public variable, in a log) is CRÍTICO, and the fix starts with rotating the key: deleting the line does not un-leak it.

## 5. Input validation and injection
- Every action and route parses its input with a schema.
- No `dangerouslySetInnerHTML` with user data.
- No SQL built by string concatenation (raw SQL or `rpc` with interpolated values).
- Uploads checked by type and size, stored in private buckets, served through signed URLs.

## 6. Open signup
Internal tools must not accept self-signup: signups disabled in Supabase Auth, or an invite/allowlist flow. This usually lives in the dashboard: without access, NÃO VERIFICÁVEL with the exact setting to check.

## 7. Costly operations exposed
Paid APIs (LLMs, SMS, WhatsApp, e-mail) only behind authentication and with a per-user limit. Public routes or actions that send messages or write data need rate limiting.

## 8. Personal data in logs and errors
No CPF, e-mail, phone, token or whole request body in `console.log` or in error messages sent to the client. `ActionError` messages are user-facing; everything else must reach the user as a generic message. LGPD applies from tier 2 up.

## Fix order
- Exposed secret: rotate, then remove, then check the provider's logs for misuse.
- Missing RLS: enable it and add policies in a migration. Never disable RLS to "make it work".
- IDOR: owner filter in the query plus a policy; test with a second user.
