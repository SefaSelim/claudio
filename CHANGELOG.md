# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-10-18

Signals, alarm and meters: the office reads what shell commands mean and how much context Claude uses.

### Added

- The bridge recognises deploys, builds, test runs and git pushes in Bash and PowerShell calls and reports how each one ended, with the first meaningful error line and a failure count.
- Context fill and tokens per minute for the attached session, read from its transcript against the model's context window.
- Signal props on name tags: 🚀 🔨 🧪 ⬆️ while a deploy, build, test run or push runs, then ✅ or ❌, with one-line chat rows for failures, deploys, pushes to main and builds or tests going green again.
- Alarm: a failed deploy, or three failed tool calls in five minutes, turns the office red with a beacon on the back wall and a timer pill; it ends on a green run, a good deploy, ten quiet minutes or a click, and posts a one-line postmortem.
- A context and tokens-per-minute meter under the session badge, amber past 70 % and red past 90 %, with a chat note once the context passes 85 %.
- When an agent sends another a message, it walks over to the recipient's desk and back.

## [0.7.0] - 2026-10-18

The truthful office: the project's agents, skills and task list, and Claude's own states.

### Added

- The bridge reads what Claude Code can use in the attached project (built-in, user, project and plugin agents, skills and slash commands) and the session's TaskCreate list, and follows the session when it changes directory.
- Failed tool calls, API errors and context compaction now reach the office; the hook installer registers the new events and upgrades older installs on connect.
- Ekip ve görevler panel: every agent, skill and command available in the project, with a one-line box to give one a task, and the session's task list with progress.
- The meeting-room whiteboard shows the real task list as post-its in To do, In progress and Done; a post-it flashes when it moves and clicking the board opens the list.
- Claude dozes off 30 seconds after a turn ends, tidies the desk while the context is compacted and shows a red badge after an API error.
- The Adımlar tab starts with a summary: calls per tool, failed calls with their error, run time, and a finished subagent's model and tokens.

### Changed

- Dock buttons are slightly smaller so the new Ekip button fits.

## [0.6.0] - 2026-10-17

Roadmap phase 6: polish and packaging.

### Added

- Other Claude Code sessions that wait for a permission or a question show up in the session list, light the session button and send a notification.
- "Windows ile başlat" setting that opens the office when you sign in to Windows.

### Changed

- The office renders at 60 fps only while someone walks, 30 fps while agents sit at their desks and 12 fps when it is empty.
- Installed builds run the bridge from the bundled resources folder instead of the source tree.
- The bridge rewrites its own hooks when they point at an older install of the office, so moving from the source tree to an installed build keeps working.

## [0.5.0] - 2026-10-17

Roadmap phase 5: meetings.

### Added

- Meetings: a Toplantı button in the dock asks for a topic and the participants, then sends Claude a structured meeting prompt.
- Agents in a meeting walk to the meeting room, with Claude at the head of the table, and return to their desks when it ends.
- The meeting panel shows the conversation, lets you interject, ends the meeting on request and keeps the summary on screen until you close it.
- Meeting prompts appear as short lines in the main chat.

## [0.4.0] - 2026-10-17

Roadmap phase 4: question and permission controls.

### Added

- "Ajanlar bana soru sorsun" setting. When it is off, `AskUserQuestion` is declined with a note telling Claude to choose and explain, and the office shows that Claude decided on its own.
- "Her yeni görevde sor" setting that asks Claude to check in with a short multiple-choice question before starting work sent from the office.
- "Bu oturumda hep izin ver" on permission cards, which applies the rule Claude Code suggests for that tool.
- Bridge options are remembered by the office and restored when the bridge restarts.

## [0.3.0] - 2026-10-17

Roadmap phase 3: the agent card.

### Added

- Agent panel with Sohbet and Adımlar tabs for every agent. Subagent chats come from their own transcripts, so the task Claude gave them and their replies show up.
- Typing indicator while an agent is working, showing its current step.
- Quick commands under the chat ("Ne yapıyorsun?", "Durum özeti", "Bitince dur" for Claude; status, narrow-down and wrap-up commands for subagents).
- Queued messages say where they will land: at the next step while the session is busy, or by waking it when idle.
- Windows notifications and an optional chime for permission prompts, questions and turns that ran longer than 20 seconds. Both can be switched off in the settings.
- The `?scene-demo` page now plays a whole demo session through the real panels and cards.

## [0.2.0] - 2026-10-17

Roadmap phase 2: the cozy office.

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

[Unreleased]: https://github.com/SefaSelim/claudio/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/SefaSelim/claudio/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/SefaSelim/claudio/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/SefaSelim/claudio/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/SefaSelim/claudio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/SefaSelim/claudio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/SefaSelim/claudio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SefaSelim/claudio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SefaSelim/claudio/releases/tag/v0.1.0
