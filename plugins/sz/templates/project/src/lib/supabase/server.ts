import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

export type ServerClient = SupabaseClient<Database>;

// Server Components cannot write cookies (Next throws); src/proxy.ts refreshes the session
// for them. Any other error is real and must surface.
function isReadOnlyCookiesError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Cookies can only be modified');
}

// Client bound to the signed-in user: every query runs under RLS.
export async function createClient(): Promise<ServerClient> {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch (error: unknown) {
          if (!isReadOnlyCookiesError(error)) throw error;
        }
      },
    },
  });
}
