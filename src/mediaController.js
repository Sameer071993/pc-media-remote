const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOWED_COMMANDS = Object.freeze([
  'play_pause',
  'next',
  'prev',
  'seek_forward',
  'seek_backward',
  'vol_up',
  'vol_down',
  'mute',
  'fullscreen',
  'mouse_move',
  'left_click',
  'right_click',
  'scroll',
  'alt_tab',
  'close_tab',
  'brightness_up',
  'brightness_down',
  'screen_off',
  'lock_pc',
]);

const COMMAND_SET = new Set(ALLOWED_COMMANDS);

const QUICK_LAUNCH_URLS = Object.freeze({
  youtube: 'https://www.youtube.com',
  netflix: 'https://www.netflix.com',
  sonora: 'https://arcadehubplay.com/',
});

// Windows Virtual-Key codes and extended-key flags
const WIN_VK_MAP = Object.freeze({
  play_pause: { vk: 0xB3, extended: true },    // VK_MEDIA_PLAY_PAUSE
  next: { vk: 0xB0, extended: true },          // VK_MEDIA_NEXT_TRACK
  prev: { vk: 0xB1, extended: true },          // VK_MEDIA_PREV_TRACK
  vol_up: { vk: 0xAF, extended: true },        // VK_VOLUME_UP
  vol_down: { vk: 0xAE, extended: true },      // VK_VOLUME_DOWN
  mute: { vk: 0xAD, extended: true },          // VK_VOLUME_MUTE
  seek_forward: { vk: 0x27, extended: true },  // VK_RIGHT
  seek_backward: { vk: 0x25, extended: true }, // VK_LEFT
  fullscreen: { vk: 0x46, extended: false },   // 'F' key
});

// macOS osascript equivalents
const MAC_SCRIPT_MAP = Object.freeze({
  play_pause: 'tell application "System Events" to key code 49',
  next: 'tell application "System Events" to key code 124 using {command down}',
  prev: 'tell application "System Events" to key code 123 using {command down}',
  seek_forward: 'tell application "System Events" to key code 124',
  seek_backward: 'tell application "System Events" to key code 123',
  vol_up: 'set volume output volume ((output volume of (get volume settings)) + 6)',
  vol_down: 'set volume output volume ((output volume of (get volume settings)) - 6)',
  mute: 'set volume output muted (not (output muted of (get volume settings)))',
  fullscreen: 'tell application "System Events" to keystroke "f"',
  alt_tab: 'tell application "System Events" to key code 48 using {command down}',
  close_tab: 'tell application "System Events" to keystroke "w" using {command down}',
  brightness_up: 'tell application "System Events" to key code 144',
  brightness_down: 'tell application "System Events" to key code 145',
  screen_off: 'do shell script "pmset displaysleepnow"',
  lock_pc: 'do shell script "pmset displaysleepnow"',
});

// Linux xdotool fallback
const LINUX_KEY_MAP = Object.freeze({
  play_pause: 'XF86AudioPlay',
  next: 'XF86AudioNext',
  prev: 'XF86AudioPrev',
  vol_up: 'XF86AudioRaiseVolume',
  vol_down: 'XF86AudioLowerVolume',
  mute: 'XF86AudioMute',
  seek_forward: 'Right',
  seek_backward: 'Left',
  fullscreen: 'f',
  alt_tab: 'alt+Tab',
  close_tab: 'ctrl+w',
  brightness_up: 'XF86MonBrightnessUp',
  brightness_down: 'XF86MonBrightnessDown',
});

function clampInt(val, min, max) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

class MediaController {
  /**
   * @param {{ dryRun?: boolean }} [options]
   */
  constructor(options = {}) {
    this.dryRun = Boolean(options.dryRun || process.env.REMOTE_DRY_RUN === '1');
    this.platform = process.platform;
    this.psProcess = null;
    this.psReady = false;
  }

  /**
   * Strict whitelist check to prevent arbitrary keystroke injection.
   * @param {unknown} command
   * @returns {boolean}
   */
  isAllowed(command) {
    return typeof command === 'string' && COMMAND_SET.has(command);
  }

  /**
   * Pre-warm the OS media worker so the first button tap is instant.
   */
  warmup() {
    if (!this.dryRun && this.platform === 'win32') {
      this._ensureWindowsWorker();
    }
  }

