import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { createUserAccount, recordLoggedUser } from "@/lib/auth/users";

type SignupRequestBody = {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  title?: unknown;
  reportsTo?: unknown;
};

export async function POST(request: Request) {
  let body: SignupRequestBody;

  try {
    body = (await request.json()) as SignupRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 }
    );
  }

  const name = typeof body.name === "string" ? body.name : "";
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const title = typeof body.title === "string" ? body.title : undefined;
  const reportsTo = typeof body.reportsTo === "string" ? body.reportsTo : undefined;

  const { user, error } = await createUserAccount({
    name,
    email,
    password,
    title,
    reportsTo,
  });

  if (!user) {
    return NextResponse.json(
      { error: error ?? "Unable to create account." },
      { status: 400 }
    );
  }

  const token = await createSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  try {
    await recordLoggedUser(user);
  } catch {
    // Keep signup successful even if activity tracking temporarily fails.
  }

  return NextResponse.json({
    user: {
      name: user.name,
      title: user.title,
      reportsTo: user.reportsTo,
      email: user.email,
    },
  });
}
