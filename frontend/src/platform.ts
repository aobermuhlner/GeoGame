// Where the site runs: in a browser, or inside the Android app (a Trusted Web Activity wrapping this site).
// App-only differences hang off `isApp` or the `app` class on <body>. Mobile improvements that help phone
// browsers too belong in plain CSS/JS, not behind this flag.

const SOURCE_KEY = 'flagduel-source';

function detectApp(): boolean {
  const url = new URL(location.href);
  // The app starts at ?source=twa (manifest start_url); an invite link opened in the app comes with an
  // android-app:// referrer instead.
  const launched = url.searchParams.get('source') === 'twa' || document.referrer.startsWith('android-app://');
  try {
    // Remembered for the tab, so reloads and in-app navigation keep it.
    if (launched) sessionStorage.setItem(SOURCE_KEY, 'twa');
    else if (sessionStorage.getItem(SOURCE_KEY) === 'twa') return true;
  } catch {
    /* storage unavailable: only this page load knows */
  }
  if (url.searchParams.has('source')) {
    // Keep the address clean (it ends up in reloads and shared screenshots).
    url.searchParams.delete('source');
    history.replaceState(history.state, '', url);
  }
  return launched;
}

export const isApp = detectApp();
if (isApp) document.body.classList.add('app');

/** Touch-first device (phone or tablet), in the app or a browser */
export const isTouch = matchMedia('(pointer: coarse)').matches;
