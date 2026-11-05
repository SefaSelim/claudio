# Other agent managers, and what Claudio takes from them

Last updated: 2026-11-04. A survey of tools that run, watch or visualise Claude Code sessions,
read against Claudio's principles from [plan-v1.md](plan-v1.md): truthful, quiet by default,
one click deep, no new runtime dependencies.

## The landscape

| Tool | Shape | How it sees Claude Code | Stand-out ideas |
|---|---|---|---|
| [Pixel Agents](https://github.com/pablodelucca/pixel-agents) | VS Code extension, pixel-art office | Reads transcripts, no hooks | Characters per terminal, sub-agent visualisation, saved office layouts, a browser mode (`npx pixel-agents`) for tmux and remote work. Known to desync when terminals are opened and closed quickly. |
| [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) | Browser and Electron pixel office | Hooks | Turn acting, task board, signals and incident mode, meters. The source of Claudio's 0.7–0.10 roadmap. |
| Claude Squad, [crystl](https://crystl.dev/blog/desktop-app-gui-multiple-claude-code-sessions/), Conductor, Vibe Kanban, Orchestrator | TUI / desktop apps that *launch* agents | Own the process, usually one git worktree per agent | Parallel agents without merge conflicts, diff review before merge, kanban of tasks. |
| Claude Code desktop app, Agent View | Anthropic's own | Native | Sidebar of concurrent sessions; terminal dashboard of sessions. |
| [claude-pulse](https://github.com/nikitadoudikov/claude-pulse/wiki) | Local web dashboard | Hooks | Spend, approve tool calls from the phone, "needs you" and "turn ended" notifications. |
| [Claude Code Agent Monitor](https://github.com/7P3ng/Claude-Code-Agent-Monitor), [Claude Visual](https://github.com/kl0sin/claude-visual/releases/tag/v0.1.0), Claude Insights | Web dashboards | Hooks into Express/SQLite or FastAPI | Live timeline of every tool call, sub-agent orchestration graphs, history. |
| [Claude Radar](https://github.com/coderlevelup/claude-radar) | Web dashboard | Hooks | Board and timeline views, a floating picture-in-picture window of active sessions. |
| [ccmonitor](https://pkg.go.dev/github.com/martinwickman/ccmonitor), [claude-vigie](https://pkg.go.dev/github.com/haribo/claude-vigie@v0.6.0) | Terminal dashboards | Hooks plus transcript watcher | Working / waiting / idle per session; jump to the right tmux pane or Windows Terminal tab; several machines. |

## Where Claudio already stands out

- **Two-way, no API key.** Most monitors are read-only or launch their own processes. Claudio
  talks to the session you already run: messages, attachments, permissions, questions and
  meetings, all through hooks.
- **Always on top, not in a tab.** Dashboards live in a browser tab you have to look at; the
  office sits in the corner (Claude Radar's picture-in-picture is the closest).
- **Office agents with their own sessions** cover the "several agents in parallel" use case
  without worktree management.

## Taken in this round

| Idea | From | In Claudio |
|---|---|---|
| Turn timeline | Claude Visual, claude-pulse, Agent Monitor | One recap row when a turn ends: time, tools, failures, sub-agents, edited files. |
| Working / waiting / idle per session | ccmonitor, Claude Radar | Other sessions get a quiet "done · your turn" mark when their turn ends. |
| Try it in a browser | Pixel Agents' browser mode | A public demo on GitHub Pages, built from the existing scene demo. |

## Considered, left for later

- **Jump to the terminal** (ccmonitor). Useful, but needs per-terminal APIs (Windows Terminal,
  tmux) that Claudio does not have yet. A good 1.x candidate.
- **Diff review of edited files** (Conductor, crystl). The recap lists the files; a diff view
  would need git access from the bridge and a new panel.
- **Approve from the phone** (claude-pulse). Opens the bridge beyond `127.0.0.1`; not without a
  security design.
- **Cost meter.** Still left out, as in plan-v1: it needs the status line.
- **Worktree-per-agent launching** (Claude Squad, Orchestrator). A different product: Claudio
  watches the sessions you run rather than running them for you.
