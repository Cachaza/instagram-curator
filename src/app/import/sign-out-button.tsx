"use client";

import { authClient } from "@/lib/auth-client";

export function SignOutButton({ label }: { label: string }) {
  return <button className="text-button compact" onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}>{label}</button>;
}
