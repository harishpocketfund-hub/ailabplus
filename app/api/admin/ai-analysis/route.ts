import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type AiContextTaskRow = {
  id: string;
  title: string;
  description: string;
  projectName: string;
  projectKey: string;
  stream: "Marketing" | "Development";
  status: "To Do" | "In Progress" | "Review" | "Done";
  priority: "High" | "Medium" | "Low";
  dueDate: string;
  assignee: string;
  hoursAssigned: number;
  timeSpent: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  unresolvedDependencies: number;
  daysOverdue: number;
  blocked: boolean;
};

type AiProjectContextRow = {
  projectKey: string;
  projectId: string;
  projectName: string;
  stream: "Marketing" | "Development";
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
  stream: "Marketing" | "Development";
  changedBy: string;
  scope: "project" | "task";
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
  status: "To Do" | "In Progress" | "Review" | "Done";
  priority: "High" | "Medium" | "Low";
  assignee: string;
  assignedBy: string;
  assignedAtIso: string;
  hoursAssigned: number;
  blockerReason: string;
  dependencyTaskIds: string[];
  timeSpent: number;
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

type AiScopeSnapshot = {
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
  statusCounts: {
    "To Do": number;
    "In Progress": number;
    Review: number;
    Done: number;
  };
  topOverdue: AiContextTaskRow[];
  topPriorityOpen: AiContextTaskRow[];
  blockedOpen: AiContextTaskRow[];
  projectsDetailed: AiProjectContextRow[];
  tasksDetailed: AiContextTaskRow[];
  teamLoad: AiTeamLoadRow[];
  commitsRecent: AiCommitRow[];
  directTasks: AiDirectTaskContextRow[];
  myWorkPreferences: AiMyWorkPreferenceRow[];
};

type RequestBody = {
  question?: unknown;
  context?: unknown;
  mode?: unknown;
};

type RequestMode = "structured_analysis" | "compact_summary";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAiContextTaskRow(value: unknown): value is AiContextTaskRow {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.projectName === "string" &&
    typeof value.projectKey === "string" &&
    (value.stream === "Marketing" || value.stream === "Development") &&
    (value.status === "To Do" ||
      value.status === "In Progress" ||
      value.status === "Review" ||
      value.status === "Done") &&
    (value.priority === "High" || value.priority === "Medium" || value.priority === "Low") &&
    typeof value.dueDate === "string" &&
    typeof value.assignee === "string" &&
    typeof value.hoursAssigned === "number" &&
    typeof value.timeSpent === "number" &&
    typeof value.blockerReason === "string" &&
    Array.isArray(value.dependencyTaskIds) &&
    value.dependencyTaskIds.every((id) => typeof id === "string") &&
    typeof value.unresolvedDependencies === "number" &&
    typeof value.daysOverdue === "number" &&
    typeof value.blocked === "boolean"
  );
}

function isAiProjectContextRow(value: unknown): value is AiProjectContextRow {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.projectKey === "string" &&
    typeof value.projectId === "string" &&
    typeof value.projectName === "string" &&
    (value.stream === "Marketing" || value.stream === "Development") &&
    typeof value.deadline === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.isCompleted === "boolean" &&
    Array.isArray(value.members) &&
    value.members.every((member) => typeof member === "string") &&
    typeof value.tasksTotal === "number" &&
    typeof value.openTasks === "number" &&
    typeof value.overdueOpenTasks === "number" &&
    typeof value.highPriorityOpenTasks === "number" &&
    typeof value.blockedOpenTasks === "number" &&
    Array.isArray(value.topTaskTitles) &&
    value.topTaskTitles.every((taskTitle) => typeof taskTitle === "string") &&
    Array.isArray(value.topTaskDescriptions) &&
    value.topTaskDescriptions.every((taskDescription) => typeof taskDescription === "string")
  );
}

function isAiTeamLoadRow(value: unknown): value is AiTeamLoadRow {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.allocatedHours === "number" &&
    typeof value.assignedHours === "number" &&
    typeof value.openTasks === "number" &&
    typeof value.overdueOpenTasks === "number" &&
    typeof value.highPriorityOpenTasks === "number" &&
    typeof value.timeSpent === "number"
  );
}

function isAiCommitRow(value: unknown): value is AiCommitRow {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.projectName === "string" &&
    (value.stream === "Marketing" || value.stream === "Development") &&
    typeof value.changedBy === "string" &&
    (value.scope === "project" || value.scope === "task") &&
    typeof value.action === "string" &&
    typeof value.field === "string" &&
    typeof value.fromValue === "string" &&
    typeof value.toValue === "string" &&
    typeof value.changedAtIndia === "string" &&
    typeof value.changedAtIso === "string"
  );
}

