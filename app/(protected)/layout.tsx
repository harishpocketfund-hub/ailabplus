"use client";

import Link from "next/link";
import {
  Code2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeft,
  Shield,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearDemoUser,
  getDemoUserServerSnapshot,
  getDemoUserSnapshot,
  parseDemoUser,
  subscribeToDemoUser,
  writeDemoUser,
} from "@/lib/demo-user";
import { hydrateWorkstreamStateFromSupabase } from "@/lib/supabase/workstream-state-client";
import { fetchUserPreference, saveUserPreference } from "@/lib/preferences-client";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "internal-system-sidebar-collapsed";
const SIDEBAR_COLLAPSED_UPDATED_EVENT = "internal-system-sidebar-collapsed-updated";
const SIDEBAR_PREFERENCES_NAMESPACE = "app-shell";
const SIDEBAR_PREFERENCES_CONTEXT_ID = "sidebar";

const getSidebarCollapsedSnapshot = (): string => {
  if (typeof window === "undefined") {
    return "false";
  }

  return (
    window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) ?? "false"
  );
};

const getSidebarCollapsedServerSnapshot = (): string => "false";

const subscribeToSidebarCollapsed = (
  onStoreChange: () => void
): (() => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(SIDEBAR_COLLAPSED_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SIDEBAR_COLLAPSED_UPDATED_EVENT, handler);
  };
};

const sidebarLinks = [
  { href: "/my-work", label: "My Work", icon: LayoutDashboard },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/development", label: "Development", icon: Code2 },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
];

export default function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const rawUser = useSyncExternalStore(
    subscribeToDemoUser,
    getDemoUserSnapshot,
    getDemoUserServerSnapshot
  );
  const sidebarCollapsedRaw = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot
  );
  const isSidebarCollapsed = sidebarCollapsedRaw === "true";
  const user = parseDemoUser(rawUser);
  const userName = user?.name ?? "";
  const isAdmin = user?.role === "admin";
  const hasHydratedWorkstreamStateRef = useRef(false);
  const [loadedSidebarPreferenceForUser, setLoadedSidebarPreferenceForUser] =
    useState("");

  useEffect(() => {
    if (user) {
      return;
    }

    let isCancelled = false;

    const hydrateFromSession = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          if (!isCancelled) {
            clearDemoUser();
            router.replace("/login");
          }
          return;
        }

        const payload = (await response.json()) as {
          user?: {
            id: string;
            name: string;
            title: string;
            reportsTo: string;
            role: "admin" | "member";
          };
        };

        if (!isCancelled && payload.user) {
          writeDemoUser(payload.user);
        }
      } catch {
        if (!isCancelled) {
          clearDemoUser();
          router.replace("/login");
        }
      }
    };

    void hydrateFromSession();

    return () => {
      isCancelled = true;
    };
  }, [router, user]);

  useEffect(() => {
    if (!user || hasHydratedWorkstreamStateRef.current) {
      return;
    }

    hasHydratedWorkstreamStateRef.current = true;
    void hydrateWorkstreamStateFromSupabase();
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (
      user.role !== "admin" &&
      (pathname === "/admin" ||
        pathname.startsWith("/admin/") ||
        pathname === "/team" ||
        pathname.startsWith("/team/"))
    ) {
      router.replace("/my-work");
    }
  }, [pathname, router, user]);

  useEffect(() => {
    if (!userName || typeof window === "undefined") {
      return;
    }

    let isMounted = true;

    const loadSidebarPreference = async () => {
      const preference = await fetchUserPreference(
        SIDEBAR_PREFERENCES_NAMESPACE,
        SIDEBAR_PREFERENCES_CONTEXT_ID
      );

      if (!isMounted) {
        return;
      }

      if (preference && typeof preference.collapsed === "boolean") {
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_STORAGE_KEY,
          String(preference.collapsed)
        );
        window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_UPDATED_EVENT));
      }

      setLoadedSidebarPreferenceForUser(userName);
    };

    void loadSidebarPreference();

    return () => {
      isMounted = false;
    };
  }, [userName]);

  useEffect(() => {
    if (
      !userName ||
      loadedSidebarPreferenceForUser !== userName ||
      typeof window === "undefined"
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveUserPreference(
        SIDEBAR_PREFERENCES_NAMESPACE,
        { collapsed: isSidebarCollapsed },
        SIDEBAR_PREFERENCES_CONTEXT_ID
      );
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSidebarCollapsed, loadedSidebarPreferenceForUser, userName]);

  const onLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } catch {
      // Swallow network errors and still clear local state.
    }

    clearDemoUser();
    router.replace("/login");
    router.refresh();
  };

  const toggleSidebar = () => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(!isSidebarCollapsed)
    );
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_UPDATED_EVENT));
  };

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-black/70">Loading...</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={`border-r border-black/10 p-3 transition-[width] duration-200 ${
          isSidebarCollapsed ? "w-16" : "w-64"
        }`}
      >
        <div className="mb-3 flex items-center">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-md border border-black/20 p-2 hover:bg-black/5"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
        <div className={`mb-3 ${isSidebarCollapsed ? "flex justify-center" : ""}`}>
          {isSidebarCollapsed ? (
            <div
              title={user.name}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-black/20 bg-black/5 text-xs font-semibold text-black/70"
            >
              {user.name
                .split(" ")
                .map((part) => part.charAt(0).toUpperCase())
                .slice(0, 2)
                .join("")}
            </div>
          ) : (
            <div className="w-full rounded-md border border-black/10 bg-black/[0.02] px-3 py-2">
              <p className="truncate text-sm font-semibold text-black/85">{user.name}</p>
              <p className="truncate text-xs text-black/60">{user.title}</p>
            </div>
          )}
        </div>
        <nav className="flex flex-col gap-2">
          {sidebarLinks
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={isSidebarCollapsed ? item.label : undefined}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  isSidebarCollapsed ? "justify-center px-2" : ""
                } ${
                  isActive ? "bg-black text-white" : "hover:bg-black/5"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {isSidebarCollapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  item.label
                )}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => {
            void onLogout();
          }}
          title={isSidebarCollapsed ? "Logout" : undefined}
          className={`mt-6 rounded-md border border-black/20 px-3 py-2 text-sm font-medium hover:bg-black/5 ${
            isSidebarCollapsed
              ? "flex w-full justify-center p-2"
              : "flex w-full items-center gap-2"
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {isSidebarCollapsed ? <span className="sr-only">Logout</span> : "Logout"}
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
