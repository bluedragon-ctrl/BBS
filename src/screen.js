// Screen router. Toggles `.active` on `<section data-screen="...">` elements,
// and portals the global log-strip into the active screen's .log-slot so the
// same DOM node (with its content + scroll position) appears in every screen
// that has a slot. Boot has no slot, so the strip parks in #log-host.

import { scrollLogToEnd } from './log.js';

let currentScreen = 'boot';

export function showScreen(name) {
  let active = null;
  document.querySelectorAll('.screen-stage > section').forEach(s => {
    const isActive = s.dataset.screen === name;
    s.classList.toggle('active', isActive);
    if (isActive) active = s;
  });
  currentScreen = name;
  dockLogStrip(active);
  // Force the log to its bottom on every screen transition — PageUp scrollback
  // is preserved within a screen, but arriving at a new room shouldn't leave
  // the player staring at stale lines while new ones type in unseen.
  scrollLogToEnd();
}

function dockLogStrip(activeSection) {
  const strip = document.querySelector('.log-strip');
  if (!strip) return;
  const slot = activeSection?.querySelector(':scope > .layout > .log-slot');
  const target = slot || document.getElementById('log-host');
  if (target && strip.parentNode !== target) target.appendChild(strip);
}

export function activeScreen() {
  return currentScreen;
}
