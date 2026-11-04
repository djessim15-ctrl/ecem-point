/* ============================================================================
 * ECEM Point — effets & micro-interactions
 * ----------------------------------------------------------------------------
 *  • Confettis sur un canvas plein écran (aucune image, aucun son externe)
 *  • Compteurs animés pour les nombres de points
 *  • Petits sons de synthèse (WebAudio) — désactivables dans le profil
 *  • Vibration légère sur mobile
 * Tout respecte « animations réduites » et les préférences du compte.
 * ==========================================================================*/
(function () {
  'use strict';

  var reduceMotion = function () {
    var pref = window.ECEM && window.ECEM.Prefs ? window.ECEM.Prefs.get('motion') : true;
    if (pref === false) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  var COLORS = ['#8b5cf6', '#a78bfa', '#f5b94a', '#38bdf8', '#34d399', '#fb7185', '#f0abfc'];

  /* -------------------------------------------------------------------------
   * Confettis
   * ---------------------------------------------------------------------- */
  var canvas = null;
  var ctx = null;
  var particles = [];
  var raf = null;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'confetti-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(x, y, count, spread) {
    if (!ctx) { particles.length = 0; return; }
    for (var i = 0; i < count; i++) {
      var angle = (-Math.PI / 2) + (Math.random() - 0.5) * (spread || 1.6);
      var speed = 4 + Math.random() * 9;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 0,
        ttl: 70 + Math.random() * 50,
        shape: Math.random() > 0.55 ? 'rect' : 'circle'
      });
    }
  }

  function loop() {
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.vy += 0.22;
      p.vx *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life++;

      var alpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (p.life > p.ttl || p.y > window.innerHeight + 40) particles.splice(i, 1);
    }

    if (particles.length) {
      raf = window.requestAnimationFrame(loop);
    } else {
      window.cancelAnimationFrame(raf);
      raf = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function start() {
    if (!raf) raf = window.requestAnimationFrame(loop);
  }

  var FX = {
    enabled: function () { return !reduceMotion(); },

    burst: function (el, count) {
      if (reduceMotion()) return;
      ensureCanvas();
      var x = window.innerWidth / 2;
      var y = window.innerHeight * 0.42;
      if (el && el.getBoundingClientRect) {
        var rect = el.getBoundingClientRect();
        if (rect.width) {
          x = rect.left + rect.width / 2;
          y = rect.top + rect.height / 2;
        }
      }
      spawn(x, y, count || 26, 1.5);
      start();
    },

    celebrate: function () {
      if (reduceMotion()) return;
      ensureCanvas();
      spawn(window.innerWidth * 0.2, window.innerHeight * 0.75, 60, 2.7);
      spawn(window.innerWidth * 0.8, window.innerHeight * 0.75, 60, 2.7);
      start();
    },

    /* Anime un nombre de « from » vers « to ». */
    countTo: function (node, to, opts) {
      if (!node) return;
      opts = opts || {};
      var from = parseFloat(String(node.textContent).replace(/[^\d.-]/g, '')) || 0;
      to = Number(to) || 0;

      if (reduceMotion() || from === to) {
        node.textContent = String(to);
        return;
      }

      var duration = opts.duration || 650;
      var start = performance.now();

      function frame(now) {
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        node.textContent = String(Math.round(from + (to - from) * eased));
        if (t < 1) window.requestAnimationFrame(frame);
      }
      window.requestAnimationFrame(frame);
    },

    pop: function (node) {
      if (!node || reduceMotion()) return;
      node.classList.remove('is-popping');
      /* force reflow pour rejouer l'animation */
      void node.offsetWidth;
      node.classList.add('is-popping');
      window.setTimeout(function () { node.classList.remove('is-popping'); }, 700);
    },

    vibrate: function (pattern) {
      if (reduceMotion()) return;
      if (navigator.vibrate) navigator.vibrate(pattern || 12);
    }
  };

  /* -------------------------------------------------------------------------
   * Sons de synthèse
   * ---------------------------------------------------------------------- */
  var audio = null;

  function context() {
    if (audio) return audio;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { audio = new Ctor(); } catch (e) { return null; }
    return audio;
  }

  function tone(freq, startAt, duration, gain, type) {
    var ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();

    var osc = ac.createOscillator();
    var amp = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    var t0 = ac.currentTime + startAt;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain || 0.06, t0 + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  FX.sound = function (kind) {
    var pref = window.ECEM && window.ECEM.Prefs ? window.ECEM.Prefs.get('sound') : true;
    if (pref === false || reduceMotion()) return;

    if (kind === 'award') {
      tone(660, 0, 0.16, 0.05, 'triangle');
      tone(880, 0.08, 0.22, 0.045, 'triangle');
    } else if (kind === 'send') {
      tone(520, 0, 0.12, 0.04, 'sine');
      tone(780, 0.07, 0.18, 0.035, 'sine');
    } else if (kind === 'success') {
      tone(523, 0, 0.14, 0.05, 'sine');
      tone(659, 0.09, 0.14, 0.045, 'sine');
      tone(784, 0.18, 0.26, 0.04, 'sine');
    } else if (kind === 'error') {
      tone(220, 0, 0.18, 0.05, 'sawtooth');
      tone(160, 0.1, 0.24, 0.04, 'sawtooth');
    } else if (kind === 'message') {
      tone(880, 0, 0.09, 0.03, 'sine');
      tone(1180, 0.06, 0.12, 0.025, 'sine');
    }
  };

  window.ECEM = window.ECEM || {};
  window.ECEM.FX = FX;
})();
