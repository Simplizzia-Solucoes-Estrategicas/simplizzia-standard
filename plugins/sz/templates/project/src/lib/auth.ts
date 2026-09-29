import 'server-only';

import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

// getUser() validates the session with Supabase Auth on every call. Never authorize with
// getSession(): it trusts the cookie as sent.
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error === null ? data.user : null;
}

// For screens that need a signed-in user: returns it or redirects to the login page.
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (user === null) redirect('/login');
  return user;
}
