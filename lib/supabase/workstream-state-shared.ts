export const WORKSTREAM_TYPES = ["marketing", "development"] as const;

export type WorkstreamType = (typeof WORKSTREAM_TYPES)[number];

export type WorkstreamStatePayload = {
  projects: unknown[];
  tags: string[];
  tasksByProject: Record<string, unknown>;
  membersByProject: Record<string, unknown>;
  commitLogs: unknown[];
};

export const EMPTY_WORKSTREAM_STATE: WorkstreamStatePayload = {
  projects: [],
  tags: [],
  tasksByProject: {},
  membersByProject: {},
  commitLogs: [],
};

export function isWorkstreamType(value: unknown): value is WorkstreamType {
  return WORKSTREAM_TYPES.includes(value as WorkstreamType);
}

export function normalizeWorkstreamState(value: unknown): WorkstreamStatePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_WORKSTREAM_STATE };
  }

  const payload = value as Partial<WorkstreamStatePayload>;
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const tasksByProject =
    payload.tasksByProject &&
    typeof payload.tasksByProject === "object" &&
    !Array.isArray(payload.tasksByProject)
      ? (payload.tasksByProject as Record<string, unknown>)
      : {};
  const membersByProject =
    payload.membersByProject &&
    typeof payload.membersByProject === "object" &&
    !Array.isArray(payload.membersByProject)
      ? (payload.membersByProject as Record<string, unknown>)
      : {};
  const commitLogs = Array.isArray(payload.commitLogs) ? payload.commitLogs : [];

  return {
    projects,
    tags,
    tasksByProject,
    membersByProject,
    commitLogs,
  };
}

export function hasWorkstreamStateData(state: WorkstreamStatePayload): boolean {
  return (
    state.projects.length > 0 ||
    state.tags.length > 0 ||
    Object.keys(state.tasksByProject).length > 0 ||
    Object.keys(state.membersByProject).length > 0 ||
    state.commitLogs.length > 0
  );
}
