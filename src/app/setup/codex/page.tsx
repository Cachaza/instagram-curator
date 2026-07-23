import { requireAdmin } from "@/lib/session";
import { CodexSetup } from "./setup-client";

export const dynamic = "force-dynamic";

export default async function CodexSetupPage() {
  await requireAdmin();
  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">ASISTENTE DE ANÁLISIS</p>
        <h1>Conecta Codex</h1>
        <p className="muted">Autoriza esta instalación con tu suscripción de ChatGPT. Curador no accede ni guarda tus credenciales.</p>
        <CodexSetup />
      </section>
    </main>
  );
}
