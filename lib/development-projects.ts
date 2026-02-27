import { scheduleWorkstreamStateSync } from "@/lib/supabase/workstream-state-client";
export type DevelopmentProjectPriority = "High" | "Medium" | "Low";

export const DEVELOPMENT_PROJECT_PRIORITY_OPTIONS: DevelopmentProjectPriority[] = [
  "High",
  "Medium",
  "Low",
];

export type DevelopmentProject = {
  id: string;
  name: string;
  startDate: string;
  deadline: string;
  priority: DevelopmentProjectPriority;
  tags: string[];
  isCompleted: boolean;
};

export const DEVELOPMENT_PROJECTS_STORAGE_KEY = "internal-system-development-projects";
export const DEVELOPMENT_TAGS_STORAGE_KEY = "internal-system-development-tags";
const DEVELOPMENT_PROJECTS_UPDATED_EVENT = "internal-system-development-projects-updated";
const DEVELOPMENT_TAGS_UPDATED_EVENT = "internal-system-development-tags-updated";

export const DEFAULT_DEVELOPMENT_TAGS = [
  "Backend",
  "Frontend",
  "API",
  "Database",
  "DevOps",
  "QA",
  "Security",
  "Performance",
  "Refactor",
  "Bugfix",
  "Architecture",
  "Mobile",
];

function normalizeTags(tags: string[]): string[] {
  const uniqueTags = new Set<string>();

  tags.forEach((tag) => {
    const trimmedTag = tag.trim();
    if (trimmedTag) {
      uniqueTags.add(trimmedTag);
    }
  });

  return [...uniqueTags];
}

function parseProjectTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const stringTags = value.filter((tag): tag is string => typeof tag === "string");
  return normalizeTags(stringTags);
}

function isDevelopmentProjectPriority(value: unknown): value is DevelopmentProjectPriority {
  return (
    value === "High" ||
    value === "Medium" ||
    value === "Low"
  );
}

function toDevelopmentProject(value: unknown): DevelopmentProject | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const project = value as Partial<DevelopmentProject> & {
    tags?: unknown;
    priority?: unknown;
  };

  if (
    typeof project.id !== "string" ||
    typeof project.name !== "string" ||
    typeof project.startDate !== "string" ||
    typeof project.deadline !== "string"
  ) {
    return null;
  }

  return (
    {
      id: project.id,
      name: project.name,
      startDate: project.startDate,
      deadline: project.deadline,
      priority: isDevelopmentProjectPriority(project.priority)
        ? project.priority
        : "Medium",
      tags: parseProjectTags(project.tags),
      isCompleted: project.isCompleted === true,
    }
  );
}

export function parseDevelopmentProjects(rawProjects: string | null): DevelopmentProject[] {
  if (!rawProjects) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawProjects) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((project) => toDevelopmentProject(project))
      .filter((project): project is DevelopmentProject => project !== null);
  } catch {
    return [];
  }
}

export function parseDevelopmentTags(rawTags: string | null): string[] {
  if (!rawTags) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawTags) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const stringTags = parsed.filter((tag): tag is string => typeof tag === "string");
    return normalizeTags(stringTags);
  } catch {
    return [];
  }
}

export function getDevelopmentProjectsSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEVELOPMENT_PROJECTS_STORAGE_KEY);
}

export function getDevelopmentProjectsServerSnapshot(): string | null {
  return null;
}

export function getDevelopmentTagsSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEVELOPMENT_TAGS_STORAGE_KEY);
}

export function getDevelopmentTagsServerSnapshot(): string | null {
  return null;
}

export function readDevelopmentProjects(): DevelopmentProject[] {
  const rawProjects = getDevelopmentProjectsSnapshot();
  const projects = parseDevelopmentProjects(rawProjects);

  if (!projects.length && rawProjects && typeof window !== "undefined") {
    window.localStorage.removeItem(DEVELOPMENT_PROJECTS_STORAGE_KEY);
  }

  return projects;
}

export function readDevelopmentTags(): string[] {
  const rawTags = getDevelopmentTagsSnapshot();
  const parsedTags = parseDevelopmentTags(rawTags);

  if (parsedTags.length > 0) {
    return parsedTags;
  }

  if (typeof window !== "undefined") {
    writeDevelopmentTags(DEFAULT_DEVELOPMENT_TAGS);
  }

  return [...DEFAULT_DEVELOPMENT_TAGS];
}

export function writeDevelopmentProjects(projects: DevelopmentProject[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    DEVELOPMENT_PROJECTS_STORAGE_KEY,
    JSON.stringify(projects)
  );
  window.dispatchEvent(new Event(DEVELOPMENT_PROJECTS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("development");
}

export function writeDevelopmentTags(tags: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    DEVELOPMENT_TAGS_STORAGE_KEY,
    JSON.stringify(normalizeTags(tags))
  );
  window.dispatchEvent(new Event(DEVELOPMENT_TAGS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("development");
}

export function subscribeToDevelopmentProjects(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DEVELOPMENT_PROJECTS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEVELOPMENT_PROJECTS_UPDATED_EVENT, handler);
  };
}

export function subscribeToDevelopmentTags(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DEVELOPMENT_TAGS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEVELOPMENT_TAGS_UPDATED_EVENT, handler);
  };
}

export function createDevelopmentProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
