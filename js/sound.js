/* Звуки игры: синтезируются прямо в браузере, без аудиофайлов. */
window.Sound = (function () {
  'use strict';

  var MUTE_KEY = 'sutochny-naryad:muted';
  var ctx = null;
  var master = null;
  var noiseBuffer = null;
  var muted = false;

  try { muted = window.localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* хранилище недоступно */ }

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, at, dur, opts) {
    var c = audio();
    if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + at;
    var vol = opts.vol == null ? 0.16 : opts.vol;
    var attack = opts.attack || 0.015;
    var osc = c.createOscillator();
    var filter = c.createBiquadFilter();
    var gain = c.createGain();
    osc.type = opts.type || 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    filter.type = 'lowpass';
    filter.frequency.value = opts.cutoff || 2200;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    gain.gain.setValueAtTime(vol, t0 + Math.max(attack, dur * 0.7));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(at, dur, opts) {
    var c = audio();
    if (!c) return;
    opts = opts || {};
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    var t0 = c.currentTime + at;
    var src = c.createBufferSource();
    var filter = c.createBiquadFilter();
    var gain = c.createGain();
    src.buffer = noiseBuffer;
    filter.type = opts.filter || 'bandpass';
    filter.frequency.value = opts.freq || 1800;
    filter.Q.value = opts.q || 0.8;
    gain.gain.setValueAtTime(opts.vol == null ? 0.3 : opts.vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function bugle(notes, vol) {
    notes.forEach(function (n) {
      tone(n[0], n[1], n[2], { type: 'sawtooth', vol: vol, cutoff: 1900, attack: 0.03 });
      tone(n[0] * 2, n[1], n[2], { type: 'square', vol: vol * 0.18, cutoff: 2600, attack: 0.03 });
    });
  }

  var sounds = {
    click: function () {
      noise(0, 0.05, { freq: 3200, vol: 0.22 });
    },
    paper: function () {
      noise(0, 0.22, { freq: 4200, q: 0.4, vol: 0.14 });
      noise(0.05, 0.18, { freq: 2600, q: 0.5, vol: 0.08 });
    },
    correct: function () {
      bugle([[392, 0, 0.12], [523.25, 0.12, 0.12], [659.25, 0.24, 0.12], [783.99, 0.36, 0.45]], 0.13);
    },
    wrong: function () {
      tone(116, 0, 0.5, { type: 'sawtooth', vol: 0.17, cutoff: 900 });
      tone(110, 0, 0.5, { type: 'square', vol: 0.07, cutoff: 700 });
    },
    soft: function () {
      tone(330, 0, 0.12, { type: 'triangle', vol: 0.12 });
      tone(247, 0.12, 0.2, { type: 'triangle', vol: 0.1 });
    },
    stamp: function () {
      tone(95, 0, 0.2, { type: 'sine', vol: 0.5, slideTo: 45, attack: 0.005 });
      noise(0, 0.09, { filter: 'lowpass', freq: 700, vol: 0.4 });
    },
    alarm: function () {
      for (var i = 0; i < 3; i++) {
        tone(880, i * 0.2, 0.1, { type: 'square', vol: 0.07, cutoff: 3000 });
        tone(660, i * 0.2 + 0.1, 0.1, { type: 'square', vol: 0.07, cutoff: 3000 });
      }
    },
    drum: function () {
      for (var i = 0; i < 22; i++) {
        noise(i * 0.045, 0.06, { freq: 1100, q: 0.6, vol: 0.06 + i * 0.011 });
      }
      noise(1.0, 0.3, { filter: 'lowpass', freq: 500, vol: 0.55 });
      tone(72, 1.0, 0.32, { type: 'sine', vol: 0.45, slideTo: 40, attack: 0.005 });
    },
    start: function () {
      bugle([[523.25, 0, 0.1], [659.25, 0.11, 0.1], [783.99, 0.22, 0.32]], 0.12);
    },
    fanfare: function () {
      bugle([
        [392, 0, 0.13], [392, 0.16, 0.13], [392, 0.32, 0.13],
        [523.25, 0.48, 0.32], [659.25, 0.82, 0.18], [783.99, 1.02, 0.7]
      ], 0.13);
    },
    deny: function () {
      tone(220, 0, 0.12, { type: 'square', vol: 0.1, cutoff: 1500 });
      tone(165, 0.14, 0.28, { type: 'square', vol: 0.1, cutoff: 1200 });
    },
    siren: function () {
      for (var i = 0; i < 3; i++) {
        tone(520, i * 0.9, 0.45, { type: 'sawtooth', vol: 0.1, cutoff: 2400, slideTo: 880 });
        tone(880, i * 0.9 + 0.45, 0.45, { type: 'sawtooth', vol: 0.1, cutoff: 2400, slideTo: 520 });
      }
    },
    tick: function () {
      tone(1320, 0, 0.05, { type: 'square', vol: 0.06, cutoff: 4000, attack: 0.003 });
    },
    timeout: function () {
      tone(440, 0, 0.18, { type: 'square', vol: 0.12, cutoff: 2600 });
      tone(440, 0.24, 0.18, { type: 'square', vol: 0.12, cutoff: 2600 });
      tone(330, 0.48, 0.5, { type: 'square', vol: 0.12, cutoff: 2200 });
    }
  };

  return {
    play: function (name) {
      if (muted || !sounds[name]) return;
      try { sounds[name](); } catch (e) { /* звук не критичен для игры */ }
    },
    unlock: function () {
      try { audio(); } catch (e) { /* нет Web Audio */ }
    },
    isMuted: function () {
      return muted;
    },
    toggle: function () {
      muted = !muted;
      try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* хранилище недоступно */ }
      return muted;
    }
  };
})();
