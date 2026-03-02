"use client";

import Link from "next/link";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  History,
  ListChecks,
  Pencil,
  Trash2,
  Users,
  UserRound,
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  FormEvent,
  MouseEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createMarketingMemberId,
  getMarketingMembersServerSnapshot,
  getMarketingMembersSnapshot,
  MarketingMember,
  parseMarketingMembersByProject,
  subscribeToMarketingMembers,
  writeMarketingMembersForProject,
} from "@/lib/marketing-members";
import {
  getMarketingProjectsServerSnapshot,
  getMarketingProjectsSnapshot,
  parseMarketingProjects,
  subscribeToMarketingProjects,
} from "@/lib/marketing-projects";
import {
  appendMarketingProjectCommitLogs,
  createIndiaDateTimeLabel,
  getMarketingProjectCommitLogsServerSnapshot,
  getMarketingProjectCommitLogsSnapshot,
  parseMarketingProjectCommitLogs,
  subscribeToMarketingProjectCommitLogs,
} from "@/lib/marketing-project-commits";
import { readDemoUser } from "@/lib/demo-user";
import {
  createMarketingSubtaskId,
  createMarketingTaskId,
  getMarketingTasksServerSnapshot,
  getMarketingTasksSnapshot,
  MarketingRecurringCompletions,
  MarketingRecurringWeekday,
  MarketingSubtask,
  MarketingTask,
  MarketingTaskPriority,
  MarketingTaskStatus,
  normalizeMarketingTaskOrders,
  parseMarketingTasksByProject,
  RECURRING_WEEKDAY_OPTIONS,
  sortTasksInStatus,
  subscribeToMarketingTasks,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  writeMarketingTasksForProject,
} from "@/lib/marketing-tasks";
import { fetchUserPreference, saveUserPreference } from "@/lib/preferences-client";
import { recordTaskAssignmentEvent } from "@/lib/assignment-events-client";

const UNASSIGNED_VALUE = "__UNASSIGNED__";
const ALL_FILTER_VALUE = "__ALL__";
const UNASSIGNED_FILTER_VALUE = "__UNASSIGNED_FILTER__";
const EXTERNAL_MEMBER_VALUE = "__EXTERNAL_MEMBER__";
const MARKETING_FILTERS_STORAGE_KEY = "internal-system-marketing-filters";
const MARKETING_TASK_VIEW_STORAGE_KEY = "internal-system-marketing-task-view";
const MARKETING_KANBAN_GROUPS_STORAGE_KEY =
  "internal-system-marketing-kanban-collapsed-groups";
const MARKETING_PROJECT_BOARD_PREFERENCES_NAMESPACE =
  "marketing-project-board-preferences";
const WIP_WARNING_THRESHOLD = 6;
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const TIMELINE_PAST_WINDOW_DAYS = 7;
const TIMELINE_FUTURE_WINDOW_DAYS = 21;
const TIMELINE_EDGE_BUFFER_DAYS = 1;
const TIMELINE_MAX_EDGE_BUFFER_DAYS = 3;
const TIMELINE_CHIP_WIDTH = 196;
const TIMELINE_CHIP_ROW_SPACING = 72;
const TIMELINE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

type TaskAssigneeFilterValue = string;
type TaskPriorityFilterValue = MarketingTaskPriority | typeof ALL_FILTER_VALUE;
type TaskStatusFilterValue = MarketingTaskStatus | typeof ALL_FILTER_VALUE;
type TasksSectionTab = "tasks" | "summary" | "recurring";
type TaskBoardView = "kanban" | "timeline";
type RecurringFiltersState = {
  search: string;
  assignee: TaskAssigneeFilterValue;
  priority: TaskPriorityFilterValue;
  status: TaskStatusFilterValue;
};
type LoggedPerson = {
  id: string;
  name: string;
  email: string;
};
type TeamEditRow = {
  id: string;
  memberSelection: string;
  externalName: string;
  hoursAllocatedInput: string;
};
type TaskFilterState = {
  search: string;
  assignee: TaskAssigneeFilterValue;
  priority: TaskPriorityFilterValue;
  status: TaskStatusFilterValue;
  isOverdueOnly: boolean;
  isBlockedOnly: boolean;
};
type TaskFiltersByProject = Record<string, TaskFilterState>;
type TaskViewByProject = Record<string, TaskBoardView>;
type TimelineTaskEntry = {
  task: MarketingTask;
  dueDateMs: number;
  stackIndex: number;
};
type WeekDateEntry = {
  weekday: MarketingRecurringWeekday;
  date: string;
};
type TimelineDateRange = {
  minMs: number;
  maxMs: number;
  spanDays: number;
};
type KanbanAssigneeGroup = {
  key: string;
  assigneeKey: string;
  label: string;
  tasks: MarketingTask[];
};
type CollapsedKanbanGroups = Record<string, boolean>;
type CollapsedKanbanGroupsByProject = Record<string, CollapsedKanbanGroups>;

type DeleteConfirmTarget =
  | { type: "task"; taskId: string }
  | null;

const getColumnId = (status: MarketingTaskStatus): string => `column:${status}`;
const getKanbanGroupKey = (
  status: MarketingTaskStatus,
  assignee: string
): string => `${status}::${assignee}`;

const getStatusFromColumnId = (
  id: UniqueIdentifier | null
): MarketingTaskStatus | null => {
  if (typeof id !== "string" || !id.startsWith("column:")) {
    return null;
  }

  const status = id.slice("column:".length) as MarketingTaskStatus;
  return TASK_STATUS_OPTIONS.includes(status) ? status : null;
};

const getNextStatus = (
  status: MarketingTaskStatus
): MarketingTaskStatus | null => {
  if (status === "To Do") {
    return "In Progress";
  }
  if (status === "In Progress") {
    return "Review";
  }
  if (status === "Review") {
    return "Done";
  }
  return null;
};

const parseAssigneeSelection = (value: string): string | null =>
  value === UNASSIGNED_VALUE ? null : value;

const formatAssigneeSelection = (value: string | null): string =>
  value ?? UNASSIGNED_VALUE;

const normalizeNameValue = (value: string): string => value.trim().toLowerCase();
const stripExternalSuffix = (value: string): string =>
  value.trim().replace(/\s+external$/i, "");
const toExternalMemberName = (value: string): string => {
  const baseName = stripExternalSuffix(value);
  return baseName ? `${baseName} external` : "";
};

const formatMemberName = (member: MarketingMember): string =>
  member.source === "external" ? toExternalMemberName(member.name) : member.name;

const formatMemberSummary = (member: MarketingMember): string =>
  `${formatMemberName(member)}(${member.hoursAllocated}h)`;

const formatHours = (value: number): string => {
  const roundedValue = Math.round(value * 100) / 100;
  return Number.isInteger(roundedValue)
    ? `${roundedValue.toFixed(0)}h`
    : `${roundedValue}h`;
};

