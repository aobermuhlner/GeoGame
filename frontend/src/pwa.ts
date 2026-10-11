// Installable-app plumbing: the service worker (built from ../sw.js) and the online/offline state.
import { useEffect, useState } from 'preact/hooks';

/** Production only: the dev server has no sw.js, and a cached shell would hide HMR changes. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .then((reg) => {
        // The app can stay open for days (especially as an Android app): look for a new build whenever it
        // comes back to the foreground. A new worker only refreshes the offline cache; the next page load
        // fetches the new build from the network anyway.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
