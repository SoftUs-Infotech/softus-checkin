# Softus Checkin — desktop app

The app work-from-home staff punch in from, for **Mac, Linux and Windows**. It shows the
same screens as the website (they are built into the app from `../src`), and
adds what a browser cannot do:

- **Screenshots without asking every time.** The whole screen, every display,
  at a random moment in each interval, plus one at punch-in.
- **Activity.** Per minute: seconds with keyboard or mouse use, the *number* of
  key presses, clicks and scrolls (never which keys or any text), how far the
  pointer moved, whether the screen changed, time locked, and — on Linux —
  input that came from software rather than a real keyboard or mouse. The
  admin sees it on **Employees → Work from home**, flagged when a window looks
  idle, locked, mouse-only (a jiggler), screen-only (a video) or software-driven.
- **Forced updates.** An admin uploads a new version on **App updates** and
  publishes it. The next punch-in on an older app shows "Update available"; the
  app downloads the new version, checks its SHA-256, replaces itself and
  restarts.

Office staff keep using the website. Turn on **Settings → Work from home: punch
in only from the desktop app** once everybody working from home has installed it.

## Platforms

| | Mac (Apple silicon and Intel) | Linux (x64 and ARM) | Windows 10 and 11 (x64) |
|---|---|---|---|
| Install | `.dmg` | `.AppImage` — one file for every distribution | `.exe` installer — for the current user, no administrator password |
| Update file | `.zip` | the same `.AppImage` | the same `.exe` (run silently) |
| First run | Allow **Screen Recording** and **Accessibility** in System Settings → Privacy & Security | **Set up this computer** (administrator password, once); on Wayland also **Choose your screen** (once) | nothing to allow |
| Keys and clicks | macOS input hook (needs Accessibility) | the activity helper (below) — Xorg and Wayland alike | Windows input hook |
| Software input check | — | yes (the helper) | — |
| Screenshots | silent | Xorg: silent · GNOME/KDE on Wayland: the screen is chosen once, then silent · Sway/Hyprland/COSMIC: silent | silent |
| Location | macOS Location Services | not available; the server records the network address instead | Windows location service when it answers; otherwise the network address |

### Mac: unsigned

The app is **not signed** with an Apple Developer ID. Two consequences:

1. The first time it is opened, macOS blocks it. Open **System Settings →
   Privacy & Security**, scroll down, click **Open Anyway**.
2. macOS treats every update as a new app, so Screen Recording and
   Accessibility have to be allowed again after each update. The app shows what
   to allow and blocks punching in until it is done.

### Windows: unsigned

The installer is **not signed** either. The first time it is opened, Windows
shows "Windows protected your PC": click **More info**, then **Run anyway**.
It installs for the current user only (in `%LOCALAPPDATA%\Programs`), adds
Start menu and desktop shortcuts, and starts the app. Updates the app
downloads itself are run silently and are not asked about.

For a location, Windows' **Location** setting (Settings → Privacy & security →
Location) has to be on, with "Let desktop apps access your location". When
Windows gives no location, the punch is still made and the server records the
network address.

### Linux: the one-time setup

Wayland does not let any app see the keyboard or mouse outside its own window.
The kernel still sees every key press and click, on every distribution and
desktop, through `/dev/input` — readable only by root. So the setup installs a
small **activity helper** (`helper/`, Go, a static 2 MB binary) as a system
service: it reads the input devices and hands the app nothing but per-second
counts over `/run/softus-checkin/helper.sock`. It never records or passes on
which key was pressed, and it keeps nothing. Input from software devices
(remote-control tools, "mouse jiggler" programs — devices under
`/sys/devices/virtual`) is counted and also reported separately.

The setup (`linux/setup.sh`) also installs what screenshots need on Wayland —
GStreamer's PipeWire plugin, and grim for wlroots desktops — with the
computer's own package manager (apt, dnf, zypper or pacman).

- **From the app:** the punch card shows **Set up this computer**; Ubuntu (or
  the desktop in use) asks for the administrator password.
- **By IT, without the screens:**
  `./softus-checkin-1.0.0-linux-x86_64.AppImage --setup`
  or, from this repository, `sudo sh linux/setup.sh install build/helper/softus-checkin-helper-amd64 linux/softus-checkin-helper.service`
