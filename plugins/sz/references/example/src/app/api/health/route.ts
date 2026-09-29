import { NextResponse } from 'next/server';

import { route } from '@/lib/route';

// External callers only (uptime monitor). The app's own screens never call /api.
export const GET = route.public(() => Promise.resolve(NextResponse.json({ status: 'ok' })));
