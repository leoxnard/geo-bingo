import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
    const isPreview = process.env.VERCEL_ENV === 'preview';

    if (!isPreview) {
        return NextResponse.next();
    }

    if (req.nextUrl.pathname.startsWith('/login')) {
        return NextResponse.next();
    }

    const authCookie = req.cookies.get('geo-preview-auth');

    if (authCookie?.value === 'true') {
        return NextResponse.next();
    }

    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
}

export const config = {
    // Allow static assets (e.g. /logo.png) to bypass preview auth redirect.
    matcher: '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
};
