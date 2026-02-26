export const MARKETING_MEMBERS_STORAGE_KEY = "internal-system-marketing-members";
const MARKETING_MEMBERS_UPDATED_EVENT = "internal-system-marketing-members-updated";

export type MarketingMember = {
  id: string;
  name: string;
  hoursAllocated: number;
};

export type MarketingMembersByProject = Record<string, MarketingMember[]>;

function parseMember(value: unknown, fallbackIndex: number): MarketingMember | null {
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

  const member = value as Partial<MarketingMember>;
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

function parseMembers(value: unknown): MarketingMember[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => parseMember(item, index))
    .filter((item): item is MarketingMember => item !== null);
}

export function parseMarketingMembersByProject(
  rawMembersByProject: string | null
): MarketingMembersByProject {
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

export function getMarketingMembersSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(MARKETING_MEMBERS_STORAGE_KEY);
}

export function getMarketingMembersServerSnapshot(): string | null {
  return null;
}

export function subscribeToMarketingMembers(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(MARKETING_MEMBERS_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(MARKETING_MEMBERS_UPDATED_EVENT, handler);
  };
}

export function writeMarketingMembersByProject(
  membersByProject: MarketingMembersByProject
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    MARKETING_MEMBERS_STORAGE_KEY,
    JSON.stringify(membersByProject)
  );
  window.dispatchEvent(new Event(MARKETING_MEMBERS_UPDATED_EVENT));
}

export function writeMarketingMembersForProject(
  projectId: string,
  members: MarketingMember[]
): void {
  const membersByProject = parseMarketingMembersByProject(
    getMarketingMembersSnapshot()
  );
  membersByProject[projectId] = members;
  writeMarketingMembersByProject(membersByProject);
}

export function createMarketingMemberId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
