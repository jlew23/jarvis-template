(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { agents: [], project: null, msgs: [], lastId: 0, seen: {}, es: null, pollTimer: null,
                filter: 'all', sig: '', config: null };
  var logEl = $('log'), input = $('input');
  var DEFAULT_TOPIC = 'What is done and what is not done on the current mission, against its done definition?';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function time12(ts) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }

  // ---- identity helpers (roster aware)
  function findAgent(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < state.agents.length; i++) {
      var a = state.agents[i];
      if (a.name.toLowerCase() === n || (a.herdr_name && a.herdr_name.toLowerCase() === n)) return a;
    }
    return null;
  }
  function canonName(name) { var a = findAgent(name); return a ? a.name : name; }

  // ---- safe markdown subset (DOM nodes only)
  var INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|@[A-Za-z0-9_.-]+)/g;
  function inline(parent, text, depth) {
    var parts = String(text).split(INLINE_RE);
    parts.forEach(function (p) {
      if (!p) return;
      if (p.length > 2 && p[0] === '`' && p[p.length - 1] === '`') parent.appendChild(el('code', '', p.slice(1, -1)));
      else if (depth < 2 && p.length > 4 && p.slice(0, 2) === '**' && p.slice(-2) === '**') {
        var b = el('strong'); inline(b, p.slice(2, -2), depth + 1); parent.appendChild(b);
      } else if (depth < 2 && p.length > 2 && p[0] === '*' && p[p.length - 1] === '*') {
        var i = el('em'); inline(i, p.slice(1, -1), depth + 1); parent.appendChild(i);
      } else if (/^@[A-Za-z0-9_.-]+$/.test(p)) parent.appendChild(el('span', 'men', p));
      else parent.appendChild(document.createTextNode(p));
    });
  }
  function renderMarkdown(container, text) {
    String(text).split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, ''), m;
      if ((m = /^\s*[-*] (.*)$/.exec(line))) {
        var li = el('div', 'li'); li.appendChild(el('span', 'mark', '•'));
        var t = el('span', 'txt'); inline(t, m[1], 0); li.appendChild(t); container.appendChild(li);
      } else if ((m = /^\s*(\d{1,3})\. (.*)$/.exec(line))) {
        var ni = el('div', 'li'); ni.appendChild(el('span', 'mark', m[1] + '.'));
        var nt = el('span', 'txt'); inline(nt, m[2], 0); ni.appendChild(nt); container.appendChild(ni);
      } else {
        var d = el('div', 'line'); inline(d, line, 0); container.appendChild(d);
      }
    });
  }

  // ---- chat
  function avatarFor(name, isUser) {
    var a = findAgent(name), av = el('div', 'avatar');
    av.textContent = (a && a.emoji) ? a.emoji : String(name || '?').charAt(0).toUpperCase();
    if (isUser) av.style.background = 'var(--blue)', av.style.color = '#fff';
    return av;
  }
  function visible(m) {
    if (state.filter === 'all') return true;
    var f = state.filter.toLowerCase();
    if (canonName(m.from).toLowerCase() === f) return true;
    return (m.to || []).some(function (t) {
      var tl = String(t).toLowerCase();
      return tl === 'all' || canonName(t).toLowerCase() === f;
    });
  }
  function buildRow(m) {
    var row;
    if (m.from === 'hub') {
      row = el('div', 'sysmsg');
      row.appendChild(document.createTextNode('hub: '));
      inline(row, m.text, 0);
    } else {
      var isUser = m.from === 'user';
      row = el('div', 'm' + (isUser ? ' user' : ''));
      row.appendChild(avatarFor(m.from, isUser));
      var body = el('div', 'm-body'), head = el('div', 'm-head');
      var a = findAgent(m.from), name = el('span', 'm-name', canonName(m.from));
      if (a && a.role) name.appendChild(el('span', 'role', ' | ' + a.role));
      head.appendChild(name);
      head.appendChild(el('span', 'm-time', time12(m.ts)));
      body.appendChild(head);
      var bubble = el('div', 'bubble');
      renderMarkdown(bubble, m.text);
      body.appendChild(bubble);
      row.appendChild(body);
    }
    row._m = m;
    row.hidden = !visible(m);
    return row;
  }
  function addMessage(m) {
    if (state.seen[m.id]) return;
    state.seen[m.id] = true;
    if (typeof m.id === 'number' && m.id > state.lastId) state.lastId = m.id;
    state.msgs.push(m);
    if (state.msgs.length > 500) state.msgs.shift();
    var near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 100;
    var e = logEl.querySelector('.empty'); if (e) e.remove();
    logEl.appendChild(buildRow(m));
    if (near || m.from === 'user') logEl.scrollTop = logEl.scrollHeight;
  }
  function rebuildLog() {
    var near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 100;
    logEl.textContent = '';
    if (!state.msgs.length) logEl.appendChild(el('div', 'empty', 'No messages yet. Say something to the council.'));
    state.msgs.forEach(function (m) { logEl.appendChild(buildRow(m)); });
    if (near) logEl.scrollTop = logEl.scrollHeight;
  }
  function applyFilter() {
    var rows = logEl.children;
    for (var i = 0; i < rows.length; i++) if (rows[i]._m) rows[i].hidden = !visible(rows[i]._m);
  }

  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }
  function note(text) { addMessage({ id: 'n' + Date.now() + Math.random(), ts: new Date().toISOString(), from: 'hub', text: text, to: ['user'] }); }

  function send() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    hideAc();
    postJSON('/api/messages', { from: 'user', text: text }).then(function (r) {
      if (r.ok && r.body && r.body.id) addMessage(r.body);
      else note('error: ' + ((r.body && r.body.error) || 'send failed'));
    }).catch(function () { note('error: could not reach the hub'); });
  }
  $('send').addEventListener('click', send);

  // ---- filter pills + direct-to chips
  function renderFilters() {
    var nav = $('filters'); nav.textContent = '';
    ['all'].concat(state.agents.map(function (a) { return a.name; })).forEach(function (n) {
      var b = el('button', 'filter' + (state.filter.toLowerCase() === n.toLowerCase() ? ' on' : ''), n === 'all' ? 'All' : n);
      b.type = 'button';
      b.addEventListener('click', function () { state.filter = n; renderFilters(); applyFilter(); });
      nav.appendChild(b);
    });
  }
  function insertAtCursor(txt) {
    var s = input.selectionStart == null ? input.value.length : input.selectionStart;
    var e = input.selectionEnd == null ? s : input.selectionEnd;
    var before = input.value.slice(0, s), after = input.value.slice(e);
    if (before && !/\s$/.test(before)) txt = ' ' + txt;
    input.value = before + txt + after;
    var pos = before.length + txt.length;
    input.focus();
    input.setSelectionRange(pos, pos);
  }
  function renderChips() {
    var box = $('chips'); box.textContent = '';
    ['all'].concat(state.agents.map(function (a) { return a.name; })).forEach(function (n) {
      var b = el('button', 'chip-m', '@' + n); b.type = 'button';
      b.addEventListener('click', function () { insertAtCursor('@' + n + ' '); });
      box.appendChild(b);
    });
  }

  // ---- @mention autocomplete
  var acEl = $('ac'), acItems = [], acSel = 0;
  function hideAc() { acEl.hidden = true; acItems = []; }
  function showAc() {
    var pos = input.selectionStart, before = input.value.slice(0, pos);
    var m = /(^|\s)@([A-Za-z0-9_.-]*)$/.exec(before);
    if (!m) return hideAc();
    var q = m[2].toLowerCase();
    var names = ['all'].concat(state.agents.map(function (a) { return a.name; }));
    acItems = names.filter(function (n) { return n.toLowerCase().indexOf(q) === 0; });
    if (!acItems.length) return hideAc();
    acSel = 0;
    renderAc();
  }
  function renderAc() {
    acEl.textContent = '';
    acItems.forEach(function (n, i) {
      var d = el('div', i === acSel ? 'sel' : '', '@' + n);
      d.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(n); });
      acEl.appendChild(d);
    });
    acEl.hidden = false;
  }
  function pick(name) {
    var pos = input.selectionStart, before = input.value.slice(0, pos), after = input.value.slice(pos);
    before = before.replace(/@([A-Za-z0-9_.-]*)$/, '@' + name + ' ');
    input.value = before + after;
    input.setSelectionRange(before.length, before.length);
    hideAc();
    input.focus();
  }
  input.addEventListener('input', showAc);
  input.addEventListener('blur', function () { setTimeout(hideAc, 100); });
  input.addEventListener('keydown', function (e) {
    if (!acEl.hidden) {
      if (e.key === 'ArrowDown') { acSel = (acSel + 1) % acItems.length; renderAc(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { acSel = (acSel - 1 + acItems.length) % acItems.length; renderAc(); e.preventDefault(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { pick(acItems[acSel]); e.preventDefault(); return; }
      if (e.key === 'Escape') { hideAc(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  // ---- agents
  function renderAgents(list) {
    list = list.slice().sort(function (x, y) {
      var xo = x.state === 'offline' ? 1 : 0, yo = y.state === 'offline' ? 1 : 0;
      return xo - yo || x.name.toLowerCase().localeCompare(y.name.toLowerCase());
    });
    state.agents = list;
    var ready = list.filter(function (a) { return a.state !== 'offline'; }).length;
    $('ready').textContent = ready + (ready === 1 ? ' Agent Ready' : ' Agents Ready');
    var ul = $('agents');
    ul.textContent = '';
    if (!list.length) ul.appendChild(el('li', 'muted', 'No agents yet. They appear when they send a heartbeat.'));
    list.forEach(function (a) {
      var li = el('li', 'agent' + (a.state === 'offline' ? ' offline' : ''));
      li.appendChild(avatarFor(a.name, false));
      var body = el('div', 'agent-body'), line = el('div', 'agent-line');
      var nm = el('div', 'agent-name', a.name);
      if (a.role) nm.appendChild(el('span', 'role', ' | ' + a.role));
      line.appendChild(nm);
      var dot = el('span', 'dot ' + a.state); dot.title = a.state;
      line.appendChild(dot);
      body.appendChild(line);
      if (a.description) body.appendChild(el('div', 'agent-desc', a.description));
      if (a.task) body.appendChild(el('div', 'agent-task', a.task));
      if (a.progress) {
        var mini = el('div', 'mini'), f = el('div');
        f.style.width = a.progress + '%';
        mini.appendChild(f); body.appendChild(mini);
      }
      li.appendChild(body);
      ul.appendChild(li);
    });
    var sig = JSON.stringify(list.map(function (a) { return [a.name, a.role, a.emoji, a.herdr_name]; }));
    var changed = sig !== state.sig;
    state.sig = sig;
    if (changed) { renderFilters(); renderChips(); rebuildLog(); }
  }

  // ---- project / mission drawer
  var openTasks = {};
  function renderProject(p) {
    state.project = p;
    $('mission').textContent = 'Mission: ' + (p.title || 'Untitled');
    var pr = p.progress || { done_pct: 0, partial_pct: 0 };
    var pct = Math.round(pr.done_pct) + '%';
    $('pct').textContent = pct;
    $('hpct').textContent = pct;
    ['bar-done', 'hbar-done'].forEach(function (id) { $(id).style.width = pr.done_pct + '%'; });
    ['bar-partial', 'bar-partial2', 'hbar-partial'].forEach(function (id) { $(id).style.width = pr.partial_pct + '%'; });
    $('complete').hidden = !p.complete;
    $('ptext').textContent = (p.done_definition || '') + (p.tasks && p.tasks.length ? '  (' + pr.done_pct + '% done, ' + pr.partial_pct + '% incl. review)' : '');
    var ul = $('tasks');
    ul.textContent = '';
    (p.tasks || []).forEach(function (t) {
      var li = el('li', openTasks[t.id] ? 'open' : '');
      var row = el('div', 'row');
      row.appendChild(el('span', 'tid', t.id));
      row.appendChild(el('span', 'ttitle', t.title));
      row.appendChild(el('span', 'chip ' + t.status, t.status));
      li.appendChild(row);
      var meta = (t.owner ? 'owner: ' + t.owner : 'unclaimed') + ' | w' + t.weight +
        (t.goal_critical === false ? ' | optional' : '') +
        (t.status === 'review' ? ' | ' + t.passes + '/' + t.required_passes + ' passes' : '');
      li.appendChild(el('div', 'tmeta', meta));
      var d = el('div', 'detail');
      if (t.notes) d.appendChild(el('div', '', t.notes));
      (t.rounds || []).forEach(function (r) {
        d.appendChild(el('div', 'v', 'Round ' + r.n + (r.result ? ' (' + r.result + ')' : ' (open)')));
        if (r.proof) d.appendChild(el('div', 'v', 'Proof: ' + r.proof));
        (r.verdicts || []).forEach(function (v) {
          d.appendChild(el('div', 'v ' + v.verdict, v.verdict.toUpperCase() + ' by ' + v.by + (v.reason ? ': ' + v.reason : '')));
        });
      });
      (t.updates || []).slice(-3).forEach(function (u) { d.appendChild(el('div', 'v', u.by + ': ' + u.note)); });
      if (!d.childNodes.length) d.appendChild(el('div', '', 'No notes or verdicts yet.'));
      li.appendChild(d);
      li.addEventListener('click', function () { openTasks[t.id] = !openTasks[t.id]; li.classList.toggle('open'); });
      ul.appendChild(li);
    });
  }

  // ---- config (title, discord)
  function applyConfig(c) {
    state.config = c;
    $('appname').textContent = c.title || 'Agent War Room';
    document.title = c.title || 'Agent War Room';
    var d = c.discord || {};
    $('discord-sub').textContent = d.enabled ? 'Synced to #' + (d.label || 'discord') : 'Off: set DISCORD_WEBHOOK_URL';
    $('subtitle').textContent = d.enabled
      ? 'Shared multi-agent council. Messages mirror to your Discord server in real-time.'
      : 'Shared multi-agent council. Local only.';
  }

  // ---- panels (sidebar / drawer)
  function setDrawer(open, remember) {
    document.body.classList.toggle('drawer-open', open);
    $('drawer-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (remember) lsSet('warroom.drawer', open ? '1' : '0');
  }
  function setSide(open) { document.body.classList.toggle('side-open', open); $('scrim').hidden = !open; }
  var stored = lsGet('warroom.drawer');
  setDrawer(stored === null ? !isMobile() : stored === '1', false);
  if (isMobile()) setDrawer(false, false);
  $('drawer-toggle').addEventListener('click', function () { setDrawer(!document.body.classList.contains('drawer-open'), true); });
  $('drawer-close').addEventListener('click', function () { setDrawer(false, true); });
  $('menu').addEventListener('click', function () { setSide(true); });
  $('side-close').addEventListener('click', function () { setSide(false); });
  $('scrim').addEventListener('click', function () { setSide(false); });

  // ---- inline dialog
  var modal = $('modal'), modalCb = null;
  function openDialog(o) {
    $('modal-title').textContent = o.title;
    $('modal-text').textContent = o.text || '';
    var ta = $('modal-input');
    ta.hidden = !o.input;
    ta.value = o.input || '';
    var ok = $('modal-ok');
    ok.textContent = o.ok || 'OK';
    ok.className = 'primary' + (o.danger ? ' danger' : '');
    modalCb = o.onOk;
    modal.hidden = false;
    (o.input ? ta : ok).focus();
  }
  function closeDialog() { modal.hidden = true; modalCb = null; }
  $('modal-cancel').addEventListener('click', closeDialog);
  modal.addEventListener('mousedown', function (e) { if (e.target === modal) closeDialog(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeDialog(); });
  $('modal-ok').addEventListener('click', function () {
    var cb = modalCb, val = $('modal-input').value;
    closeDialog();
    if (cb) cb(val);
  });

  $('deliberate').addEventListener('click', function () {
    setSide(false);
    var def = DEFAULT_TOPIC;
    if (state.project && state.project.done_definition) def += ' Done definition: ' + state.project.done_definition;
    openDialog({
      title: 'Run Team Deliberation',
      text: 'Every live agent gives an independent position, then one rebuttal, then a verdict.',
      input: def, ok: 'Start deliberation',
      onOk: function (topic) {
        postJSON('/api/deliberate', { topic: topic.trim(), by: 'user' }).then(function (r) {
          if (r.ok) addMessage(r.body.message);
          else note('error: ' + ((r.body && r.body.error) || 'deliberation failed'));
        }).catch(function () { note('error: could not reach the hub'); });
      }
    });
  });
  $('clear').addEventListener('click', function () {
    setSide(false);
    openDialog({
      title: 'Clear history?', text: 'The chat is archived on the server and removed from the room. Agents keep their inbox position.',
      ok: 'Clear history', danger: true,
      onOk: function () {
        postJSON('/api/clear', { by: 'user', confirm: true }).then(function (r) {
          if (!r.ok) note('error: ' + ((r.body && r.body.error) || 'clear failed'));
        }).catch(function () { note('error: could not reach the hub'); });
      }
    });
  });

  // ---- transport
  function getJSON(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }); }
  function setConn(ok, text) { var c = $('conn'); c.textContent = text; c.className = 'conn' + (ok ? ' ok' : ''); }
  function onCleared() { state.msgs = []; rebuildLog(); }

  function poll() {
    getJSON('/api/messages?since=' + state.lastId).then(function (ms) { ms.forEach(addMessage); }).catch(function () {});
    getJSON('/api/agents').then(renderAgents).catch(function () {});
    getJSON('/api/project').then(renderProject).catch(function () {});
  }
  function startPolling() { if (!state.pollTimer) { poll(); state.pollTimer = setInterval(poll, 3000); setConn(false, 'polling'); } }
  function stopPolling() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

  function connect() {
    if (!window.EventSource) return startPolling();
    var es = new EventSource('/api/stream');
    state.es = es;
    es.onopen = function () {
      stopPolling(); setConn(true, 'live');
      getJSON('/api/messages?since=' + state.lastId).then(function (ms) { ms.forEach(addMessage); }).catch(function () {});
    };
    es.addEventListener('message', function (e) { addMessage(JSON.parse(e.data)); });
    es.addEventListener('agents', function (e) { renderAgents(JSON.parse(e.data)); });
    es.addEventListener('project', function (e) { renderProject(JSON.parse(e.data)); });
    es.addEventListener('cleared', onCleared);
    es.onerror = function () {
      setConn(false, 'reconnecting');
      startPolling();
      if (es.readyState === 2) { es.close(); setTimeout(connect, 3000); }
    };
  }

  getJSON('/api/config').then(applyConfig).catch(function () {});
  getJSON('/api/agents').then(renderAgents).catch(function () {}).then(function () {
    return getJSON('/api/messages?since=0');
  }).then(function (ms) { ms.slice(-200).forEach(addMessage); logEl.scrollTop = logEl.scrollHeight; }).catch(function () {});
  rebuildLog();
  connect();
  setInterval(function () { getJSON('/api/agents').then(renderAgents).catch(function () {}); }, 30000);
  setInterval(function () { getJSON('/api/config').then(applyConfig).catch(function () {}); }, 60000);
})();
