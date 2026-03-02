import { scheduleWorkstreamStateSync } from "@/lib/supabase/workstream-state-client";
export const MARKETING_TASKS_STORAGE_KEY = "internal-system-marketing-tasks";
const MARKETING_TASKS_UPDATED_EVENT = "internal-system-marketing-tasks-updated";

export const TASK_STATUS_OPTIONS = [
  "To Do",
  "In Progress",
  "Review",
  "Done",
] as const;

export type MarketingTaskStatus = (typeof TASK_STATUS_OPTIONS)[number];
export const TASK_PRIORITY_OPTIONS = ["Low", "Medium", "High"] as const;
export type MarketingTaskPriority = (typeof TASK_PRIORITY_OPTIONS)[number];
export const RECURRING_WEEKDAY_OPTIONS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
export type MarketingRecurringWeekday =
  (typeof RECURRING_WEEKDAY_OPTIONS)[number];
export type MarketingRecurringCompletions = Record<string, boolean>;

export type MarketingSubtask = {
  id: string;
  title: string;
  done: boolean;
};

export type MarketingTask = {
  id: string;
  createdAt: string | null;
  assignedByName: string | null;
  assignedByUserId: string | null;
  assignedAtIso: string | null;
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
};

type MarketingTasksByProject = Record<string, MarketingTask[]>;

function isMarketingTaskStatus(value: unknown): value is MarketingTaskStatus {
  return TASK_STATUS_OPTIONS.includes(value as MarketingTaskStatus);
}

function isMarketingTaskPriority(value: unknown): value is MarketingTaskPriority {
  return TASK_PRIORITY_OPTIONS.includes(value as MarketingTaskPriority);
}

function isMarketingRecurringWeekday(
  value: unknown
): value is MarketingRecurringWeekday {
  return RECURRING_WEEKDAY_OPTIONS.includes(value as MarketingRecurringWeekday);
}

function toMarketingSubtask(
  value: unknown,
  fallbackIndex: number
): MarketingSubtask | null {
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
        : `subtask-${fallbackIndex}`,
    title: subtask.title.trim(),
    done: Boolean(subtask.done),
  };
}

function parseMarketingSubtasks(value: unknown): MarketingSubtask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((subtask, index) => toMarketingSubtask(subtask, index))
    .filter((subtask): subtask is MarketingSubtask => subtask !== null);
}

function parseMarketingRecurringDays(
  value: unknown
): MarketingRecurringWeekday[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((day): day is MarketingRecurringWeekday =>
    isMarketingRecurringWeekday(day)
  );
}

