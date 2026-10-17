import * as session from './session.js';

// Yan çubuk, üstte açılan paneller, izin/soru kartları ve ajan etiketleri.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ICON = {
  send: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2.5 8l11-5-4 11-2-4.5z"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

const STATE_LABEL = { think: 'düşünüyor', read: 'okuyor', write: 'yazıyor', bash: 'komut çalıştırıyor', wait: 'seni bekliyor', talk: 'görev veriyor', done: 'sıra sende' };
const MODES = {
  default: { label: 'Her şeyi sor', color: 'var(--ok)' },
  acceptEdits: { label: 'Düzenlemeler otomatik', color: 'var(--s-read)' },
  plan: { label: 'Plan modu', color: 'var(--s-plan)' },
  auto: { label: 'Otomatik mod', color: 'var(--s-talk)' },
  dontAsk: { label: 'Sormadan reddet', color: 'var(--muted)' },
  bypassPermissions: { label: 'İzinler atlanıyor', color: 'var(--warn)' },
};
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'şimdi' : m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`;
};
const shortPath = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');

export function createUI(scene) {
  const requestsEl = $('requests');
  const panelEl = $('panel');
  const dock = $('dock');
  const tagsEl = $('tags');
  const badge = $('modebadge');
  let panel = null; // { type, id? }
  let wasAttached = null;

  // ---------- ajan etiketleri ----------
  const tags = new Map(); // id -> { el, bubbleTimer }

  function tagFor(agent) {
    let tag = tags.get(agent.id);
    if (!tag) {
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = '<div class="bubble"></div><div class="name"><i class="dot"></i><span class="nm"></span></div>';
      el.addEventListener('click', () => openPanel({ type: 'agent', id: agent.id }));
      tagsEl.appendChild(el);
      tag = { el, bubbleTimer: 0 };
      tags.set(agent.id, tag);
    }
    tag.el.querySelector('.nm').textContent = agent.label;
    tag.el.style.setProperty('--c', `var(--s-${agent.state})`);
    tag.el.classList.toggle('alert', agent.state === 'wait');
    return tag;
  }

  function sayBubble(id, text) {
    const tag = tags.get(id);
    if (!tag) return;
    tag.el.querySelector('.bubble').textContent = text;
    tag.el.classList.add('speak');
    clearTimeout(tag.bubbleTimer);
    tag.bubbleTimer = setTimeout(() => tag.el.classList.remove('speak'), 3800);
  }

  scene.onFrame(() => {
    for (const [id, tag] of tags) {
      const p = scene.project(id);
      if (!p) { tag.el.hidden = true; continue; }
      tag.el.hidden = false;
      tag.el.style.left = `${p.x}px`;
      tag.el.style.top = `${p.y}px`;
    }
  });
  scene.onPick((id) => openPanel({ type: 'agent', id }));

  // ---------- yan çubuk ve rozet ----------
  function renderDock() {
    const s = session.state;
    const dot = s.attached ? 'var(--ok)' : !s.hooksInstalled || s.error ? 'var(--warn)' : 'var(--muted)';
    dock.querySelector('[data-open="session"] .condot').style.background = dot;
    for (const btn of dock.querySelectorAll('[data-open]')) {
      const k = btn.dataset.open;
      const on = panel && (panel.type === k || (k === 'chat' && panel.type === 'agent' && panel.id === 'main'));
      btn.classList.toggle('on', Boolean(on));
    }
    const count = s.requests.length;
    const b = dock.querySelector('.badge');
    b.hidden = !count;
    if (count && b.textContent !== String(count)) {
      b.textContent = count;
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
    }
  }

  dock.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (!btn) return;
    const type = btn.dataset.open;
    if (type === 'chat') openPanel(session.state.attached ? { type: 'agent', id: 'main' } : { type: 'session' });
    else openPanel({ type });
  });

  function renderBadge() {
    const s = session.state;
    let label = 'Bağlı değil';
    let color = 'var(--muted)';
    if (s.attached) {
      const m = MODES[s.mode];
      label = `${s.attached.name || 'Oturum'}${m ? ` · ${m.label}` : ''}`;
      color = m?.color ?? 'var(--ok)';
    }
    if (label.length > 46) label = label.slice(0, 45) + '…';
    badge.style.setProperty('--mc', color);
    if (badge.lastChild.textContent !== label) {
      badge.lastChild.textContent = label;
      badge.classList.remove('swap');
      void badge.offsetWidth;
      badge.classList.add('swap');
    }
  }

  // ---------- paneller ----------
  function openPanel(next) {
    const same = panel && next && panel.type === next.type && panel.id === next.id;
    panel = same ? null : next;
    if (panel?.type === 'agent' && !session.state.agents.has(panel.id)) panel = null;
    scene.select(panel?.type === 'agent' ? panel.id : null);
    renderPanel(true);
    renderDock();
    renderRequests();
  }

  function closePanel() {
    panel = null;
    scene.select(null);
    renderPanel();
    renderDock();
    renderRequests();
  }

  const head = (title, sub, extra = '', avatar = false) =>
    `<div class="ph">${avatar ? '<div class="av"><i></i></div>' : ''}<div class="t"><h3>${title}</h3><div class="s">${sub}</div></div>${extra}<button class="x" data-close aria-label="Kapat">${ICON.x}</button></div>`;

  const composer = (placeholder, disabled) =>
    `<form class="composer" id="msgForm"><input placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}" ${disabled ? 'disabled' : ''}><button class="send" type="submit" aria-label="Gönder" ${disabled ? 'disabled' : ''}>${ICON.send}</button></form>`;

  function renderPanel(animate = false) {
    if (!panel) { panelEl.innerHTML = ''; return; }
    let html = '';
    if (panel.type === 'session') html = sessionPanel();
    if (panel.type === 'settings') html = settingsPanel();
    if (panel.type === 'agent') html = agentPanel();
    panelEl.innerHTML = `<div class="card panel" data-hit${animate ? '' : ' style="animation:none"'}>${html}</div>`;
    wirePanel();
  }

  function hooksBlock(s) {
    if (s.fake) return '<div class="note">Demo modu: hook kurulumu gerekmez.</div>';
    if (s.hooksInstalled) {
      return '<div class="row"><span class="desc">Claude Code bağlantısı kurulu.</span><button class="btn ghost small" data-act="uninstall">Kaldır</button></div>';
    }
    return `<div class="note warn"><b>Önce bağlantıyı kur.</b> Ofis, <code>~/.claude/settings.json</code> dosyasına kendi hook'larını ekler (önce yedek alır). Bu hook'lar bütün Claude Code oturumlarında çalışır; ofis kapalıyken hiçbir şeyi engellemez.${s.hooksError ? `<br><b>Hata:</b> ${esc(s.hooksError)}` : ''}</div>` +
      '<button class="btn" data-act="install">Bağlantıyı kur</button>';
  }

  function sessionPanel() {
    const s = session.state;
    const list = s.sessions.length
      ? s.sessions.map((x) => {
          const on = s.attached?.sessionId === x.sessionId;
          const busy = x.status === 'busy';
          return `<button class="sess${on ? ' on' : ''}" data-sid="${esc(x.sessionId)}" style="--c:var(${busy ? '--s-write' : '--ok'})"><i class="dot${busy ? ' pulse' : ''}"></i><span class="grow"><b>${esc(x.name || shortPath(x.cwd) || x.sessionId.slice(0, 8))}</b><span>${esc(shortPath(x.cwd))} · ${busy ? 'çalışıyor' : 'boşta'} · ${ago(x.updatedAt)}</span></span>${on ? '<span class="st" style="--c:var(--ok)"><i class="dot"></i>bağlı</span>' : ''}</button>`;
        }).join('')
      : '<p class="desc">Açık Claude Code oturumu bulunamadı. Bir terminalde <code>claude</code> başlatınca burada görünür.</p>';
    const sub = s.attached ? `Bağlı: ${esc(s.attached.name || shortPath(s.attached.cwd))}` : 'Bağlanmak için bir oturum seç';
    return head('Claude Code oturumları', sub) +
      `<div class="pbody">${hooksBlock(s)}<span class="lbl">Açık oturumlar</span><div class="sesslist">${list}</div>` +
      (s.attached ? '<button class="btn ghost" data-act="detach">Bağlantıyı kes</button>' : '') +
      (s.error ? `<p class="desc warn">${esc(s.error)}</p>` : '') + '</div>';
  }

  function settingsPanel() {
    const s = session.state;
    const m = MODES[s.mode];
    return head('Ayarlar', s.attached ? esc(s.attached.name || 'Bağlı oturum') : 'Bağlı oturum yok') +
      `<div class="pbody">` +
      `<div class="row"><div><b>İzinleri ve soruları ofisten cevapla</b><p class="desc">Açıkken izin istekleri ve AskUserQuestion önce burada görünür. Kapalıyken terminalde cevaplanır.</p></div><button class="sw" role="switch" id="answerSw" aria-checked="${s.answerInOffice}" aria-label="Ofisten cevapla"></button></div>` +
      `<div class="kv"><span>Oturumun izin modu</span><b>${esc(m?.label ?? s.mode ?? 'bilinmiyor')}</b></div>` +
      `<p class="desc">İzin modunu terminalde Shift+Tab ile değiştirebilirsin. Bir izin kartında "düzenlemeleri otomatik onayla" seçersen oturum o moda geçer.</p>` +
      `</div>`;
  }

  function agentPanel() {
    const s = session.state;
    const agent = s.agents.get(panel.id);
    const isMain = panel.id === 'main';
    const sub = isMain ? esc(s.attached?.name || 'Ana ajan') : esc(agent.description || agent.type);
    const st = `<span class="st live" style="--c:var(--s-${agent.state})" id="agentState"><i class="dot"></i><span>${STATE_LABEL[agent.state] ?? agent.state}</span></span>`;
    const body = isMain ? '<div class="thread" id="thread"></div>' : '<div class="steps" id="steps"></div>';
    const placeholder = isMain ? "Claude'a yaz…" : `${agent.label}'a yaz (bir sonraki adımında görür)…`;
    return head(esc(agent.label), sub, st, true) + `<div class="pbody scroll" id="pbody">${body}</div>` + composer(placeholder, !s.attached);
  }

  function renderThread() {
    const el = $('thread');
    if (!el) return;
    const items = session.state.chat;
    el.innerHTML = items.length
      ? items.map((m) => {
          const cls = m.role === 'user' ? 'me' : m.role === 'system' ? 'sys' : 'ag';
          const status = m.role === 'user' && (m.pending || m.via)
            ? `<span class="dl">${m.pending ? 'iletilmeyi bekliyor…' : `iletildi · ${esc(m.via)}`}</span>` : '';
          return `<div class="m ${cls}${m.pending ? ' pending' : ''}">${esc(m.text)}${status}</div>`;
        }).join('')
      : '<div class="m sys">Henüz mesaj yok.</div>';
    const body = $('pbody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderSteps() {
    const el = $('steps');
    if (!el) return;
    const steps = session.state.agents.get(panel.id)?.steps ?? [];
    el.innerHTML = steps.length
      ? steps.slice(-20).map((st) => `<div class="step ${st.status}"><span class="tm">${st.time}</span><span>${esc(st.detail)}</span></div>`).join('')
      : '<div class="m sys">Henüz adım yok.</div>';
    const body = $('pbody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function wirePanel() {
    const root = panelEl.firstElementChild;
    if (!root) return;
    root.querySelector('[data-close]').addEventListener('click', closePanel);
    for (const btn of root.querySelectorAll('[data-act]')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'install') { btn.disabled = true; session.installHooks(); }
        if (act === 'uninstall') session.uninstallHooks();
        if (act === 'detach') session.detach();
      });
    }
    for (const btn of root.querySelectorAll('[data-sid]')) {
      btn.addEventListener('click', () => {
        if (session.state.attached?.sessionId !== btn.dataset.sid) session.attach(btn.dataset.sid);
      });
    }
    const sw = $('answerSw');
    if (sw) sw.addEventListener('click', () => {
      const value = !session.state.answerInOffice;
      sw.setAttribute('aria-checked', value);
      session.setAnswerInOffice(value);
    });
    const msg = $('msgForm');
    if (msg) {
      msg.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = msg.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        session.sendMessage(text, panel.id);
        if (panel.id !== 'main') sayBubble(panel.id, 'Mesajın bir sonraki adımımda bana ulaşacak');
      });
      setTimeout(() => msg.querySelector('input:not([disabled])')?.focus({ preventScroll: true }), 60);
    }
    renderThread();
    renderSteps();
  }

  // ---------- izin ve soru kartları ----------
  function renderRequests() {
    const reqs = session.state.requests;
    // Açık ajan panelinin isteği öne gelir; panel açıkken tek kart gösterilir.
    const focus = panel?.type === 'agent' ? panel.id : null;
    const sorted = [...reqs].sort((a, b) => (b.agentId === focus) - (a.agentId === focus));
    const visible = sorted.slice(0, panel ? 1 : 2);
    const existing = new Map([...requestsEl.querySelectorAll('.qc')].map((el) => [el.dataset.id, el]));
    requestsEl.innerHTML = '';
    if (reqs.length > visible.length) {
      const more = document.createElement('button');
      more.className = 'more';
      more.dataset.hit = '';
      more.textContent = `+${reqs.length - visible.length} istek daha${panel ? ' · paneli kapat' : ''}`;
      more.addEventListener('click', () => panel && closePanel());
      requestsEl.appendChild(more);
    }
    visible.reverse().forEach((req, i) => {
      let el = existing.get(req.requestId);
      if (!el) {
        el = req.kind === 'question' ? questionCard(req) : permissionCard(req);
        el.style.setProperty('--i', i);
      } else {
        el.style.animation = 'none';
      }
      requestsEl.appendChild(el);
    });
  }

  const agentLabel = (id) => session.state.agents.get(id)?.label ?? 'Claude';
  const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

  function permissionCard(req) {
    const el = document.createElement('div');
    el.className = 'card qc perm';
    el.dataset.hit = '';
    el.dataset.id = req.requestId;
    const input = req.input ?? {};
    const detail = input.command ?? input.file_path ?? input.url ?? input.pattern ?? JSON.stringify(input).slice(0, 160);
    el.innerHTML =
      `<div class="qh"><span class="mini-av"></span>${esc(agentLabel(req.agentId))} izin istiyor</div>` +
      `<div class="q">${esc(req.toolName)}</div><pre>${esc(detail)}</pre>` +
      `<div class="row start"><button class="btn" data-a="allow">İzin ver</button><button class="btn ghost" data-a="deny">Reddet</button>` +
      (EDIT_TOOLS.has(req.toolName) ? '<button class="btn ghost" data-a="edits">İzin ver + düzenlemeleri otomatik onayla</button>' : '') +
      `<button class="link" data-a="terminal">Terminalde cevapla</button></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      const result = a === 'allow' ? { behavior: 'allow' }
        : a === 'edits' ? { behavior: 'allow', mode: 'acceptEdits' }
        : a === 'terminal' ? { behavior: 'terminal' }
        : { behavior: 'deny' };
      leave(el, () => session.answerRequest(req.requestId, result));
    });
    return el;
  }

  function questionCard(req) {
    const el = document.createElement('div');
    el.className = 'card qc';
    el.dataset.hit = '';
    el.dataset.id = req.requestId;
    const questions = req.input?.questions ?? [];
    const picks = questions.map(() => new Set());
    const custom = questions.map(() => '');
    el.innerHTML =
      `<div class="qh"><span class="mini-av"></span>${esc(agentLabel(req.agentId))} soruyor</div>` +
      questions.map((q, qi) =>
        `<div class="qblock">${q.header ? `<span class="chip-h">${esc(q.header)}</span>` : ''}<div class="q">${esc(q.question)}</div>` +
        `<div class="opts">${(q.options ?? []).map((o, oi) => `<button type="button" class="opt" data-q="${qi}" data-o="${oi}"><b>${esc(o.label)}</b>${o.description ? `<span>${esc(o.description)}</span>` : ''}</button>`).join('')}</div>` +
        `<input class="field other" data-q="${qi}" placeholder="Başka bir cevap…" autocomplete="off"></div>`).join('') +
      `<div class="row start"><button class="btn" data-send disabled>Gönder</button><button class="link" data-terminal>Terminalde cevapla</button></div>`;
    const sendBtn = el.querySelector('[data-send]');
    const refresh = () => {
      el.querySelectorAll('.opt').forEach((b) => b.classList.toggle('picked', picks[b.dataset.q].has(Number(b.dataset.o))));
      sendBtn.disabled = !questions.every((_, qi) => picks[qi].size || custom[qi]);
    };
    el.addEventListener('click', (e) => {
      const opt = e.target.closest('.opt');
      if (opt) {
        const qi = Number(opt.dataset.q), oi = Number(opt.dataset.o);
        if (questions[qi].multiSelect) picks[qi].has(oi) ? picks[qi].delete(oi) : picks[qi].add(oi);
        else { picks[qi].clear(); picks[qi].add(oi); }
        refresh();
      }
      if (e.target.closest('[data-terminal]')) leave(el, () => session.answerRequest(req.requestId, { behavior: 'terminal' }));
      if (e.target.closest('[data-send]') && !sendBtn.disabled) {
        const answers = {};
        questions.forEach((q, qi) => {
          answers[q.question] = custom[qi] || [...picks[qi]].map((oi) => q.options[oi].label).join(', ');
        });
        leave(el, () => session.answerRequest(req.requestId, { behavior: 'allow', answers }));
      }
    });
    el.addEventListener('input', (e) => {
      const f = e.target.closest('.other');
      if (!f) return;
      custom[f.dataset.q] = f.value.trim();
      refresh();
    });
    return el;
  }

  function leave(el, then) {
    el.classList.add('out');
    setTimeout(then, 200);
  }

  // ---------- olaylar ----------
  session.subscribe((change) => {
    switch (change.kind) {
      case 'agent_added':
        scene.addAgent(change.agent.id, change.agent.type);
        scene.setState(change.agent.id, change.agent.state);
        tagFor(change.agent);
        break;
      case 'agent_updated':
        scene.setState(change.agent.id, change.agent.state);
        tagFor(change.agent);
        if (panel?.type === 'agent' && panel.id === change.agent.id) {
          const st = $('agentState');
          if (st) {
            st.style.setProperty('--c', `var(--s-${change.agent.state})`);
            st.lastChild.textContent = STATE_LABEL[change.agent.state] ?? change.agent.state;
          }
          renderSteps();
        }
        break;
      case 'agent_removed': {
        scene.removeAgent(change.agent.id);
        const tag = tags.get(change.agent.id);
        if (tag) { tag.el.remove(); tags.delete(change.agent.id); }
        if (panel?.type === 'agent' && panel.id === change.agent.id) closePanel();
        break;
      }
      case 'say':
        sayBubble(change.id, change.text);
        break;
      case 'chat':
        renderThread();
        break;
      case 'requests':
        renderRequests();
        renderDock();
        break;
      case 'sessions':
        renderBadge();
        if (panel?.type === 'session') renderPanel();
        break;
      case 'status':
      case 'error': {
        renderDock();
        renderBadge();
        const id = session.state.attached?.sessionId ?? null;
        const justAttached = id && id !== wasAttached;
        wasAttached = id;
        // Bağlanınca sohbet paneline geç; geçmiş orada görünür.
        if (justAttached) { panel = { type: 'agent', id: 'main' }; scene.select('main'); renderPanel(true); renderDock(); }
        else if (panel?.type === 'agent' && !session.state.agents.has(panel.id)) closePanel();
        else if (panel && panel.type !== 'agent') renderPanel();
        break;
      }
    }
  });

  renderDock();
  renderBadge();
  return { openPanel };
}
