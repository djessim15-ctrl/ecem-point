/* ============================================================================
 * ECEM Point — utilitaires d'interface
 * ----------------------------------------------------------------------------
 * Tout ce qui est partagé entre la page de connexion, l'application et les
 * modules graphiques : création de DOM sans innerHTML dangereux, formatage des
 * nombres et des dates en français, bulles de notification, fenêtres modales,
 * avatars colorés, export CSV…
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
        else if (key === 'html') node.innerHTML = value; /* réservé au code interne */
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      });
    }

    if (children) {
      var list = Array.isArray(children) ? children : [children];
      for (i = 0; i < list.length; i++) {
        if (list[i] === null || list[i] === undefined || list[i] === false) continue;
        node.appendChild(typeof list[i] === 'string' ? document.createTextNode(list[i]) : list[i]);
      }
    }
    return node;
  };

  /* Icône SVG (voir icons.js). */
  UI.icon = function (name, opts) {
    return window.ECEM.Icon ? window.ECEM.Icon(name, opts) : UI.el('span');
  };

  UI.iconHTML = function (name, size, cls) {
    return window.ECEM.iconHTML ? window.ECEM.iconHTML(name, size, cls) : '';
  };

  UI.frag = function (children) {
    var frag = document.createDocumentFragment();
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child) frag.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return frag;
  };

  UI.clear = function (node) {
    if (node) while (node.firstChild) node.removeChild(node.firstChild);
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

  /* « Inès » -> « ines » : recherche insensible aux accents et à la casse. */
  UI.normalize = function (str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  UI.capitalize = function (str) {
    var s = String(str || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  UI.initials = function (prenom) {
    var parts = String(prenom || '')
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  /* Une teinte stable par prénom : les avatars ne changent jamais de couleur. */
  UI.hueOf = function (str) {
    var hash = 0;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 360;
    return hash;
  };

  /* Dégradés choisis à la main : lisibles en clair comme en sombre. */
  var AVATAR_GRADIENTS = [
    ['#c4b5fd', '#8b5cf6'],
    ['#a5b4fc', '#6366f1'],
    ['#93c5fd', '#3b82f6'],
    ['#99f6e4', '#14b8a6'],
    ['#fbcfe8', '#ec4899'],
    ['#fde68a', '#f59e0b'],
    ['#f5d0fe', '#c026d3'],
    ['#bbf7d0', '#10b981']
  ];

  UI.avatar = function (prenom, opts) {
    opts = opts || {};
    var pair = AVATAR_GRADIENTS[UI.hueOf(prenom) % AVATAR_GRADIENTS.length];
    var node = UI.el('span', {
      class: 'avatar' + (opts.class ? ' ' + opts.class : ''),
      style: {
        background: 'linear-gradient(140deg, ' + pair[0] + ', ' + pair[1] + ')'
      },
      'aria-hidden': opts.decorative === false ? null : 'true'
    }, [UI.initials(prenom)]);
    if (opts.size) {
      node.style.width = opts.size + 'px';
      node.style.height = opts.size + 'px';
      node.style.fontSize = Math.max(11, Math.round(opts.size * 0.36)) + 'px';
    }
    return node;
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

  UI.plural = function (n, one, many) {
    return n + ' ' + (n > 1 ? (many || one + 's') : one);
  };

  UI.pointsLabel = function (n) {
    return UI.plural(n, 'point');
  };

  /* -------------------------------------------------------------------------
   * Nombres
   * ---------------------------------------------------------------------- */
  UI.fmt = function (n) {
    var v = Number(n) || 0;
    return v.toLocaleString('fr-FR');
  };

  UI.fmtSigned = function (n) {
    var v = Number(n) || 0;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('fr-FR');
  };

  UI.pct = function (part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  };

  UI.clamp = function (n, min, max) {
    return Math.min(max, Math.max(min, n));
  };

  /* -------------------------------------------------------------------------
   * Dates
   * ---------------------------------------------------------------------- */
  UI.timeAgo = function (iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var diff = Math.round((Date.now() - then) / 1000);

    if (diff < 10) return "à l'instant";
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

  UI.sameDay = function (a, b) {
    var d1 = new Date(a);
    var d2 = new Date(b);
    return d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();
  };

  /* « Aujourd'hui », « Hier », « lundi 3 novembre » */
  UI.dayLabel = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (UI.sameDay(d, now)) return "Aujourd'hui";
    var yesterday = new Date(now.getTime() - 86400000);
    if (UI.sameDay(d, yesterday)) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  UI.dayKey = function (iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  };

  UI.monthYear = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  /* -------------------------------------------------------------------------
   * Notifications (toasts)
   * ---------------------------------------------------------------------- */
  UI.toast = function (message, kind, opts) {
    kind = kind || 'info';
    opts = opts || {};
    var zone = UI.$('#toast-zone');
    if (!zone) {
      zone = UI.el('div', { id: 'toast-zone', class: 'toast-zone', role: 'region', 'aria-live': 'polite' });
      document.body.appendChild(zone);
    }

    var icons = { ok: 'check-circle', error: 'alert', info: 'info', star: 'sparkles' };
    var box = UI.el('div', { class: 'toast toast--' + kind, role: 'status' }, [
      UI.el('span', { class: 'toast-ico' }, [UI.icon(icons[kind] || 'info', { size: 18 })]),
      UI.el('span', { class: 'toast-msg', text: message }),
      UI.el('button', {
        type: 'button', class: 'toast-close', 'aria-label': 'Fermer la notification',
        onclick: function () { dismiss(); }
      }, [UI.icon('x', { size: 14 })])
    ]);

    var gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      box.classList.add('is-out');
      window.setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 260);
    }

    zone.appendChild(box);
    window.setTimeout(dismiss, opts.duration || (kind === 'error' ? 5200 : 3400));
    return box;
  };

  UI.ok = function (m, o) { return UI.toast(m, 'ok', o); };
  UI.err = function (m, o) { return UI.toast(m, 'error', o); };
  UI.info = function (m, o) { return UI.toast(m, 'info', o); };

  /* -------------------------------------------------------------------------
   * Fenêtres modales (avec piège à focus + fermeture Échap)
   * ---------------------------------------------------------------------- */
  var openModals = [];

  UI.modal = function (opts) {
    opts = opts || {};
    var root = UI.$('#modal-root') || document.body;
    var previousFocus = document.activeElement;

    var panel = UI.el('div', {
      class: 'modal-panel' + (opts.class ? ' ' + opts.class : ''),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.title || 'Fenêtre'
    });

    var closeBtn = UI.el('button', {
      type: 'button', class: 'icon-btn modal-close', 'aria-label': 'Fermer',
      onclick: function () { close(); }
    }, [UI.icon('x', { size: 18 })]);

    panel.appendChild(closeBtn);
    if (opts.title) {
      panel.appendChild(UI.el('div', { class: 'modal-head' }, [
        opts.eye ? UI.el('div', { class: 'modal-ico' }, [UI.icon(opts.eye, { size: 20 })]) : null,
        UI.el('div', {}, [
          UI.el('h2', { class: 'modal-title', text: opts.title }),
          opts.sub ? UI.el('p', { class: 'modal-sub', text: opts.sub }) : null
        ])
      ]));
    }
    if (opts.body) panel.appendChild(opts.body);
    if (opts.footer) panel.appendChild(UI.el('div', { class: 'modal-foot' }, opts.footer));

    var backdrop = UI.el('div', { class: 'modal-backdrop' }, [panel]);
    backdrop.addEventListener('mousedown', function (event) {
      if (event.target === backdrop && opts.dismissible !== false) close();
    });

    root.appendChild(backdrop);
    document.body.classList.add('has-modal');

    var onKey = function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') trapFocus(event, panel);
    };
    document.addEventListener('keydown', onKey);
    openModals.push(close);

    window.setTimeout(function () {
      backdrop.classList.add('is-in');
      var target = panel.querySelector('[autofocus], input, textarea, button:not(.modal-close)');
      if (target) {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
      }
    }, 10);

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.classList.remove('is-in');
      var idx = openModals.indexOf(close);
      if (idx >= 0) openModals.splice(idx, 1);
      window.setTimeout(function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (!openModals.length) document.body.classList.remove('has-modal');
      }, 180);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus({ preventScroll: true }); } catch (e) {}
      }
      if (opts.onClose) opts.onClose();
    }

    return { close: close, panel: panel, backdrop: backdrop };
  };

  function trapFocus(event, container) {
    var focusable = UI.$$(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      container
    ).filter(function (node) { return node.offsetParent !== null || node === document.activeElement; });

    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  UI.confirm = function (opts) {
    return new Promise(function (resolve) {
      var done = false;
      var body = UI.el('div', { class: 'modal-text' }, [
        UI.el('p', { text: opts.message }),
        opts.detail ? UI.el('p', { class: 'sub', text: opts.detail }) : null
      ]);
      var modal = UI.modal({
        title: opts.title || 'Confirmer',
        eye: opts.eye || 'alert',
        body: body,
        dismissible: true,
        onClose: function () { if (!done) resolve(false); },
        footer: [
          UI.el('button', {
            type: 'button', class: 'btn btn-soft', text: opts.cancel || 'Annuler',
            onclick: function () { resolve(false); done = true; modal.close(); }
          }),
          UI.el('button', {
            type: 'button', class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
            text: opts.confirm || 'Confirmer',
            onclick: function () { resolve(true); done = true; modal.close(); }
          })
        ]
      });
    });
  };

  /* -------------------------------------------------------------------------
   * Divers
   * ---------------------------------------------------------------------- */
  UI.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { fn.apply(self, args); }, wait || 180);
    };
  };

  UI.copy = function (text, okMessage) {
    function fallback() {
      var area = UI.el('textarea', { style: { position: 'fixed', opacity: '0' } });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(area);
      UI.ok(okMessage || 'Copié dans le presse-papiers.');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        UI.ok(okMessage || 'Copié dans le presse-papiers.');
      }).catch(fallback);
    } else {
      fallback();
    }
  };

  UI.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = UI.el('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  UI.csv = function (rows) {
    return rows.map(function (row) {
      return row.map(function (cell) {
        var value = String(cell === null || cell === undefined ? '' : cell);
        return /[";\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      }).join(';');
    }).join('\r\n');
  };

  UI.sleep = function (ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  };

  /* -------------------------------------------------------------------------
   * Traduction des erreurs
   * ---------------------------------------------------------------------- *
   * Les fonctions SQL lèvent des codes courts (CODE_INVALIDE, PRENOM_PRIS…) ;
   * Supabase Auth renvoie des phrases en anglais. Tout est ramené ici à un
   * message lisible par un élève.
   * ---------------------------------------------------------------------- */
  UI.humanError = function (err) {
    var raw = String((err && (err.message || err.msg || err.error_description)) || err || '').trim();
    var low = raw.toLowerCase();

    var map = {
      NON_CONNECTE: 'Session expirée. Reconnecte-toi.',
      ROLE_INVALIDE: 'Le rôle choisi est inconnu.',
      PRENOM_INVALIDE: 'Prénom refusé : 2 à 24 caractères, lettres, chiffres, espace, tiret ou apostrophe.',
      PRENOM_PRIS: 'Ce prénom est déjà utilisé dans la classe. Ajoute ton initiale de nom si besoin.',
      COMPTE_DEJA_ACTIVE: 'Ce compte est déjà activé. Connecte-toi plutôt.',
      CODE_INVALIDE: 'Code refusé. Vérifie qu’il est recopié exactement (majuscules et tirets compris).',
      CODE_DEJA_UTILISE: 'Ce code a déjà créé un compte. Connecte-toi plutôt avec ton prénom et ce code comme mot de passe, ou utilise un autre code.',
      CODE_MAUVAIS_ROLE: 'Ce code n’est pas celui du rôle coché. Vérifie la case Élève / Suppléant / Délégué, ou demande le bon code.',
      MONTANT_INVALIDE: 'Le nombre de points demandé est hors limites.',
      INTERDIT: 'Tu n’as pas le droit de faire ça.',
      ELEVE_INTROUVABLE: 'Cet élève n’existe plus dans la liste.',
      CIBLE_INVALIDE: 'Cette personne ne peut pas recevoir de points.',
      POINTS_INSUFFISANTS: 'Tu n’as pas assez de points pour cet envoi.',
      SELF_TRANSFER: 'Tu ne peux pas t’envoyer des points à toi-même.'
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
    if (low.indexOf('auth session missing') >= 0 || low.indexOf('jwt expired') >= 0) {
      return 'Session expirée. Reconnecte-toi.';
    }
    if (low.indexOf('email rate limit') >= 0 || low.indexOf('rate limit') >= 0) {
      return 'Trop de tentatives. Attends une minute puis réessaie.';
    }
    if (low.indexOf('failed to fetch') >= 0 || low.indexOf('networkerror') >= 0 || low.indexOf('network request failed') >= 0) {
      return 'Connexion impossible. Vérifie ton réseau puis réessaie.';
    }
    if (low.indexOf('row level security') >= 0 || low.indexOf('new row violates') >= 0) {
      return 'Action refusée par les règles de sécurité.';
    }
    if (low.indexOf('weak') >= 0 && low.indexOf('password') >= 0) {
      return 'Mot de passe trop faible : choisis-en un plus long.';
    }

    return raw || 'Une erreur est survenue.';
  };

  window.ECEM = window.ECEM || {};
  window.ECEM.UI = UI;
})();
