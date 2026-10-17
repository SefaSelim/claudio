import * as session from './session.js';

// Yan çubuk, üstte açılan paneller, izin/soru kartları ve ajan etiketleri.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ICON = {
  send: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2.5 8l11-5-4 11-2-4.5z"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

const STATE_LABEL = { think: 'düşünüyor', read: 'okuyor', write: 'yazıyor', bash: 'komut çalıştırıyor', wait: 'seni bekliyor', talk: 'görev veriyor', done: 'bitti' };
const MODES = {
  default: { label: 'Sor', badge: 'İzin: her şeyi sor', color: 'var(--ok)', desc: 'Dosya düzenleme ve komutlar için her seferinde izin istenir.' },
  acceptEdits: { label: 'Düzenle', badge: 'İzin: düzenlemeler otomatik', color: 'var(--s-read)', desc: 'Dosya düzenlemeleri otomatik onaylanır, komutlar için izin istenir.' },
  plan: { label: 'Plan', badge: 'Plan modu', color: 'var(--s-plan)', desc: 'Ajanlar sadece okur ve plan yazar; hiçbir dosya değişmez.' },
  bypassPermissions: { label: 'Atla', badge: 'İzinler atlanıyor', color: 'var(--warn)', desc: 'Tüm araçlar onaysız çalışır. Yalnızca güvendiğin projede kullan.', warn: true },
};

const prefs = { mode: 'default', ask: true };

