"use client";

import Link from "next/link";
import { CalendarDays, Filter, Tag } from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getMarketingMembersServerSnapshot,
  getMarketingMembersSnapshot,
  parseMarketingMembersByProject,
  subscribeToMarketingMembers,
} from "@/lib/marketing-members";
import {
  createMarketingProjectId,
  DEFAULT_MARKETING_TAGS,
  getMarketingProjectsServerSnapshot,
  getMarketingProjectsSnapshot,
  getMarketingTagsServerSnapshot,
  getMarketingTagsSnapshot,
  MarketingProject,
  parseMarketingProjects,
  parseMarketingTags,
  subscribeToMarketingProjects,
  subscribeToMarketingTags,
  writeMarketingProjects,
  writeMarketingTags,
} from "@/lib/marketing-projects";
import { readDemoUser } from "@/lib/demo-user";
import {
  appendMarketingProjectCommitLogs,
  createIndiaDateTimeLabel,
} from "@/lib/marketing-project-commits";

const PROJECT_FILTERS_STORAGE_KEY = "internal-system-marketing-project-filters";
const dueSoonDays = 3;

type ProjectDeadlineFilter =
  | "Any"
  | "Overdue"
  | "Due today"
  | "Next 7 days"
  | "Next 30 days"
  | "No deadline";

type MarketingProjectFilters = {
  search: string;
  deadline: ProjectDeadlineFilter;
  person: string;
  tags: string[];
};

type ProjectUrgency = {
  status: "Overdue" | "Due today" | "Due soon" | "On track";
  label: string;
};

const createDefaultFilters = (): MarketingProjectFilters => ({
  search: "",
  deadline: "Any",
  person: "All",
  tags: [],
});

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
}

