import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

export type AdminClient = SupabaseClient<Database>;

// Bypasses RLS. Lint only lets src/app/api/** (webhooks, cron) and src/data/**/admin.ts
// import it, and every query written with it must check ownership in code.
export function createAdminClient(): AdminClient {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