function isAiDirectTaskContextRow(value: unknown): value is AiDirectTaskContextRow {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.dueDate === "string" &&
    (value.status === "To Do" ||
      value.status === "In Progress" ||
      value.status === "Review" ||
      value.status === "Done") &&
    (value.priority === "High" || value.priority === "Medium" || value.priority === "Low") &&
    typeof value.assignee === "string" &&
    typeof value.assignedBy === "string" &&
    typeof value.assignedAtIso === "string" &&
    typeof value.hoursAssigned === "number" &&
    typeof value.blockerReason === "string" &&
    Array.isArray(value.dependencyTaskIds) &&
    value.dependencyTaskIds.every((dependencyId) => typeof dependencyId === "string") &&
    typeof value.timeSpent === "number"
  );
}

function isAiMyWorkPreferenceRow(value: unknown): value is AiMyWorkPreferenceRow {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.userId === "string" &&
    typeof value.userName === "string" &&
    typeof value.activeTab === "string" &&
    typeof value.assignedByMeTab === "string" &&
    Array.isArray(value.focusedTaskKeys) &&
    value.focusedTaskKeys.every((taskKey) => typeof taskKey === "string") &&
    Array.isArray(value.customTodos) &&
    value.customTodos.every(
      (todo) =>
        isObjectRecord(todo) &&
        typeof todo.title === "string" &&
        typeof todo.hours === "number" &&
        typeof todo.done === "boolean"
    ) &&
    typeof value.updatedAtIso === "string"
  );
}

function isAiScopeSnapshot(value: unknown): value is AiScopeSnapshot {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (!isObjectRecord(value.scope) || !isObjectRecord(value.summary) || !isObjectRecord(value.statusCounts)) {
    return false;
  }

  if (
    typeof value.scope.member !== "string" ||
    typeof value.scope.project !== "string" ||
    typeof value.summary.projects !== "number" ||
    typeof value.summary.tasks !== "number" ||
    typeof value.summary.open !== "number" ||
    typeof value.summary.done !== "number" ||
    typeof value.summary.overdue !== "number" ||
    typeof value.summary.dueToday !== "number" ||
    typeof value.summary.dueThisWeek !== "number" ||
    typeof value.summary.highPriorityOpen !== "number" ||
    typeof value.summary.blockedOpen !== "number" ||
    typeof value.statusCounts["To Do"] !== "number" ||
    typeof value.statusCounts["In Progress"] !== "number" ||
    typeof value.statusCounts.Review !== "number" ||
    typeof value.statusCounts.Done !== "number"
  ) {
    return false;
  }

  if (!Array.isArray(value.topOverdue) || !Array.isArray(value.topPriorityOpen) || !Array.isArray(value.blockedOpen)) {
    return false;
  }

  return (
    value.topOverdue.every(isAiContextTaskRow) &&
    value.topPriorityOpen.every(isAiContextTaskRow) &&
    value.blockedOpen.every(isAiContextTaskRow) &&
    Array.isArray(value.projectsDetailed) &&
    value.projectsDetailed.every(isAiProjectContextRow) &&
    Array.isArray(value.tasksDetailed) &&
    value.tasksDetailed.every(isAiContextTaskRow) &&
    Array.isArray(value.teamLoad) &&
    value.teamLoad.every(isAiTeamLoadRow) &&
    Array.isArray(value.commitsRecent) &&
    value.commitsRecent.every(isAiCommitRow) &&
    Array.isArray(value.directTasks) &&
    value.directTasks.every(isAiDirectTaskContextRow) &&
    Array.isArray(value.myWorkPreferences) &&
    value.myWorkPreferences.every(isAiMyWorkPreferenceRow)
  );
}

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

