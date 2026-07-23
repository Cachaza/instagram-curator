import { requireAdmin } from "@/lib/session";
import { systemDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  await requireAdmin();
  const checks = await systemDiagnostics();
  const ready = checks.every((check) => check.ok);
  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">DIAGNÓSTICO</p>
        <h1>{ready ? "Todo preparado" : "Quedan ajustes"}</h1>
        <p className="muted">Estado real de las dependencias que necesita el pipeline.</p>
        <div className="diagnostic-list">
          {checks.map((check) => <article key={check.id} className={check.ok ? "check-ok" : "check-failed"}><span>{check.ok ? "✓" : "!"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></article>)}
        </div>
        <div className="button-row"><a className="secondary" href="/setup">Configurar</a><a className="primary" href="/import">Importar reel</a></div>
      </section>
    </main>
  );
}
