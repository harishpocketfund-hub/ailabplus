import {
  EMPTY_WORKSTREAM_STATE,
  hasWorkstreamStateData,
  normalizeWorkstreamState,
  type WorkstreamStatePayload,
  type WorkstreamType,
  WORKSTREAM_TYPES,
} from "@/lib/supabase/workstream-state-shared";

type WorkstreamStorageConfig = {
  projectsKey: string;
  projectsEvent: string;
  tagsKey: string;
  tagsEvent: string;
  tasksByProjectKey: string;
  tasksByProjectEvent: string;
  membersByProjectKey: string;
  membersByProjectEvent: string;
  commitLogsKey: string;
  commitLogsEvent: string;
};

const WORKSTREAM_STORAGE_CONFIG: Record<WorkstreamType, WorkstreamStorageConfig> = {
  marketing: {
    projectsKey: "internal-system-marketing-projects",
    projectsEvent: "internal-system-marketing-projects-updated",
    tagsKey: "internal-system-marketing-tags",
    tagsEvent: "internal-system-marketing-tags-updated",
    tasksByProjectKey: "internal-system-marketing-tasks",
    tasksByProjectEvent: "internal-system-marketing-tasks-updated",
    membersByProjectKey: "internal-system-marketing-members",
    membersByProjectEvent: "internal-system-marketing-members-updated",
    commitLogsKey: "internal-system-marketing-project-commits",
    commitLogsEvent: "internal-system-marketing-project-commits-updated",
  },
  development: {
    projectsKey: "internal-system-development-projects",
    projectsEvent: "internal-system-development-projects-updated",
    tagsKey: "internal-system-development-tags",
    tagsEvent: "internal-system-development-tags-updated",
    tasksByProjectKey: "internal-system-development-tasks",
    tasksByProjectEvent: "internal-system-development-tasks-updated",
    membersByProjectKey: "internal-system-development-members",
    membersByProjectEvent: "internal-system-development-members-updated",
    commitLogsKey: "internal-system-development-project-commits",
    commitLogsEvent: "internal-system-development-project-commits-updated",
  },
};

const pendingSyncTimers = new Map<WorkstreamType, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 400;

function parseJsonValue(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readWorkstreamStateFromLocal(workstream: WorkstreamType): WorkstreamStatePayload {
  const config = WORKSTREAM_STORAGE_CONFIG[workstream];
  const rawPayload = {
    projects: parseJsonValue(window.localStorage.getItem(config.projectsKey)),
    tags: parseJsonValue(window.localStorage.getItem(config.tagsKey)),
    tasksByProject: parseJsonValue(
      window.localStorage.getItem(config.tasksByProjectKey)
    ),
    membersByProject: parseJsonValue(
      window.localStorage.getItem(config.membersByProjectKey)
    ),
    commitLogs: parseJsonValue(window.localStorage.getItem(config.commitLogsKey)),
  };

  return normalizeWorkstreamState(rawPayload);
}

function writeWorkstreamStateToLocal(
  workstream: WorkstreamType,
  state: WorkstreamStatePayload
): void {
  const config = WORKSTREAM_STORAGE_CONFIG[workstream];

  window.localStorage.setItem(config.projectsKey, JSON.stringify(state.projects));
  window.localStorage.setItem(config.tagsKey, JSON.stringify(state.tags));
  window.localStorage.setItem(
    config.tasksByProjectKey,
    JSON.stringify(state.tasksByProject)
  );
  window.localStorage.setItem(
    config.membersByProjectKey,
    JSON.stringify(state.membersByProject)
  );
  window.localStorage.setItem(config.commitLogsKey, JSON.stringify(state.commitLogs));

  window.dispatchEvent(new Event(config.projectsEvent));
  window.dispatchEvent(new Event(config.tagsEvent));
  window.dispatchEvent(new Event(config.tasksByProjectEvent));
  window.dispatchEvent(new Event(config.membersByProjectEvent));
  window.dispatchEvent(new Event(config.commitLogsEvent));
}

async function pushWorkstreamStateToSupabase(
  workstream: WorkstreamType,
  state: WorkstreamStatePayload
): Promise<void> {
  await fetch(`/api/supabase/state?workstream=${workstream}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(state),
    credentials: "include",
  });
}

export function scheduleWorkstreamStateSync(workstream: WorkstreamType): void {
  if (typeof window === "undefined") {
    return;
  }

  const pendingTimer = pendingSyncTimers.get(workstream);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }

  const timer = setTimeout(() => {
    pendingSyncTimers.delete(workstream);
    const localState = readWorkstreamStateFromLocal(workstream);
    void pushWorkstreamStateToSupabase(workstream, localState).catch(() => {
      // Keep local writes resilient if Supabase is temporarily unreachable.
    });
  }, SYNC_DEBOUNCE_MS);

  pendingSyncTimers.set(workstream, timer);
}

export async function hydrateWorkstreamStateFromSupabase(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  await Promise.all(
    WORKSTREAM_TYPES.map(async (workstream) => {
      const localState = readWorkstreamStateFromLocal(workstream);

      try {
        const response = await fetch(`/api/supabase/state?workstream=${workstream}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });

        if (!response.ok) {
          if (hasWorkstreamStateData(localState)) {
            await pushWorkstreamStateToSupabase(workstream, localState);
          }
          return;
        }

        const payload = (await response.json()) as {
          state?: unknown;
        };
        const remoteState = normalizeWorkstreamState(payload.state);

        if (hasWorkstreamStateData(remoteState)) {
          writeWorkstreamStateToLocal(workstream, remoteState);
          return;
        }

        if (hasWorkstreamStateData(localState)) {
          await pushWorkstreamStateToSupabase(workstream, localState);
        } else {
          writeWorkstreamStateToLocal(workstream, EMPTY_WORKSTREAM_STATE);
        }
      } catch {
        if (hasWorkstreamStateData(localState)) {
          await pushWorkstreamStateToSupabase(workstream, localState).catch(() => {
            // Keep local writes resilient if Supabase is temporarily unreachable.
          });
        }
      }
    })
  );
}
