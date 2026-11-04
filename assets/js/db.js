/* ============================================================================
 * ECEM Point — client Supabase
 * ----------------------------------------------------------------------------
 * Crée l'unique client utilisé par tout le site et l'expose sur window.ECEM.sb.
 * La session est conservée dans le localStorage : un élève reste connecté d'un
 * cours à l'autre sur le même appareil.
 *
 * En mode démo (app.html?demo=1), le client Supabase est remplacé par le faux
 * client en mémoire de demo.js : aucune requête ne part sur le réseau.
 * ==========================================================================*/
(function () {
  'use strict';

  var cfg = window.ECEM_CONFIG;

  function fatal(title, message) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML =
        '<div class="boot" style="min-height:100vh">' +
        '<div class="card" style="max-width:560px;text-align:left">' +
        '<h1 style="font-size:1.4rem;margin-bottom:8px">' + title + '</h1>' +
        '<p class="sub">' + message + '</p></div></div>';
      document.body.className = 'page-app';
    });
  }

  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    fatal('Configuration manquante',
      'Renseigne <code>SUPABASE_URL</code> et <code>SUPABASE_ANON_KEY</code> dans ' +
      '<code>assets/js/config.js</code>.');
    return;
  }

  var demo = !!(window.ECEM_DEMO && window.ECEM_DEMO.on);
  var sb;

  if (demo) {
    sb = window.ECEM_DEMO.client();
  } else {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      fatal('Librairie Supabase introuvable',
        'Le fichier <code>assets/vendor/supabase.js</code> est absent ou corrompu.');
      return;
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'ecem-point-session'
      }
    });
  }

  window.ECEM = window.ECEM || {};
  window.ECEM.cfg = cfg;
  window.ECEM.sb = sb;
  window.ECEM.demo = demo;
})();
