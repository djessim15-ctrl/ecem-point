/* ============================================================================
 * ECEM Point — utilitaires d'interface
 * ----------------------------------------------------------------------------
 * Petites fonctions partagées par index.html et app.html : échappement HTML,
 * derivation du prénom vers l'identifiant de connexion, bulles de notification,
 * dates en français, et traduction des codes d'erreur renvoyés par Postgres.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = {};

  /* -------------------------------------------------------------------------
   * DOM
   * ---------------------------------------------------------------------- */
  UI.$ = function (sel, root) {
    return (root || document).querySelector(sel);
  };

  UI.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* Crée un élément sans jamais injecter de HTML non maîtrisé. */
  UI.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    var i;

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else node.setAttribute(key, value);
      });
    }

    if (children) {
      var list = Array.isArray(children) ? children : [children];
      for (i = 0; i < list.length; i++) {
        if (list[i] === null || list[i] === undefined) continue;
        node.appendChild(typeof list[i] === 'string' ? document.createTextNode(list[i]) : list[i]);
      }
    }
    return node;
  };

  /* -------------------------------------------------------------------------
   * Texte
   * ---------------------------------------------------------------------- */
  UI.escapeHtml = function (str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* Léa-Marie  ->  lea.marie   (toujours le même résultat : c'est ce qui permet
   * de se reconnecter plus tard avec simplement son prénom). */
  UI.slug = function (prenom) {
    var s = String(prenom || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\.{2,}/g, '.');
    if (!s) s = 'compte';
    if (/^[0-9]/.test(s)) s = 'c.' + s;
    return s;
  };

  /* L'adresse est un identifiant technique : personne ne reçoit de courriel,
   * la confirmation est désactivée côté Supabase. */
  UI.emailFromPrenom = function (prenom) {
    return UI.slug(prenom) + '@ecem-point.fr';
  };

  UI.capitalize = function (str) {
    var s = String(str || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  UI.ROLE_LABELS = {
    eleve: 'Élève',
    suppleant: 'Suppléant',
    delegue: 'Délégué'
  };

  UI.roleLabel = function (role) {
    return UI.ROLE_LABELS[role] || role;
  };

  UI.isStaff = function (role) {
    return role === 'suppleant' || role === 'delegue';
  };

  /* -------------------------------------------------------------------------
   * Dates
   * ---------------------------------------------------------------------- */
  UI.timeAgo = function (iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var diff = Math.round((Date.now() - then) / 1000);

    if (diff < 5) return "à l'instant";
    if (diff < 60) return 'il y a ' + diff + ' s';
    if (diff < 3600) return 'il y a ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'il y a ' + Math.floor(diff / 3600) + ' h';
    if (diff < 86400 * 7) return 'il y a ' + Math.floor(diff / 86400) + ' j';

    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  UI.clockTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var today = new Date();
    var sameDay =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    var opts = sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    return d.toLocaleString('fr-FR', opts);
  };

  /* -------------------------------------------------------------------------
   * Notifications
   * ---------------------------------------------------------------------- */
  UI.toast = function (message, kind) {
    var zone = UI.$('#toast-zone');
    if (!zone) {
      zone = UI.el('div', { id: 'toast-zone', class: 'toast-zone' });
      document.body.appendChild(zone);
    }

    var box = UI.el('div', { class: 'toast toast--' + (kind || 'info'), role: 'status' }, [
      UI.el('span', { text: message })
    ]);
    zone.appendChild(box);

    window.setTimeout(function () {
      box.classList.add('toast--out');
      window.setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 320);
    }, kind === 'error' ? 4200 : 2800);
  };

  UI.ok = function (m) { UI.toast(m, 'ok'); };
  UI.err = function (m) { UI.toast(m, 'error'); };

  /* -------------------------------------------------------------------------
   * Traduction des erreurs
   * ---------------------------------------------------------------------- *
   * Les fonctions SQL lèvent des codes courts (CODE_INVALIDE, PRENOM_PRIS…) ;
   * Supabase Auth renvoie des phrases en anglais. Tout est ramené ici à un
   * message lisible par un élève.
   * ---------------------------------------------------------------------- */
  UI.humanError = function (err) {
    var raw = String((err && (err.message || err.msg)) || err || '').trim();
    var low = raw.toLowerCase();

    var map = {
      NON_CONNECTE: 'Session expirée. Reconnecte-toi.',
      ROLE_INVALIDE: 'Le rôle choisi est inconnu.',
      PRENOM_INVALIDE: 'Prénom refusé : 2 à 24 caractères, lettres, chiffres, espace, tiret ou apostrophe.',
      PRENOM_PRIS: 'Ce prénom est déjà utilisé dans la classe. Ajoute ton initiale de nom si besoin.',
      COMPTE_DEJA_ACTIVE: 'Ce compte est déjà activé. Connecte-toi plutôt.',
      CODE_INVALIDE: "Code refusé : il est incorrect ou il a déjà servi (un code ne fonctionne qu'une fois).",
      MONTANT_INVALIDE: 'Le nombre de points demandé est hors limites.',
      INTERDIT: "Tu n'as pas le droit de faire ça.",
      ELEVE_INTROUVABLE: 'Cet élève n’existe plus dans la liste.',
      CIBLE_INVALIDE: 'Cette cible n’est pas un élève.',
      POINTS_INSUFFISANTS: "Tu n'as pas assez de points pour cet envoi."
    };

    if (map[raw]) return map[raw];

    if (low.indexOf('already registered') >= 0 || low.indexOf('already been registered') >= 0) {
      return 'Ce prénom est déjà utilisé dans la classe.';
    }
    if (low.indexOf('invalid login credentials') >= 0) {
      return 'Prénom ou mot de passe incorrect.';
    }
    if (low.indexOf('password should be at least') >= 0) {
      return 'Le mot de passe doit faire au moins 6 caractères.';
    }
    if (low.indexOf('email rate limit') >= 0 || low.indexOf('rate limit') >= 0) {
      return 'Trop de tentatives. Attends une minute puis réessaie.';
    }
    if (low.indexOf('failed to fetch') >= 0 || low.indexOf('networkerror') >= 0) {
      return 'Connexion internet impossible. Vérifie ton réseau.';
    }
    if (low.indexOf('row level security') >= 0 || low.indexOf('new row violates') >= 0) {
      return "Action refusée par les règles de sécurité.";
    }

    return raw || 'Une erreur est survenue.';
  };

  window.ECEM = window.ECEM || {};
  window.ECEM.UI = UI;
})();
