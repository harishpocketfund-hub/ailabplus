"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getMarketingProjectsServerSnapshot,
  getMarketingProjectsSnapshot,
  parseMarketingProjects,
  subscribeToMarketingProjects,
} from "@/lib/marketing-projects";
import {
  getMarketingTasksServerSnapshot,
  getMarketingTasksSnapshot,
  parseMarketingTasksByProject,
  type MarketingTaskStatus,
  subscribeToMarketingTasks,
} from "@/lib/marketing-tasks";
import {
  getDevelopmentProjectsServerSnapshot,
  getDevelopmentProjectsSnapshot,
  parseDevelopmentProjects,
  subscribeToDevelopmentProjects,
} from "@/lib/development-projects";
import {
  getDevelopmentTasksServerSnapshot,
  getDevelopmentTasksSnapshot,
  parseDevelopmentTasksByProject,
  subscribeToDevelopmentTasks,
} from "@/lib/development-tasks";
import { parseDirectTasks, type DirectTask } from "@/lib/direct-tasks";

type TeamUser = {
  id: string;
  name: string;
  title: string;
  email: string;
};

type PersonTask = {
  id: string;
  title: string;
  status: MarketingTaskStatus;
  priority: "High" | "Medium" | "Low";
  dueDate: string;
  projectName: string;
  projectHref: string | null;
};

const normalizeName = (value: string): string => value.trim().toLowerCase();

const getDueDateSortValue = (value: string): string =>
  value.trim() ? value : "9999-12-31";

const sortPersonTasks = (tasks: PersonTask[]): PersonTask[] => {
  return [...tasks].sort((firstTask, secondTask) => {
    const firstDoneRank = firstTask.status === "Done" ? 1 : 0;
    const secondDoneRank = secondTask.status === "Done" ? 1 : 0;
    if (firstDoneRank !== secondDoneRank) {
      return firstDoneRank - secondDoneRank;
    }

    const firstDueDate = getDueDateSortValue(firstTask.dueDate);
    const secondDueDate = getDueDateSortValue(secondTask.dueDate);
    if (firstDueDate !== secondDueDate) {
      return firstDueDate.localeCompare(secondDueDate);
    }

    return firstTask.title.localeCompare(secondTask.title);
  });
};

