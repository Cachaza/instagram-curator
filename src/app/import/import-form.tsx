"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
export function ImportForm({ labels }: { labels: {
  button: string; adding: string; added: string; duplicate: string;
} }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/v1/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: data.get("url") }),
    });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) return setMessage(`Error: ${body.error}`);
    setMessage(body.created ? labels.added : labels.duplicate);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="import-form">
      <input name="url" type="url" required placeholder="https://www.instagram.com/reel/…" aria-label="Instagram URL" />
      <button className="primary" disabled={loading}>{loading ? labels.adding : labels.button}</button>
      {message && <p className="form-message">{message}</p>}
    </form>
  );
}
