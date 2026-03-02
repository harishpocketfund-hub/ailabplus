
"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BadgeAlert,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Check,
  CircleAlert,
  Flame,
  Plus,
  Repeat,
  Search,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getDemoUserServerSnapshot,
  getDemoUserSnapshot,
  parseDemoUser,
  subscribeToDemoUser,
} from "@/lib/demo-user";
import {
  getMarketingMembersServerSnapshot,
  getMarketingMembersSnapshot,
  MarketingMember,
  parseMarketingMembersByProject,
  subscribeToMarketingMembers,
} from "@/lib/marketing-members";
import {
  getMarketingProjectsServerSnapshot,
  getMarketingProjectsSnapshot,
  parseMarketingProjects,
  subscribeToMarketingProjects,
} from "@/lib/marketing-projects";
import {
  createMarketingSubtaskId,
  getMarketingTasksServerSnapshot,
  getMarketingTasksSnapshot,
  MarketingRecurringCompletions,
  MarketingRecurringWeekday,
  MarketingSubtask,
  MarketingTask,
  MarketingTaskPriority,
  MarketingTaskStatus,
  parseMarketingTasksByProject,
  RECURRING_WEEKDAY_OPTIONS,
  sortTasksInStatus,
  subscribeToMarketingTasks,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  writeMarketingTasksForProject,
} from "@/lib/marketing-tasks";
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
import { fetchUserPreference, saveUserPreference } from "@/lib/preferences-client";
import { recordTaskAssignmentEvent } from "@/lib/assignment-events-client";
import {
  createDirectTaskId,
  parseDirectTasks,
  type DirectTask,
} from "@/lib/direct-tasks";

const ALL_FILTER_VALUE = "__ALL__";
const UNASSIGNED_VALUE = "__UNASSIGNED__";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const MY_WORK_PREFS_STORAGE_KEY = "internal-system-my-work-preferences";
const MY_WORK_PREFS_NAMESPACE = "my-work";
const DIRECT_TASK_PROJECT_ID = "__DIRECT_TASKS__";
const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

type MyWorkTab = "all" | "overdue" | "today" | "week" | "recurring";
type MyWorkStatusFilter = MarketingTaskStatus | typeof ALL_FILTER_VALUE;
type MyWorkPriorityFilter = MarketingTaskPriority | typeof ALL_FILTER_VALUE;
type MyWorkDueFilter =
  | typeof ALL_FILTER_VALUE
  | "overdue"
  | "today"
  | "week"
  | "no_due";

type MyWorkCustomTodo = {
  id: string;
  title: string;
  hours: number;
  done: boolean;
};

type MyWorkFilters = {
  search: string;
  status: MyWorkStatusFilter;
  priority: MyWorkPriorityFilter;
  due: MyWorkDueFilter;
  onlyBlocked: boolean;
  onlyDependent: boolean;
};

type AssignedByMeFilters = {
  search: string;
  status: MyWorkStatusFilter;
  priority: MyWorkPriorityFilter;
  due: MyWorkDueFilter;
  onlyBlocked: boolean;
  onlyDependent: boolean;
};

type MyWorkUserPreferences = {
  activeTab: MyWorkTab;
  assignedByMeTab: MyWorkTab;
  filters: MyWorkFilters;
  assignedByMeFilters: AssignedByMeFilters;
  focusedTaskKeys: string[];
  customTodos: MyWorkCustomTodo[];
};

type MyWorkPreferencesByUser = Record<string, MyWorkUserPreferences>;

type TaskEntry = {
  key: string;
  source: "project" | "direct";
  projectId: string;
  projectName: string;
  projectHref: string | null;
  contextLabel: string;
  task: MarketingTask;
  members: MarketingMember[];
};

type WeekDateEntry = {
  weekday: MarketingRecurringWeekday;
  date: string;
};

type FocusBucket = 0 | 1 | 2 | 3 | 4 | 5 | 99;

type DeleteTarget = {
  projectId: string;
  taskId: string;
} | null;

type MyWorkSummaryStream = "Marketing" | "Development";

type SummaryAssignedTask = {
  stream: MyWorkSummaryStream;
  projectId: string;
  projectName: string;
  dueDate: string;
  status: MarketingTaskStatus;
};

type AssignedByMeEntry = TaskEntry;

const createDefaultFilters = (): MyWorkFilters => ({
  search: "",
  status: ALL_FILTER_VALUE,
  priority: ALL_FILTER_VALUE,
  due: ALL_FILTER_VALUE,
  onlyBlocked: false,
  onlyDependent: false,
});

const createDefaultAssignedByMeFilters = (): AssignedByMeFilters => ({
  search: "",
  status: ALL_FILTER_VALUE,
  priority: ALL_FILTER_VALUE,
  due: ALL_FILTER_VALUE,
  onlyBlocked: false,
  onlyDependent: false,
});

const createDefaultPreferences = (): MyWorkUserPreferences => ({
  activeTab: "all",
  assignedByMeTab: "all",
  filters: createDefaultFilters(),
  assignedByMeFilters: createDefaultAssignedByMeFilters(),
  focusedTaskKeys: [],
  customTodos: [],
});

const isMyWorkTab = (value: unknown): value is MyWorkTab => {
  return (
    value === "all" ||
    value === "overdue" ||
    value === "today" ||
    value === "week" ||
    value === "recurring"
  );
};

const isMyWorkStatusFilter = (value: unknown): value is MyWorkStatusFilter => {
  return (
    value === ALL_FILTER_VALUE ||
    TASK_STATUS_OPTIONS.includes(value as MarketingTaskStatus)
  );
};

const isMyWorkPriorityFilter = (
  value: unknown
): value is MyWorkPriorityFilter => {
  return (
    value === ALL_FILTER_VALUE ||
    TASK_PRIORITY_OPTIONS.includes(value as MarketingTaskPriority)
  );
};

const isMyWorkDueFilter = (value: unknown): value is MyWorkDueFilter => {
  return (
    value === ALL_FILTER_VALUE ||
    value === "overdue" ||
    value === "today" ||
    value === "week" ||
    value === "no_due"
  );
};

const parseMyWorkPreference = (rawValue: unknown): MyWorkUserPreferences => {
  const defaults = createDefaultPreferences();

  try {
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      return defaults;
    }

    const typedPreference = rawValue as Partial<MyWorkUserPreferences> & {
      filters?: unknown;
      assignedByMeFilters?: unknown;
    };

    const filtersValue =
      typedPreference.filters &&
      typeof typedPreference.filters === "object" &&
      !Array.isArray(typedPreference.filters)
        ? (typedPreference.filters as Partial<MyWorkFilters>)
        : {};

    const nextFilters: MyWorkFilters = {
      search: typeof filtersValue.search === "string" ? filtersValue.search : "",
      status: isMyWorkStatusFilter(filtersValue.status)
        ? filtersValue.status
        : ALL_FILTER_VALUE,
      priority: isMyWorkPriorityFilter(filtersValue.priority)
        ? filtersValue.priority
        : ALL_FILTER_VALUE,
      due: isMyWorkDueFilter(filtersValue.due)
        ? filtersValue.due
        : ALL_FILTER_VALUE,
      onlyBlocked:
        typeof filtersValue.onlyBlocked === "boolean"
          ? filtersValue.onlyBlocked
          : false,
      onlyDependent:
        typeof filtersValue.onlyDependent === "boolean"
          ? filtersValue.onlyDependent
          : false,
    };

    const assignedByMeFiltersValue =
      typedPreference.assignedByMeFilters &&
      typeof typedPreference.assignedByMeFilters === "object" &&
      !Array.isArray(typedPreference.assignedByMeFilters)
        ? (typedPreference.assignedByMeFilters as Partial<AssignedByMeFilters>)
        : {};

    const nextAssignedByMeFilters: AssignedByMeFilters = {
      search:
        typeof assignedByMeFiltersValue.search === "string"
          ? assignedByMeFiltersValue.search
          : "",
      status: isMyWorkStatusFilter(assignedByMeFiltersValue.status)
        ? assignedByMeFiltersValue.status
        : ALL_FILTER_VALUE,
      priority: isMyWorkPriorityFilter(assignedByMeFiltersValue.priority)
        ? assignedByMeFiltersValue.priority
        : ALL_FILTER_VALUE,
      due: isMyWorkDueFilter(assignedByMeFiltersValue.due)
        ? assignedByMeFiltersValue.due
        : ALL_FILTER_VALUE,
      onlyBlocked:
        typeof assignedByMeFiltersValue.onlyBlocked === "boolean"
          ? assignedByMeFiltersValue.onlyBlocked
          : false,
      onlyDependent:
        typeof assignedByMeFiltersValue.onlyDependent === "boolean"
          ? assignedByMeFiltersValue.onlyDependent
          : false,
    };

    const focusedTaskKeys = Array.isArray(typedPreference.focusedTaskKeys)
      ? typedPreference.focusedTaskKeys.filter(
          (taskKey): taskKey is string => typeof taskKey === "string"
        )
      : [];
    const customTodos = Array.isArray(typedPreference.customTodos)
      ? typedPreference.customTodos
          .map((todo) => {
            if (!todo || typeof todo !== "object") {
              return null;
            }

            const typedTodo = todo as Partial<MyWorkCustomTodo>;
            if (
              typeof typedTodo.id !== "string" ||
              typeof typedTodo.title !== "string"
            ) {
              return null;
            }

            const parsedHours =
              typeof typedTodo.hours === "number" &&
              Number.isFinite(typedTodo.hours) &&
              typedTodo.hours >= 0
                ? typedTodo.hours
                : 0;

            return {
              id: typedTodo.id,
              title: typedTodo.title,
              hours: parsedHours,
              done: typedTodo.done === true,
            } satisfies MyWorkCustomTodo;
          })
          .filter((todo): todo is MyWorkCustomTodo => todo !== null)
      : [];

    return {
      activeTab: isMyWorkTab(typedPreference.activeTab)
        ? typedPreference.activeTab
        : defaults.activeTab,
      assignedByMeTab: isMyWorkTab(typedPreference.assignedByMeTab)
        ? typedPreference.assignedByMeTab
        : defaults.assignedByMeTab,
      filters: nextFilters,
      assignedByMeFilters: nextAssignedByMeFilters,
      focusedTaskKeys,
      customTodos,
    };
  } catch {
    return defaults;
  }
};

const parseMyWorkPreferencesByUser = (
  rawValue: string | null
): MyWorkPreferencesByUser => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([userName, preferenceValue]) => [
        userName,
        parseMyWorkPreference(preferenceValue),
      ])
    );
  } catch {
    return {};
  }
};

const getTodayIsoDate = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
};

const getDateMsFromIsoDate = (value: string): number | null => {
  if (!value) {
    return null;
  }

  const parsedMs = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(parsedMs) ? null : parsedMs;
};

