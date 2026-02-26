"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Filter,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
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
  MARKETING_PROJECT_PRIORITY_OPTIONS,
  MarketingProjectPriority,
  parseMarketingProjects,
  parseMarketingTags,
  subscribeToMarketingProjects,
  subscribeToMarketingTags,
  writeMarketingProjects,
  writeMarketingTags,
} from "@/lib/marketing-projects";
import {
  getMarketingTasksServerSnapshot,
  getMarketingTasksSnapshot,
  parseMarketingTasksByProject,
  subscribeToMarketingTasks,
} from "@/lib/marketing-tasks";
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
type ProjectTypeFilter =
  | "All"
  | "Critical project"
  | "Overdue project"
  | "On track project";
type ProjectPriorityFilter = "All" | MarketingProjectPriority;

type MarketingProjectFilters = {
  search: string;
  deadline: ProjectDeadlineFilter;
  person: string;
  type: ProjectTypeFilter;
  priority: ProjectPriorityFilter;
  tags: string[];
};

type ProjectUrgency = {
  status: "Overdue" | "Due today" | "Due soon" | "On track";
  label: string;
};

type ProjectHealth = {
  totalTasks: number;
  openTasks: number;
  doneTasks: number;
  overdueOpenTasks: number;
  highPriorityOpenTasks: number;
  overdueOpenRatio: number;
  isCriticalOverdueLoad: boolean;
};

const createDefaultFilters = (): MarketingProjectFilters => ({
  search: "",
  deadline: "Any",
  person: "All",
  type: "All",
  priority: "All",
  tags: [],
});

