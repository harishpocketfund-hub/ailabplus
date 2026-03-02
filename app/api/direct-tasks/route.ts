import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  isDirectTask,
  mapDirectTaskRowToTask,
  toDirectTaskRowPayload,
  type DirectTask,
} from "@/lib/direct-tasks";

type DirectTaskRow = Parameters<typeof mapDirectTaskRowToTask>[0];

type DirectTaskPostBody = {
  task?: unknown;
};

type DirectTaskPutBody = {
  task?: unknown;
  tasks?: unknown;
};

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

function getDirectTaskIdFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const taskId = (url.searchParams.get("id") ?? "").trim();
  return taskId || null;
}

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("direct_tasks")
      .select(
        "id, created_at, title, description, due_date, status, order_index, assignee, hours_assigned, blocker_reason, dependency_task_ids, time_spent, priority, subtasks, is_recurring, recurring_days, recurring_time_per_occurrence_hours, recurring_completions, assigned_by_name, assigned_by_user_id, assigned_at"
      )
      .order("updated_at", { ascending: false });

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json({ tasks: [] as DirectTask[] });
      }

      return NextResponse.json(
        { error: `Failed to fetch direct tasks: ${error.message}` },
        { status: 500 }
      );
    }

    const tasks = (data ?? []).map((row) =>
      mapDirectTaskRowToTask(row as DirectTaskRow)
    );
    return NextResponse.json({ tasks });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: DirectTaskPostBody;
  try {
    body = (await request.json()) as DirectTaskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isDirectTask(body.task)) {
    return NextResponse.json({ error: "Invalid task payload." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const payload = toDirectTaskRowPayload(body.task);
    const { error } = await supabase.from("direct_tasks").insert({
      ...payload,
      created_by_user_id: sessionUser.id,
      updated_by_user_id: sessionUser.id,
    });

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { ok: false, warning: "direct_tasks table missing." },
          { status: 202 }
        );
      }
      return NextResponse.json(
        { error: `Failed to create direct task: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: DirectTaskPutBody;
  try {
    body = (await request.json()) as DirectTaskPutBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    if (Array.isArray(body.tasks)) {
      const directTasks = body.tasks.filter(isDirectTask) as DirectTask[];
      const payload = directTasks.map((task) => ({
        ...toDirectTaskRowPayload(task),
        updated_by_user_id: sessionUser.id,
      }));
      const { error } = await supabase
        .from("direct_tasks")
        .upsert(payload, { onConflict: "id" });

      if (error) {
        if (error.code === "42P01") {
          return NextResponse.json(
            { ok: false, warning: "direct_tasks table missing." },
            { status: 202 }
          );
        }
        return NextResponse.json(
          { error: `Failed to save direct tasks: ${error.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true });
    }

    if (!isDirectTask(body.task)) {
      return NextResponse.json({ error: "Invalid task payload." }, { status: 400 });
    }

    const payload = toDirectTaskRowPayload(body.task);
    const { error } = await supabase
      .from("direct_tasks")
      .update({
        ...payload,
        updated_by_user_id: sessionUser.id,
      })
      .eq("id", body.task.id);

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { ok: false, warning: "direct_tasks table missing." },
          { status: 202 }
        );
      }
      return NextResponse.json(
        { error: `Failed to update direct task: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const taskId = getDirectTaskIdFromRequest(request);
  if (!taskId) {
    return NextResponse.json({ error: "Task id is required." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("direct_tasks").delete().eq("id", taskId);

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { ok: false, warning: "direct_tasks table missing." },
          { status: 202 }
        );
      }
      return NextResponse.json(
        { error: `Failed to delete direct task: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
