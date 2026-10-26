import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexUsageDate } from "../src/app/setup/codex/model-usage";
import { messages } from "../src/lib/messages";

test("Codex dates render canonical UTC and provider reset timestamps", () => {
  expect(renderToStaticMarkup(<CodexUsageDate value="2026-10-26T19:53:55.178Z" locale="es" />)).toContain('dateTime="2026-10-26T19:53:55.178Z"');
  expect(renderToStaticMarkup(<CodexUsageDate value={1793605020 * 1000} locale="en" />)).toContain('<time dateTime=');
});

test("invalid and unavailable dates cannot crash the Codex settings page", () => {
  for (const locale of ["es", "en"] as const) {
    for (const value of [null, "", "not-a-date", "2026-10-26T19:53:55.178645+00Z", NaN, Infinity, Number.MAX_VALUE]) {
      expect(renderToStaticMarkup(<CodexUsageDate value={value} locale={locale} />)).toBe(messages[locale].codex.unknown);
    }
  }
});
