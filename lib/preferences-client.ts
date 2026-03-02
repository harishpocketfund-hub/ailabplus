"use client";

type PreferencePayload = Record<string, unknown>;

function buildPreferenceUrl(namespace: string, contextId?: string): string {
  const url = new URL("/api/preferences", window.location.origin);
  url.searchParams.set("namespace", namespace);
  if (contextId && contextId.trim().length > 0) {
    url.searchParams.set("contextId", contextId);
  }
  return url.pathname + url.search;
}

export async function fetchUserPreference(
  namespace: string,
  contextId?: string
): Promise<PreferencePayload | null> {
  try {
    const response = await fetch(buildPreferenceUrl(namespace, contextId), {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { data?: unknown };
    if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      return {};
    }

    return payload.data as PreferencePayload;
  } catch {
    return null;
  }
}

export async function saveUserPreference(
  namespace: string,
  data: PreferencePayload,
  contextId?: string
): Promise<boolean> {
  try {
    const response = await fetch("/api/preferences", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        namespace,
        contextId: contextId ?? null,
        data,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
