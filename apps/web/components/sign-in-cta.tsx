"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/provider";

/**
 * Signed out: opens sign-in, then goes to the dashboard once it completes.
 * Signed in: links straight to the dashboard.
 */
export function SignInCta({
  size = "default",
  signedOutLabel = "Sign in",
}: {
  size?: "default" | "lg";
  signedOutLabel?: string;
}) {
  const { ready, authenticated, login } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (pending && authenticated) router.push("/dashboard");
  }, [pending, authenticated, router]);

  if (ready && authenticated) {
    return (
      <Button asChild size={size}>
        <Link href="/dashboard">Open dashboard</Link>
      </Button>
    );
  }

  return (
    <Button
      size={size}
      disabled={!ready}
      onClick={() => {
        setPending(true);
        login();
      }}
    >
      {ready ? signedOutLabel : "Loading…"}
    </Button>
  );
}
