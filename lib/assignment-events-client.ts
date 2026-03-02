"use client";

import type { WorkstreamType } from "@/lib/supabase/workstream-state-shared";

export type TaskAssignmentAction =
  | "assigned"
  | "reassigned"
  | "unassigned"
  | "hours_changed";

type AssignmentChangeInput = {
  fromAssignee: string | null;
  toAssignee: string | null;
  fromHoursAssigned: number;
  toHoursAssigned: number;
};

export type TaskAssignmentEventPayload = AssignmentChangeInput & {
  workstream: WorkstreamType;
  projectId: string;
  projectName: string;
  taskId: string;
  taskTitle: string;
  reason?: string;
};

function toSafeHours(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value * 100) / 100;
}

function normalizeAssignee(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function deriveTaskAssignmentAction(
  input: AssignmentChangeInput
): TaskAssignmentAction | null {
  const fromAssignee = normalizeAssignee(input.fromAssignee);
  const toAssignee = normalizeAssignee(input.toAssignee);
  const fromHoursAssigned = toSafeHours(input.fromHoursAssigned);
  const toHoursAssigned = toSafeHours(input.toHoursAssigned);

  if (fromAssignee !== toAssignee) {
    if (!fromAssignee && toAssignee) {
      return "assigned";
    }
    if (fromAssignee && !toAssignee) {
      return "unassigned";
    }
    return "reassigned";
  }

  if (fromHoursAssigned !== toHoursAssigned) {
    return "hours_changed";
  }

  return null;
}

export async function recordTaskAssignmentEvent(
  payload: TaskAssignmentEventPayload
): Promise<boolean> {
  const action = deriveTaskAssignmentAction(payload);
  if (!action) {
    return false;
  }

  try {
    const response = await fetch("/api/assignment-events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        action,
        fromAssignee: normalizeAssignee(payload.fromAssignee),
        toAssignee: normalizeAssignee(payload.toAssignee),
        fromHoursAssigned: toSafeHours(payload.fromHoursAssigned),
        toHoursAssigned: toSafeHours(payload.toHoursAssigned),
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
