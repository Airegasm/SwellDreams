# Packaging (F5 — scaffold): Electron desktop + Capacitor Android

Decisions locked 2026-07-28 (see .claude/plans/full-remediation-2026-07-28.md):
- ONE packaging layer, TWO targets, same frontend + backend code.
- Hardware disconnect is the safety layer (per TOS) — software timer reliability is a QUALITY
  concern, engineered with foreground services, never a feature veto.
- No brand-dependency blockers: platforms that can't run the python Tapo bridge ship without
  Tapo-direct (HA route covers it; users can buy a different $15 plug).

## Target 1 — Electron (desktop, replaces start.sh/start.bat era)
- `packaging/electron/main.js`: spawn `node backend/server.js` (pipe logs), wait for :8889,
  open BrowserWindow at http://127.0.0.1:8889, tray icon (Open / Restart backend / Quit),
  kill child on quit. electron-builder for win/linux artifacts.
- Kills the stale-backend class of problems permanently (the app owns the process).
- Auto-update later via electron-updater.

## Target 2 — Capacitor (Android)
First-launch mode switch:
1. **Connect to host** (ships first): thin WebView onto a home server's URL; remembers host +
   optional access token (the opt-in token flow already works). Days of work.
2. **Standalone** (later): backend embedded via nodejs-mobile; FOREGROUND SERVICE + wake lock +
   exact alarms for reliable pump timers under doze; LLM remote either way; Tapo-direct excluded.

## Build order
1. Electron shell (the desktop win is immediate)
2. Capacitor connect-to-host APK
3. Standalone Android mode
