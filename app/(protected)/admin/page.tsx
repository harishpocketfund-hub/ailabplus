"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  ClipboardList,
  Flame,
  FolderKanban,
  Gauge,
  Maximize2,
  MessageSquare,
  SendHorizontal,
  Tags,
  TrendingUp,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getMarketingProjectsServerSnapshot,
  getMarketingProjectsSnapshot,
  parseMarketingProjects,
  subscribeToMarketingProjects,
} from "@/lib/marketing-projects";
import {
  getMarketingTasksServerSnapshot,
  getMarketingTasksSnapshot,
  parseMarketingTasksByProject,
  subscribeToMarketingTasks,
} from "@/lib/marketing-tasks";
import {
  getMarketingMembersServerSnapshot,
  getMarketingMembersSnapshot,
  parseMarketingMembersByProject,
  subscribeToMarketingMembers,
} from "@/lib/marketing-members";
import {
  getMarketingProjectCommitLogsServerSnapshot,
  getMarketingProjectCommitLogsSnapshot,
  parseMarketingProjectCommitLogs,
  subscribeToMarketingProjectCommitLogs,
} from "@/lib/marketing-project-commits";
import {
  getDevelopmentProjectsServerSnapshot,
  getDevelopmentProjectsSnapshot,
  parseDevelopmentProjects,
  subscribeToDevelopmentProjects,
} from "@/lib/development-projects";
import {
  getDevelopmentTasksServerSnapshot,
  getDevelopmentTasksSnapshot,
  parseDevelopmentTasksByProject,
  subscribeToDevelopmentTasks,
} from "@/lib/development-tasks";
import {
  getDevelopmentMembersServerSnapshot,
  getDevelopmentMembersSnapshot,
  parseDevelopmentMembersByProject,
  subscribeToDevelopmentMembers,
} from "@/lib/development-members";
import {
  getDevelopmentProjectCommitLogsServerSnapshot,
  getDevelopmentProjectCommitLogsSnapshot,
  parseDevelopmentProjectCommitLogs,
  subscribeToDevelopmentProjectCommitLogs,
} from "@/lib/development-project-commits";
import { parseDirectTasks, type DirectTask } from "@/lib/direct-tasks";

const STATUS_ORDER = ["To Do", "In Progress", "Review", "Done"] as const;
const PRIORITY_ORDER = ["High", "Medium", "Low"] as const;
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_MIN_WORDS = 60;
const SUMMARY_MAX_WORDS = 90;
const DIRECT_ASSIGNMENT_SCOPE_KEY = "__DIRECT_ASSIGNMENTS__";
const DIRECT_ASSIGNMENT_SCOPE_LABEL = "Individual direct assignments";

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

type Workstream = "Marketing" | "Development";
type TaskStatus = (typeof STATUS_ORDER)[number];
type TaskPriority = (typeof PRIORITY_ORDER)[number];
type RecurringWeekday = (typeof WEEKDAY_ORDER)[number];

type UnifiedProject = {
  key: string;
  id: string;
  stream: Workstream;
  name: string;
  deadline: string;
  tags: string[];
  isCompleted: boolean;
};

type UnifiedTask = {
  id: string;
  projectKey: string;
  projectId: string;
  projectName: string;
  stream: Workstream;
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  hoursAssigned: number;
  timeSpent: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  assignedByName: string | null;
  assignedByUserId: string | null;
  assignedAtIso: string | null;
  isRecurring: boolean;
  recurringDays: RecurringWeekday[];
  recurringTimePerOccurrenceHours: number;
  recurringCompletions: Record<string, boolean>;
  createdAt: string | null;
};

type UnifiedCommit = {
  id: string;
  projectKey: string;
  projectName: string;
  stream: Workstream;
  changedBy: string;
  scope: "project" | "task";
  action: string;
  field: string;
  fromValue: string;
  toValue: string;
  changedAtIso: string;
  changedAtIndia: string;
};

type LoggedPerson = {
  id: string;
  name: string;
  title: string;
};

type AiScopedProject = UnifiedProject & {
  memberNames: string[];
};

type AiMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type GeneratedSummaryEntry = {
  id: string;
  generatedAtIso: string;
  text: string;
};

type AiContextTaskRow = {
  id: string;
  title: string;
  description: string;
  projectName: string;
  projectKey: string;
  stream: Workstream;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  assignee: string;
  hoursAssigned: number;
  timeSpent: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  unresolvedDependencies: number;
  daysOverdue: number;
  blocked: boolean;
  assignedBy: string;
  assignedAtIso: string;
  isRecurring: boolean;
  recurringDays: RecurringWeekday[];
  recurringTimePerOccurrenceHours: number;
  recurringCompletions: Record<string, boolean>;
};

type AiProjectContextRow = {
  projectKey: string;
  projectId: string;
  projectName: string;
  stream: Workstream;
  deadline: string;
  tags: string[];
  isCompleted: boolean;
  members: string[];
  tasksTotal: number;
  openTasks: number;
  overdueOpenTasks: number;
  highPriorityOpenTasks: number;
  blockedOpenTasks: number;
  topTaskTitles: string[];
  topTaskDescriptions: string[];
};

type AiTeamLoadRow = {
  name: string;
  allocatedHours: number;
  assignedHours: number;
  openTasks: number;
  overdueOpenTasks: number;
  highPriorityOpenTasks: number;
  timeSpent: number;
};

type AiCommitRow = {
  projectName: string;
  stream: Workstream;
  changedBy: string;
  scope: "project" | "task";
  taskId: string;
  taskTitle: string;
  action: string;
  field: string;
  fromValue: string;
  toValue: string;
  changedAtIndia: string;
  changedAtIso: string;
};

type AiDirectTaskContextRow = {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string;
  assignedBy: string;
  assignedAtIso: string;
  hoursAssigned: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  timeSpent: number;
  unresolvedDependencies: number;
  daysOverdue: number;
  blocked: boolean;
  isRecurring: boolean;
  recurringDays: RecurringWeekday[];
  recurringTimePerOccurrenceHours: number;
  recurringCompletions: Record<string, boolean>;
};

type AiMyWorkPreferenceRow = {
  userId: string;
  userName: string;
  activeTab: string;
  assignedByMeTab: string;
  focusedTaskKeys: string[];
  customTodos: Array<{
    title: string;
    hours: number;
    done: boolean;
  }>;
  updatedAtIso: string;
};

type AiRecurringContextRow = {
  source: "project" | "direct";
  taskId: string;
  title: string;
  stream: Workstream | "Direct";
  projectName: string;
  assignee: string;
  assignedBy: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  recurringDays: RecurringWeekday[];
  recurringTimePerOccurrenceHours: number;
  expectedThisWeek: number;
  doneThisWeek: number;
  dueToday: boolean;
  nextOccurrenceDate: string | null;
};

type AiScopeSnapshot = {
  todayIso: string;
  scope: {
    member: string;
    project: string;
  };
  summary: {
    projects: number;
    tasks: number;
    open: number;
    done: number;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
    highPriorityOpen: number;
    blockedOpen: number;
  };
  statusCounts: Record<TaskStatus, number>;
  topOverdue: AiContextTaskRow[];
  topPriorityOpen: AiContextTaskRow[];
  blockedOpen: AiContextTaskRow[];
  projectsDetailed: AiProjectContextRow[];
  tasksDetailed: AiContextTaskRow[];
  teamLoad: AiTeamLoadRow[];
  commitsRecent: AiCommitRow[];
  directTasks: AiDirectTaskContextRow[];
  recurring: {
    totalRecurringTasks: number;
    projectRecurringTasks: number;
    directRecurringTasks: number;
    dueToday: number;
    dueThisWeek: number;
    rows: AiRecurringContextRow[];
  };
  myWorkPreferences: AiMyWorkPreferenceRow[];
};

type AiProjectOption = {
  key: string;
  name: string;
  stream: Workstream | "Direct";
  memberNames: string[];
};

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function getTodayIsoDate(): string {
  return toIsoDate(new Date());
}

function getDateMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function addDays(value: string, days: number): string {
  const base = getDateMs(value);
  if (base === null) {
    return value;
  }
  return toIsoDate(new Date(base + days * DAY_MS));
}

function formatIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "No date";
  }
  const [year, month, day] = value.split("-");
  const monthLabel = MONTHS[Number(month) - 1];
  return monthLabel ? `${day} ${monthLabel} ${year}` : value;
}

