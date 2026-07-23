import { getSetting } from "./settings";
import { messages, type Locale } from "./messages";

export const supportedLocales = ["es", "en"] as const;

export function appLocale(): Locale {
  const locale = getSetting<string>("ui.locale", "es");
  return supportedLocales.includes(locale as Locale) ? locale as Locale : "es";
}

export function dictionary(locale = appLocale()) {
  return messages[locale];
}
