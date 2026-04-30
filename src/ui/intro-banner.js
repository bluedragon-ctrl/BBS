// Boot banner: CRIMSON WYRM (red, static) before the player unlocks the truth,
// then a left-to-right magenta scramble wave that reveals NETROMANCER underneath.
//
// Pre-unlock callers use renderStaticBanner. Once the crown amulet flips
// flags.netromancerRevealed, the boot path calls playIntroBanner instead.
// Mode picks the timing — 'full' on the first reveal, 'fast' on every boot after.

export const CRIMSON_WYRM_ART = String.raw`
 ██████╗██████╗ ██╗███╗   ███╗███████╗ ██████╗ ███╗   ██╗    ██╗    ██╗██╗   ██╗██████╗ ███╗   ███╗
██╔════╝██╔══██╗██║████╗ ████║██╔════╝██╔═══██╗████╗  ██║    ██║    ██║╚██╗ ██╔╝██╔══██╗████╗ ████║
██║     ██████╔╝██║██╔████╔██║███████╗██║   ██║██╔██╗ ██║    ██║ █╗ ██║ ╚████╔╝ ██████╔╝██╔████╔██║
██║     ██╔══██╗██║██║╚██╔╝██║╚════██║██║   ██║██║╚██╗██║    ██║███╗██║  ╚██╔╝  ██╔══██╗██║╚██╔╝██║
╚██████╗██║  ██║██║██║ ╚═╝ ██║███████║╚██████╔╝██║ ╚████║    ╚███╔███╔╝   ██║   ██║  ██║██║ ╚═╝ ██║
 ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝     ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝
`.replace(/^\n/, '').replace(/\n$/, '');

export const NETROMANCER_ART = String.raw`
███╗   ██╗███████╗████████╗██████╗  ██████╗ ███╗   ███╗ █████╗ ███╗   ██╗ ██████╗███████╗██████╗
████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗████╗ ████║██╔══██╗████╗  ██║██╔════╝██╔════╝██╔══██╗
██╔██╗ ██║█████╗     ██║   ██████╔╝██║   ██║██╔████╔██║███████║██╔██╗ ██║██║     █████╗  ██████╔╝
██║╚██╗██║██╔══╝     ██║   ██╔══██╗██║   ██║██║╚██╔╝██║██╔══██║██║╚██╗██║██║     ██╔══╝  ██╔══██╗
██║ ╚████║███████╗   ██║   ██║  ██║╚██████╔╝██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╗███████╗██║  ██║
╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝
`.replace(/^\n/, '').replace(/\n$/, '');

const TIMINGS = {
  full: { startChurn: 2700, churnSpan: 1300, churnDur: 950, tail: 250 },
  fast: { startChurn: 600,  churnSpan: 600,  churnDur: 400, tail: 150 },
};

const CHURN_GLYPHS = [...'!@#$%^&*<>{}[]|\\/=_+-?~"\':;,.█▓▒░╔╗╚╝═║╠╣╦╩╬•◦∙·'];
const rand = arr => arr[(Math.random() * arr.length) | 0];

function toGrid(text) {
  return text.split('\n').map(line => [...line]);
}

function gridDims(grid) {
  return { rows: grid.length, cols: Math.max(...grid.map(r => r.length)) };
}

function padGrid(grid, width, height) {
  const rows = [];
  const padTop = Math.floor((height - grid.length) / 2);
  for (let r = 0; r < height; r++) {
    const src = grid[r - padTop] || [];
    const padLeft = Math.floor((width - src.length) / 2);
    const row = [];
    for (let c = 0; c < width; c++) {
      const sc = c - padLeft;
      row.push(src[sc] !== undefined ? src[sc] : ' ');
    }
    rows.push(row);
  }
  return rows;
}

function renderGridSpans(el, grid) {
  let html = '';
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const ch = grid[r][c];
      const safe = ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch;
      html += `<span data-r="${r}" data-c="${c}">${safe}</span>`;
    }
    html += '\n';
  }
  el.innerHTML = html;
}

export function renderStaticBanner(el, art, hue = 'red') {
  el.className = `banner ${hue}`;
  el.textContent = art;
}

export function playIntroBanner({ container, mode = 'full' } = {}) {
  return new Promise((resolve) => {
    const el = container;
    const { startChurn, churnSpan, churnDur, tail } = TIMINGS[mode] ?? TIMINGS.full;
    const totalDur = startChurn + churnSpan + churnDur + tail;

    const cwRaw = toGrid(CRIMSON_WYRM_ART);
    const nmRaw = toGrid(NETROMANCER_ART);
    const W = Math.max(gridDims(cwRaw).cols, gridDims(nmRaw).cols);
    const H = Math.max(gridDims(cwRaw).rows, gridDims(nmRaw).rows);
    const cwG = padGrid(cwRaw, W, H);
    const nmG = padGrid(nmRaw, W, H);

    el.className = 'banner red';
    renderGridSpans(el, cwG);

    const lookup = new Array(H);
    for (let r = 0; r < H; r++) lookup[r] = new Array(W);
    el.querySelectorAll('span').forEach(s => {
      lookup[+s.dataset.r][+s.dataset.c] = s;
    });

    const cells = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const span = lookup[r][c];
        if (!span) continue;
        const churnAt = startChurn + (c / W) * churnSpan + Math.random() * 150;
        cells.push({ span, r, c, churnAt, lockAt: churnAt + churnDur });
      }
    }

    const t0 = performance.now();
    let raf;
    function frame(now) {
      const t = now - t0;
      for (const o of cells) {
        const target = nmG[o.r][o.c];
        const source = cwG[o.r][o.c];
        if (t < o.churnAt) {
          // CW phase — no-op, source already rendered
        } else if (t < o.lockAt) {
          if (target === ' ' && source === ' ') {
            if (o.span.textContent !== ' ') o.span.textContent = ' ';
          } else {
            o.span.textContent = rand(CHURN_GLYPHS);
            if (o.span.className !== 'churn') o.span.className = 'churn';
          }
        } else if (!o.span.dataset.locked) {
          o.span.textContent = target;
          o.span.className = 'locked';
          o.span.dataset.locked = '1';
        }
      }
      if (t > totalDur) {
        el.className = 'banner magenta';
        cancelAnimationFrame(raf);
        resolve();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  });
}
