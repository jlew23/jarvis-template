(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { agents: [], project: null, lastId: 0, seen: {}, es: null, pollTimer: null };
  var logEl = $('log'), input = $('input');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function hue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }
  function hhmm(ts) { return (ts || '').slice(11, 16); }

  // ---- chat
  function addMessage(m) {
    if (state.seen[m.id]) return;
    state.seen[m.id] = true;
    if (m.id > state.lastId) state.lastId = m.id;
    var near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
    var row = el('div', 'msg' + (m.from === 'hub' ? ' sys' : ''));
    row.appendChild(el('span', 't', hhmm(m.ts)));
    var who = el('span', 'who', m.from);
    who.style.color = 'hsl(' + hue(m.from) + ', 70%, 60%)';
    row.appendChild(who);
    // text rendered via text nodes only; mentions highlighted without innerHTML
    var parts = String(m.text).split(/(@[A-Za-z0-9_.-]+)/g);
    parts.forEach(function (p) {
      if (/^@[A-Za-z0-9_.-]+$/.test(p)) row.appendChild(el('span', 'men', p));
      else row.appendChild(document.createTextNode(p));
    });
    logEl.appendChild(row);
    if (near) logEl.scrollTop = logEl.scrollHeight;
  }

  function send() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    hideAc();
    fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'user', text: text })
    }).then(function (r) { return r.json(); }).then(function (m) {
      if (m && m.id) { addMessage(m); logEl.scrollTop = logEl.scrollHeight; }
      else if (m && m.error) addMessage({ id: 'e' + Date.now(), ts: '', from: 'hub', text: 'error: ' + m.error });
    }).catch(function () {});
  }
  $('send').addEventListener('click', send);

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
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); }
  });

  // ---- agents
  function renderAgents(list) {
    state.agents = list;
    var ul = $('agents');
    ul.textContent = '';
    if (!list.length) { ul.appendChild(el('li', 'muted', 'No agents yet. They appear when they send a heartbeat.')); return; }
    list.forEach(function (a) {
      var li = el('li');
      var row = el('div', 'row');
      row.appendChild(el('span', 'dot ' + a.state));
      row.appendChild(el('span', 'aname', a.name));
      row.appendChild(el('span', 'akind', a.kind + ' / ' + a.state));
      li.appendChild(row);
      if (a.task) li.appendChild(el('div', 'atask', a.task));
      if (a.progress) {
        var mini = el('div', 'mini'), f = el('div');
        f.style.width = a.progress + '%';
        mini.appendChild(f);
        li.appendChild(mini);
      }
      ul.appendChild(li);
    });
  }

  // ---- project
  var openTasks = {};
  function renderProject(p) {
    state.project = p;
    $('ptitle').textContent = p.title || 'Agent Hub';
    var pr = p.progress || { done_pct: 0, partial_pct: 0 };
    $('pct').textContent = Math.round(pr.done_pct) + '%';
    $('bar-done').style.width = pr.done_pct + '%';
    $('bar-partial').style.width = pr.partial_pct + '%';
    $('bar-partial2').style.width = pr.partial_pct + '%';
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
        (r.verdicts || []).forEach(function (v) {
          d.appendChild(el('div', 'v ' + v.verdict, v.verdict.toUpperCase() + ' by ' + v.by + (v.reason ? ': ' + v.reason : '')));
        });
      });
      (t.updates || []).slice(-3).forEach(function (u) {
        d.appendChild(el('div', 'v', u.by + ': ' + u.note));
      });
      if (!d.childNodes.length) d.appendChild(el('div', '', 'No notes or verdicts yet.'));
      li.appendChild(d);
      li.addEventListener('click', function () {
        openTasks[t.id] = !openTasks[t.id];
        li.classList.toggle('open');
      });
      ul.appendChild(li);
    });
  }

  // ---- transport
  function getJSON(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }); }
  function setConn(ok, text) { var c = $('conn'); c.textContent = text; c.className = 'conn' + (ok ? ' ok' : ''); }

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
    es.onerror = function () {
      setConn(false, 'reconnecting');
      startPolling();
      // EventSource retries automatically; recreate it if the browser gave up.
      if (es.readyState === 2) { es.close(); setTimeout(connect, 3000); }
    };
  }

  getJSON('/api/messages?since=0').then(function (ms) { ms.slice(-200).forEach(addMessage); logEl.scrollTop = logEl.scrollHeight; }).catch(function () {});
  connect();
  // offline state is computed server-side with time; refresh periodically
  setInterval(function () { getJSON('/api/agents').then(renderAgents).catch(function () {}); }, 30000);
})();
