"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEMO_USER, readDemoUser, writeDemoUser } from "@/lib/demo-user";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    const user = readDemoUser();
    if (user) {
      router.replace("/profile");
    }
  }, [router]);

  const onContinue = () => {
    writeDemoUser(DEMO_USER);
    router.push("/profile");
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-black/10 p-8">
        <h1 className="text-2xl font-semibold">Login</h1>
        <p className="mt-2 text-sm text-black/70">
          Continue as a demo user.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-6 w-full rounded-md bg-black px-4 py-2 font-medium text-white transition hover:opacity-90"
        >
          Continue
        </button>
      </div>
    </main>
  );
}
