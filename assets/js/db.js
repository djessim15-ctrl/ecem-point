/* ============================================================================
 * ECEM Point — client Supabase
 * ----------------------------------------------------------------------------
 * Crée l'unique client utilisé par tout le site et l'expose sur window.ECEM.sb.
 * La session est conservée dans le localStorage : un élève reste connecté d'un
 * cours à l'autre sur le même appareil.
 * ==========================================================================*/
(function () {
  'use strict';

  var cfg = window.ECEM_CONFIG;

  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML =
        '<div style="font-family:system-ui;padding:40px;max-width:640px;margin:auto">' +
        '<h1>Configuration manquante</h1>' +
        '<p>Renseigne <code>SUPABASE_URL</code> et <code>SUPABASE_ANON_KEY</code> dans ' +
        '<code>assets/js/config.js</code>.</p></div>';
    });
    return;
  }

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML =
        '<div style="font-family:system-ui;padding:40px;max-width:640px;margin:auto">' +
        '<h1>Librairie Supabase introuvable</h1>' +
        '<p>Le fichier <code>assets/vendor/supabase.js</code> est absent ou corrompu.</p></div>';
    });
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'ecem-point-session'
    }
  });

  window.ECEM = window.ECEM || {};
  window.ECEM.cfg = cfg;
  window.ECEM.sb = sb;
})();
