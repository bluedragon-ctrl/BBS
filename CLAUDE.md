# NETROMANCER.BBS

## What this is

A roguelike where a simulated 80s BBS (bulletin board system) is the dungeon. The player is a mage/hacker exploring nodes (rooms), fighting monsters, learning spells. The progression arc is **mage → hacker**: standard fantasy spells unlock first; "exploit" spells (RESET.EXE, DELETE, CORRUPT) are mid/late-run discoveries that interact with the BBS itself. Aesthetic is 80s retro CRT — neon phosphor, scanlines, ASCII art, terminal frames.

## How to run

```
python -m http.server 8123
```

Open `http://localhost:8123` in a browser. No build step, no npm. Plain ES modules — must be served via HTTP (not `file://`).

`.claude/launch.json` defines a preview server profile named `netromancer` for use with the Claude Code preview tool.

## File layout

```
BBS/
  index.html              entry point; all screens declared here as <section data-screen="...">
  style.css               aesthetic shell — VT323, palette, scanlines, glow, panels, signal bar
  src/
    game.js               main entry; screen router, boot sequence, log typewriter, conn scaffolding
  data/                   (step 2+) — monsters, spells, items, nodes as JSON
  CLAUDE.md               this file
  .gitignore
  .claude/launch.json     preview server config
```

## Locked design decisions

| Area | Decision |
|---|---|
| Genre | Roguelike, permadeath, single fantasy-themed BBS |
| Map | Slay-the-Spire DAG, ~15 nodes / 6 layers, SYSOP node = win condition |
| Map visibility | Show current node + immediate next-step nodes only (fog of war); future codex/items may unlock further peek |
| Combat | Turn-based, NetHack-style speed scheduler (each actor accumulates energy per tick, acts when threshold hit) |
| Combat scale | Player + summoned allies vs up to 10 enemies |
| Combat UI | List view by default, all combatants in one list with per-row stats, statuses, energy bar, ticks-until-action; ASCII art (~7×14) shown only via inspect |
| Targeting | Numbered list selection (`1-9, 0, a-z`); selection happens in right panel, not modal |
| Modals | Codex, full inventory view, confirms, game over |
| Stats | HP, MP, INT, ATK, DEF, SPD, CONN |
| Damage typing | INT scales magic offense and (planned) magic resistance — no separate RES stat. ATK scales physical melee. DEF reduces all damage in v1; magic-vs-INT mitigation is a planned refinement. `damageType: 'physical'\|'magical'\|'pure'` is a forward-compat tag on damage atoms (currently no behavioural effect) |
| Connection (CONN) | Meta-resource. Drains only on death/failure (v1). Drives ambient screen degradation and stochastic glitches at low values |
| Spell schools | Arcane (mp cost), Exploit/Hacker (mp + conn cost), Hybrid (both) |
| Spell progression | Start with basic arcane spells; find new spells in run; discovered spells become *findable* in future runs (b2 model). Hacker spells are mid/late-run discoveries |
| Equipment slots | Weapon, Robe, Amulet, Ring, Ring |
| Items | Wearables = selection from known; consumables = free use; unknown items show as `???.SPL` etc. until identified |
| Codex | Known/unknown only (v1). Persists across runs — primary meta-progression |
| Currency | TOKENS |
| Node types | Combat, shop, library, shrine, event, elite, boss |
| Save | Suspend on room-leave (single slot, wiped on load) — no save-scumming |
| Audio | None v1; possible 8-bit pass later |

## Architecture conventions

- **All content is data-driven.** Monsters, spells, items, and nodes are defined in JSON under `data/`. Never hardcode content in JS files.
- **Behaviors = effect atoms + expression strings.** Behaviors are arrays of typed actions like `{type: "damage", target: "enemy", amount: "2d6+INT"}`. Numeric/conditional fields accept dice strings and small expressions evaluated against game state. Never embed raw JS in data — atoms only.
- **Screens** are hidden `<section data-screen="name">` elements in `index.html`. `showScreen(name)` toggles `.active`. Add new screens by adding sections, not by swapping documents.
- **Log strip** uses a queue + typewriter (30 ms/char). Use `logMessage(msg)` to append. Click outside any button or any keypress flushes the current line and queue.
- **Color palette legend** — green `--fg` = player/allies/safe; red `--enemy` = hostile actors; bright red `--danger` = crisis (low HP/CONN, debuff chips); magenta `--accent` = hacker theme + exploit/hybrid spells + chrome + key bindings; amber `--warn` = warning levels. Each colored variant has its own `text-shadow` glow override to avoid magenta-glowing-green halos.
- **CONN** is the single source of truth for connection-driven effects. `setConn(v)` writes to `state.conn` and the `--conn` CSS variable. Future glitch effects (scanline intensity, phosphor desat, noise overlay) must key off `--conn` rather than read state directly.
- **Glitch primitives** go through `triggerGlitch(type, intensity, target)`. Planned types: `scrambleText`, `tearLine`, `colorSwap`, `corruptBorders`, `flicker`. Mark glitchable text elements with `data-glitchable` so the system can find them.
- **Right column = selection and inspect.** Two roles: idle = show last hovered/selected entity; active selection = chooser for target/spell/item picks. Modals only for things that need overlay focus.
- **Combatants share one scheduler.** Player, allies, enemies are all actors with `speed` and accumulated `energy`. Same data model on both sides.
- **`window.netro`** exposes `state`, `setConn`, `triggerGlitch` for devtools/preview-eval debugging. Add new entries here when introducing systems worth poking at runtime.

