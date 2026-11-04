/* ============================================================================
 * ECEM Point — thème clair / sombre + préférences locales
 * ----------------------------------------------------------------------------
 * Le thème est appliqué le plus tôt possible (petit script en ligne dans le
 * <head>) pour éviter tout flash blanc ; ce module gère le reste : bascule,
 * mémorisation, respect du réglage système et mise à jour de la couleur de
 * barre du navigateur.
 * ==========================================================================*/
(function () {
  'use strict';

  var KEY = 'ecem-theme';
  var PREFS_KEY = 'ecem-prefs';
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  var prefs = read(PREFS_KEY, {});
  var defaults = { sound: true, motion: true, notifications: true, compact: false };

  Object.keys(defaults).forEach(function (k) {
    if (typeof prefs[k] === 'undefined') prefs[k] = defaults[k];
  });

  var Theme = {
    mode: function () {
      var stored = read(KEY, 'auto');
      return stored === 'light' || stored === 'dark' ? stored : 'auto';
    },

    resolved: function () {
      var mode = Theme.mode();
      if (mode === 'auto') return mql && mql.matches ? 'dark' : 'light';
      return mode;
    },

    apply: function () {
      var mode = Theme.mode();
      var actual = Theme.resolved();
      var root = document.documentElement;
      root.setAttribute('data-theme', actual);
      root.setAttribute('data-theme-mode', mode);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', actual === 'dark' ? '#0a0918' : '#f6f5fb');
      document.dispatchEvent(new CustomEvent('ecem:theme', { detail: { mode: mode, actual: actual } }));
      return actual;
    },

    set: function (mode) {
      write(KEY, mode);
      return Theme.apply();
    },

    cycle: function () {
      var order = ['light', 'dark', 'auto'];
      var next = order[(order.indexOf(Theme.mode()) + 1) % order.length];
      return { mode: next, actual: Theme.set(next) };
    },

    label: function (mode) {
      return mode === 'light' ? 'Clair' : mode === 'dark' ? 'Sombre' : 'Auto';
    }
  };

  var Prefs = {
    all: function () { return Object.assign({}, prefs); },
    get: function (key) { return prefs[key]; },
    set: function (key, value) {
      prefs[key] = value;
      write(PREFS_KEY, prefs);
      document.dispatchEvent(new CustomEvent('ecem:prefs', { detail: { key: key, value: value } }));
      return value;
    },
    reset: function () {
      prefs = Object.assign({}, defaults);
      write(PREFS_KEY, prefs);
    }
  };

  if (mql) {
    var onChange = function () { if (Theme.mode() === 'auto') Theme.apply(); };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }

  Theme.apply();

  window.ECEM = window.ECEM || {};
  window.ECEM.Theme = Theme;
  window.ECEM.Prefs = Prefs;
})();
