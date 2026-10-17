import { invoke } from '@tauri-apps/api/core';
import * as session from './session.js';
import { alertUser, loadAlertPrefs, saveAlertPrefs, playChime } from './alerts.js';

// Yan çubuk, üstte açılan paneller, izin/soru kartları ve ajan etiketleri.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ICON = {
  send: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2.5 8l11-5-4 11-2-4.5z"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  clip: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7.5l-5.2 5.2a3.2 3.2 0 01-4.5-4.5l5.6-5.6a2.1 2.1 0 013 3l-5.6 5.6a1 1 0 01-1.5-1.5L9.9 4.6"/></svg>',
};
const MAX_FILES = 6;
const MAX_BYTES = 15 * 1024 * 1024;

// Quick commands. They are plain messages; the session decides what to do with them.
const MAIN_CHIPS = [
  { label: 'Ne yapıyorsun?', text: 'Şu an ne yapıyorsun? İki cümleyle anlat.' },
  { label: 'Durum özeti', text: 'Şu ana kadar yapılanları ve sıradaki adımı üç maddede özetle.' },
  { label: 'Bitince dur', text: 'Şu anki adımı bitirince dur ve benden talimat bekle.' },
];
const SUB_CHIPS = [
  { label: 'Ne yapıyorsun?', text: 'Şu an ne yapıyorsun? Bir cümleyle anlat.' },
  { label: 'Kapsamı daralt', text: 'Kapsamı daralt ve en önemli kısmı bitirip rapor ver.' },
  { label: 'Bitir ve raporla', text: 'Elindeki işi toparla ve hemen raporla.' },
];

const STATE_LABEL = { think: 'düşünüyor', read: 'okuyor', write: 'yazıyor', bash: 'komut çalıştırıyor', wait: 'seni bekliyor', talk: 'görev veriyor', done: 'sıra sende' };
// "Your turn" only makes sense for the main agent; a finished subagent is simply done.
const stateLabel = (agent) => (agent.state === 'done' && agent.kind === 'sub' ? 'bitti' : STATE_LABEL[agent.state] ?? agent.state);
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
const MEETING_TOPICS = ['Durum değerlendirmesi', 'Sıradaki adımlar', 'Engeller ve riskler', 'Mimari karar'];
const MEETING_PHASE = { running: 'sürüyor', ending: 'özet yazılıyor', done: 'bitti' };

/** Meeting prompts are long; the chat shows them as short lines. */
function shownText(text) {
  const t = String(text ?? '');
  if (t.startsWith(session.MEETING_START)) return `Toplantı başladı: ${t.slice(session.MEETING_START.length).split('\n')[0].trim()}`;
  if (t.startsWith(session.MEETING_INTERJECT)) return t.slice(session.MEETING_INTERJECT.length).trim();
  if (t.startsWith(session.MEETING_END)) return 'Toplantıyı bitir ve özetle';
  return t;
}
const meetingKind = (text) => {
  const t = String(text ?? '');
  return t.startsWith(session.MEETING_START) || t.startsWith(session.MEETING_END) ? 'sys' : null;
};

const WAITING_LABEL = { permission: 'izin bekliyor', question: 'soru soruyor' };
const sessionName = (x) => x.name || String(x.cwd ?? '').split(/[\\/]/).filter(Boolean).pop() || x.sessionId.slice(0, 8);

const shortPath = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');

