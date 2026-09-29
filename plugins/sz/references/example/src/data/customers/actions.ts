'use server';

import { revalidatePath } from 'next/cache';

import { customerInputSchema } from '@/data/customers/schema';
import { authActionClient } from '@/lib/action-client';
import { createClient } from '@/lib/supabase/server';

// The action is the adapter: session and schema come from authActionClient. When a second
// caller (a route handler, another action) needs this insert, move it to a function here.
export const createCustomer = authActionClient
  .inputSchema(customerInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const { error } = await supabase.from('customers').insert({ ...parsedInput, owner_id: ctx.user.id });
    if (error !== null) throw error;
    revalidatePath('/customers');
  });
