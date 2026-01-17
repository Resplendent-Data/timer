# Resplendent Timer

A desktop application that monitors user idle time and automatically stops ClickUp timers when you're away.

## Features

- **Auto-stop timers**: Automatically stops your running ClickUp timer when you've been idle for a configurable amount of time
- **No timer warning**: Optionally get notified when you've been active without a timer running
- **Real-time display**: Shows current idle time and elapsed time on running timers
- **System tray**: Minimizes to system tray for background monitoring

## Installation

### macOS

1. Download the latest `.dmg` file from the [Releases](https://github.com/Resplendent-Data/timer/releases) page
2. Open the `.dmg` file
3. Drag `Resplendent Timer.app` to your Applications folder
4. On first launch, right-click the app and select "Open" (required for unsigned apps)
5. Grant notification permissions when prompted

**Note**: The app is not code-signed, so you may need to allow it in System Settings > Privacy & Security.

### Linux

#### Debian/Ubuntu (.deb)
```bash
# Download the .deb file from Releases, then:
sudo dpkg -i resplendent-timer_*.deb
```

#### Fedora/RHEL (.rpm)
```bash
# Download the .rpm file from Releases, then:
sudo rpm -i resplendent-timer-*.rpm
```

#### AppImage
```bash
# Download the .AppImage file from Releases, then:
chmod +x Resplendent-Timer_*.AppImage
./Resplendent-Timer_*.AppImage
```

## Configuration

On first launch, go to the **Settings** tab and configure:

1. **ClickUp API Key**: Get your API key from [ClickUp Settings > Apps](https://app.clickup.com/settings/apps)
2. **Team ID**: Find your Team ID in any ClickUp URL: `app.clickup.com/[TEAM_ID]/...`
3. **Idle Threshold**: Minutes of inactivity before auto-stopping timers (default: 10)

### No Timer Warning (Optional)

Enable this feature to get notified when you've been working without a timer:

- **Warn after X minutes**: How long to wait before warning
- **Repeat warning**: Whether to keep reminding you at intervals

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Production Build

```bash
# Build for your current platform
npm run tauri build
```

Build artifacts will be in `src-tauri/target/release/bundle/`.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Rust, Tauri v2
- **Idle Detection**: 
  - macOS: IOKit (HIDIdleTime)
  - Linux: D-Bus (GNOME/KDE) with X11 fallback

## License

Private - Resplendent Data