export function createUI(scene) {
  const requestsEl = $('requests');
  const panelEl = $('panel');
  const dock = $('dock');
  const tagsEl = $('tags');
  const badge = $('modebadge');
  let panel = null; // { type, id? }
  let wasAttached = null;
  let agentTab = 'chat';

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
    const condot = dock.querySelector('[data-open="session"] .condot');
    // Another session waiting for the user outranks the connection colour.
    const others = s.sessions.filter((x) => x.waiting && x.sessionId !== s.attached?.sessionId).length;
    condot.style.background = others ? 'var(--s-wait)' : dot;
    condot.classList.toggle('alert', Boolean(others));
    dock.querySelector('[data-open="session"] .tip').textContent = others ? `Oturum · ${others} oturum seni bekliyor` : 'Oturum';
    for (const btn of dock.querySelectorAll('[data-open]')) {
      const k = btn.dataset.open;
      const on = panel && (panel.type === k || (k === 'chat' && panel.type === 'agent' && panel.id === 'main'));
      btn.classList.toggle('on', Boolean(on));
    }
    const live = dock.querySelector('[data-open="meeting"] .livedot');
    live.hidden = !(s.meeting && s.meeting.phase !== 'done');
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
    if (!same) { drafts = []; agentTab = 'chat'; }
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
    `<div class="attach-row" id="attachRow" hidden></div>` +
    `<form class="composer" id="msgForm">` +
    `<button type="button" class="clipbtn" id="clipBtn" aria-label="Dosya ekle" title="Dosya ekle (resim yapıştırmak için Ctrl+V)" ${disabled ? 'disabled' : ''}>${ICON.clip}</button>` +
    `<input type="file" id="fileInput" multiple hidden>` +
    `<input id="msgInput" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}" ${disabled ? 'disabled' : ''}>` +
    `<button class="send" type="submit" aria-label="Gönder" ${disabled ? 'disabled' : ''}>${ICON.send}</button></form>`;

  // Gönderilmeyi bekleyen ekler (panel değişince temizlenir).
  let drafts = []; // { file, preview }

  function addFiles(list) {
    const room = MAX_FILES - drafts.length;
    const files = [...list].slice(0, Math.max(0, room));
    for (const file of files) {
      if (file.size > MAX_BYTES) { sayBubble(panel?.id ?? 'main', `${file.name} 15 MB'tan büyük`); continue; }
      const draft = { file, preview: null };
      drafts.push(draft);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => { draft.preview = reader.result; renderDrafts(); };
        reader.readAsDataURL(file);
      }
    }
    renderDrafts();
  }

  function renderDrafts() {
    const row = $('attachRow');
    if (!row) return;
    row.hidden = !drafts.length;
    row.innerHTML = drafts.map((d, i) =>
      `<span class="att">${d.preview ? `<img src="${d.preview}" alt="">` : '<i class="fileic"></i>'}<span class="an">${esc(d.file.name || 'yapıştırılan resim')}</span><button type="button" data-rm="${i}" aria-label="Kaldır">${ICON.x}</button></span>`).join('');
    for (const b of row.querySelectorAll('[data-rm]')) {
      b.addEventListener('click', () => { drafts.splice(Number(b.dataset.rm), 1); renderDrafts(); });
    }
  }

  /** Panodan yapıştırılan resimlere ad verir (pano dosyalarının adı çoğu zaman "image.png"). */
  function namedPaste(file) {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '');
    return new File([file], `yapistirilan-${stamp}.${ext}`, { type: file.type });
  }

  function renderPanel(animate = false) {
    if (!panel) { panelEl.innerHTML = ''; return; }
    let html = '';
    if (panel.type === 'session') html = sessionPanel();
    if (panel.type === 'settings') html = settingsPanel();
    if (panel.type === 'agent') html = agentPanel();
    if (panel.type === 'meeting') html = session.state.meeting ? meetingPanel() : meetingSetupPanel();
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
          return `<button class="sess${on ? ' on' : ''}" data-sid="${esc(x.sessionId)}" style="--c:var(${busy ? '--s-write' : '--ok'})"><i class="dot${busy ? ' pulse' : ''}"></i><span class="grow"><b>${esc(x.name || shortPath(x.cwd) || x.sessionId.slice(0, 8))}</b><span>${esc(shortPath(x.cwd))} · ${busy ? 'çalışıyor' : 'boşta'} · ${ago(x.updatedAt)}</span></span>${on ? '<span class="st" style="--c:var(--ok)"><i class="dot"></i>bağlı</span>' : x.waiting ? `<span class="st live" style="--c:var(--s-wait)"><i class="dot"></i>${WAITING_LABEL[x.waiting] ?? 'bekliyor'}</span>` : ''}</button>`;
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
      `<div class="row"><div><b>Ajanlar bana soru sorsun</b><p class="desc">Kapalıyken Claude soru sormak yerine makul olanı seçip nedenini yazar; ofis bunu bildirir.</p></div><button class="sw" role="switch" id="askSw" aria-checked="${s.askQuestions}" aria-label="Ajanlar soru sorsun"></button></div>` +
      `<div class="collapse${s.askQuestions ? '' : ' closed'}" id="askMore"><div><div class="row"><div><b>Her yeni görevde sor</b><p class="desc">Ofisten verdiğin her işten önce Claude kısa bir çoktan seçmeli soru sorar.</p></div><button class="sw" role="switch" id="askEverySw" aria-checked="${s.askEveryTask}" aria-label="Her yeni görevde sor"></button></div></div></div>` +
      `<div class="kv"><span>Oturumun izin modu</span><b>${esc(m?.label ?? s.mode ?? 'bilinmiyor')}</b></div>` +
      `<p class="desc">İzin modunu terminalde Shift+Tab ile değiştirebilirsin. Bir izin kartında "düzenlemeleri otomatik onayla" seçersen oturum o moda geçer.</p>` +
      `<div class="row"><div><b>Windows bildirimleri</b><p class="desc">İzin ve soru geldiğinde, uzun bir tur bittiğinde.</p></div><button class="sw" role="switch" id="notifySw" aria-checked="${alerts.notify}" aria-label="Windows bildirimleri"></button></div>` +
      `<div class="row"><div><b>Windows ile başlat</b><p class="desc">Oturum açınca ofis kendiliğinden açılır.</p></div><button class="sw" role="switch" id="autoSw" aria-checked="${autostart === true}" aria-label="Windows ile başlat" ${autostart === null ? 'disabled' : ''}></button></div>` +
      `<div class="row"><div><b>Ses</b><p class="desc">Aynı anlarda kısa bir zil sesi.</p></div><button class="sw" role="switch" id="soundSw" aria-checked="${alerts.sound}" aria-label="Ses"></button></div>` +
      `</div>`;
  }

  const alerts = loadAlertPrefs();
  // null until the shell answers (and in the browser preview, where there is no shell).
  let autostart = null;
  invoke('get_autostart').then((on) => { autostart = Boolean(on); if (panel?.type === 'settings') renderPanel(); }).catch(() => {});

  function agentPanel() {
    const s = session.state;
    const agent = s.agents.get(panel.id);
    const isMain = panel.id === 'main';
    const sub = isMain ? esc(s.attached?.name || 'Ana ajan') : esc(agent.description || agent.type);
    const st = `<span class="st live" style="--c:var(--s-${agent.state})" id="agentState"><i class="dot"></i><span>${stateLabel(agent)}</span></span>`;
    const tabs = `<div class="tabs-row"><div class="seg" id="agentTabs"><span class="ind"></span><button type="button" data-v="chat" aria-pressed="${agentTab === 'chat'}">Sohbet</button><button type="button" data-v="steps" aria-pressed="${agentTab === 'steps'}">Adımlar <span class="cnt">${agent.steps.length || ''}</span></button></div></div>`;
    const body = agentTab === 'chat' ? '<div class="thread" id="thread"></div>' : '<div class="steps" id="steps"></div>';
    const placeholder = isMain ? "Claude'a yaz…" : `${agent.label}'a yaz (bir sonraki adımında görür)…`;
    const chips = (isMain ? MAIN_CHIPS : SUB_CHIPS).map((c, i) => `<button type="button" class="chip" data-chip="${i}" ${s.attached ? '' : 'disabled'}>${esc(c.label)}</button>`).join('');
    return head(esc(agent.label), sub, st, true) + tabs + `<div class="pbody scroll" id="pbody">${body}</div>` +
      `<div class="chips-row" id="chips">${chips}</div>` + composer(placeholder, !s.attached);
  }

  // ---------- toplantı ----------
  let meetDraft = { topic: '', picked: null }; // picked: Set of subagent ids, null = everyone

  function meetingSetupPanel() {
    const s = session.state;
    const subs = [...s.agents.values()].filter((a) => a.id !== 'main');
    const picked = meetDraft.picked ?? new Set(subs.map((a) => a.id));
    const people = [
      `<label class="who on"><input type="checkbox" checked disabled><span class="mini-av"></span><b>Claude</b><span>toplantıyı yönetir</span></label>`,
      ...subs.map((a) => `<label class="who${picked.has(a.id) ? ' on' : ''}"><input type="checkbox" data-who="${esc(a.id)}" ${picked.has(a.id) ? 'checked' : ''}><span class="mini-av"></span><b>${esc(a.label)}</b><span>${esc(a.description || a.type || '')}</span></label>`),
    ].join('');
    const can = s.attached && meetDraft.topic.trim();
    return head('Toplantı ayarla', s.attached ? 'Konuyu yaz, kimlerin katılacağını seç' : 'Önce bir oturuma bağlan') +
      `<form class="meetform" id="meetSetup"><div class="pbody"><span class="lbl">Konu</span>` +
      `<textarea class="field" id="meetTopic" rows="2" placeholder="Toplantının konusu ne?" ${s.attached ? '' : 'disabled'}>${esc(meetDraft.topic)}</textarea>` +
      `<div class="chips-wrap">${MEETING_TOPICS.map((t, i) => `<button type="button" class="chip" data-topic="${i}" ${s.attached ? '' : 'disabled'}>${esc(t)}</button>`).join('')}</div>` +
      `<span class="lbl">Katılımcılar</span><div class="people">${people}</div>` +
      (subs.length ? '' : '<p class="desc">Şu an açık alt ajan yok; Claude toplantıyı tek başına yürütür ve gerekirse sana soru sorar.</p>') +
      `</div><div class="meet-actions"><button class="btn small" type="submit" id="meetStart" ${can ? '' : 'disabled'}>Toplantıyı başlat</button></div></form>`;
  }

  function meetingPanel() {
    const m = session.state.meeting;
    const phase = MEETING_PHASE[m.phase] ?? m.phase;
    const st = `<span class="st${m.phase === 'done' ? '' : ' live'}" style="--c:var(${m.phase === 'done' ? '--ok' : '--s-talk'})"><i class="dot"></i><span>${phase}</span></span>`;
    const names = m.participants.map((id) => session.state.agents.get(id)?.label ?? (id === 'main' ? 'Claude' : 'ajan')).join(', ');
    const summary = m.phase === 'done'
      ? `<div class="summary"><span class="lbl">Toplantı özeti</span><div class="sumtext">${esc(m.summary)}</div></div>` : '';
    const actions = m.phase === 'done'
      ? '<div class="meet-actions"><button class="btn ghost small" data-meet="copy">Özeti kopyala</button><button class="btn small" data-meet="close">Özeti kapat</button></div>'
      : `<div class="meet-actions"><button class="btn ghost small" data-meet="end" ${m.phase === 'ending' ? 'disabled' : ''}>${m.phase === 'ending' ? 'Özet bekleniyor…' : 'Toplantıyı bitir'}</button></div>`;
    const form = m.phase === 'done' ? '' :
      `<form class="composer" id="meetForm"><input id="meetInput" placeholder="Araya gir…" autocomplete="off" aria-label="Araya gir"><button class="send" type="submit" aria-label="Gönder">${ICON.send}</button></form>`;
    return head(esc(m.topic), esc(names), st) +
      `<div class="pbody scroll" id="pbody"><div class="thread" id="meetThread"></div>${summary}</div>` + actions + form;
  }

  function renderMeetingThread() {
    const el = $('meetThread');
    const m = session.state.meeting;
    if (!el || !m) return;
    const items = session.state.chat.slice(m.startChat);
    const main = session.state.agents.get('main');
    const typing = m.phase !== 'done' && main && BUSY_STATES.has(main.state)
      ? `<div class="typing"><i></i><i></i><i></i><span>${esc(main.text || 'Claude düşünüyor')}</span></div>` : '';
    el.innerHTML = items.map((x) => {
      const kind = x.role === 'user' ? meetingKind(x.text) ?? 'me' : x.role === 'system' ? 'sys' : x.role === 'task' ? 'task' : 'ag';
      // The summary itself is shown below the thread.
      if (m.phase === 'done' && x.role === 'assistant' && m.summary && x.text.includes(m.summary.slice(0, 40))) return '';
      return `<div class="m ${kind}${x.pending ? ' pending' : ''}">${esc(shownText(x.text))}</div>`;
    }).join('') + typing;
    const body = $('pbody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function wireMeeting(root) {
    const setup = $('meetSetup');
    if (setup) {
      const topic = $('meetTopic');
      const start = $('meetStart');
      const refresh = () => { start.disabled = !(session.state.attached && meetDraft.topic.trim()); };
      topic.addEventListener('input', () => { meetDraft.topic = topic.value; refresh(); });
      topic.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setup.requestSubmit(); } });
      for (const chip of root.querySelectorAll('[data-topic]')) {
        chip.addEventListener('click', () => { meetDraft.topic = MEETING_TOPICS[Number(chip.dataset.topic)]; topic.value = meetDraft.topic; refresh(); topic.focus(); });
      }
      for (const box of root.querySelectorAll('[data-who]')) {
        box.addEventListener('change', () => {
          const subs = [...session.state.agents.keys()].filter((id) => id !== 'main');
          meetDraft.picked ??= new Set(subs);
          if (box.checked) meetDraft.picked.add(box.dataset.who); else meetDraft.picked.delete(box.dataset.who);
          box.closest('.who').classList.toggle('on', box.checked);
        });
      }
      setup.addEventListener('submit', (e) => {
        e.preventDefault();
        if (start.disabled) return;
        const subs = [...session.state.agents.keys()].filter((id) => id !== 'main');
        const picked = meetDraft.picked ?? new Set(subs);
        const topicText = meetDraft.topic.trim();
        meetDraft = { topic: '', picked: null };
        session.startMeeting(topicText, subs.filter((id) => picked.has(id)));
      });
      setTimeout(() => (topic.disabled ? null : topic.focus({ preventScroll: true })), 60);
    }
    for (const btn of root.querySelectorAll('[data-meet]')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.meet;
        if (act === 'end') session.endMeeting();
        if (act === 'close') session.closeMeeting();
        if (act === 'copy') {
          const m = session.state.meeting;
          navigator.clipboard?.writeText(`${m?.topic}\n\n${m?.summary}`);
          btn.textContent = 'Kopyalandı';
        }
      });
    }
    const form = $('meetForm');
    if (form) {
      const input = $('meetInput');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        session.interjectMeeting(text);
      });
      setTimeout(() => input.focus({ preventScroll: true }), 60);
    }
    renderMeetingThread();
  }

  /** Keep the office in step with the meeting: walk in when it starts, back to the desks when it ends. */
  function syncMeetingScene() {
    const m = session.state.meeting;
    const live = m && m.phase !== 'done';
    if (live && !scene.inMeeting) scene.startMeeting(m.participants);
    if (!live && scene.inMeeting) scene.endMeeting();
  }

  const BUSY_STATES = new Set(['think', 'read', 'write', 'bash', 'talk']);

  function renderThread() {
    const el = $('thread');
    if (!el) return;
    const agent = session.state.agents.get(panel.id);
    const items = panel.id === 'main' ? session.state.chat : agent?.chat ?? [];
    const typing = agent && BUSY_STATES.has(agent.state) && session.state.attached
      ? `<div class="typing" aria-label="${esc(agent.label)} çalışıyor"><i></i><i></i><i></i><span>${esc(agent.text || 'çalışıyor')}</span></div>` : '';
    el.innerHTML = (items.length
      ? items.map((m) => {
          const cls = m.role === 'user' ? 'me' : m.role === 'system' ? 'sys' : m.role === 'task' ? 'task' : 'ag';
          const status = m.role === 'user' && (m.pending || m.via)
            ? `<span class="dl">${m.pending ? esc(m.hint || 'iletilmeyi bekliyor…') : `iletildi · ${esc(m.via)}`}</span>` : '';
          const label = m.role === 'task' ? '<span class="tl">Claude\'dan görev</span>' : '';
          const files = m.files?.length
            ? `<span class="mfiles">${m.files.map((f) => (f.preview ? `<img src="${f.preview}" alt="${esc(f.name)}" title="${esc(f.name)}">` : `<span class="mfile">${esc(f.name)}</span>`)).join('')}</span>`
            : '';
          return `<div class="m ${cls}${m.pending ? ' pending' : ''}">${label}${files}${esc(shownText(m.text))}${status}</div>`;
        }).join('')
      : `<div class="m sys">${panel.id === 'main' ? 'Henüz mesaj yok.' : 'Bu ajanın kaydı henüz gelmedi.'}</div>`) + typing;
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
    const askSw = $('askSw');
    if (askSw) askSw.addEventListener('click', () => {
      const value = !session.state.askQuestions;
      askSw.setAttribute('aria-checked', value);
      $('askMore').classList.toggle('closed', !value);
      session.setOption('askQuestions', value);
    });
    const askEverySw = $('askEverySw');
    if (askEverySw) askEverySw.addEventListener('click', () => {
      const value = !session.state.askEveryTask;
      askEverySw.setAttribute('aria-checked', value);
      session.setOption('askEveryTask', value);
    });
    const autoSw = $('autoSw');
    if (autoSw) autoSw.addEventListener('click', async () => {
      const value = !autostart;
      autoSw.setAttribute('aria-checked', value);
      try {
        await invoke('set_autostart', { on: value });
        autostart = value;
      } catch (err) {
        autoSw.setAttribute('aria-checked', autostart);
        console.error('Windows ile başlatma ayarlanamadı', err);
      }
    });
    for (const [id, key] of [['notifySw', 'notify'], ['soundSw', 'sound']]) {
      const toggle = $(id);
      if (!toggle) continue;
      toggle.addEventListener('click', () => {
        alerts[key] = !alerts[key];
        toggle.setAttribute('aria-checked', alerts[key]);
        saveAlertPrefs(alerts);
        if (key === 'sound' && alerts.sound) playChime();
      });
    }
    const tabsEl = $('agentTabs');
    if (tabsEl) segInit(tabsEl, (v) => { agentTab = v; renderPanel(); });
    for (const chip of root.querySelectorAll('[data-chip]')) {
      chip.addEventListener('click', () => {
        const list = panel.id === 'main' ? MAIN_CHIPS : SUB_CHIPS;
        session.sendMessage(list[Number(chip.dataset.chip)].text, panel.id);
        agentTab = 'chat';
        renderThread();
      });
    }
    const msg = $('msgForm');
    if (msg) {
      const input = $('msgInput');
      const fileInput = $('fileInput');
      renderDrafts();
      $('clipBtn').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
      // Ctrl+V ile resim ya da dosya yapıştırma; düz metin normal yapışır.
      root.addEventListener('paste', (e) => {
        const files = [...(e.clipboardData?.files ?? [])];
        if (!files.length || input.disabled) return;
        e.preventDefault();
        addFiles(files.map((f) => (f.type.startsWith('image/') && /^image\.\w+$/.test(f.name) ? namedPaste(f) : f)));
      });
      root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); root.classList.add('dropping'); } });
      root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('dropping'); });
      root.addEventListener('drop', (e) => {
        root.classList.remove('dropping');
        if (!e.dataTransfer?.files.length || input.disabled) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      });
      msg.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text && !drafts.length) return;
        const files = drafts;
        drafts = [];
        input.value = '';
        renderDrafts();
        session.sendMessage(text || 'Ekteki dosyalara bak.', panel.id, files);
        if (panel.id !== 'main') sayBubble(panel.id, 'Mesajın bir sonraki adımımda bana ulaşacak');
      });
      setTimeout(() => (input.disabled ? null : input.focus({ preventScroll: true })), 60);
    }
    if (panel.type === 'meeting') wireMeeting(root);
    renderThread();
    renderSteps();
  }

  /** Segmented control with a sliding indicator. */
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
        setTimeout(() => onPick(b.dataset.v), 180);
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
      (req.suggestions?.length ? '<button class="btn ghost" data-a="always">Bu oturumda hep izin ver</button>' : '') +
      (EDIT_TOOLS.has(req.toolName) ? '<button class="btn ghost" data-a="edits">İzin ver + düzenlemeleri otomatik onayla</button>' : '') +
      `<button class="link" data-a="terminal">Terminalde cevapla</button></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      const result = a === 'allow' ? { behavior: 'allow' }
        : a === 'always' ? { behavior: 'always' }
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
  const root = () => panelEl;

  // ---------- alerts ----------
  const seenRequests = new Set();
  function alertNewRequests() {
    for (const req of session.state.requests) {
      if (seenRequests.has(req.requestId)) continue;
      seenRequests.add(req.requestId);
      const who = agentLabel(req.agentId);
      if (req.kind === 'question') alertUser(`${who} soruyor`, req.input?.questions?.[0]?.question ?? 'Ofiste bir soru bekliyor.');
      else alertUser(`${who} izin istiyor`, `${req.toolName}: ${String(req.input?.command ?? req.input?.file_path ?? '').slice(0, 120)}`);
    }
  }

  // Other sessions that start waiting for the user get one notification each time.
  const waitingSeen = new Set();
  function alertWaitingSessions() {
    const s = session.state;
    for (const x of s.sessions) {
      const key = `${x.sessionId}:${x.waiting}`;
      if (!x.waiting || x.sessionId === s.attached?.sessionId) { for (const k of waitingSeen) if (k.startsWith(`${x.sessionId}:`)) waitingSeen.delete(k); continue; }
      if (waitingSeen.has(key)) continue;
      waitingSeen.add(key);
      alertUser(`${sessionName(x)} ${WAITING_LABEL[x.waiting] ?? 'bekliyor'}`, 'Bu oturum ofise bağlı değil; terminalde cevapla ya da ofisi ona bağla.');
    }
  }

  // A turn that ran for a while gets a "done" notification when it ends.
  let turnStarted = 0;
  function trackTurn(busy) {
    if (busy) { turnStarted ||= Date.now(); return; }
    const took = turnStarted ? Date.now() - turnStarted : 0;
    turnStarted = 0;
    if (took < 20_000) return;
    const last = [...session.state.chat].reverse().find((m) => m.role === 'assistant');
    alertUser('Claude bitirdi', last ? last.text.slice(0, 140) : 'Sıra sende.');
  }

  session.subscribe((change) => {
    switch (change.kind) {
      case 'agent_added':
        scene.addAgent(change.agent.id, change.agent.type);
        scene.setState(change.agent.id, change.agent.state);
        tagFor(change.agent);
        if (panel?.type === 'meeting' && !session.state.meeting) renderPanel();
        break;
      case 'agent_updated':
        if (panel?.type === 'meeting' && change.agent.id === 'main') renderMeetingThread();
        scene.setState(change.agent.id, change.agent.state);
        tagFor(change.agent);
        if (panel?.type === 'agent' && panel.id === change.agent.id) {
          const st = $('agentState');
          if (st) {
            st.style.setProperty('--c', `var(--s-${change.agent.state})`);
            st.lastChild.textContent = stateLabel(change.agent);
          }
          const cnt = root().querySelector('#agentTabs .cnt');
          if (cnt) cnt.textContent = change.agent.steps.length || '';
          renderSteps();
          renderThread();
        }
        break;
      case 'agent_chat':
        if (panel?.type === 'meeting') renderMeetingThread();
        if (panel?.type === 'agent' && panel.id === change.id) renderThread();
        break;
      case 'busy':
        trackTurn(session.state.busy);
        break;
      case 'agent_removed': {
        scene.removeAgent(change.agent.id);
        const tag = tags.get(change.agent.id);
        if (tag) { tag.el.remove(); tags.delete(change.agent.id); }
        if (panel?.type === 'agent' && panel.id === change.agent.id) closePanel();
        break;
      }
      case 'decided':
        alertUser(`${agentLabel(change.id)} kendi karar verdi`, change.question || 'Soru sorma kapalı olduğu için kendi seçti.');
        break;
      case 'say':
        sayBubble(change.id, change.text);
        break;
      case 'chat':
        renderThread();
        renderMeetingThread();
        break;
      case 'meeting': {
        syncMeetingScene();
        renderDock();
        const m = session.state.meeting;
        // Starting a meeting opens its panel; finishing it keeps the summary on screen.
        if (m?.phase === 'running' && panel?.type !== 'meeting') {
          panel = { type: 'meeting' };
          scene.select(null);
          renderPanel(true);
          renderDock();
          renderRequests();
        } else if (panel?.type === 'meeting') renderPanel();
        if (m?.phase === 'done') alertUser('Toplantı bitti', m.summary.slice(0, 140));
        break;
      }
      case 'requests':
        renderRequests();
        renderDock();
        alertNewRequests();
        break;
      case 'sessions':
        renderBadge();
        renderDock();
        alertWaitingSessions();
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
