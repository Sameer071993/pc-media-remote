const assert = require('assert');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { createRemoteServer } = require('../server');
const { ALLOWED_COMMANDS } = require('../src/mediaController');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      })
      .on('error', reject);
  });
}

function connectSocket(url, authPin) {
  return new Promise((resolve, reject) => {
    const client = ioClient(url, {
      auth: authPin !== undefined ? { pin: authPin } : {},
      reconnection: false,
      timeout: 3000,
    });

    client.once('connect', () => resolve({ connected: true, client }));
    client.once('connect_error', (err) => {
      client.close();
      resolve({ connected: false, error: err.message });
    });
    setTimeout(() => {
      client.close();
      reject(new Error('Socket connection timed out'));
    }, 4000);
  });
}

function emitWithAck(client, event, payload) {
  return new Promise((resolve) => {
    client.emit(event, payload, (ack) => {
      resolve(ack);
    });
  });
}

async function runTests() {
  const remote = createRemoteServer({ port: 0, dryRun: true, batteryIntervalMs: 0 });
  const { port, pin } = await remote.start();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. 4-digit PIN format check
    assert.match(pin, /^\d{4}$/, 'PIN must be a 4-digit numeric string');
    console.log('✓ Generated 4-digit numeric PIN:', pin);

    // 2. PWA assets exempt from PIN auth
    for (const pwaPath of ['/manifest.json', '/sw.js', '/icon-192.png', '/icon-512.png']) {
      const res = await httpGet(`${baseUrl}${pwaPath}`);
      assert.strictEqual(res.statusCode, 200, `${pwaPath} must return 200 without PIN`);
    }
    console.log('✓ PWA assets (manifest.json, sw.js, icons) return HTTP 200 without PIN');

    // 3. Unauthorized HTTP requests rejected; bare / and valid ?pin= allowed
    const badPinRes = await httpGet(`${baseUrl}/?pin=0000`);
    assert.strictEqual(badPinRes.statusCode, 401, 'Wrong ?pin= must return 401');

    const unauthRouteRes = await httpGet(`${baseUrl}/unauthorized-route`);
    assert.strictEqual(unauthRouteRes.statusCode, 401, 'Non-root route without PIN must return 401');

    const bareRootRes = await httpGet(`${baseUrl}/`);
    assert.strictEqual(bareRootRes.statusCode, 200, 'Bare GET / for PWA Home Screen launch must return 200');
    assert.ok(bareRootRes.body.includes('pinModal'), 'HTML must include PIN modal');

    const okRes = await httpGet(`${baseUrl}/?pin=${pin}`);
    assert.strictEqual(okRes.statusCode, 200, 'GET /?pin=<valid> must return 200');
    console.log('✓ HTTP PIN guard and PWA Home Screen shell verified');

    // 4. Unauthorized Socket.io connections rejected
    const noAuthSocket = await connectSocket(baseUrl, undefined);
    assert.strictEqual(noAuthSocket.connected, false, 'Socket without PIN must be rejected');
    assert.strictEqual(noAuthSocket.error, 'Unauthorized');

    const badAuthSocket = await connectSocket(baseUrl, '0000');
    assert.strictEqual(badAuthSocket.connected, false, 'Socket with wrong PIN must be rejected');
    assert.strictEqual(badAuthSocket.error, 'Unauthorized');
    console.log('✓ Unauthorized Socket.io connections rejected');

    // 5. Authorized Socket.io connection + initial telemetry
    const batteryPromise = new Promise((resolve) => {
      const checkClient = ioClient(baseUrl, { auth: { pin }, reconnection: false });
      checkClient.once('battery_status', (data) => {
        checkClient.close();
        resolve(data);
      });
    });
    const batteryData = await batteryPromise;
    assert.strictEqual(typeof batteryData.hasBattery, 'boolean');
    console.log('✓ Live battery telemetry emitted on connect:', batteryData);

    const validSocket = await connectSocket(baseUrl, pin);
    assert.strictEqual(validSocket.connected, true, 'Socket with valid PIN must connect');
    console.log('✓ Authorized Socket.io connection accepted');

    // 6. All whitelisted commands succeed (media + touchpad + power/display)
    for (const cmd of ALLOWED_COMMANDS) {
      const payload =
        cmd === 'mouse_move'
          ? { command: cmd, dx: 12, dy: -8 }
          : cmd === 'scroll'
            ? { command: cmd, dy: 2 }
            : { command: cmd };
      const ack = await emitWithAck(validSocket.client, 'media_command', payload);
      assert.deepStrictEqual(ack, { ok: true, command: cmd }, `Command ${cmd} should succeed`);
    }
    console.log(`✓ All ${ALLOWED_COMMANDS.length} whitelisted commands executed cleanly`);

    // 7. Non-whitelisted payloads dropped
    const badCmdAck = await emitWithAck(validSocket.client, 'media_command', { command: 'arbitrary_keystroke' });
    assert.deepStrictEqual(badCmdAck, { ok: false, error: 'Command not allowed' });
    console.log('✓ Non-whitelisted payloads dropped');

    // 8. URL casting & quick launchers
    const validUrlAck = await emitWithAck(validSocket.client, 'cast_url', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    assert.deepStrictEqual(validUrlAck, { ok: true, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

    const fileUrlAck = await emitWithAck(validSocket.client, 'cast_url', {
      url: 'file:///C:/Windows/System32/calc.exe',
    });
    assert.deepStrictEqual(fileUrlAck, { ok: false, error: 'Only http/https URLs are allowed' });

    for (const app of ['youtube', 'netflix', 'sonora']) {
      const launchAck = await emitWithAck(validSocket.client, 'quick_launch', { app });
      assert.strictEqual(launchAck.ok, true, `Quick launch ${app} should succeed`);
    }
    console.log('✓ URL casting & quick launchers (YouTube, Netflix, Sonora) verified');

    // 9. Sleep timer start & cancel
    const startTimerAck = await emitWithAck(validSocket.client, 'sleep_timer', {
      minutes: 15,
      action: 'sleep',
    });
    assert.strictEqual(startTimerAck.active, true);
    assert.strictEqual(startTimerAck.remainingSeconds, 900);
    assert.strictEqual(startTimerAck.action, 'sleep');

    const cancelTimerAck = await emitWithAck(validSocket.client, 'sleep_timer', { minutes: 0 });
    assert.strictEqual(cancelTimerAck.active, false);
    assert.strictEqual(cancelTimerAck.remainingSeconds, 0);
    console.log('✓ Sleep timer start & cancel verified');

    // 10. Immediate power_action validation
    const sleepNowAck = await emitWithAck(validSocket.client, 'power_action', { action: 'sleep' });
    assert.deepStrictEqual(sleepNowAck, { ok: true, action: 'sleep' });
    const shutdownNowAck = await emitWithAck(validSocket.client, 'power_action', { action: 'shutdown' });
    assert.deepStrictEqual(shutdownNowAck, { ok: true, action: 'shutdown' });
    const badPowerAck = await emitWithAck(validSocket.client, 'power_action', { action: 'format_c' });
    assert.deepStrictEqual(badPowerAck, { ok: false, error: 'Invalid power action' });
    console.log('✓ Immediate power_action (sleep/shutdown) & validation verified');

    // 11. Fixed REMOTE_PIN env var check
    process.env.REMOTE_PIN = '4927';
    const fixedRemote = createRemoteServer({ port: 0, dryRun: true, batteryIntervalMs: 0 });
    assert.strictEqual(fixedRemote.pin, '4927', 'Server must use valid 4-digit REMOTE_PIN env var');
    delete process.env.REMOTE_PIN;
    console.log('✓ Fixed REMOTE_PIN environment variable verified');

    validSocket.client.close();
    console.log('\nAll verification checks passed!');
  } finally {
    await remote.shutdown();
  }
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
