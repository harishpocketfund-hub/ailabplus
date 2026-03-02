import {
  RECURRING_WEEKDAY_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  type MarketingRecurringCompletions,
  type MarketingRecurringWeekday,
  type MarketingSubtask,
  type MarketingTaskPriority,
  type MarketingTaskStatus,
} from "@/lib/marketing-tasks";

export type DirectTask = {
  id: string;
  createdAt: string | null;
  title: string;
  description: string;
  dueDate: string;
  status: MarketingTaskStatus;
  order: number;
  assignee: string | null;
  hoursAssigned: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  timeSpent: number;
  priority: MarketingTaskPriority;
  subtasks: MarketingSubtask[];
  isRecurring: boolean;
  recurringDays: MarketingRecurringWeekday[];
  recurringTimePerOccurrenceHours: number;
  recurringCompletions: MarketingRecurringCompletions;
  assignedByName: string | null;
  assignedByUserId: string | null;
  assignedAtIso: string | null;
};

type DirectTaskRow = {
  id: string;
  created_at: string | null;
  title: string;
  description: string;
  due_date: string;
  status: MarketingTaskStatus;
  order_index: number;
  assignee: string | null;
  hours_assigned: number;
  blocker_reason: string;
  dependency_task_ids: string[] | null;
  time_spent: number;
  priority: MarketingTaskPriority;
  subtasks: unknown;
  is_recurring: boolean;
  recurring_days: string[] | null;
  recurring_time_per_occurrence_hours: number;
  recurring_completions: unknown;
  assigned_by_name: string | null;
  assigned_by_user_id: string | null;
  assigned_at: string | null;
};

function parseTaskCreatedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}

function isTaskStatus(value: unknown): value is MarketingTaskStatus {
  return TASK_STATUS_OPTIONS.includes(value as MarketingTaskStatus);
}

function isTaskPriority(value: unknown): value is MarketingTaskPriority {
  return TASK_PRIORITY_OPTIONS.includes(value as MarketingTaskPriority);
}

function isRecurringWeekday(value: unknown): value is MarketingRecurringWeekday {
  return RECURRING_WEEKDAY_OPTIONS.includes(value as MarketingRecurringWeekday);
}

function toSubtask(value: unknown, fallbackIndex: number): MarketingSubtask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const subtask = value as Partial<MarketingSubtask>;
  if (typeof subtask.title !== "string" || !subtask.title.trim()) {
    return null;
  }

  return {
    id:
      typeof subtask.id === "string" && subtask.id.trim()
        ? subtask.id
        : `direct-subtask-${fallbackIndex}`,
    title: subtask.title.trim(),
    done: subtask.done === true,
  };
}

function parseSubtasks(value: unknown): MarketingSubtask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((subtask, index) => toSubtask(subtask, index))
    .filter((subtask): subtask is MarketingSubtask => subtask !== null);
}

function parseRecurringDays(value: unknown): MarketingRecurringWeekday[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((day): day is MarketingRecurringWeekday =>
    isRecurringWeekday(day)
  );
}

function parseRecurringCompletions(
  value: unknown
): MarketingRecurringCompletions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([dateKey, isDone]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && typeof isDone === "boolean"
  ) as Array<[string, boolean]>;
  return Object.fromEntries(entries);
}

function parseDependencyTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function mapDirectTaskRowToTask(row: DirectTaskRow): DirectTask {
  return {
    id: row.id,
    createdAt: parseTaskCreatedAt(row.created_at),
    title: row.title,
    description: row.description ?? "",
    dueDate: row.due_date,
    status: isTaskStatus(row.status) ? row.status : "To Do",
    order:
      typeof row.order_index === "number" && Number.isFinite(row.order_index)
        ? row.order_index
        : 0,
    assignee: normalizeText(row.assignee),
    hoursAssigned:
      typeof row.hours_assigned === "number" &&
      Number.isFinite(row.hours_assigned) &&
      row.hours_assigned >= 0
        ? row.hours_assigned
        : 0,
    blockerReason: row.blocker_reason ?? "",
    dependencyTaskIds: parseDependencyTaskIds(row.dependency_task_ids),
    timeSpent:
      typeof row.time_spent === "number" &&
      Number.isFinite(row.time_spent) &&
      row.time_spent >= 0
        ? row.time_spent
        : 0,
    priority: isTaskPriority(row.priority) ? row.priority : "Medium",
    subtasks: parseSubtasks(row.subtasks),
    isRecurring: row.is_recurring === true,
    recurringDays: parseRecurringDays(row.recurring_days),
    recurringTimePerOccurrenceHours:
      typeof row.recurring_time_per_occurrence_hours === "number" &&
      Number.isFinite(row.recurring_time_per_occurrence_hours) &&
      row.recurring_time_per_occurrence_hours >= 0
        ? row.recurring_time_per_occurrence_hours
        : 0,
    recurringCompletions: parseRecurringCompletions(row.recurring_completions),
    assignedByName: normalizeText(row.assigned_by_name),
    assignedByUserId: normalizeText(row.assigned_by_user_id),
    assignedAtIso: normalizeText(row.assigned_at),
  };
}

export function toDirectTaskRowPayload(task: DirectTask) {
  return {
    id: task.id,
    title: task.title.trim(),
    description: task.description ?? "",
    due_date: task.dueDate,
    status: isTaskStatus(task.status) ? task.status : "To Do",
    order_index:
      typeof task.order === "number" && Number.isFinite(task.order) ? task.order : 0,
    assignee: normalizeText(task.assignee),
    hours_assigned:
      typeof task.hoursAssigned === "number" &&
      Number.isFinite(task.hoursAssigned) &&
      task.hoursAssigned >= 0
        ? task.hoursAssigned
        : 0,
    blocker_reason: task.blockerReason ?? "",
    dependency_task_ids: parseDependencyTaskIds(task.dependencyTaskIds),
    time_spent:
      typeof task.timeSpent === "number" &&
      Number.isFinite(task.timeSpent) &&
      task.timeSpent >= 0
        ? task.timeSpent
        : 0,
    priority: isTaskPriority(task.priority) ? task.priority : "Medium",
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    is_recurring: task.isRecurring === true,
    recurring_days: parseRecurringDays(task.recurringDays),
    recurring_time_per_occurrence_hours:
      typeof task.recurringTimePerOccurrenceHours === "number" &&
      Number.isFinite(task.recurringTimePerOccurrenceHours) &&
      task.recurringTimePerOccurrenceHours >= 0
        ? task.recurringTimePerOccurrenceHours
        : 0,
    recurring_completions: parseRecurringCompletions(task.recurringCompletions),
    assigned_by_name: normalizeText(task.assignedByName),
    assigned_by_user_id: normalizeText(task.assignedByUserId),
    assigned_at: normalizeText(task.assignedAtIso),
  };
}

export function isDirectTask(value: unknown): value is DirectTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const task = value as Partial<DirectTask>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.description === "string" &&
    typeof task.dueDate === "string" &&
    isTaskStatus(task.status)
  );
}

export function parseDirectTasks(value: unknown): DirectTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isDirectTask)
    .map((task) => ({
      ...task,
      assignedByName: normalizeText(task.assignedByName),
      assignedByUserId: normalizeText(task.assignedByUserId),
      assignedAtIso: normalizeText(task.assignedAtIso),
    }));
}

export function createDirectTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `direct-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
