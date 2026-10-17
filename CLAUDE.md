# Claudio — working agreement

Claudio is a small, always-on-top desktop office (Tauri 2 + three.js) that attaches to running Claude Code sessions. See `README.md` for architecture and setup.

These rules apply to every session that works in this repository.

## Language

- Talk to the user in Turkish.
- Write every git and GitHub artifact in English: commit messages, tag messages, CHANGELOG entries, release notes, issue and PR text.
- Write new code comments in English. Don't mass-translate existing Turkish comments unless asked.
- UI strings stay Turkish. That is the product language.

## Project layout

| Path | What it is |
|---|---|
| `src/` | Frontend: three.js scene (`scene.js`), panels and cards (`ui.js`), session state (`session.js`) |
| `sidecar/` | Node bridge: hook receiver, session list, transcript tail, hook installer, idle waiter |
| `src-tauri/` | Rust shell: transparent window, click-through, position memory, sidecar process |
| `CHANGELOG.md` | Release history ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)) |
| `.github/labels.yml` | The label set for issues and PRs |

## Commits

Commit early and often. Every logical, working unit of change gets its own commit, and no task ends with uncommitted work unless the user says so.

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <subject>

<body: what changed and why, wrapped at 72 columns>

<footers>
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes:** `bridge`, `hooks`, `ui`, `scene`, `window`, `session`, `deps`, `release`. Leave the scope out when a change spans many areas.
- **Subject:** imperative mood ("add", not "added"), lowercase after the colon, no trailing period, 72 characters at most.
- **Body:** explain the reason and any behaviour the reader would not expect. Skip it only for trivial changes.
- **Breaking changes:** add `!` after the type or scope, plus a `BREAKING CHANGE:` footer.
- **Trailer:** end every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Examples:

```
feat(ui): paste images into the chat composer

Hooks can only carry text, so the bridge stores attachments in the app
data folder and appends their paths; Claude opens them with Read.
```

```
fix(window): ignore move events while minimized
```

Before committing:

1. Stage files by name. Don't use `git add -A` without reading `git status` first.
2. Run the checks that match what changed:
   - frontend: `npx vite build`
   - Rust: `cargo build` in `src-tauri/`
   - sidecar: `node --check sidecar/<file>.mjs`
3. Never commit secrets, tokens, user paths taken from `~/.claude`, `dist/`, `node_modules/` or `src-tauri/target/`.
4. If the change is user-facing (`feat`, `fix`, `perf`), add a line under `## [Unreleased]` in `CHANGELOG.md` in the same commit.

## Pushing

- The remote is `origin` (https://github.com/SefaSelim/claudio), default branch `main`.
- Push after each commit, or after a short series of related commits: `git push`.
- Never force-push `main`. If a push is rejected, run `git pull --rebase`, resolve, re-run the checks, then push.
- Small changes go straight to `main`. Risky or multi-day work goes on a `feat/<short-name>` or `fix/<short-name>` branch. With `gh` available, merge it through a PR; without it, merge with `git merge --no-ff` once it works.

## Versions, tags and releases

- [SemVer](https://semver.org/), pre-1.0. Bump the **minor** version when a roadmap phase is done, the **patch** version for fixes.
- Keep the version identical in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
- A release is one commit, `chore(release): vX.Y.Z`, that:
  - bumps the three versions,
  - refreshes `Cargo.lock` with `cargo build`,
  - moves `[Unreleased]` entries into a dated `## [X.Y.Z] - YYYY-MM-DD` section,
  - updates the compare links at the bottom of `CHANGELOG.md`.
- Tag that commit with an annotated tag and push the tag:

  ```bash
  git tag -a vX.Y.Z -m "vX.Y.Z: <one-line summary>"
  git push origin vX.Y.Z
  ```

- Tags are never moved or deleted once pushed. Fix mistakes with a new patch release.
- With `gh` installed, also publish a GitHub Release from the tag, using that version's CHANGELOG section as the notes:

  ```bash
  gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes.md>
  ```

## Issues, PRs and labels

The label set lives in `.github/labels.yml`. With `gh` installed, sync it once, then use it on every issue and PR.

- Every issue and PR gets exactly one `type:` label and at least one `area:` label. Add a `phase:` label when it belongs to a roadmap phase.
- **Issue titles:** short and specific ("Bridge drops events when the transcript is rewritten").
- **PR titles:** follow the commit convention.
- **PR body:** what changed, why, how it was tested, and the issues it closes (`Closes #12`).
- PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Before ending a task

- `git status` is clean, or the user agreed to leave work uncommitted.
- Commits are pushed.
- `CHANGELOG.md` reflects user-facing changes.
- If a phase was finished, cut a release as described above.
