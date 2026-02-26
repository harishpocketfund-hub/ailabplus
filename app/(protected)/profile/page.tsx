"use client";

import { useSyncExternalStore } from "react";
import {
  getDemoUserServerSnapshot,
  getDemoUserSnapshot,
  parseDemoUser,
  subscribeToDemoUser,
} from "@/lib/demo-user";

export default function ProfilePage() {
  const rawUser = useSyncExternalStore(
    subscribeToDemoUser,
    getDemoUserSnapshot,
    getDemoUserServerSnapshot
  );
  const user = parseDemoUser(rawUser);

  if (!user) {
    return <p className="text-sm text-black/70">Loading profile...</p>;
  }

  return (
    <section className="w-full max-w-xl rounded-lg border border-black/10 p-6">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="mt-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-black/60">Name</p>
          <p className="mt-1 text-base">{user.name}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-black/60">Title</p>
          <p className="mt-1 text-base">{user.title}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-black/60">
            Reports To
          </p>
          <p className="mt-1 text-base">{user.reportsTo}</p>
        </div>
      </div>
    </section>
  );
}
