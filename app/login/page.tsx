"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { writeDemoUser } from "@/lib/demo-user";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [title, setTitle] = useState("");
  const [reportsTo, setReportsTo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      if (mode === "signup" && password !== confirmPassword) {
        setErrorMessage("Password and confirm password must match.");
        return;
      }

      const response = await fetch(
        mode === "signin" ? "/api/auth/login" : "/api/auth/signup",
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
          title,
          reportsTo,
        }),
      }
      );

      const payload = (await response.json().catch(() => ({}))) as {
        user?: {
          name: string;
          title: string;
          reportsTo: string;
        };
        error?: string;
      };

      if (!response.ok || !payload.user) {
        setErrorMessage(payload.error ?? "Login failed. Please try again.");
        return;
      }

      writeDemoUser({
        name: payload.user.name,
        title: payload.user.title,
        reportsTo: payload.user.reportsTo,
      });

      router.push("/my-work");
      router.refresh();
    } catch {
      setErrorMessage("Unable to reach login service. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-black/10 p-8">
        <h1 className="text-2xl font-semibold">Login</h1>
        <p className="mt-2 text-sm text-black/70">
          {mode === "signin"
            ? "Sign in with your secure account."
            : "Create your account securely."}
        </p>

        <div className="mt-5 inline-flex rounded-md border border-black/15 p-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setErrorMessage("");
            }}
            className={`rounded px-3 py-1.5 font-medium ${
              mode === "signin" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setErrorMessage("");
            }}
            className={`rounded px-3 py-1.5 font-medium ${
              mode === "signup" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          {mode === "signup" ? (
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-black/60">Name</span>
              <input
                type="text"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                placeholder="Your full name"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-black/60">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-black/60">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
              placeholder="Enter password"
            />
          </label>
          {mode === "signup" ? (
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-black/60">
                Confirm Password
              </span>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                placeholder="Re-enter password"
              />
            </label>
          ) : null}
          {mode === "signup" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-black/60">
                  Title (optional)
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                  placeholder="Member"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-black/60">
                  Reports To (optional)
                </span>
                <input
                  type="text"
                  value={reportsTo}
                  onChange={(event) => setReportsTo(event.target.value)}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
                  placeholder="Manager"
                />
              </label>
            </div>
          ) : null}

          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-black px-4 py-2 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? mode === "signin"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        {mode === "signin" ? (
          <div className="mt-5 rounded-md border border-black/10 bg-black/[0.03] p-3 text-xs text-black/65">
            <p className="font-medium text-black/75">Seed accounts</p>
            <p className="mt-1">john@company.local / Password@123</p>
            <p>jane@company.local / Welcome@123</p>
          </div>
        ) : (
          <p className="mt-5 text-xs text-black/60">
            Password needs 8+ chars with uppercase, lowercase, number, and special
            character.
          </p>
        )}
      </div>
    </main>
  );
}
