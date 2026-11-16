const os = require('os');

const VIRTUAL_IFACE_PATTERN = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|tailscale|zerotier|loopback/i;

function isPrivateLanIPv4(ip) {
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true;
  const parts = ip.split('.').map(Number);
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

/**
 * Detect the laptop's best local IPv4 address for Wi-Fi LAN access.
 * @returns {string}
 */
function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;

      let score = 0;
      if (isPrivateLanIPv4(addr.address)) score += 10;
      if (addr.address.startsWith('192.168.')) score += 5;
      if (/wi-?fi|wlan|wireless/i.test(name)) score += 5;
      if (VIRTUAL_IFACE_PATTERN.test(name)) score -= 20;

      candidates.push({ address: addr.address, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].address : '127.0.0.1';
}

/**
 * Bind an HTTP server to host:startPort, automatically incrementing on EADDRINUSE.
 * @param {import('http').Server} server
 * @param {number} [startPort=3000]
 * @param {string} [host='0.0.0.0']
 * @param {number} [maxAttempts=50]
 * @returns {Promise<number>} The bound port
 */
function listenOnAvailablePort(server, startPort = 3000, host = '0.0.0.0', maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
        attempts += 1;
        port += 1;
        server.listen(port, host);
      } else {
        server.removeListener('listening', onListening);
        reject(err);
      }
    };

    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    };

    server.on('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

module.exports = {
  getLocalIPv4,
  listenOnAvailablePort,
};