function parseMarketingRecurringCompletions(
  value: unknown
): MarketingRecurringCompletions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([dateKey, isDoneValue]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && typeof isDoneValue === "boolean"
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

function parseTaskCreatedAt(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function toMarketingTask(
  value: unknown,
  fallbackOrder: number
): MarketingTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const task = value as Partial<MarketingTask> & { order?: unknown };
  if (
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    typeof task.description !== "string" ||
    typeof task.dueDate !== "string" ||
    !isMarketingTaskStatus(task.status)
  ) {
    return null;
  }

  const order =
    typeof task.order === "number" && Number.isFinite(task.order)
      ? task.order
      : fallbackOrder;
  const assignee =
    typeof task.assignee === "string" && task.assignee.trim()
      ? task.assignee
      : null;
  const hoursAssigned =
    typeof task.hoursAssigned === "number" &&
    Number.isFinite(task.hoursAssigned) &&
    task.hoursAssigned >= 0
      ? task.hoursAssigned
      : 0;
  const blockerReason =
    typeof task.blockerReason === "string" ? task.blockerReason.trim() : "";
  const dependencyTaskIds = parseDependencyTaskIds(task.dependencyTaskIds);
  const timeSpent =
    typeof task.timeSpent === "number" &&
    Number.isFinite(task.timeSpent) &&
    task.timeSpent >= 0
      ? task.timeSpent
      : 0;
  const priority = isMarketingTaskPriority(task.priority)
    ? task.priority
    : "Medium";
  const subtasks = parseMarketingSubtasks(task.subtasks);
  const createdAt = parseTaskCreatedAt(task.createdAt);
  const assignedByName =
    typeof task.assignedByName === "string" && task.assignedByName.trim()
      ? task.assignedByName.trim()
      : null;
  const assignedByUserId =
    typeof task.assignedByUserId === "string" && task.assignedByUserId.trim()
      ? task.assignedByUserId.trim()
      : null;
  const assignedAtIso =
    typeof task.assignedAtIso === "string" && task.assignedAtIso.trim()
      ? task.assignedAtIso.trim()
      : null;
  const isRecurring = task.isRecurring === true;
  const recurringDays = parseMarketingRecurringDays(task.recurringDays);
  const recurringTimePerOccurrenceHours =
    typeof task.recurringTimePerOccurrenceHours === "number" &&
    Number.isFinite(task.recurringTimePerOccurrenceHours) &&
    task.recurringTimePerOccurrenceHours >= 0
      ? task.recurringTimePerOccurrenceHours
      : 0;
  const recurringCompletions = parseMarketingRecurringCompletions(
    task.recurringCompletions
  );

  return {
    id: task.id,
    createdAt,
    assignedByName,
    assignedByUserId,
    assignedAtIso,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    status: task.status,
    order,
    assignee,
    hoursAssigned,
    blockerReason,
    dependencyTaskIds,
    timeSpent,
    priority,
    subtasks,
    isRecurring,
    recurringDays,
    recurringTimePerOccurrenceHours,
    recurringCompletions,
  };
}

export function sortTasksInStatus(tasks: MarketingTask[]): MarketingTask[] {
  return [...tasks].sort((firstTask, secondTask) => firstTask.order - secondTask.order);
}

export function normalizeMarketingTaskOrders(tasks: MarketingTask[]): MarketingTask[] {
  const nextOrderById = new Map<string, number>();

  TASK_STATUS_OPTIONS.forEach((status) => {
    const tasksInStatus = sortTasksInStatus(
      tasks.filter((task) => task.status === status)
    );

    tasksInStatus.forEach((task, index) => {
      nextOrderById.set(task.id, index);
    });
  });

  return tasks.map((task) => ({
    ...task,
    order: nextOrderById.get(task.id) ?? 0,
  }));
}

export function parseMarketingTasksByProject(
  rawTasksByProject: string | null
): MarketingTasksByProject {
  if (!rawTasksByProject) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawTasksByProject) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>).map(
      ([projectId, tasks]) => {
        if (!Array.isArray(tasks)) {
          return [projectId, []] as const;
        }

        const parsedTasks = tasks
          .map((task, index) => toMarketingTask(task, index))
          .filter((task): task is MarketingTask => task !== null);

        return [projectId, normalizeMarketingTaskOrders(parsedTasks)] as const;
      }
    );

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function getMarketingTasksSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(MARKETING_TASKS_STORAGE_KEY);
}

export function getMarketingTasksServerSnapshot(): string | null {
  return null;
}

export function subscribeToMarketingTasks(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(MARKETING_TASKS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(MARKETING_TASKS_UPDATED_EVENT, handler);
  };
}

export function writeMarketingTasksByProject(
  tasksByProject: MarketingTasksByProject
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    MARKETING_TASKS_STORAGE_KEY,
    JSON.stringify(tasksByProject)
  );
  window.dispatchEvent(new Event(MARKETING_TASKS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("marketing");
}

export function writeMarketingTasksForProject(
  projectId: string,
  tasks: MarketingTask[]
): void {
  const tasksByProject = parseMarketingTasksByProject(getMarketingTasksSnapshot());
  tasksByProject[projectId] = normalizeMarketingTaskOrders(tasks);
  writeMarketingTasksByProject(tasksByProject);
}

export function createMarketingTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createMarketingSubtaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
