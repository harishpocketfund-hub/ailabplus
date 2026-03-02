import "server-only";

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { SessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type AppUserRole = "admin" | "member";

type AuthUserRecord = {
  id: string;
  email: string;
  name: string;
  title: string;
  reportsTo: string;
  role: AppUserRole;
  passwordHash: string;
  isActive: boolean;
  lastLoginAt: string | null;
};

type AppUserRow = {
  id: string;
  email: string;
  name: string;
  title: string;
  reports_to: string;
  role: AppUserRole | null;
  password_hash: string;
  is_active: boolean;
  last_login_at: string | null;
};

export type PublicAuthUser = SessionUser;

type CreateAccountInput = {
  name: string;
  email: string;
  password: string;
  title?: string;
  reportsTo?: string;
};

const SEEDED_USERS: Omit<AuthUserRecord, "lastLoginAt">[] = [
  {
    id: "user-john-doe",
    email: "john@company.local",
    name: "John Doe",
    title: "Marketing Member",
    reportsTo: "Jane Manager",
    role: "member",
    passwordHash:
      "$2b$12$kHRSQJn.gFacLeV3NOfyb.ZYzmxUpFseeehKu9sQHXGtt/sM7cPpu", // Password@123
    isActive: true,
  },
  {
    id: "user-jane-manager",
    email: "jane@company.local",
    name: "Jane Manager",
    title: "Marketing Manager",
    reportsTo: "CEO",
    role: "member",
    passwordHash:
      "$2b$12$RUOE3U61cNPouIMJowV15uqkXsPiiJ7KnPgmkwQTgvWg2FC80YTyC", // Welcome@123
    isActive: true,
  },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let hasSeededUsers = false;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRole(value: unknown): AppUserRole {
  return value === "admin" ? "admin" : "member";
}

function toPublicUser(user: AuthUserRecord): PublicAuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    title: user.title,
    reportsTo: user.reportsTo,
    role: user.role,
  };
}

function mapRowToAuthUser(row: AppUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: normalizeEmail(row.email),
    name: row.name.trim(),
    title: row.title.trim(),
    reportsTo: row.reports_to.trim(),
    role: normalizeRole(row.role),
    passwordHash: row.password_hash,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
  };
}

function toAppUserUpsertPayload(user: Omit<AuthUserRecord, "lastLoginAt">) {
  return {
    id: user.id,
    email: normalizeEmail(user.email),
    name: user.name.trim(),
    title: user.title.trim(),
    reports_to: user.reportsTo.trim(),
    role: user.role,
    password_hash: user.passwordHash,
    is_active: user.isActive,
  };
}

async function ensureSeedUsers(): Promise<void> {
  if (hasSeededUsers) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_users").upsert(
    SEEDED_USERS.map((user) => toAppUserUpsertPayload(user)),
    { onConflict: "id" }
  );

  if (error && error.code !== "23505") {
    throw new Error(`Failed to seed auth users: ${error.message}`);
  }

  hasSeededUsers = true;
}

async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_users")
    .select(
      "id, email, name, title, reports_to, role, password_hash, is_active, last_login_at"
    )
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query user by email: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapRowToAuthUser(data as AppUserRow);
}

async function findUserById(id: string): Promise<AuthUserRecord | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_users")
    .select(
      "id, email, name, title, reports_to, role, password_hash, is_active, last_login_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query user by id: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapRowToAuthUser(data as AppUserRow);
}

function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }
  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }

  return null;
}

function createUserId(): string {
  return `user-${randomUUID()}`;
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<PublicAuthUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    return null;
  }

  await ensureSeedUsers();
  const user = await findUserByEmail(normalizedEmail);
  if (!user || !user.isActive) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  return toPublicUser(user);
}

export async function createUserAccount(
  input: CreateAccountInput
): Promise<{ user: PublicAuthUser | null; error: string | null }> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password;
  const title = (input.title ?? "").trim() || "Member";
  const reportsTo = (input.reportsTo ?? "").trim() || "Not assigned";

  if (!name) {
    return { user: null, error: "Name is required." };
  }
  if (name.length > 80) {
    return { user: null, error: "Name is too long." };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { user: null, error: "Please enter a valid email address." };
  }

  const passwordValidationError = validatePassword(password);
  if (passwordValidationError) {
    return { user: null, error: passwordValidationError };
  }

  await ensureSeedUsers();
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return { user: null, error: "An account already exists for this email." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const createdUser: Omit<AuthUserRecord, "lastLoginAt"> = {
    id: createUserId(),
    email,
    name,
    title,
    reportsTo,
    role: "member",
    passwordHash,
    isActive: true,
  };

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_users")
    .insert({
      ...toAppUserUpsertPayload(createdUser),
      last_login_at: new Date().toISOString(),
    })
    .select(
      "id, email, name, title, reports_to, role, password_hash, is_active, last_login_at"
    )
    .single();

  if (error || !data) {
    return {
      user: null,
      error: error?.message ?? "Unable to create account.",
    };
  }

  return {
    user: toPublicUser(mapRowToAuthUser(data as AppUserRow)),
    error: null,
  };
}

export async function listLoggedUsers(): Promise<PublicAuthUser[]> {
  await ensureSeedUsers();

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, email, name, title, reports_to, role")
    .eq("is_active", true)
    .not("last_login_at", "is", null)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list logged users: ${error.message}`);
  }

  return (data ?? []).map((user) => ({
    id: user.id,
    email: normalizeEmail(user.email),
    name: user.name,
    title: user.title,
    reportsTo: user.reports_to,
    role: normalizeRole(user.role),
  }));
}

export async function recordLoggedUser(user: PublicAuthUser): Promise<void> {
  const normalizedUser: PublicAuthUser = {
    id: user.id,
    email: normalizeEmail(user.email),
    name: user.name.trim(),
    title: user.title.trim(),
    reportsTo: user.reportsTo.trim(),
    role: normalizeRole(user.role),
  };

  await ensureSeedUsers();

  const existingById = await findUserById(normalizedUser.id);
  const existingUser = existingById ?? (await findUserByEmail(normalizedUser.email));
  const supabase = createSupabaseAdminClient();
  const lastLoginAt = new Date().toISOString();

  if (existingUser) {
    const { error } = await supabase
      .from("app_users")
      .update({
        email: normalizedUser.email,
        name: normalizedUser.name,
        title: normalizedUser.title,
        reports_to: normalizedUser.reportsTo,
        is_active: true,
        last_login_at: lastLoginAt,
      })
      .eq("id", existingUser.id);

    if (error) {
      throw new Error(`Failed to update logged user: ${error.message}`);
    }
    return;
  }

  const placeholderPasswordHash = await bcrypt.hash(randomUUID(), 12);
  const { error } = await supabase.from("app_users").insert({
    id: normalizedUser.id || createUserId(),
    email: normalizedUser.email,
    name: normalizedUser.name,
    title: normalizedUser.title,
    reports_to: normalizedUser.reportsTo,
    role: normalizedUser.role,
    password_hash: placeholderPasswordHash,
    is_active: true,
    last_login_at: lastLoginAt,
  });

  if (error) {
    throw new Error(`Failed to insert logged user: ${error.message}`);
  }
}
