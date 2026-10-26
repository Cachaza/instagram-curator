import { getSetting } from "./settings";
import { messages, type Locale } from "./messages";

export const supportedLocales = ["es", "en"] as const;

export async function appLocale(): Promise<Locale> {
  const locale = await getSetting<string>("ui.locale", "es");
  return supportedLocales.includes(locale as Locale) ? locale as Locale : "es";
}

export async function dictionary(locale?: Locale) {
  const selectedLocale = locale ?? await appLocale();
  return messages[selectedLocale];
}
