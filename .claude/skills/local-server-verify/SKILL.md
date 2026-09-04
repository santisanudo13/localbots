---
name: local-server-verify
description: How to reliably start localbots' dev server and drive it with Playwright to verify a UI change actually works, instead of only trusting node --check. Load this before claiming a frontend/backend change works.
---

# Verifying a localbots change in the real app

localbots has no test suite and no build step — the only way to confirm a
change actually works is to run the server and exercise it in a browser.
This skill exists because the naive way to do that (`nohup npm start &
disown`) is flaky in this sandboxed environment and wasted a lot of turns
across past sessions.

## Starting the server (the part that actually works)

Do **not** use `nohup ... & disown` — it repeatedly died or left orphaned
processes bound to port 4747 across past sessions (exit 144, `EADDRINUSE`).

Instead, use the Bash tool's own `run_in_background: true` option:

```bash
# check for a process already holding the port first
pgrep -f "node server/index.js" || true
```

If nothing is running:

```bash
npm start > /tmp/localbots.log 2>&1
```

with `run_in_background: true` on that Bash call. Then poll readiness with a
short, separate Bash call (not a long sleep in the same call):

```bash
sleep 2; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4747/
```

Expect `200`. If you get `000` or connection refused, `cat /tmp/localbots.log`
to see why (most common cause: a stale process already on 4747 — `pgrep -af
"node server/index.js"` then `pkill -f "node server/index.js"` before
retrying).

To stop it when you're done: `pkill -f "node server/index.js"` (this reliably
returns a non-zero/144-looking exit status even on success — that's normal,
not a failure signal).

## Driving it with Playwright

1. `mcp__playwright__browser_navigate` to `http://localhost:4747/`.
2. Paste a test character via `browser_evaluate`, setting `#profile`'s value
   and dispatching an `input` event so the app's own listeners pick it up:
   ```js
   () => {
     const profile = document.getElementById('profile');
     profile.value = `...`; // see references/sample-profile.txt for a ready one
     profile.dispatchEvent(new Event('input', { bubbles: true }));
   }
   ```
   `references/sample-profile.txt` in this skill is a real Arcane Mage
   `/simc` export (full gear, gems, enchants, a crafted item) — paste its
   contents verbatim rather than retyping a profile from scratch each time.
3. Switch tabs the same way the UI does: `document.querySelector('.tab[data-mode="droptimizer"]').click()`
   (other tab values: `quicksim`, `topgear`, `weights`).
4. Give the app a couple seconds to fetch `/api/droptimizer/sources` (game
   data may need to download on a fresh cache — check `#dropt-status`'s
   `textContent` if something looks empty; `"Downloading game data: ..."`
   means wait longer, not that something's broken).
5. Assert on real DOM state via `browser_evaluate` (checkbox `.checked`/
   `.disabled`, element `.outerHTML`, calling exported functions like
   `collectDroptSelection()` directly) rather than only screenshotting —
   screenshots are for visual/layout confirmation, DOM assertions are for
   correctness.

## When this applies

Any change to `public/app.js`, `public/index.html`, `public/style.css`, or
any `server/*.js` route/module that affects what the browser does. Skip it
only for changes with no runtime behavior (comments, docs, pure refactors
verified by `node --check` alone).