export default function TeamPage() {
  const rawMarketingProjects = useSyncExternalStore(
    subscribeToMarketingProjects,
    getMarketingProjectsSnapshot,
    getMarketingProjectsServerSnapshot
  );
  const rawMarketingTasksByProject = useSyncExternalStore(
    subscribeToMarketingTasks,
    getMarketingTasksSnapshot,
    getMarketingTasksServerSnapshot
  );
  const rawDevelopmentProjects = useSyncExternalStore(
    subscribeToDevelopmentProjects,
    getDevelopmentProjectsSnapshot,
    getDevelopmentProjectsServerSnapshot
  );
  const rawDevelopmentTasksByProject = useSyncExternalStore(
    subscribeToDevelopmentTasks,
    getDevelopmentTasksSnapshot,
    getDevelopmentTasksServerSnapshot
  );

  const [users, setUsers] = useState<TeamUser[]>([]);
  const [directTasks, setDirectTasks] = useState<DirectTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const marketingProjects = parseMarketingProjects(rawMarketingProjects);
  const marketingTasksByProject = parseMarketingTasksByProject(
    rawMarketingTasksByProject
  );
  const developmentProjects = parseDevelopmentProjects(rawDevelopmentProjects);
  const developmentTasksByProject = parseDevelopmentTasksByProject(
    rawDevelopmentTasksByProject
  );

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
          setUsers(Array.isArray(payload.users) ? payload.users : []);
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

  useEffect(() => {
    let isCancelled = false;

    const loadDirectTasks = async () => {
      try {
        const response = await fetch("/api/direct-tasks", {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => ({}))) as {
          tasks?: unknown;
        };

        if (!response.ok) {
          if (!isCancelled) {
            setDirectTasks([]);
          }
          return;
        }

        if (!isCancelled) {
          setDirectTasks(parseDirectTasks(payload.tasks));
        }
      } catch {
        if (!isCancelled) {
          setDirectTasks([]);
        }
      }
    };

    void loadDirectTasks();

    return () => {
      isCancelled = true;
    };
  }, []);

  const tasksByUserName = useMemo(() => {
    const tasksByAssignee = new Map<string, PersonTask[]>();

    const addTask = (assignee: string | null, task: PersonTask) => {
      if (!assignee || !assignee.trim()) {
        return;
      }

      const key = normalizeName(assignee);
      const existingTasks = tasksByAssignee.get(key);
      if (existingTasks) {
        existingTasks.push(task);
        return;
      }

      tasksByAssignee.set(key, [task]);
    };

    const marketingProjectById = new Map(
      marketingProjects.map((project) => [project.id, project] as const)
    );

    Object.entries(marketingTasksByProject).forEach(([projectId, projectTasks]) => {
      const projectName =
        marketingProjectById.get(projectId)?.name ?? "Marketing Project";

      projectTasks.forEach((task) => {
        addTask(task.assignee, {
          id: `marketing:${projectId}:${task.id}`,
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          projectName,
          projectHref: `/marketing/projects/${projectId}`,
        });
      });
    });

    const developmentProjectById = new Map(
      developmentProjects.map((project) => [project.id, project] as const)
    );

    Object.entries(developmentTasksByProject).forEach(
      ([projectId, projectTasks]) => {
        const projectName =
          developmentProjectById.get(projectId)?.name ?? "Development Project";

        projectTasks.forEach((task) => {
          addTask(task.assignee, {
            id: `development:${projectId}:${task.id}`,
            title: task.title,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            projectName,
            projectHref: `/development/projects/${projectId}`,
          });
        });
      }
    );

    directTasks.forEach((task) => {
      addTask(task.assignee, {
        id: `direct:${task.id}`,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        projectName: "Direct assignment",
        projectHref: null,
      });
    });

    const sortedMap = new Map<string, PersonTask[]>();
    tasksByAssignee.forEach((tasks, key) => {
      sortedMap.set(key, sortPersonTasks(tasks));
    });

    return sortedMap;
  }, [
    developmentProjects,
    developmentTasksByProject,
    directTasks,
    marketingProjects,
    marketingTasksByProject,
  ]);

  return (
    <section className="mx-auto max-w-6xl space-y-4">
      <header className="rounded-xl border border-black/10 bg-white p-4">
        <h1 className="text-2xl font-semibold text-black">Team</h1>
        <p className="mt-1 text-sm text-black/65">
          Name, role, and sign-in email IDs.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <div className="grid grid-cols-[1.1fr_1fr_1.4fr_1fr] gap-3 border-b border-black/10 bg-black/[0.03] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-black/60">
          <span>Name</span>
          <span>Role</span>
          <span>Email</span>
          <span>Tasks</span>
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
            {users.map((user) => {
              const personTasks =
                tasksByUserName.get(normalizeName(user.name)) ?? [];
              const openCount = personTasks.filter(
                (task) => task.status !== "Done"
              ).length;

              return (
                <li
                  key={user.id}
                  className="grid grid-cols-[1.1fr_1fr_1.4fr_1fr] gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-medium text-black">{user.name}</span>
                  <span className="text-black/75">{user.title}</span>
                  <span className="truncate text-black/75">{user.email}</span>

                  <details className="group">
                    <summary className="inline-flex h-8 list-none cursor-pointer items-center rounded-md border border-black/15 bg-white px-2.5 text-xs font-medium text-black/75 hover:bg-black/[0.03]">
                      Open ({openCount}/{personTasks.length})
                    </summary>
                    <div className="mt-2 max-h-52 overflow-auto rounded-md border border-black/10 bg-black/[0.02] p-2">
                      {personTasks.length === 0 ? (
                        <p className="text-xs text-black/60">No tasks assigned.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {personTasks.map((task) => (
                            <li
                              key={task.id}
                              className="rounded border border-black/10 bg-white px-2 py-1.5"
                            >
                              <p className="truncate text-xs font-medium text-black">
                                {task.title}
                              </p>
                              <p className="mt-0.5 text-[11px] text-black/65">
                                {task.projectHref ? (
                                  <Link
                                    href={task.projectHref}
                                    className="text-blue-700 hover:underline"
                                  >
                                    {task.projectName}
                                  </Link>
                                ) : (
                                  task.projectName
                                )} | {task.status} | {task.priority}
                              </p>
                              <p className="mt-0.5 text-[11px] text-black/55">
                                Due: {task.dueDate || "--"}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
