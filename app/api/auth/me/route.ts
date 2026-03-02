import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { recordLoggedUser } from "@/lib/auth/users";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const sessionUser = await verifySessionToken(token);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    await recordLoggedUser(sessionUser);
  } catch {
    // Keep session validation successful even if activity tracking fails.
  }

  return NextResponse.json({
    user: {
      id: sessionUser.id,
      name: sessionUser.name,
      title: sessionUser.title,
      reportsTo: sessionUser.reportsTo,
      email: sessionUser.email,
      role: sessionUser.role,
    },
  });
}
