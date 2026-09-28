"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/provider";
import { config } from "@/lib/config";

// Temporary scaffold check. Replaced by the landing page in the next step.
export default function Home() {
  const { ready, authenticated, user, login, logout, provider } = useAuth();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Fanout scaffold</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Client</dt>
        <dd>{config.useMock ? "mock" : "onchain"}</dd>
        <dt className="text-muted-foreground">Auth</dt>
        <dd>{provider}</dd>
        <dt className="text-muted-foreground">Signed in</dt>
        <dd>{ready ? (authenticated ? user?.email : "no") : "…"}</dd>
      </dl>
      {ready &&
        (authenticated ? (
          <Button variant="outline" onClick={() => void logout()}>Sign out</Button>
        ) : (
          <Button onClick={login}>Sign in</Button>
        ))}
    </main>
  );
}
