const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, nativeImage } = require('electron');
const QRCode = require('qrcode');
const { createRemoteServer } = require('../server');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let remoteServer = null;
let isQuitting = false;

let currentInfo = {
  running: false,
  localIp: '',
  port: 3000,
  pin: '',
  url: '',
  qrDataUrl: '',
  connectedClients: 0,
  logs: [],
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  const defaults = { pinMode: 'fixed', fixedPin: '4927' };
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      pinMode: parsed.pinMode === 'random' ? 'random' : 'fixed',
      fixedPin: /^\d{4}$/.test(parsed.fixedPin || '') ? parsed.fixedPin : '4927',
    };
  } catch {
    return defaults;
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function addLog(message) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  currentInfo.logs = [{ time, message }, ...currentInfo.logs].slice(0, 20);
  broadcastState();
}

function getFullState() {
  const cfg = loadConfig();
  const login = app.getLoginItemSettings();
  return {
    ...currentInfo,
    pinMode: cfg.pinMode,
    fixedPin: cfg.fixedPin,
    autoStart: Boolean(login.openAtLogin),
  };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', getFullState());
  }
}

async function startServer() {
  if (remoteServer) {
    await remoteServer.shutdown();
    remoteServer = null;
  }

  const cfg = loadConfig();
  const pinOption = cfg.pinMode === 'fixed' ? cfg.fixedPin : undefined;

  remoteServer = createRemoteServer({
    pin: pinOption,
    onShutdown: () => {
      if (!isQuitting) {
        isQuitting = true;
        app.quit();
      }
    },
  });

  const info = await remoteServer.start();
  const qrDataUrl = await QRCode.toDataURL(info.url, {
    width: 220,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });

  currentInfo = {
    ...currentInfo,
    running: true,
    localIp: info.localIp,
    port: info.port,
    pin: info.pin,
    url: info.url,
    qrDataUrl,
    connectedClients: 0,
  };

  remoteServer.io.on('connection', (socket) => {
    currentInfo.connectedClients = remoteServer.io.engine.clientsCount;
    addLog(`Phone connected (${socket.handshake.address})`);

    socket.on('disconnect', () => {
      if (remoteServer) {
        currentInfo.connectedClients = remoteServer.io.engine.clientsCount;
      }
      addLog('Phone disconnected');
    });
  });

  addLog(`Server started on ${info.localIp}:${info.port} (PIN ${info.pin})`);
  broadcastState();
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'public', 'icon-192.png');
  mainWindow = new BrowserWindow({
    width: 450,
    height: 740,
    resizable: false,
    maximizable: false,
    title: 'PC Media Remote',
    backgroundColor: '#09090b',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'icon-192.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('PC Media Remote');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show PC Media Remote',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Restart Server',
      click: () => startServer(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: async () => {
        isQuitting = true;
        if (remoteServer) await remoteServer.shutdown();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  createWindow();
  createTray();
  await startServer();
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (remoteServer) {
    await remoteServer.shutdown();
    remoteServer = null;
  }
});

ipcMain.handle('get-state', () => getFullState());

ipcMain.handle('save-pin-settings', async (_event, { pinMode, fixedPin }) => {
  const cleanMode = pinMode === 'random' ? 'random' : 'fixed';
  const cleanPin = /^\d{4}$/.test(fixedPin || '') ? fixedPin : '4927';
  saveConfig({ pinMode: cleanMode, fixedPin: cleanPin });
  await startServer();
  return getFullState();
});

ipcMain.handle('set-auto-start', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  broadcastState();
  return getFullState();
});

ipcMain.handle('restart-server', async () => {
  await startServer();
  return getFullState();
});

ipcMain.handle('copy-url', () => {
  if (currentInfo.url) {
    clipboard.writeText(currentInfo.url);
    return true;
  }
  return false;
});

ipcMain.on('hide-to-tray', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('quit-app', async () => {
  isQuitting = true;
  if (remoteServer) {
    await remoteServer.shutdown();
    remoteServer = null;
  }
  app.quit();
});
