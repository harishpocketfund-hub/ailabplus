import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type AiContextTaskRow = {
  title: string;
  projectName: string;
  stream: "Marketing" | "Development";
  status: "To Do" | "In Progress" | "Review" | "Done";
  priority: "High" | "Medium" | "Low";
  dueDate: string;
  assignee: string;
  blocked: boolean;
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
    typeof value.title === "string" &&
    typeof value.projectName === "string" &&
    (value.stream === "Marketing" || value.stream === "Development") &&
    (value.status === "To Do" ||
      value.status === "In Progress" ||
      value.status === "Review" ||
      value.status === "Done") &&
    (value.priority === "High" || value.priority === "Medium" || value.priority === "Low") &&
    typeof value.dueDate === "string" &&
    typeof value.assignee === "string" &&
    typeof value.blocked === "boolean"
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
    value.blockedOpen.every(isAiContextTaskRow)
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
    "You are an internal project-operations analyst for a company workspace.",
    "Your job is to analyze project and team data and return concise, structured, executive-grade insights.",
    "",
    "Rules:",
    "1. Use ONLY the provided context data. Do not invent facts.",
    "2. If data is missing, explicitly say \"Data not available\".",
    "3. Keep output highly structured and scannable.",
    "4. Use short bullet points, no paragraphs longer than 2 lines.",
    "5. Prioritize actionability over generic commentary.",
    "6. Highlight risk early.",
    "7. Be numerically explicit whenever possible.",
    "8. If there are zero tasks/projects in scope, return a clear empty-state analysis and next setup actions.",
    "",
    "Required output format (exact section order):",
    "## Scope",
    "- Team member scope: ...",
    "- Project scope: ...",
    "- Projects analyzed: ...",
    "- Tasks analyzed: ...",
    "",
    "## Executive Summary",
    "- 3-5 bullets on current delivery health.",
    "- Include overall trend: stable / improving / degrading (based only on provided counts).",
    "",
    "## Critical Risks",
    "- Bullets sorted by severity.",
    "- Include overdue pressure, high-priority open load, blocked/dependency load.",
    "- Each bullet must include impact + likely consequence.",
    "",
    "## Bottlenecks",
    "- Status-pile insights from To Do / In Progress / Review / Done counts.",
    "- Identify the largest queue and explain what it implies.",
    "",
    "## Team Signals",
    "- Focus on assignee load, ownership gaps, unassigned work, concentration risk.",
    "- Mention specific names only if present in context.",
    "",
    "## Immediate Actions (Next 7 Days)",
    "- Numbered list (max 7 actions).",
    "- Each action must be specific, measurable, and tied to a risk/bottleneck.",
    "- Format: Action | Owner suggestion | Expected impact.",
    "",
    "## Priority Task Watchlist",
    "- Up to 8 tasks.",
    "- For each: Title | Project | Assignee | Status | Priority | Due date | Why it matters now.",
    "",
    "## Questions / Data Gaps",
    "- List missing data that would improve analysis quality.",
    "",
    "Style constraints:",
    "- Professional, direct, non-hype tone.",
    "- No markdown tables.",
    "- No filler text.",
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
    "Generate a single concise portfolio summary in 50 words or less.",
    "Use only provided data.",
    "Mention both Marketing and Development explicitly.",
    "Include one key risk and one immediate focus.",
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
    "Return one concise summary sentence/paragraph only.",
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
      temperature: 0.2,
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
