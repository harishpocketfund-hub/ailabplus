import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PreferenceRow = {
  user_id: string;
  data: unknown;
  updated_at: string | null;
};

type UserRow = {
  id: string;
  name: string;
};

type MyWorkPreferenceSummary = {
  userId: string;
  userName: string;
  activeTab: string;
  assignedByMeTab: string;
  focusedTaskKeys: string[];
  customTodos: Array<{
    title: string;
    hours: number;
    done: boolean;
  }>;
  updatedAtIso: string;
};

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePreferenceRowData(value: unknown) {
  if (!isObjectRecord(value)) {
    return {
      activeTab: "all",
      assignedByMeTab: "all",
      focusedTaskKeys: [] as string[],
      customTodos: [] as Array<{ title: string; hours: number; done: boolean }>,
    };
  }

  const activeTab =
    typeof value.activeTab === "string" && value.activeTab.trim().length > 0
      ? value.activeTab
      : "all";
  const assignedByMeTab =
    typeof value.assignedByMeTab === "string" && value.assignedByMeTab.trim().length > 0
      ? value.assignedByMeTab
      : "all";

  const focusedTaskKeys = Array.isArray(value.focusedTaskKeys)
    ? value.focusedTaskKeys.filter(
        (taskKey): taskKey is string =>
          typeof taskKey === "string" && taskKey.trim().length > 0
      )
    : [];

  const customTodos = Array.isArray(value.customTodos)
    ? value.customTodos
        .map((todo) => {
          if (!isObjectRecord(todo)) {
            return null;
          }
          if (
            typeof todo.title !== "string" ||
            typeof todo.hours !== "number" ||
            typeof todo.done !== "boolean"
          ) {
            return null;
          }
          return {
            title: todo.title,
            hours: Number.isFinite(todo.hours) ? todo.hours : 0,
            done: todo.done,
          };
        })
        .filter(
          (
            todo
          ): todo is {
            title: string;
            hours: number;
            done: boolean;
          } => todo !== null
        )
    : [];

  return {
    activeTab,
    assignedByMeTab,
    focusedTaskKeys,
    customTodos,
  };
}

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    const { data: preferenceRows, error: preferenceError } = await supabase
      .from("user_preferences")
      .select("user_id, data, updated_at")
      .eq("namespace", "my-work")
      .order("updated_at", { ascending: false })
      .limit(400);

    if (preferenceError) {
      if (preferenceError.code === "42P01") {
        return NextResponse.json({ preferences: [] as MyWorkPreferenceSummary[] });
      }
      return NextResponse.json(
        { error: `Failed to fetch my-work preferences: ${preferenceError.message}` },
        { status: 500 }
      );
    }

    const { data: userRows, error: userError } = await supabase
      .from("app_users")
      .select("id, name");

    if (userError) {
      return NextResponse.json(
        { error: `Failed to fetch users: ${userError.message}` },
        { status: 500 }
      );
    }

    const userNameById = new Map(
      ((userRows ?? []) as UserRow[]).map((user) => [user.id, user.name] as const)
    );

    const summaries = ((preferenceRows ?? []) as PreferenceRow[]).map((row) => {
      const parsedData = parsePreferenceRowData(row.data);
      return {
        userId: row.user_id,
        userName: userNameById.get(row.user_id) ?? row.user_id,
        activeTab: parsedData.activeTab,
        assignedByMeTab: parsedData.assignedByMeTab,
        focusedTaskKeys: parsedData.focusedTaskKeys,
        customTodos: parsedData.customTodos,
        updatedAtIso: row.updated_at ?? "",
      } satisfies MyWorkPreferenceSummary;
    });

    return NextResponse.json({ preferences: summaries });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

