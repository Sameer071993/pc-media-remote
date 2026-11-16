const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const qrcode = require('qrcode-terminal');

const { getLocalIPv4, listenOnAvailablePort } = require('./src/network');
const { MediaController } = require('./src/mediaController');

const PWA_EXEMPT_PATHS = new Set([
  '/manifest.json',
  '/sw.js',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
]);

/**
 * Constant-time PIN comparison.
 * @param {unknown} provided
 * @param {string} expected
 * @returns {boolean}
 */
function isValidPin(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Generate a random 4-digit numeric PIN (1000-9999).
 * @returns {string}
 */
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Create and configure the Express + Socket.io media remote server.
 * @param {{ pin?: string, port?: number, dryRun?: boolean, batteryIntervalMs?: number, onShutdown?: () => void }} [options]
 */
function createRemoteServer(options = {}) {
  const envPin = /^\d{4}$/.test(process.env.REMOTE_PIN || '') ? process.env.REMOTE_PIN : null;
  const pin = options.pin || envPin || generatePin();
  const startPort = options.port ?? (Number(process.env.PORT) || 3000);
  const batteryIntervalMs = options.batteryIntervalMs ?? 15000;
  const mediaController = new MediaController({ dryRun: options.dryRun });

  const app = express();
  app.disable('x-powered-by');

  // HTTP PIN guard:
  // - Exempt PWA assets (manifest.json, sw.js, icons, favicon) so installation works cleanly
  // - Allow bare GET / (Home Screen PWA launch without query) so the app can show the PIN entry modal
  // - Reject any request with an invalid ?pin= or unauthorized non-root HTTP route
  app.use((req, res, next) => {
    if (PWA_EXEMPT_PATHS.has(req.path)) {
      return next();
    }

    const provided = req.query.pin || req.get('x-remote-pin');
    const isBareRoot = req.path === '/' && req.method === 'GET' && provided === undefined;

    if (isBareRoot || isValidPin(provided, pin)) {
      return next();
    }

    console.warn(`[WARN] Rejected unauthorized HTTP ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).type('text/plain').send('Unauthorized: invalid or missing PIN');
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.use(express.static(path.join(__dirname, 'public')));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    serveClient: true,
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Reject any Socket.io connection without a valid 4-digit PIN
  io.use((socket, next) => {
    const provided = socket.handshake.auth?.pin ?? socket.handshake.query?.pin;
    if (!isValidPin(provided, pin)) {
      console.warn(`[WARN] Rejected unauthorized Socket.io connection from ${socket.handshake.address}`);
      return next(new Error('Unauthorized'));
    }
    return next();
  });

  // Sleep / Shutdown Timer State
  let sleepTimerInterval = null;
  let sleepRemainingSeconds = 0;
  let sleepAction = null;

  function getSleepTimerState() {
    return {
      active: sleepRemainingSeconds > 0 && sleepTimerInterval !== null,
      remainingSeconds: sleepRemainingSeconds,
      action: sleepAction,
    };
  }

  function clearSleepTimer() {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    sleepRemainingSeconds = 0;
    sleepAction = null;
    io.emit('sleep_timer_update', getSleepTimerState());
  }

  function startSleepTimer(minutes, action = 'sleep') {
    const allowedMinutes = new Set([15, 30, 45, 60]);
    if (minutes === 0) {
      clearSleepTimer();
      return { ok: true, ...getSleepTimerState() };
    }
    if (!allowedMinutes.has(minutes) || (action !== 'sleep' && action !== 'shutdown')) {
      return { ok: false, error: 'Invalid timer configuration' };
    }

    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
    }
    sleepRemainingSeconds = minutes * 60;
    sleepAction = action;
    io.emit('sleep_timer_update', getSleepTimerState());

    sleepTimerInterval = setInterval(() => {
      sleepRemainingSeconds -= 1;
      if (sleepRemainingSeconds <= 0) {
        const triggeredAction = sleepAction;
        clearSleepTimer();
        io.emit('sleep_timer_triggered', { action: triggeredAction });
        mediaController.executePowerAction(triggeredAction).catch((err) => {
          console.error(`[ERROR] Sleep timer action "${triggeredAction}" failed:`, err.message);
        });
      } else {
        io.emit('sleep_timer_update', getSleepTimerState());
      }
    }, 1000);

    return { ok: true, ...getSleepTimerState() };
  }

  // Live Battery Telemetry
  let latestBattery = { percent: null, charging: false, hasBattery: false };
  let batteryInterval = null;

  async function pollBattery() {
    try {
      latestBattery = await mediaController.getBatteryStatus();
      io.emit('battery_status', latestBattery);
    } catch {
      // Ignore transient battery read errors
    }
  }

  const shutdown = async () => {
    console.log('\n[INFO] Shutting down Laptop Media Remote...');
    if (batteryInterval) {
      clearInterval(batteryInterval);
      batteryInterval = null;
    }
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    io.emit('server_shutting_down');
    mediaController.dispose();
    io.close();
    await new Promise((resolve) => httpServer.close(() => resolve()));
    if (typeof options.onShutdown === 'function') {
      options.onShutdown();
    }
  };

  io.on('connection', (socket) => {
    console.log(`[INFO] Phone connected (${socket.id})`);

    // Send initial telemetry immediately
    socket.emit('battery_status', latestBattery);
    socket.emit('sleep_timer_update', getSleepTimerState());
    pollBattery();

    socket.on('media_command', async (payload, ack) => {
      const command = typeof payload === 'string' ? payload : payload?.command;
      const params = typeof payload === 'object' && payload !== null ? payload : {};

      if (!mediaController.isAllowed(command)) {
        console.warn(`[WARN] Dropped non-whitelisted command from ${socket.id}:`, command);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Command not allowed' });
        }
        return;
      }

      try {
        await mediaController.execute(command, params);
        if (typeof ack === 'function') {
          ack({ ok: true, command });
        }
      } catch (err) {
        console.error(`[ERROR] Failed to execute "${command}":`, err.message);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Execution failed' });
        }
      }
    });

    const handleCastUrl = async (payload, ack) => {
      const rawUrl = typeof payload === 'string' ? payload : payload?.url;
      try {
        const result = await mediaController.openUrl(rawUrl);
        if (!result.ok) {
          console.warn(`[WARN] Rejected invalid URL from ${socket.id}`);
          if (typeof ack === 'function') {
            ack({ ok: false, error: result.reason });
          }
          return;
        }
        console.log(`[INFO] Casting URL on laptop (${socket.id}): ${result.url}`);
        if (typeof ack === 'function') {
          ack({ ok: true, url: result.url });
        }
      } catch (err) {
        console.error('[ERROR] Failed to open URL:', err.message);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Failed to open URL' });
        }
      }
    };

    socket.on('cast_url', handleCastUrl);
    socket.on('open_url', handleCastUrl);

    socket.on('quick_launch', async (payload, ack) => {
      const appName = typeof payload === 'string' ? payload : payload?.app;
      try {
        const result = await mediaController.quickLaunch(appName);
        if (!result.ok) {
          console.warn(`[WARN] Rejected invalid quick_launch from ${socket.id}:`, appName);
          if (typeof ack === 'function') {
            ack({ ok: false, error: result.reason });
          }
          return;
        }
        console.log(`[INFO] Quick-launched ${appName} (${socket.id})`);
        if (typeof ack === 'function') {
          ack({ ok: true, app: appName, url: result.url });
        }
      } catch (err) {
        console.error('[ERROR] Quick launch failed:', err.message);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Quick launch failed' });
        }
      }
    });

    socket.on('sleep_timer', (payload, ack) => {
      const minutes = Number(payload?.minutes);
      const action = payload?.action || 'shutdown';
      const result = startSleepTimer(minutes, action);
      if (typeof ack === 'function') {
        ack(result);
      }
    });

    socket.on('power_action', async (payload, ack) => {
      const action = typeof payload === 'string' ? payload : payload?.action;
      if (action !== 'sleep' && action !== 'shutdown') {
        console.warn(`[WARN] Rejected invalid power_action from ${socket.id}:`, action);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Invalid power action' });
        }
        return;
      }
      console.log(`[INFO] Immediate power action "${action}" requested by ${socket.id}`);
      try {
        const result = await mediaController.executePowerAction(action);
        if (typeof ack === 'function') ack(result);
      } catch (err) {
        console.error(`[ERROR] Power action "${action}" failed:`, err.message);
        if (typeof ack === 'function') ack({ ok: false, error: 'Power action failed' });
      }
    });

    socket.on('shutdown_server', () => {
      console.log(`[INFO] Remote shutdown requested by ${socket.id}`);
      shutdown();
    });

    socket.on('disconnect', (reason) => {
      console.log(`[INFO] Phone disconnected (${socket.id}): ${reason}`);
    });
  });

  async function start() {
    mediaController.warmup();
    const boundPort = await listenOnAvailablePort(httpServer, startPort, '0.0.0.0');
    const localIp = getLocalIPv4();
    const url = `http://${localIp}:${boundPort}/?pin=${pin}`;

    await pollBattery();
    if (batteryIntervalMs > 0) {
      batteryInterval = setInterval(pollBattery, batteryIntervalMs);
    }

    return { port: boundPort, localIp, pin, url };
  }

  return {
    app,
    httpServer,
    io,
    pin,
    mediaController,
    start,
    shutdown,
  };
}

if (require.main === module) {
  const remote = createRemoteServer({
    onShutdown: () => process.exit(0),
  });

  remote
    .start()
    .then(({ port, localIp, pin, url }) => {
      console.log('==================================================');
      console.log('  PC Media Remote Server Running');
      console.log('==================================================');
      console.log(`  Local IP : ${localIp}`);
      console.log(`  Port     : ${port}`);
      console.log(`  URL      : ${url}`);
      console.log('--------------------------------------------------');
      console.log(`  >>>  SESSION PIN :  [  ${pin.split('').join(' ')}  ]  <<<`);
      console.log('--------------------------------------------------');
      console.log('  Scan this QR code with your phone camera:');
      console.log('');
      qrcode.generate(url, { small: true });
      console.log('==================================================');
      console.log('  Press Ctrl+C or tap "Shutdown Server" on phone.');
    })
    .catch((err) => {
      console.error('[FATAL] Could not start server:', err);
      process.exit(1);
    });

  process.on('SIGINT', () => {
    remote.shutdown().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    remote.shutdown().then(() => process.exit(0));
  });
}

module.exports = {
  createRemoteServer,
  isValidPin,
  generatePin,
};
