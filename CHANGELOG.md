# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cozy open-plan office ported from the design mockup: five desks, a bookshelf, a coffee corner, a beanbag, lamps, fairy lights and a glass meeting room.
- Subagents walk in through the open front edge to a free desk and walk out again when they finish. When the desks are full they take meeting-room chairs, then standing spots near the coffee corner.
- Evening/day lighting toggle on the side bar. It follows the clock by default (evening from 18:00 to 07:00); a click pins the other mood, a right-click goes back to the clock.
- `?scene-demo` development page that shows agents walking and working in a normal browser, without Tauri or a session.

## [0.1.0] - 2026-10-17

First working prototype, covering roadmap phases 0 and 1. Commits before this release were written in Turkish; from here on the history is in English.

### Added

- Transparent, frameless, always-on-top overlay window that sits above the taskbar in the bottom-right corner and stays out of the taskbar.
- Click-through outside the office, the side bar and open panels: the Rust shell polls the cursor at about 60 Hz and toggles cursor events.
- Drag handle on the side bar to move the office, a double-click to snap it back to the bottom-right, and position memory across launches.
- Felt-style Claude characters rendered with three.js. Each agent type gets its own accessories, animations follow tool activity, and characters pop in and out with a spring.
- Bridge sidecar that attaches to any running Claude Code session without an API key:
  - running sessions are listed from `~/.claude/sessions`,
  - live events arrive through user-level HTTP hooks,
  - chat comes from the session transcript.
- One-click hook installer that backs up `~/.claude/settings.json`, adds only Claudio's hooks, and can remove them again.
- Permission prompts and `AskUserQuestion` can be answered from the office, with a "Terminalde cevapla" option to hand the decision back to the terminal.
- Messages from the office reach the session three ways:
  - mid-turn, through `PostToolUse` additional context,
  - at turn end, through a `Stop` hook block,
  - while idle, through an `asyncRewake` waiter.
- Messages addressed to a subagent are delivered at that subagent's next step.
- Delivery status in the chat ("iletilmeyi bekliyor", "iletildi · …").
- File attachments in the chat: a paperclip button, Ctrl+V image paste and drag-and-drop. Attachments are stored in the app data folder and their paths are sent to Claude.
- Demo mode (`CLAUDIO_FAKE=1`) that replays a scripted session through the real bridge code paths.

### Fixed

- The window position is no longer saved while the window is minimized.

[Unreleased]: https://github.com/SefaSelim/claudio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SefaSelim/claudio/releases/tag/v0.1.0
