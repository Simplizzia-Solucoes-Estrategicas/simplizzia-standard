import 'server-only';

import { createSafeActionClient } from 'next-safe-action';

import { getCurrentUser } from '@/lib/auth';

// Message shown to the user as is. Anything else becomes a generic message, so internals
// and personal data never reach the browser.
export class ActionError extends Error {}

// Every Server Action is built from one of these two clients (CI checks it).
// publicActionClient: truly public forms only; each use shows up in the review report.
export const publicActionClient = createSafeActionClient({
  handleServerError: (error) => {
    if (error instanceof ActionError) return error.message;
    console.error(error);
    return 'Algo deu errado. Tente de novo em instantes.';
  },
});

// authActionClient: stops before any action code runs when there is no valid session,
// and hands the handler `ctx.user`.
export const authActionClient = publicActionClient.use(async ({ next }) => {
  const user = await getCurrentUser();
  if (user === null) throw new ActionError('Sua sessão expirou. Entre de novo.');
  return next({ ctx: { user } });
});
