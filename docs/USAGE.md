# How to use Claudio Office

This guide covers what you need to know the first time you set up the office, in order. For the
architecture and development, see the [README](../README.md).

## 1. Install

1. Install [Node.js 20 or newer](https://nodejs.org). The office's bridge runs on Node.
2. Download `Claudio Office_<version>_x64-setup.exe` from the
   [Releases](https://github.com/SefaSelim/claudio/releases) page and run it. If Windows
   SmartScreen says "unknown publisher", click **More info → Run anyway**.
3. The office opens in the bottom-right corner of the screen. It doesn't appear in the taskbar
   and always stays above other windows.

To run from source: `npm install`, then `npm run tauri dev`.

## 2. Connect to Claude Code

1. Press the **chain** button (Sessions) on the dock.
2. The first time, press **Set up the connection**. The office backs up your
   `~/.claude/settings.json` as `settings.json.claudio-backup` and adds only its own hooks.
   Running sessions don't need a restart.
3. Start `claude` in a terminal, or use one that's already running. The session shows up in
   the list; click it.

Once attached, the main agent "Claude" sits down at its desk and the chat panel opens. No API key
is needed: the office watches the running session itself.

While the office is closed, the hooks don't block anything and Claude Code works as usual. To
take the hooks out, press **Remove** in the same panel.

## 3. The dock

The dock sits on the office's right edge and is transparent. Only the room itself catches clicks;
clicks on the empty corners around it go through to the windows below.

**Folding away:** the small **›** arrow on the office's left edge folds the office to the right,
leaving only the dock. The **‹** arrow to the left of the dock brings it back. The scene stops
drawing while the office is folded, and the office remembers the state next time it opens.

From top to bottom:

| Button | What it does |
|---|---|
| Six dots | Drag to move the office in any direction. If you let go past a screen edge, it slides back inside with a small margin. Double-click to go back to the bottom-right corner. |
| Chain | Sessions: attach and detach. Blinks when another session is waiting for you. |
| Speech bubble | Write to Claude. The red number counts permissions and questions waiting for you. |
| Two people | Meeting. |
| Squares | Team and tasks. |
| Moon / sun | Evening and daytime light. A click pins it; a right-click goes back to following the clock. |
| Gear | Settings. |
| Cross | Quit the office. |

## 4. Talking to Claude

- Type in the **Chat** tab and press Enter. Below your message the office shows how it will be
  delivered:
  - If Claude is working, it sees the message at its next step.
  - If the turn is about to end, it sees it at the end of the turn.
  - If Claude is idle, the office wakes it up.
- **Images and files:** the paperclip button, pasting with Ctrl+V, or drag and drop. Claude opens
  the files itself.
- **Quick commands:** the small buttons above the text box ("What are you doing?", "Status
  summary", "Stop when done").
- **The "You" character:** while attached, a blue felt character waits by the beanbag. When you
  send a message from the office, it carries it to Claude's or the subagent's desk and walks
  back. Switch it off in Settings with "Show me in the office".
- **Office commands:** these commands, typed in Claude's chat with a leading slash, don't go to
  Claude; the office runs them:

  | Command | What it does |
  |---|---|
  | `/status` | Claude's state, subagents, tasks, context and waiting requests |
  | `/agents` | The agents in the office and what they are doing |
  | `/tasks` | Opens the task list |
  | `/meeting topic` | Opens the meeting panel with the topic filled in |
  | `/alarm reason` | Starts the alarm by hand; `/all-clear` turns it off |
  | `/clear` | Clears the office's chat view (the session is not touched) |
  | `/help` | This list |

  Other messages that start with a slash go to Claude as plain text; Claude Code's own commands
  run in the terminal.
- The **Steps** tab shows the tools the agent used, failed calls in red, the total run time and,
  once a subagent finishes, its model and token count.
- **Turn recap:** when a turn ends, the chat gets one line with how long it took, how many tools
  ran, failures, subagents and the files that were edited.

## 5. Subagents

When Claude launches a subagent, a character walks in through the door, sits at a free desk and
leaves when the work is done. Click the character to open that agent's card:

- **Chat**: the task Claude gave it and what the agent wrote.
- A message you write from this card goes **to that agent only** and reaches it at its next step.

## 6. Permissions and questions

When Claude asks for permission to run something, or asks a question with `AskUserQuestion`, a
card opens above the office:

- **Allow** / **Deny**.
- **Always allow in this session**: applies the rule Claude Code suggested.
- **Allow + auto-accept edits**: shown for file edits; switches the session to that mode.
- **Answer in the terminal**: leaves the decision to the terminal.

In Settings:

- With **Answer permissions and questions in the office** off, everything is asked in the
  terminal.
- With **Let agents ask me questions** off, Claude picks the sensible option instead of asking
  and writes down why.
- With **Ask before every new task** on, Claude asks a short question before each job you give
  from the office.

## 7. Office agents

You can put agents of your choice in the office. Each office agent runs in **its own Claude Code
session** (through the `claude` command on your computer, with your login; no API key needed):

- **Separate context:** each agent has its own conversation history. Every task you give it
  continues in the same session, and it remembers even after you close and reopen the office.
- **At most 5 agents** can be in the office at once. Send one home to make room for another.
- **Desk and sofa:** an agent with a task goes to its desk; when it's done it sits on the
  **L-shaped sofa** in the cozy corner (or the beanbag).
- **Permissions and questions:** the agents' permission requests and questions also arrive as
  cards in the office.

The **Squares** button opens the team panel:

| Tab | What's there |
|---|---|
| **Office** | The agents in the office, their state, and "Send home" (click the cross twice). Click an agent to open its card. |
| **Library** | Agents you can add: the built-in general assistant, the project's `.claude/agents` folder, `~/.claude/agents`, enabled plugins and the repositories you imported. There's a search box and a collapsible list per source. **Add to office** brings the agent in through the door. |
| **Skills** | The project's skills and slash commands; gives the job you pick to Claude in the attached session. |
| **Tasks** | The task list Claude keeps with `TaskCreate`. |

**Agents from a repository:** in the Library tab, press **Import** for the recommended **Claude
Code Game Studios** (49 agents: directors, programmers, designers, QA and release specialists),
or type the address of any GitHub repository in the box at the bottom. The office downloads only
the repository's `.claude/agents` (or `agents`) folder; Git must be installed. Remove an imported
source with "remove".

**Giving a task:** click the agent and write in the box on its card. If the agent is working,
your message reaches it at its next step. The **Stop** button interrupts the current job; the
context is kept.

To add your own agent to a project, create a `.claude/agents/<name>.md` file:

```markdown
---
name: reviewer
description: Reviews changes for bugs and security issues.
tools: Read, Grep, Glob
model: sonnet
---

You are a meticulous code reviewer...
```

The **whiteboard** in the meeting room shows the attached session's task list as post-its: yellow
to do, blue in progress, green done, a red dot for a task waiting on another. Click the
whiteboard to open the task list.

## 8. Meetings

**With office agents** (when there are agents in the office):

1. Press the **two people** button, write the topic, tick the agents who join, then **Start the
   meeting**.
2. The agents walk to the meeting room. An agent that was working pauses its job.
3. Each agent speaks in turn, in its own session, and hears what was said before it. They don't
   change files in a meeting.
4. You can **jump in** from the box at the bottom; what you say goes to everyone next in line and
   starts a new round.
5. When you press **End the meeting**, the first participant writes a summary. Agents that
   paused **pick up where they left off** after the meeting, and the meeting stays in their
   context.

With no agents in the office, Claude in the attached session runs the meeting. Subagents no longer
join meetings, because a meeting used to cut their work short.

## 9. Signals, alarm and meter

The office reads what the commands the agents run mean:

| Icon | Meaning |
|---|---|
| 🚀 | A deploy is running (vercel, fly, kubectl, terraform, `gh release create`, a tag push…) |
| 🔨 | A build is running (`npm run build`, `vite build`, `cargo build`, `tsc`…) |
| 🧪 | Tests are running (`npm test`, `vitest`, `pytest`, `cargo test`…) |
| ⬆️ | `git push` |
| ✅ / ❌ | The command finished: success or failure. A failure adds a short line to the chat. |

**Alarm:** if a deploy fails, or three tool calls fail within five minutes, the office turns red,
the light on the back wall comes on and a timed **Alarm** button appears at the top right. It ends
when tests or the build turn green again, a deploy succeeds, ten minutes pass with no new failure,
or you click the button; a short summary goes into the chat.

**Meter:** the bar under the session badge shows how full Claude's context window is and the
tokens per minute over the last five minutes. It turns yellow after 70% and red after 90%. Hover
over it for details.

When an agent writes to another with `SendMessage`, it walks to that agent's desk to deliver the
message and comes back.

## 10. Reading the office

| What you see | What it means |
|---|---|
| Arms up, jumping | Waiting for you (a permission or a question). |
| Tapping the keyboard | Writing a file or running a command. |
| Head down, "z z" | The turn is over and it's dozing. Writing to it wakes it up. |
| Sweeping the desk | The context is full and Claude Code is compacting the conversation. |
| A red "!" | The turn ended with an API error (a rate limit, for example). |
| A speech bubble | The last thing the agent said. |

## 11. Settings, tray and keyboard

- **Windows notifications** and **Sound**: for permissions, questions, a long turn finishing and
  the end of a meeting.
- **Start with Windows**: the office opens on its own when you sign in.
- The session's permission mode is shown in Settings; change it in the terminal with Shift+Tab.
- **Diagnostics**: Node.js, the Claude Code hooks, the last hook received, the number of running
  sessions and the bridge version. If the hooks are missing or outdated, a **Repair the
  connection** button appears.

**Tray icon** (next to the clock): a click hides or shows the office. The right-click menu has
"Always on top", "Move to the bottom-right corner" and "Quit the office". Hovering over it tells
you how many requests are waiting for you.

**Keyboard** (while the office has focus and you're not in a text box):

| Key | What it does |
|---|---|
| Enter or Y | Allow on the front permission card |
| N | Deny |
| T | Answer in the terminal |
| 1-9 | Pick an option on a question card; Enter sends |
| Esc | Close the open panel |

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| I don't know what's missing | Settings → **Diagnostics** checks every step one by one. |
| I hid the office and it won't come back | Click the tray icon next to the clock. |
| The session list is empty | Run `claude` in a terminal. The list comes from the `~/.claude/sessions` folder. |
| I'm attached but nothing moves | Check in the Sessions panel that the connection is set up. Movement starts when Claude uses its first tool. |
| My message is stuck on "waiting to be delivered" | Claude may be running a long tool; the message is delivered when it finishes. An idle session wakes up within a few seconds. |
| "The bridge stopped" | Quit and reopen the office. Make sure Node.js is installed. |
| Undoing the hooks completely | Press **Remove** in the Sessions panel, or restore the `~/.claude/settings.json.claudio-backup` backup. |
