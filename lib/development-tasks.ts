export const DEVELOPMENT_TASKS_STORAGE_KEY = "internal-system-development-tasks";
const DEVELOPMENT_TASKS_UPDATED_EVENT = "internal-system-development-tasks-updated";

export const TASK_STATUS_OPTIONS = [
  "To Do",
  "In Progress",
  "Review",
  "Done",
] as const;

export type DevelopmentTaskStatus = (typeof TASK_STATUS_OPTIONS)[number];
export const TASK_PRIORITY_OPTIONS = ["Low", "Medium", "High"] as const;
export type DevelopmentTaskPriority = (typeof TASK_PRIORITY_OPTIONS)[number];
export const RECURRING_WEEKDAY_OPTIONS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
export type DevelopmentRecurringWeekday =
  (typeof RECURRING_WEEKDAY_OPTIONS)[number];
export type DevelopmentRecurringCompletions = Record<string, boolean>;

export type DevelopmentSubtask = {
  id: string;
  title: string;
  done: boolean;
};

export type DevelopmentTask = {
  id: string;
  createdAt: string | null;
  title: string;
  description: string;
  dueDate: string;
  status: DevelopmentTaskStatus;
  order: number;
  assignee: string | null;
  hoursAssigned: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  timeSpent: number;
  priority: DevelopmentTaskPriority;
  subtasks: DevelopmentSubtask[];
  isRecurring: boolean;
  recurringDays: DevelopmentRecurringWeekday[];
  recurringTimePerOccurrenceHours: number;
  recurringCompletions: DevelopmentRecurringCompletions;
};

type DevelopmentTasksByProject = Record<string, DevelopmentTask[]>;

function isDevelopmentTaskStatus(value: unknown): value is DevelopmentTaskStatus {
  return TASK_STATUS_OPTIONS.includes(value as DevelopmentTaskStatus);
}

function isDevelopmentTaskPriority(value: unknown): value is DevelopmentTaskPriority {
  return TASK_PRIORITY_OPTIONS.includes(value as DevelopmentTaskPriority);
}

function isDevelopmentRecurringWeekday(
  value: unknown
): value is DevelopmentRecurringWeekday {
  return RECURRING_WEEKDAY_OPTIONS.includes(value as DevelopmentRecurringWeekday);
}

function toDevelopmentSubtask(
  value: unknown,
  fallbackIndex: number
): DevelopmentSubtask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const subtask = value as Partial<DevelopmentSubtask>;
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

function parseDevelopmentSubtasks(value: unknown): DevelopmentSubtask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((subtask, index) => toDevelopmentSubtask(subtask, index))
    .filter((subtask): subtask is DevelopmentSubtask => subtask !== null);
}

function parseDevelopmentRecurringDays(
  value: unknown
): DevelopmentRecurringWeekday[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((day): day is DevelopmentRecurringWeekday =>
    isDevelopmentRecurringWeekday(day)
  );
}

function parseDevelopmentRecurringCompletions(
  value: unknown
): DevelopmentRecurringCompletions {
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

function toDevelopmentTask(
  value: unknown,
  fallbackOrder: number
): DevelopmentTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const task = value as Partial<DevelopmentTask> & { order?: unknown };
  if (
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    typeof task.description !== "string" ||
    typeof task.dueDate !== "string" ||
    !isDevelopmentTaskStatus(task.status)
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
  const priority = isDevelopmentTaskPriority(task.priority)
    ? task.priority
    : "Medium";
  const subtasks = parseDevelopmentSubtasks(task.subtasks);
  const createdAt = parseTaskCreatedAt(task.createdAt);
  const isRecurring = task.isRecurring === true;
  const recurringDays = parseDevelopmentRecurringDays(task.recurringDays);
  const recurringTimePerOccurrenceHours =
    typeof task.recurringTimePerOccurrenceHours === "number" &&
    Number.isFinite(task.recurringTimePerOccurrenceHours) &&
    task.recurringTimePerOccurrenceHours >= 0
      ? task.recurringTimePerOccurrenceHours
      : 0;
  const recurringCompletions = parseDevelopmentRecurringCompletions(
    task.recurringCompletions
  );

  return {
    id: task.id,
    createdAt,
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

export function sortTasksInStatus(tasks: DevelopmentTask[]): DevelopmentTask[] {
  return [...tasks].sort((firstTask, secondTask) => firstTask.order - secondTask.order);
}

export function normalizeDevelopmentTaskOrders(tasks: DevelopmentTask[]): DevelopmentTask[] {
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

export function parseDevelopmentTasksByProject(
  rawTasksByProject: string | null
): DevelopmentTasksByProject {
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
          .map((task, index) => toDevelopmentTask(task, index))
          .filter((task): task is DevelopmentTask => task !== null);

        return [projectId, normalizeDevelopmentTaskOrders(parsedTasks)] as const;
      }
    );

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function getDevelopmentTasksSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEVELOPMENT_TASKS_STORAGE_KEY);
}

export function getDevelopmentTasksServerSnapshot(): string | null {
  return null;
}

export function subscribeToDevelopmentTasks(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DEVELOPMENT_TASKS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEVELOPMENT_TASKS_UPDATED_EVENT, handler);
  };
}

export function writeDevelopmentTasksByProject(
  tasksByProject: DevelopmentTasksByProject
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    DEVELOPMENT_TASKS_STORAGE_KEY,
    JSON.stringify(tasksByProject)
  );
  window.dispatchEvent(new Event(DEVELOPMENT_TASKS_UPDATED_EVENT));
}

export function writeDevelopmentTasksForProject(
  projectId: string,
  tasks: DevelopmentTask[]
): void {
  const tasksByProject = parseDevelopmentTasksByProject(getDevelopmentTasksSnapshot());
  tasksByProject[projectId] = normalizeDevelopmentTaskOrders(tasks);
  writeDevelopmentTasksByProject(tasksByProject);
}

export function createDevelopmentTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDevelopmentSubtaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
