import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE_NAME = "internal-system-session";
const SESSION_ISSUER = "internal-system";
const SESSION_AUDIENCE = "internal-system-users";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  title: string;
  reportsTo: string;
};

type SessionPayload = SessionUser;

function getSessionSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production.");
    }
    return new TextEncoder().encode("dev-only-change-auth-secret");
  }

  return new TextEncoder().encode(secret);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSessionSecret());
}

function toSessionUser(payload: unknown): SessionUser | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as Partial<SessionPayload>;
  if (
    typeof value.id !== "string" ||
    typeof value.email !== "string" ||
    typeof value.name !== "string" ||
    typeof value.title !== "string" ||
    typeof value.reportsTo !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    email: value.email,
    name: value.name,
    title: value.title,
    reportsTo: value.reportsTo,
  };
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });

    return toSessionUser(payload);
  } catch {
    return null;
  }
}