export function createUI(scene) {
  const requestsEl = $('requests');
  const panelEl = $('panel');
  const dock = $('dock');
  const tagsEl = $('tags');
  const badge = $('modebadge');
  let panel = null; // { type, id? }
  let wasRunning = false;

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

  // ---------- yan çubuk ----------
  function renderDock() {
    const s = session.state;
    const dot = s.running ? 'var(--ok)' : s.authRequired || s.error ? 'var(--warn)' : 'var(--muted)';
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
    if (type === 'chat') openPanel({ type: 'agent', id: 'main' });
    else openPanel({ type });
  });

  function renderBadge() {
    const m = MODES[session.state.mode] ?? MODES.default;
    badge.style.setProperty('--mc', m.color);
    const label = session.state.running ? m.badge : 'Oturum kapalı';
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
    if (panel?.type === 'agent' && !session.state.agents.has(panel.id) && panel.id !== 'main') panel = null;
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

  function head(title, sub, extra = '', avatar = false) {
    return `<div class="ph">${avatar ? '<div class="av"><i></i></div>' : ''}<div class="t"><h3>${title}</h3><div class="s">${sub}</div></div>${extra}<button class="x" data-close aria-label="Kapat">${ICON.x}</button></div>`;
  }

  function composer(id, placeholder, disabled) {
    return `<form class="composer" id="${id}"><input placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}" ${disabled ? 'disabled' : ''}><button class="send" type="submit" aria-label="Gönder" ${disabled ? 'disabled' : ''}>${ICON.send}</button></form>`;
  }

  function renderPanel(animate = false) {
    if (!panel) { panelEl.innerHTML = ''; return; }
    const s = session.state;
    let html = '';
    if (panel.type === 'session') html = sessionPanel(s);
    if (panel.type === 'settings') html = settingsPanel(s);
    if (panel.type === 'agent') html = agentPanel(s);
    panelEl.innerHTML = `<div class="card panel" data-hit${animate ? '' : ' style="animation:none"'}>${html}</div>`;
    wirePanel();
  }

  function sessionPanel(s) {
    if (s.running) {
      return head('Bağlı oturum', esc(s.cwd), '<span class="st live" style="--c:var(--ok)"><i class="dot"></i>açık</span>') +
        `<div class="pbody"><div class="kv"><span>Model</span><b>${esc(s.model || '…')}</b></div><div class="kv"><span>İzin modu</span><b>${esc(MODES[s.mode]?.label ?? s.mode)}</b></div><div class="kv"><span>Ajanlar</span><b>${s.agents.size}</b></div>` +
        `<div class="row"><button class="btn ghost" data-act="interrupt">Durdur</button><button class="btn ghost" data-act="stop">Oturumu kapat</button></div></div>`;
    }
    const auth = !s.hasCredentials || s.authRequired;
    return head('Oturum başlat', 'Ofis yeni bir Claude oturumu açar') +
      `<form class="pbody" id="startForm">` +
      (auth ? `<div class="note warn"><b>API anahtarı gerekli.</b> Agent SDK ile yapılan uygulamalar claude.ai girişini kullanamıyor. Claude Console'dan bir anahtar al, PowerShell'de <code>setx ANTHROPIC_API_KEY "anahtar"</code> çalıştır, terminali ve ofisi kapatıp yeniden aç.</div>` : '') +
      `<label class="f"><span class="lbl">Proje klasörü</span><input class="field" id="cwd" value="${esc(s.cwd || s.defaultCwd)}" autocomplete="off"></label>` +
      `<label class="f"><span class="lbl">İlk mesaj</span><textarea class="field" id="prompt" rows="3" placeholder="Bugün ne yapalım?"></textarea></label>` +
      `<span class="lbl">İzin modu</span>${modeSeg(prefs.mode)}<p class="desc ${MODES[prefs.mode].warn ? 'warn' : ''}" id="modeDesc">${esc(MODES[prefs.mode].desc)}</p>` +
      `<div class="row"><span class="desc">Ajanlar soru sorsun</span><button type="button" class="sw" role="switch" id="askSw" aria-checked="${prefs.ask}" aria-label="Ajanlar soru sorsun"></button></div>` +
      `<button class="btn" type="submit" id="startBtn" ${auth ? 'disabled' : ''}>Oturumu başlat</button></form>`;
  }

  function settingsPanel(s) {
    const mode = s.running ? s.mode : prefs.mode;
    return head('Ayarlar', s.running ? 'Bağlı oturuma anında uygulanır' : 'Sonraki oturumda geçerli') +
      `<div class="pbody"><span class="lbl">İzin modu</span>${modeSeg(mode)}<p class="desc ${MODES[mode]?.warn ? 'warn' : ''}" id="modeDesc">${esc(MODES[mode]?.desc ?? '')}</p>` +
      `<div class="row"><div><b>Ajanlar soru sorsun</b><p class="desc">Çoktan seçmeli sorularla işi şekillendirirsin. Yeni oturumda geçerli olur.</p></div><button class="sw" role="switch" id="askSw" aria-checked="${prefs.ask}" aria-label="Ajanlar soru sorsun"></button></div></div>`;
  }

  function modeSeg(active) {
    return `<div class="seg" id="modeSeg"><span class="ind"></span>${Object.entries(MODES).map(([k, m]) => `<button type="button" data-v="${k}" aria-pressed="${k === active}">${m.label}</button>`).join('')}</div>`;
  }

  function agentPanel(s) {
    const agent = s.agents.get(panel.id) ?? { id: 'main', label: 'Claude', type: 'main', state: 'done', steps: [] };
    const sub = agent.kind === 'sub' ? esc(agent.description || agent.type) : 'Ana ajan';
    const state = `<span class="st live" style="--c:var(--s-${agent.state})" id="agentState"><i class="dot"></i><span>${STATE_LABEL[agent.state] ?? agent.state}</span></span>`;
    const body = panel.id === 'main' ? '<div class="thread" id="thread"></div>' : '<div class="steps" id="steps"></div>';
    const placeholder = panel.id === 'main' ? "Claude'a yaz…" : `${agent.label}'a yaz (Claude iletir)…`;
    return head(esc(agent.label), sub, state, true) + `<div class="pbody scroll" id="pbody">${body}</div>` + composer('msgForm', placeholder, !s.running);
  }

  function renderThread() {
    const el = $('thread');
    if (!el) return;
    el.innerHTML = session.state.chat.map((m) => `<div class="m ${m.role === 'user' ? 'me' : m.role === 'system' ? 'sys' : 'ag'}">${esc(m.text)}</div>`).join('') ||
      '<div class="m sys">Henüz mesaj yok.</div>';
    const body = $('pbody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderSteps() {
    const el = $('steps');
    if (!el) return;
    const agent = session.state.agents.get(panel.id);
    const steps = agent?.steps ?? [];
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

    const seg = $('modeSeg');
    if (seg) segInit(seg, (mode) => {
      const m = MODES[mode];
      const d = $('modeDesc');
      d.textContent = m.desc;
      d.classList.toggle('warn', Boolean(m.warn));
      prefs.mode = mode;
      if (session.state.running && panel.type === 'settings') session.setMode(mode);
    });
    const sw = $('askSw');
    if (sw) sw.addEventListener('click', () => {
      prefs.ask = !prefs.ask;
      sw.setAttribute('aria-checked', prefs.ask);
    });

    const start = $('startForm');
    if (start) {
      start.addEventListener('submit', (e) => {
        e.preventDefault();
        const prompt = $('prompt').value.trim();
        if (!prompt) return $('prompt').focus();
        $('startBtn').disabled = true;
        session.startSession({ cwd: $('cwd').value.trim(), prompt, permissionMode: prefs.mode, ask: prefs.ask });
      });
      setTimeout(() => $('prompt')?.focus({ preventScroll: true }), 60);
    }

    for (const btn of root.querySelectorAll('[data-act]')) {
      btn.addEventListener('click', () => (btn.dataset.act === 'stop' ? session.stopSession() : session.interrupt()));
    }

    const msg = $('msgForm');
    if (msg) {
      msg.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = msg.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        session.sendMessage(text, panel.id);
        if (panel.id !== 'main') sayBubble(panel.id, 'Mesajın Claude üzerinden iletiliyor');
      });
      setTimeout(() => msg.querySelector('input:not([disabled])')?.focus({ preventScroll: true }), 60);
    }
    renderThread();
    renderSteps();
  }

  function segInit(seg, onPick) {
    const ind = seg.querySelector('.ind');
    const buttons = [...seg.querySelectorAll('button')];
    const place = () => {
      const on = buttons.find((b) => b.getAttribute('aria-pressed') === 'true') ?? buttons[0];
      ind.style.width = `${on.offsetWidth}px`;
      ind.style.transform = `translateX(${on.offsetLeft - 3}px)`;
    };
    ind.style.transition = 'none';
    place();
    requestAnimationFrame(() => { ind.style.transition = ''; });
    for (const b of buttons) {
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-pressed') === 'true') return;
        for (const x of buttons) x.setAttribute('aria-pressed', x === b);
        place();
        onPick(b.dataset.v);
      });
    }
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
        el = req.toolName === 'AskUserQuestion' ? questionCard(req) : permissionCard(req);
        el.style.setProperty('--i', i);
      } else {
        el.style.animation = 'none';
      }
      requestsEl.appendChild(el);
    });
  }

  function agentLabel(id) {
    return session.state.agents.get(id)?.label ?? 'Claude';
  }

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
      (req.reason ? `<p class="desc">${esc(req.reason)}</p>` : '') +
      `<div class="row start"><button class="btn" data-a="allow">İzin ver</button><button class="btn ghost" data-a="deny">Reddet</button></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      leave(el, () => session.answerRequest(req.requestId, b.dataset.a === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Kullanıcı ofisten reddetti.' }));
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
        `<div class="qblock" data-q="${qi}">${q.header ? `<span class="chip-h">${esc(q.header)}</span>` : ''}<div class="q">${esc(q.question)}</div>` +
        `<div class="opts">${(q.options ?? []).map((o, oi) => `<button type="button" class="opt" data-q="${qi}" data-o="${oi}"><b>${esc(o.label)}</b>${o.description ? `<span>${esc(o.description)}</span>` : ''}</button>`).join('')}</div>` +
        `<input class="field other" data-q="${qi}" placeholder="Başka bir cevap…" autocomplete="off"></div>`).join('') +
      `<div class="row start"><button class="btn" data-send disabled>Gönder</button><button class="btn ghost" data-skip>Cevaplamadan geç</button></div>`;
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
      if (e.target.closest('[data-skip]')) leave(el, () => session.answerRequest(req.requestId, { behavior: 'deny', message: 'Kullanıcı soruyu cevaplamadı; makul olanı seç.' }));
      if (e.target.closest('[data-send]') && !sendBtn.disabled) {
        const answers = {};
        questions.forEach((q, qi) => {
          answers[q.question] = custom[qi] || [...picks[qi]].map((oi) => q.options[oi].label).join(', ');
        });
        leave(el, () => session.answerRequest(req.requestId, { behavior: 'allow', updatedInput: { questions, answers } }));
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

  // ---------- oturum olayları ----------
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
      case 'status':
      case 'error': {
        renderDock();
        renderBadge();
        const justStarted = session.state.running && !wasRunning;
        wasRunning = session.state.running;
        // Oturum açılınca sohbet paneline geç; ilk yanıt orada görünür.
        if (justStarted) { panel = { type: 'agent', id: 'main' }; renderPanel(true); renderDock(); }
        else if (panel) renderPanel();
        break;
      }
    }
  });

  renderDock();
  renderBadge();
  return { openPanel };
}
