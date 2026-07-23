import { requireAdmin } from "@/lib/session";
import { appLocale, dictionary } from "@/lib/i18n";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  await requireAdmin();
  const locale = appLocale();
  const t = dictionary(locale);
  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">{t.setup.eyebrow}</p>
        <h1>{t.setup.title}</h1>
        <p className="muted">{t.setup.intro}</p>
        <SetupForm locale={locale} />
        <div className="setup-links">
          <a href="/setup/instagram">{t.setup.configureInstagram}</a>
          <a href="/setup/codex">Configurar Codex</a>
          <a href="/setup/diagnostics">Comprobar instalación</a>
        </div>
      </section>
    </main>
  );
}
