/* ============================================================================
 * ECEM Point — application installable & état du réseau
 * ----------------------------------------------------------------------------
 *  • enregistre le service worker (cache de la coquille : chargement instantané,
 *    page affichable même si le réseau tombe) ;
 *  • propose l'installation sur l'écran d'accueil quand le navigateur le permet.
 * Sur file:// ou http://localhost, tout échoue silencieusement : le site reste
 * parfaitement utilisable sans service worker.
 * ==========================================================================*/
(function () {
  'use strict';

  var PWA = { installable: false, installed: false };

  /* -------------------------------------------------------------------------
   * Service worker
   * ---------------------------------------------------------------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (registration) {
        PWA.registration = registration;
      }).catch(function () {
        /* pas de cache hors ligne : sans gravité */
      });
    });
  }

  /* -------------------------------------------------------------------------
   * Installation
   * ---------------------------------------------------------------------- */
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    PWA.installable = true;
    maybeShowInstallChip();
  });

  window.addEventListener('appinstalled', function () {
    PWA.installed = true;
    PWA.installable = false;
    deferredPrompt = null;
    var chip = document.getElementById('pwa-chip');
    if (chip) chip.remove();
  });

  PWA.promptInstall = function () {
    if (!deferredPrompt) return Promise.resolve(false);
    deferredPrompt.prompt();
    return deferredPrompt.userChoice.then(function (choice) {
      var accepted = choice && choice.outcome === 'accepted';
      if (accepted) {
        PWA.installed = true;
        PWA.installable = false;
      }
      deferredPrompt = null;
      return accepted;
    });
  };

  function maybeShowInstallChip() {
    var dismissed = false;
    try { dismissed = window.localStorage.getItem('ecem-install-dismissed') === '1'; } catch (e) {}
    if (dismissed || document.getElementById('pwa-chip')) return;

    var chip = document.createElement('div');
    chip.id = 'pwa-chip';
    chip.className = 'pwa-chip';
    chip.innerHTML =
      '<span class="pwa-chip-ico" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3.5v11.4"/><path d="m7.4 10.6 4.6 4.6 4.6-4.6"/><path d="M4.4 19.5h15.2"/></svg>' +
      '</span>' +
      '<span class="pwa-chip-text"><b>Installer ECEM Point</b><span>sur ton écran d’accueil</span></span>' +
      '<button type="button" class="btn btn-primary btn-sm" data-pwa-install>Installer</button>' +
      '<button type="button" class="icon-btn" data-pwa-close aria-label="Masquer">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>' +
      '</button>';

    document.body.appendChild(chip);

    chip.querySelector('[data-pwa-install]').addEventListener('click', function () {
      PWA.promptInstall().then(function () { chip.remove(); });
    });
    chip.querySelector('[data-pwa-close]').addEventListener('click', function () {
      try { window.localStorage.setItem('ecem-install-dismissed', '1'); } catch (e) {}
      chip.remove();
    });
  }

  /* -------------------------------------------------------------------------
   * Petit indicateur hors ligne (réutilise le système de toasts s'il est là)
   * ---------------------------------------------------------------------- */
  function netUpdate() {
    var UI = window.ECEM && window.ECEM.UI;
    if (!UI) return;
    if (navigator.onLine) return;
    UI.err('Hors ligne — les points seront envoyés au retour du réseau.', { duration: 6000 });
  }

  window.addEventListener('offline', netUpdate);

  window.ECEM = window.ECEM || {};
  window.ECEM.PWA = PWA;
})();
