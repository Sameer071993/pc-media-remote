# PC Media Remote

Control your **Windows** or **macOS** laptop from your smartphone over local Wi-Fi—with media playback, volume & brightness controls, a multi-touch trackpad, URL casting, two-way Wi-Fi file sharing, and PC power controls. Secured by a 4-digit PIN and QR code with zero cloud or internet required.

## Features

- **4-Digit PIN & QR Code:** Auto-detects your LAN IP and advertises `http://pcremote.local:3000` (mDNS) so your phone shortcut keeps working even if your router changes your laptop's IP.
- **Media Tab:** Play/Pause, Next/Prev, Rewind `-10s` / Fast-Forward `+10s`, Volume Up/Down/Mute, Fullscreen (`F`), and Screen Brightness `-/+`.
- **Touchpad & Cast Tab:** 1-finger cursor movement, tap-to-click, 2-finger vertical scroll, Left/Right Click, `Alt+Tab` / `Cmd+Tab`, Close Tab, URL casting (`http://`/`https://`), and Quick Launchers (YouTube, Netflix, Sonora).
- **Files Tab (Two-Way Wi-Fi Transfer):** Send files from your phone to your PC (`D:\PC-remote-files` on Windows if `D:` exists, otherwise `~/Downloads/PC-remote-files`) or drag-and-drop files on your PC to download on your phone.
- **Power Tab:** Screen Off, Lock PC, Shutdown Timer (`15m`, `30m`, `45m`, `60m`, `Cancel`), Restart PC, Shutdown PC, and Shutdown Server.
- **Desktop System Tray App:** Clean 2-column glassmorphic UI with Fixed/Random PIN toggle, **Start automatically at login**, and live activity log.

---

## Download & Install (Windows & macOS)

Download the latest installer for your OS from **[Releases](https://github.com/Sameer071993/pc-media-remote/releases/latest)**:

### Windows
1. Download **`PC.Media.Remote.Setup.1.0.0.exe`** (Installer) or **`PC.Media.Remote.1.0.0.exe`** (Portable).
2. If **Windows SmartScreen** appears (*"Windows protected your PC"*), click **More info → Run anyway**.
3. The Setup installer automatically adds a **Private networks** Windows Defender Firewall rule for `PC Media Remote.exe` (and removes it on uninstall).
   - *(If using the portable `.exe`, check **Private networks** only when Windows Firewall prompts and click **Allow access**.)*

### macOS
1. Download the `.dmg` matching your Mac (**Apple menu  → About This Mac**):
   - **Apple Silicon (M1 / M2 / M3 / M4):** `PC.Media.Remote-1.0.0-arm64.dmg`
   - **Intel Mac:** `PC.Media.Remote-1.0.0.dmg`
2. Open the `.dmg` and drag **PC Media Remote** into **Applications**.
3. **First Launch (Unsigned App):**
   - Open **Applications** in **Finder**, **Right-click** (or `Control + Click`) **PC Media Remote** → click **Open** → **Open**.
   - *(On newer macOS versions, if blocked, go to **System Settings → Privacy & Security** and click **Open Anyway**.)*
4. **Permissions:**
   - **Local Network / Firewall:** Click **Allow** if macOS asks to allow incoming network connections.
   - **Accessibility (required for media keys & touchpad):** Go to **System Settings → Privacy & Security → Accessibility** and turn **ON** **PC Media Remote**.

---

## Connecting Your Phone

1. Ensure your laptop and smartphone are on the **same Wi-Fi network**.
2. Open **PC Media Remote** on your laptop.
3. Scan the QR code with your phone (or open `http://pcremote.local:3000/?pin=4927` in **Chrome** / **Safari**).
4. **Save as a Home Screen Shortcut:**
   - **Android Chrome:** If opened inside a QR scanner's built-in browser, tap **⋮ → Open in Chrome** first, then tap **⋮ → Add to Home screen**.
   - **iOS Safari:** Tap **Share** → **Add to Home Screen**.

---

## Running From Source (Developers)

```bash
git clone https://github.com/Sameer071993/pc-media-remote.git
cd pc-media-remote
npm install
npm start            # Run terminal server
npm run electron     # Run desktop Electron UI
npm test             # Run automated verification suite
npm run build:protected  # Build bytenode-protected desktop installer
```

---

## Troubleshooting

- **Phone cannot connect / page times out:**
  - Verify both devices are on the same Wi-Fi SSID (not Guest Wi-Fi or mobile data).
  - Many mobile hotspots, hotel/university networks, and Guest Wi-Fi networks enable **AP Isolation (Client Isolation)**, which blocks device-to-device connections. Use your home Wi-Fi or disable AP Isolation in router settings.
  - On Windows, verify `PC Media Remote.exe` (or `node`) is allowed on **Private networks** in **Windows Security → Firewall & network protection → Allow an app through firewall**.
- **Media/Touchpad controls don't respond on macOS:**
  - Confirm **PC Media Remote** is enabled in **System Settings → Privacy & Security → Accessibility**.
