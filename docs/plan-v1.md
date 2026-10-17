# Claudio 0.7 → 1.0 plan

Status: accepted, in progress. Owner: the Claudio maintainers. Last updated: 2026-10-18.

## Context

Claudio 0.6 attaches to any running Claude Code session through user-level hooks, shows the
main agent and its subagents as felt characters in a small always-on-top office, and lets you
message agents, answer permissions and questions, and hold meetings without leaving the desktop.

[W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) (1.1.1, October 2026) is a
browser-and-Electron pixel office built on the same idea. It is broader: it acts each turn out,
reads the session's real task list, classifies Bash commands into deploy / build / test / push
signals, turns the room red when production breaks, shows cost, token and context meters,
inspects any character, and ships a doctor, a tray icon, CI and tagged installers.

This plan takes the parts that make sense for a small desktop widget, adapts them to what
Claudio already does better (two-way messaging with no API key, an office-native permission
and question flow, meetings), and keeps the interface simple: every feature lands in an
existing panel, a single new panel, or the scene itself.

## Principles

1. **Truthful.** Everything shown comes from Claude Code itself: hooks, the session registry,
   transcripts, the task files. Nothing is guessed or invented.
2. **Quiet by default.** The office is on screen all day. New visuals are small, animations are
   short, sounds and notifications stay opt-in.
3. **One click deep.** No feature needs more than one panel. The dock gains at most one button.
4. **No new runtime dependencies.** The bridge stays plain Node with no `node_modules`; the
   shell stays Tauri with the plugins it already has.
5. **Tested where it is pure.** Parsers and classifiers get `node:test` suites that run in CI.

## What we take, and how it changes

| Claude Office feature | Claudio adaptation | Release |
|---|---|---|
| Inspector card (task, tools used, failed calls, tokens, model) | The agent card's **Adımlar** tab gets a summary row: tool counts, failed calls in red, run time, and model and tokens once a subagent finishes | 0.7 |
| Available agent types per role | **Ekip** panel: every agent Claude Code can launch in the attached project (built-ins, `~/.claude/agents`, `<project>/.claude/agents`, enabled plugins), with a one-click "give this agent a task" that asks Claude to launch it | 0.7 |
| Real task list on the whiteboard | The office whiteboard shows the session's `TaskCreate` list as post-its; clicking it opens a compact **Görevler** view inside the Ekip panel | 0.7 |
| Claude acts out the turn: types, naps when idle, raises a hand for you | Claude dozes (z z z) 30 s after a turn ends, raises a hand while a permission or question waits, sweeps the desk while compacting, wears a red badge after an API error | 0.7 |
| Signals: deploy / build / test / push | The bridge classifies Bash commands; the character gets 🚀 / 🔨 / 🧪 / ⬆ while it runs and ✅ / ❌ when it ends, and the chat gets a one-line system row | 0.8 |
| "Prod Is Down" incident mode | **Alarm**: a failed deploy, or three failed calls in five minutes, tints the room red with a beacon over the door; it clears on a green run, ten quiet minutes or "Alarmı kapat" | 0.8 |
| Payroll / electricity / memory meters | Context fill and tokens per minute, estimated from the transcript usage the bridge already reads, as one thin bar on the session badge. Cost is left out: it needs the status line, and Claudio does not price tokens | 0.8 |
| Agent-to-agent messages | When an agent uses `SendMessage`, the sender walks to the recipient's desk and back with an envelope | 0.8 |
| Health strip and `npm run doctor` | **Tanılama** block in Settings: Node version, hooks installed and current, last hook seen, sessions found, bridge version; the same checks as `npm run doctor` | 0.9 |
| Tray icon with badge, show/hide, always on top | Tray icon: show / hide, "always on top", reset position, quit; its tooltip says how many requests wait | 0.9 |
| `y` / `n` on a permission card | Keyboard: `Enter` allows, `Esc` defers to the terminal on the front card while the office has focus | 0.9 |
| CI and tagged installers | GitHub Actions: `node --test`, `vite build` and `cargo check` on every push; a tag builds the Windows installer and attaches it to a draft release | 0.9 |
| Usage guide | `docs/KULLANIM.md`, a step-by-step guide in Turkish, the product language | 0.7 |

## Left out, on purpose

- **Office chat bot with its own personality** (`claude -p` replying in the office chat). Claudio
  talks to the real session instead, which is the point of attaching to it.
- **Keyword routing to specialist agents.** The Ekip panel lets you pick the agent yourself;
  Claude stays in charge of delegation.
- **Fan-art skin, random office events, A2A HTTP endpoints, SQLite chat history.** Fun or useful
  in a browser tab, noise in a 482×750 widget, or a new dependency.
- **Cost meter.** It needs Claude Code's status line, which a user may already use for
  something else.

## Releases

### 0.7.0 — the truthful office

- Bridge: `roster` command and event (agent definitions with name, description, model, tools,
  source); `tasks` event from `~/.claude/tasks/<session>/`; forward `PostToolUseFailure`,
  `StopFailure`, `PreCompact`, `PostCompact`; register the extra hooks.
- Scene: doze, raised hand, compact sweep, error badge; whiteboard post-its.
- UI: Ekip panel (dock button), tool summary on the agent card.
- Docs: `docs/KULLANIM.md`.

### 0.8.0 — signals and alarm

- Bridge: Bash command classifier (`sidecar/signals.mjs`) with a test suite; usage reader for
  context and tokens per minute.
- Scene: signal props over characters, alarm tint and beacon, envelope walks.
- UI: signal rows in chat, meter bar on the badge, "Alarmı kapat".

### 0.9.0 — comfort and distribution

- Shell: tray icon, `get_diagnostics`.
- UI: Tanılama block, keyboard shortcuts on cards.
- Repo: `npm test`, CI workflow, release workflow, issue templates.

### 0.10.0 — acting out the turn

Added after 0.9, from the parts of Claude Office still missing:

- A "Sen" character, the user, waits by the beanbag and walks each office message to its
  recipient's desk (Claude Office's boss handing over the prompt). It can be switched off.
- Office-only chat commands: `/durum`, `/ajanlar`, `/görevler`, `/toplantı`, `/alarm`,
  `/alarm-bitti`, `/temizle`, `/yardım` (Claude Office's `/status`, `/agents`,
  `/incident`, `/all-clear`, `/help`).

### 1.0.0

Bug fixes from using 0.9 day to day, a pass over every Turkish string, and screenshots in the
README. No new features.

## Risks

- **Undocumented files.** `~/.claude/sessions` and `~/.claude/tasks` are not a public API. Every
  reader tolerates missing or malformed files and the office falls back to hiding the feature.
- **Hook count.** More registered hooks mean more HTTP calls. The new ones are fire-and-forget
  with a 5 s timeout and return `{}`, and the bridge answers them before doing any work.
- **Classifier false positives.** Only well-known programs count, `--dry-run` never does, and an
  unknown command costs nothing.
