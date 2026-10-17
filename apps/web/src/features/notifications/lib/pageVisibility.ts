/**
 * True-visibility tracker.
 *
 * `document.visibilityState` + `document.hasFocus()` lie on some platforms:
 * an installed PWA on Linux Chrome can report `visible` + focused while
 * minimized, so a foreground-only check shows an in-app toast nobody sees and
 * never reaches the OS-notification branch. `blur` / `visibilitychange`
 * events are a second, independent signal — a minimized window fires `blur`
 * (and usually `visibilitychange` to `hidden`) even when the polling-style
 * `hasFocus()` getter still returns true afterwards.
 *
 * Rule: the page counts as truly visible only if the *last* focus event is
 * newer than the last blur event AND the document currently reports visible
 * + focused. When all signals agree (the common case), this behaves exactly
 * like the plain check — it only widens the "hidden" verdict when a blur was
 * observed that the getter doesn't reflect.
 */
let lastFocusAt = 0;
let lastBlurAt = 0;
let listenersAttached = false;

function attachListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  // A freshly loaded page that receives no events yet counts as focused;
  // seed the timestamp so the comparison below is meaningful.
  lastFocusAt = Date.now();
  window.addEventListener('focus', () => {
    lastFocusAt = Date.now();
  });
  window.addEventListener('blur', () => {
    lastBlurAt = Date.now();
  });
}

export function isPageTrulyVisible(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  attachListeners();
  if (document.visibilityState !== 'visible') return false;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  // A blur newer than the last focus means the window lost focus and the
  // getter hasn't caught up (the Linux-PWA-minimized quirk).
  if (lastBlurAt > lastFocusAt) return false;
  return true;
}

/** Snapshot for debugging (DevTools probe / unit tests). */
export function getVisibilityDebug(): {
  visibilityState: string;
  hasFocus: boolean;
  lastFocusAt: number;
  lastBlurAt: number;
  trulyVisible: boolean;
} {
  return {
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    hasFocus:
      typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : false,
    lastFocusAt,
    lastBlurAt,
    trulyVisible:
      typeof document !== 'undefined'
        ? document.visibilityState === 'visible' && !(lastBlurAt > lastFocusAt)
        : false,
  };
}

/** Test-only reset (vitest modules are shared per file; keeps tests isolated). */
export function resetVisibilityTracker(): void {
  lastFocusAt = 0;
  lastBlurAt = 0;
  listenersAttached = false;
}
