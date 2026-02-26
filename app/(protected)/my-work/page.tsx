
"use client";

import Link from "next/link";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  CircleAlert,
  Flame,
  GripVertical,
  Pin,
  PinOff,
  Repeat,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  FormEvent,
  MouseEvent,
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
  MarketingProject,
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

const ALL_FILTER_VALUE = "__ALL__";
const UNASSIGNED_VALUE = "__UNASSIGNED__";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const MY_WORK_PREFS_STORAGE_KEY = "internal-system-my-work-preferences";
const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

type MyWorkTab = "overdue" | "today" | "week" | "recurring";
type MyWorkStatusFilter = MarketingTaskStatus | typeof ALL_FILTER_VALUE;
type MyWorkPriorityFilter = MarketingTaskPriority | typeof ALL_FILTER_VALUE;

type MyWorkFilters = {
  search: string;
  status: MyWorkStatusFilter;
  priority: MyWorkPriorityFilter;
};

type MyWorkUserPreferences = {
  activeTab: MyWorkTab;
  filters: MyWorkFilters;
  pinnedTaskKeys: string[];
};

type MyWorkPreferencesByUser = Record<string, MyWorkUserPreferences>;

type TaskEntry = {
  key: string;
  project: MarketingProject;
  projectId: string;
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

const createDefaultFilters = (): MyWorkFilters => ({
  search: "",
  status: ALL_FILTER_VALUE,
  priority: ALL_FILTER_VALUE,
});

const createDefaultPreferences = (): MyWorkUserPreferences => ({
  activeTab: "today",
  filters: createDefaultFilters(),
  pinnedTaskKeys: [],
});

const isMyWorkTab = (value: unknown): value is MyWorkTab => {
  return (
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

    const entries = Object.entries(parsed as Record<string, unknown>).map(
      ([userName, preferenceValue]) => {
        const defaults = createDefaultPreferences();

        if (
          !preferenceValue ||
          typeof preferenceValue !== "object" ||
          Array.isArray(preferenceValue)
        ) {
          return [userName, defaults] as const;
        }

        const typedPreference = preferenceValue as Partial<MyWorkUserPreferences> & {
          filters?: unknown;
        };

        const filtersValue =
          typedPreference.filters &&
          typeof typedPreference.filters === "object" &&
          !Array.isArray(typedPreference.filters)
            ? (typedPreference.filters as Partial<MyWorkFilters>)
            : {};

        const nextFilters: MyWorkFilters = {
          search:
            typeof filtersValue.search === "string" ? filtersValue.search : "",
          status: isMyWorkStatusFilter(filtersValue.status)
            ? filtersValue.status
            : ALL_FILTER_VALUE,
          priority: isMyWorkPriorityFilter(filtersValue.priority)
            ? filtersValue.priority
            : ALL_FILTER_VALUE,
        };

        const pinnedTaskKeys = Array.isArray(typedPreference.pinnedTaskKeys)
          ? typedPreference.pinnedTaskKeys.filter(
              (taskKey): taskKey is string => typeof taskKey === "string"
            )
          : [];

        return [
          userName,
          {
            activeTab: isMyWorkTab(typedPreference.activeTab)
              ? typedPreference.activeTab
              : defaults.activeTab,
            filters: nextFilters,
            pinnedTaskKeys,
          },
        ] as const;
      }
    );

    return Object.fromEntries(entries);
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

const matchesFilters = (task: MarketingTask, filters: MyWorkFilters): boolean => {
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

  return true;
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

type SortablePlanItemProps = {
  entry: TaskEntry;
  todayIsoDate: string;
  isPinned: boolean;
  onOpenTask: (entry: TaskEntry) => void;
  onTogglePin: (taskKey: string) => void;
};

function SortablePlanItem({
  entry,
  todayIsoDate,
  isPinned,
  onOpenTask,
  onTogglePin,
}: SortablePlanItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: entry.key,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  const onRemovePin = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onTogglePin(entry.key);
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={() => onOpenTask(entry)}
      className="cursor-pointer rounded-md border border-black/10 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab rounded border border-black/15 p-1 text-black/60 active:cursor-grabbing"
          title="Reorder"
          aria-label="Reorder"
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{entry.task.title}</p>
          <p className="mt-0.5 text-xs text-black/60">{entry.project.name}</p>
          <p className="mt-1 text-xs text-black/70">
            {entry.task.dueDate || "No due date"} · {getDueLabel(entry.task.dueDate, todayIsoDate)}
          </p>
        </div>
        {isPinned ? (
          <button
            type="button"
            onClick={onRemovePin}
            aria-label="Unpin"
            title="Unpin"
            className="rounded border border-black/15 p-1.5 hover:bg-black/5"
          >
            <PinOff className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

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

  const user = parseDemoUser(rawUser);
  const userName = user?.name ?? "";
  const projects = parseMarketingProjects(rawProjects);
  const tasksByProject = parseMarketingTasksByProject(rawTasksByProject);
  const membersByProject = parseMarketingMembersByProject(rawMembersByProject);

  const [activeTab, setActiveTab] = useState<MyWorkTab>("today");
  const [filters, setFilters] = useState<MyWorkFilters>(createDefaultFilters);
  const [pinnedTaskKeys, setPinnedTaskKeys] = useState<string[]>([]);
  const [didLoadPreferences, setDidLoadPreferences] = useState(false);

  const [modalTaskKey, setModalTaskKey] = useState<string | null>(null);
  const [modalTaskTitle, setModalTaskTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [modalDueDate, setModalDueDate] = useState("");
  const [modalStatus, setModalStatus] = useState<MarketingTaskStatus>("To Do");
  const [modalPriority, setModalPriority] = useState<MarketingTaskPriority>("Medium");
  const [modalAssignee, setModalAssignee] = useState<string>(UNASSIGNED_VALUE);
  const [modalTimeSpent, setModalTimeSpent] = useState("0");
  const [modalSubtasks, setModalSubtasks] = useState<MarketingSubtask[]>([]);
  const [newModalSubtaskTitle, setNewModalSubtaskTitle] = useState("");
  const [modalIsRecurringTask, setModalIsRecurringTask] = useState(false);
  const [modalRecurringDays, setModalRecurringDays] = useState<MarketingRecurringWeekday[]>([]);
  const [modalRecurringTimePerOccurrenceHours, setModalRecurringTimePerOccurrenceHours] =
    useState("0");
  const [modalRecurringCompletions, setModalRecurringCompletions] =
    useState<MarketingRecurringCompletions>({});

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
          project,
          projectId,
          members,
          task,
        });
      });
    });

    return entries;
  }, [membersByProject, projects, tasksByProject, userName]);

  const taskEntryByKey = useMemo(() => {
    return new Map(taskEntries.map((entry) => [entry.key, entry]));
  }, [taskEntries]);

  useEffect(() => {
    if (!userName || typeof window === "undefined") {
      return;
    }

    const allPreferences = parseMyWorkPreferencesByUser(
      window.localStorage.getItem(MY_WORK_PREFS_STORAGE_KEY)
    );
    const userPreferences = allPreferences[userName] ?? createDefaultPreferences();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab(userPreferences.activeTab);
    setFilters(userPreferences.filters);
    setPinnedTaskKeys(userPreferences.pinnedTaskKeys);
    setDidLoadPreferences(true);
  }, [userName]);

  useEffect(() => {
    if (!didLoadPreferences || !userName || typeof window === "undefined") {
      return;
    }

    const allPreferences = parseMyWorkPreferencesByUser(
      window.localStorage.getItem(MY_WORK_PREFS_STORAGE_KEY)
    );
    allPreferences[userName] = {
      activeTab,
      filters,
      pinnedTaskKeys,
    };

    window.localStorage.setItem(
      MY_WORK_PREFS_STORAGE_KEY,
      JSON.stringify(allPreferences)
    );
  }, [activeTab, didLoadPreferences, filters, pinnedTaskKeys, userName]);

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
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteTarget, modalTaskKey]);

  const filteredEntries = useMemo(() => {
    return taskEntries.filter((entry) => matchesFilters(entry.task, filters));
  }, [filters, taskEntries]);

  const overdueEntries = useMemo(() => {
    return filteredEntries
      .filter(
        (entry) =>
          Boolean(entry.task.dueDate) &&
          entry.task.dueDate < todayIsoDate &&
          entry.task.status !== "Done"
      )
      .sort((firstEntry, secondEntry) =>
        firstEntry.task.dueDate.localeCompare(secondEntry.task.dueDate)
      );
  }, [filteredEntries, todayIsoDate]);

  const todayEntries = useMemo(() => {
    return filteredEntries
      .filter((entry) => entry.task.dueDate === todayIsoDate)
      .sort((firstEntry, secondEntry) =>
        firstEntry.task.title.localeCompare(secondEntry.task.title)
      );
  }, [filteredEntries, todayIsoDate]);

  const weekEntries = useMemo(() => {
    return filteredEntries
      .filter(
        (entry) =>
          Boolean(entry.task.dueDate) &&
          entry.task.dueDate > todayIsoDate &&
          entry.task.dueDate <= weekEndIsoDate
      )
      .sort((firstEntry, secondEntry) =>
        firstEntry.task.dueDate.localeCompare(secondEntry.task.dueDate)
      );
  }, [filteredEntries, todayIsoDate, weekEndIsoDate]);

  const recurringEntries = useMemo(() => {
    return filteredEntries
      .filter((entry) => isRecurringForDate(entry.task, todayIsoDate, todayWeekday))
      .sort((firstEntry, secondEntry) =>
        firstEntry.task.title.localeCompare(secondEntry.task.title)
      );
  }, [filteredEntries, todayIsoDate, todayWeekday]);

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

  const focusEntries = useMemo(() => {
    return taskEntries
      .map((entry) => ({
        entry,
        bucket: getFocusBucket(entry.task, todayIsoDate, weekEndIsoDate),
      }))
      .filter((item) => item.bucket !== 99)
      .sort((firstItem, secondItem) => {
        if (firstItem.bucket !== secondItem.bucket) {
          return firstItem.bucket - secondItem.bucket;
        }

        const firstDue = firstItem.entry.task.dueDate || "9999-12-31";
        const secondDue = secondItem.entry.task.dueDate || "9999-12-31";
        if (firstDue !== secondDue) {
          return firstDue.localeCompare(secondDue);
        }

        return firstItem.entry.task.title.localeCompare(secondItem.entry.task.title);
      })
      .slice(0, 3)
      .map((item) => item.entry);
  }, [taskEntries, todayIsoDate, weekEndIsoDate]);

  const pinnedEntries = useMemo(() => {
    return pinnedTaskKeys
      .map((taskKey) => taskEntryByKey.get(taskKey) ?? null)
      .filter((entry): entry is TaskEntry => entry !== null);
  }, [pinnedTaskKeys, taskEntryByKey]);

  const modalEntry = modalTaskKey ? taskEntryByKey.get(modalTaskKey) ?? null : null;
  const modalProjectMembers = modalEntry?.members ?? [];

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

  const queueEntriesByTab: Record<MyWorkTab, TaskEntry[]> = {
    overdue: overdueEntries,
    today: todayEntries,
    week: weekEntries,
    recurring: recurringEntries,
  };

  const currentQueueEntries = queueEntriesByTab[activeTab] ?? [];

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
    const currentTasks = tasksByProject[projectId] ?? [];
    writeMarketingTasksForProject(projectId, updater(currentTasks));
  };

  const togglePin = (taskKey: string) => {
    setPinnedTaskKeys((currentKeys) => {
      if (currentKeys.includes(taskKey)) {
        return currentKeys.filter((currentKey) => currentKey !== taskKey);
      }

      return [...currentKeys, taskKey];
    });
  };

  const openTaskModal = (entry: TaskEntry) => {
    setModalTaskKey(entry.key);
    setModalTaskTitle(entry.task.title);
    setModalDescription(entry.task.description);
    setModalDueDate(entry.task.dueDate);
    setModalStatus(entry.task.status);
    setModalPriority(entry.task.priority);
    setModalAssignee(entry.task.assignee ?? UNASSIGNED_VALUE);
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

    updateProjectTasks(deleteTarget.projectId, (projectTasks) =>
      projectTasks.filter((task) => task.id !== deleteTarget.taskId)
    );

    const modalKey = getTaskKey(deleteTarget.projectId, deleteTarget.taskId);
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
    const parsedTimeSpent = Number(modalTimeSpent);
    const parsedRecurringHours = Number(modalRecurringTimePerOccurrenceHours);

    if (!trimmedTitle || !modalDueDate) {
      return;
    }
    if (!Number.isFinite(parsedTimeSpent) || parsedTimeSpent < 0) {
      return;
    }
    if (!Number.isFinite(parsedRecurringHours) || parsedRecurringHours < 0) {
      return;
    }

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

      return projectTasks.map((task) =>
        task.id === parsedKey.taskId
          ? {
              ...task,
              title: trimmedTitle,
              description: modalDescription.trim(),
              dueDate: modalDueDate,
              status: modalStatus,
              order: nextOrder,
              assignee: modalAssignee === UNASSIGNED_VALUE ? null : modalAssignee,
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
            }
          : task
      );
    });

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

  const clearFilters = () => {
    setFilters(createDefaultFilters());
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const onPinnedDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || activeId === overId) {
      return;
    }

    setPinnedTaskKeys((currentKeys) => {
      const oldIndex = currentKeys.indexOf(activeId);
      const newIndex = currentKeys.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) {
        return currentKeys;
      }

      return arrayMove(currentKeys, oldIndex, newIndex);
    });
  };

  const getEmptyMessage = (tab: MyWorkTab): string => {
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
    <div className="space-y-6">
      <header className="rounded-xl border border-black/10 bg-gradient-to-r from-white to-black/[0.02] p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-black/50">
          My Work
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{user.name} command center</h1>
        <p className="mt-1 text-sm text-black/60">{todayIsoDate}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => openQueueTab("overdue")}
          className="rounded-xl border border-red-200 bg-red-50/70 p-3 text-left text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
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
          className="rounded-xl border border-yellow-200 bg-yellow-50/80 p-3 text-left text-yellow-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
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
          className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-left text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
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
          className="rounded-xl border border-violet-200 bg-violet-50/80 p-3 text-left text-violet-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
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
          className="rounded-xl border border-orange-200 bg-orange-50/80 p-3 text-left text-orange-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">High priority open</span>
            <Flame className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">{highPriorityOpenCount}</p>
        </button>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <section
            ref={focusRef}
            className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Focus now</h2>
              <span className="text-xs text-black/50">Top 3 next tasks</span>
            </div>
            {focusEntries.length === 0 ? (
              <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-black/60">
                No urgent focus tasks right now.
              </p>
            ) : (
              <div className="space-y-3">
                {focusEntries.map((entry) => {
                  const isPinned = pinnedTaskKeys.includes(entry.key);
                  return (
                    <article
                      key={entry.key}
                      className={`rounded-lg border p-3 shadow-sm ${
                        entry.task.dueDate < todayIsoDate && entry.task.status !== "Done"
                          ? "border-red-200 bg-red-50/40"
                          : "border-black/10 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{entry.task.title}</p>
                          <Link
                            href={`/marketing/projects/${entry.projectId}`}
                            className="mt-0.5 inline-block text-xs text-blue-700 hover:underline"
                          >
                            {entry.project.name}
                          </Link>
                          <p className="mt-1 text-xs text-black/60">
                            {entry.task.dueDate || "No due date"} · {getDueLabel(entry.task.dueDate, todayIsoDate)}
                          </p>
                          <p className="mt-1 text-xs text-black/60">
                            Time spent {formatHours(entry.task.timeSpent)} · Allocated --
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePin(entry.key)}
                          title={isPinned ? "Unpin from Today Plan" : "Pin to Today Plan"}
                          aria-label={isPinned ? "Unpin from Today Plan" : "Pin to Today Plan"}
                          className="rounded border border-black/15 p-1.5 hover:bg-black/5"
                        >
                          <Pin className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
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
                          className="rounded-md border border-black/15 px-2.5 py-1 text-xs font-medium hover:bg-black/5"
                        >
                          Open
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
            className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Work queue</h2>
              <div className="inline-flex rounded-lg border border-black/15 bg-black/[0.02] p-1">
                {([
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
                          ? "bg-black text-white"
                          : "text-black/70 hover:bg-black/5"
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-black/[0.02] p-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-black/45" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((currentFilters) => ({
                      ...currentFilters,
                      search: event.target.value,
                    }))
                  }
                  placeholder="Search"
                  className="w-full rounded-md border border-black/15 bg-white py-1.5 pl-7 pr-2 text-sm"
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
                className="h-8 rounded-md border border-black/15 bg-white px-2 text-sm"
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
                className="h-8 rounded-md border border-black/15 bg-white px-2 text-sm"
              >
                <option value={ALL_FILTER_VALUE}>Priority</option>
                {TASK_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={clearFilters}
                className="h-8 rounded-md border border-black/20 bg-white px-3 text-sm font-medium hover:bg-black/5"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {currentQueueEntries.length === 0 ? (
                <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-black/60">
                  {getEmptyMessage(activeTab)}
                </p>
              ) : (
                currentQueueEntries.map((entry) => {
                  const isPinned = pinnedTaskKeys.includes(entry.key);
                  const isRecurringItem =
                    activeTab === "recurring" &&
                    isRecurringForDate(entry.task, todayIsoDate, todayWeekday);

                  return (
                    <article
                      key={entry.key}
                      onClick={() => openTaskModal(entry)}
                      className={`cursor-pointer rounded-lg border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow ${
                        entry.task.dueDate < todayIsoDate && entry.task.status !== "Done"
                          ? "border-red-200 bg-red-50/30"
                          : "border-black/10 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{entry.task.title}</p>
                          <p className="mt-1 text-xs text-black/60">
                            <span className="text-black/45">Project</span> ·{" "}
                            <Link
                              href={`/marketing/projects/${entry.projectId}`}
                              onClick={(event) => event.stopPropagation()}
                              className="text-blue-700 hover:underline"
                            >
                              {entry.project.name}
                            </Link>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePin(entry.key);
                          }}
                          title={isPinned ? "Unpin" : "Pin"}
                          aria-label={isPinned ? "Unpin" : "Pin"}
                          className="rounded border border-black/15 p-1.5 hover:bg-black/5"
                        >
                          <Pin className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
                        </button>
                      </div>

                      <div className="mt-2 grid gap-2 text-xs text-black/70 sm:grid-cols-2 lg:grid-cols-6">
                        <p>
                          <span className="text-black/45">Status</span>
                          <span
                            className={`ml-1 inline-flex rounded-full border px-2 py-0.5 ${getStatusBadgeClasses(
                              entry.task.status
                            )}`}
                          >
                            {entry.task.status}
                          </span>
                        </p>
                        <p>
                          <span className="text-black/45">Priority</span>
                          <span
                            className={`ml-1 inline-flex rounded-full border px-2 py-0.5 ${getPriorityBadgeClasses(
                              entry.task.priority
                            )}`}
                          >
                            {entry.task.priority}
                          </span>
                        </p>
                        <p>
                          <span className="text-black/45">Due</span>
                          <span className="ml-1">{entry.task.dueDate || "--"}</span>
                        </p>
                        <p>
                          <span className="text-black/45">Label</span>
                          <span className="ml-1">{getDueLabel(entry.task.dueDate, todayIsoDate)}</span>
                        </p>
                        <p>
                          <span className="text-black/45">Time spent</span>
                          <span className="ml-1">{formatHours(entry.task.timeSpent)}</span>
                        </p>
                        <p>
                          <span className="text-black/45">Assignee</span>
                          <span className="ml-1">{entry.task.assignee ?? "Unassigned"}</span>
                        </p>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
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
                            className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs"
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
        </div>

        <aside className="space-y-3 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Today Plan</h2>
              <span className="text-xs text-black/50">{pinnedEntries.length} pinned</span>
            </div>

            {pinnedEntries.length === 0 ? (
              <p className="rounded-md border border-dashed border-black/15 p-3 text-sm text-black/60">
                Pin tasks to build your shortlist.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onPinnedDragEnd}
              >
                <SortableContext
                  items={pinnedEntries.map((entry) => entry.key)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-2">
                    {pinnedEntries.map((entry) => (
                      <SortablePlanItem
                        key={entry.key}
                        entry={entry}
                        todayIsoDate={todayIsoDate}
                        isPinned={true}
                        onOpenTask={openTaskModal}
                        onTogglePin={togglePin}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </section>
        </aside>
      </div>

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

                <div className="grid gap-3 sm:grid-cols-2">
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
                      {modalProjectMembers.map((member) => (
                        <option key={member.id} value={member.name}>
                          {member.name}
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

