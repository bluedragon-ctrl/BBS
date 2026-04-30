// Reusable terminal-sequence renderer — a typewriter that types out a
// scripted sequence of lines and (optionally) shows them in a framed modal.
// Used for the boot dial-up, and reusable for in-game events: boss
// interference, connection drops, restoration, exposition, etc.

import { sleep, armSwallow } from './util.js';

const DEFAULTS = {
  theme: 'normal',     // 'normal' | 'alarm' | 'failure' | 'glitch'
  charMs: 22,
  lineDelayMs: 110,
  frame: true,         // true = framed modal overlay; false = render inline into options.target
  dismissOn: 'press',  // 'auto' | 'press' | 'persist'
  skippable: true,
  target: null,        // required when frame=false
};

/**
 * Render a scripted terminal sequence.
 *
 * `lines` accepts:
 *   - "plain string"            → typed line, default theme color
 *   - { text, class }           → typed line with optional CSS class for color
 *   - { delay: ms }             → pause without text
 *   - { noise: "░▒▓█" }         → noise burst (block chars repeated)
 *
 * Returns a Promise that resolves when the sequence completes
 * (auto), is dismissed by user input (press), or never (persist;
 * caller is responsible for hiding the modal).
 */
export async function showTerminalSequence(lines, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  let modal, container;
  if (opts.frame) {
    modal = document.getElementById('terminal-modal');
    if (!modal) throw new Error('terminal-modal element missing in HTML');
    container = modal.querySelector('.terminal-content');
    container.innerHTML = '';
    modal.className = `modal terminal-modal theme-${opts.theme}`;
    modal.classList.remove('hidden');
  } else {
    container = opts.target;
    if (!container) throw new Error('inline mode requires options.target');
    container.innerHTML = '';
    container.className = `terminal-content theme-${opts.theme}`;
  }

  // Phase 1: typing — single skip flag flushes everything.
  let skipped = false;
  const skip = (e) => {
    if (!opts.skippable) return;
    skipped = true;
  };
  window.addEventListener('keydown', skip);
  window.addEventListener('click', skip);

  for (const entry of lines) {
    if (entry && typeof entry === 'object' && entry.delay != null) {
      if (!skipped) await sleep(entry.delay);
      continue;
    }
    if (entry && typeof entry === 'object' && entry.noise != null) {
      const div = document.createElement('div');
      div.className = 'term-noise';
      container.appendChild(div);
      await typeInto(div, String(entry.noise).repeat(8), opts.charMs, () => skipped);
      continue;
    }
    const text = typeof entry === 'string' ? entry : (entry?.text ?? '');
    const cls = (entry && typeof entry === 'object' && entry.class) ? entry.class : '';
    const div = document.createElement('div');
    if (cls) div.className = cls;
    container.appendChild(div);
    await typeInto(div, text, opts.charMs, () => skipped);
    if (!skipped) await sleep(opts.lineDelayMs);
  }

  window.removeEventListener('keydown', skip);
  window.removeEventListener('click', skip);

  // Phase 2: dismiss policy
  if (opts.dismissOn === 'auto') {
    if (modal) {
      await sleep(300);
      modal.classList.add('hidden');
    }
    return;
  }
  if (opts.dismissOn === 'persist') return;

  // 'press' — wait for any key/click (with a brief delay so the same
  // event that finished the skip doesn't immediately dismiss).
  return new Promise(resolve => {
    const handler = (e) => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('click', handler);
      if (e && e.type === 'keydown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        armSwallow(e.key);
      }
      if (modal) modal.classList.add('hidden');
      resolve();
    };
    setTimeout(() => {
      window.addEventListener('keydown', handler, true);
      window.addEventListener('click', handler);
    }, 50);
  });
}

async function typeInto(el, text, charMs, isSkipped) {
  if (!text) return;
  if (isSkipped()) { el.textContent = text; return; }
  for (let i = 0; i < text.length; i++) {
    if (isSkipped()) { el.textContent = text; return; }
    el.textContent += text[i];
    await sleep(charMs);
  }
}

