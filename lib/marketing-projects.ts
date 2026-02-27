import { scheduleWorkstreamStateSync } from "@/lib/supabase/workstream-state-client";
export type MarketingProjectPriority = "High" | "Medium" | "Low";

export const MARKETING_PROJECT_PRIORITY_OPTIONS: MarketingProjectPriority[] = [
  "High",
  "Medium",
  "Low",
];

export type MarketingProject = {
  id: string;
  name: string;
  startDate: string;
  deadline: string;
  priority: MarketingProjectPriority;
  tags: string[];
  isCompleted: boolean;
};

export const MARKETING_PROJECTS_STORAGE_KEY = "internal-system-marketing-projects";
export const MARKETING_TAGS_STORAGE_KEY = "internal-system-marketing-tags";
const MARKETING_PROJECTS_UPDATED_EVENT = "internal-system-marketing-projects-updated";
const MARKETING_TAGS_UPDATED_EVENT = "internal-system-marketing-tags-updated";

export const DEFAULT_MARKETING_TAGS = [
  "Social Media",
  "Paid Ads",
  "Content",
  "Branding",
  "SEO",
  "Email",
  "Influencer",
  "Analytics",
  "Funnel",
  "Strategy",
  "Launch",
  "Website",
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

function isMarketingProjectPriority(value: unknown): value is MarketingProjectPriority {
  return (
    value === "High" ||
    value === "Medium" ||
    value === "Low"
  );
}

function toMarketingProject(value: unknown): MarketingProject | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const project = value as Partial<MarketingProject> & {
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
      priority: isMarketingProjectPriority(project.priority)
        ? project.priority
        : "Medium",
      tags: parseProjectTags(project.tags),
      isCompleted: project.isCompleted === true,
    }
  );
}

export function parseMarketingProjects(rawProjects: string | null): MarketingProject[] {
  if (!rawProjects) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawProjects) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((project) => toMarketingProject(project))
      .filter((project): project is MarketingProject => project !== null);
  } catch {
    return [];
  }
}

export function parseMarketingTags(rawTags: string | null): string[] {
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

export function getMarketingProjectsSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(MARKETING_PROJECTS_STORAGE_KEY);
}

export function getMarketingProjectsServerSnapshot(): string | null {
  return null;
}

export function getMarketingTagsSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(MARKETING_TAGS_STORAGE_KEY);
}

export function getMarketingTagsServerSnapshot(): string | null {
  return null;
}

export function readMarketingProjects(): MarketingProject[] {
  const rawProjects = getMarketingProjectsSnapshot();
  const projects = parseMarketingProjects(rawProjects);

  if (!projects.length && rawProjects && typeof window !== "undefined") {
    window.localStorage.removeItem(MARKETING_PROJECTS_STORAGE_KEY);
  }

  return projects;
}

export function readMarketingTags(): string[] {
  const rawTags = getMarketingTagsSnapshot();
  const parsedTags = parseMarketingTags(rawTags);

  if (parsedTags.length > 0) {
    return parsedTags;
  }

  if (typeof window !== "undefined") {
    writeMarketingTags(DEFAULT_MARKETING_TAGS);
  }

  return [...DEFAULT_MARKETING_TAGS];
}

export function writeMarketingProjects(projects: MarketingProject[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    MARKETING_PROJECTS_STORAGE_KEY,
    JSON.stringify(projects)
  );
  window.dispatchEvent(new Event(MARKETING_PROJECTS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("marketing");
}

export function writeMarketingTags(tags: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    MARKETING_TAGS_STORAGE_KEY,
    JSON.stringify(normalizeTags(tags))
  );
  window.dispatchEvent(new Event(MARKETING_TAGS_UPDATED_EVENT));
  scheduleWorkstreamStateSync("marketing");
}

export function subscribeToMarketingProjects(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(MARKETING_PROJECTS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(MARKETING_PROJECTS_UPDATED_EVENT, handler);
  };
}

export function subscribeToMarketingTags(
  onStoreChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(MARKETING_TAGS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(MARKETING_TAGS_UPDATED_EVENT, handler);
  };
}

export function createMarketingProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
