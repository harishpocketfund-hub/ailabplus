import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { authenticateUser, recordLoggedUser } from "@/lib/auth/users";

type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let body: LoginRequestBody;

  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 }
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  const authenticatedUser = await authenticateUser(email, password);
  if (!authenticatedUser) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const token = await createSessionToken(authenticatedUser);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  try {
    await recordLoggedUser(authenticatedUser);
  } catch {
    // Keep login successful even if activity tracking temporarily fails.
  }

  return NextResponse.json({
    user: {
      name: authenticatedUser.name,
      title: authenticatedUser.title,
      reportsTo: authenticatedUser.reportsTo,
      email: authenticatedUser.email,
    },
  });
}
