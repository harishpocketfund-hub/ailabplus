import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isWorkstreamType } from "@/lib/supabase/workstream-state-shared";

type TaskAssignmentAction =
  | "assigned"
  | "reassigned"
  | "unassigned"
  | "hours_changed";

type AssignmentEventRequestBody = {
  workstream?: unknown;
  projectId?: unknown;
  projectName?: unknown;
  taskId?: unknown;
  taskTitle?: unknown;
  action?: unknown;
  fromAssignee?: unknown;
  toAssignee?: unknown;
  fromHoursAssigned?: unknown;
  toHoursAssigned?: unknown;
  reason?: unknown;
};

const ASSIGNMENT_ACTIONS: TaskAssignmentAction[] = [
  "assigned",
  "reassigned",
  "unassigned",
  "hours_changed",
];

function createIndiaDateTimeLabel(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return `${formatter.format(date)} IST`;
}

function isAssignmentAction(value: unknown): value is TaskAssignmentAction {
  return ASSIGNMENT_ACTIONS.includes(value as TaskAssignmentAction);
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function parseOptionalAssignee(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function parseHours(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: AssignmentEventRequestBody;
  try {
    body = (await request.json()) as AssignmentEventRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isWorkstreamType(body.workstream)) {
    return NextResponse.json(
      { error: "workstream must be marketing or development." },
      { status: 400 }
    );
  }
  if (!isAssignmentAction(body.action)) {
    return NextResponse.json(
      { error: "Invalid action for assignment event." },
      { status: 400 }
    );
  }

  const projectId = parseNonEmptyString(body.projectId);
  const projectName = parseNonEmptyString(body.projectName);
  const taskId = parseNonEmptyString(body.taskId);
  const taskTitle = parseNonEmptyString(body.taskTitle);
  const fromHoursAssigned = parseHours(body.fromHoursAssigned);
  const toHoursAssigned = parseHours(body.toHoursAssigned);

  if (!projectId || !projectName || !taskId || !taskTitle) {
    return NextResponse.json(
      { error: "projectId, projectName, taskId, and taskTitle are required." },
      { status: 400 }
    );
  }
  if (fromHoursAssigned === null || toHoursAssigned === null) {
    return NextResponse.json(
      { error: "fromHoursAssigned and toHoursAssigned must be non-negative numbers." },
      { status: 400 }
    );
  }

  try {
    const changedAt = new Date();
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("task_assignment_events").insert({
      workstream: body.workstream,
      project_id: projectId,
      project_name: projectName,
      task_id: taskId,
      task_title: taskTitle,
      action: body.action,
      from_assignee: parseOptionalAssignee(body.fromAssignee),
      to_assignee: parseOptionalAssignee(body.toAssignee),
      from_hours_assigned: fromHoursAssigned,
      to_hours_assigned: toHoursAssigned,
      changed_by_user_id: sessionUser.id,
      changed_by_name: sessionUser.name,
      changed_by_email: sessionUser.email,
      reason:
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : "manual",
      changed_at_india: createIndiaDateTimeLabel(changedAt),
      metadata: {},
    });

    if (error) {
      // If table is missing in current env, keep app flow non-blocking.
      if (error.code === "42P01") {
        return NextResponse.json(
          { ok: false, warning: "task_assignment_events table missing." },
          { status: 202 }
        );
      }
      return NextResponse.json(
        { error: `Failed to save assignment event: ${error.message}` },
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
