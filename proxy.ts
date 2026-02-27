import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

const PROTECTED_PREFIXES = [
  "/my-work",
  "/marketing",
  "/development",
  "/admin",
  "/profile",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (protectedPrefix) =>
      pathname === protectedPrefix || pathname.startsWith(`${protectedPrefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const sessionUser = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    if (sessionUser) {
      return NextResponse.redirect(new URL("/my-work", request.url));
    }
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (sessionUser) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/login",
    "/my-work/:path*",
    "/marketing/:path*",
    "/development/:path*",
    "/admin/:path*",
    "/profile/:path*",
  ],
};

