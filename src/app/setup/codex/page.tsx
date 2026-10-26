import { requireAdmin } from "@/lib/session";
import { CodexSetup } from "./setup-client";
import { appLocale, dictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function CodexSetupPage() {
  await requireAdmin();
  const locale = await appLocale();
  const t = await dictionary(locale);
  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">{t.codex.assistant}</p>
        <h1>{t.diagnostics.codex}</h1>
        <p className="muted">{t.codex.intro}</p>
        <CodexSetup locale={locale} webOnly={process.env.CURATOR_WEB_ONLY === "1"} />
      </section>
    </main>
  );
}