  /**
   * Initialize persistent PowerShell user32 helper on Windows for <10ms latency and minimal CPU/RAM.
   */
  _ensureWindowsWorker() {
    if (this.psProcess && !this.psProcess.killed) {
      return this.psProcess;
    }

    const psScript = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class InputHelper {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool LockWorkStation();

  public static void Tap(byte vk, bool extended) {
    byte scan = (byte)MapVirtualKey(vk, 0);
    uint downFlag = extended ? 1u : 0u;
    uint upFlag = extended ? 3u : 2u;
    keybd_event(vk, scan, downFlag, UIntPtr.Zero);
    keybd_event(vk, scan, upFlag, UIntPtr.Zero);
  }

  public static void Combo(byte modVk, byte keyVk) {
    keybd_event(modVk, (byte)MapVirtualKey(modVk, 0), 0, UIntPtr.Zero);
    keybd_event(keyVk, (byte)MapVirtualKey(keyVk, 0), 0, UIntPtr.Zero);
    keybd_event(keyVk, (byte)MapVirtualKey(keyVk, 0), 2, UIntPtr.Zero);
    keybd_event(modVk, (byte)MapVirtualKey(modVk, 0), 2, UIntPtr.Zero);
  }

  public static void MoveMouse(int dx, int dy) {
    POINT p;
    if (GetCursorPos(out p)) {
      SetCursorPos(p.X + dx, p.Y + dy);
    }
  }

  public static void LeftClick() {
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }

  public static void RightClick() {
    mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Scroll(int dy) {
    mouse_event(0x0800, 0, 0, dy * 120, UIntPtr.Zero);
  }

  public static void ScreenOff() {
    SendMessage((IntPtr)0xFFFF, 0x0112, (IntPtr)0xF170, (IntPtr)2);
  }
}
"@

function Set-RelativeBrightness([int]$delta) {
  try {
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
    if ($b -and $m) {
      $next = [Math]::Max(0, [Math]::Min(100, [int]$b.CurrentBrightness + $delta))
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$next } | Out-Null
    }
  } catch {}
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(',')
  switch ($p[0]) {
    'TAP'   { [InputHelper]::Tap([byte]$p[1], [bool]::Parse($p[2])) }
    'COMBO' { [InputHelper]::Combo([byte]$p[1], [byte]$p[2]) }
    'MOVE'  { [InputHelper]::MoveMouse([int]$p[1], [int]$p[2]) }
    'LCLK'  { [InputHelper]::LeftClick() }
    'RCLK'  { [InputHelper]::RightClick() }
    'SCRL'  { [InputHelper]::Scroll([int]$p[1]) }
    'SOFF'  { [InputHelper]::ScreenOff() }
    'LOCK'  { [InputHelper]::LockWorkStation() | Out-Null }
    'BRIT'  { Set-RelativeBrightness ([int]$p[1]) }
  }
}
`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

    this.psProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }
    );

    this.psProcess.stderr.on('data', (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) {
        console.error(`[MediaController] PowerShell stderr: ${msg}`);
      }
    });

    this.psProcess.on('exit', () => {
      this.psProcess = null;
      this.psReady = false;
    });

    this.psReady = true;
    return this.psProcess;
  }

  /**
   * Execute a whitelisted media, touchpad, or power/display command.
   * @param {string} command
   * @param {{ dx?: number, dy?: number }} [params]
   * @returns {Promise<{ ok: boolean, command?: string, reason?: string }>}
   */
  async execute(command, params = {}) {
    if (!this.isAllowed(command)) {
      return { ok: false, reason: 'Command not in whitelist' };
    }

    if (this.dryRun) {
      return { ok: true, command };
    }

    if (this.platform === 'win32') {
      const ps = this._ensureWindowsWorker();
      if (WIN_VK_MAP[command]) {
        const { vk, extended } = WIN_VK_MAP[command];
        ps.stdin.write(`TAP,${vk},${extended}\n`);
      } else if (command === 'mouse_move') {
        const dx = clampInt(params.dx, -500, 500);
        const dy = clampInt(params.dy, -500, 500);
        if (dx !== 0 || dy !== 0) ps.stdin.write(`MOVE,${dx},${dy}\n`);
      } else if (command === 'left_click') {
        ps.stdin.write('LCLK\n');
      } else if (command === 'right_click') {
        ps.stdin.write('RCLK\n');
      } else if (command === 'scroll') {
        const dy = clampInt(params.dy, -20, 20);
        if (dy !== 0) ps.stdin.write(`SCRL,${dy}\n`);
      } else if (command === 'alt_tab') {
        ps.stdin.write(`COMBO,${0x12},${0x09}\n`);
      } else if (command === 'close_tab') {
        ps.stdin.write(`COMBO,${0x11},${0x57}\n`);
      } else if (command === 'brightness_up') {
        ps.stdin.write('BRIT,10\n');
      } else if (command === 'brightness_down') {
        ps.stdin.write('BRIT,-10\n');
      } else if (command === 'screen_off') {
        ps.stdin.write('SOFF\n');
      } else if (command === 'lock_pc') {
        ps.stdin.write('LOCK\n');
      }
      return { ok: true, command };
    }

    if (this.platform === 'darwin') {
      if (command === 'mouse_move' || command === 'left_click' || command === 'right_click' || command === 'scroll') {
        const dx = clampInt(params.dx, -500, 500);
        const dy = clampInt(params.dy, -500, 500);
        const jxaLines = [
          'ObjC.import("CoreGraphics");',
          'var ev = $.CGEventCreate(null);',
          'var pos = $.CGEventGetLocation(ev);',
        ];
        if (command === 'mouse_move') {
          jxaLines.push(
            `var target = { x: Math.max(0, pos.x + (${dx})), y: Math.max(0, pos.y + (${dy})) };`,
            'var mv = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, target, $.kCGMouseButtonLeft);',
            '$.CGEventPost($.kCGHIDEventTap, mv);'
          );
        } else if (command === 'left_click') {
          jxaLines.push(
            'var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pos, $.kCGMouseButtonLeft);',
            'var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, pos, $.kCGMouseButtonLeft);',
            '$.CGEventPost($.kCGHIDEventTap, down);',
            '$.CGEventPost($.kCGHIDEventTap, up);'
          );
        } else if (command === 'right_click') {
          jxaLines.push(
            'var down = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseDown, pos, $.kCGMouseButtonRight);',
            'var up = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseUp, pos, $.kCGMouseButtonRight);',
            '$.CGEventPost($.kCGHIDEventTap, down);',
            '$.CGEventPost($.kCGHIDEventTap, up);'
          );
        } else if (command === 'scroll') {
          const sdy = clampInt(params.dy, -20, 20);
          jxaLines.push(
            `var sc = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 1, ${sdy});`,
            '$.CGEventPost($.kCGHIDEventTap, sc);'
          );
        }
        return new Promise((resolve, reject) => {
          execFile('osascript', ['-l', 'JavaScript', '-e', jxaLines.join('\n')], (err) => {
            if (err) return reject(err);
            resolve({ ok: true, command });
          });
        });
      }

      const script = MAC_SCRIPT_MAP[command];
      if (!script) return { ok: true, command };
      return new Promise((resolve, reject) => {
        execFile('osascript', ['-e', script], (err) => {
          if (err) return reject(err);
          resolve({ ok: true, command });
        });
      });
    }

    const key = LINUX_KEY_MAP[command];
    if (!key) return { ok: true, command };
    return new Promise((resolve, reject) => {
      execFile('xdotool', ['key', key], (err) => {
        if (err) return reject(err);
        resolve({ ok: true, command });
      });
    });
  }

  /**
   * Validate that a URL uses http: or https: and is within a safe length.
   * @param {unknown} rawUrl
   * @returns {string | null} Normalized URL string or null if invalid
   */
  validateHttpUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.length > 2048) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  }

  /**
   * Safely open an http/https URL in the laptop's default browser without shell interpolation.
   * @param {unknown} rawUrl
   * @returns {Promise<{ ok: boolean, url?: string, reason?: string }>}
   */
  async openUrl(rawUrl) {
    const safeUrl = this.validateHttpUrl(rawUrl);
    if (!safeUrl) {
      return { ok: false, reason: 'Only http/https URLs are allowed' };
    }

    if (this.dryRun) {
      return { ok: true, url: safeUrl };
    }

    return new Promise((resolve, reject) => {
      if (this.platform === 'win32') {
        execFile('rundll32.exe', ['url.dll,FileProtocolHandler', safeUrl], (err) => {
          if (err) return reject(err);
          resolve({ ok: true, url: safeUrl });
        });
      } else if (this.platform === 'darwin') {
        execFile('open', [safeUrl], (err) => {
          if (err) return reject(err);
          resolve({ ok: true, url: safeUrl });
        });
      } else {
        execFile('xdg-open', [safeUrl], (err) => {
          if (err) return reject(err);
          resolve({ ok: true, url: safeUrl });
        });
      }
    });
  }

  /**
   * Execute a quick-launch preset (youtube, netflix, spotify).
   * @param {string} appName
   */
  async quickLaunch(appName) {
    const target = QUICK_LAUNCH_URLS[appName];
    if (!target) {
      return { ok: false, reason: 'Unknown launcher' };
    }
    return this.openUrl(target);
  }

  /**
   * Put the laptop to sleep, restart it, or shut it down.
   * @param {'sleep' | 'shutdown' | 'restart'} action
   */
  async executePowerAction(action) {
    if (action !== 'sleep' && action !== 'shutdown' && action !== 'restart') {
      return { ok: false, reason: 'Invalid power action' };
    }
    if (this.dryRun) {
      return { ok: true, action };
    }

    return new Promise((resolve, reject) => {
      if (this.platform === 'win32') {
        if (action === 'sleep') {
          execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], (err) =>
            err ? reject(err) : resolve({ ok: true, action })
          );
        } else {
          const flag = action === 'restart' ? '/r' : '/s';
          execFile('shutdown.exe', [flag, '/t', '0'], (err) =>
            err ? reject(err) : resolve({ ok: true, action })
          );
        }
      } else if (this.platform === 'darwin') {
        if (action === 'sleep') {
          execFile('pmset', ['sleepnow'], (err) =>
            err ? reject(err) : resolve({ ok: true, action })
          );
        } else {
          const cmd = action === 'restart' ? 'restart' : 'shut down';
          execFile('osascript', ['-e', `tell app "System Events" to ${cmd}`], (err) =>
            err ? reject(err) : resolve({ ok: true, action })
          );
        }
      } else {
        const unit = action === 'sleep' ? 'suspend' : action === 'restart' ? 'reboot' : 'poweroff';
        execFile('systemctl', [unit], (err) =>
          err ? reject(err) : resolve({ ok: true, action })
        );
      }
    });
  }

  /**
   * Read the laptop's current battery percentage and charging status.
   * @returns {Promise<{ percent: number | null, charging: boolean, hasBattery: boolean }>}
   */
  getBatteryStatus() {
    if (this.dryRun) {
      return Promise.resolve({ percent: 85, charging: true, hasBattery: true });
    }

    if (this.platform === 'win32') {
      return new Promise((resolve) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-NoLogo',
            '-Command',
            '$b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if ($b) { "$($b.EstimatedChargeRemaining),$($b.BatteryStatus)" } else { "NONE" }',
          ],
          { windowsHide: true, timeout: 4000 },
          (err, stdout) => {
            if (err || !stdout) return resolve({ percent: null, charging: false, hasBattery: false });
            const out = stdout.trim();
            if (!out || out === 'NONE') {
              return resolve({ percent: null, charging: false, hasBattery: false });
            }
            const [pctStr, statusStr] = out.split(',');
            const percent = Number(pctStr);
            const status = Number(statusStr);
            // Win32_Battery BatteryStatus: 2 = AC/Charging, 6-9 = Charging states
            const charging = status === 2 || (status >= 6 && status <= 9);
            resolve({
              percent: Number.isFinite(percent) ? percent : null,
              charging,
              hasBattery: true,
            });
          }
        );
      });
    }

    if (this.platform === 'darwin') {
      return new Promise((resolve) => {
        execFile('pmset', ['-g', 'batt'], { timeout: 3000 }, (err, stdout) => {
          if (err || !stdout) return resolve({ percent: null, charging: false, hasBattery: false });
          const match = stdout.match(/(\d+)%/);
          if (!match) return resolve({ percent: null, charging: false, hasBattery: false });
          const charging = /AC Power|charging/i.test(stdout) && !/discharging/i.test(stdout);
          resolve({ percent: Number(match[1]), charging, hasBattery: true });
        });
      });
    }

    // Linux /sys/class/power_supply
    try {
      const base = '/sys/class/power_supply';
      const bats = fs.readdirSync(base).filter((d) => d.startsWith('BAT'));
      if (bats.length === 0) return Promise.resolve({ percent: null, charging: false, hasBattery: false });
      const cap = Number(fs.readFileSync(path.join(base, bats[0], 'capacity'), 'utf8').trim());
      const st = fs.readFileSync(path.join(base, bats[0], 'status'), 'utf8').trim();
      return Promise.resolve({
        percent: Number.isFinite(cap) ? cap : null,
        charging: st === 'Charging' || st === 'Full',
        hasBattery: true,
      });
    } catch {
      return Promise.resolve({ percent: null, charging: false, hasBattery: false });
    }
  }

  /**
   * Cleanly terminate any background helper process.
   */
  dispose() {
    if (this.psProcess && !this.psProcess.killed) {
      try {
        this.psProcess.stdin.end('exit\n');
        this.psProcess.kill();
      } catch {
        // Ignore cleanup errors
      }
      this.psProcess = null;
      this.psReady = false;
    }
  }
}

module.exports = {
  ALLOWED_COMMANDS,
  QUICK_LAUNCH_URLS,
  MediaController,
};
