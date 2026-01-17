# AGENTS.md - Coding Agent Guidelines

Tauri v2 desktop app with React/TypeScript frontend and Rust backend.
Monitors user idle time and integrates with ClickUp to auto-stop timers.

## Project Structure

```
src/                    # React/TypeScript frontend
  components/           # React components
  hooks/                # Custom React hooks
  lib/                  # Utilities (store, etc.)
src-tauri/              # Rust backend
  src/
    idle/               # Platform-specific idle detection (macos.rs, linux.rs)
    clickup.rs          # ClickUp API integration
    idle_monitor.rs     # Unified idle detection interface
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
cd src-tauri && cargo test                                    # All tests
cd src-tauri && cargo test test_idle_check_result_serialization  # Single test
cd src-tauri && cargo test clickup::tests                     # Module tests
cd src-tauri && cargo test -- --nocapture                     # With output
```

## Code Style - TypeScript/React

**Import Order:** React → external packages → internal modules → relative imports
```typescript
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../lib/store";
```

**Naming:**
- Components: `PascalCase` (`StatusIndicator`)
- Hooks: `camelCase` with `use` prefix (`useIdleChecker`)
- Interfaces: `PascalCase` (`IdleStatus`)
- CSS classes: BEM (`status-indicator__value--active`)

**Types:**
- Define interfaces for all component props
- Explicit return types for hooks
- Match Rust snake_case in API responses (`task_name`, not `taskName`)

**Components:**
- Function components with hooks only
- JSDoc comment at top describing purpose
- Named exports, not default exports

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

**Import Order:** std → external crates → internal modules
```rust
use std::time::Duration;
use serde::{Deserialize, Serialize};
use crate::idle_monitor;
```

**Naming:**
- Modules/files: `snake_case` (`idle_monitor.rs`)
- Types/Structs: `PascalCase` (`IdleCheckResult`)
- Functions: `snake_case` (`get_idle_time_secs`)
- Constants: `SCREAMING_SNAKE_CASE`

**Structs:** Derive `Debug, Clone, Serialize, Deserialize` for API types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleCheckResult {
    /// Whether a timer was stopped
    pub stopped: bool,
    #[serde(default)]
    pub task_name: Option<String>,
}
```

**Tauri Commands:**
```rust
/// Brief description.
#[tauri::command]
async fn command_name(param: String) -> Result<ReturnType, String> {
    do_something().map_err(|e| format!("Context: {}", e))?;
    Ok(result)
}
```

**Error Handling:** Return `Result<T, String>` from commands, add context to errors

**Platform-Specific Code:**
```rust
#[cfg(target_os = "macos")]
pub async fn get_idle_secs() -> Result<u64, String> { ... }
```

**Tests:**
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

**Adding Features:**
1. Rust: Add function, expose via Tauri command
2. Frontend: Create interface matching Rust struct, call via `invoke`
3. Types must match: Rust `snake_case` = TS `snake_case` (not camelCase)

**State Management:**
- React hooks for component state
- `tauri-plugin-store` for persistent settings (see `lib/store.ts`)
- No global state library needed

## Platform Notes

- **macOS:** IOKit `HIDIdleTime` for idle detection, overlay title bar style
- **Linux:** GNOME DBus → KDE DBus → X11 XScreenSaver fallback chain

## Key Dependencies

**Rust:** tauri v2, reqwest, serde, tokio
**TypeScript:** @tauri-apps/api, @tauri-apps/plugin-store, @tauri-apps/plugin-notification, React 19
