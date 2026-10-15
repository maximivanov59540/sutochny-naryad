/* Учебная карта «Топо-Битвы»: рельеф, вода, лес, дороги, условные знаки, сетка и рамка. Всё рисуется в SVG, единица — метр на местности. */
window.TopoMap = (function () {
  'use strict';

  var M = window.GAME_DATA.map;
  var W = M.width;
  var H = M.height;
  var PAD = { l: 780, r: 380, t: 270, b: 880 };
  var FULL = [-PAD.l, -PAD.t, W + PAD.l + PAD.r, H + PAD.t + PAD.b];
  var KM = 1000;
  var MIN_LAT = M.secLat * 60;
  var MIN_LON = M.secLon * 60;

  var C = {
    paper: '#fbf8ef',
    ink: '#151515',
    brown: '#a0522d',
    water: '#2b7cc0',
    waterFill: '#bfe1f5',
    forest: '#cde6ad',
    forestInk: '#4d8a36',
    road: '#f29b30',
    accent: '#d6007a',
    target: '#d7263d'
  };
  var FONT = "'Arial Narrow', 'Bahnschrift', 'Roboto Condensed', Arial, sans-serif";

  /* ---------- Геометрия ---------- */

  function sx(e) { return e; }
  function sy(n) { return H - n; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pt(e, n) { return r1(sx(e)) + ' ' + r1(sy(n)); }

  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * dx, qy = ay + t * dy;
    return { d: Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy)), t: t };
  }

  function polyInfo(points) {
    var acc = [0];
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      acc.push(acc[i - 1] + Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])));
    }
    return { points: points, acc: acc, length: acc[acc.length - 1] };
  }

  // Ближайшая точка ломаной: расстояние и доля пройденной длины (0…1).
  function nearest(info, e, n) {
    var best = { d: Infinity, s: 0 };
    var p = info.points;
    for (var i = 1; i < p.length; i++) {
      var r = segDist(e, n, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      if (r.d < best.d) {
        best.d = r.d;
        best.s = (info.acc[i - 1] + r.t * (info.acc[i] - info.acc[i - 1])) / info.length;
      }
    }
    return best;
  }

  // Точка и направление на ломаной на расстоянии dist от начала.
  function along(info, dist) {
    var p = info.points;
    for (var i = 1; i < p.length; i++) {
      if (dist <= info.acc[i] || i === p.length - 1) {
        var seg = info.acc[i] - info.acc[i - 1] || 1;
        var t = Math.max(0, Math.min(1, (dist - info.acc[i - 1]) / seg));
        var dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1];
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { e: p[i - 1][0] + t * dx, n: p[i - 1][1] + t * dy, ue: dx / len, un: dy / len };
      }
    }
    return { e: p[0][0], n: p[0][1], ue: 1, un: 0 };
  }

  function inPoly(points, e, n) {
    var inside = false;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
      var a = points[i], b = points[j];
      if ((a[1] > n) !== (b[1] > n) && e < (b[0] - a[0]) * (n - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // Сглаженный путь (Катмулл — Ром → кубические Безье) по точкам местности.
  function smoothPath(points, closed) {
    var p = points.map(function (q) { return [sx(q[0]), sy(q[1])]; });
    var n = p.length;
    if (n < 3) return 'M' + p.map(function (q) { return r1(q[0]) + ' ' + r1(q[1]); }).join('L');
    function at(i) {
      if (closed) return p[(i + n) % n];
      return p[Math.max(0, Math.min(n - 1, i))];
    }
    var d = 'M' + r1(p[0][0]) + ' ' + r1(p[0][1]);
    var last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      d += 'C' + r1(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + r1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        r1(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + r1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' +
        r1(p2[0]) + ' ' + r1(p2[1]);
    }
    return d + (closed ? 'Z' : '');
  }

  function linePath(points) {
    return 'M' + points.map(function (q) { return pt(q[0], q[1]); }).join('L');
  }

  /* ---------- Рельеф ---------- */

  var river = polyInfo(M.river.points);
  var roads = M.roads.map(function (r) { return polyInfo(r.points); });

  function baseHeight(e, n) {
    var r = nearest(river, e, n);
    var level = M.river.levelFrom + (M.river.levelTo - M.river.levelFrom) * r.s;
    return level + M.river.rise * (1 - Math.exp(-r.d / M.river.riseScale));
  }

  var hills = M.hills.map(function (h) {
    var a = h.rot * Math.PI / 180;
    return { e: h.e, n: h.n, top: h.top, rx: h.rx, ry: h.ry, cos: Math.cos(a), sin: Math.sin(a), amp: 0 };
  });

  function bump(h, e, n) {
    var de = e - h.e, dn = n - h.n;
    var u = (de * h.cos + dn * h.sin) / h.rx;
    var v = (-de * h.sin + dn * h.cos) / h.ry;
    return Math.exp(-0.5 * (u * u + v * v));
  }

  // Высоту каждой вершины подгоняем под её подпись (142,5 и т. д.).
  (function solveHills() {
    for (var pass = 0; pass < 6; pass++) {
      hills.forEach(function (h, i) {
        var others = baseHeight(h.e, h.n);
        hills.forEach(function (o, j) { if (j !== i) others += o.amp * bump(o, h.e, h.n); });
        h.amp = h.top - others;
      });
    }
  })();

  function height(e, n) {
    var z = baseHeight(e, n);
    for (var i = 0; i < hills.length; i++) z += hills[i].amp * bump(hills[i], e, n);
    return z;
  }

  function gradient(e, n) {
    var s = 15;
    return { ge: (height(e + s, n) - height(e - s, n)) / (2 * s), gn: (height(e, n + s) - height(e, n - s)) / (2 * s) };
  }

  /* ---------- Горизонтали (marching squares) ---------- */

  var STEP = 20;

  function contourLines() {
    var nx = Math.round(W / STEP), ny = Math.round(H / STEP);
    var cols = nx + 1;
    var z = new Float64Array(cols * (ny + 1));
    var lo = Infinity, hi = -Infinity;
    for (var j = 0; j <= ny; j++) {
      for (var i = 0; i <= nx; i++) {
        var v = height(i * STEP, j * STEP);
        z[j * cols + i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    var result = [];
    var step = M.contourStep;
    for (var level = Math.ceil(lo / step) * step; level <= hi; level += step) {
      result.push({ level: level, lines: traceLevel(z, nx, ny, cols, level + 1e-6) });
    }
    return result;
  }

  function traceLevel(z, nx, ny, cols, L) {
    var vOffset = cols * (ny + 1);
    var pos = {};
    var segs = [];
    function hEdge(i, j) { return j * cols + i; }
    function vEdge(i, j) { return vOffset + j * cols + i; }
    function point(id) {
      if (pos[id]) return pos[id];
      var i, j, a, b, t, p;
      if (id < vOffset) {
        j = Math.floor(id / cols); i = id % cols;
        a = z[j * cols + i]; b = z[j * cols + i + 1];
        t = (L - a) / (b - a);
        p = [(i + t) * STEP, j * STEP];
      } else {
        var k = id - vOffset;
        j = Math.floor(k / cols); i = k % cols;
        a = z[j * cols + i]; b = z[(j + 1) * cols + i];
        t = (L - a) / (b - a);
        p = [i * STEP, (j + t) * STEP];
      }
      pos[id] = p;
      return p;
    }
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var a = z[j * cols + i], b = z[j * cols + i + 1], c = z[(j + 1) * cols + i + 1], d = z[(j + 1) * cols + i];
        var idx = (a >= L ? 1 : 0) | (b >= L ? 2 : 0) | (c >= L ? 4 : 0) | (d >= L ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        var bottom = hEdge(i, j), right = vEdge(i + 1, j), top = hEdge(i, j + 1), left = vEdge(i, j);
        var centerUp = (a + b + c + d) / 4 >= L;
        switch (idx) {
          case 1: case 14: segs.push([left, bottom]); break;
          case 2: case 13: segs.push([bottom, right]); break;
          case 3: case 12: segs.push([left, right]); break;
          case 4: case 11: segs.push([right, top]); break;
          case 6: case 9: segs.push([bottom, top]); break;
          case 7: case 8: segs.push([left, top]); break;
          case 5:
            if (centerUp) { segs.push([bottom, right]); segs.push([top, left]); } else { segs.push([left, bottom]); segs.push([right, top]); }
            break;
          case 10:
            if (centerUp) { segs.push([left, bottom]); segs.push([right, top]); } else { segs.push([bottom, right]); segs.push([top, left]); }
            break;
        }
      }
    }
    // Сшиваем отрезки в линии по общим рёбрам.
    var byEdge = {};
    segs.forEach(function (s, k) {
      (byEdge[s[0]] = byEdge[s[0]] || []).push(k);
      (byEdge[s[1]] = byEdge[s[1]] || []).push(k);
    });
    var used = new Uint8Array(segs.length);
    function nextSeg(edge) {
      var list = byEdge[edge] || [];
      for (var q = 0; q < list.length; q++) if (!used[list[q]]) return list[q];
      return -1;
    }
    var lines = [];
    for (var k = 0; k < segs.length; k++) {
      if (used[k]) continue;
      used[k] = 1;
      var chain = [segs[k][0], segs[k][1]];
      // вперёд
      var cur = segs[k][1], nk;
      while ((nk = nextSeg(cur)) >= 0) {
        used[nk] = 1;
        cur = segs[nk][0] === cur ? segs[nk][1] : segs[nk][0];
        chain.push(cur);
      }
      // назад
      cur = segs[k][0];
      while ((nk = nextSeg(cur)) >= 0) {
        used[nk] = 1;
        cur = segs[nk][0] === cur ? segs[nk][1] : segs[nk][0];
        chain.unshift(cur);
      }
      var closed = chain.length > 3 && chain[0] === chain[chain.length - 1];
      var pts = chain.map(point);
      if (closed) pts.pop();
      if (pts.length < 4) continue;
      lines.push({ points: thin(pts, closed), closed: closed });
    }
    return lines;
  }

  function thin(pts, closed) {
    var out = [];
    for (var i = 0; i < pts.length; i += 2) out.push(pts[i]);
    if (!closed && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  function lineLength(points) {
    var s = 0;
    for (var i = 1; i < points.length; i++) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    return s;
  }

  /* ---------- Условные знаки ---------- */

  function symbol(type) {
    var k = C.ink;
    switch (type) {
      case 'tree':
        return '<line x1="0" y1="0" x2="0" y2="-62" stroke="' + k + '" stroke-width="13"/>' +
          '<circle cx="0" cy="-100" r="42" fill="#3f8f3a" stroke="' + k + '" stroke-width="11"/>' +
          '<circle cx="0" cy="0" r="15" fill="' + k + '"/>';
      case 'stone':
        return '<path d="M-42 20 L-26 -28 L8 -40 L42 -8 L32 24 Z" fill="' + k + '"/>';
      case 'mill':
        return '<circle cx="0" cy="0" r="24" fill="' + C.paper + '" stroke="' + k + '" stroke-width="11"/>' +
          '<line x1="0" y1="-24" x2="0" y2="-82" stroke="' + k + '" stroke-width="11"/>' +
          '<path d="M-46 -128 L46 -36 M46 -128 L-46 -36" stroke="' + k + '" stroke-width="11" fill="none"/>';
      case 'church':
        return '<circle cx="0" cy="0" r="30" fill="' + C.paper + '" stroke="' + k + '" stroke-width="11"/>' +
          '<path d="M0 -30 V-130 M-34 -96 H34" stroke="' + k + '" stroke-width="11" fill="none"/>';
      case 'kurgan':
        var ticks = '';
        for (var i = 0; i < 8; i++) {
          var a = i * Math.PI / 4;
          ticks += 'M' + r1(Math.cos(a) * 38) + ' ' + r1(Math.sin(a) * 38) + 'L' + r1(Math.cos(a) * 64) + ' ' + r1(Math.sin(a) * 64);
        }
        return '<circle cx="0" cy="0" r="26" fill="' + C.brown + '"/><path d="' + ticks + '" stroke="' + C.brown + '" stroke-width="10"/>';
      case 'spring':
        return '<circle cx="0" cy="0" r="25" fill="' + C.waterFill + '" stroke="' + C.water + '" stroke-width="11"/>' +
          '<path d="M25 0 q 26 -22 52 0 t 52 0" stroke="' + C.water + '" stroke-width="10" fill="none"/>';
      case 'trig':
        return '<path d="M0 -74 L64 37 L-64 37 Z" fill="' + C.paper + '" stroke="' + k + '" stroke-width="12" stroke-linejoin="round"/>' +
          '<circle cx="0" cy="0" r="13" fill="' + k + '"/>';
      case 'height':
        return '<circle cx="0" cy="0" r="13" fill="' + k + '"/>';
      case 'target':
        return '<path d="M0 -118 L118 0 L0 118 L-118 0 Z" fill="' + C.target + '" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>' +
          '<path d="M0 -136 L136 0 L0 136 L-136 0 Z" fill="none" stroke="' + k + '" stroke-width="8" stroke-linejoin="round"/>';
    }
    return '';
  }

  // Значки для легенды: те же знаки в маленьком окне.
  function legendIcon(type) {
    var body;
    switch (type) {
      case 'highway':
        body = '<path d="M-150 0 H150" stroke="' + k() + '" stroke-width="64"/><path d="M-150 0 H150" stroke="' + C.road + '" stroke-width="42"/>';
        break;
      case 'dirt':
        body = '<path d="M-150 0 H150" stroke="' + k() + '" stroke-width="14"/>';
        break;
      case 'track':
        body = '<path d="M-150 0 H150" stroke="' + k() + '" stroke-width="11" stroke-dasharray="70 45"/>';
        break;
      case 'forest':
        body = '<rect x="-150" y="-90" width="300" height="180" fill="' + C.forest + '"/><rect x="-150" y="-90" width="300" height="180" fill="url(#lg-forest)"/>';
        break;
      case 'swamp':
        body = '<rect x="-150" y="-90" width="300" height="180" fill="url(#lg-swamp)"/>';
        break;
      case 'contour':
        body = '<path d="M-150 40 C-60 -50 60 -50 150 40" stroke="' + C.brown + '" stroke-width="12" fill="none"/>' +
          '<path d="M-150 -20 C-60 -110 60 -110 150 -20" stroke="' + C.brown + '" stroke-width="12" fill="none"/>';
        break;
      default:
        body = '<g transform="translate(0 ' + (type === 'tree' || type === 'church' || type === 'mill' ? 45 : 0) + ')">' + symbol(type) + '</g>';
    }
    return '<svg viewBox="-160 -110 320 220" class="legend-icon" aria-hidden="true">' + patterns('lg-') + body + '</svg>';
    function k() { return C.ink; }
  }

  function patterns(prefix) {
    return '<defs>' +
      '<pattern id="' + prefix + 'forest" width="180" height="156" patternUnits="userSpaceOnUse">' +
      '<circle cx="45" cy="40" r="17" fill="none" stroke="' + C.forestInk + '" stroke-width="7"/>' +
      '<circle cx="135" cy="118" r="17" fill="none" stroke="' + C.forestInk + '" stroke-width="7"/>' +
      '<path d="M120 58 l18 -34 l18 34 M138 24 v46" fill="none" stroke="' + C.forestInk + '" stroke-width="7"/>' +
      '<path d="M30 136 l18 -34 l18 34 M48 102 v46" fill="none" stroke="' + C.forestInk + '" stroke-width="7"/>' +
      '</pattern>' +
      '<pattern id="' + prefix + 'swamp" width="160" height="64" patternUnits="userSpaceOnUse">' +
      '<path d="M10 16 H70 M90 48 H150" stroke="' + C.water + '" stroke-width="9" stroke-linecap="round"/>' +
      '</pattern>' +
      '</defs>';
  }

  /* ---------- Населённый пункт ---------- */

  function hash(a, b) {
    var x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function houses() {
    var v = M.village;
    var out = '';
    v.streets.forEach(function (st) {
      var info = roads[st.road];
      var to = Math.min(st.to, info.length);
      for (var d = st.from + 60; d < to - 40; d += 118) {
        var p = along(info, d);
        [-1, 1].forEach(function (side) {
          if (hash(d, side + st.road) < 0.2) return;
          [0, 1].forEach(function (row) {
            if (row && hash(side * 3, d + st.road) < 0.65) return;
            var off = (row ? 185 : 88) + hash(side, d) * 14;
            var shift = (hash(d, side * 7) - 0.5) * 30;
            var e = p.e - p.un * off * side + p.ue * shift, n = p.n + p.ue * off * side + p.un * shift;
            if (blocked(e, n, st.road)) return;
            var ang = Math.atan2(-p.un, p.ue) * 180 / Math.PI;
            var w = row ? 40 : 50 + Math.round(hash(e, n) * 14);
            var hh = row ? 34 : 44;
            out += '<rect x="' + r1(-w / 2) + '" y="' + r1(-hh / 2) + '" width="' + w + '" height="' + hh + '" fill="' + C.ink + '" transform="translate(' + pt(e, n) + ') rotate(' + r1(ang) + ')"/>';
          });
        });
      }
    });
    return out;
  }

  function blocked(e, n, ownRoad) {
    var v = M.village;
    for (var i = 0; i < v.keepOut.length; i++) {
      var ko = v.keepOut[i];
      if (Math.hypot(e - ko[0], n - ko[1]) < ko[2]) return true;
    }
    if (nearest(river, e, n).d < 110) return true;
    for (var r = 0; r < roads.length; r++) {
      if (r === ownRoad) continue;
      var lim = M.roads[r].kind === 'highway' ? 70 : 52;
      if (distTo(roads[r], e, n) < lim) return true;
    }
    return false;
  }

  function distTo(info, e, n) {
    var best = Infinity, p = info.points;
    for (var i = 1; i < p.length; i++) best = Math.min(best, segDist(e, n, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]).d);
    return best;
  }

  /* ---------- Сетка, рамка, подписи ---------- */

  function gridLines() {
    var xs = [], ys = [];
    var c = M.corner;
    for (var km = Math.ceil(c.X / KM); km * KM - c.X <= H; km++) xs.push({ km: km, n: km * KM - c.X });
    for (var km2 = Math.ceil(c.Y / KM); km2 * KM - c.Y <= W; km2++) ys.push({ km: km2, e: km2 * KM - c.Y });
    return { xs: xs, ys: ys };
  }

  function two(km) { return String(km % 100).padStart(2, '0'); }

  function text(x, y, str, size, opts) {
    opts = opts || {};
    return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + size + '"' +
      (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '') +
      (opts.weight ? ' font-weight="' + opts.weight + '"' : '') +
      (opts.style ? ' font-style="' + opts.style + '"' : '') +
      (opts.fill ? ' fill="' + opts.fill + '"' : '') +
      (opts.halo ? ' class="halo"' : '') +
      (opts.rotate != null ? ' transform="rotate(' + r1(opts.rotate) + ' ' + r1(x) + ' ' + r1(y) + ')"' : '') +
      '>' + str + '</text>';
  }

  function frame() {
    var out = '';
    var g = gridLines();
    var c = M.corner;
    // Минутная рамка: чёрно-белые отрезки по 1′, точки — через 10″.
    out += '<g class="minute-frame">';
    for (var k = 0; k * MIN_LAT < H; k++) {
      var n0 = k * MIN_LAT, n1 = Math.min(H, (k + 1) * MIN_LAT);
      var dark = k % 2 === 0;
      out += '<rect x="-100" y="' + r1(sy(n1)) + '" width="72" height="' + r1(n1 - n0) + '" fill="' + (dark ? C.ink : C.paper) + '" stroke="' + C.ink + '" stroke-width="6"/>';
      for (var s = 1; s < 6; s++) {
        var ns = n0 + s * M.secLat * 10;
        if (ns < H) out += '<circle cx="-64" cy="' + r1(sy(ns)) + '" r="10" fill="' + (dark ? C.paper : C.ink) + '"/>';
      }
    }
    for (var j = 0; j * MIN_LON < W; j++) {
      var e0 = j * MIN_LON, e1 = Math.min(W, (j + 1) * MIN_LON);
      var dk = j % 2 === 0;
      out += '<rect x="' + r1(e0) + '" y="' + (H + 28) + '" width="' + r1(e1 - e0) + '" height="72" fill="' + (dk ? C.ink : C.paper) + '" stroke="' + C.ink + '" stroke-width="6"/>';
      for (var s2 = 1; s2 < 6; s2++) {
        var es = e0 + s2 * M.secLon * 10;
        if (es < W) out += '<circle cx="' + r1(es) + '" cy="' + (H + 64) + '" r="10" fill="' + (dk ? C.paper : C.ink) + '"/>';
      }
    }
    out += '</g>';
    // Внутренняя и внешняя рамки.
    out += '<path d="M0 0 V' + H + ' H' + W + '" fill="none" stroke="' + C.ink + '" stroke-width="10"/>';
    out += '<path d="M-130 0 V' + (H + 130) + ' H' + W + '" fill="none" stroke="' + C.ink + '" stroke-width="22"/>';
    out += '<path d="M0 0 H' + W + ' V' + H + '" fill="none" stroke="#9a9580" stroke-width="8" stroke-dasharray="40 30"/>';

    // Минуты широты и долготы.
    out += text(-165, sy(0) + 40, c.lat[0] + '°' + c.lat[1] + '′', 120, { anchor: 'end', weight: 700 });
    for (var m = 1; m * MIN_LAT < H; m++) out += text(-165, sy(m * MIN_LAT) + 38, (c.lat[1] + m) + '′', 110, { anchor: 'end' });
    out += text(0, H + 250, c.lon[0] + '°' + c.lon[1] + '′', 120, { anchor: 'middle', weight: 700 });
    for (var m2 = 1; m2 * MIN_LON < W; m2++) out += text(m2 * MIN_LON, H + 250, (c.lon[1] + m2) + '′', 110, { anchor: 'middle' });

    // Подписи километровой сетки на всех сторонах; у юго-западного угла — полностью.
    g.xs.forEach(function (x, i) {
      var y = sy(x.n) + 58;
      var big = two(x.km);
      if (i === 0) {
        out += '<text x="-420" y="' + r1(y) + '" font-size="165" text-anchor="end" font-weight="700"><tspan font-size="105" font-weight="400">' + Math.floor(x.km / 100) + '</tspan>' + big + '</text>';
      } else {
        out += text(-420, y, big, 165, { anchor: 'end', weight: 700 });
      }
      out += text(W + 70, y, big, 165, { weight: 700 });
    });
    g.ys.forEach(function (yl, i) {
      var big = two(yl.km);
      if (i === 0) {
        var zone = String(Math.floor(yl.km / 100));
        out += '<text x="' + r1(yl.e) + '" y="' + (H + 455) + '" font-size="165" text-anchor="middle" font-weight="700"><tspan font-size="105" font-weight="400">' + zone + '</tspan>' + big + '</text>';
      } else {
        out += text(yl.e, H + 455, big, 165, { anchor: 'middle', weight: 700 });
      }
      out += text(yl.e, -80, big, 165, { anchor: 'middle', weight: 700 });
    });

    out += text(-PAD.l + 20, -80, M.sheet, 150, { weight: 700 });
    out += scaleBar();
    return out;
  }

  function scaleBar() {
    var y = H + 720;
    var x0 = W / 2 - 1500;
    var out = text(W / 2, H + 585, 'Масштаб 1:' + M.scale.toLocaleString('ru-RU').replace(/\s/g, ' '), 125, { anchor: 'middle', weight: 700 });
    // Левый километр — по 100 м, дальше — целые километры.
    for (var i = 0; i < 10; i++) {
      out += '<rect x="' + (x0 + i * 100) + '" y="' + y + '" width="100" height="40" fill="' + (i % 2 ? C.paper : C.ink) + '" stroke="' + C.ink + '" stroke-width="6"/>';
    }
    for (var k = 0; k < 2; k++) {
      out += '<rect x="' + (x0 + 1000 + k * 1000) + '" y="' + y + '" width="1000" height="40" fill="' + (k % 2 ? C.paper : C.ink) + '" stroke="' + C.ink + '" stroke-width="6"/>';
    }
    out += text(x0, y - 22, '1', 95, { anchor: 'middle' }) + text(x0 + 1000, y - 22, '0', 95, { anchor: 'middle' }) +
      text(x0 + 2000, y - 22, '1', 95, { anchor: 'middle' }) + text(x0 + 3000, y - 22, '2 км', 95, { anchor: 'middle' });
    out += text(W / 2, H + 855, 'в 1 сантиметре 500 метров · сплошные горизонтали проведены через 10 метров', 95, { anchor: 'middle', fill: '#444' });
    return out;
  }

  /* ---------- Сборка карты ---------- */

  function build() {
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" class="topo" viewBox="' + FULL.join(' ') + '" preserveAspectRatio="xMidYMid meet" font-family="' + FONT.replace(/"/g, '') + '">');
    out.push(patterns(''));
    out.push('<defs><clipPath id="sheet"><rect x="0" y="0" width="' + W + '" height="' + H + '"/></clipPath></defs>');
    out.push('<rect x="' + FULL[0] + '" y="' + FULL[1] + '" width="' + FULL[2] + '" height="' + FULL[3] + '" fill="' + C.paper + '"/>');
    out.push('<g clip-path="url(#sheet)">');

    // Растительность и болота.
    M.forests.forEach(function (f) {
      var d = smoothPath(f.points, true);
      out.push('<path d="' + d + '" fill="' + C.forest + '"/><path d="' + d + '" fill="url(#forest)"/>');
      out.push('<path d="' + d + '" fill="none" stroke="' + C.ink + '" stroke-width="13" stroke-dasharray="0 42" stroke-linecap="round"/>');
    });
    M.swamps.forEach(function (s) {
      out.push('<path d="' + smoothPath(s.points, true) + '" fill="url(#swamp)"/>');
    });

    // Горизонтали, подписи и бергштрихи.
    var cl = contourLines();
    var contourSvg = '', labels = '';
    cl.forEach(function (lv) {
      var thick = lv.level % 50 === 0;
      lv.lines.forEach(function (ln) {
        contourSvg += '<path d="' + smoothPath(ln.points, ln.closed) + '" fill="none" stroke="' + C.brown + '" stroke-width="' + (thick ? 20 : 10) + '"/>';
      });
      labels += contourLabel(lv);
    });
    out.push(contourSvg);
    out.push(bergstriche(cl));
    out.push(labels);

    // Вода.
    var rd = smoothPath(M.river.points, false);
    out.push('<path d="' + rd + '" fill="none" stroke="' + C.water + '" stroke-width="54" stroke-linecap="round"/>');
    out.push('<path d="' + rd + '" fill="none" stroke="' + C.waterFill + '" stroke-width="30" stroke-linecap="round"/>');
    M.ponds.forEach(function (p) {
      out.push('<ellipse cx="' + sx(p.e) + '" cy="' + sy(p.n) + '" rx="' + p.rx + '" ry="' + p.ry + '" transform="rotate(' + (-p.rot) + ' ' + sx(p.e) + ' ' + sy(p.n) + ')" fill="' + C.waterFill + '" stroke="' + C.water + '" stroke-width="12"/>');
    });

    // Мосты: «вырез» в реке под дорогой.
    M.bridges.forEach(function (b) {
      var info = roads[b.road];
      var near = nearest(info, b.e, b.n);
      var p = along(info, near.s * info.length);
      var ang = Math.atan2(-p.un, p.ue) * 180 / Math.PI;
      out.push('<g transform="translate(' + pt(b.e, b.n) + ') rotate(' + r1(ang) + ')">' +
        '<rect x="-80" y="-42" width="160" height="84" fill="' + C.paper + '"/>' +
        '<path d="M-95 -62 L-70 -42 H70 L95 -62 M-95 62 L-70 42 H70 L95 62" fill="none" stroke="' + C.ink + '" stroke-width="12"/></g>');
    });

    // Дороги: сначала грунтовые, сверху — шоссе.
    M.roads.forEach(function (r) {
      var d = linePath(r.points);
      if (r.kind === 'dirt') out.push('<path d="' + d + '" fill="none" stroke="' + C.ink + '" stroke-width="14" stroke-linejoin="round"/>');
      if (r.kind === 'track') out.push('<path d="' + d + '" fill="none" stroke="' + C.ink + '" stroke-width="11" stroke-dasharray="70 45" stroke-linejoin="round"/>');
    });
    M.roads.forEach(function (r) {
      if (r.kind !== 'highway') return;
      var d = linePath(r.points);
      out.push('<path d="' + d + '" fill="none" stroke="' + C.ink + '" stroke-width="64" stroke-linejoin="round"/>');
      out.push('<path d="' + d + '" fill="none" stroke="' + C.road + '" stroke-width="42" stroke-linejoin="round"/>');
    });

    out.push(houses());

    // Километровая сетка.
    var g = gridLines();
    var grid = '';
    g.xs.forEach(function (x) { grid += 'M0 ' + r1(sy(x.n)) + 'H' + W; });
    g.ys.forEach(function (y) { grid += 'M' + r1(y.e) + ' 0V' + H; });
    out.push('<path d="' + grid + '" stroke="' + C.ink + '" stroke-width="9" fill="none" opacity=".85"/>');

    // Условные знаки и отметки высот.
    M.objects.forEach(function (o) {
      out.push('<g transform="translate(' + pt(o.e, o.n) + ')">' + symbol(o.type) + '</g>');
      if (o.label) out.push(text(sx(o.e) + 90, sy(o.n) + 45, o.label, 130, { weight: 700, halo: true }));
    });
    M.heights.forEach(function (h) {
      out.push('<g transform="translate(' + pt(h[0], h[1]) + ')">' + symbol('height') + '</g>');
      out.push(text(sx(h[0]) + 40, sy(h[1]) + 40, height(h[0], h[1]).toFixed(1).replace('.', ','), 110, { halo: true }));
    });

    // Названия.
    var rl = M.river.label;
    out.push(text(sx(rl.e), sy(rl.n), M.river.name, 150, { style: 'italic', fill: C.water, rotate: rl.angle, halo: true, anchor: 'middle' }));
    var vl = M.village.label;
    out.push(text(sx(vl.e), sy(vl.n), M.village.name, 175, { weight: 700, halo: true, anchor: 'middle' }));
    M.forests.forEach(function (f) {
      if (f.label) out.push(text(sx(f.label.e), sy(f.label.n), f.name, 130, { style: 'italic', fill: '#2f5f22', halo: true, anchor: 'middle' }));
    });
    var kurgan = obj('kurgan');
    out.push(text(sx(kurgan.e) + 70, sy(kurgan.n) - 70, 'кург.', 100, { style: 'italic', halo: true }));
    var spring = obj('spring');
    out.push(text(sx(spring.e) + 150, sy(spring.n) + 40, 'род.', 100, { style: 'italic', fill: C.water, halo: true }));

    out.push('</g>');
    out.push(frame());
    out.push('<g class="overlay"></g><g class="fx"></g>');
    out.push('</svg>');
    return out.join('');
  }

  // Подпись горизонтали: верх цифр — в сторону подъёма; выбираем место, где цифры стоят почти прямо.
  function contourLabel(lv) {
    if (lv.level % 20 !== 0) return '';
    var lines = lv.lines.slice().sort(function (a, b) { return lineLength(b.points) - lineLength(a.points); });
    for (var li = 0; li < Math.min(3, lines.length); li++) {
      var pts = lines[li].points;
      if (lineLength(pts) < 1500) break;
      for (var f = 0.25; f < 0.8; f += 0.03) {
        var i = Math.max(1, Math.floor(pts.length * f));
        var e = pts[i][0], n = pts[i][1];
        if (e < 300 || n < 300 || e > W - 300 || n > H - 300) continue;
        if (nearest(river, e, n).d < 250) continue;
        if (roads.some(function (r) { return distTo(r, e, n) < 180; })) continue;
        var ang = Math.atan2(-(pts[i][1] - pts[i - 1][1]), pts[i][0] - pts[i - 1][0]) * 180 / Math.PI;
        var g = gradient(e, n);
        var rad = ang * Math.PI / 180;
        if (Math.sin(rad) * g.ge + Math.cos(rad) * g.gn < 0) ang += 180;
        ang = ((ang + 540) % 360) - 180;
        if (Math.abs(ang) > 55) continue;
        return '<text x="' + r1(sx(e)) + '" y="' + r1(sy(n)) + '" font-size="105" fill="' + C.brown + '" text-anchor="middle" dominant-baseline="central" class="halo" transform="rotate(' + r1(ang) + ' ' + r1(sx(e)) + ' ' + r1(sy(n)) + ')">' + lv.level + '</text>';
      }
    }
    return '';
  }

  function bergstriche(cl) {
    var out = '';
    (M.berg || []).forEach(function (hi) {
      var h = hills[hi];
      var top = null;
      cl.forEach(function (lv) {
        lv.lines.forEach(function (ln) {
          if (ln.closed && inPoly(ln.points, h.e, h.n) && (!top || lv.level > top.level)) top = { level: lv.level, ln: ln };
        });
      });
      if (!top) return;
      var pts = top.ln.points;
      for (var q = 0; q < 3; q++) {
        var p = pts[Math.floor(pts.length * (q / 3 + 0.08)) % pts.length];
        var g = gradient(p[0], p[1]);
        var gl = Math.hypot(g.ge, g.gn) || 1;
        var e2 = p[0] - g.ge / gl * 70, n2 = p[1] - g.gn / gl * 70;
        out += '<path d="M' + pt(p[0], p[1]) + 'L' + pt(e2, n2) + '" stroke="' + C.brown + '" stroke-width="10"/>';
      }
    });
    return out;
  }

  /* ---------- Вид и наложения ---------- */

  var svg = null;
  var overlayEl = null;
  var fxEl = null;
  var cache = null;
  var curBox = FULL.slice();
  var anim = null;
  var lastOverlay = null;

  function mount(el) {
    if (!cache) cache = build();
    el.innerHTML = cache;
    svg = el.querySelector('svg');
    overlayEl = svg.querySelector('.overlay');
    fxEl = svg.querySelector('.fx');
    lastOverlay = null;
    setBox(curBox);
  }

  function setBox(b) {
    curBox = b;
    if (svg) svg.setAttribute('viewBox', b.map(function (v) { return r1(v); }).join(' '));
  }

  function view(box, instant) {
    box = box || FULL;
    if (anim) cancelAnimationFrame(anim);
    if (instant || !svg) { setBox(box.slice()); return; }
    var from = curBox.slice();
    if (from.every(function (v, i) { return Math.abs(v - box[i]) < 1; })) return;
    var t0 = performance.now(), dur = 750;
    function frameStep(now) {
      var t = Math.min(1, (now - t0) / dur);
      var k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setBox(from.map(function (v, i) { return v + (box[i] - v) * k; }));
      anim = t < 1 ? requestAnimationFrame(frameStep) : null;
    }
    anim = requestAnimationFrame(frameStep);
  }

  function overlay(html) {
    if (!overlayEl || html === lastOverlay) return;
    lastOverlay = html;
    overlayEl.innerHTML = html;
  }

  function fx(html, ms) {
    if (!fxEl) return;
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = html;
    fxEl.appendChild(g);
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, ms || 2000);
  }

  /* ---------- Готовые наложения для заданий ---------- */

  function obj(id) {
    for (var i = 0; i < M.objects.length; i++) if (M.objects[i].id === id) return M.objects[i];
    return null;
  }
  function target(id) {
    for (var i = 0; i < M.targets.length; i++) if (M.targets[i].id === id) return M.targets[i];
    return null;
  }

  // Квадрат по двум последним цифрам линий X и Y.
  function square(x2, y2) {
    var g = gridLines();
    var xl = g.xs.filter(function (l) { return l.km % 100 === x2; })[0];
    var yl = g.ys.filter(function (l) { return l.km % 100 === y2; })[0];
    return { e0: yl.e, n0: xl.n, xkm: xl.km, ykm: yl.km };
  }
  function squareOf(e, n) {
    var X = M.corner.X + n, Y = M.corner.Y + e;
    var xkm = Math.floor(X / KM), ykm = Math.floor(Y / KM);
    return { e0: ykm * KM - M.corner.Y, n0: xkm * KM - M.corner.X, xkm: xkm, ykm: ykm };
  }

  // Улитка: 1 2 3 / 8 9 4 / 7 6 5 (сверху вниз).
  var SNAIL = [[1, 2, 3], [8, 9, 4], [7, 6, 5]];
  function snailCell(num) {
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) if (SNAIL[r][c] === num) return { r: r, c: c };
    return null;
  }

  function boxAround(e0, n0, e1, n1) {
    return [sx(e0), sy(n1), e1 - e0, n1 - n0];
  }

  var VIEWS = {
    full: FULL,
    sw: boxAround(-PAD.l, -PAD.b + 120, 3750, 2520)
  };
  // Вид на квадрат с соседями; рамку листа и подписи за ней в кадр не берём.
  function squareBox(sq) {
    var e0 = sq.e0 - 520, e1 = sq.e0 + KM + 520, n0 = sq.n0 - 360, n1 = sq.n0 + KM + 360;
    var de = Math.max(0, -20 - e0) - Math.max(0, e1 - (W + 20));
    var dn = Math.max(0, -20 - n0) - Math.max(0, n1 - (H + 20));
    return boxAround(e0 + de, n0 + dn, e1 + de, n1 + dn);
  }

  function ring(e, n) {
    return '<g class="ring" transform="translate(' + pt(e, n) + ')">' +
      '<circle r="200" fill="none" stroke="' + C.accent + '" stroke-width="26" class="ring-pulse"/>' +
      '<circle r="200" fill="none" stroke="' + C.accent + '" stroke-width="26"/></g>';
  }

  function halo(x, y, str, size, opts) {
    opts = opts || {};
    opts.halo = true;
    opts.fill = opts.fill || C.accent;
    opts.weight = opts.weight || 700;
    return text(x, y, str, size, opts);
  }

  function squareSnail(sq, num, showNums) {
    var x = sx(sq.e0), y = sy(sq.n0 + KM), third = KM / 3;
    var out = '<g class="sq-hl">';
    out += '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + KM + '" height="' + KM + '" fill="' + C.accent + '" fill-opacity=".1" stroke="' + C.accent + '" stroke-width="26"/>';
    if (showNums) {
      out += '<path d="M' + r1(x + third) + ' ' + r1(y) + 'v' + KM + 'M' + r1(x + 2 * third) + ' ' + r1(y) + 'v' + KM +
        'M' + r1(x) + ' ' + r1(y + third) + 'h' + KM + 'M' + r1(x) + ' ' + r1(y + 2 * third) + 'h' + KM + '" stroke="' + C.accent + '" stroke-width="10" stroke-dasharray="40 30"/>';
      var cell = snailCell(num);
      if (cell) out += '<rect x="' + r1(x + cell.c * third) + '" y="' + r1(y + cell.r * third) + '" width="' + r1(third) + '" height="' + r1(third) + '" fill="' + C.accent + '" fill-opacity=".28"/>';
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          var hit = SNAIL[r][c] === num;
          out += text(x + (c + 0.5) * third, y + (r + 0.5) * third + 50, SNAIL[r][c], hit ? 170 : 130, { anchor: 'middle', weight: 700, fill: C.accent, halo: true });
        }
      }
    }
    out += '</g>';
    return out;
  }

  // Подписи линий квадрата внутри приближенного вида.
  function squareLabels(sq) {
    var x0 = sx(sq.e0), y0 = sy(sq.n0), out = '';
    out += halo(x0 - 40, y0 + 60, two(sq.xkm), 170, { fill: C.ink, anchor: 'end' });
    out += halo(x0 - 40, y0 - KM + 60, two(sq.xkm + 1), 170, { fill: C.ink, anchor: 'end' });
    out += halo(x0, y0 + 230, two(sq.ykm), 170, { fill: C.ink, anchor: 'middle' });
    out += halo(x0 + KM, y0 + 230, two(sq.ykm + 1), 170, { fill: C.ink, anchor: 'middle' });
    return out;
  }

  // Деления через 100 м по сторонам квадрата — как у координатомера.
  function ticks(sq) {
    var x0 = sx(sq.e0), y0 = sy(sq.n0), d = '';
    for (var i = 1; i < 10; i++) {
      var L = i === 5 ? 110 : 60;
      d += 'M' + (x0 + i * 100) + ' ' + y0 + 'v' + (-L);
      d += 'M' + (x0 + i * 100) + ' ' + (y0 - KM) + 'v' + L;
      d += 'M' + x0 + ' ' + (y0 - i * 100) + 'h' + L;
      d += 'M' + (x0 + KM) + ' ' + (y0 - i * 100) + 'h' + (-L);
    }
    return '<rect x="' + x0 + '" y="' + (y0 - KM) + '" width="' + KM + '" height="' + KM + '" fill="none" stroke="' + C.accent + '" stroke-width="14"/>' +
      '<path d="' + d + '" stroke="' + C.accent + '" stroke-width="12"/>';
  }

  // Перпендикуляры к нижней и левой линиям квадрата с подписями расстояний.
  // Короткий отрезок подписываем снаружи квадрата, чтобы подпись не легла на знак.
  function rectLines(e, n, sq) {
    var x = sx(e), y = sy(n), x0 = sx(sq.e0), y0 = sy(sq.n0);
    var dx = Math.round(e - sq.e0), dy = Math.round(n - sq.n0);
    var out = '<path d="M' + r1(x) + ' ' + r1(y) + 'V' + r1(y0) + 'M' + r1(x) + ' ' + r1(y) + 'H' + r1(x0) + '" stroke="' + C.accent + '" stroke-width="16" stroke-dasharray="50 30"/>';
    // Подписи не должны залезать под кольцо (r = 200) и на номера линий сетки.
    out += dx >= 700
      ? halo(x - 225, y - 60, '→ ' + dx + ' м', 115, { anchor: 'end' })
      : halo(x0 - 50, y + 45, '→ ' + dx + ' м', 115, { anchor: 'end' });
    out += dy >= 450
      ? halo(x + 40, y + (y0 - y) * 0.68 + 45, '↑ ' + dy + ' м', 115)
      : halo(Math.min(Math.max(x, x0 + 360), x0 + 640), y0 + 160, '↑ ' + dy + ' м', 115, { anchor: 'middle' });
    return out;
  }

  function geoLines(e, n) {
    var x = sx(e), y = sy(n);
    var sLat = Math.round(n / M.secLat), sLon = Math.round(e / M.secLon);
    function dms(base, s) {
      var tot = base[1] * 60 + s;
      return base[0] + '°' + Math.floor(tot / 60) + '′' + String(tot % 60).padStart(2, '0') + '″';
    }
    return '<path d="M' + r1(x) + ' ' + r1(y) + 'H-100M' + r1(x) + ' ' + r1(y) + 'V' + (H + 100) + '" stroke="' + C.accent + '" stroke-width="16" stroke-dasharray="50 30"/>' +
      '<circle cx="-64" cy="' + r1(y) + '" r="34" fill="none" stroke="' + C.accent + '" stroke-width="14"/>' +
      '<circle cx="' + r1(x) + '" cy="' + (H + 64) + '" r="34" fill="none" stroke="' + C.accent + '" stroke-width="14"/>' +
      halo(60, y - 50, dms(M.corner.lat, sLat), 140) +
      halo(x + 50, H - 90, dms(M.corner.lon, sLon), 140);
  }

  function arrow(e0, n0, e1, n1, label) {
    var x0 = sx(e0), y0 = sy(n0), x1 = sx(e1), y1 = sy(n1);
    var a = Math.atan2(y1 - y0, x1 - x0);
    var hx = x1 - Math.cos(a) * 150, hy = y1 - Math.sin(a) * 150;
    var head = 'M' + r1(hx + Math.cos(a + 2.5) * 110) + ' ' + r1(hy + Math.sin(a + 2.5) * 110) + 'L' + r1(hx) + ' ' + r1(hy) + 'L' + r1(hx + Math.cos(a - 2.5) * 110) + ' ' + r1(hy + Math.sin(a - 2.5) * 110);
    return '<path d="M' + r1(x0) + ' ' + r1(y0) + 'L' + r1(hx) + ' ' + r1(hy) + '" stroke="' + C.accent + '" stroke-width="22" stroke-dasharray="60 34"/>' +
      '<path d="' + head + '" fill="none" stroke="' + C.accent + '" stroke-width="22" stroke-linejoin="round"/>' +
      halo((x0 + x1) / 2, (y0 + y1) / 2 - 70, label, 140, { anchor: 'middle' });
  }

  function targets(states) {
    var out = '';
    M.targets.forEach(function (t) {
      var st = states[t.id] || '';
      out += '<g class="target ' + st + '" transform="translate(' + pt(t.e, t.n) + ')">' + symbol('target') +
        '<text y="48" font-size="140" text-anchor="middle" font-weight="700" fill="#fff">' + t.id + '</text>' +
        (st === 'hit' ? '<path d="M-90 -90 L90 90 M90 -90 L-90 90" stroke="' + C.ink + '" stroke-width="26" stroke-linecap="round"/>' : '') +
        '</g>';
    });
    return out;
  }

  function targetIcon(id) {
    return '<svg viewBox="-140 -140 280 280" class="t-mark" aria-hidden="true">' + symbol('target') +
      '<text y="48" font-size="140" text-anchor="middle" font-weight="700" fill="#fff" font-family="' + FONT.replace(/'/g, '') + '">' + id + '</text></svg>';
  }

  function boom(e, n) {
    var x = sx(e), y = sy(n), sparks = '';
    for (var i = 0; i < 10; i++) {
      var a = i * Math.PI / 5 + 0.3;
      sparks += '<line x1="0" y1="0" x2="' + r1(Math.cos(a) * 420) + '" y2="' + r1(Math.sin(a) * 420) + '" class="spark" style="animation-delay:' + (0.62 + (i % 3) * 0.04) + 's"/>';
    }
    fx('<g transform="translate(' + r1(x) + ' ' + r1(y) + ')">' +
      '<circle r="46" class="shell"/>' +
      '<circle r="380" class="blast blast-1"/><circle r="260" class="blast blast-2"/><circle r="480" class="shock"/>' + sparks + '</g>', 2600);
  }

  function splash(e, n) {
    fx('<g transform="translate(' + pt(e, n) + ')"><circle r="260" class="shock miss"/><circle r="150" class="blast miss"/></g>', 1600);
  }

  return {
    mount: mount,
    view: view,
    overlay: overlay,
    views: VIEWS,
    squareBox: squareBox,
    obj: obj,
    target: target,
    square: square,
    squareOf: squareOf,
    ring: ring,
    squareSnail: squareSnail,
    squareLabels: squareLabels,
    ticks: ticks,
    rectLines: rectLines,
    geoLines: geoLines,
    arrow: arrow,
    targets: targets,
    boom: boom,
    splash: splash,
    legendIcon: legendIcon,
    targetIcon: targetIcon,
    height: height
  };
})();
