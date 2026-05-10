import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// UX optimization only — NOT a security boundary.
// The clawix_has_session cookie is a non-httpOnly client-set signal with no cryptographic value.
// All data-fetching components must verify auth via AuthProvider before rendering sensitive content.
const PUBLIC_PATHS = ['/login', '/images', '/brand', '/_next', '/favicon.ico'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for access token in cookie (set by client-side auth)
  const hasToken = request.cookies.get('clawix_has_session')?.value === '1';

  if (!hasToken) {
    const loginUrl = new URL('/login', request.url);
    // Only set redirect param for non-default destinations
    if (pathname !== '/' && pathname !== '/conversations') {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
