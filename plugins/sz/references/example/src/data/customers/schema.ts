import { type Input, type Output, v } from '@/lib/validation/v';

// One schema serves the form (client) and the action (server).
export const customerInputSchema = v.object({
  name: v.string().max(200, 'Nome muito longo'),
  cpf: v.cpf(),
});

export type CustomerFormValues = Input<typeof customerInputSchema>;
export type CustomerInput = Output<typeof customerInputSchema>;
