import { appLocale, dictionary } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";
import { InstagramSetupForm } from "./setup-form";

export default async function InstagramSetupPage() {
  await requireAdmin();
  const locale = appLocale();
  const t = dictionary(locale);
  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">{t.instagram.eyebrow}</p>
        <h1>{t.instagram.title}</h1>
        <p className="muted">{t.instagram.intro}</p>
        <InstagramSetupForm locale={locale} />
        <a className="back-link" href="/setup">{t.instagram.back}</a>
      </section>
    </main>
  );
}
