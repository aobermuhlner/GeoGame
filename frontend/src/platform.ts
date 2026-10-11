// Where the site runs: in a browser, or inside the Android app (a Trusted Web Activity wrapping this site).
// App-only differences hang off `isApp` or the `app` class on <body>. Mobile improvements that help phone
// browsers too belong in plain CSS/JS, not behind this flag.

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

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

/**
 * Phones: while an input inside `ref` has focus, keep that box at the top of the screen, so what the player
 * answers about (the flag, the question) stays visible above the keyboard. With the viewport's
 * interactive-widget=resizes-content the keyboard resizes the window, which re-places the box. A change of
 * `step` (e.g. the countdown turning into the round) re-places it too, in case the content's height changed.
 */
export function useAboveKeyboard(ref: RefObject<HTMLElement>, on = true, step: unknown = null) {
  useEffect(() => {
    if (!isTouch || !on) return;
    let timer = 0;
    const place = (delay: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const el = ref.current;
        if (el && el.contains(document.activeElement)) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, delay);
    };
    // The keyboard opening resizes the window. A focus alone waits longer: Chrome scrolls a focused input into
    // view itself, a moment after the focus event.
    const onResize = () => place(16);
    const onFocus = () => place(300);
    window.addEventListener('resize', onResize);
    document.addEventListener('focusin', onFocus);
    place(16);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('focusin', onFocus);
    };
  }, [on, step]);
}
