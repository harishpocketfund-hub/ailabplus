"use client";

import { useEffect, useState } from "react";

type TeamUser = {
  id: string;
  name: string;
  title: string;
  email: string;
};

export default function TeamPage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isCancelled = false;

    const loadUsers = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch("/api/auth/people", {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => ({}))) as {
          users?: TeamUser[];
          error?: string;
        };

        if (!response.ok) {
          if (!isCancelled) {
            setErrorMessage(payload.error ?? "Unable to load team members.");
            setUsers([]);
          }
          return;
        }

        if (!isCancelled) {
          const nextUsers = Array.isArray(payload.users) ? payload.users : [];
          setUsers(nextUsers);
        }
      } catch {
        if (!isCancelled) {
          setErrorMessage("Unable to load team members.");
          setUsers([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <header className="rounded-xl border border-black/10 bg-white p-4">
        <h1 className="text-2xl font-semibold text-black">Team</h1>
        <p className="mt-1 text-sm text-black/65">
          Name, role, and sign-in email IDs.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <div className="grid grid-cols-[1.2fr_1fr_1.4fr] gap-3 border-b border-black/10 bg-black/[0.03] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-black/60">
          <span>Name</span>
          <span>Role</span>
          <span>Email</span>
        </div>

        {isLoading ? (
          <p className="px-4 py-4 text-sm text-black/60">Loading team members...</p>
        ) : null}

        {!isLoading && errorMessage ? (
          <p className="px-4 py-4 text-sm text-red-700">{errorMessage}</p>
        ) : null}

        {!isLoading && !errorMessage && users.length === 0 ? (
          <p className="px-4 py-4 text-sm text-black/60">
            No signed-in team members yet.
          </p>
        ) : null}

        {!isLoading && !errorMessage && users.length > 0 ? (
          <ul className="divide-y divide-black/10">
            {users.map((user) => (
              <li
                key={user.id}
                className="grid grid-cols-[1.2fr_1fr_1.4fr] gap-3 px-4 py-3 text-sm"
              >
                <span className="font-medium text-black">{user.name}</span>
                <span className="text-black/75">{user.title}</span>
                <span className="truncate text-black/75">{user.email}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
