export const DEVELOPMENT_MEMBERS_STORAGE_KEY = "internal-system-development-members";
const DEVELOPMENT_MEMBERS_UPDATED_EVENT = "internal-system-development-members-updated";

export type DevelopmentMember = {
  id: string;
  name: string;
  hoursAllocated: number;
};

export type DevelopmentMembersByProject = Record<string, DevelopmentMember[]>;

function parseMember(value: unknown, fallbackIndex: number): DevelopmentMember | null {
  if (typeof value === "string") {
    const trimmedName = value.trim();
    if (!trimmedName) {
      return null;
    }
    return {
      id: `legacy-${fallbackIndex}`,
      name: trimmedName,
      hoursAllocated: 0,
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const member = value as Partial<DevelopmentMember>;
  if (typeof member.name !== "string" || !member.name.trim()) {
    return null;
  }

  const id =
    typeof member.id === "string" && member.id.trim()
      ? member.id
      : `generated-${fallbackIndex}`;
  const hoursAllocated =
    typeof member.hoursAllocated === "number" &&
    Number.isFinite(member.hoursAllocated) &&
    member.hoursAllocated >= 0
      ? member.hoursAllocated
      : 0;

  return {
    id,
    name: member.name.trim(),
    hoursAllocated,
  };
}

function parseMembers(value: unknown): DevelopmentMember[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => parseMember(item, index))
    .filter((item): item is DevelopmentMember => item !== null);
}

export function parseDevelopmentMembersByProject(
  rawMembersByProject: string | null
): DevelopmentMembersByProject {
  if (!rawMembersByProject) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawMembersByProject) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>).map(
      ([projectId, members]) => [projectId, parseMembers(members)] as const
    );

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function getDevelopmentMembersSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEVELOPMENT_MEMBERS_STORAGE_KEY);
}

export function getDevelopmentMembersServerSnapshot(): string | null {
  return null;
}

export function subscribeToDevelopmentMembers(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DEVELOPMENT_MEMBERS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEVELOPMENT_MEMBERS_UPDATED_EVENT, handler);
  };
}

export function writeDevelopmentMembersByProject(
  membersByProject: DevelopmentMembersByProject
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    DEVELOPMENT_MEMBERS_STORAGE_KEY,
    JSON.stringify(membersByProject)
  );
  window.dispatchEvent(new Event(DEVELOPMENT_MEMBERS_UPDATED_EVENT));
}

export function writeDevelopmentMembersForProject(
  projectId: string,
  members: DevelopmentMember[]
): void {
  const membersByProject = parseDevelopmentMembersByProject(
    getDevelopmentMembersSnapshot()
  );
  membersByProject[projectId] = members;
  writeDevelopmentMembersByProject(membersByProject);
}

export function createDevelopmentMemberId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