const getTodayDateString = (): string => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(today.getDate()).padStart(2, "0")}`;
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

const createDefaultTaskFilterState = (): TaskFilterState => ({
  search: "",
  assignee: ALL_FILTER_VALUE,
  priority: ALL_FILTER_VALUE,
  status: ALL_FILTER_VALUE,
  isOverdueOnly: false,
  isBlockedOnly: false,
});

const isTaskPriorityFilterValue = (
  value: unknown
): value is TaskPriorityFilterValue => {
  return (
    value === ALL_FILTER_VALUE ||
    TASK_PRIORITY_OPTIONS.includes(value as MarketingTaskPriority)
  );
};

const isTaskStatusFilterValue = (value: unknown): value is TaskStatusFilterValue => {
  return (
    value === ALL_FILTER_VALUE ||
    TASK_STATUS_OPTIONS.includes(value as MarketingTaskStatus)
  );
};

const parseTaskFiltersByProject = (rawValue: string | null): TaskFiltersByProject => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>).map(
      ([key, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [key, createDefaultTaskFilterState()] as const;
        }

        const filterValue = value as Partial<TaskFilterState>;
        return [
          key,
          {
            search:
              typeof filterValue.search === "string" ? filterValue.search : "",
            assignee:
              typeof filterValue.assignee === "string"
                ? filterValue.assignee
                : ALL_FILTER_VALUE,
            priority: isTaskPriorityFilterValue(filterValue.priority)
              ? filterValue.priority
              : ALL_FILTER_VALUE,
            status: isTaskStatusFilterValue(filterValue.status)
              ? filterValue.status
              : ALL_FILTER_VALUE,
            isOverdueOnly: filterValue.isOverdueOnly === true,
            isBlockedOnly: filterValue.isBlockedOnly === true,
          },
        ] as const;
      }
    );

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const parseCollapsedKanbanGroupsByProject = (
  rawValue: string | null
): CollapsedKanbanGroupsByProject => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>).map(
      ([projectKey, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [projectKey, {}] as const;
        }

        const groupEntries = Object.entries(value as Record<string, unknown>).filter(
          ([groupKey, isCollapsed]) =>
            typeof groupKey === "string" && typeof isCollapsed === "boolean"
        ) as Array<[string, boolean]>;

        return [projectKey, Object.fromEntries(groupEntries)] as const;
      }
    );

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const isTaskBoardView = (value: unknown): value is TaskBoardView => {
  return value === "kanban" || value === "timeline";
};

const parseTaskViewByProject = (rawValue: string | null): TaskViewByProject => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => isTaskBoardView(value)
    ) as Array<[string, TaskBoardView]>;

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const parseTaskFiltersByProjectFromPreference = (
  value: unknown
): TaskFiltersByProject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return parseTaskFiltersByProject(JSON.stringify(value));
};

const parseTaskViewByProjectFromPreference = (
  value: unknown
): TaskViewByProject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return parseTaskViewByProject(JSON.stringify(value));
};

const parseCollapsedKanbanGroupsByProjectFromPreference = (
  value: unknown
): CollapsedKanbanGroupsByProject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return parseCollapsedKanbanGroupsByProject(JSON.stringify(value));
};

const toLocalIsoDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
};

const getDateMsFromIsoDate = (value: string): number | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const dateMs = getDateMsFromIsoDate(isoDate);
  if (dateMs === null) {
    return isoDate;
  }

  return toLocalIsoDate(new Date(dateMs + days * ONE_DAY_IN_MS));
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
      date: toLocalIsoDate(currentDate),
    };
  });
};

const createDefaultRecurringFilters = (): RecurringFiltersState => ({
  search: "",
  assignee: ALL_FILTER_VALUE,
  priority: ALL_FILTER_VALUE,
  status: ALL_FILTER_VALUE,
});

const getRecurringWeekProgress = (
  task: MarketingTask,
  weekDates: WeekDateEntry[]
): { doneCount: number; totalCount: number } => {
  if (!task.isRecurring || task.recurringDays.length === 0) {
    return { doneCount: 0, totalCount: 0 };
  }

  const applicableDates = weekDates.filter((day) =>
    task.recurringDays.includes(day.weekday) &&
    (!task.dueDate || day.date <= task.dueDate)
  );
  const doneCount = applicableDates.filter(
    (day) => task.recurringCompletions[day.date] === true
  ).length;

  return {
    doneCount,
    totalCount: applicableDates.length,
  };
};

const getRecurringWeeklyAllocatedHours = (
  task: MarketingTask,
  weekDates: WeekDateEntry[]
): number => {
  if (!task.isRecurring || task.recurringDays.length === 0) {
    return 0;
  }

  const occurrencesInWeek = weekDates.filter((day) =>
    task.recurringDays.includes(day.weekday) &&
    (!task.dueDate || day.date <= task.dueDate)
  ).length;

  return occurrencesInWeek * task.recurringTimePerOccurrenceHours;
};

const buildTimelineTicks = (range: TimelineDateRange): number[] => {
  const ticks: number[] = [range.minMs];
  let current = range.minMs + 7 * ONE_DAY_IN_MS;

  while (current < range.maxMs) {
    ticks.push(current);
    current += 7 * ONE_DAY_IN_MS;
  }

  if (range.maxMs !== range.minMs) {
    ticks.push(range.maxMs);
  }

  return ticks;
};

const formatTaskAssigneeLabel = (assignee: string | null): string =>
  assignee ?? "Unassigned";

const formatCommitFieldLabel = (field: string): string => {
  if (field === "startDate") {
    return "Start Date";
  }
  if (field === "deadline") {
    return "Deadline";
  }
  if (field === "hoursAssigned") {
    return "Hours Assigned";
  }
  if (field === "timeSpent") {
    return "Time Spent";
  }
  if (field === "dependencyTaskIds") {
    return "Dependencies";
  }
  if (field === "blockerReason") {
    return "Blocker";
  }
  if (field === "recurringCompletion") {
    return "Recurring completion";
  }
  if (field.length === 0) {
    return "Field";
  }

  return field.charAt(0).toUpperCase() + field.slice(1);
};

type TaskCardProps = {
  task: MarketingTask;
  taskById: Map<string, MarketingTask>;
  assigneeLabelByName: Map<string, string>;
  currentWeekDates: WeekDateEntry[];
  todayDateString: string;
  onOpenTask: (task: MarketingTask) => void;
  onRequestDeleteTask: (taskId: string) => void;
  onMoveTask: (taskId: string, status: MarketingTaskStatus) => void;
};

function TaskCard({
  task,
  taskById,
  assigneeLabelByName,
  currentWeekDates,
  todayDateString,
  onOpenTask,
  onRequestDeleteTask,
  onMoveTask,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      data: {
        type: "task",
        status: task.status,
      },
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const nextStatus = getNextStatus(task.status);
  const recurringWeekProgress = getRecurringWeekProgress(task, currentWeekDates);
  const recurringPattern = task.recurringDays.join(", ");
  const recurringRangeStart = task.createdAt ?? todayDateString;
  const recurringRangeEnd = task.dueDate ? task.dueDate : "ongoing";
  const hasBlocker = task.blockerReason.trim().length > 0;
  const isOverdueCard =
    task.status !== "Done" &&
    Boolean(task.dueDate) &&
    task.dueDate < todayDateString;
  const isDueTodayCard =
    task.status !== "Done" &&
    Boolean(task.dueDate) &&
    task.dueDate === todayDateString;
  const unresolvedDependencyCount = task.dependencyTaskIds.filter(
    (dependencyTaskId) => {
      const dependencyTask = taskById.get(dependencyTaskId);
      return Boolean(dependencyTask) && dependencyTask?.status !== "Done";
    }
  ).length;
  const urgencyCardClasses = isOverdueCard
    ? "border-red-200 bg-red-50/70"
    : isDueTodayCard
      ? "border-yellow-200 bg-yellow-50/80"
      : "border-black/10 bg-white";
  const assigneeDisplayLabel = task.assignee
    ? assigneeLabelByName.get(task.assignee) ?? task.assignee
    : null;

  const stopDragStart = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const onCardClick = () => {
    onOpenTask(task);
  };

  const onDeleteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRequestDeleteTask(task.id);
  };

  const onMoveClick = (
    event: MouseEvent<HTMLButtonElement>,
    status: MarketingTaskStatus
  ) => {
    event.stopPropagation();
    onMoveTask(task.id, status);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      onClick={onCardClick}
      className={`rounded-md border p-3 shadow-sm ${urgencyCardClasses}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{task.title}</p>
        <span className="select-none text-black/40" aria-hidden>
          ::
        </span>
      </div>
      <span
        className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs ${getPriorityBadgeClasses(
          task.priority
        )}`}
      >
        {task.priority}
      </span>
      {hasBlocker ? (
        <span className="ml-2 mt-2 inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
          Blocked
        </span>
      ) : null}
      {task.isRecurring ? (
        <div className="mt-2 text-xs text-black/65">
          <p className="font-medium">
            Recurring{recurringPattern ? ` · ${recurringPattern}` : ""}
          </p>
          <p>
            Range: {recurringRangeStart} → {recurringRangeEnd}
          </p>
          <p>
            This week: {recurringWeekProgress.doneCount}/{recurringWeekProgress.totalCount} done
          </p>
        </div>
      ) : null}
      <p className="mt-2 text-sm text-black/70">Due Date: {task.dueDate}</p>
      <p className="mt-1 text-xs text-black/60">
        Assigned: {formatHours(task.hoursAssigned)}
      </p>
      <p className="mt-1 text-xs text-black/60">
        Time Spent: {formatHours(task.timeSpent)}
      </p>
      {task.dependencyTaskIds.length > 0 ? (
        <p className="mt-1 text-xs text-black/60">
          Dependencies: {task.dependencyTaskIds.length}
          {unresolvedDependencyCount > 0
            ? ` (${unresolvedDependencyCount} unresolved)`
            : " (all done)"}
        </p>
      ) : null}
      {hasBlocker ? (
        <p className="mt-1 text-xs text-red-700/85">Blocked by: {task.blockerReason}</p>
      ) : null}
      {assigneeDisplayLabel ? (
        <p className="mt-1 text-xs text-black/60">Assignee: {assigneeDisplayLabel}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCardClick}
          onPointerDown={stopDragStart}
          title="Edit task"
          aria-label="Edit task"
          className="rounded-md border border-black/20 p-2 hover:bg-black/5"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDeleteClick}
          onPointerDown={stopDragStart}
          title="Delete task"
          aria-label="Delete task"
          className="rounded-md border border-black/20 p-2 hover:bg-black/5"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {nextStatus ? (
          <button
            type="button"
            onClick={(event) => onMoveClick(event, nextStatus)}
            onPointerDown={stopDragStart}
            title={`Move to ${nextStatus}`}
            aria-label={`Move to ${nextStatus}`}
            className="rounded-md border border-black/20 p-2 hover:bg-black/5"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

type KanbanColumnProps = {
  status: MarketingTaskStatus;
  tasks: MarketingTask[];
  members: MarketingMember[];
  collapsedGroupMap: CollapsedKanbanGroups;
  taskById: Map<string, MarketingTask>;
  openWipCountByAssignee: Map<string, number>;
  currentWeekDates: WeekDateEntry[];
  todayDateString: string;
  onOpenTask: (task: MarketingTask) => void;
  onRequestDeleteTask: (taskId: string) => void;
  onMoveTask: (taskId: string, status: MarketingTaskStatus) => void;
  onToggleGroup: (groupKey: string) => void;
};

function KanbanColumn({
  status,
  tasks,
  members,
  collapsedGroupMap,
  taskById,
  openWipCountByAssignee,
  currentWeekDates,
  todayDateString,
  onOpenTask,
  onRequestDeleteTask,
  onMoveTask,
  onToggleGroup,
}: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: getColumnId(status),
  });
  const memberLabelByName = useMemo(
    () => new Map(members.map((member) => [member.name, formatMemberName(member)] as const)),
    [members]
  );
  const groupedTasks = useMemo<KanbanAssigneeGroup[]>(() => {
    const tasksByAssignee = new Map<string, MarketingTask[]>();

    tasks.forEach((task) => {
      const assigneeLabel = task.assignee ?? "Unassigned";
      const existingTasks = tasksByAssignee.get(assigneeLabel);
      if (existingTasks) {
        existingTasks.push(task);
        return;
      }

      tasksByAssignee.set(assigneeLabel, [task]);
    });

    const memberNamesWithTasks = members
      .map((member) => member.name)
      .filter((memberName) => tasksByAssignee.has(memberName));
    const otherAssignedNamesWithTasks = [...tasksByAssignee.keys()]
      .filter(
        (assigneeName) =>
          assigneeName !== "Unassigned" &&
          !memberNamesWithTasks.includes(assigneeName)
      )
      .sort((firstName, secondName) => firstName.localeCompare(secondName));

    const orderedAssigneeNames = [
      ...memberNamesWithTasks,
      ...otherAssignedNamesWithTasks,
      ...(tasksByAssignee.has("Unassigned") ? ["Unassigned"] : []),
    ];

    return orderedAssigneeNames.map((assigneeName) => ({
      key: getKanbanGroupKey(status, assigneeName),
      assigneeKey: assigneeName,
      label: memberLabelByName.get(assigneeName) ?? assigneeName,
      tasks: tasksByAssignee.get(assigneeName) ?? [],
    }));
  }, [memberLabelByName, members, status, tasks]);
  const visibleTaskIds = groupedTasks.flatMap((group) =>
    collapsedGroupMap[group.key] ? [] : group.tasks.map((task) => task.id)
  );

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-black/10 bg-black/[0.02] p-3 ${
        isOver ? "ring-2 ring-black/20" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{status}</h3>
        <span className="rounded-full border border-black/15 bg-white px-2 py-0.5 text-xs text-black/65">
          {tasks.length}
        </span>
      </div>
      <SortableContext
        items={visibleTaskIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="mt-3 space-y-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-black/50">No tasks</p>
          ) : (
            groupedTasks.map((group) => {
              const isCollapsed = collapsedGroupMap[group.key] === true;

              return (
                <section
                  key={group.key}
                  className="rounded-md border border-black/10 bg-white/70"
                >
                  <button
                    type="button"
                    onClick={() => onToggleGroup(group.key)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-black/[0.03]"
                  >
                    <span>
                      {group.label} ({group.tasks.length})
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const openWipCount =
                          openWipCountByAssignee.get(group.assigneeKey) ?? 0;
                        if (openWipCount < WIP_WARNING_THRESHOLD) {
                          return null;
                        }

                        return (
                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                            WIP {openWipCount}
                          </span>
                        );
                      })()}
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-black/55" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-black/55" />
                      )}
                    </div>
                  </button>
                  {!isCollapsed ? (
                    <div className="space-y-3 px-3 pb-3">
                      {group.tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          taskById={taskById}
                          assigneeLabelByName={memberLabelByName}
                          currentWeekDates={currentWeekDates}
                          todayDateString={todayDateString}
                          onOpenTask={onOpenTask}
                          onRequestDeleteTask={onRequestDeleteTask}
                          onMoveTask={onMoveTask}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function MarketingProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

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
  const rawProjectCommitLogs = useSyncExternalStore(
    subscribeToMarketingProjectCommitLogs,
    getMarketingProjectCommitLogsSnapshot,
    getMarketingProjectCommitLogsServerSnapshot
  );
  const rawMembersByProject = useSyncExternalStore(
    subscribeToMarketingMembers,
    getMarketingMembersSnapshot,
    getMarketingMembersServerSnapshot
  );

  const projects = parseMarketingProjects(rawProjects);
  const allProjectCommitLogs = parseMarketingProjectCommitLogs(rawProjectCommitLogs);
  const project = projects.find((item) => item.id === projectId);
  const tasksByProject = parseMarketingTasksByProject(rawTasksByProject);
  const membersByProject = parseMarketingMembersByProject(rawMembersByProject);
  const tasks = useMemo(
    () => tasksByProject[projectId] ?? [],
    [projectId, tasksByProject]
  );
  const members = useMemo(
    () => membersByProject[projectId] ?? [],
    [projectId, membersByProject]
  );
  const memberLabelByName = useMemo(
    () => new Map(members.map((member) => [member.name, formatMemberName(member)] as const)),
    [members]
  );
  const formatAssigneeDisplay = (assignee: string | null): string => {
    if (!assignee) {
      return "Unassigned";
    }

    return memberLabelByName.get(assignee) ?? assignee;
  };
  const projectCommitLogs = useMemo(
    () =>
      allProjectCommitLogs
        .filter((logEntry) => logEntry.projectId === projectId)
        .sort((firstLog, secondLog) =>
          secondLog.changedAtIso.localeCompare(firstLog.changedAtIso)
        ),
    [allProjectCommitLogs, projectId]
  );

  const [isTeamEditModalOpen, setIsTeamEditModalOpen] = useState(false);
  const [isCommitLogsModalOpen, setIsCommitLogsModalOpen] = useState(false);
  const [teamEditRows, setTeamEditRows] = useState<TeamEditRow[]>([]);
  const [teamEditError, setTeamEditError] = useState("");
  const [loggedPeople, setLoggedPeople] = useState<LoggedPerson[]>([]);

  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [activeTasksTab, setActiveTasksTab] = useState<TasksSectionTab>("tasks");
  const [taskTitle, setTaskTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<string>(UNASSIGNED_VALUE);
  const [taskHoursAssigned, setTaskHoursAssigned] = useState("0");
  const [taskBlockerReason, setTaskBlockerReason] = useState("");
  const [taskDependencyTaskIds, setTaskDependencyTaskIds] = useState<string[]>([]);
  const [isCreateDependenciesOpen, setIsCreateDependenciesOpen] = useState(false);
  const [taskPriority, setTaskPriority] = useState<MarketingTaskPriority>("Medium");
  const [isRecurringTask, setIsRecurringTask] = useState(false);
  const [recurringDays, setRecurringDays] = useState<MarketingRecurringWeekday[]>([]);
  const [recurringTimePerOccurrenceHours, setRecurringTimePerOccurrenceHours] =
    useState("0");
  const [isCreateSubtasksEnabled, setIsCreateSubtasksEnabled] = useState(false);
  const [createSubtasks, setCreateSubtasks] = useState<MarketingSubtask[]>([]);
  const [newCreateSubtaskTitle, setNewCreateSubtaskTitle] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [modalTaskTitle, setModalTaskTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [modalDueDate, setModalDueDate] = useState("");
  const [modalStatus, setModalStatus] = useState<MarketingTaskStatus>("To Do");
  const [modalAssignee, setModalAssignee] = useState<string>(UNASSIGNED_VALUE);
  const [modalHoursAssigned, setModalHoursAssigned] = useState("0");
  const [modalBlockerReason, setModalBlockerReason] = useState("");
  const [modalDependencyTaskIds, setModalDependencyTaskIds] = useState<string[]>([]);
  const [isModalDependenciesOpen, setIsModalDependenciesOpen] = useState(false);
  const [modalTimeSpent, setModalTimeSpent] = useState("0");
  const [modalPriority, setModalPriority] = useState<MarketingTaskPriority>("Medium");
  const [modalIsRecurringTask, setModalIsRecurringTask] = useState(false);
  const [modalRecurringDays, setModalRecurringDays] = useState<
    MarketingRecurringWeekday[]
  >([]);
  const [modalRecurringTimePerOccurrenceHours, setModalRecurringTimePerOccurrenceHours] =
    useState("0");
  const [modalRecurringCompletions, setModalRecurringCompletions] =
    useState<MarketingRecurringCompletions>({});
  const [modalSubtasks, setModalSubtasks] = useState<MarketingSubtask[]>([]);
  const [newModalSubtaskTitle, setNewModalSubtaskTitle] = useState("");
  const [deleteConfirmTarget, setDeleteConfirmTarget] =
    useState<DeleteConfirmTarget>(null);
  const [collapsedKanbanGroupsByProject, setCollapsedKanbanGroupsByProject] =
    useState<CollapsedKanbanGroupsByProject>({});
  const [isHideDoneInBoard, setIsHideDoneInBoard] = useState(false);
  const [isTaskAdvancedFiltersOpen, setIsTaskAdvancedFiltersOpen] = useState(false);
  const [taskFiltersByProject, setTaskFiltersByProject] =
    useState<TaskFiltersByProject>({});
  const [taskViewByProject, setTaskViewByProject] = useState<TaskViewByProject>({});
  const [didLoadBoardPreferences, setDidLoadBoardPreferences] = useState(false);
  const [recurringDate, setRecurringDate] = useState(getTodayDateString);
  const [recurringFilters, setRecurringFilters] = useState<RecurringFiltersState>(
    createDefaultRecurringFilters
  );

  const isInDragCooldownRef = useRef(false);
  const dragCooldownTimeoutRef = useRef<number | null>(null);
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  const scheduleDragCooldown = () => {
    if (dragCooldownTimeoutRef.current !== null) {
      window.clearTimeout(dragCooldownTimeoutRef.current);
    }

    isInDragCooldownRef.current = true;
    dragCooldownTimeoutRef.current = window.setTimeout(() => {
      isInDragCooldownRef.current = false;
      dragCooldownTimeoutRef.current = null;
    }, 200);
  };

  const tasksByStatus = useMemo(() => {
    return TASK_STATUS_OPTIONS.reduce<Record<MarketingTaskStatus, MarketingTask[]>>(
      (accumulator, status) => {
        accumulator[status] = sortTasksInStatus(
          tasks.filter((task) => task.status === status)
        );
        return accumulator;
      },
      {
        "To Do": [],
        "In Progress": [],
        Review: [],
        Done: [],
      }
    );
  }, [tasks]);

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task] as const)),
    [tasks]
  );

  const openWipCountByAssignee = useMemo(() => {
    const counts = new Map<string, number>();
    tasks.forEach((task) => {
      if (task.status === "Done") {
        return;
      }
      const assigneeKey = task.assignee ?? "Unassigned";
      counts.set(assigneeKey, (counts.get(assigneeKey) ?? 0) + 1);
    });

    return counts;
  }, [tasks]);

  const loggedPeopleById = useMemo(
    () => new Map(loggedPeople.map((person) => [person.id, person] as const)),
    [loggedPeople]
  );

  useEffect(() => {
    let isMounted = true;

    const loadLoggedPeople = async () => {
      try {
        const response = await fetch("/api/auth/people", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          users?: Array<{
            id?: unknown;
            name?: unknown;
            email?: unknown;
          }>;
        };

        if (!response.ok || !Array.isArray(payload.users)) {
          if (isMounted) {
            setLoggedPeople([]);
          }
          return;
        }

        const parsedUsers = payload.users
          .map((user) => {
            if (
              typeof user.id !== "string" ||
              typeof user.name !== "string" ||
              typeof user.email !== "string"
            ) {
              return null;
            }
            return {
              id: user.id,
              name: user.name.trim(),
              email: user.email.trim(),
            };
          })
          .filter((user): user is LoggedPerson => user !== null);

        if (isMounted) {
          setLoggedPeople(parsedUsers);
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
    if (typeof window === "undefined") {
      return;
    }

    let isMounted = true;
    const loadBoardPreferences = async () => {
      const remotePreference = await fetchUserPreference(
        MARKETING_PROJECT_BOARD_PREFERENCES_NAMESPACE
      );

      if (!isMounted) {
        return;
      }

      if (remotePreference !== null) {
        setTaskFiltersByProject(
          parseTaskFiltersByProjectFromPreference(remotePreference.taskFiltersByProject)
        );
        setTaskViewByProject(
          parseTaskViewByProjectFromPreference(remotePreference.taskViewByProject)
        );
        setCollapsedKanbanGroupsByProject(
          parseCollapsedKanbanGroupsByProjectFromPreference(
            remotePreference.collapsedKanbanGroupsByProject
          )
        );
      } else {
        setTaskFiltersByProject(
          parseTaskFiltersByProject(
            window.localStorage.getItem(MARKETING_FILTERS_STORAGE_KEY)
          )
        );
        setTaskViewByProject(
          parseTaskViewByProject(
            window.localStorage.getItem(MARKETING_TASK_VIEW_STORAGE_KEY)
          )
        );
        setCollapsedKanbanGroupsByProject(
          parseCollapsedKanbanGroupsByProject(
            window.localStorage.getItem(MARKETING_KANBAN_GROUPS_STORAGE_KEY)
          )
        );
      }

      setDidLoadBoardPreferences(true);
    };

    void loadBoardPreferences();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!didLoadBoardPreferences || typeof window === "undefined") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveUserPreference(MARKETING_PROJECT_BOARD_PREFERENCES_NAMESPACE, {
        taskFiltersByProject,
        taskViewByProject,
        collapsedKanbanGroupsByProject,
      });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    collapsedKanbanGroupsByProject,
    didLoadBoardPreferences,
    taskFiltersByProject,
    taskViewByProject,
  ]);

  useEffect(() => {
    return () => {
      if (dragCooldownTimeoutRef.current !== null) {
        window.clearTimeout(dragCooldownTimeoutRef.current);
      }
    };
  }, []);

  const activeTaskFilters =
    taskFiltersByProject[projectId] ?? createDefaultTaskFilterState();
  const activeTaskBoardView: TaskBoardView = taskViewByProject[projectId] ?? "kanban";
  const collapsedKanbanGroups: CollapsedKanbanGroups =
    collapsedKanbanGroupsByProject[projectId] ?? {};
  const searchFilter = activeTaskFilters.search;
  const priorityFilter = activeTaskFilters.priority;
  const statusFilter = activeTaskFilters.status;
  const isOverdueOnlyFilter = activeTaskFilters.isOverdueOnly;
  const isBlockedOnlyFilter = activeTaskFilters.isBlockedOnly;
  const savedAssignee = activeTaskFilters.assignee;
  const assigneeFilter: TaskAssigneeFilterValue =
    savedAssignee === ALL_FILTER_VALUE ||
    savedAssignee === UNASSIGNED_FILTER_VALUE ||
    members.some((member) => member.name === savedAssignee)
      ? savedAssignee
      : ALL_FILTER_VALUE;

  const updateTaskFilters = (nextValues: Partial<TaskFilterState>) => {
    setTaskFiltersByProject((previousByProject) => {
      const currentFilters =
        previousByProject[projectId] ?? createDefaultTaskFilterState();
      return {
        ...previousByProject,
        [projectId]: {
          ...currentFilters,
          ...nextValues,
        },
      };
    });
  };

  const updateTaskBoardView = (nextView: TaskBoardView) => {
    setTaskViewByProject((previousByProject) => ({
      ...previousByProject,
      [projectId]: nextView,
    }));
  };

  const toggleKanbanGroup = (groupKey: string) => {
    setCollapsedKanbanGroupsByProject((previousByProject) => {
      const currentGroups = previousByProject[projectId] ?? {};
      return {
        ...previousByProject,
        [projectId]: {
          ...currentGroups,
          [groupKey]: !currentGroups[groupKey],
        },
      };
    });
  };

  const collapseAllKanbanGroups = () => {
    setCollapsedKanbanGroupsByProject((previousByProject) => {
      const nextGroups = { ...(previousByProject[projectId] ?? {}) };
      kanbanVisibleGroupKeys.forEach((groupKey) => {
        nextGroups[groupKey] = true;
      });

      return {
        ...previousByProject,
        [projectId]: nextGroups,
      };
    });
  };

  const expandAllKanbanGroups = () => {
    setCollapsedKanbanGroupsByProject((previousByProject) => {
      const nextGroups = { ...(previousByProject[projectId] ?? {}) };
      kanbanVisibleGroupKeys.forEach((groupKey) => {
        nextGroups[groupKey] = false;
      });

      return {
        ...previousByProject,
        [projectId]: nextGroups,
      };
    });
  };

  const filterQuery = searchFilter.trim().toLowerCase();
  const todayString = getTodayDateString();
  const todayMs = getDateMsFromIsoDate(todayString) ?? 0;
  const currentWeekDates = useMemo(
    () => getWeekDatesForReference(todayMs),
    [todayMs]
  );

  const filteredTasks = tasks.filter((task) => {
    if (filterQuery) {
      const title = task.title.toLowerCase();
      const descriptionText = task.description.toLowerCase();
      if (!title.includes(filterQuery) && !descriptionText.includes(filterQuery)) {
        return false;
      }
    }

    if (assigneeFilter === UNASSIGNED_FILTER_VALUE && task.assignee !== null) {
      return false;
    }
    if (
      assigneeFilter !== ALL_FILTER_VALUE &&
      assigneeFilter !== UNASSIGNED_FILTER_VALUE &&
      task.assignee !== assigneeFilter
    ) {
      return false;
    }

    if (priorityFilter !== ALL_FILTER_VALUE && task.priority !== priorityFilter) {
      return false;
    }

    if (statusFilter !== ALL_FILTER_VALUE && task.status !== statusFilter) {
      return false;
    }

    if (isOverdueOnlyFilter) {
      const isOverdue =
        task.status !== "Done" && !!task.dueDate && task.dueDate < todayString;
      if (!isOverdue) {
        return false;
      }
    }

    if (isBlockedOnlyFilter && task.blockerReason.trim().length === 0) {
      return false;
    }

    if (isHideDoneInBoard && task.status === "Done") {
      return false;
    }

    return true;
  });

  const filteredTaskIds = new Set(filteredTasks.map((task) => task.id));

  const filteredTasksByStatus = TASK_STATUS_OPTIONS.reduce<
    Record<MarketingTaskStatus, MarketingTask[]>
  >(
    (accumulator, status) => {
      accumulator[status] = tasksByStatus[status].filter((task) =>
        filteredTaskIds.has(task.id)
      );
      return accumulator;
    },
    {
      "To Do": [],
      "In Progress": [],
      Review: [],
      Done: [],
    }
  );

  const visibleStatuses =
    statusFilter === ALL_FILTER_VALUE ? [...TASK_STATUS_OPTIONS] : [statusFilter];

  const kanbanVisibleGroupKeys = visibleStatuses.flatMap((status) => {
    const assigneeNames = new Set<string>();
    filteredTasksByStatus[status].forEach((task) => {
      assigneeNames.add(task.assignee ?? "Unassigned");
    });

    return [...assigneeNames].map((assigneeName) =>
      getKanbanGroupKey(status, assigneeName)
    );
  });

  const hasVisibleFilteredTasks = visibleStatuses.some(
    (status) => filteredTasksByStatus[status].length > 0
  );

  const timelineTasksByStatus = useMemo(() => {
    const statusesForTimeline =
      statusFilter === ALL_FILTER_VALUE ? TASK_STATUS_OPTIONS : [statusFilter];
    const timelineByStatus: Record<MarketingTaskStatus, TimelineTaskEntry[]> = {
      "To Do": [],
      "In Progress": [],
      Review: [],
      Done: [],
    };
    statusesForTimeline.forEach((status) => {
      const tasksWithDueDate = filteredTasksByStatus[status]
        .map((task) => {
          const dueDateMs = getDateMsFromIsoDate(task.dueDate);
          return dueDateMs === null ? null : { task, dueDateMs };
        })
        .filter(
          (entry): entry is { task: MarketingTask; dueDateMs: number } =>
            entry !== null
        )
        .sort((first, second) => first.dueDateMs - second.dueDateMs);

      const stackCountByDate = new Map<string, number>();
      timelineByStatus[status] = tasksWithDueDate.map((entry) => {
        const currentStackCount = stackCountByDate.get(entry.task.dueDate) ?? 0;
        stackCountByDate.set(entry.task.dueDate, currentStackCount + 1);

        return {
          task: entry.task,
          dueDateMs: entry.dueDateMs,
          stackIndex: currentStackCount,
        };
      });
    });

    return timelineByStatus;
  }, [filteredTasksByStatus, statusFilter]);

  const timelineDateRange = useMemo<TimelineDateRange | null>(() => {
    const statusesForTimeline =
      statusFilter === ALL_FILTER_VALUE ? TASK_STATUS_OPTIONS : [statusFilter];
    const allDueDates = statusesForTimeline
      .flatMap((status) => timelineTasksByStatus[status])
      .map((entry) => entry.dueDateMs);

    if (allDueDates.length === 0) {
      return null;
    }

    const minDueDateMs = Math.min(...allDueDates);
    const maxDueDateMs = Math.max(...allDueDates);
    const defaultMinMs = todayMs - TIMELINE_PAST_WINDOW_DAYS * ONE_DAY_IN_MS;
    const defaultMaxMs = todayMs + TIMELINE_FUTURE_WINDOW_DAYS * ONE_DAY_IN_MS;
    const edgeBufferMs =
      Math.min(TIMELINE_EDGE_BUFFER_DAYS, TIMELINE_MAX_EDGE_BUFFER_DAYS) *
      ONE_DAY_IN_MS;
    const minMs =
      minDueDateMs < defaultMinMs ? minDueDateMs - edgeBufferMs : defaultMinMs;
    const maxMs =
      maxDueDateMs <= defaultMaxMs
        ? maxDueDateMs + edgeBufferMs
        : maxDueDateMs + edgeBufferMs;
    const spanDays = Math.max(
      1,
      Math.floor((maxMs - minMs) / ONE_DAY_IN_MS) + 1
    );

    return {
      minMs,
      maxMs,
      spanDays,
    };
  }, [statusFilter, timelineTasksByStatus, todayMs]);

  const timelineWidth = useMemo(() => {
    if (!timelineDateRange) {
      return 960;
    }

    return Math.max(960, timelineDateRange.spanDays * 48);
  }, [timelineDateRange]);

  const timelineTicks = useMemo(() => {
    if (!timelineDateRange) {
      return [];
    }

    return buildTimelineTicks(timelineDateRange);
  }, [timelineDateRange]);

  const getTimelineLeftPosition = (dueDateMs: number): number => {
    if (!timelineDateRange || timelineDateRange.maxMs === timelineDateRange.minMs) {
      return 0;
    }

    const progress =
      (dueDateMs - timelineDateRange.minMs) /
      (timelineDateRange.maxMs - timelineDateRange.minMs);

    return Math.max(
      0,
      Math.min(timelineWidth - TIMELINE_CHIP_WIDTH, progress * (timelineWidth - TIMELINE_CHIP_WIDTH))
    );
  };

  const getTimelineAxisLeftPosition = (dateMs: number): number => {
    if (!timelineDateRange || timelineDateRange.maxMs === timelineDateRange.minMs) {
      return 0;
    }

    const progress =
      (dateMs - timelineDateRange.minMs) /
      (timelineDateRange.maxMs - timelineDateRange.minMs);

    return Math.max(0, Math.min(timelineWidth, progress * timelineWidth));
  };

  const getTimelineChipLeftPosition = (dueDateMs: number): number => {
    const rawLeft = getTimelineLeftPosition(dueDateMs);
    if (!timelineDateRange) {
      return rawLeft;
    }

    const maxLeft = Math.max(0, timelineWidth - TIMELINE_CHIP_WIDTH);
    const isDueToday = dueDateMs === todayMs;
    if (isDueToday) {
      // Local-date match should snap exactly to Today line.
      const centeredLeft = timelineTodayLineLeft - TIMELINE_CHIP_WIDTH / 2;
      return Math.max(0, Math.min(maxLeft, centeredLeft));
    }

    const cardRight = rawLeft + TIMELINE_CHIP_WIDTH;
    const intersectsTodayLine =
      rawLeft < timelineTodayLineLeft && cardRight > timelineTodayLineLeft;

    if (!intersectsTodayLine) {
      return rawLeft;
    }

    const shiftedLeft =
      dueDateMs <= todayMs
        ? timelineTodayLineLeft - TIMELINE_CHIP_WIDTH - 8
        : timelineTodayLineLeft + 8;

    return Math.max(0, Math.min(maxLeft, shiftedLeft));
  };

  const timelineTodayLineLeft = timelineDateRange
    ? getTimelineAxisLeftPosition(todayMs)
    : 0;

  const activeTask = activeTaskId
    ? tasks.find((task) => task.id === activeTaskId) ?? null
    : null;

  const totalTimeSpent = useMemo(
    () => tasks.reduce((sum, task) => sum + task.timeSpent, 0),
    [tasks]
  );

  const overdueTasksCount = useMemo(() => {
    return tasks.filter(
      (task) => task.status !== "Done" && !!task.dueDate && task.dueDate < todayString
    ).length;
  }, [tasks, todayString]);

  const taskCountByAssignee = useMemo(() => {
    const counts = new Map<string, number>();

    members.forEach((member) => {
      counts.set(member.name, 0);
    });
    counts.set("Unassigned", 0);

    tasks.forEach((task) => {
      const key = task.assignee ?? "Unassigned";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return counts;
  }, [members, tasks]);

  const progressPercent = useMemo(() => {
    if (tasks.length === 0) {
      return 0;
    }

    return Math.round((tasksByStatus.Done.length / tasks.length) * 100);
  }, [tasks.length, tasksByStatus.Done.length]);

  const atRiskCount = useMemo(
    () =>
      tasks.filter((task) => task.priority === "High" && task.status !== "Done").length,
    [tasks]
  );

  const openTasksCount = useMemo(
    () => tasks.filter((task) => task.status !== "Done").length,
    [tasks]
  );

  const blockedTasksCount = useMemo(
    () =>
      tasks.filter(
        (task) => task.status !== "Done" && task.blockerReason.trim().length > 0
      ).length,
    [tasks]
  );

  const dependencyBlockedTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (task.status === "Done" || task.dependencyTaskIds.length === 0) {
        return false;
      }

      return task.dependencyTaskIds.some((dependencyTaskId) => {
        const dependencyTask = taskById.get(dependencyTaskId);
        return Boolean(dependencyTask) && dependencyTask?.status !== "Done";
      });
    });
  }, [taskById, tasks]);

  const workloadCount = useMemo(
    () => tasksByStatus["In Progress"].length + tasksByStatus.Review.length,
    [tasksByStatus]
  );

  const dueThisWeekCount = useMemo(() => {
    return tasks.filter((task) => {
      if (!task.dueDate || task.status === "Done") {
        return false;
      }
      return task.dueDate >= todayString && task.dueDate <= addDaysToIsoDate(todayString, 7);
    }).length;
  }, [tasks, todayString]);

  const overdueTasks = useMemo(() => {
    return tasks
      .filter(
        (task) => task.status !== "Done" && !!task.dueDate && task.dueDate < todayString
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [tasks, todayString]);

  const highPriorityOpenTasks = useMemo(() => {
    return tasks
      .filter((task) => task.priority === "High" && task.status !== "Done")
      .sort((a, b) => {
        const dueA = a.dueDate || "9999-12-31";
        const dueB = b.dueDate || "9999-12-31";
        return dueA.localeCompare(dueB);
      });
  }, [tasks]);

  const tasksNeedingAttention = useMemo(() => {
    const selected: MarketingTask[] = [];
    const selectedIds = new Set<string>();

    overdueTasks.forEach((task) => {
      if (selected.length >= 5 || selectedIds.has(task.id)) {
        return;
      }
      selected.push(task);
      selectedIds.add(task.id);
    });

    highPriorityOpenTasks.forEach((task) => {
      if (selected.length >= 5 || selectedIds.has(task.id)) {
        return;
      }
      selected.push(task);
      selectedIds.add(task.id);
    });

    tasks
      .filter((task) => task.status !== "Done" && task.blockerReason.trim().length > 0)
      .forEach((task) => {
        if (selected.length >= 6 || selectedIds.has(task.id)) {
          return;
        }
        selected.push(task);
        selectedIds.add(task.id);
      });

    dependencyBlockedTasks.forEach((task) => {
      if (selected.length >= 6 || selectedIds.has(task.id)) {
        return;
      }
      selected.push(task);
      selectedIds.add(task.id);
    });

    return selected;
  }, [dependencyBlockedTasks, highPriorityOpenTasks, overdueTasks, tasks]);

  const bottleneckStatus = useMemo(() => {
    const statusCounts = TASK_STATUS_OPTIONS.map((status) => ({
      status,
      count: tasksByStatus[status].length,
    }));

    return statusCounts.reduce((largest, current) =>
      current.count > largest.count ? current : largest
    );
  }, [tasksByStatus]);

  const teamLoadRows = useMemo(() => {
    return members.map((member) => {
      const memberTasks = tasks.filter((task) => task.assignee === member.name);
      const assignedHours = memberTasks.reduce(
        (sum, task) => sum + task.hoursAssigned,
        0
      );
      const totalSpent = memberTasks.reduce((sum, task) => sum + task.timeSpent, 0);
      const highPriorityAssigned = memberTasks.filter(
        (task) => task.priority === "High" && task.status !== "Done"
      ).length;

      return {
        id: member.id,
        name: formatMemberName(member),
        allocatedHours: member.hoursAllocated,
        assignedHours,
        assignedCount: memberTasks.length,
        totalSpent,
        highPriorityAssigned,
      };
    });
  }, [members, tasks]);

  const modalRecurringWeekDates = useMemo(
    () =>
      currentWeekDates.filter(
        (day) =>
          modalRecurringDays.includes(day.weekday) &&
          (!modalDueDate || day.date <= modalDueDate)
      ),
    [currentWeekDates, modalDueDate, modalRecurringDays]
  );

  const clearFilters = () => {
    updateTaskFilters(createDefaultTaskFilterState());
  };

  const clearTaskViewControls = () => {
    clearFilters();
    setIsHideDoneInBoard(false);
  };

  const updateRecurringFilters = (nextValues: Partial<RecurringFiltersState>) => {
    setRecurringFilters((currentFilters) => ({
      ...currentFilters,
      ...nextValues,
    }));
  };

  const clearRecurringFilters = () => {
    setRecurringFilters(createDefaultRecurringFilters());
  };

  const recurringDateMs = getDateMsFromIsoDate(recurringDate);
  const recurringSelectedWeekday =
    recurringDateMs === null
      ? null
      : getWeekdayFromDate(new Date(recurringDateMs));
  const recurringFilterQuery = recurringFilters.search.trim().toLowerCase();

  const recurringTasksForSelectedDate = useMemo(() => {
    if (recurringSelectedWeekday === null) {
      return [];
    }

    return tasks
      .filter((task) => {
        if (!task.isRecurring || !task.recurringDays.includes(recurringSelectedWeekday)) {
          return false;
        }
        if (task.dueDate && recurringDate > task.dueDate) {
          return false;
        }

        if (recurringFilterQuery) {
          const title = task.title.toLowerCase();
          const descriptionText = task.description.toLowerCase();
          if (
            !title.includes(recurringFilterQuery) &&
            !descriptionText.includes(recurringFilterQuery)
          ) {
            return false;
          }
        }

        if (
          recurringFilters.assignee === UNASSIGNED_FILTER_VALUE &&
          task.assignee !== null
        ) {
          return false;
        }
        if (
          recurringFilters.assignee !== ALL_FILTER_VALUE &&
          recurringFilters.assignee !== UNASSIGNED_FILTER_VALUE &&
          task.assignee !== recurringFilters.assignee
        ) {
          return false;
        }

        if (
          recurringFilters.priority !== ALL_FILTER_VALUE &&
          task.priority !== recurringFilters.priority
        ) {
          return false;
        }

        if (
          recurringFilters.status !== ALL_FILTER_VALUE &&
          task.status !== recurringFilters.status
        ) {
          return false;
        }

        return true;
      })
      .sort((firstTask, secondTask) => firstTask.title.localeCompare(secondTask.title));
  }, [recurringDate, recurringFilterQuery, recurringFilters, recurringSelectedWeekday, tasks]);

  const recurringWeeklyAllocatedHoursByTask = useMemo(() => {
    return new Map(
      tasks
        .filter((task) => task.isRecurring)
        .map((task) => [
          task.id,
          getRecurringWeeklyAllocatedHours(task, currentWeekDates),
        ])
    );
  }, [currentWeekDates, tasks]);

  const writeProjectTasks = (nextTasks: MarketingTask[]) => {
    writeMarketingTasksForProject(projectId, normalizeMarketingTaskOrders(nextTasks));
  };

  const writeProjectMembers = (nextMembers: MarketingMember[]) => {
    writeMarketingMembersForProject(projectId, nextMembers);
  };

  const appendProjectCommitLogs = (
    logs: Array<{
      scope?: "project" | "task";
      action?: string;
      field: string;
      fromValue: string;
      toValue: string;
      taskId?: string | null;
      taskTitle?: string | null;
    }>
  ) => {
    if (!project || logs.length === 0) {
      return;
    }

    const actorName = readDemoUser()?.name ?? "Unknown user";
    const changedAt = new Date();
    const changedAtIso = changedAt.toISOString();
    const changedAtIndia = createIndiaDateTimeLabel(changedAt);

    appendMarketingProjectCommitLogs(
      logs.map((logEntry) => ({
        ...logEntry,
        scope: logEntry.scope ?? "task",
        action: logEntry.action ?? "updated",
        projectId: project.id,
        projectName: project.name,
        changedBy: actorName,
        changedAtIso,
        changedAtIndia,
      }))
    );
  };

  const trackTaskAssignmentChange = ({
    taskId,
    taskTitle,
    previousAssignee,
    nextAssignee,
    previousHoursAssigned,
    nextHoursAssigned,
    reason,
  }: {
    taskId: string;
    taskTitle: string;
    previousAssignee: string | null;
    nextAssignee: string | null;
    previousHoursAssigned: number;
    nextHoursAssigned: number;
    reason: string;
  }) => {
    if (!project) {
      return;
    }

    void recordTaskAssignmentEvent({
      workstream: "marketing",
      projectId: project.id,
      projectName: project.name,
      taskId,
      taskTitle,
      fromAssignee: previousAssignee,
      toAssignee: nextAssignee,
      fromHoursAssigned: previousHoursAssigned,
      toHoursAssigned: nextHoursAssigned,
      reason,
    });
  };

  const openTeamEditModal = () => {
    setTeamEditRows(
      members.map((member) => {
        const matchedPerson =
          (member.userId ? loggedPeopleById.get(member.userId) : null) ??
          loggedPeople.find(
            (person) =>
              normalizeNameValue(person.name) === normalizeNameValue(member.name)
          );

        if (member.source === "external" || !matchedPerson) {
          return {
            id: member.id,
            memberSelection: EXTERNAL_MEMBER_VALUE,
            externalName: stripExternalSuffix(member.name),
            hoursAllocatedInput: String(member.hoursAllocated),
          };
        }

        return {
          id: member.id,
          memberSelection: matchedPerson.id,
          externalName: "",
          hoursAllocatedInput: String(member.hoursAllocated),
        };
      })
    );
    setTeamEditError("");
    setIsTeamEditModalOpen(true);
  };

  const closeTeamEditModal = () => {
    setIsTeamEditModalOpen(false);
    setTeamEditRows([]);
    setTeamEditError("");
  };

  const addTeamEditRow = () => {
    setTeamEditRows((rows) => [
      ...rows,
      {
        id: createMarketingMemberId(),
        memberSelection: "",
        externalName: "",
        hoursAllocatedInput: "",
      },
    ]);
  };

  const updateTeamEditRowSelection = (memberId: string, nextSelection: string) => {
    setTeamEditRows((rows) =>
      rows.map((row) =>
        row.id === memberId
          ? {
              ...row,
              memberSelection: nextSelection,
            }
          : row
      )
    );
  };

  const updateTeamEditRowExternalName = (memberId: string, nextName: string) => {
    setTeamEditRows((rows) =>
      rows.map((row) =>
        row.id === memberId ? { ...row, externalName: nextName } : row
      )
    );
  };

  const updateTeamEditRowHours = (memberId: string, nextHours: string) => {
    const digitsOnly = nextHours.replace(/\D/g, "");
    const normalizedHours = digitsOnly.replace(/^0+(?=\d)/, "");
    setTeamEditRows((rows) =>
      rows.map((row) =>
        row.id === memberId
          ? { ...row, hoursAllocatedInput: normalizedHours }
          : row
      )
    );
  };

  const removeTeamEditRow = (memberId: string) => {
    setTeamEditRows((rows) => rows.filter((row) => row.id !== memberId));
  };

  const saveTeamMembers = () => {
    const normalizedRows = teamEditRows.map((row) => {
      const selectedPerson =
        row.memberSelection === EXTERNAL_MEMBER_VALUE
          ? null
          : loggedPeopleById.get(row.memberSelection) ?? null;
      const isExternal = row.memberSelection === EXTERNAL_MEMBER_VALUE || !selectedPerson;

      return {
        id: row.id,
        name: isExternal
          ? toExternalMemberName(row.externalName)
          : selectedPerson.name.trim(),
        hoursAllocated:
          row.hoursAllocatedInput.trim() === ""
            ? 0
            : Number(row.hoursAllocatedInput),
        source: (isExternal ? "external" : "internal") as MarketingMember["source"],
        userId: isExternal ? null : selectedPerson.id,
        hasInvalidSelection:
          row.memberSelection !== EXTERNAL_MEMBER_VALUE && selectedPerson === null,
      };
    });

    if (normalizedRows.some((row) => row.hasInvalidSelection)) {
      setTeamEditError(
        "Select a logged-in member from the list, or choose external and enter a name."
      );
      return;
    }

    const membersToSave: MarketingMember[] = normalizedRows.map((row) => ({
      id: row.id,
      name: row.name,
      hoursAllocated: row.hoursAllocated,
      source: row.source,
      userId: row.userId,
    }));

    if (membersToSave.some((row) => !row.name)) {
      setTeamEditError("Member name is required.");
      return;
    }

    if (
      membersToSave.some(
        (row) => !Number.isFinite(row.hoursAllocated) || row.hoursAllocated < 0
      )
    ) {
      setTeamEditError("Hours allocated must be 0 or greater.");
      return;
    }

    const uniqueNames = new Set<string>();
    for (const row of membersToSave) {
      const normalizedName = row.name.toLowerCase();
      if (uniqueNames.has(normalizedName)) {
        setTeamEditError("Member names must be unique.");
        return;
      }
      uniqueNames.add(normalizedName);
    }

    const previousMembersLabel =
      members.map((member) => formatMemberSummary(member)).join(", ") || "None";
    const nextMembersLabel =
      membersToSave.map((member) => formatMemberSummary(member)).join(", ") || "None";

    const previousById = new Map(members.map((member) => [member.id, member]));
    const nextById = new Map(membersToSave.map((member) => [member.id, member]));

    const removedNames = members
      .filter((member) => !nextById.has(member.id))
      .map((member) => member.name);
    const renamedFromTo = new Map<string, string>();

    membersToSave.forEach((nextMember) => {
      const previousMember = previousById.get(nextMember.id);
      if (previousMember && previousMember.name !== nextMember.name) {
        renamedFromTo.set(previousMember.name, nextMember.name);
      }
    });

    writeProjectMembers(membersToSave);
    if (previousMembersLabel !== nextMembersLabel) {
      appendProjectCommitLogs([
        {
          scope: "project",
          action: "updated",
          field: "teamMembers",
          fromValue: previousMembersLabel,
          toValue: nextMembersLabel,
        },
      ]);
    }

    const updatedTasks = tasks.map((task) => {
      if (!task.assignee) {
        return task;
      }

      const renamedAssignee = renamedFromTo.get(task.assignee) ?? task.assignee;
      if (removedNames.includes(renamedAssignee)) {
        return { ...task, assignee: null };
      }
      return renamedAssignee !== task.assignee
        ? { ...task, assignee: renamedAssignee }
        : task;
    });
    writeProjectTasks(updatedTasks);
    const assigneeAdjustedCount = updatedTasks.reduce((count, task) => {
      const previousTask = taskById.get(task.id);
      if (!previousTask || previousTask.assignee === task.assignee) {
        return count;
      }
      trackTaskAssignmentChange({
        taskId: task.id,
        taskTitle: task.title,
        previousAssignee: previousTask.assignee,
        nextAssignee: task.assignee,
        previousHoursAssigned: previousTask.hoursAssigned,
        nextHoursAssigned: task.hoursAssigned,
        reason: "team-update",
      });
      return count + 1;
    }, 0);
    if (assigneeAdjustedCount > 0) {
      appendProjectCommitLogs([
        {
          scope: "project",
          action: "updated",
          field: "taskAssignees",
          fromValue: "Before team update",
          toValue: `${assigneeAdjustedCount} task(s) reassigned`,
        },
      ]);
    }

    const currentTaskAssignee = parseAssigneeSelection(taskAssignee);
    if (currentTaskAssignee && !membersToSave.some((m) => m.name === currentTaskAssignee)) {
      setTaskAssignee(UNASSIGNED_VALUE);
    }
    const currentModalAssignee = parseAssigneeSelection(modalAssignee);
    if (
      currentModalAssignee &&
      !membersToSave.some((m) => m.name === currentModalAssignee)
    ) {
      setModalAssignee(UNASSIGNED_VALUE);
    }

    closeTeamEditModal();
  };

  const addCreateSubtask = () => {
    const trimmedTitle = newCreateSubtaskTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    setCreateSubtasks((subtasks) => [
      ...subtasks,
      {
        id: createMarketingSubtaskId(),
        title: trimmedTitle,
        done: false,
      },
    ]);
    setNewCreateSubtaskTitle("");
  };

  const toggleCreateSubtask = (subtaskId: string) => {
    setCreateSubtasks((subtasks) =>
      subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
      )
    );
  };

  const removeCreateSubtask = (subtaskId: string) => {
    setCreateSubtasks((subtasks) =>
      subtasks.filter((subtask) => subtask.id !== subtaskId)
    );
  };

  const addModalSubtask = () => {
    const trimmedTitle = newModalSubtaskTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    setModalSubtasks((subtasks) => [
      ...subtasks,
      {
        id: createMarketingSubtaskId(),
        title: trimmedTitle,
        done: false,
      },
    ]);
    setNewModalSubtaskTitle("");
  };

  const toggleModalSubtask = (subtaskId: string) => {
    setModalSubtasks((subtasks) =>
      subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
      )
    );
  };

  const removeModalSubtask = (subtaskId: string) => {
    setModalSubtasks((subtasks) =>
      subtasks.filter((subtask) => subtask.id !== subtaskId)
    );
  };

  const toggleCreateRecurringDay = (day: MarketingRecurringWeekday) => {
    setRecurringDays((currentDays) =>
      currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : [...currentDays, day]
    );
  };

  const toggleModalRecurringDay = (day: MarketingRecurringWeekday) => {
    setModalRecurringDays((currentDays) =>
      currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : [...currentDays, day]
    );
  };

  const toggleCreateDependencyTask = (taskId: string) => {
    setTaskDependencyTaskIds((currentTaskIds) =>
      currentTaskIds.includes(taskId)
        ? currentTaskIds.filter((currentTaskId) => currentTaskId !== taskId)
        : [...currentTaskIds, taskId]
    );
  };

  const toggleModalDependencyTask = (taskId: string) => {
    setModalDependencyTaskIds((currentTaskIds) =>
      currentTaskIds.includes(taskId)
        ? currentTaskIds.filter((currentTaskId) => currentTaskId !== taskId)
        : [...currentTaskIds, taskId]
    );
  };

  const toggleModalRecurringCompletion = (date: string, nextValue: boolean) => {
    setModalRecurringCompletions((currentCompletions) => ({
      ...currentCompletions,
      [date]: nextValue,
    }));
    if (modalTaskId) {
      setRecurringCompletionForDate(modalTaskId, date, nextValue);
    }
  };

  const openCreateTaskForm = () => {
    setTaskTitle("");
    setDescription("");
    setDueDate("");
    setTaskAssignee(UNASSIGNED_VALUE);
    setTaskHoursAssigned("0");
    setTaskBlockerReason("");
    setTaskDependencyTaskIds([]);
    setIsCreateDependenciesOpen(false);
    setTaskPriority("Medium");
    setIsRecurringTask(false);
    setRecurringDays([]);
    setRecurringTimePerOccurrenceHours("0");
    setIsCreateSubtasksEnabled(false);
    setCreateSubtasks([]);
    setNewCreateSubtaskTitle("");
    setIsTaskFormOpen(true);
  };

  const closeTaskForm = () => {
    setTaskTitle("");
    setDescription("");
    setDueDate("");
    setTaskAssignee(UNASSIGNED_VALUE);
    setTaskHoursAssigned("0");
    setTaskBlockerReason("");
    setTaskDependencyTaskIds([]);
    setIsCreateDependenciesOpen(false);
    setTaskPriority("Medium");
    setIsRecurringTask(false);
    setRecurringDays([]);
    setRecurringTimePerOccurrenceHours("0");
    setIsCreateSubtasksEnabled(false);
    setCreateSubtasks([]);
    setNewCreateSubtaskTitle("");
    setIsTaskFormOpen(false);
  };

  const openTaskModal = (task: MarketingTask) => {
    if (isInDragCooldownRef.current) {
      return;
    }

    setModalTaskId(task.id);
    setModalTaskTitle(task.title);
    setModalDescription(task.description);
    setModalDueDate(task.dueDate);
    setModalStatus(task.status);
    setModalAssignee(formatAssigneeSelection(task.assignee));
    setModalHoursAssigned(String(task.hoursAssigned));
    setModalBlockerReason(task.blockerReason);
    setModalDependencyTaskIds(task.dependencyTaskIds);
    setIsModalDependenciesOpen(false);
    setModalTimeSpent(String(task.timeSpent));
    setModalPriority(task.priority);
    setModalIsRecurringTask(task.isRecurring);
    setModalRecurringDays(task.recurringDays);
    setModalRecurringTimePerOccurrenceHours(
      String(task.recurringTimePerOccurrenceHours)
    );
    setModalRecurringCompletions(task.recurringCompletions);
    setModalSubtasks(task.subtasks);
    setNewModalSubtaskTitle("");
  };

  const closeTaskModal = () => {
    setModalTaskId(null);
    setModalTaskTitle("");
    setModalDescription("");
    setModalDueDate("");
    setModalStatus("To Do");
    setModalAssignee(UNASSIGNED_VALUE);
    setModalHoursAssigned("0");
    setModalBlockerReason("");
    setModalDependencyTaskIds([]);
    setIsModalDependenciesOpen(false);
    setModalTimeSpent("0");
    setModalPriority("Medium");
    setModalIsRecurringTask(false);
    setModalRecurringDays([]);
    setModalRecurringTimePerOccurrenceHours("0");
    setModalRecurringCompletions({});
    setModalSubtasks([]);
    setNewModalSubtaskTitle("");
  };

  const openTaskFromSummary = (task: MarketingTask) => {
    setActiveTasksTab("tasks");
    openTaskModal(task);
  };

  const onSubmitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTaskTitle = taskTitle.trim();
    if (!trimmedTaskTitle || !dueDate) {
      return;
    }
    const parsedTaskHoursAssigned = Number(taskHoursAssigned);
    if (!Number.isFinite(parsedTaskHoursAssigned) || parsedTaskHoursAssigned < 0) {
      return;
    }
    const parsedRecurringTimePerOccurrenceHours = Number(
      recurringTimePerOccurrenceHours
    );
    if (
      !Number.isFinite(parsedRecurringTimePerOccurrenceHours) ||
      parsedRecurringTimePerOccurrenceHours < 0
    ) {
      return;
    }
    const normalizedBlockerReason = taskBlockerReason.trim();
    const actorName = readDemoUser()?.name ?? "Unknown user";
    const assignee = parseAssigneeSelection(taskAssignee);
    const validDependencyTaskIds = [
      ...new Set(
        taskDependencyTaskIds.filter((dependencyTaskId) =>
          tasks.some((task) => task.id === dependencyTaskId)
        )
      ),
    ];

    const newTask: MarketingTask = {
      id: createMarketingTaskId(),
      createdAt: todayString,
      assignedByName: assignee ? actorName : null,
      assignedByUserId: null,
      assignedAtIso: assignee ? new Date().toISOString() : null,
      title: trimmedTaskTitle,
      description: description.trim(),
      dueDate,
      status: "To Do",
      order: tasksByStatus["To Do"].length,
      assignee,
      hoursAssigned: parsedTaskHoursAssigned,
      blockerReason: normalizedBlockerReason,
      dependencyTaskIds: validDependencyTaskIds,
      timeSpent: 0,
      priority: taskPriority,
      subtasks: isCreateSubtasksEnabled ? createSubtasks : [],
      isRecurring: isRecurringTask,
      recurringDays: isRecurringTask ? recurringDays : [],
      recurringTimePerOccurrenceHours: isRecurringTask
        ? parsedRecurringTimePerOccurrenceHours
        : 0,
      recurringCompletions: {},
    };
    const updatedTasks: MarketingTask[] = [...tasks, newTask];

    writeProjectTasks(updatedTasks);
    const creationLogs: Array<{
      scope?: "project" | "task";
      action?: string;
      field: string;
      fromValue: string;
      toValue: string;
      taskId?: string | null;
      taskTitle?: string | null;
    }> = [
      {
        scope: "task",
        action: "created",
        field: "task",
        fromValue: "-",
        toValue: `${newTask.title} (${newTask.status})`,
        taskId: newTask.id,
        taskTitle: newTask.title,
      },
    ];
    if (newTask.assignee !== null) {
      creationLogs.push({
        scope: "task",
        action: "updated",
        field: "assignee",
        fromValue: "Unassigned",
        toValue: formatTaskAssigneeLabel(newTask.assignee),
        taskId: newTask.id,
        taskTitle: newTask.title,
      });
    }
    if (newTask.hoursAssigned > 0) {
      creationLogs.push({
        scope: "task",
        action: "updated",
        field: "hoursAssigned",
        fromValue: "0",
        toValue: String(newTask.hoursAssigned),
        taskId: newTask.id,
        taskTitle: newTask.title,
      });
    }
    appendProjectCommitLogs(creationLogs);
    trackTaskAssignmentChange({
      taskId: newTask.id,
      taskTitle: newTask.title,
      previousAssignee: null,
      nextAssignee: newTask.assignee,
      previousHoursAssigned: 0,
      nextHoursAssigned: newTask.hoursAssigned,
      reason: "task-created",
    });
    closeTaskForm();
  };

  const requestDeleteTask = (taskId: string) => {
    setDeleteConfirmTarget({ type: "task", taskId });
  };

  const deleteTaskNow = (taskId: string) => {
    const deletedTask = tasks.find((task) => task.id === taskId);
    const updatedTasks = tasks
      .filter((task) => task.id !== taskId)
      .map((task) => ({
        ...task,
        dependencyTaskIds: task.dependencyTaskIds.filter(
          (dependencyTaskId) => dependencyTaskId !== taskId
        ),
      }));
    writeProjectTasks(updatedTasks);
    if (deletedTask) {
      appendProjectCommitLogs([
        {
          scope: "task",
          action: "deleted",
          field: "task",
          fromValue: `${deletedTask.title} (${deletedTask.status})`,
          toValue: "Deleted",
          taskId: deletedTask.id,
          taskTitle: deletedTask.title,
        },
      ]);
    }
    if (modalTaskId === taskId) {
      closeTaskModal();
    }
  };

  const setRecurringCompletionForDate = (
    taskId: string,
    date: string,
    isDone: boolean
  ) => {
    const targetTask = tasks.find((task) => task.id === taskId);
    const updatedTasks = tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            recurringCompletions: {
              ...task.recurringCompletions,
              [date]: isDone,
            },
          }
        : task
    );
    writeProjectTasks(updatedTasks);
    if (targetTask) {
      appendProjectCommitLogs([
        {
          scope: "task",
          action: "updated",
          field: "recurringCompletion",
          fromValue: `${date}: ${
            targetTask.recurringCompletions[date] === true ? "Done" : "Not done"
          }`,
          toValue: `${date}: ${isDone ? "Done" : "Not done"}`,
          taskId: targetTask.id,
          taskTitle: targetTask.title,
        },
      ]);
    }
  };

  const onMoveTask = (taskId: string, status: MarketingTaskStatus) => {
    const movedTask = tasks.find((task) => task.id === taskId);
    const destinationTasks = tasksByStatus[status];
    const updatedTasks = tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status,
            order: destinationTasks.length,
          }
        : task
    );
    writeProjectTasks(updatedTasks);
    if (movedTask && movedTask.status !== status) {
      appendProjectCommitLogs([
        {
          scope: "task",
          action: "moved",
          field: "status",
          fromValue: movedTask.status,
          toValue: status,
          taskId: movedTask.id,
          taskTitle: movedTask.title,
        },
      ]);
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const onDragCancel = () => {
    setActiveTaskId(null);
    scheduleDragCooldown();
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    scheduleDragCooldown();

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      return;
    }

    const draggedTask = tasks.find((task) => task.id === activeId);
    if (!draggedTask) {
      return;
    }

    const overTask = tasks.find((task) => task.id === overId);
    const destinationStatus =
      overTask?.status ?? getStatusFromColumnId(event.over?.id ?? null);
    if (!destinationStatus) {
      return;
    }

    if (destinationStatus === draggedTask.status) {
      const tasksInStatus = tasksByStatus[destinationStatus];
      const oldIndex = tasksInStatus.findIndex((task) => task.id === activeId);
      if (oldIndex === -1) {
        return;
      }

      const newIndex = overTask
        ? tasksInStatus.findIndex((task) => task.id === overTask.id)
        : tasksInStatus.length - 1;
      if (newIndex === -1 || oldIndex === newIndex) {
        return;
      }

      const reordered = arrayMove(tasksInStatus, oldIndex, newIndex).map(
        (task, index) => ({
          ...task,
          order: index,
        })
      );
      const reorderedById = new Map(reordered.map((task) => [task.id, task]));
      const updatedTasks = tasks.map(
        (task) => reorderedById.get(task.id) ?? task
      );
      writeProjectTasks(updatedTasks);
      appendProjectCommitLogs([
        {
          scope: "task",
          action: "reordered",
          field: "order",
          fromValue: String(oldIndex + 1),
          toValue: String(newIndex + 1),
          taskId: draggedTask.id,
          taskTitle: draggedTask.title,
        },
      ]);
      return;
    }

    const sourceTasks = tasksByStatus[draggedTask.status].filter(
      (task) => task.id !== draggedTask.id
    );
    const destinationTasks = [...tasksByStatus[destinationStatus]];
    const insertIndex = overTask
      ? destinationTasks.findIndex((task) => task.id === overTask.id)
      : destinationTasks.length;

    const movedTask: MarketingTask = {
      ...draggedTask,
      status: destinationStatus,
      order: insertIndex === -1 ? destinationTasks.length : insertIndex,
    };

    if (insertIndex === -1) {
      destinationTasks.push(movedTask);
    } else {
      destinationTasks.splice(insertIndex, 0, movedTask);
    }

    const sourceById = new Map(
      sourceTasks.map((task, index) => [task.id, { ...task, order: index }])
    );
    const destinationById = new Map(
      destinationTasks.map((task, index) => [task.id, { ...task, order: index }])
    );

    const updatedTasks = tasks
      .map((task) => {
        if (sourceById.has(task.id)) {
          return sourceById.get(task.id)!;
        }
        if (destinationById.has(task.id)) {
          return destinationById.get(task.id)!;
        }
        return task;
      })
      .filter((task) => task.id !== draggedTask.id || destinationById.has(task.id));

    writeProjectTasks(updatedTasks);
    appendProjectCommitLogs([
      {
        scope: "task",
        action: "moved",
        field: "status",
        fromValue: draggedTask.status,
        toValue: destinationStatus,
        taskId: draggedTask.id,
        taskTitle: draggedTask.title,
      },
    ]);
  };

  const onSaveModalTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modalTaskId) {
      return;
    }

    const trimmedTitle = modalTaskTitle.trim();
    const parsedModalHoursAssigned = Number(modalHoursAssigned);
    const parsedTimeSpent = Number(modalTimeSpent);
    if (
      !trimmedTitle ||
      !modalDueDate ||
      !Number.isFinite(parsedModalHoursAssigned) ||
      parsedModalHoursAssigned < 0 ||
      !Number.isFinite(parsedTimeSpent) ||
      parsedTimeSpent < 0
    ) {
      return;
    }
    const parsedModalRecurringTimePerOccurrenceHours = Number(
      modalRecurringTimePerOccurrenceHours
    );
    if (
      !Number.isFinite(parsedModalRecurringTimePerOccurrenceHours) ||
      parsedModalRecurringTimePerOccurrenceHours < 0
    ) {
      return;
    }
    const normalizedModalBlockerReason = modalBlockerReason.trim();
    const validModalDependencyTaskIds = [
      ...new Set(
        modalDependencyTaskIds.filter(
          (dependencyTaskId) =>
            dependencyTaskId !== modalTaskId &&
            tasks.some((task) => task.id === dependencyTaskId)
        )
      ),
    ];
    const previousTask = tasks.find((task) => task.id === modalTaskId);
    if (!previousTask) {
      return;
    }
    const nextDescription = modalDescription.trim();
    const nextAssignee = parseAssigneeSelection(modalAssignee);
    const nextRecurringDays = modalIsRecurringTask ? modalRecurringDays : [];
    const nextRecurringTimePerOccurrenceHours = modalIsRecurringTask
      ? parsedModalRecurringTimePerOccurrenceHours
      : 0;
    const actorName = readDemoUser()?.name ?? "Unknown user";

    const updatedTasks = tasks.map((task) => {
      if (task.id !== modalTaskId) {
        return task;
      }

      const statusChanged = task.status !== modalStatus;
      const assignmentChanged =
        task.assignee !== nextAssignee ||
        task.hoursAssigned !== parsedModalHoursAssigned;
      return {
        ...task,
        title: trimmedTitle,
        description: nextDescription,
        dueDate: modalDueDate,
        status: modalStatus,
        order: statusChanged ? tasksByStatus[modalStatus].length : task.order,
        assignee: nextAssignee,
        hoursAssigned: parsedModalHoursAssigned,
        blockerReason: normalizedModalBlockerReason,
        dependencyTaskIds: validModalDependencyTaskIds,
        timeSpent: parsedTimeSpent,
        priority: modalPriority,
        subtasks: modalSubtasks,
        isRecurring: modalIsRecurringTask,
        recurringDays: nextRecurringDays,
        recurringTimePerOccurrenceHours: nextRecurringTimePerOccurrenceHours,
        recurringCompletions: modalRecurringCompletions,
        assignedByName: assignmentChanged ? actorName : task.assignedByName,
        assignedByUserId: assignmentChanged ? null : task.assignedByUserId,
        assignedAtIso: assignmentChanged
          ? new Date().toISOString()
          : task.assignedAtIso,
      };
    });

    writeProjectTasks(updatedTasks);
    const changeLogs = [
      previousTask.title !== trimmedTitle
        ? {
            scope: "task" as const,
            action: "updated",
            field: "title",
            fromValue: previousTask.title,
            toValue: trimmedTitle,
            taskId: previousTask.id,
            taskTitle: previousTask.title,
          }
        : null,
      previousTask.description !== nextDescription
        ? {
            scope: "task" as const,
            action: "updated",
            field: "description",
            fromValue: previousTask.description || "-",
            toValue: nextDescription || "-",
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.dueDate !== modalDueDate
        ? {
            scope: "task" as const,
            action: "updated",
            field: "dueDate",
            fromValue: previousTask.dueDate,
            toValue: modalDueDate,
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.status !== modalStatus
        ? {
            scope: "task" as const,
            action: "updated",
            field: "status",
            fromValue: previousTask.status,
            toValue: modalStatus,
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.priority !== modalPriority
        ? {
            scope: "task" as const,
            action: "updated",
            field: "priority",
            fromValue: previousTask.priority,
            toValue: modalPriority,
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.assignee !== nextAssignee
        ? {
            scope: "task" as const,
            action: "updated",
            field: "assignee",
            fromValue: formatTaskAssigneeLabel(previousTask.assignee),
            toValue: formatTaskAssigneeLabel(nextAssignee),
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.hoursAssigned !== parsedModalHoursAssigned
        ? {
            scope: "task" as const,
            action: "updated",
            field: "hoursAssigned",
            fromValue: String(previousTask.hoursAssigned),
            toValue: String(parsedModalHoursAssigned),
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.timeSpent !== parsedTimeSpent
        ? {
            scope: "task" as const,
            action: "updated",
            field: "timeSpent",
            fromValue: String(previousTask.timeSpent),
            toValue: String(parsedTimeSpent),
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.blockerReason !== normalizedModalBlockerReason
        ? {
            scope: "task" as const,
            action: "updated",
            field: "blockerReason",
            fromValue: previousTask.blockerReason || "-",
            toValue: normalizedModalBlockerReason || "-",
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.dependencyTaskIds.join(",") !== validModalDependencyTaskIds.join(",")
        ? {
            scope: "task" as const,
            action: "updated",
            field: "dependencyTaskIds",
            fromValue: previousTask.dependencyTaskIds.join(", ") || "None",
            toValue: validModalDependencyTaskIds.join(", ") || "None",
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.isRecurring !== modalIsRecurringTask
        ? {
            scope: "task" as const,
            action: "updated",
            field: "isRecurring",
            fromValue: previousTask.isRecurring ? "Yes" : "No",
            toValue: modalIsRecurringTask ? "Yes" : "No",
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.recurringDays.join(",") !== nextRecurringDays.join(",")
        ? {
            scope: "task" as const,
            action: "updated",
            field: "recurringDays",
            fromValue: previousTask.recurringDays.join(", ") || "None",
            toValue: nextRecurringDays.join(", ") || "None",
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
      previousTask.recurringTimePerOccurrenceHours !== nextRecurringTimePerOccurrenceHours
        ? {
            scope: "task" as const,
            action: "updated",
            field: "recurringTimePerOccurrenceHours",
            fromValue: String(previousTask.recurringTimePerOccurrenceHours),
            toValue: String(nextRecurringTimePerOccurrenceHours),
            taskId: previousTask.id,
            taskTitle: trimmedTitle,
          }
        : null,
    ].filter((entry) => entry !== null);
    appendProjectCommitLogs(changeLogs);
    trackTaskAssignmentChange({
      taskId: previousTask.id,
      taskTitle: trimmedTitle,
      previousAssignee: previousTask.assignee,
      nextAssignee,
      previousHoursAssigned: previousTask.hoursAssigned,
      nextHoursAssigned: parsedModalHoursAssigned,
      reason: "task-modal-edit",
    });
    closeTaskModal();
  };

  const onDeleteModalTask = () => {
    if (!modalTaskId) {
      return;
    }
    requestDeleteTask(modalTaskId);
  };

  const cancelDeleteConfirm = () => {
    setDeleteConfirmTarget(null);
  };

  const confirmDelete = () => {
    if (!deleteConfirmTarget) {
      return;
    }

    deleteTaskNow(deleteConfirmTarget.taskId);
    setDeleteConfirmTarget(null);
  };

  useEffect(() => {
    if (!modalTaskId && !isTeamEditModalOpen && !isCommitLogsModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (modalTaskId) {
        closeTaskModal();
      }
      if (isTeamEditModalOpen) {
        closeTeamEditModal();
      }
      if (isCommitLogsModalOpen) {
        setIsCommitLogsModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCommitLogsModalOpen, modalTaskId, isTeamEditModalOpen]);

  useEffect(() => {
    if (activeTasksTab !== "tasks" || activeTaskBoardView !== "timeline") {
      return;
    }
    if (!timelineDateRange || !timelineScrollContainerRef.current) {
      return;
    }

    const container = timelineScrollContainerRef.current;
    const targetLeft = Math.max(
      0,
      timelineTodayLineLeft - container.clientWidth / 2
    );

    container.scrollTo({
      left: targetLeft,
      behavior: "smooth",
    });
  }, [
    activeTaskBoardView,
    activeTasksTab,
    timelineDateRange,
    timelineTodayLineLeft,
  ]);

  if (!project) {
    return (
      <section className="w-full max-w-2xl rounded-lg border border-black/10 p-6">
        <h1 className="text-2xl font-semibold">Project not found</h1>
        <Link
          href="/marketing"
          className="mt-4 inline-block rounded-md border border-black/20 px-3 py-2 text-sm font-medium hover:bg-black/5"
        >
          Back to Marketing
        </Link>
      </section>
    );
  }

  return (
    <section className="w-full max-w-7xl space-y-5">
      <div className="rounded-2xl border border-black/10 bg-gradient-to-b from-white to-black/[0.02] p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-xs sm:text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-3 py-1 text-black/80">
                <CalendarDays className="h-3.5 w-3.5" />
                Start {project.startDate}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-3 py-1 text-black/80">
                <Clock3 className="h-3.5 w-3.5" />
                Deadline {project.deadline}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-3 py-1 text-black/80">
                <Users className="h-3.5 w-3.5" />
                {members.length} {members.length === 1 ? "member" : "members"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-black/15 bg-white p-1">
              <button
                type="button"
                onClick={() => setActiveTasksTab("tasks")}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  activeTasksTab === "tasks"
                    ? "bg-black text-white"
                    : "text-black/70 hover:bg-black/5"
                }`}
              >
                Board
              </button>
              <button
                type="button"
                onClick={() => setActiveTasksTab("summary")}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  activeTasksTab === "summary"
                    ? "bg-black text-white"
                    : "text-black/70 hover:bg-black/5"
                }`}
              >
                Health
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsCommitLogsModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-black/15 bg-white px-3 py-1.5 text-xs font-medium text-black/75 hover:bg-black/5"
            >
              <History className="h-3.5 w-3.5" />
              Commit Logs
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
            <p className="text-xs text-black/55">Progress</p>
            <p className="mt-1 text-lg font-semibold">{progressPercent}% done</p>
            <div className="mt-2 h-1.5 rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-black"
                style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
              />
            </div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
            <p className="text-xs text-red-700/80">Overdue</p>
            <p className="mt-1 text-lg font-semibold text-red-700">{overdueTasksCount}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
            <p className="text-xs text-amber-700/80">At risk (High open)</p>
            <p className="mt-1 text-lg font-semibold text-amber-700">{atRiskCount}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2">
            <p className="text-xs text-blue-700/80">Workload</p>
            <p className="mt-1 text-lg font-semibold text-blue-700">
              {workloadCount} active · {dueThisWeekCount} due this week
            </p>
          </div>
        </div>

        {project.tags.length > 0 ? (
          <div className="mt-4 rounded-lg border border-black/10 bg-white/75 px-3 py-2">
            <p className="text-xs font-medium text-black/70">Tags</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {project.tags.map((tag) => (
                <span
                  key={`${project.id}-${tag}`}
                  className="inline-flex rounded-full border border-black/15 bg-black/[0.03] px-2 py-0.5 text-xs text-black/75"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-start gap-2 rounded-lg border border-black/10 bg-white/75 px-3 py-2 text-sm">
          <span className="font-medium text-black/80">Team members:</span>
          <span className="min-w-[220px] flex-1 text-black/75">
            {members.length === 0
              ? "None"
              : members.map((member) => formatMemberSummary(member)).join(", ")}
          </span>
          <span className="text-xs text-black/60">
            Allocated total {formatHours(
              members.reduce((sum, member) => sum + member.hoursAllocated, 0)
            )}
          </span>
          <button
            type="button"
            onClick={openTeamEditModal}
            title="Edit team"
            aria-label="Edit team"
            className="rounded-md border border-black/20 p-1.5 hover:bg-black/5"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">Tasks</h2>
            <div
              role="tablist"
              aria-label="Tasks section tabs"
              className="inline-flex rounded-md border border-black/20 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTasksTab === "tasks"}
                onClick={() => setActiveTasksTab("tasks")}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTasksTab === "tasks"
                    ? "bg-black text-white"
                    : "text-black/70 hover:bg-black/5"
                }`}
              >
                Tasks
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTasksTab === "recurring"}
                onClick={() => setActiveTasksTab("recurring")}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTasksTab === "recurring"
                    ? "bg-black text-white"
                    : "text-black/70 hover:bg-black/5"
                }`}
              >
                Recurring
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTasksTab === "summary"}
                onClick={() => setActiveTasksTab("summary")}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTasksTab === "summary"
                    ? "bg-black text-white"
                    : "text-black/70 hover:bg-black/5"
                }`}
              >
                Summary
              </button>
            </div>
            {activeTasksTab === "tasks" ? (
              <div
                role="tablist"
                aria-label="Task board view"
                className="inline-flex rounded-md border border-black/20 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTaskBoardView === "kanban"}
                  onClick={() => updateTaskBoardView("kanban")}
                  className={`rounded px-3 py-1.5 text-sm ${
                    activeTaskBoardView === "kanban"
                      ? "bg-black text-white"
                      : "text-black/70 hover:bg-black/5"
                  }`}
                >
                  Kanban
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTaskBoardView === "timeline"}
                  onClick={() => updateTaskBoardView("timeline")}
                  className={`rounded px-3 py-1.5 text-sm ${
                    activeTaskBoardView === "timeline"
                      ? "bg-black text-white"
                      : "text-black/70 hover:bg-black/5"
                  }`}
                >
                  Timeline
                </button>
              </div>
            ) : null}
          </div>
          {activeTasksTab === "tasks" ? (
            <button
              type="button"
              onClick={openCreateTaskForm}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + New Task
            </button>
          ) : null}
        </div>

        {activeTasksTab === "tasks" ? (
          <>
            {isTaskFormOpen ? (
              <form
                onSubmit={onSubmitTask}
                className="mt-5 rounded-lg border border-black/10 p-4"
              >
                <div className="grid gap-4">
                  <label className="text-sm">
                    Task Title
                    <input
                      type="text"
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      required
                    />
                  </label>

                  <label className="text-sm">
                    Description
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={4}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm">
                      Due Date
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                        required
                      />
                    </label>

                    <label className="text-sm">
                      Assignee
                      <select
                        value={taskAssignee}
                        onChange={(event) => setTaskAssignee(event.target.value)}
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      >
                        <option value={UNASSIGNED_VALUE}>Unassigned</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.name}>
                            {formatMemberName(member)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm">
                      Hours Assigned
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={taskHoursAssigned}
                        onChange={(event) => setTaskHoursAssigned(event.target.value)}
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      />
                    </label>

                    <label className="text-sm">
                      Priority
                      <select
                        value={taskPriority}
                        onChange={(event) =>
                          setTaskPriority(event.target.value as MarketingTaskPriority)
                        }
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      >
                        {TASK_PRIORITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="text-sm">
                    Blocker (optional)
                    <input
                      type="text"
                      value={taskBlockerReason}
                      onChange={(event) => setTaskBlockerReason(event.target.value)}
                      placeholder="Waiting on legal approval, assets, feedback..."
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    />
                  </label>

                  <div className="rounded-md border border-black/10 p-3">
                    <button
                      type="button"
                      onClick={() =>
                        setIsCreateDependenciesOpen((isOpen) => !isOpen)
                      }
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <p className="text-sm font-medium">
                        Dependencies
                        {taskDependencyTaskIds.length > 0
                          ? ` (${taskDependencyTaskIds.length})`
                          : ""}
                      </p>
                      {isCreateDependenciesOpen ? (
                        <ChevronDown className="h-4 w-4 text-black/55" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-black/55" />
                      )}
                    </button>
                    {isCreateDependenciesOpen ? (
                      tasks.length === 0 ? (
                        <p className="mt-2 text-xs text-black/55">
                          No existing tasks to link.
                        </p>
                      ) : (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {tasks.map((task) => (
                            <label
                              key={`create-dependency-${task.id}`}
                              className="inline-flex items-center gap-2 text-xs text-black/75"
                            >
                              <input
                                type="checkbox"
                                checked={taskDependencyTaskIds.includes(task.id)}
                                onChange={() => toggleCreateDependencyTask(task.id)}
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
                      checked={isRecurringTask}
                      onChange={(event) => setIsRecurringTask(event.target.checked)}
                    />
                    Recurring task
                  </label>

                  {isRecurringTask ? (
                    <div className="rounded-md border border-black/10 p-3">
                      <p className="text-sm font-medium">Recurring days</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {RECURRING_WEEKDAY_OPTIONS.map((day) => {
                          const isSelected = recurringDays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => toggleCreateRecurringDay(day)}
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
                          value={recurringTimePerOccurrenceHours}
                          onChange={(event) =>
                            setRecurringTimePerOccurrenceHours(event.target.value)
                          }
                          className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                        />
                      </label>
                    </div>
                  ) : null}

                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isCreateSubtasksEnabled}
                      onChange={(event) =>
                        setIsCreateSubtasksEnabled(event.target.checked)
                      }
                    />
                    Add subtasks
                  </label>

                  {isCreateSubtasksEnabled ? (
                    <div className="rounded-md border border-black/10 p-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newCreateSubtaskTitle}
                          onChange={(event) =>
                            setNewCreateSubtaskTitle(event.target.value)
                          }
                          placeholder="Subtask title"
                          className="flex-1 rounded-md border border-black/20 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={addCreateSubtask}
                          className="rounded-md border border-black/20 px-3 py-2 text-sm hover:bg-black/5"
                        >
                          Add
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {createSubtasks.map((subtask) => (
                          <div
                            key={subtask.id}
                            className="flex items-center justify-between gap-2"
                          >
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={subtask.done}
                                onChange={() => toggleCreateSubtask(subtask.id)}
                              />
                              {subtask.title}
                            </label>
                            <button
                              type="button"
                              onClick={() => removeCreateSubtask(subtask.id)}
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

                <div className="mt-4 flex gap-3">
                  <button
                    type="submit"
                    className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={closeTaskForm}
                    className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.01] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(event) =>
                    updateTaskFilters({ search: event.target.value })
                  }
                  placeholder="Search tasks…"
                  aria-label="Search"
                  className="h-9 w-40 rounded-md border border-black/20 bg-white px-3 text-sm sm:w-48"
                />

                <select
                  value={assigneeFilter}
                  onChange={(event) =>
                    updateTaskFilters({ assignee: event.target.value })
                  }
                  aria-label="Person"
                  className="h-9 w-36 rounded-md border border-black/20 bg-white px-2 text-sm"
                >
                  <option value={ALL_FILTER_VALUE}>Person</option>
                  <option value={UNASSIGNED_FILTER_VALUE}>Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.name}>
                      {formatMemberName(member)}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(event) =>
                    updateTaskFilters({
                      status: event.target.value as TaskStatusFilterValue,
                    })
                  }
                  aria-label="Status"
                  className="h-9 w-32 rounded-md border border-black/20 bg-white px-2 text-sm"
                >
                  <option value={ALL_FILTER_VALUE}>Status</option>
                  {TASK_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() =>
                    setIsTaskAdvancedFiltersOpen((isOpen) => !isOpen)
                  }
                  className="h-9 rounded-md border border-black/20 bg-white px-3 text-xs font-medium hover:bg-black/5"
                >
                  {isTaskAdvancedFiltersOpen ? "Less filters" : "More filters"}
                </button>

                <button
                  type="button"
                  onClick={clearTaskViewControls}
                  className="h-9 rounded-md border border-black/20 bg-white px-3 text-sm hover:bg-black/5"
                >
                  Clear
                </button>
              </div>

              {isTaskAdvancedFiltersOpen ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 text-sm">
                  <select
                    value={priorityFilter}
                    onChange={(event) =>
                      updateTaskFilters({
                        priority: event.target.value as TaskPriorityFilterValue,
                      })
                    }
                    aria-label="Priority"
                    className="h-9 w-28 rounded-md border border-black/20 bg-white px-2 text-sm"
                  >
                    <option value={ALL_FILTER_VALUE}>Priority</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>

                  <label className="inline-flex h-9 items-center gap-2 rounded-full border border-black/20 bg-white px-3 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={isOverdueOnlyFilter}
                      onChange={(event) =>
                        updateTaskFilters({ isOverdueOnly: event.target.checked })
                      }
                    />
                    Overdue only
                  </label>
                  <label className="inline-flex h-9 items-center gap-2 rounded-full border border-black/20 bg-white px-3 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={isBlockedOnlyFilter}
                      onChange={(event) =>
                        updateTaskFilters({ isBlockedOnly: event.target.checked })
                      }
                    />
                    Blocked only
                  </label>
                  <label className="inline-flex h-9 items-center gap-2 rounded-full border border-black/20 bg-white px-3 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={isHideDoneInBoard}
                      onChange={(event) => setIsHideDoneInBoard(event.target.checked)}
                    />
                    Hide Done
                  </label>

                  {activeTaskBoardView === "kanban" ? (
                    <>
                      <button
                        type="button"
                        onClick={expandAllKanbanGroups}
                        className="rounded-md border border-black/20 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5"
                      >
                        Expand people
                      </button>
                      <button
                        type="button"
                        onClick={collapseAllKanbanGroups}
                        className="rounded-md border border-black/20 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5"
                      >
                        Collapse people
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-5 rounded-lg border border-black/10">
              {tasks.length === 0 ? (
                <p className="p-4 text-sm text-black/70">No tasks yet</p>
              ) : !hasVisibleFilteredTasks ? (
                <p className="p-4 text-sm text-black/70">
                  No tasks match current filters
                </p>
              ) : activeTaskBoardView === "kanban" ? (
                <div className="overflow-x-auto p-4">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={onDragStart}
                    onDragCancel={onDragCancel}
                    onDragEnd={onDragEnd}
                  >
                    <div
                      className={`grid gap-4 ${
                        visibleStatuses.length > 1 ? "min-w-[960px]" : "min-w-0"
                      }`}
                      style={{
                        gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(240px, 1fr))`,
                      }}
                    >
                      {visibleStatuses.map((status) => (
                        <KanbanColumn
                          key={status}
                          status={status}
                          tasks={filteredTasksByStatus[status]}
                          members={members}
                          collapsedGroupMap={collapsedKanbanGroups}
                          taskById={taskById}
                          openWipCountByAssignee={openWipCountByAssignee}
                          currentWeekDates={currentWeekDates}
                          todayDateString={todayString}
                          onOpenTask={openTaskModal}
                          onRequestDeleteTask={requestDeleteTask}
                          onMoveTask={onMoveTask}
                          onToggleGroup={toggleKanbanGroup}
                        />
                      ))}
                    </div>
                    <DragOverlay>
                      {activeTask ? (
                        <article className="rounded-md border border-black/10 bg-white p-3 shadow-lg">
                          <p className="font-medium">{activeTask.title}</p>
                          <p className="mt-2 text-sm text-black/70">
                            Due Date: {activeTask.dueDate}
                          </p>
                        </article>
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                </div>
              ) : !timelineDateRange ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-black/70">
                    No due dates available for the current filters.
                  </p>
                  <p className="mt-1 text-xs text-black/55">
                    Add due dates or adjust filters to see timeline placement.
                  </p>
                </div>
              ) : (
                <div ref={timelineScrollContainerRef} className="overflow-x-auto p-4">
                  <div className="min-w-max space-y-3">
                    <div className="rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-black/65">
                      <div className="flex flex-wrap items-center gap-4">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm border-2 border-red-400 bg-white" />
                          Red outline = Overdue
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm border-2 border-yellow-400 bg-white" />
                          Yellow outline = Due today
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-3 w-px bg-blue-500" />
                          Line = Today
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-[110px_auto] items-center gap-3">
                      <div className="text-xs font-medium text-black/60">Date axis</div>
                      <div
                        className="relative h-10 rounded-md border border-black/10 bg-white"
                        style={{ width: timelineWidth }}
                      >
                        {timelineTicks.map((tickMs) => {
                          const leftPosition = getTimelineAxisLeftPosition(tickMs);
                          return (
                            <div
                              key={tickMs}
                              className="absolute top-0 h-full"
                              style={{ left: leftPosition }}
                            >
                              <div className="h-full border-l border-black/10" />
                              <span className="absolute left-1 top-1 whitespace-nowrap text-[11px] text-black/60">
                                {TIMELINE_DATE_FORMATTER.format(new Date(tickMs))}
                              </span>
                            </div>
                          );
                        })}
                        <div
                          className="absolute -top-1 z-20 h-[calc(100%+4px)] w-px bg-blue-500/80"
                          style={{ left: timelineTodayLineLeft }}
                        >
                          <span className="absolute -top-6 left-1 z-30 whitespace-nowrap rounded border border-blue-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-blue-700 shadow-sm">
                            Today
                          </span>
                        </div>
                      </div>
                    </div>

                    {visibleStatuses.map((status) => {
                      const laneTasks = timelineTasksByStatus[status];
                      const stackDepth = laneTasks.reduce(
                        (maximum, entry) => Math.max(maximum, entry.stackIndex + 1),
                        1
                      );
                      const laneHeight = 40 + stackDepth * TIMELINE_CHIP_ROW_SPACING;

                      return (
                        <div
                          key={`timeline-${status}`}
                          className="grid grid-cols-[110px_auto] items-start gap-3"
                        >
                          <div className="pt-3 text-xs font-semibold text-black/70">
                            {status}
                          </div>
                          <div
                            className="relative rounded-lg border border-black/10 bg-black/[0.02]"
                            style={{ width: timelineWidth, minHeight: laneHeight }}
                          >
                            <div className="absolute inset-x-0 top-8 border-t border-black/10" />
                            <div
                              className="absolute bottom-0 top-0 z-10 w-px bg-blue-500/55"
                              style={{ left: timelineTodayLineLeft }}
                            />
                            {laneTasks.map((entry) => {
                              const isDone = entry.task.status === "Done";
                              const isOverdue = !isDone && entry.dueDateMs < todayMs;
                              const isDueToday = !isDone && entry.dueDateMs === todayMs;
                              const urgencyClass = isOverdue
                                ? "border-red-400"
                                : isDueToday
                                  ? "border-yellow-400"
                                  : "border-black/15";

                              return (
                                <button
                                  key={entry.task.id}
                                  type="button"
                                  onClick={() => openTaskModal(entry.task)}
                                  className={`absolute z-20 rounded-md border bg-white p-1.5 text-left shadow-sm hover:bg-black/[0.02] ${urgencyClass}`}
                                  style={{
                                    width: TIMELINE_CHIP_WIDTH,
                                    left: getTimelineChipLeftPosition(entry.dueDateMs),
                                    top: 10 + entry.stackIndex * TIMELINE_CHIP_ROW_SPACING,
                                  }}
                                >
                                  <p className="truncate text-xs font-medium">
                                    {entry.task.title}
                                  </p>
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span
                                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${getPriorityBadgeClasses(
                                        entry.task.priority
                                      )}`}
                                    >
                                      {entry.task.priority}
                                    </span>
                                    {entry.task.assignee ? (
                                      <span className="truncate text-[11px] text-black/60">
                                        {formatAssigneeDisplay(entry.task.assignee)}
                                      </span>
                                    ) : null}
                                    {isOverdue ? (
                                      <span className="text-[11px] font-medium text-red-600">
                                        Overdue
                                      </span>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })}
                            {laneTasks.length === 0 ? (
                              <p className="absolute left-3 top-12 text-xs text-black/45">
                                No tasks in this lane
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeTasksTab === "summary" ? (
          <div className="mt-4 space-y-4">
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-black/20 bg-black/[0.02] p-8 text-center">
                <ListChecks className="mx-auto h-8 w-8 text-black/45" />
                <p className="mt-3 text-base font-semibold">No tasks yet</p>
                <p className="mt-1 text-sm text-black/60">
                  Add tasks in the Tasks tab to see project health insights.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-medium text-emerald-700">Progress</p>
                    <p className="mt-2 text-2xl font-semibold text-emerald-800">
                      {progressPercent}%
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      {tasksByStatus.Done.length}/{tasks.length} complete
                    </p>
                  </div>
                  <div className="rounded-lg border border-black/15 bg-white p-3">
                    <p className="text-xs font-medium text-black/65">Open tasks</p>
                    <p className="mt-2 text-2xl font-semibold">{openTasksCount}</p>
                    <p className="mt-1 text-xs text-black/55">Not done</p>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-medium text-red-700">Blocked</p>
                    <p className="mt-2 text-2xl font-semibold text-red-800">
                      {blockedTasksCount}
                    </p>
                    <p className="mt-1 text-xs text-red-700">Manual blockers set</p>
                  </div>
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <p className="text-xs font-medium text-orange-700">Dependency blocked</p>
                    <p className="mt-2 text-2xl font-semibold text-orange-800">
                      {dependencyBlockedTasks.length}
                    </p>
                    <p className="mt-1 text-xs text-orange-700">Waiting on other tasks</p>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-medium text-red-700">Overdue</p>
                    <p className="mt-2 text-2xl font-semibold text-red-800">
                      {overdueTasksCount}
                    </p>
                    <p className="mt-1 text-xs text-red-700">Past due date</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs font-medium text-blue-700">Workload</p>
                    <p className="mt-2 text-2xl font-semibold text-blue-800">
                      {workloadCount}
                    </p>
                    <p className="mt-1 text-xs text-blue-700">In Progress + Review</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                  <div className="rounded-lg border border-black/10 bg-black/[0.02] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Attention queue</h3>
                      <span className="text-xs text-black/55">
                        Total time spent {formatHours(totalTimeSpent)}
                      </span>
                    </div>
                    {tasksNeedingAttention.length === 0 ? (
                      <p className="mt-3 text-sm text-black/60">
                        No urgent tasks right now.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {tasksNeedingAttention.map((task) => {
                          const unresolvedDependencies = task.dependencyTaskIds.filter(
                            (dependencyTaskId) => {
                              const dependencyTask = taskById.get(dependencyTaskId);
                              return (
                                dependencyTask !== undefined &&
                                dependencyTask.status !== "Done"
                              );
                            }
                          ).length;

                          return (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => openTaskFromSummary(task)}
                              className="w-full rounded-md border border-black/10 bg-white p-3 text-left hover:bg-black/[0.03]"
                            >
                              <p className="text-sm font-medium">{task.title}</p>
                              <p className="mt-1 text-xs text-black/60">
                                {formatAssigneeDisplay(task.assignee)} · Due {task.dueDate}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${getStatusBadgeClasses(
                                    task.status
                                  )}`}
                                >
                                  {task.status}
                                </span>
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${getPriorityBadgeClasses(
                                    task.priority
                                  )}`}
                                >
                                  {task.priority}
                                </span>
                                {task.blockerReason.trim() ? (
                                  <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                                    Blocked
                                  </span>
                                ) : null}
                                {unresolvedDependencies > 0 ? (
                                  <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                                    {unresolvedDependencies} dependency
                                    {unresolvedDependencies === 1 ? "" : "ies"} open
                                  </span>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-black/10 bg-black/[0.02] p-4">
                    <h3 className="text-sm font-semibold">Flow health</h3>
                    <div className="mt-3 space-y-2">
                      {TASK_STATUS_OPTIONS.map((status) => {
                        const count = tasksByStatus[status].length;
                        const percent =
                          tasks.length === 0 ? 0 : Math.round((count / tasks.length) * 100);
                        const isLargest =
                          bottleneckStatus.count > 0 && status === bottleneckStatus.status;

                        return (
                          <div key={status} className="rounded-md border border-black/10 bg-white p-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span
                                className={isLargest ? "font-semibold text-orange-700" : ""}
                              >
                                {status}
                              </span>
                              <span className="text-black/60">
                                {count} ({percent}%)
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-black/10">
                              <div
                                className={`h-full rounded-full ${
                                  isLargest ? "bg-orange-500" : "bg-black/40"
                                }`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-black/70">
                      {bottleneckStatus.count === 0
                        ? "No current bottleneck."
                        : `Bottleneck: ${bottleneckStatus.status} (${bottleneckStatus.count} tasks).`}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                  <div className="rounded-lg border border-black/10 bg-black/[0.02] p-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <UserRound className="h-4 w-4" />
                      Team capacity and load
                    </h3>
                    {members.length === 0 ? (
                      <p className="mt-3 text-sm text-black/60">
                        No team members added yet.
                      </p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-black/60">
                              <th className="px-2 py-2 font-medium">Member</th>
                              <th className="px-2 py-2 font-medium">Allocated</th>
                              <th className="px-2 py-2 font-medium">Assigned hrs</th>
                              <th className="px-2 py-2 font-medium">Utilization</th>
                              <th className="px-2 py-2 font-medium">Open</th>
                              <th className="px-2 py-2 font-medium">High prio</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamLoadRows.map((row) => {
                              const utilizationPercent =
                                row.allocatedHours > 0
                                  ? Math.round((row.assignedHours / row.allocatedHours) * 100)
                                  : 0;
                              const isOverloaded =
                                row.allocatedHours > 0 && row.assignedHours > row.allocatedHours;

                              return (
                                <tr key={row.id} className="border-t border-black/10">
                                  <td className="px-2 py-2">{row.name}</td>
                                  <td className="px-2 py-2">{`${row.allocatedHours}h`}</td>
                                  <td className="px-2 py-2">{formatHours(row.assignedHours)}</td>
                                  <td className="px-2 py-2">
                                    <span
                                      className={
                                        isOverloaded ? "font-medium text-red-700" : ""
                                      }
                                    >
                                      {utilizationPercent}%
                                    </span>
                                  </td>
                                  <td className="px-2 py-2">{row.assignedCount}</td>
                                  <td className="px-2 py-2">{row.highPriorityAssigned}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t border-black/10 bg-white/70">
                              <td className="px-2 py-2 font-medium">Unassigned</td>
                              <td className="px-2 py-2">0h</td>
                              <td className="px-2 py-2">
                                {formatHours(
                                  tasks
                                    .filter((task) => task.assignee === null)
                                    .reduce((sum, task) => sum + task.hoursAssigned, 0)
                                )}
                              </td>
                              <td className="px-2 py-2">-</td>
                              <td className="px-2 py-2">
                                {taskCountByAssignee.get("Unassigned") ?? 0}
                              </td>
                              <td className="px-2 py-2">
                                {
                                  tasks.filter(
                                    (task) =>
                                      task.assignee === null &&
                                      task.priority === "High" &&
                                      task.status !== "Done"
                                  ).length
                                }
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-black/10 bg-black/[0.02] p-4">
                    <h3 className="text-sm font-semibold">PM signals</h3>
                    <ul className="mt-3 space-y-2 text-sm text-black/75">
                      <li>
                        <span className="font-medium">At risk:</span> {atRiskCount} high-priority
                        task{atRiskCount === 1 ? "" : "s"} open.
                      </li>
                      <li>
                        <span className="font-medium">Blocked:</span> {blockedTasksCount} task
                        {blockedTasksCount === 1 ? "" : "s"} waiting on blockers.
                      </li>
                      <li>
                        <span className="font-medium">Dependencies:</span>{" "}
                        {dependencyBlockedTasks.length} task
                        {dependencyBlockedTasks.length === 1 ? "" : "s"} cannot move yet.
                      </li>
                      <li>
                        <span className="font-medium">This week:</span> {dueThisWeekCount} task
                        {dueThisWeekCount === 1 ? "" : "s"} due.
                      </li>
                      <li>
                        <span className="font-medium">Overdue:</span> {overdueTasksCount} task
                        {overdueTasksCount === 1 ? "" : "s"} need immediate action.
                      </li>
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-black/10 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-black/65">
                  Date
                  <input
                    type="date"
                    value={recurringDate}
                    onChange={(event) => setRecurringDate(event.target.value)}
                    className="ml-2 h-9 rounded-md border border-black/20 px-2 text-sm"
                  />
                </label>

                <input
                  type="text"
                  value={recurringFilters.search}
                  onChange={(event) =>
                    updateRecurringFilters({ search: event.target.value })
                  }
                  placeholder="Search…"
                  aria-label="Recurring search"
                  className="h-9 w-44 rounded-md border border-black/20 px-3 text-sm"
                />

                <select
                  value={recurringFilters.status}
                  onChange={(event) =>
                    updateRecurringFilters({
                      status: event.target.value as TaskStatusFilterValue,
                    })
                  }
                  aria-label="Recurring status"
                  className="h-9 w-32 rounded-md border border-black/20 px-2 text-sm"
                >
                  <option value={ALL_FILTER_VALUE}>Status</option>
                  {TASK_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <select
                  value={recurringFilters.priority}
                  onChange={(event) =>
                    updateRecurringFilters({
                      priority: event.target.value as TaskPriorityFilterValue,
                    })
                  }
                  aria-label="Recurring priority"
                  className="h-9 w-28 rounded-md border border-black/20 px-2 text-sm"
                >
                  <option value={ALL_FILTER_VALUE}>Priority</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>

                <select
                  value={recurringFilters.assignee}
                  onChange={(event) =>
                    updateRecurringFilters({ assignee: event.target.value })
                  }
                  aria-label="Recurring assignee"
                  className="h-9 w-36 rounded-md border border-black/20 px-2 text-sm"
                >
                  <option value={ALL_FILTER_VALUE}>Person</option>
                  <option value={UNASSIGNED_FILTER_VALUE}>Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.name}>
                      {formatMemberName(member)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={clearRecurringFilters}
                  className="ml-auto h-9 rounded-md border border-black/20 px-3 text-sm hover:bg-black/5"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-black/10 p-4">
              {recurringSelectedWeekday === null ? (
                <p className="text-sm text-black/65">Select a valid date.</p>
              ) : recurringTasksForSelectedDate.length === 0 ? (
                <p className="text-sm text-black/65">
                  No recurring tasks for {recurringDate} ({recurringSelectedWeekday}).
                </p>
              ) : (
                <div className="space-y-2">
                  {recurringTasksForSelectedDate.map((task) => (
                    <div
                      key={`recurring-${task.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2"
                    >
                      <div className="min-w-[220px] flex-1">
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-black/60">
                          {formatAssigneeDisplay(task.assignee)} · Weekly allocated{" "}
                          {formatHours(
                            recurringWeeklyAllocatedHoursByTask.get(task.id) ?? 0
                          )}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${getPriorityBadgeClasses(
                              task.priority
                            )}`}
                          >
                            {task.priority}
                          </span>
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${getStatusBadgeClasses(
                              task.status
                            )}`}
                          >
                            {task.status}
                          </span>
                        </div>
                      </div>

                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={task.recurringCompletions[recurringDate] === true}
                          onChange={(event) =>
                            setRecurringCompletionForDate(
                              task.id,
                              recurringDate,
                              event.target.checked
                            )
                          }
                        />
                        Done
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isTeamEditModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={closeTeamEditModal}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveTeamMembers();
            }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-2xl rounded-lg bg-white p-5"
          >
            <h3 className="text-lg font-semibold">Edit team members</h3>
            <div className="mt-4 space-y-3">
              {teamEditRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_160px_auto] gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <select
                      value={row.memberSelection}
                      onChange={(event) =>
                        updateTeamEditRowSelection(row.id, event.target.value)
                      }
                      className={`rounded-md border border-black/20 px-3 py-2 text-sm ${
                        row.memberSelection === EXTERNAL_MEMBER_VALUE
                          ? "w-44 shrink-0"
                          : "w-full"
                      }`}
                    >
                      <option value="">Select internal member</option>
                      {loggedPeople.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                      <option value={EXTERNAL_MEMBER_VALUE}>Add external</option>
                    </select>
                    {row.memberSelection === EXTERNAL_MEMBER_VALUE ? (
                      <input
                        type="text"
                        value={row.externalName}
                        onChange={(event) =>
                          updateTeamEditRowExternalName(row.id, event.target.value)
                        }
                        placeholder="External member name"
                        className="min-w-0 flex-1 rounded-md border border-black/20 px-3 py-2 text-sm"
                      />
                    ) : null}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={row.hoursAllocatedInput}
                    onChange={(event) =>
                      updateTeamEditRowHours(row.id, event.target.value)
                    }
                    placeholder="Hours allocated"
                    className="rounded-md border border-black/20 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeTeamEditRow(row.id)}
                    className="rounded-md border border-black/20 p-2 hover:bg-black/5"
                    title="Remove member"
                    aria-label="Remove member"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addTeamEditRow}
              className="mt-4 rounded-md border border-black/20 px-3 py-2 text-sm hover:bg-black/5"
            >
              + Add member
            </button>
            <p className="mt-2 text-xs text-black/60">
              Pick from logged-in people, or choose external to add someone outside the
              system.
            </p>
            {teamEditError ? (
              <p className="mt-3 text-sm text-red-600">{teamEditError}</p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={closeTeamEditModal}
                className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isCommitLogsModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setIsCommitLogsModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-lg bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
              <h3 className="text-lg font-semibold">Commit Logs</h3>
              <button
                type="button"
                onClick={() => setIsCommitLogsModalOpen(false)}
                className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {projectCommitLogs.length === 0 ? (
                <p className="text-sm text-black/65">
                  No commits yet for this project.
                </p>
              ) : (
                <ul className="space-y-2">
                  {projectCommitLogs.map((logEntry) => (
                    <li
                      key={logEntry.id}
                      className="rounded-md border border-black/10 bg-black/[0.02] px-3 py-2"
                    >
                      <p className="text-sm font-medium">
                        {logEntry.scope === "task"
                          ? `${logEntry.taskTitle ?? "Task"} · ${logEntry.action ?? "updated"}`
                          : `${logEntry.projectName} · ${logEntry.action ?? "updated"}`}
                      </p>
                      <p className="mt-1 text-sm text-black/75">
                        {formatCommitFieldLabel(logEntry.field)}: {logEntry.fromValue} to{" "}
                        {logEntry.toValue}
                      </p>
                      <p className="mt-1 text-xs text-black/60">
                        Changed by {logEntry.changedBy} · {logEntry.changedAtIndia}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {modalTaskId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={closeTaskModal}
        >
          <form
            onSubmit={onSaveModalTask}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white"
          >
            <div className="border-b border-black/10 px-5 py-4">
              <h3 className="text-lg font-semibold">Task Details</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4">
                <label className="text-sm">
                  Task Title
                  <input
                    type="text"
                    value={modalTaskTitle}
                    onChange={(event) => setModalTaskTitle(event.target.value)}
                    className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    required
                  />
                </label>

                <label className="text-sm">
                  Description
                  <textarea
                    value={modalDescription}
                    onChange={(event) => setModalDescription(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    Due Date
                    <input
                      type="date"
                      value={modalDueDate}
                      onChange={(event) => setModalDueDate(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      required
                    />
                  </label>

                  <label className="text-sm">
                    Hours Assigned
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={modalHoursAssigned}
                      onChange={(event) => setModalHoursAssigned(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    />
                  </label>

                  <label className="text-sm">
                    Time Spent (hours)
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={modalTimeSpent}
                      onChange={(event) => setModalTimeSpent(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    />
                  </label>
                </div>

                <label className="text-sm">
                  Blocker (optional)
                  <input
                    type="text"
                    value={modalBlockerReason}
                    onChange={(event) => setModalBlockerReason(event.target.value)}
                    placeholder="What is blocking this task?"
                    className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
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
                    tasks.filter((task) => task.id !== modalTaskId).length === 0 ? (
                      <p className="mt-2 text-xs text-black/55">
                        No other tasks available to link.
                      </p>
                    ) : (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {tasks
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

                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={modalIsRecurringTask}
                    onChange={(event) => setModalIsRecurringTask(event.target.checked)}
                  />
                  Recurring task
                </label>

                {modalIsRecurringTask ? (
                  <div className="rounded-md border border-black/10 p-3">
                    <p className="text-sm font-medium">Recurring days</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {RECURRING_WEEKDAY_OPTIONS.map((day) => {
                        const isSelected = modalRecurringDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleModalRecurringDay(day)}
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
                        value={modalRecurringTimePerOccurrenceHours}
                        onChange={(event) =>
                          setModalRecurringTimePerOccurrenceHours(event.target.value)
                        }
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                      />
                    </label>

                    <div className="mt-3 rounded-md border border-black/10 bg-black/[0.02] p-3">
                      <p className="text-sm font-medium">This week</p>
                      {modalRecurringWeekDates.length === 0 ? (
                        <p className="mt-2 text-xs text-black/55">
                          No selected recurring days this week.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {modalRecurringWeekDates.map((day) => (
                            <label
                              key={`modal-week-${day.date}`}
                              className="flex items-center gap-2 text-sm"
                            >
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
                              <span>
                                {day.weekday} ({day.date})
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-md border border-black/10 p-3">
                  <p className="text-sm font-medium">Subtasks</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={newModalSubtaskTitle}
                      onChange={(event) => setNewModalSubtaskTitle(event.target.value)}
                      placeholder="Subtask title"
                      className="flex-1 rounded-md border border-black/20 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addModalSubtask}
                      className="rounded-md border border-black/20 px-3 py-2 text-sm hover:bg-black/5"
                    >
                      Add
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {modalSubtasks.length === 0 ? (
                      <p className="text-xs text-black/60">No subtasks yet</p>
                    ) : (
                      modalSubtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={subtask.done}
                              onChange={() => toggleModalSubtask(subtask.id)}
                            />
                            {subtask.title}
                          </label>
                          <button
                            type="button"
                            onClick={() => removeModalSubtask(subtask.id)}
                            className="rounded border border-black/20 p-1 hover:bg-black/5"
                            title="Remove subtask"
                            aria-label="Remove subtask"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    Priority
                    <select
                      value={modalPriority}
                      onChange={(event) =>
                        setModalPriority(event.target.value as MarketingTaskPriority)
                      }
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    >
                      {TASK_PRIORITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    Status
                    <select
                      value={modalStatus}
                      onChange={(event) =>
                        setModalStatus(event.target.value as MarketingTaskStatus)
                      }
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    >
                      {TASK_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    Assignee
                    <select
                      value={modalAssignee}
                      onChange={(event) => setModalAssignee(event.target.value)}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2"
                    >
                      <option value={UNASSIGNED_VALUE}>Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.name}>
                          {formatMemberName(member)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-black/10 px-5 py-4">
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={closeTaskModal}
                className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDeleteModalTask}
                title="Delete task"
                aria-label="Delete task"
                className="rounded-md border border-black/20 p-2 hover:bg-black/5"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteConfirmTarget ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={cancelDeleteConfirm}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-base font-medium">
              Are you sure you want to delete this task?
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={cancelDeleteConfirm}
                className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}


