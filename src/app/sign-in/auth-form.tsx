"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { messages, type Locale } from "@/lib/messages";

export function AuthForm({ initialMode, locale }: { initialMode: "sign-in" | "sign-up"; locale: Locale }) {
  const mode = initialMode;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = messages[locale];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    const name = String(data.get("name") || email.split("@")[0]);

    const result = mode === "sign-up"
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });
    setLoading(false);
    if (result.error) return setError(result.error.message ?? t.common.error);
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="stack">
      {mode === "sign-up" && (
        <label>{t.auth.name}<input name="name" autoComplete="name" required /></label>
      )}
      <label>{t.auth.email}<input name="email" type="email" autoComplete="email" required /></label>
      <label>{t.auth.password}<input name="password" type="password" minLength={4} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} required /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={loading}>{loading ? t.common.loading : mode === "sign-up" ? t.auth.createAccount : t.auth.signIn}</button>
    </form>
  );
}
