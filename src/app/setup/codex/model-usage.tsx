"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CodexModel, CodexPreferences } from "@/lib/codex/preferences";
import type { curatorUsage, RateBucket } from "@/lib/codex/usage";
import { messages, type Locale } from "@/lib/messages";

type Settings = {
  preferences: CodexPreferences; models: CodexModel[]; defaultModel: string | null;
  limits: RateBucket[] | null; accountTokens: number | null; usage: ReturnType<typeof curatorUsage>;
  errors: { models: boolean; config: boolean; limits: boolean; accountTokens: boolean };
};

export function CodexModelUsage({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const c = t.codex;
  const [data, setData] = useState<Settings | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Six decimal places retain the protocol's credit/USD micro-unit precision.
  const number = (value: number | null) => value == null ? c.unknown : new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/setup/codex/settings", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body: Settings = await response.json();
      setData(body);
      setModel(body.preferences.model ?? "");
      setEffort(body.preferences.effort);
    } catch { setError(c.loadFailed); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
    // Fetch on mount; quota reads do not require a background polling loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = data?.models.find((m) => m.model === (model || data.defaultModel));
  const supported = selected?.supportedReasoningEfforts ?? [];
  const compatible = supported.some((option) => option.reasoningEffort === effort);

  function chooseModel(value: string) {
    setModel(value);
    setNotice("");
    const entry = data?.models.find((m) => m.model === (value || data.defaultModel));
    if (!entry?.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)) setEffort(entry?.defaultReasoningEffort ?? "");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/setup/codex/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: model || null, effort }) });
      if (!response.ok) throw new Error();
      setData((previous) => previous ? { ...previous, preferences: { model: model || null, effort } } : previous);
      setNotice(c.saved);
    } catch { setError(c.saveFailed); }
    finally { setSaving(false); }
  }

  const totals = data?.usage.totals;
  return <section className="codex-model-usage stack" aria-busy={loading}>
    <h2>{c.settingsTitle}</h2>
    <button type="button" className="primary" disabled={loading || saving} onClick={() => { setNotice(""); void refresh(); }}>{loading ? t.common.loading : c.refresh}</button>
    <p role="alert">{error}</p>
    <p role="status">{notice}</p>
    {data && <>
      <form className="stack" onSubmit={save}>
        <label>{c.model}<select value={model} disabled={loading || saving || data.errors.models} onChange={(event) => chooseModel(event.target.value)} aria-describedby="codex-model-help">
          <option value="">{c.defaultModel}{data.defaultModel ? ` (${data.defaultModel})` : ""}</option>
          {model && !data.models.some((m) => m.model === model) && <option value={model}>{model} — {c.unknown}</option>}
          {data.models.map((m) => <option key={m.id} value={m.model}>{m.displayName}</option>)}
        </select></label>
        <label>{c.reasoning}<select value={effort} disabled={loading || saving || !selected} onChange={(event) => { setEffort(event.target.value); setNotice(""); }}>
          {!compatible && <option value={effort}>{effort || c.unknown} — {c.unknown}</option>}
          {supported.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{option.reasoningEffort}</option>)}
        </select></label>
        <p id="codex-model-help" className="muted">{c.catalogHelp}</p>
        {data.errors.models && <p className="error">{c.unavailable}</p>}
        <p>{c.currentModel}: <strong>{data.preferences.model ?? data.defaultModel ?? c.unknown}</strong></p>
        <p className="muted">{c.settingsHelp}</p>
        <button className="primary" disabled={saving || loading || !compatible}>{saving ? t.common.saving : t.common.save}</button>
      </form>
      <section className="stack">
        <h2>{c.curatorUsage}</h2>
        <p className="muted">{c.trackingHelp}</p>
        <p>{c.trackingSince}: <time dateTime={`${data.usage.trackingSince.replace(" ", "T")}Z`}>{date(`${data.usage.trackingSince.replace(" ", "T")}Z`)}</time></p>
        {totals && <dl className="codex-usage-values">
          <div><dt>{c.runs}</dt><dd>{number(totals.runs)}</dd></div>
          <div><dt>{c.measured}</dt><dd>{number(totals.measuredRuns)} / {number(totals.runs)}</dd></div>
          <div><dt>{c.tokens}</dt><dd>{number(totals.totalTokens)}</dd></div>
          <div><dt>{c.input}</dt><dd>{number(totals.inputTokens)}</dd></div>
          <div><dt>{c.cached}</dt><dd>{number(totals.cachedInputTokens)}</dd></div>
          <div><dt>{c.output}</dt><dd>{number(totals.outputTokens)}</dd></div>
          <div><dt>{c.reasoningTokens}</dt><dd>{number(totals.reasoningOutputTokens)}</dd></div>
          {/* Protocol fields are in millionths of a credit or USD. */}
          <div><dt>{c.credits}</dt><dd>{number(totals.creditsMicros == null ? null : totals.creditsMicros / 1_000_000)} ({number(totals.creditRuns)} / {number(totals.runs)})</dd></div>
          <div><dt>{c.usd}</dt><dd>{totals.usdMicros == null ? c.unknown : new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(totals.usdMicros / 1_000_000)} ({number(totals.usdRuns)} / {number(totals.runs)})</dd></div>
        </dl>}
        {!totals?.runs && <p>{c.noUsage}</p>}
        <p className="muted">{c.subsets}</p>
        {!!data.usage.byModel.length && <div className="codex-usage-table" role="region" aria-label={c.curatorUsage} tabIndex={0}><table>
          <caption>{c.curatorUsage}</caption><thead><tr><th scope="col">{c.model}</th><th scope="col">{c.runs}</th><th scope="col">{c.measured}</th><th scope="col">{c.tokens}</th></tr></thead>
          <tbody>{data.usage.byModel.map((group) => <tr key={group.model ?? "unknown"}><th scope="row">{group.model ?? c.unknown}</th><td>{number(group.runs)}</td><td>{number(group.measuredRuns)}</td><td>{number(group.totalTokens)}</td></tr>)}</tbody>
        </table></div>}
        <p>{c.billingHelp}</p>
      </section>
      <section className="stack">
        <h2>{c.subscription}</h2>
        <p className="muted">{c.subscriptionHelp}</p>
        <p>{c.accountTokens}: <strong>{number(data.accountTokens)}</strong></p>
        {data.limits?.length ? data.limits.map((bucket, bucketIndex) => <section key={bucket.limitId ?? bucketIndex}>
          <h3>{bucket.limitName ?? bucket.limitId ?? c.subscription}</h3>
          {[bucket.primary, bucket.secondary].map((window, index) => window && <dl className="codex-usage-values" key={index}>
            <div><dt>{c.windowMinutes}</dt><dd>{number(window.windowDurationMins)}</dd></div>
            <div><dt>{c.used}</dt><dd>{number(window.usedPercent)}%</dd></div>
            <div><dt>{c.resets}</dt><dd>{window.resetsAt == null ? c.unknown : <time dateTime={new Date(window.resetsAt * 1_000).toISOString()}>{date(new Date(window.resetsAt * 1_000).toISOString())}</time>}</dd></div>
          </dl>)}
          {bucket.credits && <p>{c.balance}: {bucket.credits.unlimited ? c.unlimited : bucket.credits.balance ?? c.unknown}</p>}
        </section>) : <p>{c.unavailable}</p>}
      </section>
    </>}
  </section>;
}
