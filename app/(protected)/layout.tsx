"use client";

import Link from "next/link";
import {
  Code2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeft,
  UserRound,
} from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearDemoUser,
  getDemoUserServerSnapshot,
  getDemoUserSnapshot,
  parseDemoUser,
  subscribeToDemoUser,
} from "@/lib/demo-user";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "internal-system-sidebar-collapsed";
const SIDEBAR_COLLAPSED_UPDATED_EVENT = "internal-system-sidebar-collapsed-updated";

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
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/my-work", label: "My Work", icon: LayoutDashboard },
  { href: "/development", label: "Development", icon: Code2 },
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

  useEffect(() => {
    if (!user) {
      router.replace("/login");
    }
  }, [router, user]);

  const onLogout = () => {
    clearDemoUser();
    router.replace("/login");
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
        <nav className="flex flex-col gap-2">
          {sidebarLinks.map((item) => {
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
          onClick={onLogout}
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
