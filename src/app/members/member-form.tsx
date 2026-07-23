"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { messages, type Locale } from "@/lib/messages";

export function MemberForm({ locale }: { locale: Locale }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = messages[locale];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await authClient.admin.createUser({
      name: String(data.get("name")),
      email: String(data.get("email")),
      password: String(data.get("password")),
      role: "user",
    });
    setLoading(false);
    if (result.error) return setMessage(result.error.message ?? t.common.error);
    setMessage(t.members.created);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="stack member-form">
      <div className="two-columns">
        <label>{t.auth.name}<input name="name" required /></label>
        <label>{t.auth.email}<input name="email" type="email" required /></label>
      </div>
      <label>{t.members.temporaryPassword}<input name="password" type="password" minLength={4} required /></label>
      {message && <p className="form-message">{message}</p>}
      <button className="primary" disabled={loading}>{loading ? t.members.creating : t.members.create}</button>
    </form>
  );
}
