/* Игра «Топо-Битва» — логика и отрисовка экранов. */
(function () {
  'use strict';

  var DATA = window.GAME_DATA;
  var STORAGE_KEY = 'topo-bitva:game';
  var UNDO_LIMIT = 60;
  var LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
  var TEAMS = 3;

  var appEl = document.getElementById('app');
  var state = null;
  var undoStack = [];
  var ui = {
    legend: false,
    confirm: null,
    lastTotals: null,
    lastSec: null,
    bannerTimer: null,
    toastTimer: null
  };

  /* ---------- Порядок экранов ---------- */

  var STEPS = [{ type: 'title' }, { type: 'rules' }];
  DATA.rounds.forEach(function (r, ri) {
    STEPS.push({ type: 'intro', r: ri });
    r.tasks.forEach(function (t, ti) { STEPS.push({ type: 'task', r: ri, t: ti, key: r.id + '-' + ti }); });
  });
  STEPS.push({ type: 'final' });

  function step() { return STEPS[state.step]; }
  function roundOf(st) { return DATA.rounds[st.r]; }
  function taskOf(st) { return DATA.rounds[st.r].tasks[st.t]; }

  /* ---------- Хранилище ---------- */

  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* без сохранения */ }
  }

  /* ---------- Утилиты ---------- */

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    }).replace(/(\d) (?=\d)/g, '$1\u00a0').replace(/ = /g, '\u00a0=\u00a0'); // «Y = 7 484 700» не рвётся
  }
  function range(n) {
    var list = [];
    for (var i = 0; i < n; i++) list.push(i);
    return list;
  }
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function pts(n) { return n + ' ' + plural(n, 'очко', 'очка', 'очков'); }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }
  function fmtClock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------- Состояние ---------- */

  function newState(teams) {
    var order = {};
    STEPS.forEach(function (st) {
      if (st.type === 'task' && taskOf(st).kind === 'choice') order[st.key] = shuffle(range(taskOf(st).options.length));
    });
    return {
      v: 1,
      step: 0,
      teams: teams || DATA.teams.slice(),
      scores: {},
      hits: {},
      order: order,
      cur: null,
      timer: null,
      startedAt: null,
      finishedAt: null
    };
  }

  function isValidState(s) {
    return s && s.v === 1 && typeof s.step === 'number' && s.step >= 0 && s.step < STEPS.length &&
      Array.isArray(s.teams) && s.teams.length === TEAMS && s.scores && s.order && s.hits &&
      (STEPS[s.step].type !== 'task' || !!s.cur);
  }

  function load() {
    var raw = readStore(STORAGE_KEY);
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (isValidState(s)) { state = s; return; }
      } catch (e) { /* испорченное сохранение — начинаем заново */ }
    }
    state = newState();
  }

  function save() { writeStore(STORAGE_KEY, JSON.stringify(state)); }

  function commit(mutate, opts) {
    if (!(opts && opts.noUndo)) {
      undoStack.push(JSON.stringify(state));
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    mutate(state);
    save();
    render();
  }

  function undo() {
    if (!undoStack.length) { toast('Отменять нечего'); return; }
    state = JSON.parse(undoStack.pop());
    ui.lastSec = null;
    save();
    render();
    Sound.play('soft');
    toast('Последнее действие отменено');
  }

  function totals(s) {
    var t = range(TEAMS).map(function () { return 0; });
    Object.keys(s.scores).forEach(function (k) {
      s.scores[k].forEach(function (v, i) { t[i] += v; });
    });
    return t;
  }

  function roundTotals(s, ri) {
    var t = range(TEAMS).map(function () { return 0; });
    var id = DATA.rounds[ri].id + '-';
    Object.keys(s.scores).forEach(function (k) {
      if (k.indexOf(id) === 0) s.scores[k].forEach(function (v, i) { t[i] += v; });
    });
    return t;
  }

  function zeros() { return range(TEAMS).map(function () { return 0; }); }

  /* ---------- Таймер ---------- */

  function timeLeft(t) {
    if (!t) return null;
    return t.endsAt != null ? Math.max(0, t.endsAt - Date.now()) : t.left;
  }
  function stopTimer(s) {
    if (s.timer && s.timer.endsAt != null) {
      s.timer.left = Math.max(0, s.timer.endsAt - Date.now());
      s.timer.endsAt = null;
    }
  }
  function startTimer(s) {
    if (s.timer && s.timer.endsAt == null && !s.timer.done && s.timer.left > 0) {
      s.timer.endsAt = Date.now() + s.timer.left;
      s.timer.left = null;
    }
  }
  function togglePause() {
    var t = state.timer;
    if (!t || t.done || !state.cur || state.cur.phase === 'reveal' || state.cur.turn != null) return;
    var paused = t.endsAt == null;
    commit(function (s) { if (paused) startTimer(s); else stopTimer(s); }, { noUndo: true });
    toast(paused ? 'Таймер пошёл' : 'Таймер на паузе');
  }

  function timeout() {
    var mode = roundOf(step()).mode;
    commit(function (s) {
      s.timer.done = true;
      s.timer.endsAt = null;
      s.timer.left = 0;
      if (mode === 'together' && s.cur.phase === 'ask') s.cur.phase = 'collect';
    }, { noUndo: true });
    if (mode === 'together') {
      banner('Показали!');
      Sound.play('show');
    } else {
      banner('Время!');
      Sound.play('timeout');
    }
  }

  function tick() {
    if (!state) return;
    var clock = document.getElementById('clock');
    if (clock) clock.textContent = state.startedAt ? fmtClock((state.finishedAt || Date.now()) - state.startedAt) : '0:00';
    var t = state.timer;
    var timerEl = document.getElementById('timer');
    if (!t || !timerEl) return;
    var left = timeLeft(t);
    var running = t.endsAt != null;
    var sec = Math.ceil(left / 1000);
    timerEl.querySelector('.timer-num').textContent = fmtClock(sec * 1000);
    timerEl.classList.toggle('is-paused', !running && !t.done && state.cur && state.cur.phase !== 'reveal');
    timerEl.classList.toggle('is-warn', running && sec <= 5);
    timerEl.classList.toggle('is-done', !!t.done || (state.cur && state.cur.phase === 'reveal'));
    var bar = document.getElementById('timebar');
    if (bar) bar.style.transform = 'scaleX(' + (t.total ? left / t.total : 0) + ')';
    if (running && sec !== ui.lastSec) {
      ui.lastSec = sec;
      if (sec <= 5 && sec > 0) Sound.play('tick');
    }
    if (running && left <= 0 && !t.done) timeout();
  }

  /* ---------- Навигация ---------- */

  function goTo(i) {
    if (i < 0 || i >= STEPS.length) return;
    commit(function (s) {
      s.step = i;
      s.cur = null;
      s.timer = null;
      var st = STEPS[i];
      if (i >= 2 && !s.startedAt) s.startedAt = Date.now();
      if (st.type === 'task') {
        s.cur = { phase: 'ask', picks: [null, null, null], grades: [null, null, null], tries: [], turn: null };
        var ms = roundOf(st).time * 1000;
        s.timer = { total: ms, endsAt: Date.now() + ms, left: null, done: false };
      }
      if (st.type === 'final' && !s.finishedAt) s.finishedAt = Date.now();
    });
    ui.lastSec = null;
    ui.legend = false;
    var st = STEPS[i];
    if (st.type === 'intro') Sound.play('start');
    else if (st.type === 'task') Sound.play('paper');
    else if (st.type === 'final') Sound.play('fanfare');
    else Sound.play('click');
  }

  function next() { goTo(state.step + 1); }

  function primary() {
    var st = step();
    if (st.type === 'title') { Sound.unlock(); next(); return; }
    if (st.type === 'rules' || st.type === 'intro') { next(); return; }
    if (st.type !== 'task') return;
    var c = state.cur;
    var t = taskOf(st);
    if (c.phase === 'reveal') { next(); return; }
    if (t.kind === 'choice') revealChoice();
    else if (t.kind === 'free') revealFree();
    else if (t.kind === 'target' && c.turn == null) revealTarget();
  }

  /* ---------- Вопросы с вариантами ---------- */

  function correctIndex(st) { return state.order[st.key].indexOf(0); }

  function pick(team, idx) {
    var c = state.cur;
    if (!c || c.phase === 'reveal') return;
    commit(function (s) { s.cur.picks[team] = s.cur.picks[team] === idx ? null : idx; });
    Sound.play('click');
  }

  function revealChoice() {
    var st = step();
    var t = taskOf(st);
    var worth = t.points || roundOf(st).points;
    var right = correctIndex(st);
    var any = false;
    commit(function (s) {
      stopTimer(s);
      s.cur.phase = 'reveal';
      s.scores[st.key] = s.cur.picks.map(function (p) {
        if (p === right) { any = true; return worth; }
        return 0;
      });
    });
    Sound.play(any ? 'correct' : 'wrong');
  }

  /* ---------- Задания со свободным ответом ---------- */

  function revealFree() {
    var st = step();
    commit(function (s) {
      stopTimer(s);
      s.cur.phase = 'reveal';
      s.scores[st.key] = s.cur.grades.map(function (g) { return g || 0; });
    });
    Sound.play('start');
  }

  function grade(team, points) {
    var st = step();
    if (state.cur.phase !== 'reveal') return;
    commit(function (s) {
      s.cur.grades[team] = points;
      s.scores[st.key] = s.cur.grades.map(function (g) { return g || 0; });
    });
    Sound.play(points > 0 ? 'plus' : 'soft');
  }

  /* ---------- Целеуказание на скорость ---------- */

  function tried(team) {
    return state.cur.tries.some(function (x) { return x.team === team; });
  }

  function chooseTeam(team) {
    var c = state.cur;
    if (!c || c.phase === 'reveal' || c.turn != null || tried(team)) return;
    commit(function (s) {
      s.cur.turn = team;
      stopTimer(s);
    });
    Sound.play('click');
  }

  function cancelTurn() {
    if (!state.cur || state.cur.turn == null) return;
    commit(function (s) {
      s.cur.turn = null;
      startTimer(s);
    });
    Sound.play('soft');
  }

  function answerLetter(letter) {
    var st = step();
    var t = taskOf(st);
    var r = roundOf(st);
    var c = state.cur;
    if (!c || c.turn == null || c.phase === 'reveal') return;
    var team = c.turn;
    var ok = letter === t.target;
    var allTried = false;
    commit(function (s) {
      var sc = s.scores[st.key] || zeros();
      s.cur.tries.push({ team: team, letter: letter, ok: ok });
      s.cur.turn = null;
      if (ok) {
        sc[team] += r.points * (t.mult || 1);
        s.cur.phase = 'reveal';
        s.hits[t.target] = true;
        stopTimer(s);
      } else {
        sc[team] -= r.penalty;
        allTried = s.cur.tries.length >= TEAMS;
        if (allTried) {
          s.cur.phase = 'reveal';
          s.hits[t.target] = true;
          stopTimer(s);
        } else {
          startTimer(s);
        }
      }
      s.scores[st.key] = sc;
    });
    Sound.play('whistle');
    if (ok) {
      fire(t.target);
    } else {
      var miss = TopoMap.target(letter);
      if (miss) TopoMap.splash(miss.e, miss.n);
      Sound.play('splash');
      setTimeout(function () { Sound.play('wrong'); }, 900);
      if (allTried) setTimeout(function () { fire(t.target); }, 1300);
    }
  }

  function revealTarget() {
    var st = step();
    var t = taskOf(st);
    commit(function (s) {
      stopTimer(s);
      s.cur.phase = 'reveal';
      s.hits[t.target] = true;
      s.scores[st.key] = s.scores[st.key] || zeros();
    });
    Sound.play('whistle');
    fire(t.target);
  }

  function fire(letter) {
    var tg = TopoMap.target(letter);
    if (!tg) return;
    TopoMap.boom(tg.e, tg.n);
    Sound.play('boom');
  }

  /* ---------- Сервисное ---------- */

  function toast(text) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function banner(text) {
    var el = document.getElementById('banner');
    if (!el) return;
    el.innerHTML = '<span>' + esc(text) + '</span>';
    el.hidden = false;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
    clearTimeout(ui.bannerTimer);
    ui.bannerTimer = setTimeout(function () { el.hidden = true; }, 1700);
  }

  function askConfirm(text, yes, action) {
    ui.confirm = { text: text, yes: yes, action: action };
    render();
  }

  function toggleFullscreen() {
    var d = document;
    try {
      if (d.fullscreenElement) d.exitFullscreen();
      else d.documentElement.requestFullscreen();
    } catch (e) { /* полноэкранный режим недоступен */ }
  }

  function toggleMute() {
    var muted = Sound.toggle();
    toast(muted ? 'Звук выключен' : 'Звук включён');
    render();
  }

  function restart() {
    askConfirm('Начать игру заново? Все очки обнулятся.', 'Начать заново', function () {
      var teams = state.teams.slice();
      undoStack.push(JSON.stringify(state));
      state = newState(teams);
      state.step = 1;
      save();
      render();
      Sound.play('start');
    });
  }

  /* ---------- Сцена карты ---------- */

  function mapScene() {
    var st = step();
    var hitStates = {};
    Object.keys(state.hits).forEach(function (k) { hitStates[k] = 'hit'; });
    if (st.type === 'title' || st.type === 'rules' || st.type === 'final') return { mode: 'backdrop', view: TopoMap.views.full, overlay: '' };
    var r = roundOf(st);
    if (r.id === 'theory') return { mode: 'backdrop', view: TopoMap.views.full, overlay: '' };
    if (st.type === 'intro') {
      return { mode: 'map', view: TopoMap.views.full, overlay: r.id === 'fire' ? TopoMap.targets(hitStates) : '' };
    }
    var t = taskOf(st);
    var c = state.cur;
    var open = c.phase === 'reveal';
    if (t.kind === 'target') {
      var tg = TopoMap.target(t.target);
      var extra = '';
      if (open) {
        if (t.type === 'square') extra = TopoMap.squareSnail(TopoMap.square(t.square[0], t.square[1]), t.snail, true);
        if (t.type === 'orient') {
          var from = TopoMap.obj(t.from);
          extra = TopoMap.ring(from.e, from.n) + TopoMap.arrow(from.e, from.n, from.e + t.dir[0] * t.dist, from.n + t.dir[1] * t.dist, t.dist + ' м');
        }
        if (t.type === 'rect') {
          var sq = TopoMap.squareOf(tg.e, tg.n);
          extra = TopoMap.squareSnail(sq, 0, false) + TopoMap.rectLines(tg.e, tg.n, sq);
        }
      }
      // Подбитые в этом задании цели рисуем только после раскрытия.
      var states = {};
      Object.keys(hitStates).forEach(function (k) { if (k !== t.target || open) states[k] = 'hit'; });
      return { mode: 'map', view: TopoMap.views.full, overlay: extra + TopoMap.targets(states) };
    }
    var o = TopoMap.obj(t.object);
    var sqo = TopoMap.squareOf(o.e, o.n);
    var view = t.view === 'zoom' ? TopoMap.squareBox(sqo) : TopoMap.views[t.view] || TopoMap.views.full;
    var ov = '';
    if (t.type === 'square') {
      ov = (open ? TopoMap.squareSnail(sqo, 4, true) : '') + TopoMap.ring(o.e, o.n);
    } else if (t.type === 'rect') {
      ov = TopoMap.ticks(sqo) + TopoMap.squareLabels(sqo) + (open ? TopoMap.rectLines(o.e, o.n, sqo) : '') + TopoMap.ring(o.e, o.n);
    } else if (t.type === 'geo') {
      ov = (open ? TopoMap.geoLines(o.e, o.n) : '') + TopoMap.ring(o.e, o.n);
    }
    return { mode: 'map', view: view, overlay: ov };
  }

  /* ---------- Отрисовка: каркас ---------- */

  var ICONS = {
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    legend: '<svg viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14"/><path d="M15 5v14"/></svg>'
  };

  function skeleton() {
    appEl.innerHTML =
      '<header class="topbar" id="topbar"></header>' +
      '<div class="timebar-track"><div class="timebar" id="timebar"></div></div>' +
      '<main class="stage" id="stage">' +
      '<section class="map-wrap" id="mapWrap"></section>' +
      '<section class="panel" id="panel"></section>' +
      '<section class="center" id="center"></section>' +
      '</main>' +
      '<footer class="scoreboard" id="scoreboard"></footer>' +
      '<div class="banner" id="banner" hidden></div>' +
      '<div class="modal-host" id="modal"></div>' +
      '<div class="toast" id="toast" hidden></div>';
    TopoMap.mount(document.getElementById('mapWrap'));
  }

  function render() {
    var st = step();
    var scene = mapScene();
    var stage = document.getElementById('stage');
    stage.className = 'stage mode-' + scene.mode + ' step-' + st.type;
    appEl.className = 'app' + (st.type === 'title' ? ' is-title' : '');
    TopoMap.view(scene.view);
    TopoMap.overlay(scene.overlay);

    document.getElementById('topbar').innerHTML = renderTopbar();
    var panel = document.getElementById('panel');
    var center = document.getElementById('center');
    if (scene.mode === 'map') {
      panel.innerHTML = renderPanel();
      center.innerHTML = '';
    } else {
      panel.innerHTML = '';
      center.innerHTML = renderCenter();
    }
    document.getElementById('scoreboard').innerHTML = renderScoreboard();
    document.getElementById('modal').innerHTML = renderModal();
    document.getElementById('timebar').parentNode.classList.toggle('is-off', !state.timer);
    tick();
  }

  function iconBtn(action, icon, title) {
    return '<button class="icon-btn" data-action="' + action + '" title="' + esc(title) + '">' + ICONS[icon] + '</button>';
  }

  function renderTopbar() {
    var st = step();
    var where = '';
    if (st.type === 'rules') where = 'Построение';
    if (st.type === 'final') where = 'Итоги';
    if (st.type === 'intro' || st.type === 'task') {
      var r = roundOf(st);
      where = r.name + ' · ' + r.title;
      if (st.type === 'task') where += ' <span class="muted">— ' + (st.t + 1) + ' / ' + r.tasks.length + '</span>';
    }
    var timer = state.timer
      ? '<div class="timer" id="timer" data-action="pause" title="Пауза (P)"><span class="timer-num">0:00</span></div>'
      : '';
    var mapStep = mapScene().mode === 'map';
    return '<div class="brand head">' + esc(DATA.title) + '</div>' +
      '<div class="where head">' + where + '</div>' +
      timer +
      '<div class="tools">' +
      '<span class="clock" title="Время игры"><span class="muted">игра</span> <b id="clock">0:00</b></span>' +
      iconBtn('undo', 'undo', 'Отменить последнее действие (Ctrl+Z)') +
      (mapStep ? iconBtn('legend', 'legend', 'Условные знаки (L)') : '') +
      iconBtn('mute', Sound.isMuted() ? 'mute' : 'sound', 'Звук (M)') +
      iconBtn('fullscreen', 'full', 'Во весь экран (F)') +
      iconBtn('restart', 'restart', 'Начать заново') +
      '</div>';
  }

  function renderScoreboard() {
    var st = step();
    if (st.type === 'title') { ui.lastTotals = null; return ''; }
    var t = totals(state);
    var prev = ui.lastTotals;
    ui.lastTotals = t.slice();
    var best = Math.max.apply(null, t);
    return state.teams.map(function (name, i) {
      var delta = prev ? t[i] - prev[i] : 0;
      var lead = best > 0 && t[i] === best;
      return '<div class="plate team-' + i + (lead ? ' is-lead' : '') + (delta ? ' is-bump' : '') + '">' +
        '<span class="plate-name">' + esc(name) + '</span>' +
        '<span class="plate-score head">' + t[i] + '</span>' +
        (delta ? '<span class="plate-delta ' + (delta > 0 ? 'up' : 'down') + '">' + signed(delta) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  function renderModal() {
    if (ui.confirm) {
      return '<div class="modal"><div class="modal-card">' +
        '<p>' + esc(ui.confirm.text) + '</p>' +
        '<div class="actions"><button class="btn" data-action="confirm-no">Отмена</button>' +
        '<button class="btn btn-red" data-action="confirm-yes">' + esc(ui.confirm.yes) + '</button></div>' +
        '</div></div>';
    }
    if (ui.legend) {
      return '<div class="modal" data-action="legend"><div class="modal-card legend-card">' +
        '<h2 class="head">Условные знаки</h2>' + legendGrid() +
        '<div class="actions"><button class="btn" data-action="legend">Закрыть <span class="kbd">L</span></button></div>' +
        '</div></div>';
    }
    return '';
  }

  function legendGrid() {
    return '<ul class="legend">' + DATA.map.legend.map(function (l) {
      return '<li>' + TopoMap.legendIcon(l.type) + '<span>' + esc(l.text) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ---------- Экраны без карты ---------- */

  function renderCenter() {
    var st = step();
    if (st.type === 'title') return renderTitle();
    if (st.type === 'rules') return renderRules();
    if (st.type === 'final') return renderFinal();
    if (st.type === 'intro') return renderIntroCard();
    return renderQuestionCard();
  }

  function renderTitle() {
    var started = state.step > 0 || Object.keys(state.scores).length > 0;
    return '<div class="title-card enter">' +
      '<div class="title-kicker head">Военная топография · семинар</div>' +
      '<h1 class="title head">' + esc(DATA.title) + '</h1>' +
      '<p class="title-sub">' + esc(DATA.subtitle) + '</p>' +
      '<div class="title-facts"><span>3 раунда</span><span>~10 минут</span><span>3 команды</span></div>' +
      '<div class="actions center-actions">' +
      '<button class="btn btn-primary btn-big" data-action="primary">' + (started ? 'Продолжить' : 'Начать') + ' <span class="kbd">Пробел</span></button>' +
      '</div>' +
      '<p class="title-hosts">' + esc(DATA.hosts) + '</p>' +
      '</div>';
  }

  function renderRules() {
    var teams = state.teams.map(function (name, i) {
      return '<label class="team-field team-' + i + '"><span class="team-dot"></span>' +
        '<input type="text" maxlength="24" value="' + esc(name) + '" data-team="' + i + '" aria-label="Название команды ' + (i + 1) + '"></label>';
    }).join('');
    var rounds = DATA.rounds.map(function (r) {
      return '<li><b class="head">' + esc(r.name) + ' · ' + esc(r.title) + '</b><span>' + esc(r.topics) + '</span></li>';
    }).join('');
    return '<div class="card rules-card enter">' +
      '<h2 class="card-title head">Построение</h2>' +
      '<div class="teams-edit">' + teams + '</div>' +
      '<ol class="rules">' + DATA.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' +
      '<ul class="rounds-list">' + rounds + '</ul>' +
      '<div class="actions"><button class="btn btn-primary btn-big" data-action="primary">К бою! <span class="kbd">Пробел</span></button></div>' +
      '</div>';
  }

  function renderIntroCard() {
    var r = roundOf(step());
    return '<div class="card intro-card enter">' +
      '<div class="intro-kicker head">' + esc(r.name) + '</div>' +
      '<h1 class="intro-title head">' + esc(r.title) + '</h1>' +
      '<p class="intro-topics">' + esc(r.topics) + '</p>' +
      '<ul class="intro-list">' + r.intro.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<div class="actions"><button class="btn btn-primary btn-big" data-action="primary">Первый вопрос <span class="kbd">Пробел</span></button></div>' +
      '</div>';
  }

  function renderQuestionCard() {
    var st = step();
    var t = taskOf(st);
    var c = state.cur;
    return '<div class="card q-card enter-soft">' +
      taskHead(st, t) +
      '<h1 class="q-prompt">' + esc(t.prompt) + '</h1>' +
      choiceOptions(st, t, c) +
      revealNote(t, c) +
      choiceTeams(st, t, c) +
      actions(st, t, c) +
      '</div>';
  }

  function taskHead(st, t) {
    var r = roundOf(st);
    return '<div class="task-head"><span class="chip">' + esc(t.tag) + '</span>' +
      '<span class="task-count">' + (st.t + 1) + ' из ' + r.tasks.length + '</span></div>';
  }

  function choiceOptions(st, t, c) {
    var order = state.order[st.key];
    var right = correctIndex(st);
    var open = c.phase === 'reveal';
    return '<ol class="options">' + order.map(function (orig, i) {
      var cls = 'option';
      if (open) cls += i === right ? ' is-right' : ' is-dim';
      var who = range(TEAMS).filter(function (tm) { return c.picks[tm] === i; }).map(function (tm) {
        return '<span class="pick-tag team-' + tm + '">' + esc(state.teams[tm]) + '</span>';
      }).join('');
      return '<li class="' + cls + '"><span class="opt-letter head">' + LETTERS[i] + '</span>' +
        '<span class="opt-text">' + esc(t.options[orig]) + '</span>' +
        (open && who ? '<span class="opt-who">' + who + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  function choiceTeams(st, t, c) {
    var right = correctIndex(st);
    var open = c.phase === 'reveal';
    var worth = t.points || roundOf(st).points;
    var rows = state.teams.map(function (name, tm) {
      var btns = state.order[st.key].map(function (orig, i) {
        var on = c.picks[tm] === i;
        return '<button class="pick' + (on ? ' is-on' : '') + '" data-action="pick" data-team="' + tm + '" data-idx="' + i + '"' + (open ? ' disabled' : '') + '>' + LETTERS[i] + '</button>';
      }).join('');
      var res = '';
      if (open) {
        var ok = c.picks[tm] === right;
        res = '<span class="row-res ' + (ok ? 'ok' : 'no') + '">' + (ok ? '+' + worth : c.picks[tm] == null ? 'нет ответа' : '0') + '</span>';
      }
      return '<div class="team-row team-' + tm + '"><span class="row-name">' + esc(name) + '</span><span class="row-btns">' + btns + '</span>' + res + '</div>';
    }).join('');
    return '<div class="team-input"><div class="ti-label">' + (open ? 'Ответы команд' : 'Отметьте, что подняла каждая команда') + '</div>' + rows + '</div>';
  }

  function revealNote(t, c) {
    if (c.phase !== 'reveal' || !t.explain) return '';
    return '<p class="explain">' + esc(t.explain) + '</p>';
  }

  function actions(st, t, c) {
    var label;
    var after = STEPS[state.step + 1];
    if (c.phase === 'reveal') label = after.type === 'final' ? 'К итогам' : 'Дальше';
    else if (t.kind === 'choice') label = 'Проверить';
    else label = 'Показать ответ';
    var disabled = t.kind === 'target' && c.turn != null && c.phase !== 'reveal';
    var hint = '';
    if (c.phase !== 'reveal' && state.timer && !state.timer.done) hint = '<button class="btn btn-ghost" data-action="pause">' + ICONS.pause + ' Пауза <span class="kbd">P</span></button>';
    return '<div class="actions">' + hint +
      '<button class="btn btn-primary btn-big" data-action="primary"' + (disabled ? ' disabled' : '') + '>' + label + ' <span class="kbd">Пробел</span></button></div>';
  }

  /* ---------- Панель рядом с картой ---------- */

  function renderPanel() {
    var st = step();
    if (st.type === 'intro') return renderIntroPanel();
    var t = taskOf(st);
    var c = state.cur;
    var body = '';
    if (t.kind === 'choice') {
      body = '<h2 class="p-prompt">' + esc(t.prompt) + '</h2>' + choiceOptions(st, t, c) + revealNote(t, c) + choiceTeams(st, t, c);
    } else if (t.kind === 'free') {
      body = '<h2 class="p-prompt">' + esc(t.prompt) + '</h2>' +
        (c.phase === 'reveal' ? '' : '<p class="p-hint">' + esc(t.format) + '</p>') +
        freeBody(st, t, c);
    } else {
      body = targetBody(st, t, c);
    }
    return '<div class="panel-inner enter-soft">' + taskHead(st, t) + body + actions(st, t, c) + '</div>';
  }

  function freeBody(st, t, c) {
    if (c.phase !== 'reveal') {
      var g = t.grades.filter(function (x) { return x.points > 0; }).map(function (x) { return x.label + ' — ' + pts(x.points); }).join(' · ');
      return '<div class="waiting"><span class="pulse-dot"></span>Команды пишут ответ на листке…</div>' +
        '<p class="p-score-note">' + esc(g) + '</p>';
    }
    var rows = state.teams.map(function (name, tm) {
      var btns = t.grades.map(function (g) {
        var on = c.grades[tm] === g.points;
        return '<button class="grade' + (on ? ' is-on' : '') + '" data-action="grade" data-team="' + tm + '" data-points="' + g.points + '">' +
          '<b>' + g.points + '</b><small>' + esc(g.label) + '</small></button>';
      }).join('');
      return '<div class="team-row team-' + tm + '"><span class="row-name">' + esc(name) + '</span><span class="row-btns">' + btns + '</span></div>';
    }).join('');
    return '<div class="answer-box"><div class="answer-label">Ответ</div><div class="answer head">' + esc(t.answer) + '</div>' +
      (t.answerShort ? '<div class="answer-sub">' + esc(t.answerShort) + '</div>' : '') + '</div>' +
      '<p class="explain">' + esc(t.explain) + '</p>' +
      '<div class="team-input"><div class="ti-label">Сколько очков у каждой команды?</div>' + rows + '</div>';
  }

  function targetBody(st, t, c) {
    var r = roundOf(st);
    var out = '<div class="radio"><div class="radio-label">Целеуказание' + (t.mult ? ' · <b>очки ×' + t.mult + '</b>' : '') + '</div>' +
      '<div class="radio-text">«' + esc(t.say) + ' Цель?»</div></div>';
    var log = c.tries.map(function (x) {
      return '<li class="' + (x.ok ? 'ok' : 'no') + '"><span class="team-tag team-' + x.team + '">' + esc(state.teams[x.team]) + '</span> — цель ' + x.letter +
        (x.ok ? ' · попадание! +' + r.points * (t.mult || 1) : ' · промах, −' + r.penalty) + '</li>';
    }).join('');
    if (log) out += '<ul class="tries">' + log + '</ul>';
    if (c.phase === 'reveal') {
      var tg = TopoMap.target(t.target);
      var winner = c.tries.filter(function (x) { return x.ok; })[0];
      out += '<div class="answer-box hit"><div class="answer-label">' + (winner ? 'Цель поражена' : 'Правильный ответ') + '</div>' +
        '<div class="answer head">Цель ' + esc(t.target) + '</div><div class="answer-sub">' + esc(tg.name) + '</div></div>' +
        '<p class="explain">' + esc(t.explain) + '</p>';
      return out;
    }
    if (c.turn == null) {
      out += '<div class="team-input"><div class="ti-label">Кто первым поднял руку?</div><div class="buzz">' +
        state.teams.map(function (name, tm) {
          var used = tried(tm);
          return '<button class="buzz-btn team-' + tm + '" data-action="turn" data-team="' + tm + '"' + (used ? ' disabled' : '') + '>' +
            '<span class="kbd">' + (tm + 1) + '</span>' + esc(name) + '</button>';
        }).join('') + '</div></div>';
    } else {
      var used = c.tries.map(function (x) { return x.letter; });
      out += '<div class="team-input"><div class="ti-label">Отвечает <span class="team-tag team-' + c.turn + '">' + esc(state.teams[c.turn]) + '</span> — какую цель назвал капитан?</div>' +
        '<div class="letters">' + DATA.map.targets.map(function (x) {
          var gone = used.indexOf(x.id) >= 0 || (state.hits[x.id] && x.id !== t.target);
          return '<button class="letter head" data-action="letter" data-letter="' + x.id + '"' + (gone ? ' disabled' : '') + '>' + x.id + '</button>';
        }).join('') + '</div>' +
        '<button class="btn btn-ghost btn-small" data-action="cancel-turn">Отмена</button></div>';
    }
    return out;
  }

  function renderIntroPanel() {
    var r = roundOf(step());
    var m = DATA.map;
    var extra = '';
    if (r.id === 'coords') {
      extra = '<div class="map-facts">' +
        '<div><b>Лист ' + esc(m.sheet) + '</b> (учебный) · масштаб 1:' + m.scale.toLocaleString('ru-RU') + '</div>' +
        '<div>Сторона квадрата — 1 км · горизонтали через ' + m.contourStep + ' м</div></div>' + legendGrid();
    } else {
      extra = '<ul class="target-list">' + m.targets.map(function (x) {
        return '<li>' + TopoMap.targetIcon(x.id) + esc(x.name) + '</li>';
      }).join('') + '</ul>';
    }
    return '<div class="panel-inner enter-soft">' +
      '<div class="intro-kicker head">' + esc(r.name) + '</div>' +
      '<h1 class="intro-title head small">' + esc(r.title) + '</h1>' +
      '<ul class="intro-list">' + r.intro.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      extra +
      '<div class="actions"><button class="btn btn-primary btn-big" data-action="primary">Начали <span class="kbd">Пробел</span></button></div>' +
      '</div>';
  }

  /* ---------- Итоги ---------- */

  function renderFinal() {
    var t = totals(state);
    var order = range(TEAMS).sort(function (a, b) { return t[b] - t[a]; });
    var best = t[order[0]];
    var winners = order.filter(function (i) { return t[i] === best; });
    var place = 0, prev = null;
    var rows = order.map(function (i, k) {
      if (t[i] !== prev) { place = k + 1; prev = t[i]; }
      var per = DATA.rounds.map(function (r, ri) { return '<td>' + roundTotals(state, ri)[i] + '</td>'; }).join('');
      return '<tr class="team-' + i + (t[i] === best ? ' is-win' : '') + '"><td class="place head">' + place + '</td>' +
        '<td class="fin-name">' + esc(state.teams[i]) + '</td>' + per + '<td class="fin-total head">' + t[i] + '</td></tr>';
    }).join('');
    var head = DATA.rounds.map(function (r) { return '<th>' + esc(r.title) + '</th>'; }).join('');
    var title = winners.length > 1
      ? 'Ничья: ' + winners.map(function (i) { return state.teams[i]; }).join(' и ')
      : 'Победа: ' + state.teams[winners[0]];
    return '<div class="card final-card enter">' +
      '<div class="stamp head">Бой окончен</div>' +
      '<h1 class="final-title head">' + esc(title) + '</h1>' +
      '<table class="final-table"><thead><tr><th></th><th>Команда</th>' + head + '<th>Итого</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="final-note">Время игры: ' + fmtClock((state.finishedAt || Date.now()) - (state.startedAt || Date.now())) + '. Спасибо за внимание!</p>' +
      '<div class="actions"><button class="btn" data-action="restart">' + ICONS.restart + ' Новая игра</button></div>' +
      '</div>';
  }

  /* ---------- События ---------- */

  appEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    // Фокус на кнопке нельзя оставлять: иначе пробел «нажмёт» её ещё раз.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var a = btn.getAttribute('data-action');
    var team = Number(btn.getAttribute('data-team'));
    if (a === 'legend' && ev.target.closest('.modal-card') && btn.classList.contains('modal')) return;
    switch (a) {
      case 'primary': primary(); break;
      case 'pick': pick(team, Number(btn.getAttribute('data-idx'))); break;
      case 'grade': grade(team, Number(btn.getAttribute('data-points'))); break;
      case 'turn': chooseTeam(team); break;
      case 'cancel-turn': cancelTurn(); break;
      case 'letter': answerLetter(btn.getAttribute('data-letter')); break;
      case 'pause': togglePause(); break;
      case 'undo': undo(); break;
      case 'legend': ui.legend = !ui.legend; render(); break;
      case 'mute': toggleMute(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'restart': restart(); break;
      case 'confirm-no': ui.confirm = null; render(); break;
      case 'confirm-yes':
        var act = ui.confirm && ui.confirm.action;
        ui.confirm = null;
        if (act) act(); else render();
        break;
    }
  });

  appEl.addEventListener('change', function (ev) {
    var input = ev.target.closest('input[data-team]');
    if (!input) return;
    var i = Number(input.getAttribute('data-team'));
    var name = input.value.trim() || DATA.teams[i];
    if (name === state.teams[i]) return;
    commit(function (s) { s.teams[i] = name; });
  });

  document.addEventListener('keydown', function (ev) {
    var typing = ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA');
    if (typing) {
      if (ev.key === 'Enter') ev.target.blur();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.code === 'KeyZ')) { ev.preventDefault(); undo(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ui.confirm) {
      if (ev.key === 'Escape') { ui.confirm = null; render(); }
      if (ev.key === 'Enter') { var act = ui.confirm.action; ui.confirm = null; act(); }
      return;
    }
    if (ev.code === 'Space' || ev.key === 'Enter') { ev.preventDefault(); if (ui.legend) { ui.legend = false; render(); } else primary(); return; }
    if (ev.key === 'Escape') { if (ui.legend) { ui.legend = false; render(); } else cancelTurn(); return; }
    if (ev.code === 'KeyF') { toggleFullscreen(); return; }
    if (ev.code === 'KeyM') { toggleMute(); return; }
    if (ev.code === 'KeyP') { togglePause(); return; }
    if (ev.code === 'KeyL' && mapScene().mode === 'map') { ui.legend = !ui.legend; render(); return; }
    var digit = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[ev.code];
    if (digit != null && step().type === 'task' && taskOf(step()).kind === 'target') chooseTeam(digit);
  });

  /* ---------- Запуск ---------- */

  load();
  skeleton();
  render();
  setInterval(tick, 150);
})();
