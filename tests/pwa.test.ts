import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import manifest from "../src/app/manifest";
import { observeServiceWorkerUpdates } from "../src/lib/pwa-registration";
import nextConfig from "../next.config";

const workerSource = await readFile("public/sw.js", "utf8");

function worker(locale = "en") {
  const listeners: Record<string, (event: unknown) => void> = {};
  const writes: string[] = [];
  const removed: string[] = [];
  const matches: string[] = [];
  const offline = new Response("Public offline page");
  const cache = {
    addAll: async (assets: string[]) => { writes.push(...assets); },
    match: async (path: string) => { matches.push(path); return offline; },
  };
  let network: (request: unknown) => Promise<Response> = async () => new Response("Online private page");
  runInNewContext(workerSource, {
    URL, Response,
    self: { location: new URL(`https://curator.invalid/sw.js?locale=${locale}`), addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ["curator-pwa-v0", "unrelated-cache", "curator-pwa-v1"], delete: async (key: string) => { removed.push(key); return true; } },
    fetch: (request: unknown) => network(request),
  });
  return {
    writes, removed, matches, offline,
    offlineNetwork: () => { network = async () => { throw new Error("offline"); }; },
    async lifecycle(type: string) { let work: Promise<unknown> | undefined; listeners[type]({ waitUntil: (promise: Promise<unknown>) => { work = promise; } }); await work; },
    fetch(url: string, mode = "navigate", method = "GET") {
      let response: Promise<Response> | undefined;
      listeners.fetch({ request: { url, mode, method }, respondWith: (promise: Promise<Response>) => { response = promise; } });
      return response;
    },
  };
}

describe("PWA installation and private-data boundary", () => {
  test("manifest provides standalone installation and correctly sized PNG icons", async () => {
    const config = manifest();
    expect(config.display).toBe("standalone");
    expect(config.id).toBe("/");
    expect(config.start_url).toBe("/");
    expect(config.scope).toBe("/");
    for (const icon of config.icons!) {
      const image = await readFile(`public${icon.src}`);
      // PNG signature and IHDR width/height offsets from the PNG file format.
      expect(image.subarray(1, 4).toString()).toBe("PNG");
      expect(icon.sizes).toBe(`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`);
    }
    expect(config.icons!.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  test("install precaches only public self-contained fallback pages and icons", async () => {
    const sw = worker(); await sw.lifecycle("install");
    expect(sw.writes).toEqual(["/offline.es.html", "/offline.en.html", "/icons/curator-192.png", "/icons/curator-512.png"]);
    for (const path of sw.writes) expect((await readFile(`public${path}`)).length).toBeGreaterThan(0);
  });

  test("online private navigation stays on the network and is never written to Cache Storage", async () => {
    const sw = worker();
    expect(await (await sw.fetch("https://curator.invalid/library"))!.text()).toBe("Online private page");
    expect(sw.writes).toEqual([]); expect(sw.matches).toEqual([]);
  });

  test("offline navigation uses the registered app language without caching private pages", async () => {
    for (const locale of ["es", "en"]) {
      const sw = worker(locale); sw.offlineNetwork();
      expect(await sw.fetch("https://curator.invalid/publications/synthetic-private-id")).toBe(sw.offline);
      expect(sw.matches).toEqual([`/offline.${locale}.html`]); expect(sw.writes).toEqual([]);
      const html = await readFile(`public/offline.${locale}.html`, "utf8");
      expect(html).toContain(`lang="${locale}"`); expect(html).toContain('href="/library"');
    }
  });

  test("does not intercept APIs, mutations, RSC, media or third-party tiles", () => {
    const sw = worker(); sw.offlineNetwork();
    for (const path of ["/api", "/api/auth/get-session", "/api/media/private", "/api/restaurants/location"]) expect(sw.fetch(`https://curator.invalid${path}`)).toBeUndefined();
    expect(sw.fetch("https://curator.invalid/library", "cors")).toBeUndefined();
    expect(sw.fetch("https://curator.invalid/library", "navigate", "POST")).toBeUndefined();
    expect(sw.fetch("https://tile.openstreetmap.org/0/0/0.png", "no-cors")).toBeUndefined();
    expect(sw.writes).toEqual([]);
  });

  test("activation removes only old Curator PWA caches", async () => {
    const sw = worker(); await sw.lifecycle("activate");
    expect(sw.removed).toEqual(["curator-pwa-v0"]);
  });

  test("worker script is revalidated and served with the right security headers", async () => {
    const headers = await nextConfig.headers!();
    const rule = headers.find((entry) => entry.source === "/sw.js")!;
    const values = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
    expect(values["Content-Type"]).toContain("application/javascript");
    expect(values["Cache-Control"]).toContain("no-store");
    expect(values["X-Content-Type-Options"]).toBe("nosniff");
  });
});


class InstallingWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event("statechange")); }
}
class WorkerRegistration extends EventTarget {
  installing: InstallingWorker | null = null;
  active: InstallingWorker | null = null;
}

describe("PWA update failure visibility", () => {
  test("reports an already-installing worker failure even with an older active worker", () => {
    const registration = new WorkerRegistration();
    registration.active = new InstallingWorker(); registration.active.state = "activated";
    registration.installing = new InstallingWorker();
    const errors: Array<Error | null> = [];
    const stop = observeServiceWorkerUpdates(registration as unknown as ServiceWorkerRegistration, (error) => errors.push(error));
    registration.installing.change("redundant");
    expect(errors.map((error) => error?.message)).toEqual(["pwa_installation_failed"]);
    stop();
  });

  test("observes later updatefound attempts, including failure followed by successful activation", () => {
    const registration = new WorkerRegistration();
    registration.active = new InstallingWorker(); registration.active.state = "activated";
    const errors: Array<Error | null> = [];
    const stop = observeServiceWorkerUpdates(registration as unknown as ServiceWorkerRegistration, (error) => errors.push(error));
    registration.installing = new InstallingWorker(); registration.dispatchEvent(new Event("updatefound"));
    registration.installing.change("redundant");
    registration.installing = new InstallingWorker(); registration.dispatchEvent(new Event("updatefound"));
    registration.installing.change("activated");
    expect(errors.map((error) => error?.message ?? null)).toEqual([null, "pwa_installation_failed", null]);
    stop();
  });

  test("detaches state listeners after terminal states and all listeners on cleanup", () => {
    const registration = new WorkerRegistration(); registration.installing = new InstallingWorker();
    const states: Array<Error | null> = [];
    const stop = observeServiceWorkerUpdates(registration as unknown as ServiceWorkerRegistration, (error) => states.push(error));
    registration.installing.change("activated"); registration.installing.change("redundant");
    expect(states).toEqual([null]);
    registration.installing = new InstallingWorker(); registration.dispatchEvent(new Event("updatefound"));
    stop(); registration.installing.change("redundant");
    registration.installing = new InstallingWorker(); registration.dispatchEvent(new Event("updatefound")); registration.installing.change("redundant");
    expect(states).toEqual([null]);
  });
});
