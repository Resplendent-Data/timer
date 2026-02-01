# AGENTS.md - Coding Agent Guidelines

Tauri v2 desktop app with React/TypeScript frontend and Rust backend.
Monitors user idle time and integrates with ClickUp to auto-stop timers.

## Project Structure

```
src/                    # React/TypeScript frontend
  components/           # React components (StatusIndicator, Settings, TimerControls)
  components/ui/        # Reusable UI primitives (shadcn/ui style)
  components/stats/     # Stats-related components (StreakDisplay, FocusChart)
  hooks/                # Custom React hooks (useIdleChecker, useUpdater)
  lib/                  # Utilities (store.ts, notification.ts, utils.ts)
src-tauri/              # Rust backend
  src/
    idle/               # Platform-specific idle detection (macos.rs, linux.rs, windows.rs)
    clickup.rs          # ClickUp API integration
    idle_monitor.rs     # Unified idle detection interface
    stats.rs            # Productivity stats and SQLite database
    lib.rs              # Tauri commands and app setup
```

## Build & Development Commands

```bash
npm install             # Install dependencies
npm run dev             # Vite dev server only
npm run build           # TypeScript check + Vite build
npx tsc --noEmit        # Type check only
npm run tauri dev       # Development with hot reload
npm run tauri build     # Production build (.app/.dmg)
```

## Rust Backend (run from src-tauri/)

```bash
cargo build             # Debug build
cargo check             # Fast type checking
cargo clippy            # Linting
cargo fmt               # Format code
```

## Running Tests

```bash
cd src-tauri && cargo test                                       # All tests
cd src-tauri && cargo test test_idle_check_result_serialization  # Single test by name
cd src-tauri && cargo test clickup::tests                        # Module tests
cd src-tauri && cargo test stats::tests                          # Stats module
cd src-tauri && cargo test idle::                                # All idle module tests
cd src-tauri && cargo test -- --nocapture                        # With stdout output
```

## Code Style - TypeScript/React

**Import Order:** React -> external packages -> @/ aliases -> relative imports
```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "@/components/ui/card";
import { sendNotification } from "../lib/notification";
```

**Naming:** Components `PascalCase`, hooks `useX`, interfaces `PascalCase`, utilities `camelCase`

**Type Patterns:**
- Define interfaces for all props and API responses
- Match Rust `snake_case` field names exactly (`task_name`, not `taskName`)
- Use `Option<T>` in Rust = `T | null` in TypeScript

**Error Handling:**
```typescript
try {
  const result = await invoke<SomeType>("command_name", { args });
} catch (error) {
  console.error("[ComponentName] Context:", error);
  setError(error instanceof Error ? error.message : String(error));
}
```

**Async Patterns:** Clean up listeners in `useEffect`:
```typescript
useEffect(() => {
  let unlisten: (() => void) | null = null;
  const setup = async () => { unlisten = await listen("event-name", handler); };
  setup();
  return () => { if (unlisten) unlisten(); };
}, []);
```

## Code Style - Rust

**Import Order:** std -> external crates -> crate modules
```rust
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use crate::idle_monitor;
```

**Naming:** Modules `snake_case`, types `PascalCase`, functions `snake_case`, constants `SCREAMING_SNAKE_CASE`

**Struct Definitions:** Always derive standard traits for API types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleCheckResult {
    pub stopped: bool,
    #[serde(default)]
    pub task_name: Option<String>,
}
```

**Tauri Commands:** Use doc comments, return Result<T, String>
```rust
/// Brief description of the command.
#[tauri::command]
async fn command_name(param: String) -> Result<ReturnType, String> {
    do_something().map_err(|e| format!("Context: {}", e))?;
    Ok(result)
}
// Register in lib.rs: tauri::generate_handler![command_name]
```

**Platform-Specific Code:**
```rust
#[cfg(target_os = "macos")]
pub async fn platform_fn() -> Result<T, String> { ... }
```

**Tests:** Use `#[cfg(test)]` modules (Arrange-Act-Assert pattern)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_idle_check_result_serialization() {
        let result = IdleCheckResult { stopped: true, task_name: Some("Test".into()) };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"stopped\":true"));
    }
}
```

## Key Patterns

**Tauri Command Flow:**
1. Define async fn with `#[tauri::command]` in Rust
2. Register in `invoke_handler` in `lib.rs`
3. Call from frontend: `invoke<ReturnType>("command_name", { args })`

**Notifications:** Use `lib/notification.ts` (macOS/Windows: Tauri plugin, Linux: `notify-send`)

**Storage:** Use `lib/store.ts` with `tauri-plugin-store` (LazyStore)

**Events:** Use `emit()` for Rust->Frontend, `listen()` for Frontend handlers

## Platform Notes

- **macOS:** IOKit `HIDIdleTime`, overlay title bar, sleep detection via NSWorkspace
- **Linux:** GNOME DBus -> KDE DBus -> X11 fallback; `notify-send` for notifications
- **Windows:** `GetLastInputInfo` for idle detection

## Releasing

Releases are automated via GitHub Actions on push to `master`.

**To release a new version:**

1. Bump version in both files (must match):
   - `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
   - `src-tauri/Cargo.toml` → `version = "X.Y.Z"`

2. Commit and push to `master`:
   ```bash
   git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
   git commit -m "Bump version to X.Y.Z"
   git push origin master
   ```

3. GitHub Actions builds and creates release `vX.Y.Z` with:
   - macOS: `.dmg` (Apple Silicon/aarch64)
   - Linux: `.AppImage` and `.deb`

**Required secrets** (in GitHub repo settings):
- `TAURI_SIGNING_PRIVATE_KEY` - For update signatures
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Key password

## Dependencies

**Rust:** tauri v2, reqwest, serde/serde_json, tokio, chrono, rusqlite, thiserror, dirs
**Tauri Plugins:** notification, store, updater, process, clipboard-manager, opener
**TypeScript:** React 19, @tauri-apps/api, @tauri-apps/plugin-*, Radix UI, Tailwind CSS v4, lucide-react
