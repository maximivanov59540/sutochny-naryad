/* Движок игры: доска карточек, две команды, финальный гость. Тексты и задания — в data.js каждой игры. */
(function () {
  'use strict';

  var DATA = window.GAME_DATA;

  // Подписи интерфейса. По умолчанию — «Суточный наряд роты»; другая игра переопределяет их в DATA.ui.
  var T = {
    storageKey: 'sutochny-naryad:game',
    authKey: 'sutochny-naryad:auth',
    brand: 'Суточный наряд роты',
    kicker: 'Основы военной подготовки · Устав внутренней службы ВС РФ',
    topics: ['Предназначение и состав суточного наряда', 'Дневальный и дежурный по роте', 'Развод суточного наряда'],
    sides: {
      naryad: { name: 'Наряд', short: 'наряд', now: 'Отвечает наряд', done: 'Наряд справился',
        wrong: 'Наряд ошибся.', wrongIn: 'Наряд ошибся в', pass: 'Наряд не знает.', fail: 'Наряд не справился.' },
      check: { name: 'Проверяющие', short: 'проверяющие', now: 'Выручают проверяющие', done: 'Выручили проверяющие',
        address: 'Проверяющие, ' }
    },
    schemeButton: 'Кто есть кто',
    schemeKicker: 'Перед заступлением',
    schemeTitle: 'Кто есть кто в суточном наряде',
    schemeCaption: 'Суточный наряд роты — ст. 258 УВС',
    orderHead: 'Порядок развода',
    book: 'Книга замечаний',
    bookTo: 'В книгу замечаний',
    bookEntry: 'Запись в книгу замечаний',
    bookPass: 'Не знают — в книгу замечаний',
    bookEmpty: 'Страницы чистые — ни одного замечания за сутки.',
    passToCheck: 'Не знают — передать проверяющим',
    pickHint: 'Проверяющие выбирают карточку',
    callBoss: 'Вызвать генерала',
    callBossNow: 'Вызвать генерала прямо сейчас?',
    allDone: 'Все карточки сыграны. Встречайте генерала!',
    bossOpens: 'Генерал открывает',
    bossQuestion: 'Вопрос генерала',
    bossHappy: 'Генерал доволен',
    bossFrown: 'Генерал хмурится',
    bossClean: 'Генерал доволен — дальше',
    greetWeak: 'Вяло',
    greetLoud: 'Громко и чётко!',
    finalGreet: '«Смирно!» генералу',
    finalQuestions: 'Вопросы генерала',
    finalKicker: 'Итоги суток'
  };
  (function merge(dst, src) {
    Object.keys(src || {}).forEach(function (k) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k]) merge(dst[k], src[k]);
      else dst[k] = src[k];
    });
  })(T, DATA.ui);

  var STORAGE_KEY = T.storageKey;
  var AUTH_KEY = T.authKey;
  var PASSWORD_HASH = 1984369114866794; // хэш пароля: строчные русские буквы без пробелов
  var UNDO_LIMIT = 80;
  var LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
  var DIGITS = {
    Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8,
    Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad7: 6, Numpad8: 7, Numpad9: 8
  };
  var SIDES = T.sides;

  var appEl = document.getElementById('app');
  var toastEl = document.getElementById('toast');

  var state = null;
  var undoStack = [];
  var authed = false;
  var ui = {
    help: false,
    confirm: null,
    busy: false,
    seen: {},
    lastPool: null,
    lastTickSec: null,
    toastTimer: null
  };

  /* ---------- Хранилище ---------- */

  function store(kind) {
    try { return window[kind] || null; } catch (e) { return null; }
  }
  function readStore(kind, key) {
    try { var s = store(kind); return s ? s.getItem(key) : null; } catch (e) { return null; }
  }
  function writeStore(kind, key, value) {
    try { var s = store(kind); if (s) s.setItem(key, value); } catch (e) { /* без сохранения */ }
  }

  /* ---------- Утилиты ---------- */

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
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
  // Перемешать так, чтобы ни один шаг не остался на своём месте — иначе порядок подсказывает сам себя.
  function derange(n) {
    for (var attempt = 0; attempt < 200; attempt++) {
      var order = shuffle(range(n));
      if (order.every(function (v, i) { return v !== i; })) return order;
    }
    return range(n).map(function (i) { return (i + 1) % n; });
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
  function fmtTime(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  var ICONS = {
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'
  };

  /* ---------- Пароль ---------- */

  // Символы английской раскладки → русские буквы на тех же клавишах.
  var EN_TO_RU = {
    q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ', '{': 'х', '}': 'ъ',
    a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э', ':': 'ж', '"': 'э',
    z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '<': 'б', '>': 'ю', '`': 'ё', '~': 'ё'
  };

  function normalizePassword(value) {
    var s = String(value).toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (EN_TO_RU[ch]) ch = EN_TO_RU[ch];
      if (ch === 'ё') ch = 'е';
      if (ch >= 'а' && ch <= 'я') out += ch;
    }
    return out;
  }

  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function tryPassword(value) {
    if (cyrb53(normalizePassword(value)) === PASSWORD_HASH) {
      authed = true;
      writeStore('sessionStorage', AUTH_KEY, '1');
      Sound.unlock();
      Sound.play('start');
      render();
      if (hasProgress()) toast('Игра восстановлена');
      return;
    }
    Sound.play('deny');
    var box = appEl.querySelector('.dossier-gate');
    var error = appEl.querySelector('.gate-error');
    var input = appEl.querySelector('.gate-input');
    if (error) error.hidden = false;
    if (box) {
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
    }
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  /* ---------- Состояние ---------- */

  function newState() {
    var order = {};
    DATA.cards.forEach(function (card, i) {
      if (card.kind === 'choice') order[i] = shuffle(range(card.options.length));
      if (card.kind === 'order') order[i] = derange(card.steps.length);
    });
    DATA.general.questions.forEach(function (q, i) { order['g' + i] = shuffle(range(q.options.length)); });

    // Пакеты с заданной карточкой ставим на неё, остальные — на случайные свободные.
    var packets = {};
    DATA.packets.forEach(function (p, pi) { if (p.card != null) packets[p.card] = pi; });
    DATA.packets.forEach(function (p, pi) {
      if (p.card != null) return;
      var free = range(DATA.cards.length).filter(function (i) { return packets[i] == null; });
      if (free.length) packets[free[Math.floor(Math.random() * free.length)]] = pi;
    });

    return {
      v: 1,
      screen: 'title',
      schemeStep: 1,
      done: {},
      book: [],
      earned: { naryad: 0, check: 0, smirno: 0, general: 0, penalty: 0, hints: 0 },
      packets: packets,
      order: order,
      current: null,
      general: null,
      startedAt: null
    };
  }

  function isValidState(s) {
    return !!s && s.v === 1 && !!s.done && Array.isArray(s.book) && !!s.earned && !!s.order && !!s.packets &&
      Object.keys(s.done).every(function (k) { return !!DATA.cards[k]; });
  }

  function load() {
    var raw = readStore('localStorage', STORAGE_KEY);
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        if (isValidState(saved.state)) {
          state = saved.state;
          undoStack = Array.isArray(saved.undo) ? saved.undo : [];
          if (state.current && !DATA.cards[state.current.card]) state.current = null;
          restartTimer();
          return;
        }
      } catch (e) { /* повреждённое сохранение — начинаем заново */ }
    }
    state = newState();
    undoStack = [];
  }

  function save() {
    writeStore('localStorage', STORAGE_KEY, JSON.stringify({ state: state, undo: undoStack }));
  }

  function commit(mutate) {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    mutate(state);
    save();
    render();
  }

  // После отмены или перезагрузки таймер «Ночной тревоги» запускается заново — иначе он сразу бы истёк.
  function restartTimer() {
    var c = state.current;
    if (c && c.timerEnd && c.packet != null) {
      c.timerEnd = Date.now() + (DATA.packets[c.packet].timer || 0) * 1000;
    }
  }

  function undo() {
    if (!undoStack.length) {
      toast('Отменять нечего');
      return;
    }
    state = JSON.parse(undoStack.pop());
    ui.busy = false;
    restartTimer();
    save();
    render();
    toast('Последнее действие отменено');
  }

  function resetGame() {
    state = newState();
    undoStack = [];
    ui.help = false;
    save();
    render();
    toast('Новая игра');
  }

  function pool(s) {
    var e = (s || state).earned;
    return e.naryad + e.check + e.smirno + e.general - e.penalty - e.hints;
  }

  function doneCount() { return Object.keys(state.done).length; }

  function hasProgress() {
    return doneCount() > 0 || !!state.current || state.screen === 'general' || state.screen === 'final';
  }

  function gradeFor(points) {
    for (var i = 0; i < DATA.grades.length; i++) {
      if (points >= DATA.grades[i].min) return DATA.grades[i];
    }
    return DATA.grades[DATA.grades.length - 1];
  }

  /* ---------- Навигация ---------- */

  function go(screen) {
    commit(function (s) {
      s.screen = screen;
      if (screen === 'board' && !s.startedAt) s.startedAt = Date.now();
    });
  }

  function schemeNext() {
    if (state.schemeStep < DATA.scheme.length) {
      commit(function (s) { s.schemeStep++; });
      Sound.play('paper');
    } else {
      go('board');
      Sound.play('start');
    }
  }

  /* ---------- Карточки ---------- */

  function openCard(i) {
    if (state.screen !== 'board' || state.current || state.done[i] || ui.busy) return;
    var card = DATA.cards[i];
    if (!card) return;
    var pi = state.packets[i];
    commit(function (s) {
      s.current = {
        card: i,
        packet: pi == null ? null : pi,
        stage: pi == null ? 2 : 0,          // 0 — пакет запечатан, 1 — вскрыт, 2 — задание
        phase: 'naryad',                    // naryad → check → done
        why: null,                          // почему ход у проверяющих: wrong | pass | timeout
        info: null,                         // сколько ошибок нашла проверка
        mult: 1,
        timerEnd: null,
        wrong: [],
        answers: card.kind === 'list' ? card.items.map(function () { return null; }) : [],
        placed: [],
        marked: {},
        result: null
      };
    });
    Sound.play(pi == null ? 'paper' : 'alarm');
  }

  function openPacket() {
    var c = state.current;
    if (!c || c.stage !== 0 || ui.busy) return;
    ui.busy = true;
    var envelope = appEl.querySelector('.envelope');
    if (envelope) envelope.classList.add('is-opening');
    Sound.play('drum');
    setTimeout(function () {
      ui.busy = false;
      if (!state.current || state.current.stage !== 0) return;
      commit(function (s) {
        s.current.stage = 1;
        s.current.mult = DATA.packets[s.current.packet].mult || 1;
      });
      Sound.play(DATA.packets[state.current.packet].timer ? 'alarm' : 'fanfare');
    }, 1050);
  }

  function startTask() {
    var c = state.current;
    if (!c || c.stage !== 1) return;
    var packet = DATA.packets[c.packet];
    commit(function (s) {
      s.current.stage = 2;
      if (packet.timer) s.current.timerEnd = Date.now() + packet.timer * 1000;
    });
    ui.lastTickSec = null;
    Sound.play('click');
  }

  function isUntouched(c) {
    if (c.stage === 0) return true;
    return c.stage === 2 && c.packet == null && c.phase === 'naryad' && !c.wrong.length &&
      !c.placed.some(function (x) { return x != null; }) &&
      !Object.keys(c.marked).length && c.answers.every(function (a) { return a == null; });
  }

  function cancelCard() {
    var c = state.current;
    if (!c || ui.busy || !isUntouched(c)) return;
    commit(function (s) { s.current = null; });
    toast('Карточка закрыта — выбирайте заново');
  }

  function finishTask(s, by) {
    var c = s.current;
    var points = by ? DATA.points[by] * c.mult : 0;
    if (by) s.earned[by] += points;
    else s.book.push(c.card);
    c.phase = 'done';
    c.timerEnd = null;
    c.result = { by: by, points: points };
    s.done[c.card] = { by: by, points: points, packet: c.packet };
  }

  function toCheck(s, why, info) {
    s.current.phase = 'check';
    s.current.why = why;
    s.current.info = info || null;
    s.current.timerEnd = null;
  }

  function soundOutcome(right) {
    if (right) {
      Sound.play('correct');
      return;
    }
    Sound.play('wrong');
    if (state.current && state.current.phase === 'done') setTimeout(function () { Sound.play('stamp'); }, 450);
  }

  function canAnswer() {
    var c = state.current;
    return !!c && c.stage === 2 && c.phase !== 'done' && !ui.busy;
  }

  function pick(opt) {
    if (!canAnswer()) return;
    var c = state.current;
    var card = DATA.cards[c.card];
    if (card.kind !== 'choice' || !(opt >= 0 && opt < card.options.length)) return;
    if (c.wrong.some(function (w) { return w.opt === opt; })) return;
    var right = opt === 0;
    var phase = c.phase;
    commit(function (s) {
      if (right) {
        finishTask(s, phase);
      } else {
        s.current.wrong.push({ opt: opt, by: phase });
        if (phase === 'naryad') toCheck(s, 'wrong');
        else finishTask(s, null);
      }
    });
    soundOutcome(right);
  }

  function pass() {
    if (!canAnswer()) return;
    var phase = state.current.phase;
    commit(function (s) {
      if (phase === 'naryad') toCheck(s, 'pass');
      else finishTask(s, null);
    });
    Sound.play(phase === 'naryad' ? 'soft' : 'stamp');
  }

  function timeout() {
    var c = state.current;
    if (!c || c.phase !== 'naryad' || !c.timerEnd) return;
    commit(function (s) { toCheck(s, 'timeout'); });
    Sound.play('timeout');
  }

  function setAnswer(item, label) {
    if (!canAnswer()) return;
    var c = state.current;
    if (DATA.cards[c.card].kind !== 'list') return;
    commit(function (s) { s.current.answers[item] = c.answers[item] === label ? null : label; });
    Sound.play('click');
  }

  function placeStep(step) {
    if (!canAnswer()) return;
    var c = state.current;
    if (DATA.cards[c.card].kind !== 'order' || c.placed.indexOf(step) >= 0) return;
    // Шаг встаёт в первую пустую ячейку — так проверяющие исправляют порядок, не трогая остальное.
    commit(function (s) {
      var placed = s.current.placed;
      var hole = placed.indexOf(null);
      if (hole >= 0) placed[hole] = step;
      else placed.push(step);
    });
    Sound.play('click');
  }

  function unplaceStep(pos) {
    if (!canAnswer()) return;
    var c = state.current;
    if (DATA.cards[c.card].kind !== 'order' || c.placed[pos] == null) return;
    commit(function (s) {
      var placed = s.current.placed;
      placed[pos] = null;
      while (placed.length && placed[placed.length - 1] == null) placed.pop();
    });
    Sound.play('soft');
  }

  function toggleMark(frag) {
    if (!canAnswer()) return;
    var c = state.current;
    if (DATA.cards[c.card].kind !== 'spot') return;
    commit(function (s) {
      if (s.current.marked[frag]) delete s.current.marked[frag];
      else s.current.marked[frag] = true;
    });
    Sound.play(state.current.marked[frag] ? 'stamp' : 'soft');
  }

  function spotStats(card, c) {
    var found = 0, total = 0, extra = 0;
    card.fragments.forEach(function (f, k) {
      if (f.bad) {
        total++;
        if (c.marked[k]) found++;
      } else if (c.marked[k]) {
        extra++;
      }
    });
    return { found: found, total: total, extra: extra, errors: total - found + extra };
  }

  function verify() {
    if (!canAnswer()) return;
    var c = state.current;
    var card = DATA.cards[c.card];
    var info;
    if (card.kind === 'list') {
      if (c.answers.some(function (a) { return a == null; })) { toast('Сначала ответьте на все пункты'); return; }
      info = {
        errors: card.items.filter(function (it, k) { return c.answers[k] !== it.correct; }).length,
        total: card.items.length
      };
    } else if (card.kind === 'order') {
      if (c.placed.length < card.steps.length || c.placed.some(function (x) { return x == null; })) {
        toast('Сначала расставьте все шаги');
        return;
      }
      info = {
        errors: c.placed.filter(function (step, k) { return step !== k; }).length,
        total: card.steps.length
      };
    } else if (card.kind === 'spot') {
      info = spotStats(card, c);
    } else {
      return;
    }
    var right = info.errors === 0;
    var phase = c.phase;
    commit(function (s) {
      if (right) finishTask(s, phase);
      else if (phase === 'naryad') toCheck(s, 'wrong', info);
      else finishTask(s, null);
    });
    soundOutcome(right);
  }

  function closeCard() {
    var c = state.current;
    if (!c || c.phase !== 'done') return;
    commit(function (s) { s.current = null; });
    Sound.play('click');
    if (doneCount() === DATA.cards.length) toast(T.allDone);
  }

  /* ---------- Генерал ---------- */

  function callGeneral() {
    if (state.screen !== 'board' || state.current) return;
    var left = DATA.cards.length - doneCount();
    if (left > 0) {
      askConfirm('Остались несыгранные карточки: ' + left + '. ' + T.callBossNow, T.callBoss, startGeneral);
      return;
    }
    startGeneral();
  }

  function startGeneral() {
    commit(function (s) {
      s.screen = 'general';
      s.general = { step: 'alarm', q: 0, picked: null, hidden: [], used: { fifty: false, call: false }, callOn: false, smirno: null };
    });
    Sound.play('siren');
  }

  function smirno(loud) {
    var g = state.general;
    if (!g || g.step !== 'alarm') return;
    commit(function (s) {
      s.general.smirno = loud;
      s.earned.smirno = loud ? DATA.points.smirno : 0;
      s.general.step = 'book';
    });
    Sound.play(loud ? 'correct' : 'soft');
  }

  function acceptBook() {
    var g = state.general;
    if (!g || g.step !== 'book') return;
    var n = state.book.length;
    commit(function (s) {
      s.earned.penalty = Math.min(n * DATA.points.bookPenalty, Math.max(0, pool(s)));
      s.general.step = 'q';
      s.general.q = 0;
    });
    Sound.play(n ? 'stamp' : 'paper');
  }

  function generalPick(opt) {
    var g = state.general;
    if (!g || g.step !== 'q' || g.picked != null || ui.busy) return;
    var q = DATA.general.questions[g.q];
    if (!(opt >= 0 && opt < q.options.length) || g.hidden.indexOf(opt) >= 0) return;
    var right = opt === 0;
    commit(function (s) {
      s.general.picked = opt;
      if (right) s.earned.general += DATA.points.general;
    });
    Sound.play(right ? 'correct' : 'wrong');
  }

  function useHint(kind) {
    var g = state.general;
    var hint = DATA.hints[kind];
    if (!g || g.step !== 'q' || g.picked != null || !hint) return;
    if (g.used[kind]) { toast('Эта подсказка уже использована'); return; }
    if (pool() < hint.cost) { toast('В котле не хватает очков'); return; }
    commit(function (s) {
      s.general.used[kind] = true;
      s.earned.hints += hint.cost;
      if (kind === 'fifty') {
        var q = DATA.general.questions[s.general.q];
        s.general.hidden = shuffle(range(q.options.length).filter(function (i) { return i !== 0; })).slice(0, 2);
      } else {
        s.general.callOn = true;
      }
    });
    Sound.play('paper');
  }

  function generalNext() {
    var g = state.general;
    if (!g || g.step !== 'q' || g.picked == null) return;
    var last = g.q + 1 >= DATA.general.questions.length;
    commit(function (s) {
      if (last) {
        s.screen = 'final';
      } else {
        s.general.q++;
        s.general.picked = null;
        s.general.hidden = [];
        s.general.callOn = false;
      }
    });
    Sound.play(last ? 'fanfare' : 'paper');
  }

  /* ---------- Сервисное ---------- */

  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.remove('is-shown');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-shown');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  function askConfirm(text, yesLabel, action) {
    ui.confirm = { text: text, yes: yesLabel, action: action };
    render();
  }

  function confirmYes() {
    var action = ui.confirm && ui.confirm.action;
    ui.confirm = null;
    if (action) action();
    else render();
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) { /* полноэкранный режим недоступен */ }
  }

  function toggleMute() {
    var muted = Sound.toggle();
    toast(muted ? 'Звук выключен' : 'Звук включён');
    render();
  }

  /* ---------- Отрисовка: общие части ---------- */

  function renderTopbar(kind) {
    var mid = '';
    if (kind === 'general') {
      mid = '<div class="top-pool"><span class="top-pool-label">Котёл</span>' +
        '<span class="top-pool-value head" data-pool>' + pool() + '</span></div>';
    }
    return '<header class="topbar' + (kind === 'general' ? ' topbar-general' : '') + '">' +
      '<div class="brand"><span class="brand-mark" aria-hidden="true"></span>' +
      '<span class="brand-name head">' + esc(T.brand) + '</span></div>' +
      mid +
      '<div class="topbar-right">' +
      '<span class="clock head" id="clock" title="Время с начала игры">' + (state.startedAt ? fmtTime(Date.now() - state.startedAt) : '') + '</span>' +
      '<button class="icon-btn" data-action="undo" title="Отменить последнее действие (Ctrl+Z)">' + ICONS.undo + '</button>' +
      '<button class="icon-btn" data-action="mute" title="Звук (M)">' + (Sound.isMuted() ? ICONS.mute : ICONS.sound) + '</button>' +
      '<button class="icon-btn" data-action="full" title="Во весь экран (F)">' + ICONS.full + '</button>' +
      '<button class="icon-btn" data-action="help" title="Подсказка ведущему (F1)">' + ICONS.help + '</button>' +
      '</div></header>';
  }

  function renderGate() {
    return '<div class="screen"><div class="dossier dossier-gate enter" data-k="gate">' +
      '<div class="kicker">Основы военной подготовки</div>' +
      '<div class="title head">' + esc(T.brand) + '</div>' +
      '<form class="gate-form" data-form="gate" autocomplete="off">' +
      '<label class="gate-label" for="gate-input">Пароль:</label>' +
      '<div class="gate-row"><input class="gate-input" id="gate-input" type="password" autofocus>' +
      '<button class="btn btn-primary btn-big" type="submit">Войти</button></div>' +
      '<div class="gate-hint">Регистр и раскладка клавиатуры не важны.</div>' +
      '<div class="gate-error head" hidden>Доступ запрещён</div>' +
      '</form></div></div>';
  }

  function renderTitle() {
    return '<div class="screen"><div class="dossier dossier-title enter" data-k="title">' +
      '<span class="stamp stamp-corner head">Для служебного пользования</span>' +
      '<div class="kicker">' + esc(T.kicker) + '</div>' +
      '<div class="title head">' + esc(T.brand) + '</div>' +
      '<div class="subtitle head">' + esc(DATA.subtitle) + '</div>' +
      '<ul class="topics">' + T.topics.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<div class="doc-actions">' +
      '<button class="btn btn-primary btn-big" data-action="to-rules">Начать <span class="kbd">Пробел</span></button>' +
      '</div></div></div>';
  }

  function renderRules() {
    var grades = DATA.grades.map(function (g, i) {
      var cond = i === DATA.grades.length - 1 ? 'меньше' : 'от ' + g.min + ' ' + (g.min % 10 === 1 && g.min % 100 !== 11 ? 'очка' : 'очков');
      return '<div class="grade"><span class="stamp stamp-small head">' + esc(g.stamp) + '</span><span class="grade-cond">' + cond + '</span></div>';
    }).join('');
    return '<div class="screen"><div class="dossier dossier-rules enter" data-k="rules">' +
      '<div class="doc-head"><div class="kicker">Порядок несения службы</div><span class="stamp stamp-small head">Утверждаю</span></div>' +
      '<ol class="rules">' + DATA.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' +
      '<div class="grades">' + grades + '</div>' +
      '<div class="doc-actions">' +
      '<button class="btn btn-primary btn-big" data-action="to-scheme">' + esc(T.schemeButton) + ' <span class="kbd">Пробел</span></button>' +
      '</div></div></div>';
  }

  function schemeNode(node, visible, extra) {
    return '<div class="node' + (extra || '') + (visible ? ' is-visible' : '') + '">' +
      '<div class="node-role head">' + esc(node.role) + '</div>' +
      '<div class="node-note">' + esc(node.note) + '</div>' +
      '<div class="node-norm">' + esc(node.norm) + '</div></div>';
  }

  function renderScheme() {
    var step = state.schemeStep;
    var html = '<div class="scheme-flow">';
    DATA.scheme.forEach(function (node, i) {
      var visible = i < step;
      if (i > 0) html += '<div class="arrow' + (visible ? ' is-visible' : '') + '" aria-hidden="true"></div>';
      if (node.children) {
        html += '<div class="node-group' + (visible ? ' is-visible' : '') + '">' +
          schemeNode(node, visible, ' node-main') +
          '<div class="node-children">' + node.children.map(function (ch) { return schemeNode(ch, visible, ' node-child'); }).join('') + '</div></div>';
      } else {
        html += schemeNode(node, visible, i === 0 ? ' node-top' : '');
      }
      if (i === 0) html += '<div class="scheme-caption' + (step > 1 ? ' is-visible' : '') + '">' + esc(T.schemeCaption) + '</div>';
    });
    html += '</div>';
    var last = step >= DATA.scheme.length;
    return '<div class="screen screen-scheme"><div class="scheme enter" data-k="scheme">' +
      '<div class="scheme-head"><div class="kicker">' + esc(T.schemeKicker) + '</div><div class="scheme-title head">' + esc(T.schemeTitle) + '</div></div>' +
      html +
      '<div class="doc-actions">' +
      '<button class="btn btn-primary btn-big" data-action="scheme-next">' + (last ? 'К карточкам' : 'Дальше') + ' <span class="kbd">Пробел</span></button>' +
      '</div></div></div>';
  }

  /* ---------- Табло ---------- */

  function resultLabel(res) {
    if (!res.by) return 'Замечание';
    return '+' + res.points + ' · ' + SIDES[res.by].short;
  }

  function renderBoard() {
    var cells = DATA.cards.map(function (card, i) {
      var res = state.done[i];
      var cls = 'cell';
      if (res) cls += ' is-done ' + (res.by ? 'by-' + res.by : 'by-none');
      return '<button class="' + cls + '" data-action="open" data-card="' + i + '"' + (res ? ' disabled' : '') + '>' +
        '<span class="cell-num head stencil">' + (i + 1) + '</span>' +
        '<span class="cell-title head">' + esc(card.title) + '</span>' +
        '<span class="cell-tag">' + esc(card.tag) + '</span>' +
        (res && res.packet != null ? '<span class="cell-packet head">Пакет</span>' : '') +
        (res ? '<span class="cell-result stamp head">' + resultLabel(res) + '</span>' : '') +
        '</button>';
    }).join('');

    var e = state.earned;
    var bookList = state.book.length
      ? '<ol class="book-list">' + state.book.map(function (i) { return '<li>' + esc(DATA.cards[i].bookNote) + '</li>'; }).join('') + '</ol>'
      : '<p class="book-empty">Замечаний нет</p>';
    var allDone = doneCount() === DATA.cards.length;

    return '<div class="layout-board">' + renderTopbar('board') +
      '<main class="board-main">' +
      '<section class="board"><div class="board-grid">' + cells + '</div></section>' +
      '<aside class="side">' +
      '<div class="pool"><div class="pool-label head">Общий котёл</div>' +
      '<div class="pool-value head" data-pool>' + pool() + '</div>' +
      '<div class="pool-split"><span><i class="dot dot-naryad"></i>' + esc(SIDES.naryad.name) + ' +' + e.naryad + '</span>' +
      '<span><i class="dot dot-check"></i>' + esc(SIDES.check.name) + ' +' + e.check + '</span></div></div>' +
      '<div class="book"><div class="book-head head">' + esc(T.book) + ' <b>' + state.book.length + '</b></div>' + bookList + '</div>' +
      '<div class="side-hint">' + (allDone ? 'Все карточки сыграны' : esc(T.pickHint) + ' <span class="kbd">1–9</span>') + '</div>' +
      '<button class="btn btn-general' + (allDone ? ' is-ready' : '') + '" data-action="general">' + esc(T.callBoss) + '</button>' +
      '</aside></main>' +
      (state.current ? renderTask() : '') +
      '</div>';
  }

  /* ---------- Окно задания ---------- */

  function renderTask() {
    var c = state.current;
    var card = DATA.cards[c.card];
    var packet = c.packet != null ? DATA.packets[c.packet] : null;

    var top = '<div class="task-top">' +
      '<span class="task-num head">Карточка ' + (c.card + 1) + '</span>' +
      '<span class="task-title head">' + esc(card.title) + '</span>' +
      (c.stage === 2 ? '<span class="chip">' + esc(card.tag) + '</span>' : '') +
      (packet && c.stage > 0 ? '<span class="chip chip-x2 head">×' + c.mult + ' · ' + esc(packet.title.replace(/!$/, '')) + '</span>' : '') +
      (c.timerEnd && c.phase === 'naryad' ? '<span class="timer head" id="timer">' + fmtTime(c.timerEnd - Date.now() + 999) + '</span>' : '') +
      renderSideNow(c) +
      '</div>';

    var body;
    if (c.stage === 0) body = renderEnvelope();
    else if (c.stage === 1) body = renderPacketReveal(packet);
    else body = renderTaskBody(c, card);

    return '<div class="overlay enter" data-k="' + taskKey() + '"><div class="task task-' + card.kind + (c.phase === 'done' ? ' is-done' : '') + '">' +
      top + body + '</div></div>';
  }

  function renderSideNow(c) {
    if (c.stage !== 2) return '';
    if (c.phase === 'done') {
      var r = c.result;
      if (!r.by) return '<span class="side-now side-none head">' + esc(T.bookEntry) + '</span>';
      return '<span class="side-now side-' + r.by + ' head">' + SIDES[r.by].done + ' · +' + pts(r.points) + '</span>';
    }
    var value = DATA.points[c.phase] * c.mult;
    return '<span class="side-now side-' + c.phase + ' head">' + SIDES[c.phase].now + ' · ' + pts(value) + '</span>';
  }

  function renderEnvelope() {
    return '<div class="packet-stage">' +
      '<div class="envelope"><div class="env-flap"></div><div class="env-seal head">★</div>' +
      '<div class="env-label head">Секретный пакет</div></div>' +
      '<div class="packet-actions">' +
      '<button class="btn btn-primary btn-big" data-action="packet-open">Вскрыть пакет <span class="kbd">Пробел</span></button>' +
      '</div></div>';
  }

  function renderPacketReveal(packet) {
    return '<div class="packet-stage"><div class="dossier dossier-packet">' +
      '<div class="kicker">Секретный пакет</div>' +
      '<div class="title head">' + esc(packet.title) + '</div>' +
      '<p class="lead">' + esc(packet.text) + '</p>' +
      '<div class="doc-actions"><button class="btn btn-primary btn-big" data-action="task-start">К заданию <span class="kbd">Пробел</span></button></div>' +
      '</div></div>';
  }

  function checkMessage(c, card) {
    if (c.phase !== 'check') return '';
    var who = SIDES.check.address;
    var first = SIDES.naryad;
    var text;
    if (card.kind === 'choice') {
      text = (c.why === 'timeout' ? 'Время вышло! ' : (c.why === 'pass' ? first.pass : first.wrong) + ' ') + who + 'ваш вариант?';
    } else if (c.why === 'timeout') {
      text = 'Время вышло! ' + who + 'доделайте задание.';
    } else if (c.why === 'pass') {
      text = first.fail + ' ' + who + 'доделайте задание.';
    } else if (card.kind === 'list') {
      text = first.wrongIn + ' ' + c.info.errors + ' из ' + c.info.total + '. ' + who + 'найдите ошибки и исправьте.';
    } else if (card.kind === 'order') {
      text = 'Не на своих местах: ' + c.info.errors + ' из ' + c.info.total + '. ' + who + 'исправьте порядок.';
    } else {
      text = 'Найдено нарушений: ' + c.info.found + ' из ' + c.info.total +
        (c.info.extra ? ', лишних отметок: ' + c.info.extra : '') + '. ' + who + 'исправьте отметки.';
    }
    return '<div class="check-msg head">' + esc(text) + '</div>';
  }

  function renderTaskBody(c, card) {
    var html = '<div class="report"><div class="report-q">' + esc(card.prompt) + '</div>' + checkMessage(c, card) + '</div>';
    if (card.kind === 'choice') html += renderChoice(c, card);
    else if (card.kind === 'list') html += renderList(c, card);
    else if (card.kind === 'order') html += renderOrder(c, card);
    else html += renderSpot(c, card);

    if (c.phase === 'done') {
      html += renderResult(c, card) + renderExplain(card.explain, card.norm);
      html += '<div class="task-actions"><button class="btn btn-primary btn-big" data-action="close-card">К карточкам <span class="kbd">Пробел</span></button></div>';
    } else {
      html += '<div class="task-actions">';
      if (isUntouched(c)) html += '<button class="btn btn-ghost" data-action="cancel-card">Закрыть карточку <span class="kbd">Esc</span></button>';
      html += '<button class="btn" data-action="pass">' + esc(c.phase === 'naryad' ? T.passToCheck : T.bookPass) + ' <span class="kbd">N</span></button>';
      if (card.kind !== 'choice') html += '<button class="btn btn-primary btn-big" data-action="verify">Проверить <span class="kbd">Enter</span></button>';
      html += '</div>';
    }
    return html;
  }

  function renderChoice(c, card) {
    var order = state.order[c.card];
    return '<div class="options">' + order.map(function (opt, k) {
      var wrong = null;
      c.wrong.forEach(function (w) { if (w.opt === opt) wrong = w; });
      var cls = 'opt';
      if (wrong) cls += ' is-wrong';
      if (c.phase === 'done') cls += opt === 0 ? ' is-correct' : wrong ? '' : ' is-dim';
      var disabled = c.phase === 'done' || !!wrong;
      return '<button class="' + cls + '" data-action="pick" data-opt="' + opt + '"' + (disabled ? ' disabled' : '') + '>' +
        '<span class="opt-letter head">' + LETTERS[k] + '</span>' +
        '<span class="opt-text">' + esc(card.options[opt]) + '</span>' +
        (wrong ? '<span class="opt-by head">' + SIDES[wrong.by].name + '</span>' : '') +
        '</button>';
    }).join('') + '</div>';
  }

  function renderList(c, card) {
    var done = c.phase === 'done';
    return '<div class="lrows">' + card.items.map(function (item, k) {
      var answer = c.answers[k];
      var cls = 'lrow';
      if (done) cls += answer === item.correct ? ' is-right' : ' is-wrong';
      var buttons = card.labels.map(function (label, li) {
        var on = answer === li;
        var bcls = 'lbtn' + (on ? ' is-on' : '');
        if (done && li === item.correct) bcls += ' is-correct';
        return '<button class="' + bcls + '" data-action="answer" data-item="' + k + '" data-label="' + li + '"' + (done ? ' disabled' : '') + '>' + esc(label) + '</button>';
      }).join('');
      return '<div class="' + cls + '">' +
        '<span class="lrow-num head">' + (k + 1) + '</span>' +
        '<div class="lrow-main"><div class="lrow-text">' + esc(item.text) + '</div>' +
        (done ? '<div class="lrow-note">' + esc(item.note) + '</div>' : '') + '</div>' +
        '<div class="lrow-btns">' + buttons + '</div></div>';
    }).join('') + '</div>';
  }

  function renderOrder(c, card) {
    if (c.phase === 'done') {
      return '<div class="order-done"><div class="col-head head">Правильный порядок</div><ol class="order-list">' +
        card.steps.map(function (step, k) {
          var ok = c.placed[k] === k;
          return '<li class="order-item ' + (ok ? 'is-right' : 'is-wrong') + '">' +
            '<span class="order-n head">' + (k + 1) + '</span>' +
            '<span class="order-text">' + esc(step.text) + '<span class="order-norm">' + esc(step.norm) + '</span></span>' +
            '<span class="order-mark head">' + (ok ? 'на месте' : 'было не так') + '</span></li>';
        }).join('') + '</ol></div>';
    }
    var next = c.placed.indexOf(null);
    if (next < 0) next = c.placed.length;
    var slots = card.steps.map(function (s, k) {
      var step = c.placed[k];
      if (step == null) {
        return '<li class="slot is-empty' + (k === next ? ' is-next' : '') + '"><span class="order-n head">' + (k + 1) + '</span>' +
          '<span class="slot-hint">' + (k === next ? 'сюда встанет следующий шаг' : '…') + '</span></li>';
      }
      return '<li class="slot"><button class="slot-btn" data-action="unplace" data-pos="' + k + '" title="Вернуть шаг обратно">' +
        '<span class="order-n head">' + (k + 1) + '</span><span class="order-text">' + esc(card.steps[step].text) + '</span></button></li>';
    }).join('');
    var poolItems = state.order[c.card].filter(function (step) { return c.placed.indexOf(step) < 0; }).map(function (step) {
      return '<button class="plate" data-action="place" data-step="' + step + '">' + esc(card.steps[step].text) + '</button>';
    }).join('');
    return '<div class="order-cols">' +
      '<div class="order-col"><div class="col-head head">' + esc(card.column || T.orderHead) + '</div><ol class="slots">' + slots + '</ol></div>' +
      '<div class="order-col"><div class="col-head head">Шаги ' + (poolItems ? '<span class="col-sub">кликните по шагу, который назвала группа</span>' : '') + '</div>' +
      '<div class="plates">' + (poolItems || '<div class="plates-empty">Все шаги расставлены. Кликните по шагу слева, чтобы вернуть его.</div>') + '</div></div>' +
      '</div>';
  }

  function renderSpot(c, card) {
    var done = c.phase === 'done';
    var n = 0;
    var notes = [];
    var text = card.fragments.map(function (f, k) {
      var marked = !!c.marked[k];
      var cls = 'frag';
      var badge = '';
      if (done) {
        if (f.bad || marked) {
          n++;
          notes.push({ n: n, f: f, marked: marked });
          badge = '<sup class="frag-n head">' + n + '</sup>';
        }
        if (f.bad && marked) cls += ' is-found';
        else if (f.bad) cls += ' is-missed';
        else if (marked) cls += ' is-extra';
      } else if (marked) {
        cls += ' is-marked';
      }
      return '<button class="' + cls + '" data-action="mark" data-frag="' + k + '"' + (done ? ' disabled' : '') + '>' + esc(f.text) + badge + '</button>';
    }).join(' ');
    var html = '<div class="spot-text">' + text + '</div>';
    if (done && notes.length) {
      html += '<ol class="spot-notes">' + notes.map(function (x) {
        var tag = x.f.bad ? (x.marked ? 'Найдено' : 'Пропущено') : 'Лишняя отметка';
        var tcls = x.f.bad ? (x.marked ? 'tag-found' : 'tag-missed') : 'tag-extra';
        return '<li><span class="note-n head">' + x.n + '</span><span class="note-tag head ' + tcls + '">' + tag + '</span>' + esc(x.f.note) + '</li>';
      }).join('') + '</ol>';
    }
    return html;
  }

  function renderResult(c, card) {
    var r = c.result;
    if (!r.by) {
      return '<div class="result result-none"><span class="stamp head">' + esc(T.bookTo) + '</span>' +
        '<span class="result-text">«' + esc(card.bookNote) + '»</span></div>';
    }
    return '<div class="result result-' + r.by + '"><span class="result-points head">+' + r.points + '</span>' +
      '<span class="result-text head">' + SIDES[r.by].done + (c.mult > 1 ? ' · очки удвоены' : '') + '</span></div>';
  }

  function renderExplain(text, norm) {
    return '<div class="explain"><div class="explain-head head"><span>Разбор</span><span class="explain-norm">' + esc(norm) + '</span></div>' +
      '<p>' + esc(text) + '</p></div>';
  }

  /* ---------- Генерал ---------- */

  function renderGeneral() {
    var g = state.general;
    var body;
    if (g.step === 'alarm') body = renderAlarm();
    else if (g.step === 'book') body = renderGeneralBook();
    else body = renderGeneralQuestion(g);
    return '<div class="layout-general' + (g.step === 'alarm' ? ' is-alarm' : '') + '">' + renderTopbar('general') +
      '<main class="general-main">' + body + '</main></div>';
  }

  function renderAlarm() {
    return '<div class="alarm enter" data-k="alarm">' +
      '<div class="alarm-lamp" aria-hidden="true"></div>' +
      '<div class="alarm-text head">' + esc(DATA.general.arrival) + '</div>' +
      '<div class="alarm-sub head">' + esc(DATA.general.smirno) + '</div>' +
      '<div class="alarm-actions">' +
      '<button class="btn btn-big" data-action="smirno" data-loud="0">' + esc(T.greetWeak) + '</button>' +
      '<button class="btn btn-primary btn-big" data-action="smirno" data-loud="1">' + esc(T.greetLoud) + ' +' + DATA.points.smirno + '</button>' +
      '</div></div>';
  }

  function renderGeneralBook() {
    var n = state.book.length;
    var list = n
      ? '<ol class="gbook">' + state.book.map(function (i) {
        return '<li><span class="gbook-card head">Карточка ' + (i + 1) + '</span>' + esc(DATA.cards[i].bookNote) + '</li>';
      }).join('') + '</ol>'
      : '<p class="lead">' + esc(T.bookEmpty) + '</p>';
    var penalty = Math.min(n * DATA.points.bookPenalty, Math.max(0, pool()));
    return '<div class="dossier dossier-book enter" data-k="book">' +
      '<div class="doc-head"><div class="kicker">' + esc(T.bossOpens) + '</div>' +
      (n ? '' : '<span class="stamp stamp-small head">Без замечаний</span>') + '</div>' +
      '<div class="title head">' + esc(T.book) + '</div>' + list +
      '<div class="doc-actions"><button class="btn btn-primary btn-big" data-action="accept-book">' +
      (n ? 'Принять замечания: −' + penalty : esc(T.bossClean)) + ' <span class="kbd">Пробел</span></button></div></div>';
  }

  function renderGeneralQuestion(g) {
    var q = DATA.general.questions[g.q];
    var order = state.order['g' + g.q];
    var answered = g.picked != null;
    var options = order.map(function (opt, k) {
      var hidden = g.hidden.indexOf(opt) >= 0;
      var cls = 'opt';
      if (hidden) cls += ' is-hidden';
      if (answered) {
        if (opt === 0) cls += ' is-correct';
        else if (opt === g.picked) cls += ' is-wrong';
        else cls += ' is-dim';
      }
      return '<button class="' + cls + '" data-action="gpick" data-opt="' + opt + '"' + (answered || hidden ? ' disabled' : '') + '>' +
        '<span class="opt-letter head">' + LETTERS[k] + '</span>' +
        '<span class="opt-text">' + (hidden ? '' : esc(q.options[opt])) + '</span></button>';
    }).join('');

    var hints = Object.keys(DATA.hints).map(function (kind) {
      var h = DATA.hints[kind];
      var used = g.used[kind];
      return '<button class="hint' + (used ? ' is-used' : '') + '" data-action="hint" data-hint="' + kind + '"' + (answered ? ' disabled' : '') + '>' +
        '<span class="hint-title head">' + esc(h.title) + '</span>' +
        '<span class="hint-text">' + esc(h.text) + '</span>' +
        '<span class="hint-cost head">' + (used ? 'использована' : '−' + pts(h.cost)) + '</span></button>';
    }).join('');

    var result = '';
    if (answered) {
      var right = g.picked === 0;
      result = '<div class="result ' + (right ? 'result-naryad' : 'result-none') + '">' +
        (right ? '<span class="result-points head">+' + DATA.points.general + '</span><span class="result-text head">' + esc(T.bossHappy) + '</span>'
          : '<span class="stamp head">' + esc(T.bossFrown) + '</span><span class="result-text">Очки за этот вопрос не начислены</span>') +
        '</div>' + renderExplain(q.explain, q.norm) +
        '<div class="task-actions"><button class="btn btn-primary btn-big" data-action="gnext">' +
        (g.q + 1 < DATA.general.questions.length ? 'Следующий вопрос' : 'Итоги') + ' <span class="kbd">Пробел</span></button></div>';
    }

    return '<div class="task task-general enter" data-k="gq:' + g.q + '">' +
      '<div class="task-top"><span class="task-num head">' + esc(T.bossQuestion) + ' ' + (g.q + 1) + ' из ' + DATA.general.questions.length + '</span>' +
      '<span class="chip head">' + pts(DATA.points.general) + '</span>' +
      '<span class="side-now side-general head">Отвечают все</span></div>' +
      '<div class="report"><div class="report-q">' + esc(q.prompt) + '</div>' +
      (g.callOn && !answered ? '<div class="check-msg head">' + esc(DATA.hints.call.title) + ': группа советуется с преподавателем</div>' : '') + '</div>' +
      '<div class="options">' + options + '</div>' +
      (answered ? result : '<div class="hints"><span class="hints-label head">Подсказки за очки из котла</span>' + hints + '</div>') +
      '</div>';
  }

  /* ---------- Итоги ---------- */

  function renderFinal() {
    var total = pool();
    var grade = gradeFor(total);
    var e = state.earned;
    var rows = [
      [SIDES.naryad.name, e.naryad],
      [SIDES.check.name, e.check],
      [T.finalGreet, e.smirno],
      [T.finalQuestions, e.general],
      [T.book, -e.penalty],
      ['Подсказки', -e.hints]
    ].map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td class="num head">' + signed(r[1]) + '</td></tr>';
    }).join('');
    var book = state.book.length
      ? '<div class="final-book"><div class="col-head head">' + esc(T.book) + '</div><ol>' +
        state.book.map(function (i) { return '<li>' + esc(DATA.cards[i].bookNote) + '</li>'; }).join('') + '</ol></div>'
      : '';
    return '<div class="screen"><div class="dossier dossier-final enter" data-k="final">' +
      '<div class="kicker">' + esc(T.finalKicker) + '</div>' +
      '<div class="final-stamp stamp head">' + esc(grade.stamp) + '</div>' +
      '<p class="lead">' + esc(grade.text) + '</p>' +
      '<div class="final-grid"><table class="final-table">' + rows +
      '<tr class="total"><td>Итого в котле</td><td class="num head">' + total + '</td></tr></table>' + book + '</div>' +
      '<div class="doc-actions"><button class="btn" data-action="new-game">Новая игра</button></div>' +
      '</div></div>';
  }

  /* ---------- Подсказка ведущему и подтверждение ---------- */

  function renderHelp() {
    var keys = [
      ['1–9', 'открыть карточку с этим номером'],
      ['1–4', 'выбрать вариант ответа'],
      ['Enter', 'проверить задание'],
      ['N', 'группа не знает ответа'],
      ['Пробел', 'дальше'],
      ['Esc', 'закрыть карточку, открытую по ошибке'],
      ['Ctrl+Z', 'отменить последнее действие'],
      ['F', 'во весь экран'],
      ['M', 'звук']
    ].map(function (k) { return '<tr><td><span class="kbd">' + k[0] + '</span></td><td>' + k[1] + '</td></tr>'; }).join('');
    return '<div class="modal" data-action="close-help"><div class="dossier dossier-help" data-stop>' +
      '<div class="kicker">Ведущему</div>' +
      '<table class="keys">' + keys + '</table>' +
      '<p class="help-note">Игра сохраняется сама: после обновления страницы всё на месте. Ошиблись кликом — Ctrl+Z.</p>' +
      '<div class="doc-actions">' +
      '<button class="btn btn-red" data-action="new-game">Новая игра</button>' +
      '<button class="btn btn-primary" data-action="close-help">Закрыть</button></div></div></div>';
  }

  function renderConfirm() {
    return '<div class="modal"><div class="dossier dossier-help" data-stop>' +
      '<p class="lead">' + esc(ui.confirm.text) + '</p>' +
      '<div class="doc-actions">' +
      '<button class="btn" data-action="confirm-no">Отмена</button>' +
      '<button class="btn btn-primary" data-action="confirm-yes">' + esc(ui.confirm.yes) + '</button></div></div></div>';
  }

  /* ---------- Главная отрисовка ---------- */

  function taskKey() {
    var c = state.current;
    return c ? 'task:' + c.card : '';
  }

  function render() {
    var html;
    if (!authed) {
      html = renderGate();
    } else {
      switch (state.screen) {
        case 'rules': html = renderRules(); break;
        case 'scheme': html = renderScheme(); break;
        case 'board': html = renderBoard(); break;
        case 'general': html = state.general ? renderGeneral() : renderBoard(); break;
        case 'final': html = renderFinal(); break;
        default: html = renderTitle();
      }
      if (ui.help) html += renderHelp();
      if (ui.confirm) html += renderConfirm();
    }
    appEl.innerHTML = html;
    // Анимация появления — только у того, чего не было на экране в прошлый раз.
    var seen = {};
    appEl.querySelectorAll('[data-k]').forEach(function (el) {
      var k = el.getAttribute('data-k');
      if (ui.seen[k]) el.classList.remove('enter');
      seen[k] = true;
    });
    ui.seen = seen;

    var current = authed ? pool() : null;
    if (ui.lastPool != null && current != null && current !== ui.lastPool) {
      appEl.querySelectorAll('[data-pool]').forEach(function (el) {
        el.classList.add(current > ui.lastPool ? 'bump' : 'drop');
      });
    }
    ui.lastPool = current;

    var input = appEl.querySelector('.gate-input');
    if (input) input.focus();
  }

  /* ---------- События ---------- */

  appEl.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form="gate"]');
    if (!form) return;
    e.preventDefault();
    tryPassword(form.querySelector('.gate-input').value);
  });

  appEl.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !appEl.contains(el)) return;
    // Клик по самому окну подсказки не закрывает её — только по фону или кнопке.
    if (el.getAttribute('data-action') === 'close-help' && el.classList.contains('modal') && e.target.closest('[data-stop]')) return;
    var action = el.getAttribute('data-action');
    var num = function (name) { return Number(el.getAttribute(name)); };
    switch (action) {
      case 'undo': undo(); break;
      case 'mute': toggleMute(); break;
      case 'full': toggleFullscreen(); break;
      case 'help': ui.help = true; render(); break;
      case 'close-help': ui.help = false; render(); break;
      case 'new-game':
        ui.help = false;
        askConfirm('Начать новую игру? Счёт и все ответы сбросятся.', 'Начать заново', resetGame);
        break;
      case 'confirm-yes': confirmYes(); break;
      case 'confirm-no': ui.confirm = null; render(); break;
      case 'to-rules': go('rules'); Sound.play('paper'); break;
      case 'to-scheme': go('scheme'); Sound.play('paper'); break;
      case 'scheme-next': schemeNext(); break;
      case 'open': openCard(num('data-card')); break;
      case 'packet-open': openPacket(); break;
      case 'task-start': startTask(); break;
      case 'cancel-card': cancelCard(); break;
      case 'pick': pick(num('data-opt')); break;
      case 'pass': pass(); break;
      case 'answer': setAnswer(num('data-item'), num('data-label')); break;
      case 'place': placeStep(num('data-step')); break;
      case 'unplace': unplaceStep(num('data-pos')); break;
      case 'mark': toggleMark(num('data-frag')); break;
      case 'verify': verify(); break;
      case 'close-card': closeCard(); break;
      case 'general': callGeneral(); break;
      case 'smirno': smirno(el.getAttribute('data-loud') === '1'); break;
      case 'accept-book': acceptBook(); break;
      case 'gpick': generalPick(num('data-opt')); break;
      case 'hint': useHint(el.getAttribute('data-hint')); break;
      case 'gnext': generalNext(); break;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!authed) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    var code = e.code;
    if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    var next = code === 'Space' || code === 'Enter' || code === 'NumpadEnter';
    if (next) e.preventDefault();

    if (ui.confirm) {
      if (code === 'Escape') { ui.confirm = null; render(); }
      else if (code === 'Enter' || code === 'NumpadEnter') confirmYes();
      return;
    }
    if (ui.help) {
      if (code === 'Escape' || code === 'F1') { e.preventDefault(); ui.help = false; render(); }
      return;
    }
    if (code === 'F1') { e.preventDefault(); ui.help = true; render(); return; }
    if (code === 'KeyF') { toggleFullscreen(); return; }
    if (code === 'KeyM') { toggleMute(); return; }

    var digit = DIGITS[code];
    switch (state.screen) {
      case 'title':
        if (next) { go('rules'); Sound.play('paper'); }
        break;
      case 'rules':
        if (next) { go('scheme'); Sound.play('paper'); }
        break;
      case 'scheme':
        if (next) schemeNext();
        break;
      case 'board':
        keyBoard(code, digit, next);
        break;
      case 'general':
        keyGeneral(code, digit, next);
        break;
    }
  });

  function keyBoard(code, digit, next) {
    var c = state.current;
    if (!c) {
      if (digit != null && digit < DATA.cards.length) openCard(digit);
      return;
    }
    if (code === 'Escape') { cancelCard(); return; }
    if (c.stage === 0) { if (next) openPacket(); return; }
    if (c.stage === 1) { if (next) startTask(); return; }
    if (c.phase === 'done') { if (next) closeCard(); return; }
    var card = DATA.cards[c.card];
    if (code === 'KeyN') { pass(); return; }
    if (card.kind === 'choice') {
      var order = state.order[c.card];
      if (digit != null && digit < order.length) pick(order[digit]);
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      verify();
    }
  }

  function keyGeneral(code, digit, next) {
    var g = state.general;
    if (!g) return;
    if (g.step === 'book') { if (next) acceptBook(); return; }
    if (g.step !== 'q') return;
    if (g.picked != null) { if (next) generalNext(); return; }
    var order = state.order['g' + g.q];
    if (digit != null && digit < order.length) generalPick(order[digit]);
  }

  /* ---------- Часы и таймер ---------- */

  setInterval(function () {
    if (!authed || !state) return;
    var clock = document.getElementById('clock');
    if (clock && state.startedAt) clock.textContent = fmtTime(Date.now() - state.startedAt);
    var c = state.current;
    if (!c || !c.timerEnd || c.phase !== 'naryad' || c.stage !== 2) return;
    var left = c.timerEnd - Date.now();
    var sec = Math.max(0, Math.ceil(left / 1000));
    var el = document.getElementById('timer');
    if (el) {
      el.textContent = fmtTime(sec * 1000);
      el.classList.toggle('is-low', sec <= 10);
    }
    if (sec !== ui.lastTickSec) {
      ui.lastTickSec = sec;
      if (sec > 0 && sec <= 5) Sound.play('tick');
    }
    if (left <= 0 && !ui.busy) timeout();
  }, 200);

  /* ---------- Запуск ---------- */

  load();
  authed = readStore('sessionStorage', AUTH_KEY) === '1';
  render();
})();
