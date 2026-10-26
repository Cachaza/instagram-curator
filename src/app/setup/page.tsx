import { requireSession } from "@/lib/session";
import { appLocale, dictionary } from "@/lib/i18n";
import { MapSettings } from "@/components/map-settings";
import { restaurantMessages } from "@/lib/restaurant-messages";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  const session = await requireSession();
  const locale = await appLocale();
  const t = await dictionary(locale);
  const map = restaurantMessages[locale];
  return (
    <div className="centered wide">
      <section className="setup-card">
        <h1>{t.shell.settings}</h1>
        <section aria-labelledby="map-settings-title">
          <h2 id="map-settings-title">{map.mapSettings}</h2>
          <MapSettings key={session.user.id} userId={session.user.id} locale={locale} />
        </section>
        {session.user.role === "admin" && <section aria-labelledby="app-settings-title">
          <h2 id="app-settings-title">{t.setup.title}</h2>
          <p className="muted">{t.setup.intro}</p>
          <SetupForm locale={locale} />
          <div className="setup-links">
            <a href="/setup/instagram">{t.setup.configureInstagram}</a>
            <a href="/setup/codex">{t.codex.configure}</a>
            <a href="/setup/diagnostics">Comprobar instalación</a>
          </div>
        </section>}
      </section>
    </div>
  );
}
