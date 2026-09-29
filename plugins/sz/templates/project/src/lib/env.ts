import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

// The only file that reads process.env. Values are validated when the app starts, and a
// server value read from a Client Component throws instead of leaking to the browser.
export const env = createEnv({
  server: {
    SUPABASE_SECRET_KEY: z.string().min(1),
    CRON_SECRET: z.string().min(32).optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === '1',
});
