import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth';
import { env } from '@/lib/env';

// Every route handler is wrapped by one of the modes below (CI checks it). Route params
// arrive as `unknown`: parse them with a schema before use.
type RouteContext = { params: Promise<unknown> };
type NextHandler = (request: Request, context: RouteContext) => Promise<Response>;
type BaseInput = { request: Request; params: unknown };
type Verify = (request: Request, body: string) => boolean | Promise<boolean>;

function errorResponse(status: number, error: string): Response {
  return NextResponse.json({ error }, { status });
}

async function guarded(handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle();
  } catch (error: unknown) {
    console.error(error);
    return errorResponse(500, 'internal_error');
  }
}

function safeEqual(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Verifier for providers that sign the raw body with HMAC-SHA256 in a header (GitHub:
// header 'x-hub-signature-256', prefix 'sha256='). Providers with their own scheme
// (Stripe and similar) pass their SDK's verification as the Verify function instead.
export function hmacSha256Verifier(options: { secret: string; header: string; prefix?: string }): Verify {
  return (request, body) => {
    const received = request.headers.get(options.header);
    if (received === null) return false;
    const digest = createHmac('sha256', options.secret).update(body).digest('hex');
    return safeEqual(received, `${options.prefix ?? ''}${digest}`);
  };
}

export const route = {
  // Signed-in user required; 401 otherwise.
  user:
    (handler: (input: BaseInput & { user: User }) => Promise<Response>): NextHandler =>
    (request, context) =>
      guarded(async () => {
        const user = await getCurrentUser();
        if (user === null) return errorResponse(401, 'unauthorized');
        return handler({ request, params: await context.params, user });
      }),

  // Third-party callbacks: the signature is checked on the raw body before any parsing.
  webhook:
    (verify: Verify, handler: (input: BaseInput & { body: string }) => Promise<Response>): NextHandler =>
    (request, context) =>
      guarded(async () => {
        const body = await request.text();
        if (!(await verify(request, body))) return errorResponse(401, 'invalid_signature');
        return handler({ request, params: await context.params, body });
      }),

  // Scheduled jobs: requires "Authorization: Bearer <CRON_SECRET>" and refuses every call
  // when the secret is not configured.
  cron:
    (handler: (input: BaseInput) => Promise<Response>): NextHandler =>
    (request, context) =>
      guarded(async () => {
        const secret = env.CRON_SECRET;
        const received = request.headers.get('authorization');
        if (secret === undefined || received === null || !safeEqual(received, `Bearer ${secret}`)) {
          return errorResponse(401, 'unauthorized');
        }
        return handler({ request, params: await context.params });
      }),

  // No authentication. Every use appears in the review report; rate-limit anything costly.
  public:
    (handler: (input: BaseInput) => Promise<Response>): NextHandler =>
    (request, context) =>
      guarded(async () => handler({ request, params: await context.params })),
};
