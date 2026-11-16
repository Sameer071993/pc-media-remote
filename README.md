# PC Media Remote

A secure, ultra-lightweight local Wi-Fi media remote for controlling YouTube, Netflix, VLC, and Spotify on your laptop from your smartphone.

## Features

- **Zero-Config LAN Discovery & QR Code:** Automatically detects your laptop's local IPv4 address, binds to `0.0.0.0:3000` (or the next free port), and renders a scannable ASCII QR code in the terminal.
- **Per-Session Security Token:** Generates a random 6-character token on every startup and rejects any HTTP or Socket.io connection without it.
- **Strict Command Whitelist:** Only accepts `play_pause`, `next`, `prev`, `seek_forward`, `seek_backward`, `vol_up`, `vol_down`, `mute`, and `fullscreen`. Unknown payloads are dropped.
- **Background OS Media Keys:** Uses native Windows `user32.dll` virtual key codes (`0xB3`, `0xAF`, `0xAE`, `0xAD`, `0xB0`, `0xB1`) via a single lightweight PowerShell worker (and `osascript` on macOS) so Play/Pause and Volume work even when your browser or VLC is minimized.
- **OLED Dark-Mode Mobile UI:** Single-screen, thumb-friendly web app with haptic feedback, disabled pinch-zoom/pull-to-refresh, live connection pill, and a remote **Shutdown Server** button.

## Quick Start

```bash
npm install
npm start
```

1. Run `npm start` on your laptop.
2. Scan the QR code printed in the terminal with your phone's camera (make sure your phone is on the **same Wi-Fi network**).
3. Tap the link to open the remote in your mobile browser.

## Firewall Setup (Private Networks Only)

For security, allow Node.js **only on Private Networks**—never on Public Networks (cafés, airports, hotels).

### Windows (Windows Defender Firewall)
1. When you run `npm start` for the first time, Windows may show a **Windows Security Alert** for `Node.js JavaScript Runtime`.
2. Check **Private networks, such as my home or work network**.
3. **Uncheck** *Public networks*.
4. Click **Allow access**.
5. If you dismissed the prompt earlier:
   - Open **Windows Security → Firewall & network protection → Allow an app through firewall**.
   - Click **Change settings**, find **Node.js JavaScript Runtime**, check **Private** only, and click **OK**.

### macOS (Application Firewall)
1. Open **System Settings → Network → Firewall**.
2. If Firewall is enabled, click **Options...**.
3. Ensure `node` is set to **Allow incoming connections** when on your trusted home/private Wi-Fi.

## Troubleshooting

### Phone cannot connect / page times out
- **Same Wi-Fi Check:** Confirm both your laptop and phone are connected to the same Wi-Fi SSID (not Guest Wi-Fi or mobile data).
- **Hotspot / Router AP Isolation:** Many mobile hotspots, hotel/university networks, and "Guest" Wi-Fi networks enable **AP Isolation (Client Isolation)**, which blocks devices on the same Wi-Fi from talking to each other.
  - **Fix:** Use your main home Wi-Fi network, disable **AP Isolation / Client Isolation** in your router settings, or if using a Windows Mobile Hotspot, ensure you are not on a Guest/isolated subnet.
- **Wrong Network Adapter IP:** If your laptop has VPN, WSL, or virtual machine adapters, verify the printed IP matches your Wi-Fi adapter (`ipconfig` on Windows, `ifconfig` on macOS).

### Seek or Fullscreen does not respond
- Hardware media keys (`Play/Pause`, `Next`, `Prev`, `Volume`, `Mute`) work globally even when minimized.
- `Seek (-10s / +10s)` and `Fullscreen (F)` send Arrow/F keys to the **currently focused** window, so make sure YouTube, Netflix, or VLC is the active window.