## Working rule

**Always discuss the implementation approach before writing or editing code.** Even after design is locked and the user has greenlit the next step, lay out the concrete choices first (file layout, library/framework picks, specific values, edge cases) and wait for confirmation. This applies per-step, not just at project start. Small visible tweaks the user explicitly directs ("change X to Y") can be done without ceremony, but anything involving a design choice requires the discussion.

## Build order

1. ~~Project skeleton + CSS aesthetic shell + boot screen + screen router~~ ✅
2. ~~Data loader + atom executor + expression evaluator~~ ✅
3. ~~Speed scheduler + combat loop~~ ✅
4. ~~Combat UI: list view, inspect modal, target popup, stats panel wiring~~ ✅
5. ~~Map generator + node navigation + suspend save/load~~ ✅
6. ~~Codex screen + identification flow~~ ✅
7. ~~Special node interactions (shop / cache / shrine / event / boss intro)~~ ✅
8. **Glitch primitives + ambient connection-driven effects** ← next
9. Content pass — fill `data/` for the v1 vertical slice

## Architecture summary (post-step 7)

- **Reusable terminal primitive** — `src/ui/terminal.js` exports `showTerminalSequence(lines, options)`. Used by boot dial-up, boss intro, death/victory sequences, and CONN-drain alerts. **All terminal output anchors to the top-right** of the viewport so the player learns "this window = the BBS speaking". Themes: `normal | alarm | failure | glitch`. The selector `.modal.terminal-modal` outranks the base `.modal` for positioning.
- **Node interaction handlers** — `src/ui/nodes.js` exports `showShrine / showCache / showEvent / showShop / showBossIntro`. Game.js `resolveNode` dispatches by `node.type`. Each handler builds its own ctx via `makeContext` with `onTokenGain` and `onConnChange` callbacks.
- **Codex** — `src/engine/codex.js` persists in `localStorage.netromancer.codex` (separate from save slot). 5 categories: monsters / spells / wearables / consumables / statuses. Auto-marked: monsters on kill, spells on loadout entry, statuses on `applyStatus`, items on equip/identify (deferred until items have run-side mechanics).
- **CONN model** — single global stat. `setConn(v)` writes to `state.conn` + `--conn` CSS var. `drainConnection` atom is **silent** (caller narrates). Combat UI counts per-turn drain via `onConnChange` callback and fires a brief alarm-themed `showTerminalSequence` overlay after the turn completes.
- **Tokens** — `state.run.tokens`. Earned per encounter type: 50% chance of 1 on combat, `1d2` on elite, `4 + 1d4` on boss (silent on miss). Spent in shops.
- **Player loadout** — `{ spells: [], consumables: [] }`. Wearable slots (weapon/robe/amulet/ring/ring) deferred to step 9 alongside slot UI + stat-modifier piping.
- **Run state** — `state.run = { seed, map, currentNodeId, previousNodeId, visitedIds, player, tokens }`. Save on every node transition; suspend wipes on load.
- **WATCHDOG** monster (`mon_watchdog`) is in place as a test fixture for connection degradation. Drains 2% CONN per `logs a trace` action.

## Open TODOs

- Stats panel still shows static `CONN 100%` text — already removed; only conn-readout in title bar drives the visual.
- Decorative per-node ASCII art (atmospheric backgrounds for shrine/cache/boss intros) — deferred to step 9 polish or content pass.
- **Glitch primitives** — `triggerGlitch(type, intensity, target)` stub in `game.js` with planned types `scrambleText | tearLine | colorSwap | corruptBorders | flicker`. Mark glitchable text elements with `data-glitchable`. CSS var `--conn` is the input signal. Step 8 wires these to ambient effects and to specific events.
- Wearables (slots + stat modifiers) — deferred to step 9.
- Real boss content — currently 2× wraith placeholder.
