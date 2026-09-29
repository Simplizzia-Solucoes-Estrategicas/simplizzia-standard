# Supabase

## Keys
- **Publishable** (`sb_publishable_…`, legacy "anon"): safe in the browser because RLS decides what it can see. Read through `env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **Secret** (`sb_secret_…`, legacy "service_role"): bypasses RLS. Only `src/lib/supabase/admin.ts` uses it, and only webhook and cron code imports that file.

## Clients
- `createClient()` from `src/lib/supabase/server.ts`: bound to the signed-in user's cookies, every query under RLS. Use it in queries, actions and `route.user`.
- `createAdminClient()` from `src/lib/supabase/admin.ts`: no user, no RLS. Filter by owner explicitly in every query.
- Authorization uses `auth.getUser()` (validated by Supabase Auth), never `getSession()` alone.

## Rules
- Every schema change is a migration in `supabase/migrations/`, never an edit in the dashboard.
- Every table: RLS on and one policy per operation, using `(select auth.uid())` so it is evaluated once per query.
- Views: `create view … with (security_invoker = true) as …`.
- Storage: private buckets, signed URLs, policies on `storage.objects` scoped to the owner's folder.
- Internal tools: signups disabled in the Auth settings, users invited.
- After every migration, regenerate the types:

```
npx supabase gen types typescript --project-id <project-ref> --schema public > src/lib/supabase/database.types.ts
```

(local database: `npx supabase gen types typescript --local > src/lib/supabase/database.types.ts`)

## Audit queries (read-only, SQL editor)

```sql
-- Tables without RLS
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;

-- Policies that allow everything
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and (qual = 'true' or with_check = 'true');

-- Views that do not run with the caller's permissions (they bypass RLS)
select c.relname as view_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not exists (
    select 1 from unnest(coalesce(c.reloptions, '{}')) as option
    where option ~* '^security_invoker=(true|on|1|yes)$'
  );

-- Public storage buckets
select id, name from storage.buckets where public;

-- security definer functions in public
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;
```

Signups cannot be read with SQL: check the Auth settings in the dashboard (the option that allows new users to sign up).
