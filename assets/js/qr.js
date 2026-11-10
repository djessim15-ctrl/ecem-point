/* ============================================================================
 * ECEM Point — QR code de partage
 * ----------------------------------------------------------------------------
 * Le QR est fabriqué dans le navigateur par `assets/vendor/qrcode.js`
 * (qrcode-generator, MIT) : aucune requête réseau, aucun service externe,
 * donc il fonctionne hors-ligne et dans l'aperçu sans réseau.
 *
 * Usage : ECEM.QR.mount(conteneur) ou ECEM.QR.svg(url).
 * ==========================================================================*/
(function () {
  'use strict';

  var ECEM = (window.ECEM = window.ECEM || {});
  var UI = window.ECEM.UI;

  /* Adresse publique du site : celle de la page d'accueil, sans paramètre. */
  function urlPartage() {
    try {
      var url = new URL('index.html', window.location.href);
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (e) {
      return String(window.location.href || '');
    }
  }

  function disponible() {
    return typeof window.qrcode === 'function';
  }

  /* Renvoie le SVG du QR, ou null si la bibliothèque n'a pas pu se charger. */
  function svg(url, options) {
    var adresse = url || urlPartage();
    if (!disponible()) return null;

    var reglages = options || {};
    try {
      var qr = window.qrcode(0, 'M');          /* 0 = taille automatique */
      qr.addData(adresse);
      qr.make();
      return qr.createSvgTag({
        cellSize: reglages.cellSize || 4,
        margin: reglages.margin == null ? 2 : reglages.margin,
        scalable: true,
        alt: 'QR code du site ECEM Point',
        title: 'Partager ECEM Point'
      });
    } catch (e) {
      return null;
    }
  }

  function copier(texte) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texte);
    }
    return new Promise(function (resolve) {
      var champ = document.createElement('textarea');
      champ.value = texte;
      champ.setAttribute('readonly', '');
      champ.style.position = 'absolute';
      champ.style.left = '-9999px';
      document.body.appendChild(champ);
      champ.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(champ);
      resolve();
    });
  }

  /* Bloc complet : QR + adresse + bouton « copier ». */
  function bloc(url) {
    var adresse = url || urlPartage();
    var code = svg(adresse);

    var zone = UI.el('div', { class: 'qr-bloc' });

    if (code) {
      zone.appendChild(UI.el('div', { class: 'qr-image', role: 'img', 'aria-label': 'QR code du site', html: code }));
    } else {
      zone.appendChild(UI.el('div', { class: 'qr-image qr-image--vide', text: 'QR indisponible' }));
    }

    var lien = UI.el('input', {
      class: 'input qr-lien',
      type: 'text',
      readonly: true,
      value: adresse,
      'aria-label': 'Adresse du site'
    });

    var bouton = UI.el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      onclick: function () {
        copier(adresse).then(function () {
          if (UI.toast) UI.toast('Adresse copiée.', 'ok');
        }, function () {
          lien.select();
        });
      }
    }, [UI.icon('copy', { size: 15 }), document.createTextNode(' Copier')]);

    zone.appendChild(UI.el('div', { class: 'qr-bas' }, [lien, bouton]));
    zone.appendChild(UI.el('p', {
      class: 'sub qr-legende',
      text: 'Scanne ce code avec l’appareil photo du téléphone pour ouvrir le site et créer un compte.'
    }));

    return zone;
  }

  /* Bouton autonome qui ouvre le QR dans une fenêtre. */
  function bouton(options) {
    var reglages = options || {};
    return UI.el('button', {
      type: 'button',
      class: reglages.class || 'btn btn-ghost btn-sm',
      onclick: function () {
        var modale = UI.modal({
          title: 'Partager ECEM Point',
          sub: 'Le QR est fabriqué sur cet appareil : il marche même sans connexion.',
          eye: 'share',
          body: bloc(reglages.url),
          footer: [
            UI.el('button', {
              type: 'button', class: 'btn btn-primary', text: 'Fermer',
              onclick: function () { modale.close(); }
            })
          ]
        });
      }
    }, [
      UI.icon('share', { size: 15 }),
      document.createTextNode(' ' + (reglages.label || 'QR code'))
    ]);
  }

  function mount(hote, options) {
    if (!hote) return;
    UI.clear(hote);
    hote.appendChild(bloc(options && options.url));
  }

  ECEM.QR = {
    svg: svg,
    bloc: bloc,
    bouton: bouton,
    mount: mount,
    url: urlPartage,
    disponible: disponible
  };
})();
