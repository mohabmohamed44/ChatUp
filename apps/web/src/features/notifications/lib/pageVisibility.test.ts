import { describe, it, expect } from 'vitest';
import { isPageTrulyVisible, getVisibilityDebug, resetVisibilityTracker } from './pageVisibility';

// Web vitest project runs in node (no DOM): the tracker must fail closed to
// "hidden" so callers take the OS-notification branch, never crash on SSR.
describe('pageVisibility (no-DOM environment)', () => {
  it('reports not-visible without a window', () => {
    resetVisibilityTracker();
    expect(isPageTrulyVisible()).toBe(false);
  });

  it('debug snapshot is consistent with the verdict', () => {
    resetVisibilityTracker();
    const debug = getVisibilityDebug();
    expect(debug.trulyVisible).toBe(false);
    expect(debug.lastFocusAt).toBe(0);
    expect(debug.lastBlurAt).toBe(0);
  });
});
