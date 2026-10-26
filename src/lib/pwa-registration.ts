/** Observe both a worker already installing and future update attempts. */
export function observeServiceWorkerUpdates(registration: ServiceWorkerRegistration, report: (error: Error | null) => void) {
  const workers = new Map<ServiceWorker, () => void>();
  function observeInstalling() {
    const worker = registration.installing;
    if (!worker || workers.has(worker)) return;
    const check = () => {
      if (worker.state !== "redundant" && worker.state !== "activated") return;
      worker.removeEventListener("statechange", check);
      workers.delete(worker);
      report(worker.state === "redundant" ? new Error("pwa_installation_failed") : null);
    };
    workers.set(worker, check);
    worker.addEventListener("statechange", check);
    check();
  }
  registration.addEventListener("updatefound", observeInstalling);
  observeInstalling();
  if (!registration.installing && registration.active) report(null);
  return () => {
    registration.removeEventListener("updatefound", observeInstalling);
    for (const [worker, check] of workers) worker.removeEventListener("statechange", check);
    workers.clear();
  };
}