function buildSystemPrompt(): string {
  return [
    "You are an internal project and delivery analyst.",
    "Use ONLY the provided context. Never invent or assume missing details.",
    "",
    "Hard constraints:",
    "1) No hallucinations. If evidence is missing, say \"Not enough evidence\".",
    "2) Do not predict consequences unless directly supported by explicit blockers, dependencies, overdue age, or priority data.",
    "3) Prefer specific task/project names and metrics over generic statements.",
    "4) Keep language clear and executive-friendly.",
    "5) If a section has no evidence, return exactly: \"No evidence-backed points.\"",
    "",
    "Required output format and order:",
    "## Scope",
    "- Team member scope: ...",
    "- Project scope: ...",
    "- Projects analyzed: ...",
    "- Tasks analyzed: ...",
    "",
    "## Executive Summary",
    "### Project Narrative",
    "- For each project in scope (max 8): start bullet with project name and describe current work in fluent English using task titles/descriptions.",
    "- Do not include projects with no tasks unless explicitly relevant.",
    "### Status",
    "- Open tasks, overdue tasks, high-priority open, blocked/dependency open.",
    "- Include overdue age where available (e.g., \"overdue by 3 days\").",
    "- Overall trend: stable / improving / degrading, and WHY using only counts and commit/change signals in context.",
    "",
    "## Critical Risks",
    "- Include ONLY evidence-backed risks.",
    "- Allowed evidence: overdue age, explicit blockerReason text, unresolved dependencies count, high priority + overdue, high load from allocated vs assigned.",
    "- Format: Task or Project | Evidence | Operational impact.",
    "- Do NOT add hypothetical \"likely consequence\" lines.",
    "",
    "## Bottlenecks",
    "- Use status counts and age/overdue distribution.",
    "- Mention largest queue only if it creates measurable delay risk.",
    "- If queue counts are low and healthy, say so briefly.",
    "",
    "## Team Signals",
    "- Use teamLoad evidence (allocatedHours vs assignedHours, overdueOpenTasks, highPriorityOpenTasks).",
    "- Mention concentration or overload ONLY when metrics support it.",
    "- If allocatedHours is missing/zero, avoid burnout claims.",
    "",
    "## Immediate Actions (Next 7 Days)",
    "- Provide 0 to 5 actions.",
    "- Include only evidence-backed actions tied to concrete tasks/projects.",
    "- No generic management advice.",
    "- Format: 1) Action | Owner suggestion | Why now (evidence).",
    "",
    "## Priority Task Watchlist",
    "- Include only tasks with strong evidence (overdue, blocked, unresolved dependencies, high priority near due date).",
    "- Up to 8 tasks; if none, return \"No evidence-backed points.\"",
    "- Format: Title | Project | Assignee | Status | Priority | Due date | Evidence.",
    "",
    "Style constraints:",
    "- Professional, direct, non-hype tone.",
    "- No markdown tables.",
    "- No filler text.",
    "- No speculative language.",
  ].join("\n");
}

function buildUserPrompt(question: string, context: AiScopeSnapshot): string {
  const contextJson = JSON.stringify(context, null, 2);
  return [
    "Question from user:",
    question,
    "",
    "Context JSON:",
    contextJson,
    "",
    "Now generate the analysis using the required output format.",
  ].join("\n");
}

function buildCompactSummarySystemPrompt(): string {
  return [
    "You are an internal operations analyst.",
    "Generate exactly one concise portfolio summary in 60 to 90 words.",
    "Use ONLY provided evidence from context JSON.",
    "Mention both Marketing and Development explicitly.",
    "Do not hallucinate, speculate, or infer unsupported consequences.",
    "Do not invent risk if there is no explicit evidence (overdue, blockerReason, unresolved dependency, high-priority open, or measurable load mismatch).",
    "Include one evidence-backed risk and one immediate focus based on explicit metrics.",
    "Use fluent executive English.",
    "No headings. No markdown. No bullet list.",
  ].join("\n");
}

function buildCompactSummaryUserPrompt(question: string, context: AiScopeSnapshot): string {
  const contextJson = JSON.stringify(context, null, 2);
  return [
    "Question:",
    question,
    "",
    "Context JSON:",
    contextJson,
    "",
    "Return one concise paragraph only, 60 to 90 words, evidence-backed.",
  ].join("\n");
}

function normalizeRequestMode(value: unknown): RequestMode {
  return value === "compact_summary" ? "compact_summary" : "structured_analysis";
}

function extractAssistantText(payload: unknown): string {
  if (!isObjectRecord(payload)) {
    return "";
  }

  const choicesValue = payload.choices;
  if (!Array.isArray(choicesValue) || choicesValue.length === 0 || !isObjectRecord(choicesValue[0])) {
    return "";
  }

  const firstChoice = choicesValue[0];
  if (!isObjectRecord(firstChoice.message)) {
    return "";
  }

  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = content
    .map((part) => {
      if (!isObjectRecord(part)) {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter((part) => part.length > 0);

  return textParts.join("\n").trim();
}

async function requestOpenAiAnswer(
  question: string,
  context: AiScopeSnapshot,
  mode: RequestMode
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.05,
      messages: [
        {
          role: "system",
          content:
            mode === "compact_summary"
              ? buildCompactSummarySystemPrompt()
              : buildSystemPrompt(),
        },
        {
          role: "user",
          content:
            mode === "compact_summary"
              ? buildCompactSummaryUserPrompt(question, context)
              : buildUserPrompt(question, context),
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const openAiError = isObjectRecord(payload.error) ? payload.error : null;
    const message =
      openAiError && typeof openAiError.message === "string"
        ? openAiError.message
        : "OpenAI API request failed.";
    throw new Error(message);
  }

  const text = extractAssistantText(payload);
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text;
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "question is required." }, { status: 400 });
  }

  if (!isAiScopeSnapshot(body.context)) {
    return NextResponse.json({ error: "Invalid context payload." }, { status: 400 });
  }

  try {
    const mode = normalizeRequestMode(body.mode);
    const answer = await requestOpenAiAnswer(question, body.context, mode);
    return NextResponse.json({ answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected AI service error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
