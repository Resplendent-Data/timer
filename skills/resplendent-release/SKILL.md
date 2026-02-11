---
name: resplendent-release
description: Release workflow for the resplendent-timer repository. Use when asked to create a release, publish a new version, bump the app version, or ship desktop builds. Handle synchronized version bumps in src-tauri/Cargo.toml and src-tauri/tauri.conf.json, run validation builds, commit, push to master, and verify the GitHub Actions release run.
---

# Resplendent Release

Follow this workflow from repository root:
`/Users/malachibazar/Documents/resplendent/resplendent-timer`

## Release steps

1. Inspect branch and working tree.
```bash
git branch --show-current
git status --short
```

2. Determine the target version.
- Use the user-provided version when given.
- Otherwise bump patch semver from the current version.

3. Update both version files to the same value.
- `src-tauri/Cargo.toml`:
  `version = "X.Y.Z"`
- `src-tauri/tauri.conf.json`:
  `"version": "X.Y.Z"`

4. Run release checks.
```bash
npx tsc --noEmit
npm run build
```

5. Create the release commit.
```bash
git add .
git commit -m "Release vX.Y.Z"
```

6. Push to trigger the release workflow.
```bash
git push origin master
```

7. Verify the workflow state.
```bash
gh run list --repo Resplendent-Data/timer --limit 5
```

## Guardrails

- Keep versions in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` identical.
- Use non-interactive git commands only.
- Never use destructive reset/checkout commands.
- If the working tree includes unrelated changes, confirm whether to include them before committing.
- Do not create a manual tag or GitHub release unless explicitly requested; push to `master` is the release trigger.
