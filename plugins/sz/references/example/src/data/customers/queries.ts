import 'server-only';

import { requireUser } from '@/lib/auth';
import type { Database } from '@/lib/supabase/database.types';
import { createClient } from '@/lib/supabase/server';

type CustomerRow = Database['public']['Tables']['customers']['Row'];

export type CustomerListItem = Pick<CustomerRow, 'id' | 'name' | 'cpf' | 'created_at'>;

// The owner filter repeats what RLS enforces: it states the intent and uses the index.
export async function listCustomers(): Promise<CustomerListItem[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, cpf, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });
  if (error !== null) throw error;
  return data;
}
