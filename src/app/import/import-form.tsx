"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ImportMessage = {
  text: string;
  publicationId?: string;
};

export function ImportForm({ labels }: { labels: {
  button: string;
  adding: string;
  added: string;
  duplicate: string;
  duplicateProcessed: string;
  viewPublication: string;
} }) {
  const [message, setMessage] = useState<ImportMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/v1/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: data.get("url") }),
    });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) return setMessage({ text: `Error: ${body.error}` });
    if (body.created) {
      setMessage({ text: labels.added });
    } else if (body.status === "analyzed") {
      setMessage({ text: labels.duplicateProcessed, publicationId: body.publication_id });
    } else {
      setMessage({ text: labels.duplicate });
    }
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="import-form">
      <input name="url" type="url" required placeholder="https://www.instagram.com/reel/…" aria-label="Instagram URL" />
      <button className="primary" disabled={loading}>{loading ? labels.adding : labels.button}</button>
      {message && <p className="form-message" role="status" aria-live="polite">
        <span>{message.text}</span>
        {message.publicationId && <Link href={`/publications/${message.publicationId}`}>{labels.viewPublication}</Link>}
      </p>}
    </form>
  );
}
