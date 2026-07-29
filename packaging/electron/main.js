/**
 * SwellDreams Electron shell (F5 target 1).
 * Owns the backend process end-to-end: spawns node backend/server.js, waits for :8889,
 * opens the app window, tray menu (Open / Restart backend / Quit), kills the child on quit.
 * This retires the start.sh/start.bat stale-backend problem class — the app owns the process.
 *
 * Dev run:    cd packaging/electron && npm install && npm start
 * Artifacts:  npm run dist   (electron-builder; win + linux targets in package.json)
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const APP_URL = 'http://127.0.0.1:8889';
const BOOT_TIMEOUT_MS = 90000; // device discovery on slow LANs can take a while

// Repo root: two levels up in dev; in a packaged app the backend ships in resources/backend.
const BACKEND_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.join(__dirname, '..', '..', 'backend');

let backend = null;
let win = null;
let tray = null;
let quitting = false;

function log(...a) { console.log('[Shell]', ...a); }

function startBackend() {
  log(`starting backend from ${BACKEND_DIR}`);
  backend = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, // electron binary doubles as node
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backend.on('exit', (code, sig) => {
    log(`backend exited (code=${code} sig=${sig})`);
    backend = null;
    if (!quitting) {
      // Unexpected death → surface it instead of leaving a dead window.
      dialog.showErrorBox('SwellDreams backend stopped',
        `The backend process exited unexpectedly (code ${code}). Use the tray menu to restart it.`);
    }
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!backend) return resolve();
    const child = backend;
    const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000);
    child.once('exit', () => { clearTimeout(killTimer); resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(killTimer); resolve(); }
  });
}

// Poll until the backend answers HTTP (it binds ONE port — 8889 — for HTTP and WS).
function waitForBackend(timeoutMs = BOOT_TIMEOUT_MS) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${APP_URL}/api/settings`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('backend boot timeout'));
      setTimeout(tick, 750);
    };
    tick();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'SwellDreams',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(APP_URL);
  // External links open in the system browser, not new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); } // close → tray, backend keeps running
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  // Falls back to Electron's default icon when no asset is present yet.
  try { tray = new Tray(path.join(__dirname, 'icon.png')); }
  catch (e) { return; }
  tray.setToolTip('SwellDreams');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open SwellDreams', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
    {
      label: 'Restart backend',
      click: async () => {
        await stopBackend();
        startBackend();
        try { await waitForBackend(); win?.reload(); }
        catch (e) { dialog.showErrorBox('SwellDreams', `Backend did not come back: ${e.message}`); }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // a second launch focuses the first instance instead of double-booting the backend
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  app.whenReady().then(async () => {
    createTray();
    startBackend();
    try {
      await waitForBackend();
    } catch (e) {
      dialog.showErrorBox('SwellDreams', `Backend failed to start: ${e.message}\nCheck the console log.`);
    }
    createWindow();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', async (e) => {
    if (backend) { e.preventDefault(); await stopBackend(); app.quit(); }
  });
  app.on('window-all-closed', () => { /* stay in tray */ });
  app.on('activate', () => { if (!win) createWindow(); else { win.show(); } });
}
