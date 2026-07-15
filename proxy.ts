import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = getSessionCookie(request);

  // "/" serves the landing page to visitors and the documents dashboard to
  // signed-in users. The dashboard lives at /home inside the (app) group so it
  // shares the app layout; the rewrite keeps "/" as the visible URL.
  if (pathname === "/") {
    if (!session) return NextResponse.next();
    // Preserve the query string (e.g. ?tag=, ?archived=) — new URL() would drop it.
    const target = new URL("/home", request.url);
    target.search = request.nextUrl.search;
    return NextResponse.rewrite(target);
  }
  // /home is only an internal rewrite target, never a public URL.
  if (pathname === "/home") return NextResponse.redirect(new URL("/", request.url));

  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/", "/home", "/inbox/:path*", "/documents/:path*", "/settings/:path*"] };
