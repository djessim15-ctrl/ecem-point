/* ============================================================================
 * ECEM Point — état de la base de données
 * ----------------------------------------------------------------------------
 * Un site statique ne peut pas deviner pourquoi une requête échoue : « Failed
 * to fetch » veut aussi bien dire « pas de Wi-Fi » que « projet Supabase en
 * pause ». Ce module pose UNE question simple au serveur (une lecture dans
 * app_settings) et en déduit un diagnostic lisible :
 *
 *   ok          la base répond et les tables existent
 *   offline     le navigateur se croit hors ligne
 *   noconfig    URL ou clé absente de config.js
 *   unreachable aucune réponse (projet en pause, supprimé, réseau bloqué)
 *   bad-key     le projet répond mais refuse la clé « anon »
 *   schema      le projet répond mais les tables du site n'existent pas
 *   http        réponse inattendue (5xx, 404…)
 *
 * Le résultat est mis en cache quelques secondes et exposé sur
 * window.ECEM.Health pour que la page de connexion et l'application affichent
 * le bon message, avec le bon bouton (réactiver, diagnostic, démo).
 * ==========================================================================*/
(function () {
  'use strict';

  var cfg = window.ECEM_CONFIG || {};
  var BASE = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = String(cfg.SUPABASE_ANON_KEY || '');
  var match = BASE.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i);
  var REF = match ? match[1] : '';

  var CACHE_KEY = 'ecem-health';
  var TTL = 45 * 1000;
  var TIMEOUT = 9000;

  var LABELS = {
    ok: 'Base de données joignable',
    offline: 'Navigateur hors ligne',
    noconfig: 'Configuration incomplète',
    unreachable: 'Serveur injoignable',
    'bad-key': 'Clé refusée',
    schema: 'Tables absentes',
    http: 'Réponse anormale'
  };

  /* Textes affichés dans l'interface (français, sans jargon). */
  var MESSAGES = {
    offline: {
      title: 'Tu es hors ligne',
      text: 'Le site ne peut pas joindre la base de données. Vérifie le Wi-Fi ou le partage de connexion, puis réessaie.'
    },
    noconfig: {
      title: 'Configuration incomplète',
      text: 'L’adresse et la clé du projet Supabase manquent dans assets/js/config.js.'
    },
    unreachable: {
      title: 'La base de données ne répond pas',
      text: 'Le projet Supabase est sans doute en pause — les projets gratuits se mettent en pause après une semaine sans activité — ou son adresse a changé. Les comptes et les points sont conservés : il suffit de réactiver le projet, puis de recharger la page.'
    },
    'bad-key': {
      title: 'Clé d’accès refusée',
      text: 'Le projet répond mais refuse la clé publique du site. Elle a peut-être été régénérée dans Supabase : il faut la remettre dans assets/js/config.js.'
    },
    schema: {
      title: 'Base de données vide',
      text: 'Le projet répond mais les tables du site sont absentes. Les fichiers SQL de supabase/migrations doivent être joués sur ce projet.'
    },
    http: {
      title: 'La base de données répond mal',
      text: 'Le serveur a renvoyé une réponse inattendue. Réessaie dans un instant ; si cela persiste, ouvre le diagnostic ci-dessous.'
    }
  };

  var state = { status: 'unknown', http: 0, detail: '', checkedAt: 0, ms: 0 };
  var listeners = [];

  function store(fresh) {
    try {
      if (fresh) window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
      else window.sessionStorage.removeItem(CACHE_KEY);
    } catch (e) {}
  }

  function restore() {
    try {
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.checkedAt) return null;
      if (Date.now() - parsed.checkedAt > TTL) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function settle(status, http, detail, ms) {
    state = {
      status: status,
      http: http || 0,
      detail: detail || '',
      ms: ms || 0,
      checkedAt: Date.now()
    };
    if (status === 'ok') store(null);
    else store(state);

    listeners.slice().forEach(function (fn) {
      try { fn(state); } catch (e) {}
    });
    return state;
  }

  function timedFetch(url, options, ms) {
    return new Promise(function (resolve, reject) {
      var controller = null;
      var timer = null;
      var opts = Object.assign({}, options || {});

      if (typeof window.AbortController === 'function') {
        controller = new window.AbortController();
        opts.signal = controller.signal;
      }

      timer = window.setTimeout(function () {
        if (controller) {
          try { controller.abort(); } catch (e) {}
        }
        reject(new Error('TIMEOUT'));
      }, ms || TIMEOUT);

      window
        .fetch(url, opts)
        .then(function (response) {
          window.clearTimeout(timer);
          resolve(response);
        })
        .catch(function (error) {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  function check(force) {
    if (!force) {
      if (state.status !== 'unknown' && Date.now() - state.checkedAt < TTL) {
        return Promise.resolve(state);
      }
      var cached = restore();
      if (cached) {
        state = cached;
        return Promise.resolve(state);
      }
    }

    if (!BASE || !KEY) return Promise.resolve(settle('noconfig', 0, '', 0));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve(settle('offline', 0, '', 0));
    }

    var started = Date.now();
    var url = BASE + '/rest/v1/app_settings?select=*&limit=1';

    return timedFetch(
      url,
      {
        method: 'GET',
        cache: 'no-store',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
      },
      TIMEOUT
    )
      .then(function (response) {
        var elapsed = Date.now() - started;

        if (response.status === 401 || response.status === 403) {
          return settle('bad-key', response.status, '', elapsed);
        }
        if (!response.ok) {
          return response.text().then(function (body) {
            var code = '';
            try { code = (JSON.parse(body) || {}).code || ''; } catch (e) {}
            if (code === '42P01' || code === 'PGRST205') {
              return settle('schema', response.status, code, elapsed);
            }
            return settle('http', response.status, code || String(body || '').slice(0, 120), elapsed);
          });
        }

        return response.text().then(function (body) {
          var payload = null;
          try { payload = JSON.parse(body); } catch (e) {}
          if (Array.isArray(payload)) return settle('ok', response.status, '', elapsed);

          var code = (payload && payload.code) || '';
          if (code === '42P01' || code === 'PGRST205') {
            return settle('schema', response.status, code, elapsed);
          }
          return settle('http', response.status, code || 'réponse illisible', elapsed);
        });
      })
      .catch(function (error) {
        var elapsed = Date.now() - started;
        var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        var message = String((error && error.message) || '');

        if (offline) return settle('offline', 0, message, elapsed);
        return settle('unreachable', 0, message, elapsed);
      });
  }

  function message(status) {
    return MESSAGES[status] || MESSAGES.http;
  }

  function dashboardUrl() {
    return REF
      ? 'https://supabase.com/dashboard/project/' + REF
      : 'https://supabase.com/dashboard';
  }

  /* Explication d'une erreur de requête, enrichie par le diagnostic. */
  function explain(error) {
    var low = String((error && (error.message || error.msg)) || error || '').toLowerCase();
    var network =
      low.indexOf('failed to fetch') >= 0 ||
      low.indexOf('networkerror') >= 0 ||
      low.indexOf('network request failed') >= 0 ||
      low.indexOf('load failed') >= 0;
    var timeout = low.indexOf('timeout') >= 0 || low.indexOf('aborted') >= 0;

    if (!network && !timeout) return '';

    if (state.status === 'offline') {
      return 'Tu es hors ligne : le site ne peut pas joindre la base de données. Vérifie ta connexion puis réessaie.';
    }
    if (state.status === 'unreachable') {
      return MESSAGES.unreachable.title + '. ' + MESSAGES.unreachable.text;
    }
    if (state.status === 'bad-key') {
      return MESSAGES['bad-key'].title + '. ' + MESSAGES['bad-key'].text;
    }
    return (
      'Impossible de joindre la base de données pour le moment. ' +
      'Vérifie ta connexion, puis ouvre le diagnostic si le problème persiste.'
    );
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (item) { return item !== fn; });
    };
  }

  /* -------------------------------------------------------------------------
   * Bandeau d'alerte + fenêtre de diagnostic (construits à la demande, quand
   * UI est déjà chargé)
   * ---------------------------------------------------------------------- */
  function maskKey() {
    if (!KEY) return 'absente';
    return KEY.slice(0, 10) + '…' + KEY.slice(-4);
  }

  function renderNotice(node, opts) {
    var UI = window.ECEM && window.ECEM.UI;
    if (!UI || !node) return;

    opts = opts || {};
    UI.clear(node);

    var status = state.status === 'unknown' ? 'unreachable' : state.status;
    if (status === 'ok') {
      node.classList.add('is-hidden');
      return null;
    }

    var info = message(status);
    var actions = UI.el('div', { class: 'alert-actions' });

    if (status === 'unreachable' || status === 'bad-key' || status === 'schema') {
      actions.appendChild(
        UI.el('a', {
          class: 'btn btn-sm btn-soft', href: dashboardUrl(),
          target: '_blank', rel: 'noopener'
        }, [UI.icon('arrow-up-right', { size: 15 }), UI.el('span', { text: 'Ouvrir Supabase' })])
      );
    }

    actions.appendChild(
      UI.el('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', text: 'Diagnostic',
        onclick: function () { diagnose(); }
      })
    );

    if (opts.demo !== false) {
      actions.appendChild(
        UI.el('a', { class: 'btn btn-sm btn-ghost', href: 'app.html?demo=1' },
          [UI.el('span', { text: 'Voir la démo' })])
      );
    }

    var box = UI.el('div', { class: 'alert alert--warn' }, [
      UI.icon('alert', { size: 18, class: 'ico' }),
      UI.el('div', { class: 'alert-body' }, [
        UI.el('strong', { class: 'alert-title', text: info.title }),
        UI.el('span', { class: 'alert-text', text: info.text }),
        actions
      ])
    ]);

    node.appendChild(box);
    node.classList.remove('is-hidden');
    return box;
  }

  function diagnose() {
    var UI = window.ECEM && window.ECEM.UI;
    if (!UI) return;

    check(true).then(function (fresh) {
      var info = message(fresh.status);

      function row(label, value, tone) {
        return UI.el('div', { class: 'diag-row' }, [
          UI.el('span', { class: 'diag-key', text: label }),
          UI.el('span', { class: 'diag-val' + (tone ? ' is-' + tone : ''), text: value })
        ]);
      }

      var body = UI.el('div', {}, [
        UI.el('div', { class: 'diag' }, [
          row('Résultat', label(fresh.status) + (fresh.http ? ' (HTTP ' + fresh.http + ')' : ''),
            fresh.status === 'ok' ? 'ok' : 'bad'),
          row('Adresse testée', (BASE || 'non renseignée').replace(/^https?:\/\//, '')),
          row('Clé publique', maskKey()),
          row('Navigateur', typeof navigator !== 'undefined' && navigator.onLine === false ? 'hors ligne' : 'en ligne',
            typeof navigator !== 'undefined' && navigator.onLine === false ? 'bad' : 'ok'),
          row('Latence', fresh.ms ? fresh.ms + ' ms' : '—'),
          row('Version du site', (cfg.APP_VERSION || '2.0') + ' · ' + (REF || 'projet inconnu'))
        ]),
        UI.el('p', { class: 'diag-text', text: info.text }),
        fresh.status === 'unreachable' || fresh.status === 'bad-key' || fresh.status === 'schema'
          ? UI.el('ol', { class: 'diag-steps' }, [
              UI.el('li', { text: 'Ouvre le tableau de bord Supabase du projet (bouton ci-dessous).' }),
              UI.el('li', { text: 'S’il est en pause, clique sur « Restore project » / « Restaurer ».' }),
              UI.el('li', { text: 'Reviens ici et clique sur « Réessayer » : les comptes et les points sont intacts.' })
            ])
          : null
      ]);

      var modal = UI.modal({
        title: 'Diagnostic de la connexion',
        sub: 'Pourquoi le site ne joint pas la base de données',
        eye: 'wifi',
        body: body,
        footer: [
          UI.el('a', {
            class: 'btn btn-ghost', href: dashboardUrl(),
            target: '_blank', rel: 'noopener'
          }, [UI.icon('arrow-up-right', { size: 16 }), UI.el('span', { text: 'Ouvrir Supabase' })]),
          UI.el('button', {
            type: 'button', class: 'btn btn-soft', text: 'Réessayer',
            onclick: function () { modal.close(); diagnose(); }
          }),
          UI.el('button', {
            type: 'button', class: 'btn btn-primary', text: 'Fermer',
            onclick: function () { modal.close(); }
          })
        ]
      });
    });
  }

  window.ECEM = window.ECEM || {};
  window.ECEM.Health = {
    check: check,
    explain: explain,
    onChange: onChange,
    label: function (status) { return LABELS[status] || LABELS.http; },
    message: message,
    dashboardUrl: dashboardUrl,
    projectRef: function () { return REF; },
    baseUrl: function () { return BASE; },
    state: function () { return state; },
    isDown: function () {
      return state.status !== 'ok' && state.status !== 'unknown';
    },
    diagnose: diagnose,
    renderNotice: renderNotice
  };
})();
