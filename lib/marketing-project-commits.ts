import { scheduleWorkstreamStateSync } from "@/lib/supabase/workstream-state-client";
export const MARKETING_PROJECT_COMMITS_STORAGE_KEY =
  "internal-system-marketing-project-commits";
const MARKETING_PROJECT_COMMITS_UPDATED_EVENT =
  "internal-system-marketing-project-commits-updated";

export type MarketingProjectCommitScope = "project" | "task";

export type MarketingProjectCommitLog = {
  id: string;
  projectId: string;
  projectName: string;
  changedBy: string;
  scope?: MarketingProjectCommitScope;
  action?: string;
  taskId?: string | null;
  taskTitle?: string | null;
  field: string;
  fromValue: string;
  toValue: string;
  changedAtIso: string;
  changedAtIndia: string;
};

const isMarketingProjectCommitScope = (
  value: unknown
): value is MarketingProjectCommitScope => value === "project" || value === "task";

function toMarketingProjectCommitLog(
  value: unknown,
  fallbackIndex: number
): MarketingProjectCommitLog | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const logEntry = value as Partial<MarketingProjectCommitLog>;
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
    scope: isMarketingProjectCommitScope(logEntry.scope)
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

export function parseMarketingProjectCommitLogs(
  rawLogs: string | null
): MarketingProjectCommitLog[] {
  if (!rawLogs) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawLogs) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((logEntry, index) => toMarketingProjectCommitLog(logEntry, index))
      .filter((logEntry): logEntry is MarketingProjectCommitLog => logEntry !== null);
  } catch {
    return [];
  }
}

export function getMarketingProjectCommitLogsSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(MARKETING_PROJECT_COMMITS_STORAGE_KEY);
}

export function getMarketingProjectCommitLogsServerSnapshot(): string | null {
  return null;
}

export function subscribeToMarketingProjectCommitLogs(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(MARKETING_PROJECT_COMMITS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(MARKETING_PROJECT_COMMITS_UPDATED_EVENT, handler);
  };
}

export function writeMarketingProjectCommitLogs(
  logs: MarketingProjectCommitLog[]
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    MARKETING_PROJECT_COMMITS_STORAGE_KEY,
    JSON.stringify(logs)
  );
  window.dispatchEvent(new Event(MARKETING_PROJECT_COMMITS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("marketing");
}

function createMarketingProjectCommitLogId(): string {
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

export function appendMarketingProjectCommitLogs(
  logs: Omit<MarketingProjectCommitLog, "id">[]
): void {
  if (logs.length === 0) {
    return;
  }

  const currentLogs = parseMarketingProjectCommitLogs(
    getMarketingProjectCommitLogsSnapshot()
  );
  const nextLogs = [
    ...currentLogs,
    ...logs.map((logEntry) => ({
      ...logEntry,
      id: createMarketingProjectCommitLogId(),
    })),
  ];

  writeMarketingProjectCommitLogs(nextLogs);
}
