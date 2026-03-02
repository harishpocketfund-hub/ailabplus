import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PreferenceData = Record<string, unknown>;

type PreferenceQuery = {
  namespace: string;
  contextId: string | null;
};

type PutPreferenceBody = {
  namespace?: unknown;
  contextId?: unknown;
  data?: unknown;
};

function isObjectRecord(value: unknown): value is PreferenceData {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePreferenceData(value: unknown): PreferenceData {
  if (!isObjectRecord(value)) {
    return {};
  }

  return value;
}

function normalizeContextId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function getQueryFromRequest(request: Request): PreferenceQuery | null {
  const url = new URL(request.url);
  const namespace = (url.searchParams.get("namespace") ?? "").trim();
  if (!namespace) {
    return null;
  }

  return {
    namespace,
    contextId: normalizeContextId(url.searchParams.get("contextId")),
  };
}

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const query = getQueryFromRequest(request);
  if (!query) {
    return NextResponse.json(
      { error: "namespace query parameter is required." },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const baseQuery = supabase
      .from("user_preferences")
      .select("data")
      .eq("user_id", sessionUser.id)
      .eq("namespace", query.namespace)
      .limit(1);
    const { data, error } =
      query.contextId === null
        ? await baseQuery.is("context_id", null).maybeSingle()
        : await baseQuery.eq("context_id", query.contextId).maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to fetch preferences: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: normalizePreferenceData(data?.data) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: PutPreferenceBody;
  try {
    body = (await request.json()) as PutPreferenceBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const namespace = typeof body.namespace === "string" ? body.namespace.trim() : "";
  const contextId = normalizeContextId(body.contextId);
  if (!namespace) {
    return NextResponse.json({ error: "namespace is required." }, { status: 400 });
  }
  if (!isObjectRecord(body.data)) {
    return NextResponse.json(
      { error: "data must be a JSON object." },
      { status: 400 }
    );
  }

  const preferenceData = normalizePreferenceData(body.data);

  try {
    const supabase = createSupabaseAdminClient();
    const existingPreferenceQuery = supabase
      .from("user_preferences")
      .select("id")
      .eq("user_id", sessionUser.id)
      .eq("namespace", namespace)
      .limit(1);
    const { data: existingPreference, error: existingPreferenceError } =
      contextId === null
        ? await existingPreferenceQuery.is("context_id", null).maybeSingle()
        : await existingPreferenceQuery.eq("context_id", contextId).maybeSingle();

    if (existingPreferenceError) {
      return NextResponse.json(
        { error: `Failed to query existing preferences: ${existingPreferenceError.message}` },
        { status: 500 }
      );
    }

    if (existingPreference?.id) {
      const { error: updateError } = await supabase
        .from("user_preferences")
        .update({ data: preferenceData })
        .eq("id", existingPreference.id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to update preferences: ${updateError.message}` },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase.from("user_preferences").insert({
        user_id: sessionUser.id,
        namespace,
        context_id: contextId,
        data: preferenceData,
      });

      if (insertError) {
        return NextResponse.json(
          { error: `Failed to insert preferences: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Supabase error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
