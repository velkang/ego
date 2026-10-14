// Only the mounted Wallet page subscribes. Space requests from completion so
// slow connections cannot produce overlapping polling requests.
export function watchWallet(refresh: () => Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let failures = 0;
  let retryAt = 0;
  const available = () => document.visibilityState === "visible" && navigator.onLine;
  function schedule() {
    clearTimeout(timer);
    if (stopped || !available()) return;
    const delay = Math.min(30_000 * 2 ** failures, 300_000) + Math.random() * 5_000;
    timer = setTimeout(() => void update(), delay);
  }
  async function update() {
    if (stopped || running || !available()) return;
    if (Date.now() < retryAt) return;
    clearTimeout(timer);
    running = true;
    try {
      const success = await refresh();
      failures = success ? 0 : Math.min(failures + 1, 4);
    } catch {
      failures = Math.min(failures + 1, 4);
    } finally {
      running = false;
      retryAt = failures ? Date.now() + Math.min(30_000 * 2 ** failures, 300_000) : 0;
      schedule();
    }
  }
  function resume() {
    clearTimeout(timer);
    if (!available() || stopped || running) return;
    if (Date.now() < retryAt) {
      timer = setTimeout(() => void update(), retryAt - Date.now());
    } else void update();
  }
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("offline", resume);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("offline", resume);
  };
}
