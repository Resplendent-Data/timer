# AGENTS.md - Coding Agent Guidelines

Tauri v2 desktop app with React/TypeScript frontend and Rust backend.
Monitors user idle time and integrates with ClickUp to auto-stop timers.

## Project Structure

```
src/                    # React/TypeScript frontend
  components/           # React components (StatusIndicator, Settings, TimerControls)
  components/ui/        # Reusable UI primitives (shadcn/ui style)
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
# Frontend
npm install             # Install dependencies
npm run dev             # Vite dev server only
npm run build           # TypeScript check + Vite build
npx tsc --noEmit        # Type check only

# Full App (Tauri)
npm run tauri dev       # Development with hot reload
npm run tauri build     # Production build (.app/.dmg)

# Rust Backend (run from src-tauri/)
cargo build             # Debug build
cargo check             # Fast type checking
cargo clippy            # Linting
cargo fmt               # Format code
```

## Running Tests

```bash
cd src-tauri && cargo test                                  # All tests
cd src-tauri && cargo test test_idle_check_result_serialization  # Single test
cd src-tauri && cargo test clickup::tests                   # Module tests
cd src-tauri && cargo test stats::tests                     # Stats module
cd src-tauri && cargo test -- --nocapture                   # With stdout
```

## Code Style - TypeScript/React

**Import Order:** React -> external packages -> @/ aliases -> relative imports
```typescript
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "@/components/ui/card";
import { sendNotification } from "../lib/notification";
```

**Naming Conventions:**
- Components: `PascalCase` (`StatusIndicator.tsx`)
- Hooks: `camelCase` with `use` prefix (`useIdleChecker`)
- Interfaces/Types: `PascalCase` (`IdleStatus`, `AppSettings`)
- Utility functions: `camelCase` (`formatDuration`, `getSettings`)
- Files: `PascalCase` for components, `camelCase` for utilities

**Type Patterns:**
- Define interfaces for all props and API responses
- Match Rust `snake_case` field names exactly (`task_name`, not `taskName`)
- Use `Option<T>` in Rust = `T | null` in TypeScript

**Error Handling:**
```typescript
try {
  const result = await invoke<SomeType>("command_name", { args });
} catch (error) {
  console.error("Context:", error);
  setError(error instanceof Error ? error.message : String(error));
}
```

## Code Style - Rust

**Import Order:** std -> external crates -> crate modules
```rust
use std::time::Duration;
use serde::{Deserialize, Serialize};
use crate::idle_monitor;
```

**Naming Conventions:**
- Modules/files: `snake_case` (`idle_monitor.rs`)
- Types/Structs/Enums: `PascalCase` (`IdleCheckResult`)
- Functions: `snake_case` (`get_idle_time_secs`)
- Constants: `SCREAMING_SNAKE_CASE`

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
/// Brief description.
#[tauri::command]
async fn command_name(param: String) -> Result<ReturnType, String> {
    do_something().map_err(|e| format!("Context: {}", e))?;
    Ok(result)
}
// Register in lib.rs: .invoke_handler(tauri::generate_handler![command_name])
```

**Platform-Specific Code:**
```rust
#[cfg(target_os = "macos")]
pub async fn platform_fn() -> Result<T, String> { ... }
```

**Tests:** Use `#[cfg(test)]` modules with descriptive test names
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_descriptive_name() { /* Arrange, Act, Assert */ }
}
```

## Key Patterns

**Tauri Command Flow:**
1. Define async fn with `#[tauri::command]` in Rust
2. Register in `invoke_handler` in `lib.rs`
3. Call from frontend: `invoke<ReturnType>("command_name", { args })`

**Cross-Platform Notifications:** Use `lib/notification.ts` wrapper
- macOS/Windows: Tauri notification plugin
- Linux: `notify-send` command (GNOME 46+ workaround)

**Persistent Storage:** Use `lib/store.ts` with `tauri-plugin-store`

## Platform Notes

- **macOS:** IOKit `HIDIdleTime`, overlay title bar, `.app`/`.dmg` bundles, sleep detection via NSWorkspace
- **Linux:** GNOME DBus -> KDE DBus -> X11 XScreenSaver fallback; `notify-send` for notifications
- **Windows:** `GetLastInputInfo` for idle detection

## Dependencies

**Rust:** tauri v2, reqwest, serde, tokio, chrono, rusqlite, tauri-plugin-notification/store/updater
**TypeScript:** React 19, @tauri-apps/api, @tauri-apps/plugin-*, Radix UI, Tailwind CSS v4
