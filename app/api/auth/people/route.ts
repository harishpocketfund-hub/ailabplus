import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listLoggedUsers } from "@/lib/auth/users";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

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

  let users: Awaited<ReturnType<typeof listLoggedUsers>>;
  try {
    users = await listLoggedUsers();
  } catch {
    return NextResponse.json(
      { error: "Unable to load people right now." },
      { status: 500 }
    );
  }
  return NextResponse.json({
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      title: user.title,
    })),
  });
}
