# AGENTS.md - Coding Agent Guidelines

This is a Tauri v2 desktop application with a React/TypeScript frontend and Rust backend.
It monitors user idle time and integrates with ClickUp to auto-stop timers.

## Project Structure

```
src/                    # React/TypeScript frontend
  components/           # React components
  hooks/                # Custom React hooks
  lib/                  # Utilities (store, etc.)
src-tauri/              # Rust backend
  src/
    idle/               # Platform-specific idle detection
    clickup.rs          # ClickUp API integration
    idle_monitor.rs     # Unified idle detection interface
    lib.rs              # Tauri commands and app setup
```

## Build & Development Commands

### Frontend (TypeScript/React)
```bash
npm install             # Install dependencies
npm run dev             # Start Vite dev server only
npm run build           # TypeScript check + Vite production build
```

### Full App (Tauri)
```bash
npm run tauri dev       # Development mode with hot reload
npm run tauri build     # Production build (creates .app/.dmg/.exe)
```

### Rust Backend
```bash
cd src-tauri
cargo build             # Debug build
cargo build --release   # Release build
cargo check             # Fast type checking
cargo clippy            # Linting
cargo fmt               # Format code
```

### Running Tests

**Run all Rust tests:**
```bash
cd src-tauri && cargo test
```

**Run a single Rust test:**
```bash
cd src-tauri && cargo test test_idle_check_result_serialization
```

**Run tests in a specific module:**
```bash
cd src-tauri && cargo test clickup::tests
```

**TypeScript type checking:**
```bash
npx tsc --noEmit
```

## Code Style Guidelines

### TypeScript/React

**Imports** - Order: React, external packages, internal modules, relative imports
```typescript
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../lib/store";
```

**Naming:**
- Components: `PascalCase` (`StatusIndicator`, `Settings`)
- Hooks: `camelCase` with `use` prefix (`useIdleChecker`, `useIdleTime`)
- Interfaces: `PascalCase` (`IdleStatus`, `AppSettings`)
- Variables/functions: `camelCase`
- CSS classes: BEM notation (`status-indicator__value--active`)

**Types:**
- Always define interfaces for component props
- Use explicit return types for hooks
- Match Rust snake_case in API response interfaces (`task_name`, not `taskName`)

**Components:**
- Use function components with hooks
- JSDoc comment at top describing purpose
- Export named functions, not default exports

**Error Handling:**
```typescript
try {
  const result = await invoke<SomeType>("command_name", { args });
} catch (error) {
  console.error("Context:", error);
  setError(error instanceof Error ? error.message : String(error));
}
```

### Rust

**Imports** - Order: std, external crates, internal modules
```rust
use crate::idle_monitor;
use serde::{Deserialize, Serialize};
```

**Naming:**
- Modules/files: `snake_case` (`idle_monitor.rs`)
- Types/Structs: `PascalCase` (`IdleCheckResult`)
- Functions: `snake_case` (`get_idle_time_secs`)
- Constants: `SCREAMING_SNAKE_CASE`

**Documentation:**
- Module-level `//!` doc comments
- Function `///` doc comments with `# Arguments` and `# Returns` sections
- Inline comments for non-obvious logic

**Structs:**
- Derive `Debug, Clone, Serialize, Deserialize` for API types
- Use `#[serde(default)]` for optional API fields
- Document each field with `///`

**Tauri Commands:**
```rust
/// Brief description of what this command does.
///
/// # Arguments
/// * `param` - Description
///
/// # Returns
/// Description of return value
#[tauri::command]
async fn command_name(param: String) -> Result<ReturnType, String> {
    // Implementation
}
```

**Error Handling:**
- Return `Result<T, String>` from Tauri commands
- Use `.map_err(|e| format!("Context: {}", e))?` for error propagation
- Include context in error messages

**Platform-Specific Code:**
```rust
#[cfg(target_os = "macos")]
pub async fn get_idle_secs() -> Result<u64, String> { ... }

#[cfg(target_os = "linux")]
pub async fn get_idle_secs() -> Result<u64, String> { ... }
```

**Tests:**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_descriptive_name() {
        // Arrange
        // Act
        // Assert
    }
}
```

## Key Patterns

### Tauri Command Flow
1. Define async function with `#[tauri::command]`
2. Register in `invoke_handler` in `lib.rs`
3. Call from frontend with `invoke<ReturnType>("command_name", { args })`

### Adding New Features
1. **Rust side:** Add function in appropriate module, expose via Tauri command
2. **Frontend side:** Create interface matching Rust struct, call via `invoke`
3. Types must match: Rust `snake_case` fields = TS interface `snake_case` fields

### State Management
- Use React hooks for component state
- Use `tauri-plugin-store` for persistent settings
- No global state library; prop drilling is acceptable for this app size

## Platform Notes

- **macOS:** Uses IOKit `HIDIdleTime` for idle detection
- **Linux:** Tries GNOME DBus → KDE DBus → X11 XScreenSaver (fallback chain)
- **Windows:** Uses `GetLastInputInfo` Win32 API

## Dependencies to Know

**Rust:**
- `tauri` v2 - App framework
- `reqwest` - HTTP client for ClickUp API
- `serde` - Serialization
- `tokio` - Async runtime

**TypeScript:**
- `@tauri-apps/api` - Invoke Rust commands
- `@tauri-apps/plugin-*` - Tauri plugins (store, notification)
- React 19 with hooks
