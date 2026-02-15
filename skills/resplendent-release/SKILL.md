---
name: resplendent-release
description: Release workflow for the resplendent-timer repository. Use when asked to create a release, publish a version, bump the app version, or ship desktop builds. Synchronize versions in src-tauri/Cargo.toml and src-tauri/tauri.conf.json, run release checks, create a release commit, push to master, and verify the GitHub Actions release run.
---

# Resplendent Release

Run this workflow from:
`/Users/malachibazar/Documents/resplendent/resplendent-timer`

## Workflow

1. Inspect branch and working tree.
```bash
git branch --show-current
git status --short
```

2. Determine release intent.
- If the user asks to release current changes, include intended feature or fix files plus version files.
- If the user asks for version bump only, include only version files.
- If unrelated dirty files are present, ask before committing.

3. Determine target version.
- Use the user-provided version when given.
- Otherwise bump patch semver from the current version.

4. Set both version files to the same value.
- `src-tauri/Cargo.toml`:
  `version = "X.Y.Z"`
- `src-tauri/tauri.conf.json`:
  `"version": "X.Y.Z"`

5. Run checks.
```bash
npx tsc --noEmit
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

6. Stage intended release files.
```bash
git add <intended-files>
```

7. Commit.
```bash
git commit -m "Release vX.Y.Z"
```

8. Push to trigger the release workflow.
```bash
git push origin master
```

9. Verify the workflow state.
```bash
gh run list --repo Resplendent-Data/timer --limit 5
```

10. Watch the workflow when needed.
```bash
gh run watch <run-id> --repo Resplendent-Data/timer
```

## Guardrails

- Keep versions in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` identical.
- Use non-interactive git commands only.
- Never use destructive reset/checkout commands.
- If the working tree includes unrelated changes, ask before committing.
- Do not create a manual tag or GitHub release unless explicitly requested; push to `master` is the release trigger.
