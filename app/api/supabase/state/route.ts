import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  EMPTY_WORKSTREAM_STATE,
  isWorkstreamType,
  normalizeWorkstreamState,
} from "@/lib/supabase/workstream-state-shared";

function getWorkstreamFromRequest(request: Request) {
  const url = new URL(request.url);
  const value = url.searchParams.get("workstream");
  if (!isWorkstreamType(value)) {
    return null;
  }
  return value;
}

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const workstream = getWorkstreamFromRequest(request);
  if (!workstream) {
    return NextResponse.json(
      { error: "Invalid workstream. Use marketing or development." },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("workstream_state")
      .select(
        "projects, tags, tasks_by_project, members_by_project, commit_logs"
      )
      .eq("workstream", workstream)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to fetch workstream state: ${error.message}` },
        { status: 500 }
      );
    }

    const state = normalizeWorkstreamState(
      data
        ? {
            projects: data.projects,
            tags: data.tags,
            tasksByProject: data.tasks_by_project,
            membersByProject: data.members_by_project,
            commitLogs: data.commit_logs,
          }
        : EMPTY_WORKSTREAM_STATE
    );

    return NextResponse.json({ state });
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

  const workstream = getWorkstreamFromRequest(request);
  if (!workstream) {
    return NextResponse.json(
      { error: "Invalid workstream. Use marketing or development." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const state = normalizeWorkstreamState(body);

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("workstream_state").upsert(
      {
        workstream,
        projects: state.projects,
        tags: state.tags,
        tasks_by_project: state.tasksByProject,
        members_by_project: state.membersByProject,
        commit_logs: state.commitLogs,
        updated_by_user_id: sessionUser.id,
      },
      { onConflict: "workstream" }
    );

    if (error) {
      return NextResponse.json(
        { error: `Failed to save workstream state: ${error.message}` },
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
