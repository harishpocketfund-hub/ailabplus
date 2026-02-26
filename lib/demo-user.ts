export type DemoUser = {
  name: string;
  title: string;
  reportsTo: string;
};

export const DEMO_USER_STORAGE_KEY = "internal-system-demo-user";
const DEMO_USER_UPDATED_EVENT = "internal-system-demo-user-updated";

export const DEMO_USER: DemoUser = {
  name: "John Doe",
  title: "Marketing Member",
  reportsTo: "Jane Manager",
};

export function parseDemoUser(rawUser: string | null): DemoUser | null {
  if (!rawUser) {
    return null;
  }

  try {
    const parsedUser = JSON.parse(rawUser) as Partial<DemoUser>;
    if (
      typeof parsedUser.name === "string" &&
      typeof parsedUser.title === "string" &&
      typeof parsedUser.reportsTo === "string"
    ) {
      return {
        name: parsedUser.name,
        title: parsedUser.title,
        reportsTo: parsedUser.reportsTo,
      };
    }
  } catch {
    // Ignore malformed storage values.
  }

  return null;
}

export function getDemoUserSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEMO_USER_STORAGE_KEY);
}

export function readDemoUser(): DemoUser | null {
  const rawUser = getDemoUserSnapshot();
  const user = parseDemoUser(rawUser);

  if (!user && rawUser && typeof window !== "undefined") {
    window.localStorage.removeItem(DEMO_USER_STORAGE_KEY);
  }

  return user;
}

export function writeDemoUser(user: DemoUser): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DEMO_USER_STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(DEMO_USER_UPDATED_EVENT));
}

export function clearDemoUser(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(DEMO_USER_STORAGE_KEY);
  window.dispatchEvent(new Event(DEMO_USER_UPDATED_EVENT));
}

export function subscribeToDemoUser(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();

  window.addEventListener("storage", handler);
  window.addEventListener(DEMO_USER_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEMO_USER_UPDATED_EVENT, handler);
  };
}

export function getDemoUserServerSnapshot(): string | null {
  return null;
}
