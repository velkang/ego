// Vite emits this when an open tab requests a chunk removed by a new deployment.
// Reload at most once per entry bundle; persistent failures stay recoverable in
// the page boundary rather than entering a reload loop.
window.addEventListener("vite:preloadError", (event) => {
  if (!navigator.onLine) return;
  try {
    const key = "ego.asset-recovery";
    if (sessionStorage.getItem(key) === import.meta.url) return;
    sessionStorage.setItem(key, import.meta.url);
  } catch {
    // Without storage we cannot safely enforce the reload limit.
    return;
  }
  event.preventDefault();
  window.location.reload();
});