function parseTime(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function formatHours(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}h` : `${rounded}h`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function isOverdue(task: UnifiedTask, today: string): boolean {
  return Boolean(task.dueDate) && task.dueDate < today && task.status !== "Done";
}

function dueLabel(date: string, today: string): string {
  if (!date) {
    return "No due date";
  }
  if (date < today) {
    return "Overdue";
  }
  if (date === today) {
    return "Due today";
  }
  return "Upcoming";
}

function getDaysFromToday(date: string, today: string): number | null {
  const dueMs = getDateMs(date);
  const todayMs = getDateMs(today);
  if (dueMs === null || todayMs === null) {
    return null;
  }
  return Math.round((dueMs - todayMs) / DAY_MS);
}

function toWordArray(value: string): string[] {
  return value.trim().split(/\s+/).filter((word) => word.length > 0);
}

function truncateToWordCount(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function ensureSummaryWordRange(
  value: string,
  context: AiScopeSnapshot,
  minWords: number,
  maxWords: number
): string {
  let normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    normalized = "No reliable summary could be generated from current evidence.";
  }

  if (toWordArray(normalized).length > maxWords) {
    normalized = truncateToWordCount(normalized, maxWords);
  }

  const evidenceSupplements = [
    `Current scope includes ${context.summary.open} open tasks and ${context.summary.overdue} overdue tasks, with ${context.summary.highPriorityOpen} high-priority open items and ${context.summary.blockedOpen} explicitly blocked or dependency-constrained items.`,
    `Status mix is To Do ${context.statusCounts["To Do"]}, In Progress ${context.statusCounts["In Progress"]}, Review ${context.statusCounts.Review}, and Done ${context.statusCounts.Done}.`,
    `Input evidence covers ${context.projectsDetailed.length} scoped projects, ${context.teamLoad.length} team-load rows, ${context.commitsRecent.length} recent commits, ${context.directTasks.length} direct assignments, and ${context.myWorkPreferences.length} My Work preference snapshots.`,
  ];

  let nextText = normalized;
  for (const supplement of evidenceSupplements) {
    if (toWordArray(nextText).length >= minWords) {
      break;
    }
    nextText = `${nextText} ${supplement}`.trim();
  }

  if (toWordArray(nextText).length > maxWords) {
    nextText = truncateToWordCount(nextText, maxWords);
  }

  return nextText;
}

function formatDateTimeWithIndiaLocale(isoValue: string): string {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return isoValue;
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function projectHref(project: UnifiedProject): string {
  return project.stream === "Marketing"
    ? `/marketing/projects/${project.id}`
    : `/development/projects/${project.id}`;
}

function riskClasses(risk: "Critical" | "Overdue" | "Watch" | "On track"): string {
  if (risk === "Critical") {
    return "border-red-200 bg-red-100 text-red-700";
  }
  if (risk === "Overdue") {
    return "border-orange-200 bg-orange-100 text-orange-700";
  }
  if (risk === "Watch") {
    return "border-amber-200 bg-amber-100 text-amber-700";
  }
  return "border-emerald-200 bg-emerald-100 text-emerald-700";
}

function priorityClasses(priority: TaskPriority): string {
  if (priority === "High") {
    return "border-red-200 bg-red-100 text-red-700";
  }
  if (priority === "Medium") {
    return "border-amber-200 bg-amber-100 text-amber-700";
  }
  return "border-emerald-200 bg-emerald-100 text-emerald-700";
}

function getCurrentWeekDates(todayIsoDate: string): Array<{ date: string; weekday: RecurringWeekday }> {
  const refMs = getDateMs(todayIsoDate);
  if (refMs === null) {
    return [];
  }
  const ref = new Date(refMs);
  const mondayOffset = ref.getDay() === 0 ? -6 : 1 - ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + mondayOffset);
  return WEEKDAY_ORDER.map((weekday, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return { weekday, date: toIsoDate(day) };
  });
}

export default function AdminPage() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getHydratedServerSnapshot
  );

  const rawMarketingProjects = useSyncExternalStore(
    subscribeToMarketingProjects,
    getMarketingProjectsSnapshot,
    getMarketingProjectsServerSnapshot
  );
  const rawMarketingTasks = useSyncExternalStore(
    subscribeToMarketingTasks,
    getMarketingTasksSnapshot,
    getMarketingTasksServerSnapshot
  );
  const rawMarketingMembers = useSyncExternalStore(
    subscribeToMarketingMembers,
    getMarketingMembersSnapshot,
    getMarketingMembersServerSnapshot
  );
  const rawMarketingCommits = useSyncExternalStore(
    subscribeToMarketingProjectCommitLogs,
    getMarketingProjectCommitLogsSnapshot,
    getMarketingProjectCommitLogsServerSnapshot
  );
  const rawDevelopmentProjects = useSyncExternalStore(
    subscribeToDevelopmentProjects,
    getDevelopmentProjectsSnapshot,
    getDevelopmentProjectsServerSnapshot
  );
  const rawDevelopmentTasks = useSyncExternalStore(
    subscribeToDevelopmentTasks,
    getDevelopmentTasksSnapshot,
    getDevelopmentTasksServerSnapshot
  );
  const rawDevelopmentMembers = useSyncExternalStore(
    subscribeToDevelopmentMembers,
    getDevelopmentMembersSnapshot,
    getDevelopmentMembersServerSnapshot
  );
  const rawDevelopmentCommits = useSyncExternalStore(
    subscribeToDevelopmentProjectCommitLogs,
    getDevelopmentProjectCommitLogsSnapshot,
    getDevelopmentProjectCommitLogsServerSnapshot
  );

  const marketingProjects = parseMarketingProjects(rawMarketingProjects);
  const marketingTasksByProject = parseMarketingTasksByProject(rawMarketingTasks);
  const marketingMembersByProject = parseMarketingMembersByProject(rawMarketingMembers);
  const marketingCommits = parseMarketingProjectCommitLogs(rawMarketingCommits);
  const developmentProjects = parseDevelopmentProjects(rawDevelopmentProjects);
  const developmentTasksByProject = parseDevelopmentTasksByProject(rawDevelopmentTasks);
  const developmentMembersByProject = parseDevelopmentMembersByProject(rawDevelopmentMembers);
  const developmentCommits = parseDevelopmentProjectCommitLogs(rawDevelopmentCommits);
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [isAiAnalysisModalOpen, setIsAiAnalysisModalOpen] = useState(false);
  const [loggedPeople, setLoggedPeople] = useState<LoggedPerson[]>([]);
  const [aiSelectedMember, setAiSelectedMember] = useState("All");
  const [aiSelectedProjectKey, setAiSelectedProjectKey] = useState("All");
  const [aiInput, setAiInput] = useState("");
  const [isAiSending, setIsAiSending] = useState(false);
  const [aiServiceError, setAiServiceError] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [generatedSummary, setGeneratedSummary] = useState<GeneratedSummaryEntry | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [generatedSummaryError, setGeneratedSummaryError] = useState<string | null>(null);
  const [directTasks, setDirectTasks] = useState<DirectTask[]>([]);
  const [myWorkPreferences, setMyWorkPreferences] = useState<AiMyWorkPreferenceRow[]>([]);
  const aiMessageCounterRef = useRef(1);
  const aiQuickQuestions = [
    {
      label: "Summary",
      prompt:
        "Provide a detailed leadership summary across Marketing and Development with risks, bottlenecks, team signals, actions, and watchlist.",
    },
    { label: "Overdue tasks", prompt: "Show overdue tasks and what to fix first." },
    { label: "Today's tasks", prompt: "What tasks are due today and what should be prioritized?" },
    { label: "This week plan", prompt: "Give me a plan for this week based on open tasks." },
    {
      label: "Recurring",
      prompt:
        "Show recurring tasks from both projects and individual direct assignments with this week's expected vs done and what needs attention.",
    },
    { label: "Main bottlenecks", prompt: "What are the main bottlenecks right now?" },
  ] as const;

  useEffect(() => {
    let isMounted = true;

    const loadLoggedPeople = async () => {
      try {
        const response = await fetch("/api/auth/people", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          users?: Array<{
            id?: unknown;
            name?: unknown;
            title?: unknown;
          }>;
        };

        if (!response.ok || !Array.isArray(payload.users)) {
          if (isMounted) {
            setLoggedPeople([]);
          }
          return;
        }

        const people = payload.users
          .map((user) => {
            if (
              typeof user.id !== "string" ||
              typeof user.name !== "string" ||
              typeof user.title !== "string"
            ) {
              return null;
            }
            return {
              id: user.id.trim(),
              name: user.name.trim(),
              title: user.title.trim() || "Member",
            };
          })
          .filter((user): user is LoggedPerson => user !== null);

        if (isMounted) {
          setLoggedPeople(people);
        }
      } catch {
        if (isMounted) {
          setLoggedPeople([]);
        }
      }
    };

    loadLoggedPeople();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadDirectTasks = async () => {
      try {
        const response = await fetch("/api/direct-tasks", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          tasks?: unknown;
        };

        if (!response.ok) {
          if (isMounted) {
            setDirectTasks([]);
          }
          return;
        }

        if (isMounted) {
          setDirectTasks(parseDirectTasks(payload.tasks));
        }
      } catch {
        if (isMounted) {
          setDirectTasks([]);
        }
      }
    };

    void loadDirectTasks();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadMyWorkPreferences = async () => {
      try {
        const response = await fetch("/api/admin/my-work-preferences", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          preferences?: unknown;
        };

        if (!response.ok || !Array.isArray(payload.preferences)) {
          if (isMounted) {
            setMyWorkPreferences([]);
          }
          return;
        }

        const rows = payload.preferences
          .map((row) => {
            if (!row || typeof row !== "object") {
              return null;
            }
            const typedRow = row as Partial<AiMyWorkPreferenceRow>;
            if (
              typeof typedRow.userId !== "string" ||
              typeof typedRow.userName !== "string" ||
              typeof typedRow.activeTab !== "string" ||
              typeof typedRow.assignedByMeTab !== "string" ||
              !Array.isArray(typedRow.focusedTaskKeys) ||
              !Array.isArray(typedRow.customTodos) ||
              typeof typedRow.updatedAtIso !== "string"
            ) {
              return null;
            }

            return {
              userId: typedRow.userId,
              userName: typedRow.userName,
              activeTab: typedRow.activeTab,
              assignedByMeTab: typedRow.assignedByMeTab,
              focusedTaskKeys: typedRow.focusedTaskKeys.filter(
                (value): value is string => typeof value === "string"
              ),
              customTodos: typedRow.customTodos
                .map((todo) => {
                  if (!todo || typeof todo !== "object") {
                    return null;
                  }
                  const typedTodo = todo as {
                    title?: unknown;
                    hours?: unknown;
                    done?: unknown;
                  };
                  if (
                    typeof typedTodo.title !== "string" ||
                    typeof typedTodo.hours !== "number" ||
                    typeof typedTodo.done !== "boolean"
                  ) {
                    return null;
                  }
                  return {
                    title: typedTodo.title,
                    hours: Number.isFinite(typedTodo.hours) ? typedTodo.hours : 0,
                    done: typedTodo.done,
                  };
                })
                .filter(
                  (
                    todo
                  ): todo is {
                    title: string;
                    hours: number;
                    done: boolean;
                  } => todo !== null
                ),
              updatedAtIso: typedRow.updatedAtIso,
            } satisfies AiMyWorkPreferenceRow;
          })
          .filter((row): row is AiMyWorkPreferenceRow => row !== null);

        if (isMounted) {
          setMyWorkPreferences(rows);
        }
      } catch {
        if (isMounted) {
          setMyWorkPreferences([]);
        }
      }
    };

    void loadMyWorkPreferences();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isResourceModalOpen && !isAiAnalysisModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResourceModalOpen(false);
        setIsAiAnalysisModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAiAnalysisModalOpen, isResourceModalOpen]);

  const dashboard = useMemo(() => {
    const today = getTodayIsoDate();
    const plus14 = addDays(today, 14);
    const minus7Ms = getDateMs(addDays(today, -7)) ?? 0;
    const minus14Ms = getDateMs(addDays(today, -14)) ?? 0;
    const loggedPersonById = new Map(
      loggedPeople.map((person) => [person.id, person] as const)
    );
    const loggedPersonByName = new Map(
      loggedPeople.map((person) => [normalizeName(person.name), person] as const)
    );

    const projects: UnifiedProject[] = [
      ...marketingProjects.map((p) => ({
        key: `Marketing:${p.id}`,
        id: p.id,
        stream: "Marketing" as const,
        name: p.name,
        deadline: p.deadline,
        tags: p.tags,
        isCompleted: p.isCompleted,
      })),
      ...developmentProjects.map((p) => ({
        key: `Development:${p.id}`,
        id: p.id,
        stream: "Development" as const,
        name: p.name,
        deadline: p.deadline,
        tags: p.tags,
        isCompleted: p.isCompleted,
      })),
    ];

    const tasks: UnifiedTask[] = [
      ...marketingProjects.flatMap((project) =>
        (marketingTasksByProject[project.id] ?? []).map((task) => ({
          id: task.id,
          projectKey: `Marketing:${project.id}`,
          projectId: project.id,
          projectName: project.name,
          stream: "Marketing" as const,
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          hoursAssigned: task.hoursAssigned,
          timeSpent: task.timeSpent,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          assignedByName: task.assignedByName,
          assignedByUserId: task.assignedByUserId,
          assignedAtIso: task.assignedAtIso,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          recurringCompletions: task.recurringCompletions,
          createdAt: task.createdAt,
        }))
      ),
      ...developmentProjects.flatMap((project) =>
        (developmentTasksByProject[project.id] ?? []).map((task) => ({
          id: task.id,
          projectKey: `Development:${project.id}`,
          projectId: project.id,
          projectName: project.name,
          stream: "Development" as const,
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          hoursAssigned: task.hoursAssigned,
          timeSpent: task.timeSpent,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          assignedByName: task.assignedByName,
          assignedByUserId: task.assignedByUserId,
          assignedAtIso: task.assignedAtIso,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          recurringCompletions: task.recurringCompletions,
          createdAt: task.createdAt,
        }))
      ),
    ];

    const commits: UnifiedCommit[] = [
      ...marketingCommits.map((c) => ({
        id: c.id,
        projectKey: `Marketing:${c.projectId}`,
        projectName: c.projectName,
        stream: "Marketing" as const,
        changedBy: c.changedBy,
        scope: c.scope ?? "project",
        action: c.action ?? "updated",
        field: c.field,
        fromValue: c.fromValue,
        toValue: c.toValue,
        changedAtIso: c.changedAtIso,
        changedAtIndia: c.changedAtIndia,
      })),
      ...developmentCommits.map((c) => ({
        id: c.id,
        projectKey: `Development:${c.projectId}`,
        projectName: c.projectName,
        stream: "Development" as const,
        changedBy: c.changedBy,
        scope: c.scope ?? "project",
        action: c.action ?? "updated",
        field: c.field,
        fromValue: c.fromValue,
        toValue: c.toValue,
        changedAtIso: c.changedAtIso,
        changedAtIndia: c.changedAtIndia,
      })),
    ];

    const tasksByProject = new Map<string, UnifiedTask[]>();
    projects.forEach((project) => tasksByProject.set(project.key, []));
    tasks.forEach((task) => {
      const current = tasksByProject.get(task.projectKey) ?? [];
      current.push(task);
      tasksByProject.set(task.projectKey, current);
    });

    const doneTasks = tasks.filter((task) => task.status === "Done");
    const openTasks = tasks.filter((task) => task.status !== "Done");
    const overdueOpen = openTasks.filter((task) => isOverdue(task, today));

    const peopleSet = new Set<string>();
    Object.values(marketingMembersByProject).forEach((members) =>
      members.forEach((member) => member.name.trim() && peopleSet.add(member.name.trim()))
    );
    Object.values(developmentMembersByProject).forEach((members) =>
      members.forEach((member) => member.name.trim() && peopleSet.add(member.name.trim()))
    );
    tasks.forEach((task) => task.assignee && peopleSet.add(task.assignee.trim()));

    const workstreamSummary = {
      Marketing: { projects: marketingProjects.length, active: 0, open: 0, overdue: 0, rate: 0 },
      Development: { projects: developmentProjects.length, active: 0, open: 0, overdue: 0, rate: 0 },
    };
    workstreamSummary.Marketing.active = marketingProjects.filter((p) => !p.isCompleted).length;
    workstreamSummary.Development.active = developmentProjects.filter((p) => !p.isCompleted).length;

    const streamTaskCounters = {
      Marketing: { total: 0, done: 0, open: 0, overdue: 0 },
      Development: { total: 0, done: 0, open: 0, overdue: 0 },
    };
    tasks.forEach((task) => {
      const bucket = streamTaskCounters[task.stream];
      bucket.total += 1;
      if (task.status === "Done") {
        bucket.done += 1;
      } else {
        bucket.open += 1;
        if (isOverdue(task, today)) {
          bucket.overdue += 1;
        }
      }
    });
    workstreamSummary.Marketing.open = streamTaskCounters.Marketing.open;
    workstreamSummary.Marketing.overdue = streamTaskCounters.Marketing.overdue;
    workstreamSummary.Marketing.rate =
      streamTaskCounters.Marketing.total > 0
        ? (streamTaskCounters.Marketing.done / streamTaskCounters.Marketing.total) * 100
        : 0;
    workstreamSummary.Development.open = streamTaskCounters.Development.open;
    workstreamSummary.Development.overdue = streamTaskCounters.Development.overdue;
    workstreamSummary.Development.rate =
      streamTaskCounters.Development.total > 0
        ? (streamTaskCounters.Development.done / streamTaskCounters.Development.total) * 100
        : 0;

    const projectHealth = projects.map((project) => {
      const projectTasks = tasksByProject.get(project.key) ?? [];
      const open = projectTasks.filter((task) => task.status !== "Done");
      const done = projectTasks.length - open.length;
      const overdue = open.filter((task) => isOverdue(task, today)).length;
      const highOpen = open.filter((task) => task.priority === "High").length;
      const isCritical =
        open.length > 0 && (overdue * 2 >= open.length || (highOpen >= 3 && done < open.length));
      const isOverdueProject = Boolean(project.deadline) && project.deadline < today;
      const isWatch =
        Boolean(project.deadline) &&
        project.deadline >= today &&
        project.deadline <= addDays(today, 3) &&
        open.length > 0;
      const risk: "Critical" | "Overdue" | "Watch" | "On track" = isCritical
        ? "Critical"
        : isOverdueProject || overdue > 0
          ? "Overdue"
          : isWatch || highOpen > 0
            ? "Watch"
            : "On track";
      return {
        project,
        open,
        done,
        total: projectTasks.length,
        overdue,
        highOpen,
        risk,
      };
    });

    const riskProjects = projectHealth
      .filter((row) => row.risk !== "On track")
      .sort((a, b) => {
        const rank: Record<"Critical" | "Overdue" | "Watch" | "On track", number> = {
          Critical: 0,
          Overdue: 1,
          Watch: 2,
          "On track": 3,
        };
        if (rank[a.risk] !== rank[b.risk]) {
          return rank[a.risk] - rank[b.risk];
        }
        return (a.project.deadline || "9999-99-99").localeCompare(b.project.deadline || "9999-99-99");
      });

    const upcomingTasks = openTasks
      .filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= plus14)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 8);
    const overdueTasks = overdueOpen
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 8);
    const upcomingProjects = projectHealth
      .filter(
        (row) =>
          row.project.deadline &&
          row.project.deadline >= today &&
          row.project.deadline <= plus14
      )
      .slice(0, 8);

    const statusCounts: Record<TaskStatus, number> = {
      "To Do": 0,
      "In Progress": 0,
      Review: 0,
      Done: 0,
    };
    const priorityOpenCounts: Record<TaskPriority, number> = {
      High: 0,
      Medium: 0,
      Low: 0,
    };
    let blockedTasks = 0;
    let overdueHigh = 0;

    tasks.forEach((task) => {
      statusCounts[task.status] += 1;
      if (task.status !== "Done") {
        priorityOpenCounts[task.priority] += 1;
      }
      if (
        task.status !== "Done" &&
        task.priority === "High" &&
        task.dueDate &&
        task.dueDate < today
      ) {
        overdueHigh += 1;
      }
      if (
        task.status !== "Done" &&
        (task.blockerReason.trim() || task.dependencyTaskIds.length > 0)
      ) {
        blockedTasks += 1;
      }
    });

    const bottleneckStatus = STATUS_ORDER.reduce<TaskStatus | null>((current, status) => {
      if (status === "Done") {
        return current;
      }
      if (!current) {
        return status;
      }
      return statusCounts[status] > statusCounts[current] ? status : current;
    }, null);

    const personMap = new Map<
      string,
      {
        name: string;
        position: string;
        memberType: "Internal" | "External";
        allocated: number;
        assignedHours: number;
        timeSpent: number;
        assigned: number;
        open: number;
        done: number;
        highOpen: number;
        overdue: number;
      }
    >();

    const touchPerson = (
      name: string,
      options?: { memberSource?: "internal" | "external"; userId?: string | null }
    ) => {
      const key = name.trim();
      if (!key) {
        return null;
      }
      const isExternalByName = /\s+external$/i.test(key);
      const isExternal = options?.memberSource === "external" || isExternalByName;
      const loggedPerson =
        (options?.userId ? loggedPersonById.get(options.userId) : null) ??
        loggedPersonByName.get(normalizeName(key)) ??
        null;
      const existing = personMap.get(key);
      if (existing) {
        if (isExternal) {
          existing.memberType = "External";
          if (!existing.position || existing.position === "Member") {
            existing.position = "External collaborator";
          }
        } else if (loggedPerson) {
          existing.memberType = "Internal";
          existing.position = loggedPerson.title || "Member";
        }
        return existing;
      }
      const created = {
        name: key,
        position: isExternal ? "External collaborator" : loggedPerson?.title || "Member",
        memberType: isExternal ? ("External" as const) : ("Internal" as const),
        allocated: 0,
        assignedHours: 0,
        timeSpent: 0,
        assigned: 0,
        open: 0,
        done: 0,
        highOpen: 0,
        overdue: 0,
      };
      personMap.set(key, created);
      return created;
    };

    Object.values(marketingMembersByProject).forEach((members) => {
      members.forEach((member) => {
        const row = touchPerson(member.name, {
          memberSource: member.source,
          userId: member.userId,
        });
        if (row) {
          row.allocated += member.hoursAllocated;
        }
      });
    });
    Object.values(developmentMembersByProject).forEach((members) => {
      members.forEach((member) => {
        const row = touchPerson(member.name, {
          memberSource: member.source,
          userId: member.userId,
        });
        if (row) {
          row.allocated += member.hoursAllocated;
        }
      });
    });

    tasks.forEach((task) => {
      if (!task.assignee) {
        return;
      }
      const row = touchPerson(task.assignee);
      if (!row) {
        return;
      }
      row.assigned += 1;
      row.assignedHours += task.hoursAssigned;
      row.timeSpent += task.timeSpent;
      if (task.status === "Done") {
        row.done += 1;
      } else {
        row.open += 1;
        if (task.priority === "High") {
          row.highOpen += 1;
        }
        if (isOverdue(task, today)) {
          row.overdue += 1;
        }
      }
    });

    loggedPeople.forEach((person) => {
      touchPerson(person.name, {
        memberSource: "internal",
        userId: person.id,
      });
    });

    const peopleRows = [...personMap.values()].sort((a, b) => {
      if (a.overdue !== b.overdue) {
        return b.overdue - a.overdue;
      }
      if (a.open !== b.open) {
        return b.open - a.open;
      }
      return a.name.localeCompare(b.name);
    });

    const overloaded = peopleRows
      .filter((row) => {
        const utilization =
          row.allocated > 0 ? row.assignedHours / row.allocated : row.assignedHours > 0 ? 1 : 0;
        return utilization > 1 || row.overdue >= 2;
      })
      .slice(0, 6);

    const topFinishers = peopleRows
      .filter((row) => row.done > 0)
      .sort((a, b) => {
        if (a.done !== b.done) {
          return b.done - a.done;
        }

        const completionA = a.assigned > 0 ? a.done / a.assigned : 0;
        const completionB = b.assigned > 0 ? b.done / b.assigned : 0;
        if (completionA !== completionB) {
          return completionB - completionA;
        }

        if (a.overdue !== b.overdue) {
          return a.overdue - b.overdue;
        }
        if (a.timeSpent !== b.timeSpent) {
          return b.timeSpent - a.timeSpent;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 6);

    const resourceRows = peopleRows.map((row) => {
      const utilization =
        row.allocated > 0
          ? (row.assignedHours / row.allocated) * 100
          : row.assignedHours > 0
            ? 100
            : null;

      return {
        ...row,
        utilization,
      };
    });

    const resourceRowsWithAllocation = resourceRows.filter(
      (row) => row.allocated > 0 && row.utilization !== null
    );
    const averageUtilization =
      resourceRowsWithAllocation.length > 0
        ? resourceRowsWithAllocation.reduce(
            (sum, row) => sum + (row.utilization ?? 0),
            0
          ) / resourceRowsWithAllocation.length
        : 0;
    const highLoadMembersCount = resourceRows.filter(
      (row) => (row.utilization ?? 0) > 100
    ).length;

    const activeProjects = projects.filter((project) => !project.isCompleted);
    const activeProjectsByTagMap = new Map<string, UnifiedProject[]>();

    activeProjects.forEach((project) => {
      const cleanTags = project.tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      const tagsForGrouping = cleanTags.length > 0 ? cleanTags : ["Untagged"];

      tagsForGrouping.forEach((tag) => {
        const currentProjects = activeProjectsByTagMap.get(tag) ?? [];
        currentProjects.push(project);
        activeProjectsByTagMap.set(tag, currentProjects);
      });
    });

    const activeProjectsByTag = [...activeProjectsByTagMap.entries()]
      .map(([tag, taggedProjects]) => ({
        tag,
        count: taggedProjects.length,
        projects: taggedProjects.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        if (a.count !== b.count) {
          return b.count - a.count;
        }
        return a.tag.localeCompare(b.tag);
      });

    const weekDates = getCurrentWeekDates(today);
    const recurringRows = tasks
      .filter((task) => task.isRecurring)
      .map((task) => {
        const validDates = weekDates.filter((entry) => {
          if (!task.recurringDays.includes(entry.weekday)) {
            return false;
          }
          if (task.createdAt && entry.date < task.createdAt) {
            return false;
          }
          if (task.dueDate && entry.date > task.dueDate) {
            return false;
          }
          return true;
        });
        const done = validDates.filter((entry) => task.recurringCompletions[entry.date] === true).length;
        return { task, expected: validDates.length, done };
      })
      .filter((row) => row.expected > 0)
      .sort((a, b) => a.done / a.expected - b.done / b.expected);

    const recurringExpected = recurringRows.reduce((sum, row) => sum + row.expected, 0);
    const recurringDone = recurringRows.reduce((sum, row) => sum + row.done, 0);

    const recentCommits = commits
      .slice()
      .sort((a, b) => parseTime(b.changedAtIso) - parseTime(a.changedAtIso));
    const commitsLast7 = recentCommits.filter((commit) => parseTime(commit.changedAtIso) >= minus7Ms);
    const uniqueEditorsLast7 = new Set(
      commitsLast7.map((commit) => commit.changedBy.trim()).filter((name) => name.length > 0)
    ).size;

    const latestByProject = new Map<string, number>();
    recentCommits.forEach((commit) => {
      const current = latestByProject.get(commit.projectKey) ?? 0;
      const commitMs = parseTime(commit.changedAtIso);
      if (commitMs > current) {
        latestByProject.set(commit.projectKey, commitMs);
      }
    });

    const staleProjects = projectHealth
      .filter((row) => row.open.length > 0)
      .filter((row) => {
        const last = latestByProject.get(row.project.key);
        return !last || last < minus14Ms;
      })
      .slice(0, 8);

    return {
      today,
      totalProjects: projects.length,
      activeProjects: projects.filter((project) => !project.isCompleted).length,
      totalTasks: tasks.length,
      openTasks: openTasks.length,
      doneTasks: doneTasks.length,
      overdueOpen: overdueOpen.length,
      completionRate: tasks.length ? (doneTasks.length / tasks.length) * 100 : 0,
      uniquePeople: peopleSet.size,
      unassignedOpen: openTasks.filter((task) => !task.assignee).length,
      workstreamSummary,
      activeProjectsByTag,
      riskProjects,
      upcomingTasks,
      overdueTasks,
      upcomingProjects,
      statusCounts,
      bottleneckStatus,
      blockedTasks,
      priorityOpenCounts,
      overdueHigh,
      peopleRows,
      resourceRows,
      averageUtilization,
      highLoadMembersCount,
      overloaded,
      topFinishers,
      recurringRows,
      recurringExpected,
      recurringDone,
      recentCommits: recentCommits.slice(0, 10),
      commitsLast7: commitsLast7.length,
      uniqueEditorsLast7,
      staleProjects,
    };
  }, [
    developmentCommits,
    developmentMembersByProject,
    developmentProjects,
    developmentTasksByProject,
    loggedPeople,
    marketingCommits,
    marketingMembersByProject,
    marketingProjects,
    marketingTasksByProject,
  ]);

  const aiScope = useMemo(() => {
    const projects: UnifiedProject[] = [
      ...marketingProjects.map((project) => ({
        key: `Marketing:${project.id}`,
        id: project.id,
        stream: "Marketing" as const,
        name: project.name,
        deadline: project.deadline,
        tags: project.tags,
        isCompleted: project.isCompleted,
      })),
      ...developmentProjects.map((project) => ({
        key: `Development:${project.id}`,
        id: project.id,
        stream: "Development" as const,
        name: project.name,
        deadline: project.deadline,
        tags: project.tags,
        isCompleted: project.isCompleted,
      })),
    ];

    const tasks: UnifiedTask[] = [
      ...marketingProjects.flatMap((project) =>
        (marketingTasksByProject[project.id] ?? []).map((task) => ({
          id: task.id,
          projectKey: `Marketing:${project.id}`,
          projectId: project.id,
          projectName: project.name,
          stream: "Marketing" as const,
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          hoursAssigned: task.hoursAssigned,
          timeSpent: task.timeSpent,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          assignedByName: task.assignedByName,
          assignedByUserId: task.assignedByUserId,
          assignedAtIso: task.assignedAtIso,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          recurringCompletions: task.recurringCompletions,
          createdAt: task.createdAt,
        }))
      ),
      ...developmentProjects.flatMap((project) =>
        (developmentTasksByProject[project.id] ?? []).map((task) => ({
          id: task.id,
          projectKey: `Development:${project.id}`,
          projectId: project.id,
          projectName: project.name,
          stream: "Development" as const,
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          hoursAssigned: task.hoursAssigned,
          timeSpent: task.timeSpent,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          assignedByName: task.assignedByName,
          assignedByUserId: task.assignedByUserId,
          assignedAtIso: task.assignedAtIso,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          recurringCompletions: task.recurringCompletions,
          createdAt: task.createdAt,
        }))
      ),
    ];

    const projectMemberSets = new Map<string, Set<string>>();
    projects.forEach((project) => {
      projectMemberSets.set(project.key, new Set<string>());
    });

    const addMemberToProject = (projectKey: string, name: string | null | undefined) => {
      const clean = name?.trim();
      if (!clean) {
        return;
      }
      const target = projectMemberSets.get(projectKey);
      if (!target) {
        return;
      }
      target.add(clean);
    };

    marketingProjects.forEach((project) => {
      const projectKey = `Marketing:${project.id}`;
      (marketingMembersByProject[project.id] ?? []).forEach((member) => {
        addMemberToProject(projectKey, member.name);
      });
    });
    developmentProjects.forEach((project) => {
      const projectKey = `Development:${project.id}`;
      (developmentMembersByProject[project.id] ?? []).forEach((member) => {
        addMemberToProject(projectKey, member.name);
      });
    });
    tasks.forEach((task) => {
      addMemberToProject(task.projectKey, task.assignee);
    });

    const projectsWithMembers: AiScopedProject[] = projects.map((project) => ({
      ...project,
      memberNames: [...(projectMemberSets.get(project.key) ?? new Set<string>())].sort((a, b) =>
        a.localeCompare(b)
      ),
    }));

    const memberNamesSet = new Set<string>();
    projectsWithMembers.forEach((project) => {
      project.memberNames.forEach((name) => memberNamesSet.add(name));
    });
    loggedPeople.forEach((person) => {
      const name = person.name.trim();
      if (name) {
        memberNamesSet.add(name);
      }
    });
    directTasks.forEach((task) => {
      const assignee = task.assignee?.trim() ?? "";
      const assignedBy = task.assignedByName?.trim() ?? "";
      if (assignee) {
        memberNamesSet.add(assignee);
      }
      if (assignedBy) {
        memberNamesSet.add(assignedBy);
      }
    });

    return {
      today: getTodayIsoDate(),
      projects: projectsWithMembers,
      tasks,
      memberNames: [...memberNamesSet].sort((a, b) => a.localeCompare(b)),
    };
  }, [
    developmentMembersByProject,
    developmentProjects,
    developmentTasksByProject,
    directTasks,
    loggedPeople,
    marketingMembersByProject,
    marketingProjects,
    marketingTasksByProject,
  ]);

  const directScopeMemberNames = useMemo(() => {
    const memberNames = new Set<string>();
    directTasks.forEach((task) => {
      const assignee = task.assignee?.trim() ?? "";
      const assignedBy = task.assignedByName?.trim() ?? "";
      if (assignee) {
        memberNames.add(assignee);
      }
      if (assignedBy) {
        memberNames.add(assignedBy);
      }
    });
    return [...memberNames].sort((a, b) => a.localeCompare(b));
  }, [directTasks]);

  const aiProjectOptions = useMemo<AiProjectOption[]>(() => {
    const projects =
      aiSelectedMember === "All"
        ? aiScope.projects
        : aiScope.projects.filter((project) => project.memberNames.includes(aiSelectedMember));

    const projectOptions: AiProjectOption[] = projects.map((project) => ({
      key: project.key,
      name: project.name,
      stream: project.stream,
      memberNames: project.memberNames,
    }));

    projectOptions.push({
      key: DIRECT_ASSIGNMENT_SCOPE_KEY,
      name: DIRECT_ASSIGNMENT_SCOPE_LABEL,
      stream: "Direct",
      memberNames: directScopeMemberNames,
    });

    return projectOptions;
  }, [aiScope.projects, aiSelectedMember, directScopeMemberNames]);

  const aiMemberOptions = useMemo(() => {
    if (aiSelectedProjectKey === "All") {
      return aiScope.memberNames;
    }
    if (aiSelectedProjectKey === DIRECT_ASSIGNMENT_SCOPE_KEY) {
      return directScopeMemberNames.length > 0
        ? directScopeMemberNames
        : aiScope.memberNames;
    }
    const selectedProject = aiScope.projects.find((project) => project.key === aiSelectedProjectKey);
    return selectedProject ? selectedProject.memberNames : aiScope.memberNames;
  }, [aiScope.memberNames, aiScope.projects, aiSelectedProjectKey, directScopeMemberNames]);

  const aiMemberValue = aiMemberOptions.includes(aiSelectedMember) ? aiSelectedMember : "All";
  const aiProjectValue = aiProjectOptions.some((project) => project.key === aiSelectedProjectKey)
    ? aiSelectedProjectKey
    : "All";

  const buildScopedAiSnapshot = (overrides?: {
    member?: string;
    projectKey?: string;
  }): AiScopeSnapshot => {
    const scopeMember = overrides?.member ?? aiMemberValue;
    const scopeProjectKey = overrides?.projectKey ?? aiProjectValue;
    const isDirectOnlyScope = scopeProjectKey === DIRECT_ASSIGNMENT_SCOPE_KEY;
    const today = aiScope.today;

    const scopedProjects = aiScope.projects.filter((project) => {
      if (isDirectOnlyScope) {
        return false;
      }
      if (scopeProjectKey !== "All" && project.key !== scopeProjectKey) {
        return false;
      }
      if (scopeMember !== "All" && !project.memberNames.includes(scopeMember)) {
        return false;
      }
      return true;
    });
    const scopedProjectKeys = new Set(scopedProjects.map((project) => project.key));

    const scopedTasks = aiScope.tasks.filter((task) => {
      if (isDirectOnlyScope) {
        return false;
      }
      if (!scopedProjectKeys.has(task.projectKey)) {
        return false;
      }
      if (scopeMember !== "All" && task.assignee?.trim() !== scopeMember) {
        return false;
      }
      return true;
    });

    const statusByTaskIdByProjectKey = new Map<string, Map<string, TaskStatus>>();
    aiScope.tasks.forEach((task) => {
      if (!statusByTaskIdByProjectKey.has(task.projectKey)) {
        statusByTaskIdByProjectKey.set(task.projectKey, new Map<string, TaskStatus>());
      }
      statusByTaskIdByProjectKey.get(task.projectKey)?.set(task.id, task.status);
    });

    const getUnresolvedDependencies = (task: UnifiedTask): number => {
      const projectTaskStatuses = statusByTaskIdByProjectKey.get(task.projectKey);
      if (!projectTaskStatuses) {
        return task.dependencyTaskIds.length;
      }

      return task.dependencyTaskIds.reduce((count, dependencyTaskId) => {
        const dependencyStatus = projectTaskStatuses.get(dependencyTaskId);
        if (!dependencyStatus || dependencyStatus !== "Done") {
          return count + 1;
        }
        return count;
      }, 0);
    };

    const toContextTaskRow = (task: UnifiedTask): AiContextTaskRow => {
      const unresolvedDependencies = getUnresolvedDependencies(task);
      const blockedByReason = task.blockerReason.trim().length > 0;
      const blocked = blockedByReason || unresolvedDependencies > 0;
      const daysFromToday = getDaysFromToday(task.dueDate, today);
      const daysOverdue =
        task.status !== "Done" &&
        typeof daysFromToday === "number" &&
        daysFromToday < 0
          ? Math.abs(daysFromToday)
          : 0;

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        projectName: task.projectName,
        projectKey: task.projectKey,
        stream: task.stream,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        assignee: task.assignee?.trim() || "Unassigned",
        hoursAssigned: task.hoursAssigned,
        timeSpent: task.timeSpent,
        blockerReason: task.blockerReason,
        dependencyTaskIds: task.dependencyTaskIds,
        unresolvedDependencies,
        daysOverdue,
        blocked,
        assignedBy: task.assignedByName?.trim() || "Unknown",
        assignedAtIso: task.assignedAtIso ?? "",
        isRecurring: task.isRecurring,
        recurringDays: task.recurringDays,
        recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
        recurringCompletions: task.recurringCompletions,
      };
    };

    const tasksDetailed = scopedTasks
      .slice()
      .sort((a, b) => {
        const dueA = a.dueDate || "9999-99-99";
        const dueB = b.dueDate || "9999-99-99";
        if (dueA !== dueB) {
          return dueA.localeCompare(dueB);
        }
        const priorityA = a.priority === "High" ? 0 : a.priority === "Medium" ? 1 : 2;
        const priorityB = b.priority === "High" ? 0 : b.priority === "Medium" ? 1 : 2;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return a.title.localeCompare(b.title);
      })
      .map(toContextTaskRow);

    const openTasksDetailed = tasksDetailed.filter((task) => task.status !== "Done");
    const overdueTasksDetailed = openTasksDetailed
      .filter((task) => task.daysOverdue > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
    const dueTodayTasks = openTasksDetailed.filter((task) => task.dueDate === today);
    const dueThisWeekTasks = openTasksDetailed.filter((task) => {
      const days = getDaysFromToday(task.dueDate, today);
      return days !== null && days > 0 && days <= 7;
    });
    const highPriorityOpen = openTasksDetailed.filter((task) => task.priority === "High");
    const blockedTasks = openTasksDetailed.filter((task) => task.blocked);

    const topPriorityOpen = openTasksDetailed
      .slice()
      .sort((a, b) => {
        const priorityA = a.priority === "High" ? 0 : a.priority === "Medium" ? 1 : 2;
        const priorityB = b.priority === "High" ? 0 : b.priority === "Medium" ? 1 : 2;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        const dueA = a.dueDate || "9999-99-99";
        const dueB = b.dueDate || "9999-99-99";
        if (dueA !== dueB) {
          return dueA.localeCompare(dueB);
        }
        return a.title.localeCompare(b.title);
      })
      .slice(0, 16);

    const topOverdue = overdueTasksDetailed.slice(0, 16);
    const blockedOpen = blockedTasks
      .slice()
      .sort((a, b) => {
        const dueA = a.dueDate || "9999-99-99";
        const dueB = b.dueDate || "9999-99-99";
        if (dueA !== dueB) {
          return dueA.localeCompare(dueB);
        }
        return a.title.localeCompare(b.title);
      })
      .slice(0, 16);

    const openTasks = scopedTasks.filter((task) => task.status !== "Done");
    const overdueTasks = openTasks.filter((task) => isOverdue(task, today));

    const selectedProject =
      scopeProjectKey === "All"
        ? null
        : aiProjectOptions.find((project) => project.key === scopeProjectKey) ?? null;
    const scopeMemberLabel = scopeMember === "All" ? "All team members" : scopeMember;
    const scopeProjectLabel = selectedProject
      ? selectedProject.stream === "Direct"
        ? selectedProject.name
        : `${selectedProject.name} (${selectedProject.stream})`
      : "All projects";

    const statusCounts: Record<TaskStatus, number> = {
      "To Do": 0,
      "In Progress": 0,
      Review: 0,
      Done: 0,
    };
    scopedTasks.forEach((task) => {
      statusCounts[task.status] += 1;
    });

    const projectsDetailed = scopedProjects.map((project) => {
      const projectTasks = tasksDetailed.filter((task) => task.projectKey === project.key);
      const openProjectTasks = projectTasks.filter((task) => task.status !== "Done");
      const projectMembers =
        project.stream === "Marketing"
          ? (marketingMembersByProject[project.id] ?? []).map((member) => member.name.trim())
          : (developmentMembersByProject[project.id] ?? []).map((member) => member.name.trim());

      return {
        projectKey: project.key,
        projectId: project.id,
        projectName: project.name,
        stream: project.stream,
        deadline: project.deadline,
        tags: project.tags,
        isCompleted: project.isCompleted,
        members: [...new Set([...project.memberNames, ...projectMembers])].filter(Boolean),
        tasksTotal: projectTasks.length,
        openTasks: openProjectTasks.length,
        overdueOpenTasks: openProjectTasks.filter((task) => task.daysOverdue > 0).length,
        highPriorityOpenTasks: openProjectTasks.filter((task) => task.priority === "High").length,
        blockedOpenTasks: openProjectTasks.filter((task) => task.blocked).length,
        topTaskTitles: openProjectTasks.slice(0, 12).map((task) => task.title),
        topTaskDescriptions: openProjectTasks
          .map((task) => task.description.trim())
          .filter((description) => description.length > 0)
          .slice(0, 12),
      } satisfies AiProjectContextRow;
    });

    const teamLoadMap = new Map<string, AiTeamLoadRow>();
    const touchTeamMember = (name: string): AiTeamLoadRow => {
      const cleanName = name.trim();
      const existing = teamLoadMap.get(cleanName);
      if (existing) {
        return existing;
      }
      const created: AiTeamLoadRow = {
        name: cleanName,
        allocatedHours: 0,
        assignedHours: 0,
        openTasks: 0,
        overdueOpenTasks: 0,
        highPriorityOpenTasks: 0,
        timeSpent: 0,
      };
      teamLoadMap.set(cleanName, created);
      return created;
    };

    scopedProjects.forEach((project) => {
      const members =
        project.stream === "Marketing"
          ? marketingMembersByProject[project.id] ?? []
          : developmentMembersByProject[project.id] ?? [];
      members.forEach((member) => {
        const memberName = member.name.trim();
        if (!memberName) {
          return;
        }
        const row = touchTeamMember(memberName);
        row.allocatedHours += member.hoursAllocated;
      });
    });

    tasksDetailed.forEach((task) => {
      if (!task.assignee || task.assignee === "Unassigned") {
        return;
      }
      const row = touchTeamMember(task.assignee);
      row.assignedHours += task.hoursAssigned;
      row.timeSpent += task.timeSpent;
      if (task.status !== "Done") {
        row.openTasks += 1;
        if (task.daysOverdue > 0) {
          row.overdueOpenTasks += 1;
        }
        if (task.priority === "High") {
          row.highPriorityOpenTasks += 1;
        }
      }
    });
    const teamLoad = [...teamLoadMap.values()]
      .filter((row) => row.assignedHours > 0 || row.allocatedHours > 0)
      .sort((a, b) => {
        if (a.overdueOpenTasks !== b.overdueOpenTasks) {
          return b.overdueOpenTasks - a.overdueOpenTasks;
        }
        if (a.openTasks !== b.openTasks) {
          return b.openTasks - a.openTasks;
        }
        return a.name.localeCompare(b.name);
      });

    const allCommits: AiCommitRow[] = [
      ...marketingCommits.map((commit) => ({
        projectName: commit.projectName,
        stream: "Marketing" as const,
        changedBy: commit.changedBy,
        scope: commit.scope ?? "project",
        taskId: commit.taskId ?? "",
        taskTitle: commit.taskTitle ?? "",
        action: commit.action ?? "updated",
        field: commit.field,
        fromValue: commit.fromValue,
        toValue: commit.toValue,
        changedAtIndia: commit.changedAtIndia,
        changedAtIso: commit.changedAtIso,
      })),
      ...developmentCommits.map((commit) => ({
        projectName: commit.projectName,
        stream: "Development" as const,
        changedBy: commit.changedBy,
        scope: commit.scope ?? "project",
        taskId: commit.taskId ?? "",
        taskTitle: commit.taskTitle ?? "",
        action: commit.action ?? "updated",
        field: commit.field,
        fromValue: commit.fromValue,
        toValue: commit.toValue,
        changedAtIndia: commit.changedAtIndia,
        changedAtIso: commit.changedAtIso,
      })),
    ];

    const scopedProjectNameSet = new Set(scopedProjects.map((project) => project.name));
    const commitsRecent = allCommits
      .filter((commit) => {
        if (scopeProjectKey !== "All" && !scopedProjectNameSet.has(commit.projectName)) {
          return false;
        }
        if (scopeMember !== "All" && normalizeName(commit.changedBy) !== normalizeName(scopeMember)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => parseTime(b.changedAtIso) - parseTime(a.changedAtIso))
      .slice(0, 120);

    const includeDirectAssignments =
      scopeProjectKey === "All" || scopeProjectKey === DIRECT_ASSIGNMENT_SCOPE_KEY;
    const directStatusByTaskId = new Map(
      directTasks.map((task) => [task.id, task.status] as const)
    );
    const directTasksContext = (includeDirectAssignments ? directTasks : [])
      .filter((task) => {
        if (scopeMember !== "All") {
          const assignee = task.assignee?.trim() ?? "";
          const assignedBy = task.assignedByName?.trim() ?? "";
          return (
            normalizeName(assignee) === normalizeName(scopeMember) ||
            normalizeName(assignedBy) === normalizeName(scopeMember)
          );
        }
        return true;
      })
      .map((task) => {
        const dueDate = task.dueDate;
        const dueDays = getDaysFromToday(dueDate, today);
        const daysOverdue =
          task.status !== "Done" && dueDays !== null && dueDays < 0 ? Math.abs(dueDays) : 0;
        const unresolvedDependencies = task.dependencyTaskIds.filter((dependencyId) => {
          const dependencyStatus = directStatusByTaskId.get(dependencyId);
          return dependencyStatus !== undefined && dependencyStatus !== "Done";
        }).length;
        const blocked =
          task.blockerReason.trim().length > 0 || unresolvedDependencies > 0;

        return {
          id: task.id,
          title: task.title,
          description: task.description,
          dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee ?? "Unassigned",
          assignedBy: task.assignedByName ?? "Unknown",
          assignedAtIso: task.assignedAtIso ?? "",
          hoursAssigned: task.hoursAssigned,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          timeSpent: task.timeSpent,
          unresolvedDependencies,
          daysOverdue,
          blocked,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          recurringCompletions: task.recurringCompletions,
        } satisfies AiDirectTaskContextRow;
      })
      .slice(0, 180);

    const currentWeekDates = getCurrentWeekDates(today);
    const getRecurringWeekMeta = (
      recurringDays: RecurringWeekday[],
      dueDate: string,
      recurringCompletions: Record<string, boolean>
    ) => {
      const validWeekDates = currentWeekDates.filter(
        (entry) =>
          recurringDays.includes(entry.weekday) &&
          (!dueDate || dueDate.length === 0 || entry.date <= dueDate)
      );
      const expectedThisWeek = validWeekDates.length;
      const doneThisWeek = validWeekDates.filter(
        (entry) => recurringCompletions[entry.date] === true
      ).length;
      const dueToday = validWeekDates.some((entry) => entry.date === today);
      const nextOccurrenceDate =
        validWeekDates.find((entry) => entry.date >= today)?.date ?? null;

      return {
        expectedThisWeek,
        doneThisWeek,
        dueToday,
        nextOccurrenceDate,
      };
    };

    const projectRecurringRows: AiRecurringContextRow[] = tasksDetailed
      .filter((task) => task.isRecurring && task.recurringDays.length > 0)
      .map((task) => {
        const recurringMeta = getRecurringWeekMeta(
          task.recurringDays,
          task.dueDate,
          task.recurringCompletions
        );
        return {
          source: "project",
          taskId: task.id,
          title: task.title,
          stream: task.stream,
          projectName: task.projectName,
          assignee: task.assignee,
          assignedBy: task.assignedBy,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          expectedThisWeek: recurringMeta.expectedThisWeek,
          doneThisWeek: recurringMeta.doneThisWeek,
          dueToday: recurringMeta.dueToday,
          nextOccurrenceDate: recurringMeta.nextOccurrenceDate,
        } satisfies AiRecurringContextRow;
      });

    const directRecurringRows: AiRecurringContextRow[] = directTasksContext
      .filter((task) => task.isRecurring && task.recurringDays.length > 0)
      .map((task) => {
        const recurringMeta = getRecurringWeekMeta(
          task.recurringDays,
          task.dueDate,
          task.recurringCompletions
        );
        return {
          source: "direct",
          taskId: task.id,
          title: task.title,
          stream: "Direct",
          projectName: DIRECT_ASSIGNMENT_SCOPE_LABEL,
          assignee: task.assignee,
          assignedBy: task.assignedBy,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          recurringDays: task.recurringDays,
          recurringTimePerOccurrenceHours: task.recurringTimePerOccurrenceHours,
          expectedThisWeek: recurringMeta.expectedThisWeek,
          doneThisWeek: recurringMeta.doneThisWeek,
          dueToday: recurringMeta.dueToday,
          nextOccurrenceDate: recurringMeta.nextOccurrenceDate,
        } satisfies AiRecurringContextRow;
      });

    const allRecurringRows = [...projectRecurringRows, ...directRecurringRows];
    const recurringRows = allRecurringRows
      .slice()
      .sort((firstRow, secondRow) => {
        if (firstRow.dueToday !== secondRow.dueToday) {
          return firstRow.dueToday ? -1 : 1;
        }
        if (firstRow.expectedThisWeek !== secondRow.expectedThisWeek) {
          return secondRow.expectedThisWeek - firstRow.expectedThisWeek;
        }
        if (firstRow.doneThisWeek !== secondRow.doneThisWeek) {
          return firstRow.doneThisWeek - secondRow.doneThisWeek;
        }
        return firstRow.title.localeCompare(secondRow.title);
      })
      .slice(0, 240);

    const directOpenTasks = directTasksContext.filter((task) => task.status !== "Done");
    const directOverdueTasks = directOpenTasks.filter((task) => task.daysOverdue > 0);
    const directDueTodayTasks = directOpenTasks.filter((task) => task.dueDate === today);
    const directDueThisWeekTasks = directOpenTasks.filter((task) => {
      const days = getDaysFromToday(task.dueDate, today);
      return days !== null && days > 0 && days <= 7;
    });
    const directHighPriorityOpen = directOpenTasks.filter(
      (task) => task.priority === "High"
    );
    const directBlockedOpen = directOpenTasks.filter((task) => task.blocked);
    directTasksContext.forEach((task) => {
      statusCounts[task.status] += 1;
    });

    const myWorkPreferencesContext = myWorkPreferences
      .filter((preference) => {
        if (scopeMember === "All") {
          return true;
        }
        return normalizeName(preference.userName) === normalizeName(scopeMember);
      })
      .slice(0, 80);

    return {
      todayIso: today,
      scope: {
        member: scopeMemberLabel,
        project: scopeProjectLabel,
      },
      summary: {
        projects:
          scopedProjects.length +
          (scopeProjectKey === DIRECT_ASSIGNMENT_SCOPE_KEY ? 1 : 0),
        tasks: scopedTasks.length + directTasksContext.length,
        open: openTasks.length + directOpenTasks.length,
        done:
          scopedTasks.length -
          openTasks.length +
          (directTasksContext.length - directOpenTasks.length),
        overdue: overdueTasks.length + directOverdueTasks.length,
        dueToday: dueTodayTasks.length + directDueTodayTasks.length,
        dueThisWeek: dueThisWeekTasks.length + directDueThisWeekTasks.length,
        highPriorityOpen: highPriorityOpen.length + directHighPriorityOpen.length,
        blockedOpen: blockedTasks.length + directBlockedOpen.length,
      },
      statusCounts,
      topOverdue,
      topPriorityOpen,
      blockedOpen,
      projectsDetailed,
      tasksDetailed: tasksDetailed.slice(0, 300),
      teamLoad,
      commitsRecent,
      directTasks: directTasksContext,
      recurring: {
        totalRecurringTasks: allRecurringRows.length,
        projectRecurringTasks: projectRecurringRows.length,
        directRecurringTasks: directRecurringRows.length,
        dueToday: allRecurringRows.filter((row) => row.dueToday).length,
        dueThisWeek: allRecurringRows.filter((row) => row.expectedThisWeek > 0).length,
        rows: recurringRows,
      },
      myWorkPreferences: myWorkPreferencesContext,
    };
  };

  const sendAiPrompt = async (questionOverride?: string) => {
    const question = (questionOverride ?? aiInput).trim();
    if (!question || isAiSending) {
      return;
    }
    const userId = `user-${aiMessageCounterRef.current}`;
    aiMessageCounterRef.current += 1;
    const assistantId = `assistant-${aiMessageCounterRef.current}`;
    aiMessageCounterRef.current += 1;
    setAiInput("");
    setAiServiceError(null);
    setAiMessages((previous) => [...previous, { id: userId, role: "user", text: question }]);
    setIsAiSending(true);

    const snapshot = buildScopedAiSnapshot();
    let reply = "";

    try {
      const response = await fetch("/api/admin/ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          context: snapshot,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        answer?: unknown;
        error?: unknown;
      };

      if (!response.ok || typeof payload.answer !== "string" || payload.answer.trim().length === 0) {
        const apiError =
          typeof payload.error === "string" && payload.error.trim().length > 0
            ? payload.error
            : "AI service returned no answer.";
        throw new Error(apiError);
      }

      reply = payload.answer.trim();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "AI service unavailable.";
      reply =
        "AI service is unavailable right now. Please verify OPENAI_API_KEY and try again.";
      setAiServiceError(message);
    } finally {
      setIsAiSending(false);
      setAiMessages((previous) => [
        ...previous,
        { id: assistantId, role: "assistant", text: reply },
      ]);
    }
  };

  const generatePortfolioSummary = async () => {
    if (isGeneratingSummary) {
      return;
    }

    setGeneratedSummaryError(null);
    setIsGeneratingSummary(true);

    const question =
      "Generate a concise evidence-backed portfolio summary in 60 to 90 words, covering both Marketing and Development, with one key risk and one immediate focus.";
    const context = buildScopedAiSnapshot({
      member: "All",
      projectKey: "All",
    });
    let summaryText = "";
    let summaryGenerated = false;

    try {
      const response = await fetch("/api/admin/ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          context,
          mode: "compact_summary",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        answer?: unknown;
        error?: unknown;
      };

      if (!response.ok || typeof payload.answer !== "string" || payload.answer.trim().length === 0) {
        const apiError =
          typeof payload.error === "string" && payload.error.trim().length > 0
            ? payload.error
            : "Summary generation failed.";
        throw new Error(apiError);
      }

      summaryText = ensureSummaryWordRange(
        payload.answer,
        context,
        SUMMARY_MIN_WORDS,
        SUMMARY_MAX_WORDS
      );
      summaryGenerated = true;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Summary service unavailable.";
      setGeneratedSummaryError(message);
    } finally {
      setIsGeneratingSummary(false);
    }

    if (summaryGenerated) {
      const generatedAtIso = new Date().toISOString();
      const id = `summary-${aiMessageCounterRef.current}`;
      aiMessageCounterRef.current += 1;
      setGeneratedSummary({ id, generatedAtIso, text: summaryText });
    }
  };

  if (!hydrated) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-slate-900">Admin Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">Loading insights...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Company Control Center
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Admin Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">
              Data and insights for leadership across projects, tasks, and team execution.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            Snapshot: {formatIsoDate(dashboard.today)}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>            <h2 className="text-base font-semibold text-slate-900">Executive Snapshot</h2>
          </div>
          <Gauge className="h-5 w-5 text-slate-500" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
              <span>Projects</span>
              <FolderKanban className="h-4 w-4" />
            </div>
            <p className="text-2xl font-semibold text-slate-900">
              {dashboard.activeProjects}/{dashboard.totalProjects}
            </p>
            <p className="text-xs text-slate-600">active / total</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
              <span>Open tasks</span>
              <ClipboardList className="h-4 w-4" />
            </div>
            <p className="text-2xl font-semibold text-slate-900">{dashboard.openTasks}</p>
            <p className="text-xs text-slate-600">{dashboard.doneTasks} done</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
              <span>Overdue</span>
              <AlertTriangle className="h-4 w-4" />
            </div>
            <p className="text-2xl font-semibold text-slate-900">{dashboard.overdueOpen}</p>
            <p className="text-xs text-slate-600">{dashboard.unassignedOpen} unassigned</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
              <span>People</span>
              <Users className="h-4 w-4" />
            </div>
            <p className="text-2xl font-semibold text-slate-900">{dashboard.uniquePeople}</p>
            <p className="text-xs text-slate-600">members + assignees</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
              <span>Execution rate</span>
              <TrendingUp className="h-4 w-4" />
            </div>
            <p className="text-2xl font-semibold text-slate-900">{formatPercent(dashboard.completionRate)}</p>
            <p className="text-xs text-slate-600">tasks completed</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI Analysis</h2>
            <p className="text-xs text-slate-500">
              Generate compact portfolio summaries or open full AI analysis.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void generatePortfolioSummary();
              }}
              disabled={isGeneratingSummary}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGeneratingSummary ? "Generating..." : "Generate summary"}
            </button>
            <button
              type="button"
              onClick={() => setIsAiAnalysisModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-4 w-4" />
              Open AI module
            </button>
          </div>
        </div>

        {generatedSummaryError && (
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            AI summary unavailable. Showing fallback summary instead. {generatedSummaryError}
          </p>
        )}

        {generatedSummary === null ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            No summary generated yet.
          </p>
        ) : (
          <article
            key={generatedSummary.id}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <p className="text-xs font-medium text-slate-600">
              {formatDateTimeWithIndiaLocale(generatedSummary.generatedAtIso)}
            </p>
            <p className="mt-1 text-sm text-slate-800">{generatedSummary.text}</p>
          </article>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>              <h2 className="text-base font-semibold text-slate-900">Portfolio Health By Division</h2>
            </div>
            <Activity className="h-5 w-5 text-slate-500" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["Marketing", "Development"] as const).map((stream) => (
              <article key={stream} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{stream}</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div className="flex justify-between">
                    <span>Projects</span>
                    <span className="font-semibold">
                      {dashboard.workstreamSummary[stream].active}/{dashboard.workstreamSummary[stream].projects}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Open tasks</span>
                    <span className="font-semibold">{dashboard.workstreamSummary[stream].open}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Overdue</span>
                    <span className="font-semibold text-red-600">{dashboard.workstreamSummary[stream].overdue}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Completion</span>
                    <span className="font-semibold">{formatPercent(dashboard.workstreamSummary[stream].rate)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>              <h2 className="text-base font-semibold text-slate-900">Delivery Risk Radar</h2>
            </div>
            <AlertTriangle className="h-5 w-5 text-slate-500" />
          </div>
          {dashboard.riskProjects.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              No at-risk projects right now.
            </p>
          ) : (
            <div className="space-y-2">
              {dashboard.riskProjects.slice(0, 6).map((row) => (
                <article key={row.project.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={projectHref(row.project)} className="text-sm font-semibold text-slate-900 hover:underline">
                        {row.project.name}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.project.stream} · {dueLabel(row.project.deadline, dashboard.today)}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${riskClasses(row.risk)}`}>
                      {row.risk}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Open {row.open.length} · Overdue {row.overdue} · High priority {row.highOpen}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Active Projects By Tags</h2>
          <Tags className="h-5 w-5 text-slate-500" />
        </div>
        {dashboard.activeProjectsByTag.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            No active projects with tags yet.
          </p>
        ) : (
          <div className="max-h-[26rem] overflow-y-auto pr-1">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.activeProjectsByTag.map((tagGroup) => (
              <article
                key={`tag:${tagGroup.tag}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                    {tagGroup.tag}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {tagGroup.count} active
                  </span>
                </div>
                <div className="space-y-1">
                  {tagGroup.projects.slice(0, 4).map((project) => (
                    <Link
                      key={project.key}
                      href={projectHref(project)}
                      className="block text-sm text-slate-800 hover:underline"
                    >
                      {project.name}
                    </Link>
                  ))}
                  {tagGroup.projects.length > 4 && (
                    <p className="text-xs text-slate-500">
                      +{tagGroup.projects.length - 4} more projects
                    </p>
                  )}
                </div>
              </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Execution Bottlenecks</h2>
          <Activity className="h-5 w-5 text-slate-500" />
        </div>
        <div className="space-y-3">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="space-y-1">
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>{status}</span>
                <span className="font-semibold">{dashboard.statusCounts[status]}</span>
              </div>
              <div className="h-2 rounded bg-slate-100">
                <div
                  className={`h-2 rounded ${
                    status === dashboard.bottleneckStatus ? "bg-amber-500" : "bg-slate-400"
                  }`}
                  style={{
                    width: `${Math.max(
                      8,
                      dashboard.totalTasks
                        ? (dashboard.statusCounts[status] / dashboard.totalTasks) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p>
            Bottleneck:{" "}
            <span className="font-semibold">
              {dashboard.bottleneckStatus
                ? `${dashboard.bottleneckStatus} (${dashboard.statusCounts[dashboard.bottleneckStatus]})`
                : "No tasks"}
            </span>
          </p>
          <p className="mt-1">
            Blocked/dependency tasks: <span className="font-semibold">{dashboard.blockedTasks}</span>
          </p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>              <h2 className="text-base font-semibold text-slate-900">Priority Exposure</h2>
            </div>
            <Flame className="h-5 w-5 text-slate-500" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {PRIORITY_ORDER.map((priority) => (
              <article key={priority} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{priority}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{dashboard.priorityOpenCounts[priority]}</p>
                <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${priorityClasses(priority)}`}>
                  Open
                </span>
              </article>
            ))}
          </div>
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            High priority overdue: <span className="font-semibold">{dashboard.overdueHigh}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Team Capacity Vs Allocation</h2>
            <Users className="h-5 w-5 text-slate-500" />
          </div>
          {dashboard.resourceRows.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              No team data yet.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tracked members</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{dashboard.resourceRows.length}</p>
                </article>
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Avg utilization</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {formatPercent(dashboard.averageUtilization)}
                  </p>
                </article>
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">High load members</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {dashboard.highLoadMembersCount}
                  </p>
                </article>
              </div>
              <button
                type="button"
                onClick={() => setIsResourceModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Maximize2 className="h-4 w-4" />
                Open resource module
              </button>
              <p className="text-xs text-slate-500">
                Full table moved to a dedicated modal so this dashboard stays focused.
              </p>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">People Performance</h2>
          <UserCog className="h-5 w-5 text-slate-500" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <article>
            <p className="mb-2 text-sm font-semibold text-slate-900">Top finishers</p>
            <p className="mb-2 text-xs text-slate-500">
              Ranked only for members with 1+ completed tasks.
            </p>
            {dashboard.topFinishers.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No completed work yet.
              </p>
            ) : (
              <div className="space-y-2">
                {dashboard.topFinishers.slice(0, 4).map((person) => (
                  <div
                    key={`finisher:${person.name}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-slate-900">{person.name}</p>
                    <p className="text-xs text-slate-600">
                      Done {person.done} · Time spent {formatHours(person.timeSpent)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article>
            <p className="mb-2 text-sm font-semibold text-slate-900">Overloaded</p>
            {dashboard.overloaded.length === 0 ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                No major overload now.
              </p>
            ) : (
              <div className="space-y-2">
                {dashboard.overloaded.slice(0, 4).map((person) => (
                  <div
                    key={`overload:${person.name}`}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-slate-900">{person.name}</p>
                    <p className="text-xs text-red-700">
                      Open {person.open} · Overdue {person.overdue} · High {person.highOpen}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      {isResourceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setIsResourceModalOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Resource Module</h3>
                <p className="text-xs text-slate-500">
                  Team Capacity Vs Allocation across active projects.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResourceModalOpen(false)}
                className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Close resource module"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-3">
              <article className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tracked members</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{dashboard.resourceRows.length}</p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Avg utilization</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatPercent(dashboard.averageUtilization)}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">High load members</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{dashboard.highLoadMembersCount}</p>
              </article>
            </div>

            <div className="max-h-[56vh] overflow-auto p-4">
              {dashboard.resourceRows.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  No team data yet.
                </p>
              ) : (
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2">Member</th>
                      <th className="pb-2">Allocated</th>
                      <th className="pb-2">Assigned</th>
                      <th className="pb-2">Open</th>
                      <th className="pb-2">Done</th>
                      <th className="pb-2">Overdue</th>
                      <th className="pb-2">Utilization</th>
                      <th className="pb-2">Load status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.resourceRows.map((person) => {
                      const loadStatus =
                        (person.utilization ?? 0) > 100
                          ? "High load"
                        : (person.utilization ?? 0) >= 80
                            ? "Healthy"
                            : "Low load";

                      const loadClasses =
                        loadStatus === "High load"
                          ? "text-red-700"
                          : loadStatus === "Healthy"
                            ? "text-emerald-700"
                            : "text-slate-700";

                      return (
                        <tr key={`resource:${person.name}`} className="border-b border-slate-100 text-slate-700">
                          <td className="py-2 font-medium text-slate-900">{person.name}</td>
                          <td className="py-2">{formatHours(person.allocated)}</td>
                          <td className="py-2">{formatHours(person.assignedHours)}</td>
                          <td className="py-2">{person.open}</td>
                          <td className="py-2">{person.done}</td>
                          <td className="py-2">{person.overdue}</td>
                          <td className="py-2">
                            {person.utilization === null ? "n/a" : formatPercent(person.utilization)}
                          </td>
                          <td className={`py-2 font-medium ${loadClasses}`}>{loadStatus}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {isAiAnalysisModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setIsAiAnalysisModalOpen(false)}
        >
          <div
            className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">AI Analysis Module</h3>
                <p className="text-xs text-slate-500">Chat-style analysis with project and team scoping.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAiAnalysisModalOpen(false)}
                className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Close AI analysis module"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-slate-700">
                  Team member
                  <select
                    value={aiMemberValue}
                    onChange={(event) => {
                      const nextMember = event.target.value;
                      setAiSelectedMember(nextMember);
                      const selectedProject =
                        aiProjectValue === "All"
                          ? null
                          : aiProjectOptions.find((project) => project.key === aiProjectValue) ?? null;
                      if (
                        selectedProject &&
                        nextMember !== "All" &&
                        !selectedProject.memberNames.includes(nextMember)
                      ) {
                        setAiSelectedProjectKey("All");
                      }
                    }}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-500"
                  >
                    <option value="All">All</option>
                    {aiMemberOptions.map((name) => (
                      <option key={`ai-member:${name}`} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs font-medium text-slate-700">
                  Project
                  <select
                    value={aiProjectValue}
                    onChange={(event) => {
                      const nextProject = event.target.value;
                      setAiSelectedProjectKey(nextProject);
                      if (nextProject === "All" || aiMemberValue === "All") {
                        return;
                      }
                      const selectedProject = aiProjectOptions.find(
                        (project) => project.key === nextProject
                      );
                      if (!selectedProject || !selectedProject.memberNames.includes(aiMemberValue)) {
                        setAiSelectedMember("All");
                      }
                    }}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-500"
                  >
                    <option value="All">All</option>
                    {aiProjectOptions.map((project) => (
                      <option key={`ai-project:${project.key}`} value={project.key}>
                        {project.stream === "Direct"
                          ? project.name
                          : `${project.name} (${project.stream})`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Dropdowns are linked. Changing one updates valid options in the other.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
                {aiMessages.length === 0 && !isAiSending && (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
                    Start with a quick question below.
                  </p>
                )}
                {aiMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex w-full ${message.role === "assistant" ? "justify-start" : "justify-end"}`}
                  >
                    <article
                      className={`max-w-[88%] rounded-xl border px-4 py-3 shadow-sm ${
                        message.role === "assistant"
                          ? "border-slate-200 bg-white text-slate-800"
                          : "border-blue-200 bg-blue-50 text-slate-900"
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {message.role === "assistant" ? (
                          <>
                            <Bot className="h-3.5 w-3.5" />
                            AI analysis
                          </>
                        ) : (
                          <>
                            <MessageSquare className="h-3.5 w-3.5" />
                            You
                          </>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
                    </article>
                  </div>
                ))}
                {isAiSending && (
                  <div className="flex w-full justify-start">
                    <article className="max-w-[88%] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                      AI is analyzing...
                    </article>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <div className="mx-auto w-full max-w-5xl">
                <div className="rounded-xl border border-slate-300 bg-white p-3">
                  {aiServiceError && (
                    <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      OpenAI service unavailable. {aiServiceError}
                    </p>
                  )}
                  <div className="mb-2 flex flex-wrap gap-2">
                    {aiQuickQuestions.map((question) => (
                      <button
                        key={`quick-ai:${question.label}`}
                        type="button"
                        onClick={() => {
                          void sendAiPrompt(question.prompt);
                        }}
                        disabled={isAiSending}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {question.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={aiInput}
                    onChange={(event) => setAiInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void sendAiPrompt();
                      }
                    }}
                    placeholder="Ask AI analysis..."
                    className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      Scope: {aiMemberValue} | {aiProjectValue === "All" ? "All projects" : "1 project"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void sendAiPrompt();
                      }}
                      disabled={isAiSending || aiInput.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <SendHorizontal className="h-4 w-4" />
                      {isAiSending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        Strategic lens included: risk concentration, execution bottlenecks, team allocation, and people performance.
      </footer>
    </div>
  );
}



