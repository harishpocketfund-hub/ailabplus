import { scheduleWorkstreamStateSync } from "@/lib/supabase/workstream-state-client";
export const DEVELOPMENT_PROJECT_COMMITS_STORAGE_KEY =
  "internal-system-development-project-commits";
const DEVELOPMENT_PROJECT_COMMITS_UPDATED_EVENT =
  "internal-system-development-project-commits-updated";

export type DevelopmentProjectCommitScope = "project" | "task";

export type DevelopmentProjectCommitLog = {
  id: string;
  projectId: string;
  projectName: string;
  changedBy: string;
  scope?: DevelopmentProjectCommitScope;
  action?: string;
  taskId?: string | null;
  taskTitle?: string | null;
  field: string;
  fromValue: string;
  toValue: string;
  changedAtIso: string;
  changedAtIndia: string;
};

const isDevelopmentProjectCommitScope = (
  value: unknown
): value is DevelopmentProjectCommitScope => value === "project" || value === "task";

function toDevelopmentProjectCommitLog(
  value: unknown,
  fallbackIndex: number
): DevelopmentProjectCommitLog | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const logEntry = value as Partial<DevelopmentProjectCommitLog>;
  if (
    typeof logEntry.projectId !== "string" ||
    typeof logEntry.projectName !== "string" ||
    typeof logEntry.changedBy !== "string" ||
    typeof logEntry.field !== "string" ||
    !logEntry.field.trim() ||
    typeof logEntry.fromValue !== "string" ||
    typeof logEntry.toValue !== "string" ||
    typeof logEntry.changedAtIso !== "string" ||
    typeof logEntry.changedAtIndia !== "string"
  ) {
    return null;
  }

  return {
    id:
      typeof logEntry.id === "string" && logEntry.id.trim()
        ? logEntry.id
        : `project-commit-${fallbackIndex}`,
    projectId: logEntry.projectId,
    projectName: logEntry.projectName,
    changedBy: logEntry.changedBy,
    scope: isDevelopmentProjectCommitScope(logEntry.scope)
      ? logEntry.scope
      : "project",
    action:
      typeof logEntry.action === "string" && logEntry.action.trim()
        ? logEntry.action
        : "updated",
    taskId: typeof logEntry.taskId === "string" ? logEntry.taskId : null,
    taskTitle:
      typeof logEntry.taskTitle === "string" && logEntry.taskTitle.trim()
        ? logEntry.taskTitle
        : null,
    field: logEntry.field.trim(),
    fromValue: logEntry.fromValue,
    toValue: logEntry.toValue,
    changedAtIso: logEntry.changedAtIso,
    changedAtIndia: logEntry.changedAtIndia,
  };
}

export function parseDevelopmentProjectCommitLogs(
  rawLogs: string | null
): DevelopmentProjectCommitLog[] {
  if (!rawLogs) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawLogs) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((logEntry, index) => toDevelopmentProjectCommitLog(logEntry, index))
      .filter((logEntry): logEntry is DevelopmentProjectCommitLog => logEntry !== null);
  } catch {
    return [];
  }
}

export function getDevelopmentProjectCommitLogsSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEVELOPMENT_PROJECT_COMMITS_STORAGE_KEY);
}

export function getDevelopmentProjectCommitLogsServerSnapshot(): string | null {
  return null;
}

export function subscribeToDevelopmentProjectCommitLogs(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DEVELOPMENT_PROJECT_COMMITS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEVELOPMENT_PROJECT_COMMITS_UPDATED_EVENT, handler);
  };
}

export function writeDevelopmentProjectCommitLogs(
  logs: DevelopmentProjectCommitLog[]
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    DEVELOPMENT_PROJECT_COMMITS_STORAGE_KEY,
    JSON.stringify(logs)
  );
  window.dispatchEvent(new Event(DEVELOPMENT_PROJECT_COMMITS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("development");
}

function createDevelopmentProjectCommitLogId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createIndiaDateTimeLabel(date: Date): string {
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

export function appendDevelopmentProjectCommitLogs(
  logs: Omit<DevelopmentProjectCommitLog, "id">[]
): void {
  if (logs.length === 0) {
    return;
  }

  const currentLogs = parseDevelopmentProjectCommitLogs(
    getDevelopmentProjectCommitLogsSnapshot()
  );
  const nextLogs = [
    ...currentLogs,
    ...logs.map((logEntry) => ({
      ...logEntry,
      id: createDevelopmentProjectCommitLogId(),
    })),
  ];

  writeDevelopmentProjectCommitLogs(nextLogs);
}
