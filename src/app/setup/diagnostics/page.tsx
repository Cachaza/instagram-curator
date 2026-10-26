import { requireAdmin } from "@/lib/session";
import { systemDiagnostics } from "@/lib/diagnostics";
import { Check, Info, TriangleAlert } from "lucide-react";
import { dictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  await requireAdmin();
  const checks = await systemDiagnostics();
  const ready = checks.every((check) => check.ok || check.external);
  const t = await dictionary();
  const webOnly = process.env.CURATOR_WEB_ONLY === "1";
  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">{t.diagnostics.title}</p>
        <h1>{ready ? t.diagnostics.ready : t.diagnostics.pending}</h1>
        <p className="muted">{t.diagnostics.intro}</p>
        {webOnly && <p className="runtime-notice">{t.runtime.webOnly}</p>}
        <div className="diagnostic-list">
          {checks.map((check) => <article key={check.id} className={check.external ? "check-external" : check.ok ? "check-ok" : "check-failed"}><span>{check.external ? <Info aria-hidden="true" /> : check.ok ? <Check aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></article>)}
        </div>
        <div className="button-row"><a className="secondary" href="/setup">{t.diagnostics.configure}</a><a className="primary" href="/import">{t.diagnostics.import}</a></div>
      </section>
    </main>
  );
}
