#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";

const AUTH_USERS_FILE = path.join(process.cwd(), "data", "auth-users.json");
const AUTH_LOGGED_USERS_FILE = path.join(
  process.cwd(),
  "data",
  "auth-logged-users.json"
);

const SEEDED_USERS = [
  {
    id: "user-john-doe",
    email: "john@company.local",
    name: "John Doe",
    title: "Marketing Member",
    reports_to: "Jane Manager",
    password_hash:
      "$2b$12$kHRSQJn.gFacLeV3NOfyb.ZYzmxUpFseeehKu9sQHXGtt/sM7cPpu",
    is_active: true,
  },
  {
    id: "user-jane-manager",
    email: "jane@company.local",
    name: "Jane Manager",
    title: "Marketing Manager",
    reports_to: "CEO",
    password_hash:
      "$2b$12$RUOE3U61cNPouIMJowV15uqkXsPiiJ7KnPgmkwQTgvWg2FC80YTyC",
    is_active: true,
  },
];

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) {
        return;
      }
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1);
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
  } catch {
    // Ignore if missing; process env may already be loaded.
  }
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureTableExists(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("*").limit(1);
  if (error) {
    throw new Error(
      `Missing table "${tableName}". Run supabase/schema.sql first. Supabase error: ${error.message}`
    );
  }
}

function toAuthUserRecord(rawUser) {
  if (!rawUser || typeof rawUser !== "object") {
    return null;
  }

  const user = rawUser;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string" ||
    typeof user.title !== "string" ||
    typeof user.reportsTo !== "string" ||
    typeof user.passwordHash !== "string"
  ) {
    return null;
  }

  return {
    id: user.id.trim(),
    email: normalizeEmail(user.email),
    name: user.name.trim(),
    title: user.title.trim() || "Member",
    reports_to: user.reportsTo.trim() || "Not assigned",
    password_hash: user.passwordHash,
    is_active: user.isActive !== false,
  };
}

function toLoggedUserRecord(rawUser) {
  if (!rawUser || typeof rawUser !== "object") {
    return null;
  }

  const user = rawUser;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string"
  ) {
    return null;
  }

  return {
    id: user.id.trim(),
    email: normalizeEmail(user.email),
    name: user.name.trim(),
    title: typeof user.title === "string" && user.title.trim() ? user.title.trim() : "Member",
    reports_to:
      typeof user.reportsTo === "string" && user.reportsTo.trim()
        ? user.reportsTo.trim()
        : "Not assigned",
  };
}

async function findUserByEmail(supabase, email) {
  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("email", normalizeEmail(email))
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to query app_users by email: ${error.message}`);
  }
  return data;
}

async function upsertAuthUser(supabase, user) {
  const existingByEmail = await findUserByEmail(supabase, user.email);
  if (existingByEmail) {
    const { error } = await supabase
      .from("app_users")
      .update({
        email: user.email,
        name: user.name,
        title: user.title,
        reports_to: user.reports_to,
        password_hash: user.password_hash,
        is_active: user.is_active,
      })
      .eq("id", existingByEmail.id);
    if (error) {
      throw new Error(`Failed to update app_users (${user.email}): ${error.message}`);
    }
    return { updated: 1, inserted: 0 };
  }

  const { error } = await supabase.from("app_users").insert(user);
  if (error) {
    throw new Error(`Failed to insert app_users (${user.email}): ${error.message}`);
  }
  return { updated: 0, inserted: 1 };
}

async function markLoggedUser(supabase, user) {
  const existingByEmail = await findUserByEmail(supabase, user.email);
  const lastLoginAt = new Date().toISOString();

  if (existingByEmail) {
    const { error } = await supabase
      .from("app_users")
      .update({
        name: user.name,
        title: user.title,
        reports_to: user.reports_to,
        is_active: true,
        last_login_at: lastLoginAt,
      })
      .eq("id", existingByEmail.id);
    if (error) {
      throw new Error(`Failed to mark logged user (${user.email}): ${error.message}`);
    }
    return { updated: 1, inserted: 0 };
  }

  const placeholderPasswordHash = await bcrypt.hash(randomUUID(), 12);
  const { error } = await supabase.from("app_users").insert({
    id: user.id || `user-${randomUUID()}`,
    email: user.email,
    name: user.name,
    title: user.title,
    reports_to: user.reports_to,
    password_hash: placeholderPasswordHash,
    is_active: true,
    last_login_at: lastLoginAt,
  });
  if (error) {
    throw new Error(
      `Failed to create logged user placeholder (${user.email}): ${error.message}`
    );
  }
  return { updated: 0, inserted: 1 };
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment."
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await ensureTableExists(supabase, "app_users");
  await ensureTableExists(supabase, "workstream_state");

  const fileUsers = (await readJsonFile(AUTH_USERS_FILE))
    .map(toAuthUserRecord)
    .filter(Boolean);
  const loggedUsers = (await readJsonFile(AUTH_LOGGED_USERS_FILE))
    .map(toLoggedUserRecord)
    .filter(Boolean);

  const allUsers = [...SEEDED_USERS, ...fileUsers];
  const dedupedUsersByEmail = new Map();
  allUsers.forEach((user) => {
    dedupedUsersByEmail.set(normalizeEmail(user.email), user);
  });

  let userInserted = 0;
  let userUpdated = 0;

  for (const user of dedupedUsersByEmail.values()) {
    const result = await upsertAuthUser(supabase, user);
    userInserted += result.inserted;
    userUpdated += result.updated;
  }

  let loggedInserted = 0;
  let loggedUpdated = 0;

  for (const user of loggedUsers) {
    const result = await markLoggedUser(supabase, user);
    loggedInserted += result.inserted;
    loggedUpdated += result.updated;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        users: {
          processed: dedupedUsersByEmail.size,
          inserted: userInserted,
          updated: userUpdated,
        },
        loggedUsers: {
          processed: loggedUsers.length,
          inserted: loggedInserted,
          updated: loggedUpdated,
        },
        next: [
          "Sign in once from browser and open Marketing/Development pages.",
          "Client localStorage state will sync to Supabase workstream_state automatically.",
        ],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