function getDaysDiff(fromDate: string, toDate: string): number {
  const start = new Date(`${fromDate}T00:00:00`).getTime();
  const end = new Date(`${toDate}T00:00:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

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

function parseFilters(rawFilters: string | null): MarketingProjectFilters {
  if (!rawFilters) {
    return createDefaultFilters();
  }

  try {
    const parsed = JSON.parse(rawFilters) as Partial<MarketingProjectFilters> & {
      status?: string;
    };

    const deadlineOptions: ProjectDeadlineFilter[] = [
      "Any",
      "Overdue",
      "Due today",
      "Next 7 days",
      "Next 30 days",
      "No deadline",
    ];

    const mappedLegacyDeadline: ProjectDeadlineFilter =
      parsed.status === "Overdue"
        ? "Overdue"
        : parsed.status === "Due today"
          ? "Due today"
          : parsed.status === "Due soon"
            ? "Next 7 days"
            : "Any";

    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      deadline: deadlineOptions.includes(parsed.deadline as ProjectDeadlineFilter)
        ? (parsed.deadline as ProjectDeadlineFilter)
        : mappedLegacyDeadline,
      person: typeof parsed.person === "string" ? parsed.person : "All",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
    };
  } catch {
    return createDefaultFilters();
  }
}

function getProjectUrgency(project: MarketingProject, today: string): ProjectUrgency {
  if (!project.deadline) {
    return { status: "On track", label: "No deadline" };
  }

  if (project.deadline < today) {
    return { status: "Overdue", label: "Overdue" };
  }
  if (project.deadline === today) {
    return { status: "Due today", label: "Due today" };
  }

  const dayDiff = getDaysDiff(today, project.deadline);
  if (dayDiff > 0 && dayDiff <= dueSoonDays) {
    return {
      status: "Due soon",
      label: `Due in ${dayDiff} day${dayDiff === 1 ? "" : "s"}`,
    };
  }

  return { status: "On track", label: "On track" };
}

function matchesDeadlineFilter(
  deadline: string,
  filter: ProjectDeadlineFilter,
  today: string,
  todayPlus7: string,
  todayPlus30: string
): boolean {
  if (filter === "Any") {
    return true;
  }

  if (!deadline) {
    return filter === "No deadline";
  }

  if (filter === "No deadline") {
    return false;
  }
  if (filter === "Overdue") {
    return deadline < today;
  }
  if (filter === "Due today") {
    return deadline === today;
  }
  if (filter === "Next 7 days") {
    return deadline >= today && deadline <= todayPlus7;
  }
  if (filter === "Next 30 days") {
    return deadline >= today && deadline <= todayPlus30;
  }

  return true;
}

export default function MarketingPage() {
  const rawProjects = useSyncExternalStore(
    subscribeToMarketingProjects,
    getMarketingProjectsSnapshot,
    getMarketingProjectsServerSnapshot
  );
  const rawTags = useSyncExternalStore(
    subscribeToMarketingTags,
    getMarketingTagsSnapshot,
    getMarketingTagsServerSnapshot
  );
  const rawMembersByProject = useSyncExternalStore(
    subscribeToMarketingMembers,
    getMarketingMembersSnapshot,
    getMarketingMembersServerSnapshot
  );

  const projects = parseMarketingProjects(rawProjects);
  const storageTags = parseMarketingTags(rawTags);
  const membersByProject = parseMarketingMembersByProject(rawMembersByProject);

  const today = toLocalIsoDate(new Date());
  const todayPlusWeek = addDays(today, 7);
  const todayPlus7 = addDays(today, 7);
  const todayPlus30 = addDays(today, 30);

  const [isCreating, setIsCreating] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [selectedProjectTags, setSelectedProjectTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [dateError, setDateError] = useState("");
  const [filters, setFilters] = useState<MarketingProjectFilters>(() => {
    if (typeof window === "undefined") {
      return createDefaultFilters();
    }

    return parseFilters(window.localStorage.getItem(PROJECT_FILTERS_STORAGE_KEY));
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!storageTags.length) {
      writeMarketingTags(DEFAULT_MARKETING_TAGS);
    }
  }, [storageTags.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PROJECT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const allTagOptions = useMemo(() => {
    return normalizeTags([
      ...storageTags,
      ...projects.flatMap((project) => project.tags),
    ]);
  }, [projects, storageTags]);

  const peopleOptions = useMemo(() => {
    const uniquePeople = new Set<string>();
    Object.values(membersByProject).forEach((members) => {
      members.forEach((member) => {
        const trimmedName = member.name.trim();
        if (trimmedName) {
          uniquePeople.add(trimmedName);
        }
      });
    });

    return [...uniquePeople].sort((a, b) => a.localeCompare(b));
  }, [membersByProject]);

  const validateDateRange = (projectStartDate: string, projectDeadline: string): string => {
    if (!projectStartDate || !projectDeadline) {
      return "";
    }
    if (projectDeadline < projectStartDate) {
      return "Deadline cannot be before Start Date.";
    }
    return "";
  };

  const resetForm = () => {
    setProjectName("");
    setStartDate("");
    setDeadline("");
    setSelectedProjectTags([]);
    setNewTagInput("");
    setDateError("");
    setIsCreating(false);
    setEditingProjectId(null);
  };

  const onCreateOpen = () => {
    setIsCreating(true);
    setEditingProjectId(null);
    setProjectName("");
    setStartDate("");
    setDeadline("");
    setSelectedProjectTags([]);
    setDateError("");
    setNewTagInput("");
  };

  const onEditOpen = (project: MarketingProject) => {
    setIsCreating(true);
    setEditingProjectId(project.id);
    setProjectName(project.name);
    setStartDate(project.startDate);
    setDeadline(project.deadline);
    setSelectedProjectTags(project.tags);
    setDateError("");
    setNewTagInput("");
  };

  const onSubmitProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedProjectName = projectName.trim();
    const validationError = validateDateRange(startDate, deadline);
    setDateError(validationError);

    if (!trimmedProjectName || !startDate || !deadline || validationError) {
      return;
    }

    if (!editingProjectId) {
      writeMarketingProjects([
        ...projects,
        {
          id: createMarketingProjectId(),
          name: trimmedProjectName,
          startDate,
          deadline,
          tags: normalizeTags(selectedProjectTags),
          isCompleted: false,
        },
      ]);
      resetForm();
      return;
    }

    const existingProject = projects.find((project) => project.id === editingProjectId);
    const updatedProjects = projects.map((project) =>
      project.id === editingProjectId
        ? {
            ...project,
            name: trimmedProjectName,
            startDate,
            deadline,
            tags: normalizeTags(selectedProjectTags),
          }
        : project
    );
    writeMarketingProjects(updatedProjects);

    if (existingProject) {
      const actorName = readDemoUser()?.name ?? "Unknown user";
      const changedAt = new Date();
      const changedAtIso = changedAt.toISOString();
      const changedAtIndia = createIndiaDateTimeLabel(changedAt);
      const previousTagsLabel = normalizeTags(existingProject.tags).join(", ");
      const nextTagsLabel = normalizeTags(selectedProjectTags).join(", ");
      const nextCommitLogs = [
        existingProject.name !== trimmedProjectName
          ? {
              projectId: existingProject.id,
              projectName: trimmedProjectName,
              changedBy: actorName,
              scope: "project" as const,
              action: "updated",
              field: "name",
              fromValue: existingProject.name,
              toValue: trimmedProjectName,
              changedAtIso,
              changedAtIndia,
            }
          : null,
        existingProject.startDate !== startDate
          ? {
              projectId: existingProject.id,
              projectName: trimmedProjectName,
              changedBy: actorName,
              scope: "project" as const,
              action: "updated",
              field: "startDate" as const,
              fromValue: existingProject.startDate,
              toValue: startDate,
              changedAtIso,
              changedAtIndia,
            }
          : null,
        existingProject.deadline !== deadline
          ? {
              projectId: existingProject.id,
              projectName: trimmedProjectName,
              changedBy: actorName,
              scope: "project" as const,
              action: "updated",
              field: "deadline" as const,
              fromValue: existingProject.deadline,
              toValue: deadline,
              changedAtIso,
              changedAtIndia,
            }
          : null,
        previousTagsLabel !== nextTagsLabel
          ? {
              projectId: existingProject.id,
              projectName: trimmedProjectName,
              changedBy: actorName,
              scope: "project" as const,
              action: "updated",
              field: "tags",
              fromValue: previousTagsLabel || "None",
              toValue: nextTagsLabel || "None",
              changedAtIso,
              changedAtIndia,
            }
          : null,
      ].filter((logEntry) => logEntry !== null);

      appendMarketingProjectCommitLogs(nextCommitLogs);
    }

    resetForm();
  };

  const upsertTag = (rawTag: string): string | null => {
    const trimmedTag = rawTag.trim();
    if (!trimmedTag) {
      return null;
    }

    const existingTag = allTagOptions.find(
      (tagOption) => tagOption.toLowerCase() === trimmedTag.toLowerCase()
    );
    if (existingTag) {
      return existingTag;
    }

    const nextTags = normalizeTags([...allTagOptions, trimmedTag]);
    writeMarketingTags(nextTags);
    return trimmedTag;
  };

  const onTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const savedTag = upsertTag(newTagInput);
    if (!savedTag) {
      return;
    }

    setSelectedProjectTags((currentTags) =>
      currentTags.includes(savedTag) ? currentTags : [...currentTags, savedTag]
    );
    setNewTagInput("");
  };

  const onToggleProjectTag = (tag: string) => {
    setSelectedProjectTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    );
  };

  const onToggleFilterTag = (tag: string) => {
    setFilters((currentFilters) => ({
      ...currentFilters,
      tags: currentFilters.tags.includes(tag)
        ? currentFilters.tags.filter((currentTag) => currentTag !== tag)
        : [...currentFilters.tags, tag],
    }));
  };

  const filteredProjects = useMemo(() => {
    const searchQuery = filters.search.trim().toLowerCase();

    return projects.filter((project) => {
      if (searchQuery && !project.name.toLowerCase().includes(searchQuery)) {
        return false;
      }

      if (
        !matchesDeadlineFilter(
          project.deadline,
          filters.deadline,
          today,
          todayPlus7,
          todayPlus30
        )
      ) {
        return false;
      }

      if (filters.person !== "All") {
        const projectMembers = membersByProject[project.id] ?? [];
        if (!projectMembers.some((member) => member.name === filters.person)) {
          return false;
        }
      }

      if (
        filters.tags.length > 0 &&
        !project.tags.some((projectTag) => filters.tags.includes(projectTag))
      ) {
        return false;
      }

      return true;
    });
  }, [
    filters.deadline,
    filters.person,
    filters.search,
    filters.tags,
    membersByProject,
    projects,
    today,
    todayPlus30,
    todayPlus7,
  ]);

  const stats = useMemo(() => {
    const overdueCount = projects.filter((project) => {
      if (project.isCompleted || !project.deadline) {
        return false;
      }
      return project.deadline < today;
    }).length;

    const dueThisWeekCount = projects.filter((project) => {
      if (project.isCompleted || !project.deadline) {
        return false;
      }
      return project.deadline >= today && project.deadline <= todayPlusWeek;
    }).length;

    return {
      total: projects.length,
      overdue: overdueCount,
      dueThisWeek: dueThisWeekCount,
    };
  }, [projects, today, todayPlusWeek]);

  return (
    <section className="w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Marketing</h1>
        <button
          type="button"
          onClick={onCreateOpen}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + New Project
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
          <p className="text-xs text-black/60">Total projects</p>
          <p className="mt-1 text-2xl font-semibold">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs text-red-700">Overdue projects</p>
          <p className="mt-1 text-2xl font-semibold text-red-800">{stats.overdue}</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          <p className="text-xs text-yellow-700">Due this week</p>
          <p className="mt-1 text-2xl font-semibold text-yellow-800">{stats.dueThisWeek}</p>
        </div>
      </div>

      {isCreating ? (
        <form
          onSubmit={onSubmitProject}
          className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block">Project Name</span>
              <input
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="mt-1 block w-full rounded-md border border-black/20 px-3 py-2"
                required
              />
            </label>
            <label className="text-sm">
              <span className="block">Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setStartDate(nextValue);
                  setDateError(validateDateRange(nextValue, deadline));
                }}
                className="mt-1 block h-10 w-full rounded-md border border-black/20 px-3 py-2"
                required
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block">Deadline</span>
              <input
                type="date"
                value={deadline}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDeadline(nextValue);
                  setDateError(validateDateRange(startDate, nextValue));
                }}
                className="mt-1 block h-10 w-full rounded-md border border-black/20 px-3 py-2 sm:max-w-xs"
                required
              />
              {dateError ? <p className="mt-1 text-xs text-red-600">{dateError}</p> : null}
            </label>

            <div className="text-sm sm:col-span-2">
              Tags
              <details className="relative mt-1">
                <summary className="list-none cursor-pointer rounded-md border border-black/20 px-3 py-2">
                  {selectedProjectTags.length > 0
                    ? `${selectedProjectTags.length} selected`
                    : "Select tags"}
                </summary>
                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-black/15 bg-white p-2 shadow-lg">
                  <div className="grid gap-1">
                    {allTagOptions.map((tag) => (
                      <label key={tag} className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedProjectTags.includes(tag)}
                          onChange={() => onToggleProjectTag(tag)}
                        />
                        {tag}
                      </label>
                    ))}
                  </div>
                </div>
              </details>

              <input
                type="text"
                value={newTagInput}
                onChange={(event) => setNewTagInput(event.target.value)}
                onKeyDown={onTagInputKeyDown}
                placeholder="Create new tag and press Enter"
                className="mt-2 w-full rounded-md border border-black/20 px-3 py-2"
              />

              {selectedProjectTags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedProjectTags.map((tag) => (
                    <span
                      key={`selected-${tag}`}
                      className="inline-flex items-center rounded-full border border-black/15 bg-black/[0.03] px-2 py-0.5 text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {editingProjectId ? "Save" : "Create"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="rounded-xl border border-black/10 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={filters.search}
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                search: event.target.value,
              }))
            }
            placeholder="Search projects..."
            className="h-9 w-52 rounded-md border border-black/20 px-3 text-sm"
          />

          <select
            value={filters.deadline}
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                deadline: event.target.value as ProjectDeadlineFilter,
              }))
            }
            className="h-9 w-36 rounded-md border border-black/20 px-2 text-sm"
          >
            <option value="Any">Any</option>
            <option value="Overdue">Overdue</option>
            <option value="Due today">Due today</option>
            <option value="Next 7 days">Next 7 days</option>
            <option value="Next 30 days">Next 30 days</option>
            <option value="No deadline">No deadline</option>
          </select>

          <select
            value={filters.person}
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                person: event.target.value,
              }))
            }
            className="h-9 w-40 rounded-md border border-black/20 px-2 text-sm"
          >
            <option value="All">All</option>
            {peopleOptions.map((person) => (
              <option key={`person-${person}`} value={person}>
                {person}
              </option>
            ))}
          </select>

          <details className="relative">
            <summary className="inline-flex h-9 list-none cursor-pointer items-center gap-2 rounded-md border border-black/20 px-3 text-sm">
              <Filter className="h-3.5 w-3.5" />
              Tags {filters.tags.length > 0 ? `(${filters.tags.length})` : ""}
            </summary>
            <div className="absolute z-20 mt-1 max-h-56 w-56 overflow-auto rounded-md border border-black/15 bg-white p-2 shadow-lg">
              {allTagOptions.map((tag) => (
                <label key={`filter-${tag}`} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.tags.includes(tag)}
                    onChange={() => onToggleFilterTag(tag)}
                  />
                  {tag}
                </label>
              ))}
            </div>
          </details>

          <button
            type="button"
            onClick={() => setFilters(createDefaultFilters())}
            className="ml-auto h-9 rounded-md border border-black/20 px-3 text-sm hover:bg-black/5"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-black/10">
        {filteredProjects.length === 0 ? (
          <p className="p-4 text-sm text-black/70">No projects match current filters</p>
        ) : (
          <ul className="divide-y divide-black/10">
            {filteredProjects.map((project) => {
              const urgency = getProjectUrgency(project, today);
              const isCompleted = project.isCompleted;
              const hasDeadline = Boolean(project.deadline);
              const cardClasses = isCompleted
                ? "border-black/10 bg-white"
                : !hasDeadline
                  ? "border-black/10 bg-white"
                  : urgency.status === "Overdue"
                    ? "border-red-300 bg-red-50/40"
                    : urgency.status === "Due today"
                      ? "border-yellow-300 bg-yellow-50/40"
                      : urgency.status === "Due soon"
                        ? "border-black/10 border-l-4 border-l-yellow-300 bg-white"
                        : "border-black/10 bg-white";
              const visibleTags = project.tags.slice(0, 3);
              const extraTagCount = Math.max(0, project.tags.length - visibleTags.length);

              return (
                <li key={project.id} className="p-4">
                  <div
                    className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${cardClasses}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <p className="text-base font-semibold">{project.name}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-black/70">
                          <span className="inline-flex items-center gap-1 rounded-full border border-black/15 px-2 py-0.5">
                            <CalendarDays className="h-3.5 w-3.5" />
                            Start {project.startDate}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-black/15 px-2 py-0.5">
                            Deadline {project.deadline || "No deadline"}
                          </span>
                          {!isCompleted ? (
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 ${
                                !hasDeadline
                                  ? "border-black/15 bg-black/[0.03] text-black/70"
                                  : urgency.status === "Overdue"
                                    ? "border-red-300 bg-red-100 text-red-700"
                                    : urgency.status === "Due today"
                                      ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                                      : urgency.status === "Due soon"
                                        ? "border-yellow-200 bg-yellow-50 text-yellow-800"
                                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {urgency.label}
                            </span>
                          ) : null}
                        </div>

                        {project.tags.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {visibleTags.map((tag) => (
                              <span
                                key={`${project.id}-${tag}`}
                                className="inline-flex items-center gap-1 rounded-full border border-black/15 bg-black/[0.03] px-2 py-0.5 text-xs"
                              >
                                <Tag className="h-3 w-3" />
                                {tag}
                              </span>
                            ))}
                            {extraTagCount > 0 ? (
                              <span className="text-xs text-black/60">+{extraTagCount} more</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEditOpen(project)}
                          className="rounded-md border border-black/20 px-3 py-2 text-sm font-medium hover:bg-black/5"
                        >
                          Edit
                        </button>
                        <Link
                          href={`/marketing/projects/${project.id}`}
                          className="rounded-md border border-black/20 px-3 py-2 text-sm font-medium hover:bg-black/5"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