const createDefaultProjectHealth = (): ProjectHealth => ({
  totalTasks: 0,
  openTasks: 0,
  doneTasks: 0,
  overdueOpenTasks: 0,
  highPriorityOpenTasks: 0,
  overdueOpenRatio: 0,
  isCriticalOverdueLoad: false,
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
      risk?: string;
    };

    const deadlineOptions: ProjectDeadlineFilter[] = [
      "Any",
      "Overdue",
      "Due today",
      "Next 7 days",
      "Next 30 days",
      "No deadline",
    ];
    const typeOptions: ProjectTypeFilter[] = [
      "All",
      "Critical project",
      "Overdue project",
      "On track project",
    ];
    const priorityOptions: ProjectPriorityFilter[] = [
      "All",
      ...MARKETING_PROJECT_PRIORITY_OPTIONS,
    ];

    const mappedLegacyDeadline: ProjectDeadlineFilter =
      parsed.status === "Overdue"
        ? "Overdue"
        : parsed.status === "Due today"
          ? "Due today"
          : parsed.status === "Due soon"
            ? "Next 7 days"
            : "Any";
    const mappedLegacyType: ProjectTypeFilter =
      parsed.risk === "Critical" || parsed.risk === "High priority tasks"
        ? "Critical project"
        : parsed.risk === "Overdue tasks"
          ? "Overdue project"
          : "All";

    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      deadline: deadlineOptions.includes(parsed.deadline as ProjectDeadlineFilter)
        ? (parsed.deadline as ProjectDeadlineFilter)
        : mappedLegacyDeadline,
      person: typeof parsed.person === "string" ? parsed.person : "All",
      type: typeOptions.includes(parsed.type as ProjectTypeFilter)
        ? (parsed.type as ProjectTypeFilter)
        : mappedLegacyType,
      priority: priorityOptions.includes(parsed.priority as ProjectPriorityFilter)
        ? (parsed.priority as ProjectPriorityFilter)
        : "All",
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

function getProjectPriorityBadgeClasses(priority: MarketingProjectPriority): string {
  if (priority === "High") {
    return "border-red-300 bg-red-100 text-red-700";
  }
  if (priority === "Low") {
    return "border-green-300 bg-green-100 text-green-700";
  }
  return "border-yellow-300 bg-yellow-100 text-yellow-800";
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
  const rawTasksByProject = useSyncExternalStore(
    subscribeToMarketingTasks,
    getMarketingTasksSnapshot,
    getMarketingTasksServerSnapshot
  );

  const projects = parseMarketingProjects(rawProjects);
  const storageTags = parseMarketingTags(rawTags);
  const membersByProject = parseMarketingMembersByProject(rawMembersByProject);
  const tasksByProject = parseMarketingTasksByProject(rawTasksByProject);

  const today = toLocalIsoDate(new Date());
  const todayPlusWeek = addDays(today, 7);
  const todayPlus7 = addDays(today, 7);
  const todayPlus30 = addDays(today, 30);

  const [isCreating, setIsCreating] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [projectPriority, setProjectPriority] =
    useState<MarketingProjectPriority>("Medium");
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

  const projectHealthById = useMemo(() => {
    const healthById = new Map<string, ProjectHealth>();

    projects.forEach((project) => {
      const projectTasks = tasksByProject[project.id] ?? [];
      let openTasks = 0;
      let doneTasks = 0;
      let overdueOpenTasks = 0;
      let highPriorityOpenTasks = 0;

      projectTasks.forEach((task) => {
        const isDone = task.status === "Done";
        if (isDone) {
          doneTasks += 1;
          return;
        }

        openTasks += 1;
        if (task.dueDate && task.dueDate < today) {
          overdueOpenTasks += 1;
        }
        if (task.priority === "High") {
          highPriorityOpenTasks += 1;
        }
      });

      const overdueOpenRatio = openTasks > 0 ? overdueOpenTasks / openTasks : 0;
      const isCriticalOverdueLoad = openTasks > 0 && overdueOpenTasks * 2 >= openTasks;

      healthById.set(project.id, {
        totalTasks: projectTasks.length,
        openTasks,
        doneTasks,
        overdueOpenTasks,
        highPriorityOpenTasks,
        overdueOpenRatio,
        isCriticalOverdueLoad,
      });
    });

    return healthById;
  }, [projects, tasksByProject, today]);

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
    setProjectPriority("Medium");
    setSelectedProjectTags([]);
    setNewTagInput("");
    setDateError("");
    setIsCreating(false);
    setEditingProjectId(null);
  };

  useEffect(() => {
    if (!isCreating) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setProjectName("");
      setStartDate("");
      setDeadline("");
      setProjectPriority("Medium");
      setSelectedProjectTags([]);
      setNewTagInput("");
      setDateError("");
      setIsCreating(false);
      setEditingProjectId(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCreating]);

  const onCreateOpen = () => {
    setIsCreating(true);
    setEditingProjectId(null);
    setProjectName("");
    setStartDate("");
    setDeadline("");
    setProjectPriority("Medium");
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
    setProjectPriority(project.priority);
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
          priority: projectPriority,
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
            priority: projectPriority,
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
        existingProject.priority !== projectPriority
          ? {
              projectId: existingProject.id,
              projectName: trimmedProjectName,
              changedBy: actorName,
              scope: "project" as const,
              action: "updated",
              field: "priority",
              fromValue: existingProject.priority,
              toValue: projectPriority,
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
    const matchingProjects = projects.filter((project) => {
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

      const projectHealth =
        projectHealthById.get(project.id) ?? createDefaultProjectHealth();
      const isOverdueProject =
        !project.isCompleted && Boolean(project.deadline) && project.deadline < today;
      const isOnTrackProject =
        !project.isCompleted && (!project.deadline || project.deadline >= today);

      if (filters.type === "Critical project" && !projectHealth.isCriticalOverdueLoad) {
        return false;
      }
      if (filters.type === "Overdue project" && !isOverdueProject) {
        return false;
      }
      if (filters.type === "On track project" && !isOnTrackProject) {
        return false;
      }

      if (filters.priority !== "All" && project.priority !== filters.priority) {
        return false;
      }

      if (
        filters.tags.length > 0 &&
        !project.tags.some((projectTag) => filters.tags.includes(projectTag))
      ) {
        return false;
      }

      return true;
    });

    return [...matchingProjects].sort((firstProject, secondProject) => {
      const firstHealth =
        projectHealthById.get(firstProject.id) ?? createDefaultProjectHealth();
      const secondHealth =
        projectHealthById.get(secondProject.id) ?? createDefaultProjectHealth();
      if (firstHealth.isCriticalOverdueLoad !== secondHealth.isCriticalOverdueLoad) {
        return firstHealth.isCriticalOverdueLoad ? -1 : 1;
      }
      if (firstHealth.overdueOpenRatio !== secondHealth.overdueOpenRatio) {
        return secondHealth.overdueOpenRatio - firstHealth.overdueOpenRatio;
      }
      if (firstHealth.overdueOpenTasks !== secondHealth.overdueOpenTasks) {
        return secondHealth.overdueOpenTasks - firstHealth.overdueOpenTasks;
      }
      if (firstProject.deadline && secondProject.deadline) {
        return firstProject.deadline.localeCompare(secondProject.deadline);
      }
      if (firstProject.deadline) {
        return -1;
      }
      if (secondProject.deadline) {
        return 1;
      }
      return firstProject.name.localeCompare(secondProject.name);
    });
  }, [
    filters.deadline,
    filters.person,
    filters.priority,
    filters.type,
    filters.search,
    filters.tags,
    membersByProject,
    projectHealthById,
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
    const onTrackCount = projects.filter((project) => {
      if (project.isCompleted) {
        return false;
      }
      return !project.deadline || project.deadline >= today;
    }).length;

    const dueThisWeekCount = projects.filter((project) => {
      if (project.isCompleted || !project.deadline) {
        return false;
      }
      return project.deadline >= today && project.deadline <= todayPlusWeek;
    }).length;

    const criticalProjects = projects.filter((project) => {
      const health = projectHealthById.get(project.id) ?? createDefaultProjectHealth();
      return health.isCriticalOverdueLoad;
    }).length;
    const completionRate =
      projects.length === 0
        ? 0
        : Math.round(
            (projects.reduce((sum, project) => {
              const health =
                projectHealthById.get(project.id) ?? createDefaultProjectHealth();
              if (health.totalTasks === 0) {
                return sum;
              }
              return sum + health.doneTasks / health.totalTasks;
            }, 0) /
              projects.length) *
              100
          );

    return {
      total: projects.length,
      overdue: overdueCount,
      onTrack: onTrackCount,
      dueThisWeek: dueThisWeekCount,
      criticalProjects,
      completionRate,
    };
  }, [projectHealthById, projects, today, todayPlusWeek]);

  const projectFormUrgency = useMemo<ProjectUrgency>(() => {
    if (!deadline) {
      return { status: "On track", label: "No deadline" };
    }

    return getProjectUrgency(
      {
        id: "preview",
        name: projectName,
        startDate,
        deadline,
        priority: projectPriority,
        tags: selectedProjectTags,
        isCompleted: false,
      },
      today
    );
  }, [deadline, projectName, projectPriority, selectedProjectTags, startDate, today]);

  const projectFormDurationDays = useMemo(() => {
    if (!startDate || !deadline || deadline < startDate) {
      return null;
    }

    return getDaysDiff(startDate, deadline) + 1;
  }, [deadline, startDate]);

  return (
    <section className="w-full max-w-7xl space-y-4">
      <div className="rounded-2xl border border-black/10 bg-gradient-to-b from-white to-black/[0.02] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Marketing Portfolio</h1>
            <p className="mt-1 text-sm text-black/60">
              Prioritize risk first. {stats.criticalProjects} critical project
              {stats.criticalProjects === 1 ? "" : "s"} need intervention.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCreateOpen}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + New Project
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
            <p className="text-xs text-black/55">Total projects</p>
            <p className="mt-1 text-2xl font-semibold">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-2">
            <p className="inline-flex items-center gap-1 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Critical projects
            </p>
            <p className="mt-1 text-2xl font-semibold text-red-800">
              {stats.criticalProjects}
            </p>
          </div>
          <div className="rounded-lg border border-yellow-200 bg-yellow-50/80 px-3 py-2">
            <p className="text-xs text-yellow-700">Overdue projects</p>
            <p className="mt-1 text-2xl font-semibold text-yellow-800">{stats.overdue}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2">
            <p className="text-xs text-emerald-700">On track projects</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-800">{stats.onTrack}</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50/70 px-3 py-2">
            <p className="inline-flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Completion rate
            </p>
            <p className="mt-1 text-2xl font-semibold text-green-800">
              {stats.completionRate}%
            </p>
          </div>
          <div className="rounded-lg border border-yellow-200 bg-yellow-50/80 px-3 py-2">
            <p className="text-xs text-yellow-700">Due this week</p>
            <p className="mt-1 text-2xl font-semibold text-yellow-800">{stats.dueThisWeek}</p>
          </div>
        </div>
      </div>

      {isCreating ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={resetForm}
        >
          <form
            onSubmit={onSubmitProject}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-4xl overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-black/10 bg-black/[0.02] px-5 py-4">
              <div>
                <p className="inline-flex items-center gap-1 text-xs font-medium text-black/60">
                  <Sparkles className="h-3.5 w-3.5" />
                  {editingProjectId
                    ? "Update project setup"
                    : "Create a new marketing initiative"}
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  {editingProjectId ? "Edit Project" : "New Project"}
                </h2>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-black/20 p-2 hover:bg-black/5"
                aria-label="Close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4">
                <label className="block text-sm">
                  <span className="font-medium">Project Name</span>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    className="mt-1.5 block h-10 w-full rounded-md border border-black/20 px-3"
                    placeholder="Campaign launch Q2"
                    required
                    autoFocus
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block text-sm">
                    <span className="font-medium">Start Date</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setStartDate(nextValue);
                        setDateError(validateDateRange(nextValue, deadline));
                      }}
                      className="mt-1.5 block h-10 w-full rounded-md border border-black/20 px-3"
                      required
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium">Deadline</span>
                    <input
                      type="date"
                      value={deadline}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDeadline(nextValue);
                        setDateError(validateDateRange(startDate, nextValue));
                      }}
                      className="mt-1.5 block h-10 w-full rounded-md border border-black/20 px-3"
                      required
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium">Priority</span>
                    <select
                      value={projectPriority}
                      onChange={(event) =>
                        setProjectPriority(event.target.value as MarketingProjectPriority)
                      }
                      className="mt-1.5 block h-10 w-full rounded-md border border-black/20 px-3"
                    >
                      {MARKETING_PROJECT_PRIORITY_OPTIONS.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {dateError ? <p className="text-xs text-red-600">{dateError}</p> : null}

                <div className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
                  <p className="text-sm font-medium">Tags</p>
                  <div className="mt-2 max-h-36 overflow-y-auto pr-1">
                    <div className="flex flex-wrap gap-2">
                      {allTagOptions.map((tag) => {
                        const isSelected = selectedProjectTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => onToggleProjectTag(tag)}
                            className={`rounded-full border px-2.5 py-1 text-xs ${
                              isSelected
                                ? "border-black bg-black text-white"
                                : "border-black/20 bg-white hover:bg-black/5"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(event) => setNewTagInput(event.target.value)}
                    onKeyDown={onTagInputKeyDown}
                    placeholder="Create tag and press Enter"
                    className="mt-3 h-10 w-full rounded-md border border-black/20 px-3 text-sm"
                  />
                </div>
              </div>

              <aside className="space-y-3 rounded-lg border border-black/10 bg-black/[0.02] p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-black/55">
                  Project Preview
                </p>
                <p className="text-lg font-semibold">
                  {projectName.trim() || "Untitled project"}
                </p>
                <div className="space-y-1 text-sm text-black/70">
                  <p>Start: {startDate || "-"}</p>
                  <p>Deadline: {deadline || "-"}</p>
                  <p>Priority: {projectPriority}</p>
                  <p>
                    Duration:{" "}
                    {projectFormDurationDays !== null
                      ? `${projectFormDurationDays} day${
                          projectFormDurationDays === 1 ? "" : "s"
                        }`
                      : "-"}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-xs ${
                    projectFormUrgency.status === "Overdue"
                      ? "border-red-300 bg-red-100 text-red-700"
                      : projectFormUrgency.status === "Due today"
                        ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                        : projectFormUrgency.status === "Due soon"
                          ? "border-yellow-200 bg-yellow-50 text-yellow-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {projectFormUrgency.label}
                </span>
                <div>
                  <p className="text-xs font-medium text-black/60">Selected tags</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedProjectTags.length === 0 ? (
                      <span className="text-xs text-black/50">No tags selected</span>
                    ) : (
                      selectedProjectTags.map((tag) => (
                        <span
                          key={`preview-${tag}`}
                          className="inline-flex items-center rounded-full border border-black/15 bg-white px-2 py-0.5 text-xs"
                        >
                          {tag}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </aside>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 px-5 py-4">
              <p className="text-xs text-black/55">Esc to close</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  {editingProjectId ? "Save Changes" : "Create Project"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      <div className="rounded-xl border border-black/10 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label className="block text-xs font-medium text-black/60 xl:col-span-2">
            Search
            <input
              type="text"
              value={filters.search}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  search: event.target.value,
                }))
              }
              placeholder="Project name"
              className="mt-1 h-9 w-full rounded-md border border-black/20 px-3 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-black/60">
            Deadline
            <select
              value={filters.deadline}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  deadline: event.target.value as ProjectDeadlineFilter,
                }))
              }
              className="mt-1 h-9 w-full rounded-md border border-black/20 bg-white px-2 text-sm"
            >
              <option value="Any">Any</option>
              <option value="Overdue">Overdue</option>
              <option value="Due today">Due today</option>
              <option value="Next 7 days">Next 7 days</option>
              <option value="Next 30 days">Next 30 days</option>
              <option value="No deadline">No deadline</option>
            </select>
          </label>

          <label className="block text-xs font-medium text-black/60">
            People
            <select
              value={filters.person}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  person: event.target.value,
                }))
              }
              className="mt-1 h-9 w-full rounded-md border border-black/20 bg-white px-2 text-sm"
            >
              <option value="All">All</option>
              {peopleOptions.map((person) => (
                <option key={`person-${person}`} value={person}>
                  {person}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-black/60">
            Type
            <select
              value={filters.type}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  type: event.target.value as ProjectTypeFilter,
                }))
              }
              className="mt-1 h-9 w-full rounded-md border border-black/20 bg-white px-2 text-sm"
            >
              <option value="All">All</option>
              <option value="Critical project">Critical project</option>
              <option value="Overdue project">Overdue project</option>
              <option value="On track project">On track project</option>
            </select>
          </label>

          <label className="block text-xs font-medium text-black/60">
            Priority
            <select
              value={filters.priority}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  priority: event.target.value as ProjectPriorityFilter,
                }))
              }
              className="mt-1 h-9 w-full rounded-md border border-black/20 bg-white px-2 text-sm"
            >
              <option value="All">All</option>
              {MARKETING_PROJECT_PRIORITY_OPTIONS.map((priority) => (
                <option key={`filter-priority-${priority}`} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <div className="xl:col-span-6">
            <p className="text-xs font-medium text-black/60">Tags</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <details className="relative w-full max-w-[220px]">
                <summary className="inline-flex h-9 w-full list-none cursor-pointer items-center justify-between rounded-md border border-black/20 bg-white px-3 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5" />
                    Select tags
                  </span>
                  <span className="text-xs text-black/60">
                    {filters.tags.length > 0 ? `${filters.tags.length} selected` : "All"}
                  </span>
                </summary>
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-black/15 bg-white p-2 shadow-lg">
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
                className="ml-auto h-9 shrink-0 rounded-md border border-black/20 px-3 text-xs font-medium hover:bg-black/5"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {filters.tags.length > 0
            ? filters.tags.map((tag) => (
                <span
                  key={`active-filter-${tag}`}
                  className="inline-flex rounded-full border border-black/15 bg-black/[0.03] px-2 py-0.5 text-xs text-black/70"
                >
                  {tag}
                </span>
              ))
            : null}
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
              const projectHealth =
                projectHealthById.get(project.id) ?? createDefaultProjectHealth();
              const completionPercent =
                projectHealth.totalTasks > 0
                  ? Math.round((projectHealth.doneTasks / projectHealth.totalTasks) * 100)
                  : 0;
              const hasCriticalTaskDebt =
                !isCompleted && projectHealth.isCriticalOverdueLoad;
              const overdueRatioPercent = Math.round(projectHealth.overdueOpenRatio * 100);
              const teamSize = (membersByProject[project.id] ?? []).length;
              const cardClasses = hasCriticalTaskDebt
                ? "border-red-300 bg-red-50/75 ring-1 ring-red-200"
                : isCompleted
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
                      <div className="min-w-[240px] flex-1 space-y-2">
                        <p className="text-base font-semibold">{project.name}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-black/70">
                          <span className="inline-flex items-center gap-1 rounded-full border border-black/15 px-2 py-0.5">
                            <CalendarDays className="h-3.5 w-3.5" />
                            Start {project.startDate}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-black/15 px-2 py-0.5">
                            Deadline {project.deadline || "No deadline"}
                          </span>
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 ${getProjectPriorityBadgeClasses(
                              project.priority
                            )}`}
                          >
                            Priority {project.priority}
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
                          {hasCriticalTaskDebt ? (
                            <span className="inline-flex rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-red-700">
                              Critical overdue load
                            </span>
                          ) : null}
                        </div>

                        <div className="rounded-lg border border-black/10 bg-white/70 p-2">
                          <div className="flex items-center justify-between text-xs text-black/60">
                            <span>Execution progress</span>
                            <span>{completionPercent}%</span>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-black/10">
                            <div
                              className={`h-full rounded-full ${
                                hasCriticalTaskDebt ? "bg-red-500" : "bg-black"
                              }`}
                              style={{
                                width: `${Math.max(0, Math.min(100, completionPercent))}%`,
                              }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-black/70">
                            <span>{projectHealth.totalTasks} total tasks</span>
                            <span>{projectHealth.openTasks} open</span>
                            <span className="text-red-700">
                              {projectHealth.overdueOpenTasks} overdue
                            </span>
                            <span>{projectHealth.highPriorityOpenTasks} high open</span>
                            <span>{teamSize} team</span>
                            {projectHealth.openTasks > 0 ? (
                              <span className="font-medium">
                                Overdue ratio {overdueRatioPercent}%
                              </span>
                            ) : null}
                          </div>
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
