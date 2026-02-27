"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Flame,
  FolderKanban,
  Gauge,
  Maximize2,
  Tags,
  TrendingUp,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

const STATUS_ORDER = ["To Do", "In Progress", "Review", "Done"] as const;
const PRIORITY_ORDER = ["High", "Medium", "Low"] as const;
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;

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
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  hoursAssigned: number;
  timeSpent: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  isRecurring: boolean;
  recurringDays: RecurringWeekday[];
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

type PersonDirectoryRow = {
  name: string;
  position: string;
  memberType: "Internal" | "External";
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
  const [isPeopleModalOpen, setIsPeopleModalOpen] = useState(false);
  const [loggedPeople, setLoggedPeople] = useState<LoggedPerson[]>([]);

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
    if (!isResourceModalOpen && !isPeopleModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResourceModalOpen(false);
        setIsPeopleModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPeopleModalOpen, isResourceModalOpen]);

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
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          hoursAssigned: task.hoursAssigned,
          timeSpent: task.timeSpent,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
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
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          hoursAssigned: task.hoursAssigned,
          timeSpent: task.timeSpent,
          blockerReason: task.blockerReason,
          dependencyTaskIds: task.dependencyTaskIds,
          isRecurring: task.isRecurring,
          recurringDays: task.recurringDays,
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

    const peopleDirectoryRows: PersonDirectoryRow[] = [...personMap.values()]
      .map((row) => ({
        name: row.name,
        position:
          row.position ||
          (row.memberType === "External" ? "External collaborator" : "Member"),
        memberType: row.memberType,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const internalPeopleCount = peopleDirectoryRows.filter(
      (row) => row.memberType === "Internal"
    ).length;
    const externalPeopleCount = peopleDirectoryRows.length - internalPeopleCount;

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
      internalPeopleCount,
      externalPeopleCount,
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
      peopleDirectoryRows,
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
          <div>
            <h2 className="text-base font-semibold text-slate-900">People Directory</h2>
            <p className="text-xs text-slate-500">
              Expand to review name, position, and internal/external classification.
            </p>
          </div>
          <UserCog className="h-5 w-5 text-slate-500" />
        </div>
        {dashboard.peopleDirectoryRows.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            No people data yet.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {dashboard.peopleDirectoryRows.length}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Internal</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {dashboard.internalPeopleCount}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">External</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {dashboard.externalPeopleCount}
                </p>
              </article>
            </div>
            <button
              type="button"
              onClick={() => setIsPeopleModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-4 w-4" />
              Open people module
            </button>
          </div>
        )}
      </section>

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

      {isPeopleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setIsPeopleModalOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">People Module</h3>
                <p className="text-xs text-slate-500">
                  Name, position, and internal/external classification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPeopleModalOpen(false)}
                className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Close people module"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-3">
              <article className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total people</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {dashboard.peopleDirectoryRows.length}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Internal</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {dashboard.internalPeopleCount}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">External</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {dashboard.externalPeopleCount}
                </p>
              </article>
            </div>

            <div className="max-h-[56vh] overflow-auto p-4">
              {dashboard.peopleDirectoryRows.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  No people data yet.
                </p>
              ) : (
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2">Name</th>
                      <th className="pb-2">Position</th>
                      <th className="pb-2">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.peopleDirectoryRows.map((person) => (
                      <tr key={`people:${person.name}`} className="border-b border-slate-100 text-slate-700">
                        <td className="py-2 font-medium text-slate-900">{person.name}</td>
                        <td className="py-2">{person.position}</td>
                        <td className="py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                              person.memberType === "Internal"
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {person.memberType}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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



