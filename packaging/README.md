# Packaging (F5 — scaffold): Electron desktop + Capacitor Android

Decisions locked 2026-07-28 (see .claude/plans/full-remediation-2026-07-28.md):
- ONE packaging layer, TWO targets, same frontend + backend code.
- Hardware disconnect is the safety layer (per TOS) — software timer reliability is a QUALITY
  concern, engineered with foreground services, never a feature veto.
- No brand-dependency blockers: platforms that can't run the python Tapo bridge ship without
  Tapo-direct (HA route covers it; users can buy a different $15 plug).

## Target 1 — Electron (desktop, replaces start.sh/start.bat era) — AUTHORED 2026-07-29
`packaging/electron/` is implemented: main.js (spawns the backend with ELECTRON_RUN_AS_NODE,
polls :8889, BrowserWindow, tray Open/Restart-backend/Quit, single-instance lock, child killed
on quit, close-to-tray) + package.json (electron-builder: NSIS + AppImage; extraResources packs
backend/ and frontend/build so server.js's ../frontend/build path resolves in the package).

To run (needs a desktop session + npm install in packaging/electron — NOT yet run/tested here):
    cd packaging/electron && npm install && npm start
To build artifacts:  npm run dist
TODO before first release: icon.png asset, a smoke run on X11, userData-relative data dir
(packaged resources are read-only on some platforms — data/ should relocate to app.getPath('userData')).
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
