// Log strip — typewriter queue with click/key flush, PageUp/Down scroll,
// and connection-driven character corruption.

import { corruptionProb } from './ui/glitch.js';

const LOG_CHAR_MS = 30;
const LOG_MAX_LINES = 200;

const queue = [];
let typing = false;
let flushFlag = false;
let getConn = () => 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function initLog(opts) {
  getConn = opts.getConn || getConn;
  window.addEventListener('click', (e) => {
    if (typing && !e.target.closest('button')) flushLog();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      const log = activeLogBody();
      if (log) {
        const delta = e.key === 'PageUp' ? -log.clientHeight : log.clientHeight;
        log.scrollBy({ top: delta, behavior: 'smooth' });
        e.preventDefault();
      }
    }
  });
}

// Accepts either a plain string or an array of segments [{text, class?}].
export function logMessage(entry) {
  queue.push(entry);
  if (!typing) drainLogQueue();
}

export function flushLog() {
  if (typing) flushFlag = true;
}

export function isTyping() {
  return typing;
}

export function awaitLogIdle() {
  return new Promise(resolve => {
    const check = () => {
      if (!typing && queue.length === 0) resolve();
      else setTimeout(check, 40);
    };
    check();
  });
}

function toSegments(entry) {
  if (typeof entry === 'string') return [{ text: entry }];
  if (Array.isArray(entry)) return entry.map(s => typeof s === 'string' ? { text: s } : s);
  return [{ text: String(entry) }];
}

function activeLogBody() {
  return document.querySelector('section[data-screen].active .log-body')
      || document.querySelector('.log-body');
}

function isLogAtBottom(el, slack = 2) {
  if (!el) return true;
  return (el.scrollHeight - el.clientHeight - el.scrollTop) <= slack;
}

function scrollLogToBottom(el) {
  if (el) el.scrollTop = el.scrollHeight;
}

async function drainLogQueue() {
  const log = activeLogBody();
  if (!log) { queue.length = 0; typing = false; return; }
  typing = true;
  while (queue.length) {
    const segments = toSegments(queue.shift());
    const wasAtBottom = isLogAtBottom(log);
    const div = document.createElement('div');
    const prefix = document.createElement('span');
    prefix.textContent = '> ';
    div.appendChild(prefix);
    log.appendChild(div);
    while (log.children.length > LOG_MAX_LINES) log.removeChild(log.firstChild);
    if (wasAtBottom) scrollLogToBottom(log);

    for (const seg of segments) {
      const span = document.createElement('span');
      if (seg.class) span.className = seg.class;
      div.appendChild(span);
      if (flushFlag) { span.textContent = seg.text; continue; }
      for (let i = 0; i < seg.text.length; i++) {
        if (flushFlag) { span.textContent = seg.text; break; }
        // Connection-driven char corruption: substitute non-space chars
        // with a glyph from the corruption pool. Permanent — bytes arrived
        // wrong over the wire and stay that way.
        let ch = seg.text[i];
        const p = corruptionProb(getConn());
        if (p > 0 && ch !== ' ' && ch !== '\n' && ch !== '\t' && Math.random() < p) {
          const pool = '▓░▒@#%&*?';
          ch = pool[Math.floor(Math.random() * pool.length)];
        }
        span.textContent += ch;
        if (isLogAtBottom(log, 4)) scrollLogToBottom(log);
        await sleep(LOG_CHAR_MS);
      }
    }
  }
  typing = false;
  flushFlag = false;
}
