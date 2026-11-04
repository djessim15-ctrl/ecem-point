/* ============================================================================
 * ECEM Point — petits graphiques SVG (sans dépendance)
 * ----------------------------------------------------------------------------
 *  Charts.sparkline([3, 5, 4, 8…])      courbe + aire dégradée
 *  Charts.bars([{label, gain, lose}])   histogramme gains / retraits
 *  Charts.donut([{label, value, color}]) anneau de répartition
 *  Charts.ring(value, max)              anneau de progression
 *  Charts.heat(hours[24])               bande horaire d'activité
 *  Charts.hbars([{label, value}])       barres horizontales (DOM)
 * ==========================================================================*/
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var ACCENT = '#8b5cf6';
  var GOLD = '#f5b94a';
  var RED = '#fb7185';
  var GREEN = '#34d399';
  var BLUE = '#38bdf8';
  var uid = 0;

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (attrs[key] !== null && attrs[key] !== undefined) el.setAttribute(key, attrs[key]);
      });
    }
    return el;
  }

  function root(w, h, cls) {
    var el = svg('svg', {
      viewBox: '0 0 ' + w + ' ' + h,
      width: '100%',
      height: h,
      fill: 'none',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      class: 'chart ' + (cls || '')
    });
    el.style.display = 'block';
    el.style.height = 'auto';
    return el;
  }

  var Charts = {};

  /* -------------------------------------------------------------------------
   * Courbe + aire
   * ---------------------------------------------------------------------- */
  Charts.sparkline = function (values, opts) {
    opts = opts || {};
    values = (values || []).map(function (v) { return Number(v) || 0; });
    if (values.length < 2) values = values.concat(values.length ? [values[0]] : [0, 0]);

    var w = 100;
    var h = opts.height ? opts.height : 34;
    var pad = 3;
    var min = Math.min.apply(null, values.concat([0]));
    var max = Math.max.apply(null, values.concat([1]));
    var span = max - min || 1;
    var color = opts.color || ACCENT;
    var id = 'spark' + (++uid);

    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * (w - pad * 2) + pad;
      var y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return [x, y];
    });

    var line = pts.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
    }).join(' ');
    var area = line + ' L' + (w - pad) + ' ' + h + ' L' + pad + ' ' + h + ' Z';

    var el = root(w, h, 'chart--spark');
    el.setAttribute('preserveAspectRatio', 'none');

    var defs = svg('defs');
    var grad = svg('linearGradient', { id: id, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.32' }));
    grad.appendChild(svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
    defs.appendChild(grad);
    el.appendChild(defs);

    el.appendChild(svg('path', { d: area, fill: 'url(#' + id + ')', stroke: 'none' }));
    el.appendChild(svg('path', {
      d: line,
      stroke: color,
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke'
    }));

    if (opts.dot !== false) {
      var last = pts[pts.length - 1];
      el.appendChild(svg('circle', { cx: last[0], cy: last[1], r: '2.4', fill: color, stroke: 'none' }));
    }
    return el;
  };

  /* -------------------------------------------------------------------------
   * Histogramme gains / retraits par jour
   * ---------------------------------------------------------------------- */
  Charts.bars = function (days, opts) {
    opts = opts || {};
    days = days || [];
    var w = 320;
    var h = 150;
    var padL = 4;
    var padR = 4;
    var padT = 12;
    var padB = 26;
    var plotH = h - padT - padB;
    var max = 1;
    days.forEach(function (d) { max = Math.max(max, d.gain || 0, d.lose || 0); });

    var el = root(w, h, 'chart--bars');
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    el.style.width = '100%';
    el.style.height = 'auto';

    /* lignes de repère */
    for (var g = 0; g <= 2; g++) {
      var gy = padT + (plotH / 2) * g;
      el.appendChild(svg('line', {
        x1: padL, x2: w - padR, y1: gy, y2: gy,
        stroke: 'currentColor', 'stroke-opacity': '0.12', 'stroke-width': '1',
        'stroke-dasharray': g === 2 ? '0' : '3 5'
      }));
    }

    var slot = (w - padL - padR) / Math.max(days.length, 1);
    var barW = Math.min(9, Math.max(4, slot / 3.2));

    days.forEach(function (day, i) {
      var cx = padL + slot * i + slot / 2;
      var gainH = Math.max((day.gain || 0) / max * plotH, day.gain ? 3 : 0);
      var loseH = Math.max((day.lose || 0) / max * plotH, day.lose ? 3 : 0);

      el.appendChild(svg('rect', {
        x: cx - barW - 1.5, y: padT + plotH - gainH, width: barW, height: gainH,
        rx: barW / 2, fill: GOLD, opacity: day.gain ? 0.95 : 0.15
      }));
      el.appendChild(svg('rect', {
        x: cx + 1.5, y: padT + plotH - loseH, width: barW, height: loseH,
        rx: barW / 2, fill: RED, opacity: day.lose ? 0.75 : 0.15
      }));

      var label = svg('text', {
        x: cx, y: h - 8, 'text-anchor': 'middle',
        'font-size': '9', 'font-weight': '600', fill: 'currentColor', opacity: day.today ? '1' : '0.5'
      });
      label.textContent = day.label;
      el.appendChild(label);
    });

    return el;
  };

  /* -------------------------------------------------------------------------
   * Anneau de répartition
   * ---------------------------------------------------------------------- */
  Charts.donut = function (items, opts) {
    opts = opts || {};
    items = (items || []).filter(function (i) { return (i.value || 0) > 0; });
    var size = 120;
    var stroke = opts.stroke || 13;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var total = items.reduce(function (sum, i) { return sum + i.value; }, 0);

    var el = root(size, size, 'chart--donut');
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    el.style.width = '100%';
    el.style.height = 'auto';
    el.appendChild(svg('circle', {
      cx: size / 2, cy: size / 2, r: r, stroke: 'currentColor', 'stroke-opacity': '0.1',
      'stroke-width': stroke, fill: 'none'
    }));

    var offset = 0;
    items.forEach(function (item) {
      var ratio = total ? item.value / total : 0;
      var dash = ratio * c;
      var circle = svg('circle', {
        cx: size / 2, cy: size / 2, r: r,
        stroke: item.color, 'stroke-width': stroke,
        'stroke-dasharray': dash.toFixed(2) + ' ' + (c - dash).toFixed(2),
        'stroke-dashoffset': (-offset).toFixed(2),
        'stroke-linecap': 'round',
        fill: 'none',
        transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'
      });
      el.appendChild(circle);
      offset += dash;
    });

    return el;
  };

  /* -------------------------------------------------------------------------
   * Anneau de progression
   * ---------------------------------------------------------------------- */
  Charts.ring = function (value, goal, opts) {
    opts = opts || {};
    var size = 108;
    var stroke = 10;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var ratio = goal > 0 ? Math.min(1, value / goal) : 0;
    var color = opts.color || ACCENT;

    var el = root(size, size, 'chart--ring');
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    el.style.width = (opts.size || 108) + 'px';
    el.style.height = (opts.size || 108) + 'px';

    el.appendChild(svg('circle', {
      cx: size / 2, cy: size / 2, r: r, stroke: 'currentColor', 'stroke-opacity': '0.12',
      'stroke-width': stroke, fill: 'none'
    }));
    el.appendChild(svg('circle', {
      cx: size / 2, cy: size / 2, r: r, stroke: color, 'stroke-width': stroke,
      'stroke-linecap': 'round',
      'stroke-dasharray': (ratio * c).toFixed(2) + ' ' + c.toFixed(2),
      transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
      fill: 'none'
    }));

    var label = svg('text', {
      x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle',
      'font-size': '22', 'font-weight': '800', fill: 'currentColor'
    });
    label.textContent = String(value);
    el.appendChild(label);

    var sub = svg('text', {
      x: size / 2, y: size / 2 + 15, 'text-anchor': 'middle',
      'font-size': '9', 'font-weight': '600', fill: 'currentColor', opacity: '0.55'
    });
    sub.textContent = (opts.caption || '/ ' + goal);
    el.appendChild(sub);
    return el;
  };

  /* -------------------------------------------------------------------------
   * Bande horaire d'activité (24 cases)
   * ---------------------------------------------------------------------- */
  Charts.heat = function (hours, opts) {
    opts = opts || {};
    var values = hours || [];
    var max = Math.max.apply(null, values.concat([1]));
    var el = document.createElement('div');
    el.className = 'heat';
    values.forEach(function (value, hour) {
      var level = value <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
      var cell = document.createElement('span');
      cell.className = 'heat-cell heat--' + level;
      cell.title = hour + ' h · ' + value + (value > 1 ? ' mouvements' : ' mouvement');
      if (hour === new Date().getHours()) cell.classList.add('is-now');
      el.appendChild(cell);
    });
    return el;
  };

  /* -------------------------------------------------------------------------
   * Barres horizontales (DOM)
   * ---------------------------------------------------------------------- */
  Charts.hbars = function (items, opts) {
    opts = opts || {};
    var list = document.createElement('ul');
    list.className = 'hbars';
    var max = Math.max.apply(null, (items || []).map(function (i) { return i.value || 0; }).concat([1]));

    (items || []).forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'hbar';

      var head = document.createElement('div');
      head.className = 'hbar-head';
      var name = document.createElement('span');
      name.className = 'hbar-name';
      name.textContent = item.label;
      var value = document.createElement('b');
      value.className = 'hbar-value';
      value.textContent = (opts.format ? opts.format(item.value) : item.value);
      head.appendChild(name);
      head.appendChild(value);

      var track = document.createElement('div');
      track.className = 'hbar-track';
      var fill = document.createElement('div');
      fill.className = 'hbar-fill';
      fill.style.width = Math.max(4, ((item.value || 0) / max) * 100) + '%';
      if (item.color) fill.style.background = item.color;
      track.appendChild(fill);

      row.appendChild(head);
      row.appendChild(track);
      list.appendChild(row);
    });

    if (!(items || []).length) {
      var empty = document.createElement('p');
      empty.className = 'sub';
      empty.textContent = opts.empty || 'Pas encore de données.';
      return empty;
    }
    return list;
  };

  Charts.COLORS = { accent: ACCENT, gold: GOLD, red: RED, green: GREEN, blue: BLUE };

  window.ECEM = window.ECEM || {};
  window.ECEM.Charts = Charts;
})();
