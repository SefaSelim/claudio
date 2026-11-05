// Turn recap: what one turn of the attached session did, from the hooks alone.
// Dashboards like Claude Visual or claude-pulse show this as a timeline; the office keeps it
// to one quiet chat row when the turn ends.

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function createTurnTracker(now = () => Date.now()) {
  let turn = null;

  const ensure = () => (turn ??= { startedAt: now(), tools: 0, failures: 0, files: new Set(), agents: new Set() });

  return {
    /** Feed every hook event of the attached session. */
    hook(evt) {
      switch (evt.event) {
        case 'UserPromptSubmit':
          turn = null;
          ensure();
          break;
        case 'PreToolUse': {
          const t = ensure();
          t.tools += 1;
          const file = evt.tool_input?.file_path ?? evt.tool_input?.notebook_path;
          if (EDIT_TOOLS.has(evt.tool_name) && typeof file === 'string' && file) t.files.add(file);
          break;
        }
        case 'PostToolUseFailure':
          if (!/interrupt/i.test(evt.error ?? '')) ensure().failures += 1;
          break;
        case 'SubagentStart':
          if (evt.agent_id) ensure().agents.add(evt.agent_id);
          break;
        default:
          break;
      }
    },
    /** Ends the turn and returns its recap, or null when nothing happened worth a row. */
    finish() {
      const t = turn;
      turn = null;
      if (!t || t.tools === 0) return null;
      return { ms: now() - t.startedAt, tools: t.tools, failures: t.failures, files: [...t.files], agents: t.agents.size };
    },
    reset() {
      turn = null;
    },
  };
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sn`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} dk ${s % 60} sn` : `${m} dk`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

const base = (p) => String(p).split(/[\\/]/).pop();

/** One Turkish line for the chat (the product language). */
export function formatRecap(r) {
  const parts = [formatDuration(r.ms), `${r.tools} araç`];
  if (r.failures) parts.push(`${r.failures} başarısız`);
  if (r.agents) parts.push(`${r.agents} alt ajan`);
  if (r.files.length) {
    const names = r.files.slice(0, 3).map(base).join(', ');
    parts.push(`${r.files.length} dosya düzenlendi (${names}${r.files.length > 3 ? ', …' : ''})`);
  }
  return `Tur bitti · ${parts.join(' · ')}`;
}