- **Remove:** `sudo sh linux/setup.sh uninstall` (or `sudo systemctl disable --now softus-checkin-helper`
  and delete `/usr/local/libexec/softus-checkin` and `/etc/systemd/system/softus-checkin-helper.service`).

Needs systemd. Tested (the real setup, as root): Ubuntu 22.04 and 24.04,
Debian 12, Fedora 41, Arch, openSUSE Tumbleweed; live on Ubuntu 22.04 GNOME
under both Xorg and Wayland (setup, screen chosen once, punch-in without a
window, random screenshots, lock, close-while-punched-in, reopen, update,
fallback capture); grim on a headless Sway 1.9.

On **Xorg** the app also works before the setup (it then counts input itself);
the setup is still advised, for the software-input check. On **Wayland**
punching in waits for it.

On **Wayland** the app runs its window as an X11 window (through XWayland):
GNOME draws title bars only for X11 windows, Electron draws none of its own on
Wayland, and its own window buttons crash there. The app starts itself again
once, at once, with `--ozone-platform=x11`. Tracking is unaffected — the helper
and the screen sharing work outside Electron. Screen locking is read from
logind's `auto` session, which also works when the app was started from the
dock or a launcher (outside the session's own processes).

The AppImage uses electron-builder's static runtime, so it needs no FUSE 2 —
it runs on Ubuntu 24.04 and other current distributions as is. Where the
distribution blocks Chromium's sandbox (Ubuntu 24.04+), the AppImage starts
without it; the app only ever shows its own built-in screens.

## Building

Needs Node 22.12 or newer; Linux builds also need Go 1.18+ (for the helper).
From the repository root:

```bash
npm ci                 # the website's dependencies (the screens)
cd desktop
npm ci                 # Electron and the build tools
```

**Mac** (must be run on a Mac):

```bash
npm run dist:mac
```

**Linux**:

```bash
npm run dist:linux     # builds the helper, the screens, then the AppImage
```

**Windows**, on a Windows computer:

```bash
npm run dist:win
```

or on Linux (or a Mac) with Docker, inside electron-builder's image, which
has the Wine that Windows builds need (about 1.5 GB, downloaded once):

```bash
npm run dist:win:docker
```

Files land in `desktop/dist/`:

- `softus-checkin-1.0.0-mac-arm64.dmg` / `…-mac-x64.dmg` — give these to people to install
- `softus-checkin-1.0.0-mac-arm64.zip` / `…-mac-x64.zip` — what Macs update from
- `softus-checkin-1.0.0-linux-x86_64.AppImage` — install and update file for Linux
- `softus-checkin-1.0.0-win-x64.exe` — install and update file for Windows

The API address is built in and defaults to production
(`https://140.245.28.23/api/v1`). For a build against another server:

```bash
VITE_API_BASE=https://other-server/api/v1 npm run dist:mac
```

## Releasing a new version

1. Raise `"version"` in `desktop/package.json` (e.g. `1.0.0` → `1.0.1`).
2. Build on a Mac (`npm run dist:mac`), on Linux (`npm run dist:linux`) and for
   Windows (`npm run dist:win` or `npm run dist:win:docker`).
3. As an admin, open **App updates**, choose all the files of that version
   (both `.zip`, both `.dmg`, the `.AppImage`, the `.exe`) and upload. The
   version and each file's platform are read from the file names.
4. Click **Publish** on each platform's draft. From the next punch-in, every
   older app on that platform updates first.

**Withdraw** takes a published version back; the one before it becomes current
again. Only drafts and withdrawn versions can be deleted.

## Running it while developing

```bash
cd desktop
VITE_API_BASE=http://127.0.0.1:8000/api/v1 npm start
```

The backend has to allow the app's address: add `app://softus` to
`CORS_ORIGINS`. `SOFTUS_DEVTOOLS=1` opens the developer tools;
`SOFTUS_USER_DATA=/some/folder` keeps a separate sign-in and
`SOFTUS_HELPER_SOCKET=/some/path` points at another helper (both used by the tests).

If the app starts as plain Node with `TypeError: Cannot read properties of
undefined`, the shell has `ELECTRON_RUN_AS_NODE` set (VS Code's terminal does):
run `unset ELECTRON_RUN_AS_NODE` first.