const toIsoDate = (value: Date): string => {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(value.getDate()).padStart(2, "0")}`;
};

const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const currentMs = getDateMsFromIsoDate(isoDate);
  if (currentMs === null) {
    return isoDate;
  }

  return toIsoDate(new Date(currentMs + days * ONE_DAY_IN_MS));
};

const getWeekdayFromDate = (date: Date): MarketingRecurringWeekday => {
  const weekdayByIndex: MarketingRecurringWeekday[] = [
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
  ];
  return weekdayByIndex[date.getDay()];
};

const getWeekDatesForReference = (referenceDateMs: number): WeekDateEntry[] => {
  const referenceDate = new Date(referenceDateMs);
  const mondayOffset = referenceDate.getDay() === 0 ? -6 : 1 - referenceDate.getDay();
  const weekStart = new Date(referenceDate);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(referenceDate.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const currentDate = new Date(weekStart);
    currentDate.setDate(weekStart.getDate() + index);

    return {
      weekday: getWeekdayFromDate(currentDate),
      date: toIsoDate(currentDate),
    };
  });
};

const getTaskKey = (projectId: string, taskId: string): string =>
  `${projectId}::${taskId}`;

const getCustomTodoKey = (todoId: string): string => `custom::${todoId}`;

const createMyWorkCustomTodoId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parseTaskKey = (
  taskKey: string
): { projectId: string; taskId: string } | null => {
  const separatorIndex = taskKey.indexOf("::");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    projectId: taskKey.slice(0, separatorIndex),
    taskId: taskKey.slice(separatorIndex + 2),
  };
};

const getPriorityBadgeClasses = (priority: MarketingTaskPriority): string => {
  if (priority === "High") {
    return "border-red-200 bg-red-100 text-red-700";
  }
  if (priority === "Low") {
    return "border-green-200 bg-green-100 text-green-700";
  }
  return "border-yellow-200 bg-yellow-100 text-yellow-700";
};

const getStatusBadgeClasses = (status: MarketingTaskStatus): string => {
  if (status === "Done") {
    return "border-green-200 bg-green-100 text-green-700";
  }
  if (status === "In Progress") {
    return "border-blue-200 bg-blue-100 text-blue-700";
  }
  if (status === "Review") {
    return "border-amber-200 bg-amber-100 text-amber-700";
  }
  return "border-gray-200 bg-gray-100 text-gray-700";
};

const formatHours = (value: number): string => {
  const roundedValue = Math.round(value * 100) / 100;
  return Number.isInteger(roundedValue)
    ? `${roundedValue.toFixed(0)}h`
    : `${roundedValue}h`;
};

const getDueLabel = (dueDate: string, todayIsoDate: string): string => {
  if (!dueDate) {
    return "No due date";
  }

  if (dueDate < todayIsoDate) {
    return "Overdue";
  }

  if (dueDate === todayIsoDate) {
    return "Today";
  }

  const dueDateMs = getDateMsFromIsoDate(dueDate);
  const todayMs = getDateMsFromIsoDate(todayIsoDate);
  if (dueDateMs === null || todayMs === null) {
    return dueDate;
  }

  const dayDiff = Math.round((dueDateMs - todayMs) / ONE_DAY_IN_MS);
  if (dayDiff === 1) {
    return "In 1 day";
  }

  return `In ${dayDiff} days`;
};

const matchesDueFilter = (
  task: MarketingTask,
  dueFilter: MyWorkDueFilter,
  todayIsoDate: string,
  weekEndIsoDate: string
): boolean => {
  if (dueFilter === ALL_FILTER_VALUE) {
    return true;
  }
  if (dueFilter === "overdue") {
    return Boolean(task.dueDate) && task.dueDate < todayIsoDate;
  }
  if (dueFilter === "today") {
    return task.dueDate === todayIsoDate;
  }
  if (dueFilter === "week") {
    return (
      Boolean(task.dueDate) &&
      task.dueDate > todayIsoDate &&
      task.dueDate <= weekEndIsoDate
    );
  }
  return !task.dueDate;
};

const matchesFilters = (
  task: MarketingTask,
  filters: Pick<MyWorkFilters, "search" | "status" | "priority" | "due">,
  todayIsoDate: string,
  weekEndIsoDate: string
): boolean => {
  const searchQuery = filters.search.trim().toLowerCase();
  if (searchQuery) {
    const searchable = `${task.title} ${task.description}`.toLowerCase();
    if (!searchable.includes(searchQuery)) {
      return false;
    }
  }

  if (filters.status !== ALL_FILTER_VALUE && task.status !== filters.status) {
    return false;
  }

  if (filters.priority !== ALL_FILTER_VALUE && task.priority !== filters.priority) {
    return false;
  }

  if (!matchesDueFilter(task, filters.due, todayIsoDate, weekEndIsoDate)) {
    return false;
  }

  return true;
};

const matchesTab = (
  task: MarketingTask,
  tab: MyWorkTab,
  todayIsoDate: string,
  weekEndIsoDate: string,
  todayWeekday: MarketingRecurringWeekday
): boolean => {
  if (tab === "all") {
    return true;
  }
  if (tab === "overdue") {
    return Boolean(task.dueDate) && task.dueDate < todayIsoDate;
  }
  if (tab === "today") {
    return task.dueDate === todayIsoDate;
  }
  if (tab === "week") {
    return (
      Boolean(task.dueDate) &&
      task.dueDate > todayIsoDate &&
      task.dueDate <= weekEndIsoDate
    );
  }
  return isRecurringForDate(task, todayIsoDate, todayWeekday);
};

const isRecurringForDate = (
  task: MarketingTask,
  dateIso: string,
  weekday: MarketingRecurringWeekday
): boolean => {
  if (!task.isRecurring) {
    return false;
  }
  if (!task.recurringDays.includes(weekday)) {
    return false;
  }
  if (task.dueDate && dateIso > task.dueDate) {
    return false;
  }
  return true;
};

const getFocusBucket = (
  task: MarketingTask,
  todayIsoDate: string,
  weekEndIsoDate: string
): FocusBucket => {
  if (task.status === "Done" || !task.dueDate) {
    return 99;
  }

  const isHigh = task.priority === "High";
  if (task.dueDate < todayIsoDate) {
    return isHigh ? 0 : 1;
  }
  if (task.dueDate === todayIsoDate) {
    return isHigh ? 2 : 3;
  }
  if (task.dueDate <= weekEndIsoDate) {
    return isHigh ? 4 : 5;
  }
  return 99;
};

const getPriorityWeight = (priority: MarketingTaskPriority): number => {
  if (priority === "High") {
    return 0;
  }
  if (priority === "Medium") {
    return 1;
  }
  return 2;
};

const getFocusReasonLabel = (
  task: MarketingTask,
  todayIsoDate: string,
  weekEndIsoDate: string
): string => {
  const bucket = getFocusBucket(task, todayIsoDate, weekEndIsoDate);
  if (bucket === 0) {
    return "Overdue | High";
  }
  if (bucket === 1) {
    return "Overdue";
  }
  if (bucket === 2) {
    return "Due today | High";
  }
  if (bucket === 3) {
    return "Due today";
  }
  if (bucket === 4) {
    return "Due this week | High";
  }
  if (bucket === 5) {
    return "Due this week";
  }
  return "Watch";
};

export default function MyWorkPage() {
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getHydratedServerSnapshot
  );
  const rawUser = useSyncExternalStore(
    subscribeToDemoUser,
    getDemoUserSnapshot,
    getDemoUserServerSnapshot
  );
  const rawProjects = useSyncExternalStore(
    subscribeToMarketingProjects,
    getMarketingProjectsSnapshot,
    getMarketingProjectsServerSnapshot
  );
  const rawTasksByProject = useSyncExternalStore(
    subscribeToMarketingTasks,
    getMarketingTasksSnapshot,
    getMarketingTasksServerSnapshot
  );
  const rawMembersByProject = useSyncExternalStore(
    subscribeToMarketingMembers,
    getMarketingMembersSnapshot,
    getMarketingMembersServerSnapshot
  );
  const rawDevelopmentProjects = useSyncExternalStore(
    subscribeToDevelopmentProjects,
    getDevelopmentProjectsSnapshot,
    getDevelopmentProjectsServerSnapshot
  );
  const rawDevelopmentTasksByProject = useSyncExternalStore(
    subscribeToDevelopmentTasks,
    getDevelopmentTasksSnapshot,
    getDevelopmentTasksServerSnapshot
  );

  const user = parseDemoUser(rawUser);
  const userName = user?.name ?? "";
  const projects = parseMarketingProjects(rawProjects);
  const tasksByProject = parseMarketingTasksByProject(rawTasksByProject);
  const membersByProject = parseMarketingMembersByProject(rawMembersByProject);
  const developmentProjects = parseDevelopmentProjects(rawDevelopmentProjects);
  const developmentTasksByProject = parseDevelopmentTasksByProject(
    rawDevelopmentTasksByProject
  );

  const [activeTab, setActiveTab] = useState<MyWorkTab>("all");
  const [assignedByMeTab, setAssignedByMeTab] = useState<MyWorkTab>("all");
  const [filters, setFilters] = useState<MyWorkFilters>(createDefaultFilters);
  const [assignedByMeFilters, setAssignedByMeFilters] = useState<AssignedByMeFilters>(
    createDefaultAssignedByMeFilters
  );
  const [focusedTaskKeys, setFocusedTaskKeys] = useState<string[]>([]);
  const [customTodos, setCustomTodos] = useState<MyWorkCustomTodo[]>([]);
  const [directTasks, setDirectTasks] = useState<DirectTask[]>([]);
  const [loggedPeople, setLoggedPeople] = useState<string[]>([]);

  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [createTaskTarget, setCreateTaskTarget] = useState<string>("individual");
  const [createTaskTitle, setCreateTaskTitle] = useState("");
  const [createTaskDescription, setCreateTaskDescription] = useState("");
  const [createTaskDueDate, setCreateTaskDueDate] = useState("");
  const [createTaskAssignee, setCreateTaskAssignee] = useState<string>(UNASSIGNED_VALUE);
  const [createTaskHoursAssigned, setCreateTaskHoursAssigned] = useState("0");
  const [createTaskPriority, setCreateTaskPriority] =
    useState<MarketingTaskPriority>("Medium");
  const [createTaskBlockerReason, setCreateTaskBlockerReason] = useState("");
  const [createTaskDependencyTaskIds, setCreateTaskDependencyTaskIds] = useState<
    string[]
  >([]);
  const [isCreateTaskDependenciesOpen, setIsCreateTaskDependenciesOpen] =
    useState(false);
  const [createTaskIsRecurring, setCreateTaskIsRecurring] = useState(false);
  const [createTaskRecurringDays, setCreateTaskRecurringDays] = useState<
    MarketingRecurringWeekday[]
  >([]);
  const [
    createTaskRecurringTimePerOccurrenceHours,
    setCreateTaskRecurringTimePerOccurrenceHours,
  ] = useState("0");
  const [isCreateTaskSubtasksEnabled, setIsCreateTaskSubtasksEnabled] =
    useState(false);
  const [createTaskSubtasks, setCreateTaskSubtasks] = useState<MarketingSubtask[]>(
    []
  );
  const [newCreateTaskSubtaskTitle, setNewCreateTaskSubtaskTitle] = useState("");

  const [newCustomTodoTitle, setNewCustomTodoTitle] = useState("");
  const [newCustomTodoHours, setNewCustomTodoHours] = useState("");
  const [loadedPreferencesForUser, setLoadedPreferencesForUser] = useState("");

  const [modalTaskKey, setModalTaskKey] = useState<string | null>(null);
  const [modalTaskTitle, setModalTaskTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [modalDueDate, setModalDueDate] = useState("");
  const [modalStatus, setModalStatus] = useState<MarketingTaskStatus>("To Do");
  const [modalPriority, setModalPriority] = useState<MarketingTaskPriority>("Medium");
  const [modalAssignee, setModalAssignee] = useState<string>(UNASSIGNED_VALUE);
  const [modalHoursAssigned, setModalHoursAssigned] = useState("0");
  const [modalBlockerReason, setModalBlockerReason] = useState("");
  const [modalDependencyTaskIds, setModalDependencyTaskIds] = useState<string[]>([]);
  const [isModalDependenciesOpen, setIsModalDependenciesOpen] = useState(false);
  const [modalTimeSpent, setModalTimeSpent] = useState("0");
  const [modalSubtasks, setModalSubtasks] = useState<MarketingSubtask[]>([]);
  const [newModalSubtaskTitle, setNewModalSubtaskTitle] = useState("");
  const [modalIsRecurringTask, setModalIsRecurringTask] = useState(false);
  const [modalRecurringDays, setModalRecurringDays] = useState<MarketingRecurringWeekday[]>([]);
  const [modalRecurringTimePerOccurrenceHours, setModalRecurringTimePerOccurrenceHours] =
    useState("0");
  const [modalRecurringCompletions, setModalRecurringCompletions] =
    useState<MarketingRecurringCompletions>({});
  const [customTodoModalId, setCustomTodoModalId] = useState<string | null>(null);
  const [customTodoModalTitle, setCustomTodoModalTitle] = useState("");
  const [customTodoModalHours, setCustomTodoModalHours] = useState("0");
  const [customTodoModalDone, setCustomTodoModalDone] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const focusRef = useRef<HTMLElement | null>(null);
  const queueRef = useRef<HTMLElement | null>(null);

  const todayIsoDate = useMemo(() => getTodayIsoDate(), []);
  const todayMs = getDateMsFromIsoDate(todayIsoDate) ?? 0;
  const todayWeekday = getWeekdayFromDate(new Date(todayMs));
  const weekEndIsoDate = addDaysToIsoDate(todayIsoDate, 6);

  const currentWeekDates = useMemo(
    () => getWeekDatesForReference(todayMs),
    [todayMs]
  );

  const directTaskMembers = useMemo<MarketingMember[]>(() => {
    return loggedPeople.map((name, index) => ({
      id: `direct-member-${index}-${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      hoursAllocated: 0,
      source: "internal",
      userId: null,
    }));
  }, [loggedPeople]);

  const taskEntries = useMemo(() => {
    if (!userName) {
      return [] as TaskEntry[];
    }

    const projectById = new Map(projects.map((project) => [project.id, project]));
    const entries: TaskEntry[] = [];

    Object.entries(tasksByProject).forEach(([projectId, tasks]) => {
      const project = projectById.get(projectId);
      if (!project) {
        return;
      }

      const members = membersByProject[projectId] ?? [];
      sortTasksInStatus(tasks).forEach((task) => {
        if (task.assignee !== userName) {
          return;
        }

        entries.push({
          key: getTaskKey(projectId, task.id),
          source: "project",
          projectId,
          projectName: project.name,
          projectHref: `/marketing/projects/${projectId}`,
          contextLabel: project.name,
          members,
          task,
        });
      });
    });

    sortTasksInStatus(directTasks).forEach((task) => {
      if ((task.assignee ?? "").trim().toLowerCase() !== userName.trim().toLowerCase()) {
        return;
      }

      const assignedBy = task.assignedByName ?? "Unknown";
      entries.push({
        key: getTaskKey(DIRECT_TASK_PROJECT_ID, task.id),
        source: "direct",
        projectId: DIRECT_TASK_PROJECT_ID,
        projectName: `Direct assignment by ${assignedBy}`,
        projectHref: null,
        contextLabel: `Direct assignment by ${assignedBy}`,
        members: directTaskMembers,
        task,
      });
    });

    return entries;
  }, [directTaskMembers, directTasks, membersByProject, projects, tasksByProject, userName]);

  const summaryAssignedTasks = useMemo(() => {
    const normalizedUserName = userName.trim().toLowerCase();
    if (!normalizedUserName) {
      return [] as SummaryAssignedTask[];
    }

    const summaryTasks: SummaryAssignedTask[] = taskEntries
      .filter((entry) => entry.source === "project")
      .map((entry) => ({
        stream: "Marketing" as const,
        projectId: entry.projectId,
        projectName: entry.projectName,
        dueDate: entry.task.dueDate,
        status: entry.task.status,
      }));

    const developmentProjectById = new Map(
      developmentProjects.map((project) => [project.id, project])
    );
    Object.entries(developmentTasksByProject).forEach(([projectId, projectTasks]) => {
      const project = developmentProjectById.get(projectId);
      if (!project) {
        return;
      }

      projectTasks.forEach((task) => {
        if ((task.assignee ?? "").trim().toLowerCase() !== normalizedUserName) {
          return;
        }

        summaryTasks.push({
          stream: "Development",
          projectId,
          projectName: project.name,
          dueDate: task.dueDate,
          status: task.status as MarketingTaskStatus,
        });
      });
    });

    return summaryTasks;
  }, [developmentProjects, developmentTasksByProject, taskEntries, userName]);

  const summaryStatusCounts = useMemo(() => {
    const counts: Record<MarketingTaskStatus, number> = {
      "To Do": 0,
      "In Progress": 0,
      Review: 0,
      Done: 0,
    };

    summaryAssignedTasks.forEach((task) => {
      counts[task.status] += 1;
    });

    return counts;
  }, [summaryAssignedTasks]);

  const summaryProjects = useMemo(() => {
    const byProjectKey = new Map<
      string,
      {
        stream: MyWorkSummaryStream;
        projectId: string;
        projectName: string;
        total: number;
        open: number;
        overdue: number;
      }
    >();

    summaryAssignedTasks.forEach((task) => {
      const key = `${task.stream}:${task.projectId}`;
      const current =
        byProjectKey.get(key) ??
        {
          stream: task.stream,
          projectId: task.projectId,
          projectName: task.projectName,
          total: 0,
          open: 0,
          overdue: 0,
        };

      current.total += 1;
      if (task.status !== "Done") {
        current.open += 1;
        if (task.dueDate && task.dueDate < todayIsoDate) {
          current.overdue += 1;
        }
      }

      byProjectKey.set(key, current);
    });

    return [...byProjectKey.values()].sort((firstProject, secondProject) => {
      if (firstProject.open !== secondProject.open) {
        return secondProject.open - firstProject.open;
      }
      if (firstProject.overdue !== secondProject.overdue) {
        return secondProject.overdue - firstProject.overdue;
      }
      return firstProject.projectName.localeCompare(secondProject.projectName);
    });
  }, [summaryAssignedTasks, todayIsoDate]);

  const assignedByMeEntries = useMemo(() => {
    const normalizedUserName = userName.trim().toLowerCase();
    if (!normalizedUserName) {
      return [] as AssignedByMeEntry[];
    }

    const projectById = new Map(projects.map((project) => [project.id, project]));
    const entries: AssignedByMeEntry[] = [];

    Object.entries(tasksByProject).forEach(([projectId, projectTasks]) => {
      const project = projectById.get(projectId);
      if (!project) {
        return;
      }

      projectTasks.forEach((task) => {
        if (
          (task.assignedByName ?? "").trim().toLowerCase() !== normalizedUserName ||
          !task.assignee ||
          task.status === "Done"
        ) {
          return;
        }

        entries.push({
          key: getTaskKey(projectId, task.id),
          source: "project",
          projectId,
          projectName: project.name,
          projectHref: `/marketing/projects/${projectId}`,
          contextLabel: project.name,
          members: membersByProject[projectId] ?? [],
          task,
        });
      });
    });

    directTasks.forEach((task) => {
      if (
        (task.assignedByName ?? "").trim().toLowerCase() !== normalizedUserName ||
        !task.assignee ||
        task.status === "Done"
      ) {
        return;
      }

      entries.push({
        key: getTaskKey(DIRECT_TASK_PROJECT_ID, task.id),
        source: "direct",
        projectId: DIRECT_TASK_PROJECT_ID,
        projectName: "Individual",
        projectHref: null,
        contextLabel: `Direct assignment by ${task.assignedByName ?? "Unknown"}`,
        members: directTaskMembers,
        task,
      });
    });

    return entries.sort((firstEntry, secondEntry) => {
      if (firstEntry.task.dueDate !== secondEntry.task.dueDate) {
        return firstEntry.task.dueDate.localeCompare(secondEntry.task.dueDate);
      }
      return firstEntry.task.title.localeCompare(secondEntry.task.title);
    });
  }, [directTaskMembers, directTasks, membersByProject, projects, tasksByProject, userName]);

  const filteredAssignedByMeEntries = useMemo(() => {
    const query = assignedByMeFilters.search.trim().toLowerCase();

    return assignedByMeEntries.filter((entry) => {
      if (entry.task.status === "Done") {
        return false;
      }
      if (query) {
        const title = entry.task.title.toLowerCase();
        const description = entry.task.description.toLowerCase();
        if (!title.includes(query) && !description.includes(query)) {
          return false;
        }
      }
      if (
        assignedByMeFilters.status !== ALL_FILTER_VALUE &&
        entry.task.status !== assignedByMeFilters.status
      ) {
        return false;
      }
      if (
        assignedByMeFilters.priority !== ALL_FILTER_VALUE &&
        entry.task.priority !== assignedByMeFilters.priority
      ) {
        return false;
      }
      if (
        !matchesDueFilter(
          entry.task,
          assignedByMeFilters.due,
          todayIsoDate,
          weekEndIsoDate
        )
      ) {
        return false;
      }
      if (
        assignedByMeFilters.onlyBlocked &&
        entry.task.blockerReason.trim().length === 0
      ) {
        return false;
      }
      if (
        assignedByMeFilters.onlyDependent &&
        entry.task.dependencyTaskIds.length === 0
      ) {
        return false;
      }

      return true;
    });
  }, [
    assignedByMeEntries,
    assignedByMeFilters,
    todayIsoDate,
    weekEndIsoDate,
  ]);

  const assignedByMeEntriesByTab = useMemo(() => {
    const byTab: Record<MyWorkTab, AssignedByMeEntry[]> = {
      all: [],
      overdue: [],
      today: [],
      week: [],
      recurring: [],
    };

    filteredAssignedByMeEntries.forEach((entry) => {
      byTab.all.push(entry);
      if (matchesTab(entry.task, "overdue", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.overdue.push(entry);
      }
      if (matchesTab(entry.task, "today", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.today.push(entry);
      }
      if (matchesTab(entry.task, "week", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.week.push(entry);
      }
      if (matchesTab(entry.task, "recurring", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.recurring.push(entry);
      }
    });

    return byTab;
  }, [filteredAssignedByMeEntries, todayIsoDate, todayWeekday, weekEndIsoDate]);

  const currentAssignedByMeEntries = useMemo(() => {
    if (assignedByMeTab === "all") {
      return assignedByMeEntriesByTab.all;
    }
    if (assignedByMeTab === "overdue") {
      return assignedByMeEntriesByTab.overdue;
    }
    if (assignedByMeTab === "today") {
      return assignedByMeEntriesByTab.today;
    }
    if (assignedByMeTab === "week") {
      return assignedByMeEntriesByTab.week;
    }
    return assignedByMeEntriesByTab.recurring;
  }, [assignedByMeEntriesByTab, assignedByMeTab]);

  const taskEntryByKey = useMemo(() => {
    return new Map(
      [...taskEntries, ...assignedByMeEntries].map((entry) => [entry.key, entry])
    );
  }, [assignedByMeEntries, taskEntries]);

  const persistDirectTasks = (nextTasks: DirectTask[]) => {
    void fetch("/api/direct-tasks", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tasks: nextTasks }),
    });
  };

  const createDirectTask = (task: DirectTask) => {
    void fetch("/api/direct-tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task }),
    });
  };

  const deleteDirectTask = (taskId: string) => {
    const searchParams = new URLSearchParams({ id: taskId });
    void fetch(`/api/direct-tasks?${searchParams.toString()}`, {
      method: "DELETE",
    });
  };

  useEffect(() => {
    if (!userName || typeof window === "undefined") {
      return;
    }

    let isMounted = true;

    const loadPreferences = async () => {
      const remotePreference = await fetchUserPreference(MY_WORK_PREFS_NAMESPACE);
      let userPreferences =
        remotePreference !== null
          ? parseMyWorkPreference(remotePreference)
          : createDefaultPreferences();

      if (remotePreference === null) {
        const allPreferences = parseMyWorkPreferencesByUser(
          window.localStorage.getItem(MY_WORK_PREFS_STORAGE_KEY)
        );
        userPreferences = allPreferences[userName] ?? createDefaultPreferences();
      }

      if (!isMounted) {
        return;
      }

      setActiveTab(userPreferences.activeTab);
      setAssignedByMeTab(userPreferences.assignedByMeTab);
      setFilters(userPreferences.filters);
      setAssignedByMeFilters(userPreferences.assignedByMeFilters);
      setFocusedTaskKeys(userPreferences.focusedTaskKeys);
      setCustomTodos(userPreferences.customTodos);
      setLoadedPreferencesForUser(userName);
    };

    void loadPreferences();

    return () => {
      isMounted = false;
    };
  }, [userName]);

  useEffect(() => {
    let isMounted = true;

    const loadLoggedPeople = async () => {
      try {
        const response = await fetch("/api/auth/people", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          users?: Array<{ name?: unknown }>;
        };

        if (!response.ok || !Array.isArray(payload.users)) {
          if (isMounted) {
            setLoggedPeople(userName ? [userName] : []);
          }
          return;
        }

        const names = payload.users
          .map((user) =>
            typeof user.name === "string" ? user.name.trim() : ""
          )
          .filter((name) => name.length > 0);
        if (userName && !names.includes(userName)) {
          names.unshift(userName);
        }

        if (isMounted) {
          setLoggedPeople([...new Set(names)].sort((a, b) => a.localeCompare(b)));
        }
      } catch {
        if (isMounted) {
          setLoggedPeople(userName ? [userName] : []);
        }
      }
    };

    void loadLoggedPeople();
    return () => {
      isMounted = false;
    };
  }, [userName]);

  useEffect(() => {
    let isMounted = true;

    const loadDirectTasks = async () => {
      try {
        const response = await fetch("/api/direct-tasks", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as {
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
    if (
      !userName ||
      loadedPreferencesForUser !== userName ||
      typeof window === "undefined"
    ) {
      return;
    }

    const nextPreference: MyWorkUserPreferences = {
      activeTab,
      assignedByMeTab,
      filters,
      assignedByMeFilters,
      focusedTaskKeys,
      customTodos,
    };
    const timeoutId = window.setTimeout(() => {
      void saveUserPreference(MY_WORK_PREFS_NAMESPACE, nextPreference);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeTab,
    assignedByMeTab,
    assignedByMeFilters,
    customTodos,
    filters,
    focusedTaskKeys,
    loadedPreferencesForUser,
    userName,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (deleteTarget) {
        setDeleteTarget(null);
        return;
      }

      if (modalTaskKey) {
        setModalTaskKey(null);
        setDeleteTarget(null);
        return;
      }

      if (customTodoModalId) {
        setCustomTodoModalId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [customTodoModalId, deleteTarget, modalTaskKey]);

  const unresolvedDependencyCountByTaskKey = useMemo(() => {
    const counts = new Map<string, number>();

    Object.entries(tasksByProject).forEach(([projectId, projectTasks]) => {
      const statusByTaskId = new Map(
        projectTasks.map((task) => [task.id, task.status] as const)
      );

      projectTasks.forEach((task) => {
        const unresolvedDependencies = task.dependencyTaskIds.reduce((count, dependencyId) => {
          const dependencyStatus = statusByTaskId.get(dependencyId);
          if (!dependencyStatus || dependencyStatus !== "Done") {
            return count + 1;
          }
          return count;
        }, 0);

        counts.set(getTaskKey(projectId, task.id), unresolvedDependencies);
      });
    });

    const directStatusByTaskId = new Map(
      directTasks.map((task) => [task.id, task.status] as const)
    );
    directTasks.forEach((task) => {
      const unresolvedDependencies = task.dependencyTaskIds.reduce(
        (count, dependencyId) => {
          const dependencyStatus = directStatusByTaskId.get(dependencyId);
          if (!dependencyStatus || dependencyStatus !== "Done") {
            return count + 1;
          }
          return count;
        },
        0
      );

      counts.set(getTaskKey(DIRECT_TASK_PROJECT_ID, task.id), unresolvedDependencies);
    });

    return counts;
  }, [directTasks, tasksByProject]);

  const filteredEntries = useMemo(() => {
    return taskEntries.filter((entry) => {
      if (entry.task.status === "Done") {
        return false;
      }

      if (!matchesFilters(entry.task, filters, todayIsoDate, weekEndIsoDate)) {
        return false;
      }

      const unresolvedDependencies =
        unresolvedDependencyCountByTaskKey.get(entry.key) ?? 0;

      if (filters.onlyBlocked && entry.task.blockerReason.trim().length === 0) {
        return false;
      }

      if (filters.onlyDependent && unresolvedDependencies === 0) {
        return false;
      }

      return true;
    });
  }, [
    filters,
    taskEntries,
    todayIsoDate,
    unresolvedDependencyCountByTaskKey,
    weekEndIsoDate,
  ]);

  const sortedFilteredEntries = useMemo(() => {
    return [...filteredEntries].sort((firstEntry, secondEntry) => {
      const firstDueDate = firstEntry.task.dueDate || "9999-12-31";
      const secondDueDate = secondEntry.task.dueDate || "9999-12-31";
      if (firstDueDate !== secondDueDate) {
        return firstDueDate.localeCompare(secondDueDate);
      }

      const priorityDiff =
        getPriorityWeight(firstEntry.task.priority) -
        getPriorityWeight(secondEntry.task.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return firstEntry.task.title.localeCompare(secondEntry.task.title);
    });
  }, [filteredEntries]);

  const queueEntriesByTab = useMemo(() => {
    const byTab: Record<MyWorkTab, TaskEntry[]> = {
      all: [],
      overdue: [],
      today: [],
      week: [],
      recurring: [],
    };

    sortedFilteredEntries.forEach((entry) => {
      byTab.all.push(entry);
      if (matchesTab(entry.task, "overdue", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.overdue.push(entry);
      }
      if (matchesTab(entry.task, "today", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.today.push(entry);
      }
      if (matchesTab(entry.task, "week", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.week.push(entry);
      }
      if (matchesTab(entry.task, "recurring", todayIsoDate, weekEndIsoDate, todayWeekday)) {
        byTab.recurring.push(entry);
      }
    });

    return byTab;
  }, [sortedFilteredEntries, todayIsoDate, todayWeekday, weekEndIsoDate]);

  const allEntries = queueEntriesByTab.all;
  const overdueEntries = queueEntriesByTab.overdue;
  const todayEntries = queueEntriesByTab.today;
  const weekEntries = queueEntriesByTab.week;
  const recurringEntries = queueEntriesByTab.recurring;

  const overdueCount = useMemo(
    () =>
      taskEntries.filter(
        (entry) =>
          Boolean(entry.task.dueDate) &&
          entry.task.dueDate < todayIsoDate &&
          entry.task.status !== "Done"
      ).length,
    [taskEntries, todayIsoDate]
  );

  const dueTodayCount = useMemo(
    () =>
      taskEntries.filter(
        (entry) => entry.task.dueDate === todayIsoDate && entry.task.status !== "Done"
      ).length,
    [taskEntries, todayIsoDate]
  );

  const dueThisWeekCount = useMemo(
    () =>
      taskEntries.filter(
        (entry) =>
          Boolean(entry.task.dueDate) &&
          entry.task.dueDate > todayIsoDate &&
          entry.task.dueDate <= weekEndIsoDate &&
          entry.task.status !== "Done"
      ).length,
    [taskEntries, todayIsoDate, weekEndIsoDate]
  );

  const recurringTodayCount = useMemo(
    () =>
      taskEntries.filter((entry) => {
        if (!isRecurringForDate(entry.task, todayIsoDate, todayWeekday)) {
          return false;
        }

        return entry.task.recurringCompletions[todayIsoDate] !== true;
      }).length,
    [taskEntries, todayIsoDate, todayWeekday]
  );

  const highPriorityOpenCount = useMemo(
    () =>
      taskEntries.filter(
        (entry) => entry.task.priority === "High" && entry.task.status !== "Done"
      ).length,
    [taskEntries]
  );

  const blockedCount = useMemo(
    () =>
      taskEntries.filter((entry) => {
        if (entry.task.status === "Done") {
          return false;
        }

        const unresolvedDependencies =
          unresolvedDependencyCountByTaskKey.get(entry.key) ?? 0;
        return (
          entry.task.blockerReason.trim().length > 0 || unresolvedDependencies > 0
        );
      }).length,
    [taskEntries, unresolvedDependencyCountByTaskKey]
  );

  const openAssignedCount = useMemo(
    () => taskEntries.filter((entry) => entry.task.status !== "Done").length,
    [taskEntries]
  );

  const totalAssignedHoursOpen = useMemo(
    () =>
      taskEntries
        .filter((entry) => entry.task.status !== "Done")
        .reduce((sum, entry) => sum + entry.task.hoursAssigned, 0),
    [taskEntries]
  );

  const totalTimeSpentOpen = useMemo(
    () =>
      taskEntries
        .filter((entry) => entry.task.status !== "Done")
        .reduce((sum, entry) => sum + entry.task.timeSpent, 0),
    [taskEntries]
  );

  const utilizationPercent = useMemo(() => {
    if (totalAssignedHoursOpen <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.round((totalTimeSpentOpen / totalAssignedHoursOpen) * 100)
    );
  }, [totalAssignedHoursOpen, totalTimeSpentOpen]);

  const focusedTaskEntries = useMemo(() => {
    return focusedTaskKeys
      .map((taskKey) => taskEntryByKey.get(taskKey) ?? null)
      .filter((entry): entry is TaskEntry => entry !== null)
      .filter((entry) => entry.task.status !== "Done")
      .sort((firstEntry, secondEntry) => {
        const firstDueDate = firstEntry.task.dueDate || "9999-12-31";
        const secondDueDate = secondEntry.task.dueDate || "9999-12-31";
        if (firstDueDate !== secondDueDate) {
          return firstDueDate.localeCompare(secondDueDate);
        }
        return firstEntry.task.title.localeCompare(secondEntry.task.title);
      });
  }, [focusedTaskKeys, taskEntryByKey]);

  const modalEntry = modalTaskKey ? taskEntryByKey.get(modalTaskKey) ?? null : null;
  const modalProjectTasks = useMemo(() => {
    if (!modalEntry) {
      return [] as MarketingTask[];
    }
    if (modalEntry.projectId === DIRECT_TASK_PROJECT_ID) {
      return directTasks;
    }
    return tasksByProject[modalEntry.projectId] ?? [];
  }, [directTasks, modalEntry, tasksByProject]);
  const parsedModalTaskKey = modalTaskKey ? parseTaskKey(modalTaskKey) : null;
  const modalTaskId = parsedModalTaskKey?.taskId ?? null;
  const modalAssigneeOptions = useMemo(() => {
    const options = new Set<string>();
    const modalProjectMembers = modalEntry?.members ?? [];

    modalProjectMembers.forEach((member) => {
      if (member.name.trim()) {
        options.add(member.name.trim());
      }
    });
    loggedPeople.forEach((personName) => {
      if (personName.trim()) {
        options.add(personName.trim());
      }
    });
    if (userName.trim()) {
      options.add(userName.trim());
    }
    if (modalAssignee !== UNASSIGNED_VALUE && modalAssignee.trim()) {
      options.add(modalAssignee.trim());
    }

    return [...options].sort((firstName, secondName) =>
      firstName.localeCompare(secondName)
    );
  }, [loggedPeople, modalAssignee, modalEntry, userName]);

  const modalRecurringWeekDates = useMemo(() => {
    if (!modalIsRecurringTask) {
      return [] as WeekDateEntry[];
    }

    return currentWeekDates.filter(
      (day) =>
        modalRecurringDays.includes(day.weekday) &&
        (!modalDueDate || day.date <= modalDueDate)
    );
  }, [currentWeekDates, modalDueDate, modalIsRecurringTask, modalRecurringDays]);

  const currentQueueEntries = useMemo(() => {
    if (activeTab === "all") {
      return allEntries;
    }
    if (activeTab === "overdue") {
      return overdueEntries;
    }
    if (activeTab === "today") {
      return todayEntries;
    }
    if (activeTab === "week") {
      return weekEntries;
    }
    return recurringEntries;
  }, [activeTab, allEntries, overdueEntries, recurringEntries, todayEntries, weekEntries]);
  const sortedQueueEntries = useMemo(() => {
    return [...currentQueueEntries].sort((firstEntry, secondEntry) => {
      const firstDueDate = firstEntry.task.dueDate || "9999-12-31";
      const secondDueDate = secondEntry.task.dueDate || "9999-12-31";
      if (firstDueDate !== secondDueDate) {
        return firstDueDate.localeCompare(secondDueDate);
      }

      const priorityDiff =
        getPriorityWeight(firstEntry.task.priority) -
        getPriorityWeight(secondEntry.task.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return firstEntry.task.title.localeCompare(secondEntry.task.title);
    });
  }, [currentQueueEntries]);

  const createTaskTargetOptions = useMemo(() => {
    return [
      { value: "individual", label: "Individual (Direct assignment)" },
      ...projects.map((project) => ({
        value: `marketing:${project.id}`,
        label: `Project: ${project.name}`,
      })),
    ];
  }, [projects]);

  const createTaskTargetProjectId = createTaskTarget.startsWith("marketing:")
    ? createTaskTarget.slice("marketing:".length)
    : null;

  const createTaskAssigneeOptions = useMemo(() => {
    const options = new Set<string>();
    loggedPeople.forEach((personName) => {
      if (personName.trim()) {
        options.add(personName.trim());
      }
    });
    if (userName.trim()) {
      options.add(userName.trim());
    }
    return [...options].sort((firstName, secondName) =>
      firstName.localeCompare(secondName)
    );
  }, [loggedPeople, userName]);

  const createTaskDependencyCandidates = useMemo(() => {
    if (createTaskTarget === "individual") {
      return directTasks;
    }

    if (!createTaskTargetProjectId) {
      return [] as MarketingTask[];
    }

    return tasksByProject[createTaskTargetProjectId] ?? [];
  }, [createTaskTarget, createTaskTargetProjectId, directTasks, tasksByProject]);

  const closeCreateTaskModal = () => {
    setIsCreateTaskModalOpen(false);
    setCreateTaskTarget("individual");
    setCreateTaskTitle("");
    setCreateTaskDescription("");
    setCreateTaskDueDate("");
    setCreateTaskAssignee(UNASSIGNED_VALUE);
    setCreateTaskHoursAssigned("0");
    setCreateTaskPriority("Medium");
    setCreateTaskBlockerReason("");
    setCreateTaskDependencyTaskIds([]);
    setIsCreateTaskDependenciesOpen(false);
    setCreateTaskIsRecurring(false);
    setCreateTaskRecurringDays([]);
    setCreateTaskRecurringTimePerOccurrenceHours("0");
    setIsCreateTaskSubtasksEnabled(false);
    setCreateTaskSubtasks([]);
    setNewCreateTaskSubtaskTitle("");
  };

  const toggleCreateTaskDependency = (taskId: string) => {
    setCreateTaskDependencyTaskIds((currentTaskIds) =>
      currentTaskIds.includes(taskId)
        ? currentTaskIds.filter((currentTaskId) => currentTaskId !== taskId)
        : [...currentTaskIds, taskId]
    );
  };

  const toggleCreateTaskRecurringDay = (day: MarketingRecurringWeekday) => {
    setCreateTaskRecurringDays((currentDays) =>
      currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : [...currentDays, day]
    );
  };

  const addCreateTaskSubtask = () => {
    const trimmedTitle = newCreateTaskSubtaskTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    setCreateTaskSubtasks((currentSubtasks) => [
      ...currentSubtasks,
      {
        id: createMarketingSubtaskId(),
        title: trimmedTitle,
        done: false,
      },
    ]);
    setNewCreateTaskSubtaskTitle("");
  };

  const toggleCreateTaskSubtask = (subtaskId: string) => {
    setCreateTaskSubtasks((currentSubtasks) =>
      currentSubtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
      )
    );
  };

  const removeCreateTaskSubtask = (subtaskId: string) => {
    setCreateTaskSubtasks((currentSubtasks) =>
      currentSubtasks.filter((subtask) => subtask.id !== subtaskId)
    );
  };

  const submitCreateTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = createTaskTitle.trim();
    if (!trimmedTitle || !createTaskDueDate) {
      return;
    }
    const parsedHoursAssigned = Number(createTaskHoursAssigned);
    if (!Number.isFinite(parsedHoursAssigned) || parsedHoursAssigned < 0) {
      return;
    }
    const parsedRecurringHours = Number(createTaskRecurringTimePerOccurrenceHours);
    if (!Number.isFinite(parsedRecurringHours) || parsedRecurringHours < 0) {
      return;
    }

    const resolvedAssignee =
      createTaskAssignee === UNASSIGNED_VALUE || !createTaskAssignee
        ? userName
        : createTaskAssignee;
    const validDependencyTaskIds = [...new Set(createTaskDependencyTaskIds)];
    const recurringDays = createTaskIsRecurring ? createTaskRecurringDays : [];
    const recurringTimePerOccurrenceHours = createTaskIsRecurring
      ? parsedRecurringHours
      : 0;
    const subtasks = isCreateTaskSubtasksEnabled ? createTaskSubtasks : [];
    const nowIso = new Date().toISOString();

    if (createTaskTarget === "individual") {
      const newDirectTask: DirectTask = {
        id: createDirectTaskId(),
        createdAt: todayIsoDate,
        assignedByName: userName || null,
        assignedByUserId: null,
        assignedAtIso: nowIso,
        title: trimmedTitle,
        description: createTaskDescription.trim(),
        dueDate: createTaskDueDate,
        status: "To Do",
        order: directTasks.filter((task) => task.status === "To Do").length,
        assignee: resolvedAssignee || null,
        hoursAssigned: parsedHoursAssigned,
        blockerReason: createTaskBlockerReason.trim(),
        dependencyTaskIds: validDependencyTaskIds,
        timeSpent: 0,
        priority: createTaskPriority,
        subtasks,
        isRecurring: createTaskIsRecurring,
        recurringDays,
        recurringTimePerOccurrenceHours,
        recurringCompletions: {},
      };

      setDirectTasks((currentTasks) => [newDirectTask, ...currentTasks]);
      createDirectTask(newDirectTask);
      closeCreateTaskModal();
      return;
    }

    if (!createTaskTargetProjectId) {
      return;
    }

    const nextTask: MarketingTask = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: todayIsoDate,
      assignedByName: resolvedAssignee ? userName : null,
      assignedByUserId: null,
      assignedAtIso: resolvedAssignee ? nowIso : null,
      title: trimmedTitle,
      description: createTaskDescription.trim(),
      dueDate: createTaskDueDate,
      status: "To Do",
      order: (tasksByProject[createTaskTargetProjectId] ?? []).filter(
        (task) => task.status === "To Do"
      ).length,
      assignee: resolvedAssignee || null,
      hoursAssigned: parsedHoursAssigned,
      blockerReason: createTaskBlockerReason.trim(),
      dependencyTaskIds: validDependencyTaskIds,
      timeSpent: 0,
      priority: createTaskPriority,
      subtasks,
      isRecurring: createTaskIsRecurring,
      recurringDays,
      recurringTimePerOccurrenceHours,
      recurringCompletions: {},
    };

    const projectTasks = tasksByProject[createTaskTargetProjectId] ?? [];
    writeMarketingTasksForProject(createTaskTargetProjectId, [...projectTasks, nextTask]);
    const projectName =
      projects.find((project) => project.id === createTaskTargetProjectId)?.name ??
      createTaskTargetProjectId;
    void recordTaskAssignmentEvent({
      workstream: "marketing",
      projectId: createTaskTargetProjectId,
      projectName,
      taskId: nextTask.id,
      taskTitle: nextTask.title,
      fromAssignee: null,
      toAssignee: nextTask.assignee,
      fromHoursAssigned: 0,
      toHoursAssigned: nextTask.hoursAssigned,
      reason: "my-work-create-task",
    });
    closeCreateTaskModal();
  };

  const openQueueTab = (tab: MyWorkTab) => {
    setActiveTab(tab);
    queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openFocusSection = () => {
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const updateProjectTasks = (
    projectId: string,
    updater: (tasks: MarketingTask[]) => MarketingTask[]
  ) => {
    if (projectId === DIRECT_TASK_PROJECT_ID) {
      setDirectTasks((currentDirectTasks) => {
        const previousById = new Map(
          currentDirectTasks.map((task) => [task.id, task] as const)
        );
        const nextTasks = updater(currentDirectTasks).map((task) => ({
          ...task,
          assignedByName: previousById.get(task.id)?.assignedByName ?? task.assignedByName,
          assignedByUserId:
            previousById.get(task.id)?.assignedByUserId ?? task.assignedByUserId,
          assignedAtIso: previousById.get(task.id)?.assignedAtIso ?? task.assignedAtIso,
        }));
        const nextTaskIdSet = new Set(nextTasks.map((task) => task.id));
        currentDirectTasks.forEach((task) => {
          if (!nextTaskIdSet.has(task.id)) {
            deleteDirectTask(task.id);
          }
        });
        persistDirectTasks(nextTasks);
        return nextTasks;
      });
      return;
    }

    const currentTasks = tasksByProject[projectId] ?? [];
    writeMarketingTasksForProject(projectId, updater(currentTasks));
  };

  const removeTaskFromFocus = (taskKey: string) => {
    setFocusedTaskKeys((currentKeys) =>
      currentKeys.filter((currentKey) => currentKey !== taskKey)
    );
  };

  const toggleTaskFocus = (taskKey: string) => {
    setFocusedTaskKeys((currentKeys) =>
      currentKeys.includes(taskKey)
        ? currentKeys.filter((currentKey) => currentKey !== taskKey)
        : [...currentKeys, taskKey]
    );
  };

  const addCustomTodo = () => {
    const trimmedTitle = newCustomTodoTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    const parsedHours = Number(newCustomTodoHours);
    const safeHours =
      Number.isFinite(parsedHours) && parsedHours >= 0 ? parsedHours : 0;

    const nextTodo: MyWorkCustomTodo = {
      id: createMyWorkCustomTodoId(),
      title: trimmedTitle,
      hours: safeHours,
      done: false,
    };

    setCustomTodos((currentTodos) => [...currentTodos, nextTodo]);
    setNewCustomTodoTitle("");
    setNewCustomTodoHours("");
  };

  const removeCustomTodo = (todoId: string) => {
    setCustomTodos((currentTodos) =>
      currentTodos.filter((todo) => todo.id !== todoId)
    );
  };

  const openCustomTodoModal = (todo: MyWorkCustomTodo) => {
    setModalTaskKey(null);
    setDeleteTarget(null);
    setCustomTodoModalId(todo.id);
    setCustomTodoModalTitle(todo.title);
    setCustomTodoModalHours(String(todo.hours));
    setCustomTodoModalDone(todo.done);
  };

  function closeCustomTodoModal() {
    setCustomTodoModalId(null);
    setCustomTodoModalTitle("");
    setCustomTodoModalHours("0");
    setCustomTodoModalDone(false);
  }

  const saveCustomTodoModal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customTodoModalId) {
      return;
    }

    const trimmedTitle = customTodoModalTitle.trim();
    const parsedHours = Number(customTodoModalHours);
    if (!trimmedTitle || !Number.isFinite(parsedHours) || parsedHours < 0) {
      return;
    }

    setCustomTodos((currentTodos) =>
      currentTodos.map((todo) =>
        todo.id === customTodoModalId
          ? {
              ...todo,
              title: trimmedTitle,
              hours: parsedHours,
              done: customTodoModalDone,
            }
          : todo
      )
    );

    closeCustomTodoModal();
  };

  const deleteCustomTodoModal = () => {
    if (!customTodoModalId) {
      return;
    }

    removeCustomTodo(customTodoModalId);
    closeCustomTodoModal();
  };

  const openTaskModal = (entry: TaskEntry) => {
    setCustomTodoModalId(null);
    setModalTaskKey(entry.key);
    setModalTaskTitle(entry.task.title);
    setModalDescription(entry.task.description);
    setModalDueDate(entry.task.dueDate);
    setModalStatus(entry.task.status);
    setModalPriority(entry.task.priority);
    setModalAssignee(entry.task.assignee ?? UNASSIGNED_VALUE);
    setModalHoursAssigned(String(entry.task.hoursAssigned));
    setModalBlockerReason(entry.task.blockerReason);
    setModalDependencyTaskIds(entry.task.dependencyTaskIds);
    setIsModalDependenciesOpen(false);
    setModalTimeSpent(String(entry.task.timeSpent));
    setModalSubtasks(entry.task.subtasks);
    setNewModalSubtaskTitle("");
    setModalIsRecurringTask(entry.task.isRecurring);
    setModalRecurringDays(entry.task.recurringDays);
    setModalRecurringTimePerOccurrenceHours(
      String(entry.task.recurringTimePerOccurrenceHours)
    );
    setModalRecurringCompletions(entry.task.recurringCompletions);
  };

  function closeTaskModal() {
    setModalTaskKey(null);
    setModalTaskTitle("");
    setModalDescription("");
    setModalDueDate("");
    setModalStatus("To Do");
    setModalPriority("Medium");
    setModalAssignee(UNASSIGNED_VALUE);
    setModalHoursAssigned("0");
    setModalBlockerReason("");
    setModalDependencyTaskIds([]);
    setIsModalDependenciesOpen(false);
    setModalTimeSpent("0");
    setModalSubtasks([]);
    setNewModalSubtaskTitle("");
    setModalIsRecurringTask(false);
    setModalRecurringDays([]);
    setModalRecurringTimePerOccurrenceHours("0");
    setModalRecurringCompletions({});
    setDeleteTarget(null);
  }

  const requestDeleteTask = (projectId: string, taskId: string) => {
    setDeleteTarget({ projectId, taskId });
  };

  const confirmDeleteTask = () => {
    if (!deleteTarget) {
      return;
    }

    const modalKey = getTaskKey(deleteTarget.projectId, deleteTarget.taskId);
    updateProjectTasks(deleteTarget.projectId, (projectTasks) =>
      projectTasks.filter((task) => task.id !== deleteTarget.taskId)
    );
    setFocusedTaskKeys((currentKeys) =>
      currentKeys.filter((currentKey) => currentKey !== modalKey)
    );

    if (modalTaskKey === modalKey) {
      closeTaskModal();
    }

    setDeleteTarget(null);
  };

  const setRecurringCompletionForDate = (
    projectId: string,
    taskId: string,
    date: string,
    isDone: boolean
  ) => {
    updateProjectTasks(projectId, (projectTasks) =>
      projectTasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              recurringCompletions: {
                ...task.recurringCompletions,
                [date]: isDone,
              },
            }
          : task
      )
    );
  };

  const markTaskDone = (entry: TaskEntry) => {
    if (entry.task.status === "Done") {
      return;
    }

    updateProjectTasks(entry.projectId, (projectTasks) => {
      const doneCount = projectTasks.filter(
        (task) => task.status === "Done" && task.id !== entry.task.id
      ).length;

      return projectTasks.map((task) =>
        task.id === entry.task.id
          ? {
              ...task,
              status: "Done",
              order: doneCount,
            }
          : task
      );
    });
  };

  const saveModalTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modalTaskKey) {
      return;
    }

    const parsedKey = parseTaskKey(modalTaskKey);
    if (!parsedKey) {
      return;
    }

    const trimmedTitle = modalTaskTitle.trim();
    const parsedHoursAssigned = Number(modalHoursAssigned);
    const parsedTimeSpent = Number(modalTimeSpent);
    const parsedRecurringHours = Number(modalRecurringTimePerOccurrenceHours);
    const normalizedBlockerReason = modalBlockerReason.trim();
    const nextAssignee = modalAssignee === UNASSIGNED_VALUE ? null : modalAssignee;
    const currentProjectTasks = tasksByProject[parsedKey.projectId] ?? [];
    const isDirectTask = parsedKey.projectId === DIRECT_TASK_PROJECT_ID;
    const previousTask = currentProjectTasks.find(
      (task) => task.id === parsedKey.taskId
    );
    const previousDirectTask = directTasks.find(
      (task) => task.id === parsedKey.taskId
    );
    const currentTask = isDirectTask ? previousDirectTask : previousTask;
    if (!currentTask) {
      return;
    }
    const projectName =
      isDirectTask
        ? `Direct assignment by ${currentTask.assignedByName ?? "Unknown"}`
        : projects.find((project) => project.id === parsedKey.projectId)?.name ??
          parsedKey.projectId;

    if (!trimmedTitle || !modalDueDate) {
      return;
    }
    if (!Number.isFinite(parsedHoursAssigned) || parsedHoursAssigned < 0) {
      return;
    }
    if (!Number.isFinite(parsedTimeSpent) || parsedTimeSpent < 0) {
      return;
    }
    if (!Number.isFinite(parsedRecurringHours) || parsedRecurringHours < 0) {
      return;
    }
    const assignmentChanged =
      currentTask.assignee !== nextAssignee ||
      currentTask.hoursAssigned !== parsedHoursAssigned;
    const nowIso = new Date().toISOString();

    updateProjectTasks(parsedKey.projectId, (projectTasks) => {
      const targetTask = projectTasks.find((task) => task.id === parsedKey.taskId);
      if (!targetTask) {
        return projectTasks;
      }

      const statusChanged = targetTask.status !== modalStatus;
      const nextOrder = statusChanged
        ? projectTasks.filter(
            (task) => task.status === modalStatus && task.id !== targetTask.id
          ).length
        : targetTask.order;
      const validDependencyTaskIds = modalDependencyTaskIds.filter(
        (dependencyTaskId) =>
          dependencyTaskId !== parsedKey.taskId &&
          projectTasks.some((task) => task.id === dependencyTaskId)
      );

      return projectTasks.map((task) =>
        task.id === parsedKey.taskId
          ? {
              ...task,
              title: trimmedTitle,
              description: modalDescription.trim(),
              dueDate: modalDueDate,
              status: modalStatus,
              order: nextOrder,
              assignee: nextAssignee,
              hoursAssigned: parsedHoursAssigned,
              blockerReason: normalizedBlockerReason,
              dependencyTaskIds: validDependencyTaskIds,
              timeSpent: parsedTimeSpent,
              priority: modalPriority,
              subtasks: modalSubtasks,
              isRecurring: modalIsRecurringTask,
              recurringDays: modalIsRecurringTask ? modalRecurringDays : [],
              recurringTimePerOccurrenceHours: modalIsRecurringTask
                ? parsedRecurringHours
                : 0,
              recurringCompletions: modalIsRecurringTask
                ? modalRecurringCompletions
                : {},
              assignedByName: assignmentChanged ? userName : targetTask.assignedByName,
              assignedByUserId: assignmentChanged ? null : targetTask.assignedByUserId,
              assignedAtIso: assignmentChanged ? nowIso : targetTask.assignedAtIso,
            }
          : task
      );
    });

    if (!isDirectTask) {
      void recordTaskAssignmentEvent({
        workstream: "marketing",
        projectId: parsedKey.projectId,
        projectName,
        taskId: currentTask.id,
        taskTitle: trimmedTitle,
        fromAssignee: currentTask.assignee,
        toAssignee: nextAssignee,
        fromHoursAssigned: currentTask.hoursAssigned,
        toHoursAssigned: parsedHoursAssigned,
        reason: "my-work-modal-edit",
      });
    }

    closeTaskModal();
  };

  const toggleModalRecurringCompletion = (date: string, nextValue: boolean) => {
    setModalRecurringCompletions((currentCompletions) => ({
      ...currentCompletions,
      [date]: nextValue,
    }));

    const parsedKey = modalTaskKey ? parseTaskKey(modalTaskKey) : null;
    if (!parsedKey) {
      return;
    }

    setRecurringCompletionForDate(parsedKey.projectId, parsedKey.taskId, date, nextValue);
  };

  const addModalSubtask = () => {
    const trimmedTitle = newModalSubtaskTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    setModalSubtasks((currentSubtasks) => [
      ...currentSubtasks,
      {
        id: createMarketingSubtaskId(),
        title: trimmedTitle,
        done: false,
      },
    ]);
    setNewModalSubtaskTitle("");
  };

  const toggleModalSubtask = (subtaskId: string) => {
    setModalSubtasks((currentSubtasks) =>
      currentSubtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
      )
    );
  };

  const removeModalSubtask = (subtaskId: string) => {
    setModalSubtasks((currentSubtasks) =>
      currentSubtasks.filter((subtask) => subtask.id !== subtaskId)
    );
  };

  const toggleModalRecurringDay = (day: MarketingRecurringWeekday) => {
    setModalRecurringDays((currentDays) =>
      currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : [...currentDays, day]
    );
  };

  const toggleModalDependencyTask = (taskId: string) => {
    setModalDependencyTaskIds((currentDependencyTaskIds) =>
      currentDependencyTaskIds.includes(taskId)
        ? currentDependencyTaskIds.filter(
            (currentDependencyTaskId) => currentDependencyTaskId !== taskId
          )
        : [...currentDependencyTaskIds, taskId]
    );
  };

  const clearFilters = () => {
    setFilters(createDefaultFilters());
  };

  const clearAssignedByMeFilters = () => {
    setAssignedByMeFilters(createDefaultAssignedByMeFilters());
  };

  const getEmptyMessage = (tab: MyWorkTab): string => {
    if (tab === "all") {
      return "No open tasks match the current filters.";
    }
    if (tab === "overdue") {
      return "No overdue tasks. Keep it going.";
    }
    if (tab === "today") {
      return "No tasks due today.";
    }
    if (tab === "week") {
      return "Nothing else due this week.";
    }
    return "No recurring tasks for today.";
  };

  if (!isHydrated || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-black/60">Loading...</p>
      </main>
    );
  }

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-slate-100 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              My Work
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {user.name} Command Center
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {todayIsoDate} | {openAssignedCount} open items | {blockedCount} blocked
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => setIsCreateTaskModalOpen(true)}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              <Plus className="h-3.5 w-3.5" />
              Create task
            </button>
            <div className="rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs text-slate-600">
              Prioritize overdue/high-priority work first, then pull from this week.
            </div>
          </div>
        </div>

        <div className="mt-4 h-2 rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${
              utilizationPercent >= 90
                ? "bg-red-500"
                : utilizationPercent >= 70
                  ? "bg-yellow-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${Math.max(0, Math.min(100, utilizationPercent))}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Time tracked vs allocated (open tasks): {formatHours(totalTimeSpentOpen)} /{" "}
          {formatHours(totalAssignedHoursOpen || 0)} ({utilizationPercent}%)
        </p>
      </header>

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
        <button
          type="button"
          onClick={() => openQueueTab("overdue")}
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-left text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Overdue</span>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{overdueCount}</p>
        </button>
        <button
          type="button"
          onClick={() => openQueueTab("today")}
          className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-left text-yellow-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Due today</span>
            <CalendarDays className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{dueTodayCount}</p>
        </button>
        <button
          type="button"
          onClick={() => openQueueTab("week")}
          className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-left text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Due this week</span>
            <CalendarClock className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{dueThisWeekCount}</p>
        </button>
        <button
          type="button"
          onClick={() => openQueueTab("recurring")}
          className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-left text-violet-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Recurring today</span>
            <Repeat className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{recurringTodayCount}</p>
        </button>
        <button
          type="button"
          onClick={openFocusSection}
          className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-left text-orange-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">High priority</span>
            <Flame className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{highPriorityOpenCount}</p>
        </button>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-left text-rose-700 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Blocked</span>
            <BadgeAlert className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{blockedCount}</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <section
            ref={focusRef}
            className="order-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Focus now</h2>
              <span className="text-xs text-slate-500">
                {focusedTaskEntries.length} task
                {focusedTaskEntries.length === 1 ? "" : "s"}
              </span>
            </div>
            {focusedTaskEntries.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No tasks in focus yet. Add from Work queue.
              </p>
            ) : (
              <div className="space-y-3">
                {focusedTaskEntries.map((entry) => {
                  const unresolvedDependencies =
                    unresolvedDependencyCountByTaskKey.get(entry.key) ?? 0;
                  const hasBlocker = entry.task.blockerReason.trim().length > 0;
                  return (
                    <article
                      key={entry.key}
                      className={`rounded-lg border p-3 shadow-sm ${
                        entry.task.dueDate < todayIsoDate && entry.task.status !== "Done"
                          ? "border-red-200 bg-red-50/30"
                          : "border-emerald-200 bg-emerald-50/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{entry.task.title}</p>
                          {entry.projectHref ? (
                            <Link
                              href={entry.projectHref}
                              className="mt-0.5 inline-block text-xs text-blue-700 hover:underline"
                            >
                              {entry.projectName}
                            </Link>
                          ) : (
                            <p className="mt-0.5 text-xs text-slate-600">{entry.contextLabel}</p>
                          )}
                          <p className="mt-1 text-xs text-slate-600">
                            {entry.task.dueDate || "No due date"} | {getDueLabel(entry.task.dueDate, todayIsoDate)}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            Time spent {formatHours(entry.task.timeSpent)} | Allocated{" "}
                            {formatHours(entry.task.hoursAssigned)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                              {getFocusReasonLabel(
                                entry.task,
                                todayIsoDate,
                                weekEndIsoDate
                              )}
                            </span>
                            {hasBlocker ? (
                              <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
                                Blocker
                              </span>
                            ) : null}
                            {unresolvedDependencies > 0 ? (
                              <span className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-700">
                                {unresolvedDependencies} dependency
                                {unresolvedDependencies === 1 ? "" : "ies"} open
                              </span>
                            ) : null}
                            <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
                              In focus
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTaskFromFocus(entry.key)}
                          className="rounded border border-emerald-200 bg-emerald-100 p-1.5 text-emerald-700 hover:bg-emerald-200"
                          title="Remove from focus"
                          aria-label="Remove from focus"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${getStatusBadgeClasses(
                            entry.task.status
                          )}`}
                        >
                          {entry.task.status}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${getPriorityBadgeClasses(
                            entry.task.priority
                          )}`}
                        >
                          {entry.task.priority}
                        </span>
                        <button
                          type="button"
                          onClick={() => openTaskModal(entry)}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTaskFromFocus(entry.key)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                        >
                          <Target className="h-3.5 w-3.5" />
                          Remove focus
                        </button>
                        {entry.task.status !== "Done" ? (
                          <button
                            type="button"
                            onClick={() => markTaskDone(entry)}
                            className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                          >
                            <Check className="h-3.5 w-3.5" /> Mark done
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section
            ref={queueRef}
            className="order-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Work queue</h2>
                <p className="text-xs text-slate-500">
                  {sortedQueueEntries.length} visible
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                {([
                  { id: "all", label: "All", count: allEntries.length },
                  { id: "overdue", label: "Overdue", count: overdueEntries.length },
                  { id: "today", label: "Today", count: todayEntries.length },
                  { id: "week", label: "This week", count: weekEntries.length },
                  { id: "recurring", label: "Recurring", count: recurringEntries.length },
                ] as Array<{ id: MyWorkTab; label: string; count: number }>).map(
                  (tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        activeTab === tab.id
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <div className="relative w-full min-w-[160px] max-w-[220px]">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((currentFilters) => ({
                      ...currentFilters,
                      search: event.target.value,
                    }))
                  }
                  placeholder="Search..."
                  className="h-8 w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-sm outline-none transition focus:border-slate-400"
                />
              </div>
              <select
                value={filters.status}
                onChange={(event) =>
                  setFilters((currentFilters) => ({
                    ...currentFilters,
                    status: event.target.value as MyWorkStatusFilter,
                  }))
                }
                className="h-8 w-[120px] rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Status</option>
                {TASK_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select
                value={filters.priority}
                onChange={(event) =>
                  setFilters((currentFilters) => ({
                    ...currentFilters,
                    priority: event.target.value as MyWorkPriorityFilter,
                  }))
                }
                className="h-8 w-[120px] rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Priority</option>
                {TASK_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <select
                value={filters.due}
                onChange={(event) =>
                  setFilters((currentFilters) => ({
                    ...currentFilters,
                    due: event.target.value as MyWorkDueFilter,
                  }))
                }
                className="h-8 w-[130px] rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Due</option>
                <option value="overdue">Overdue</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="no_due">No due</option>
              </select>
              <details className="group relative">
                <summary className="inline-flex h-8 list-none items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-100">
                  More filters
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                  <label className="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={filters.onlyBlocked}
                      onChange={(event) =>
                        setFilters((currentFilters) => ({
                          ...currentFilters,
                          onlyBlocked: event.target.checked,
                        }))
                      }
                    />
                    Blocked only
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={filters.onlyDependent}
                      onChange={(event) =>
                        setFilters((currentFilters) => ({
                          ...currentFilters,
                          onlyDependent: event.target.checked,
                        }))
                      }
                    />
                    Dependencies
                  </label>
                </div>
              </details>
              <button
                type="button"
                onClick={clearFilters}
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {sortedQueueEntries.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  {getEmptyMessage(activeTab)}
                </p>
              ) : (
                sortedQueueEntries.map((entry) => {
                  const isInFocus = focusedTaskKeys.includes(entry.key);
                  const isRecurringItem =
                    activeTab === "recurring" &&
                    isRecurringForDate(entry.task, todayIsoDate, todayWeekday);
                  const unresolvedDependencies =
                    unresolvedDependencyCountByTaskKey.get(entry.key) ?? 0;
                  const hasBlocker = entry.task.blockerReason.trim().length > 0;
                  const completedSubtasks = entry.task.subtasks.filter(
                    (subtask) => subtask.done
                  ).length;

                  return (
                    <article
                      key={entry.key}
                      onClick={() => openTaskModal(entry)}
                      className={`cursor-pointer rounded-lg border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        entry.task.dueDate < todayIsoDate && entry.task.status !== "Done"
                          ? "border-red-200 bg-red-50/30"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{entry.task.title}</p>
                        <p className="mt-1 text-xs text-slate-600">
                          <span className="text-slate-400">
                            {entry.source === "direct" ? "Source" : "Project"}
                          </span>{" "}
                          ·{" "}
                          {entry.projectHref ? (
                            <Link
                              href={entry.projectHref}
                              onClick={(event) => event.stopPropagation()}
                              className="text-blue-700 hover:underline"
                            >
                              {entry.projectName}
                            </Link>
                          ) : (
                            <span>{entry.contextLabel}</span>
                          )}
                        </p>
                      </div>

                      <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                        <p>
                          <span className="text-slate-400">Status</span>
                          <span
                            className={`ml-1 inline-flex rounded-full border px-2 py-0.5 ${getStatusBadgeClasses(
                              entry.task.status
                            )}`}
                          >
                            {entry.task.status}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-400">Priority</span>
                          <span
                            className={`ml-1 inline-flex rounded-full border px-2 py-0.5 ${getPriorityBadgeClasses(
                              entry.task.priority
                            )}`}
                          >
                            {entry.task.priority}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-400">Due</span>
                          <span className="ml-1">{entry.task.dueDate || "--"}</span>
                        </p>
                        <p>
                          <span className="text-slate-400">Label</span>
                          <span className="ml-1">{getDueLabel(entry.task.dueDate, todayIsoDate)}</span>
                        </p>
                        <p>
                          <span className="text-slate-400">Time spent</span>
                          <span className="ml-1">{formatHours(entry.task.timeSpent)}</span>
                        </p>
                        <p>
                          <span className="text-slate-400">Assignee</span>
                          <span className="ml-1">{entry.task.assignee ?? "Unassigned"}</span>
                        </p>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {hasBlocker ? (
                          <span className="inline-flex rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
                            Blocker
                          </span>
                        ) : null}
                        {unresolvedDependencies > 0 ? (
                          <span className="inline-flex rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-700">
                            {unresolvedDependencies} dependency
                            {unresolvedDependencies === 1 ? "" : "ies"} open
                          </span>
                        ) : null}
                        {entry.task.subtasks.length > 0 ? (
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                            Subtasks {completedSubtasks}/{entry.task.subtasks.length}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleTaskFocus(entry.key);
                          }}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
                            isInFocus
                              ? "border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              : "border-slate-200 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <Target className="h-3.5 w-3.5" />
                          {isInFocus ? "In focus" : "Move to focus"}
                        </button>
                        {entry.task.status !== "Done" ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              markTaskDone(entry);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                          >
                            <Check className="h-3.5 w-3.5" /> Mark done
                          </button>
                        ) : null}
                        {isRecurringItem ? (
                          <label
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={entry.task.recurringCompletions[todayIsoDate] === true}
                              onChange={(event) =>
                                setRecurringCompletionForDate(
                                  entry.projectId,
                                  entry.task.id,
                                  todayIsoDate,
                                  event.target.checked
                                )
                              }
                            />
                            Done today
                          </label>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="order-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Assigned by me</h2>
                <p className="text-xs text-slate-500">
                  {currentAssignedByMeEntries.length} visible
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                {([
                  { id: "all", label: "All", count: assignedByMeEntriesByTab.all.length },
                  {
                    id: "overdue",
                    label: "Overdue",
                    count: assignedByMeEntriesByTab.overdue.length,
                  },
                  {
                    id: "today",
                    label: "Today",
                    count: assignedByMeEntriesByTab.today.length,
                  },
                  {
                    id: "week",
                    label: "This week",
                    count: assignedByMeEntriesByTab.week.length,
                  },
                  {
                    id: "recurring",
                    label: "Recurring",
                    count: assignedByMeEntriesByTab.recurring.length,
                  },
                ] as Array<{ id: MyWorkTab; label: string; count: number }>).map(
                  (tab) => (
                    <button
                      key={`assigned-by-me-tab-${tab.id}`}
                      type="button"
                      onClick={() => setAssignedByMeTab(tab.id)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        assignedByMeTab === tab.id
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <div className="relative w-full min-w-[160px] max-w-[220px]">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={assignedByMeFilters.search}
                  onChange={(event) =>
                    setAssignedByMeFilters((currentFilters) => ({
                      ...currentFilters,
                      search: event.target.value,
                    }))
                  }
                  placeholder="Search..."
                  className="h-8 w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-sm outline-none transition focus:border-slate-400"
                />
              </div>
              <select
                value={assignedByMeFilters.status}
                onChange={(event) =>
                  setAssignedByMeFilters((currentFilters) => ({
                    ...currentFilters,
                    status: event.target.value as MyWorkStatusFilter,
                  }))
                }
                className="h-8 w-[120px] rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Status</option>
                {(["To Do", "In Progress", "Review"] as MarketingTaskStatus[]).map(
                  (status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  )
                )}
              </select>
              <select
                value={assignedByMeFilters.priority}
                onChange={(event) =>
                  setAssignedByMeFilters((currentFilters) => ({
                    ...currentFilters,
                    priority: event.target.value as MyWorkPriorityFilter,
                  }))
                }
                className="h-8 w-[120px] rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Priority</option>
                {TASK_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <select
                value={assignedByMeFilters.due}
                onChange={(event) =>
                  setAssignedByMeFilters((currentFilters) => ({
                    ...currentFilters,
                    due: event.target.value as MyWorkDueFilter,
                  }))
                }
                className="h-8 w-[130px] rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Due</option>
                <option value="overdue">Overdue</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="no_due">No due</option>
              </select>
              <details className="group relative">
                <summary className="inline-flex h-8 list-none items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-100">
                  More filters
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                  <label className="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={assignedByMeFilters.onlyBlocked}
                      onChange={(event) =>
                        setAssignedByMeFilters((currentFilters) => ({
                          ...currentFilters,
                          onlyBlocked: event.target.checked,
                        }))
                      }
                    />
                    Blocked only
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={assignedByMeFilters.onlyDependent}
                      onChange={(event) =>
                        setAssignedByMeFilters((currentFilters) => ({
                          ...currentFilters,
                          onlyDependent: event.target.checked,
                        }))
                      }
                    />
                    Dependencies
                  </label>
                </div>
              </details>
              <button
                type="button"
                onClick={clearAssignedByMeFilters}
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {currentAssignedByMeEntries.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  No active assigned tasks found.
                </p>
              ) : (
                currentAssignedByMeEntries.map((entry) => {
                  const unresolvedDependencies = entry.task.dependencyTaskIds.length;
                  const hasBlocker = entry.task.blockerReason.trim().length > 0;

                  return (
                    <article
                      key={`assigned-by-me-${entry.key}`}
                      onClick={() => openTaskModal(entry)}
                      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{entry.task.title}</p>
                        <p className="mt-1 text-xs text-slate-600">
                          <span className="text-slate-400">
                            {entry.projectHref ? "Project" : "Source"}
                          </span>{" "}
                          ·{" "}
                          {entry.projectHref ? (
                            <Link
                              href={entry.projectHref}
                              onClick={(event) => event.stopPropagation()}
                              className="text-blue-700 hover:underline"
                            >
                              {entry.projectName}
                            </Link>
                          ) : (
                            <span>{entry.contextLabel}</span>
                          )}
                        </p>
                      </div>

                      <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                        <p>
                          <span className="text-slate-400">Assignee</span>
                          <span className="ml-1">{entry.task.assignee ?? "Unassigned"}</span>
                        </p>
                        <p>
                          <span className="text-slate-400">Status</span>
                          <span
                            className={`ml-1 inline-flex rounded-full border px-2 py-0.5 ${getStatusBadgeClasses(
                              entry.task.status
                            )}`}
                          >
                            {entry.task.status}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-400">Priority</span>
                          <span
                            className={`ml-1 inline-flex rounded-full border px-2 py-0.5 ${getPriorityBadgeClasses(
                              entry.task.priority
                            )}`}
                          >
                            {entry.task.priority}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-400">Due</span>
                          <span className="ml-1">{entry.task.dueDate || "--"}</span>
                        </p>
                        <p>
                          <span className="text-slate-400">Assigned</span>
                          <span className="ml-1">{formatHours(entry.task.hoursAssigned)}</span>
                        </p>
                        <p>
                          <span className="text-slate-400">Spent</span>
                          <span className="ml-1">{formatHours(entry.task.timeSpent)}</span>
                        </p>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {hasBlocker ? (
                          <span className="inline-flex rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
                            Blocker
                          </span>
                        ) : null}
                        {unresolvedDependencies > 0 ? (
                          <span className="inline-flex rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-700">
                            {unresolvedDependencies} dependency
                            {unresolvedDependencies === 1 ? "" : "ies"} open
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openTaskModal(entry);
                          }}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Open
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Todo List</h2>
              <span className="text-xs text-slate-500">
                {customTodos.length} item{customTodos.length === 1 ? "" : "s"}
              </span>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                addCustomTodo();
              }}
              className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
            >
              <p className="text-xs font-medium text-slate-600">Quick todo</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_68px_auto]">
                <input
                  type="text"
                  value={newCustomTodoTitle}
                  onChange={(event) => setNewCustomTodoTitle(event.target.value)}
                  placeholder="Add personal task"
                  className="h-8 min-w-0 rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
                />
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newCustomTodoHours}
                  onChange={(event) => setNewCustomTodoHours(event.target.value)}
                  placeholder="h"
                  className="h-8 rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
                />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </form>

            {customTodos.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {customTodos.map((todo) => (
                  <li
                    key={getCustomTodoKey(todo.id)}
                    className="list-none"
                  >
                    <button
                      type="button"
                      onClick={() => openCustomTodoModal(todo)}
                      className={`w-full rounded-md border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow ${
                        todo.done
                          ? "border-emerald-200 bg-emerald-50/60"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {todo.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span>Planned {formatHours(todo.hours)}</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 ${
                                todo.done
                                  ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                  : "border-slate-300 bg-slate-100 text-slate-700"
                              }`}
                            >
                              {todo.done ? "Done" : "Open"}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {customTodos.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-600">
                Add items to plan your day. This list is personal and separate from the work queue.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Work Insights</h2>

            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Project split
              </p>
              {summaryProjects.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-2.5 text-xs text-slate-600">
                  No assigned projects yet.
                </p>
              ) : (
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {summaryProjects.map((project) => (
                    <Link
                      key={`${project.stream}:${project.projectId}`}
                      href={
                        project.stream === "Marketing"
                          ? `/marketing/projects/${project.projectId}`
                          : `/development/projects/${project.projectId}`
                      }
                      className="block rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs hover:bg-slate-100"
                    >
                      <p className="truncate font-medium text-slate-900">{project.projectName}</p>
                      <p className="mt-0.5 text-slate-600">
                        {project.stream} | Open {project.open} | Overdue {project.overdue}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Status breakdown
              </p>
              {(["To Do", "In Progress", "Review", "Done"] as MarketingTaskStatus[]).map(
                (status) => {
                  const count = summaryStatusCounts[status];
                  const total = summaryAssignedTasks.length;
                  const width = total > 0 ? (count / total) * 100 : 0;

                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>{status}</span>
                        <span>{count}</span>
                      </div>
                      <div className="h-1.5 rounded bg-slate-100">
                        <div
                          className="h-1.5 rounded bg-slate-500"
                          style={{ width: `${Math.max(0, width)}%` }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>
        </aside>
      </div>

      {isCreateTaskModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeCreateTaskModal}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
              <h2 className="text-lg font-semibold">Create task</h2>
              <button
                type="button"
                onClick={closeCreateTaskModal}
                className="rounded-md border border-black/15 p-1.5 hover:bg-black/5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submitCreateTask} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <label className="block">
                  <span className="text-sm font-medium">Task destination</span>
                  <select
                    value={createTaskTarget}
                    onChange={(event) => {
                      setCreateTaskTarget(event.target.value);
                      setCreateTaskDependencyTaskIds([]);
                    }}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  >
                    {createTaskTargetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium">Task Title</span>
                  <input
                    type="text"
                    required
                    value={createTaskTitle}
                    onChange={(event) => setCreateTaskTitle(event.target.value)}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium">Description</span>
                  <textarea
                    value={createTaskDescription}
                    onChange={(event) => setCreateTaskDescription(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="text-sm font-medium">Due Date</span>
                    <input
                      type="date"
                      required
                      value={createTaskDueDate}
                      onChange={(event) => setCreateTaskDueDate(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Assignee</span>
                    <select
                      value={createTaskAssignee}
                      onChange={(event) => setCreateTaskAssignee(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm"
                    >
                      <option value={UNASSIGNED_VALUE}>Unassigned (auto assign me)</option>
                      {createTaskAssigneeOptions.map((personName) => (
                        <option key={personName} value={personName}>
                          {personName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Hours Assigned</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={createTaskHoursAssigned}
                      onChange={(event) => setCreateTaskHoursAssigned(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Priority</span>
                    <select
                      value={createTaskPriority}
                      onChange={(event) =>
                        setCreateTaskPriority(event.target.value as MarketingTaskPriority)
                      }
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm"
                    >
                      {TASK_PRIORITY_OPTIONS.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-medium">Blocker (optional)</span>
                  <input
                    type="text"
                    value={createTaskBlockerReason}
                    onChange={(event) => setCreateTaskBlockerReason(event.target.value)}
                    placeholder="Waiting on legal approval, assets, feedback..."
                    className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm"
                  />
                </label>

                <div className="rounded-md border border-black/10 p-3">
                  <button
                    type="button"
                    onClick={() =>
                      setIsCreateTaskDependenciesOpen((isOpen) => !isOpen)
                    }
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <p className="text-sm font-medium">
                      Dependencies
                      {createTaskDependencyTaskIds.length > 0
                        ? ` (${createTaskDependencyTaskIds.length})`
                        : ""}
                    </p>
                    {isCreateTaskDependenciesOpen ? (
                      <ChevronDown className="h-4 w-4 text-black/55" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-black/55" />
                    )}
                  </button>
                  {isCreateTaskDependenciesOpen ? (
                    createTaskDependencyCandidates.length === 0 ? (
                      <p className="mt-2 text-xs text-black/55">
                        No existing tasks to link.
                      </p>
                    ) : (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {createTaskDependencyCandidates.map((task) => (
                          <label
                            key={`create-dependency-${task.id}`}
                            className="inline-flex items-center gap-2 text-xs text-black/75"
                          >
                            <input
                              type="checkbox"
                              checked={createTaskDependencyTaskIds.includes(task.id)}
                              onChange={() => toggleCreateTaskDependency(task.id)}
                            />
                            <span className="truncate">{task.title}</span>
                          </label>
                        ))}
                      </div>
                    )
                  ) : null}
                </div>

                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={createTaskIsRecurring}
                    onChange={(event) => setCreateTaskIsRecurring(event.target.checked)}
                  />
                  Recurring task
                </label>

                {createTaskIsRecurring ? (
                  <div className="rounded-md border border-black/10 p-3">
                    <p className="text-sm font-medium">Recurring days</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {RECURRING_WEEKDAY_OPTIONS.map((day) => {
                        const isSelected = createTaskRecurringDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleCreateTaskRecurringDay(day)}
                            className={`rounded-md border px-2.5 py-1 text-xs ${
                              isSelected
                                ? "border-black bg-black text-white"
                                : "border-black/20 hover:bg-black/5"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                    <label className="mt-3 block text-sm">
                      Time per occurrence (hours)
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={createTaskRecurringTimePerOccurrenceHours}
                        onChange={(event) =>
                          setCreateTaskRecurringTimePerOccurrenceHours(
                            event.target.value
                          )
                        }
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      />
                    </label>
                  </div>
                ) : null}

                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isCreateTaskSubtasksEnabled}
                    onChange={(event) =>
                      setIsCreateTaskSubtasksEnabled(event.target.checked)
                    }
                  />
                  Add subtasks
                </label>

                {isCreateTaskSubtasksEnabled ? (
                  <div className="rounded-md border border-black/10 p-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCreateTaskSubtaskTitle}
                        onChange={(event) =>
                          setNewCreateTaskSubtaskTitle(event.target.value)
                        }
                        placeholder="Subtask title"
                        className="flex-1 rounded-md border border-black/20 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={addCreateTaskSubtask}
                        className="rounded-md border border-black/20 px-3 py-2 text-sm hover:bg-black/5"
                      >
                        Add
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {createTaskSubtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={subtask.done}
                              onChange={() => toggleCreateTaskSubtask(subtask.id)}
                            />
                            {subtask.title}
                          </label>
                          <button
                            type="button"
                            onClick={() => removeCreateTaskSubtask(subtask.id)}
                            className="rounded border border-black/20 p-1 hover:bg-black/5"
                            title="Remove subtask"
                            aria-label="Remove subtask"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3">
                <button
                  type="button"
                  onClick={closeCreateTaskModal}
                  className="rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/85"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {customTodoModalId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeCustomTodoModal}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
              <h2 className="text-lg font-semibold">Todo details</h2>
              <button
                type="button"
                onClick={closeCustomTodoModal}
                className="rounded-md border border-black/15 p-1.5 hover:bg-black/5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={saveCustomTodoModal} className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="text-sm font-medium">Title</span>
                <input
                  type="text"
                  required
                  value={customTodoModalTitle}
                  onChange={(event) => setCustomTodoModalTitle(event.target.value)}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">Planned Hours</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={customTodoModalHours}
                    onChange={(event) => setCustomTodoModalHours(event.target.value)}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  />
                </label>
                <label className="mt-6 inline-flex items-center gap-2 text-sm font-medium sm:mt-7">
                  <input
                    type="checkbox"
                    checked={customTodoModalDone}
                    onChange={(event) => setCustomTodoModalDone(event.target.checked)}
                  />
                  Mark as done
                </label>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-3">
                <button
                  type="button"
                  onClick={deleteCustomTodoModal}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeCustomTodoModal}
                    className="rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/85"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalTaskKey ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeTaskModal}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
              <h2 className="text-lg font-semibold">Task details</h2>
              <button
                type="button"
                onClick={closeTaskModal}
                className="rounded-md border border-black/15 p-1.5 hover:bg-black/5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={saveModalTask} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <label className="block">
                  <span className="text-sm font-medium">Task Title</span>
                  <input
                    type="text"
                    required
                    value={modalTaskTitle}
                    onChange={(event) => setModalTaskTitle(event.target.value)}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium">Description</span>
                  <textarea
                    value={modalDescription}
                    onChange={(event) => setModalDescription(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-medium">Due Date</span>
                    <input
                      type="date"
                      required
                      value={modalDueDate}
                      onChange={(event) => setModalDueDate(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Hours Assigned</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={modalHoursAssigned}
                      onChange={(event) => setModalHoursAssigned(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Time Spent (hours)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={modalTimeSpent}
                      onChange={(event) => setModalTimeSpent(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-medium">Blocker (optional)</span>
                  <input
                    type="text"
                    value={modalBlockerReason}
                    onChange={(event) => setModalBlockerReason(event.target.value)}
                    placeholder="What is blocking this task?"
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  />
                </label>

                <div className="rounded-md border border-black/10 p-3">
                  <button
                    type="button"
                    onClick={() => setIsModalDependenciesOpen((isOpen) => !isOpen)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <p className="text-sm font-medium">
                      Dependencies
                      {modalDependencyTaskIds.length > 0
                        ? ` (${modalDependencyTaskIds.length})`
                        : ""}
                    </p>
                    {isModalDependenciesOpen ? (
                      <ChevronDown className="h-4 w-4 text-black/55" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-black/55" />
                    )}
                  </button>
                  {isModalDependenciesOpen ? (
                    modalProjectTasks.filter((task) => task.id !== modalTaskId).length ===
                    0 ? (
                      <p className="mt-2 text-xs text-black/55">
                        No other tasks available to link.
                      </p>
                    ) : (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {modalProjectTasks
                          .filter((task) => task.id !== modalTaskId)
                          .map((task) => (
                            <label
                              key={`modal-dependency-${task.id}`}
                              className="inline-flex items-center gap-2 text-xs text-black/75"
                            >
                              <input
                                type="checkbox"
                                checked={modalDependencyTaskIds.includes(task.id)}
                                onChange={() => toggleModalDependencyTask(task.id)}
                              />
                              <span className="truncate">{task.title}</span>
                            </label>
                          ))}
                      </div>
                    )
                  ) : null}
                </div>

                <div className="rounded-md border border-black/10 p-3">
                  <p className="text-sm font-medium">Subtasks</p>
                  {modalSubtasks.length === 0 ? (
                    <p className="mt-2 text-xs text-black/55">No subtasks yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {modalSubtasks.map((subtask) => (
                        <li
                          key={subtask.id}
                          className="flex items-center justify-between gap-2 rounded border border-black/10 px-2 py-1.5"
                        >
                          <label className="flex min-w-0 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={subtask.done}
                              onChange={() => toggleModalSubtask(subtask.id)}
                            />
                            <span className="truncate">{subtask.title}</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeModalSubtask(subtask.id)}
                            className="rounded border border-black/15 p-1 hover:bg-black/5"
                            aria-label="Remove subtask"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={newModalSubtaskTitle}
                      onChange={(event) => setNewModalSubtaskTitle(event.target.value)}
                      placeholder="Add subtask"
                      className="flex-1 rounded-md border border-black/15 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addModalSubtask}
                      className="rounded-md border border-black/20 px-2.5 py-1.5 text-sm font-medium hover:bg-black/5"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-medium">Priority</span>
                    <select
                      value={modalPriority}
                      onChange={(event) =>
                        setModalPriority(event.target.value as MarketingTaskPriority)
                      }
                      className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    >
                      {TASK_PRIORITY_OPTIONS.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium">Status</span>
                    <select
                      value={modalStatus}
                      onChange={(event) =>
                        setModalStatus(event.target.value as MarketingTaskStatus)
                      }
                      className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    >
                      {TASK_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium">Assignee</span>
                    <select
                      value={modalAssignee}
                      onChange={(event) => setModalAssignee(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    >
                      <option value={UNASSIGNED_VALUE}>Unassigned</option>
                      {modalAssigneeOptions.map((personName) => (
                        <option key={personName} value={personName}>
                          {personName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="rounded-md border border-black/10 p-3">
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={modalIsRecurringTask}
                      onChange={(event) => setModalIsRecurringTask(event.target.checked)}
                    />
                    Recurring task
                  </label>

                  {modalIsRecurringTask ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-black/55">
                          Recurring days
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {RECURRING_WEEKDAY_OPTIONS.map((day) => {
                            const isSelected = modalRecurringDays.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => toggleModalRecurringDay(day)}
                                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                                  isSelected
                                    ? "border-black bg-black text-white"
                                    : "border-black/20 hover:bg-black/5"
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="block max-w-[220px]">
                        <span className="text-sm font-medium">
                          Time per occurrence (hours)
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          value={modalRecurringTimePerOccurrenceHours}
                          onChange={(event) =>
                            setModalRecurringTimePerOccurrenceHours(event.target.value)
                          }
                          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                        />
                      </label>

                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-black/55">
                          Current week checklist
                        </p>
                        {modalRecurringWeekDates.length === 0 ? (
                          <p className="mt-2 text-xs text-black/55">
                            No occurrences this week.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1">
                            {modalRecurringWeekDates.map((day) => (
                              <li
                                key={day.date}
                                className="flex items-center justify-between rounded border border-black/10 px-2 py-1.5 text-sm"
                              >
                                <span>
                                  {day.weekday} ({day.date})
                                </span>
                                <input
                                  type="checkbox"
                                  checked={modalRecurringCompletions[day.date] === true}
                                  onChange={(event) =>
                                    toggleModalRecurringCompletion(
                                      day.date,
                                      event.target.checked
                                    )
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-black/10 px-5 py-3">
                <button
                  type="button"
                  onClick={() => {
                    const parsedKey = modalTaskKey ? parseTaskKey(modalTaskKey) : null;
                    if (!parsedKey) {
                      return;
                    }
                    requestDeleteTask(parsedKey.projectId, parsedKey.taskId);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeTaskModal}
                    className="rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/85"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-black/10 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-5 w-5 text-red-600" />
              <div>
                <h3 className="text-base font-semibold">Delete task?</h3>
                <p className="mt-1 text-sm text-black/65">
                  Are you sure you want to delete this task?
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteTask}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}



