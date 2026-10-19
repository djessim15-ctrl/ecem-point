/* ============================================================================
 * ECEM Point — application (app.html)
 * ----------------------------------------------------------------------------
 * Une seule page, des onglets calculés selon le rôle du compte connecté :
 *
 *   élève      -> Accueil · Envoyer · Classement · Mon historique
 *   suppléant  -> Accueil · Donner/retirer* · Classement · Historique · Tchat
 *   délégué    -> Accueil · Donner/retirer · Classement · Historique · Tchat
 *
 *   (*) les boutons restent grisés tant que le réglage suppleant_can_award
 *       vaut false dans la table app_settings.
 *
 * Aucune écriture directe en base : chaque action passe par une fonction SQL
 * (award_points, remove_points, transfer_points) qui vérifie les droits.
 * Les mises à jour arrivent ensuite toutes seules via Supabase Realtime.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM.UI;
  var sb = window.ECEM.sb;
  var cfg = window.ECEM.cfg;
  if (!sb || !UI) return;

  /* ---------------------------------------------------------------------- */
  /* État                                                                    */
  /* ---------------------------------------------------------------------- */
  var state = {
    me: null,
    settings: {
      suppleant_can_award: false,
      award_min: 1,
      award_max: 4,
      transfer_min: 1,
      online_window_seconds: 90
    },
    profiles: [],
    events: [],
    messages: [],
    byId: {},
    tab: 'home',
    historyKind: 'all',
    channel: null,
    heartbeatTimer: null,
    refreshTimer: null,
    structureChanged: false,
    ready: false
  };

  var TABS = {
    eleve: [
      { id: 'home',    label: 'Accueil',          view: 'view-home' },
      { id: 'send',    label: 'Envoyer des points', view: 'view-send' },
      { id: 'rank',    label: 'Classement',       view: 'view-rank' },
      { id: 'history', label: 'Mon historique',   view: 'view-history' }
    ],
    staff: [
      { id: 'home',    label: 'Accueil',            view: 'view-home' },
      { id: 'give',    label: 'Donner / retirer',   view: 'view-give' },
      { id: 'rank',    label: 'Classement',         view: 'view-rank' },
      { id: 'history', label: 'Historique classe',  view: 'view-history' },
      { id: 'chat',    label: 'Tchat',              view: 'view-chat' }
    ]
  };

  var dom = {};

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                               */
  /* ---------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    dom = {
      boot: UI.$('#boot'),
      bootText: UI.$('#boot-text'),
      main: UI.$('#app-main'),
      footer: UI.$('#app-footer'),
      footerStats: UI.$('#footer-stats'),
      footerLive: UI.$('#footer-live'),
      tabbar: UI.$('#tabbar'),
      mePrenom: UI.$('#me-prenom'),
      meRole: UI.$('#me-role'),
      mePoints: UI.$('#me-points'),
      mePointsValue: UI.$('#me-points-value'),
      mePresence: UI.$('#me-presence'),
      btnLogout: UI.$('#btn-logout')
    };

    dom.btnLogout.addEventListener('click', logout);

    sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return goToLogin('Connecte-toi pour accéder à la classe.');

      bootText('Ouverture de ton compte…');
      return loadProfile(session.user.id);
    }).catch(function (err) {
      fatal(UI.humanError(err));
    });
  });

  function bootText(text) {
    if (dom.bootText) dom.bootText.textContent = text;
  }

  function fatal(message) {
    dom.boot.classList.remove('is-hidden');
    dom.boot.innerHTML =
      '<div class="card" style="max-width:520px;text-align:left">' +
      '<h2 style="margin-bottom:8px">Impossible d’ouvrir la classe</h2>' +
      '<p class="sub">' + UI.escapeHtml(message) + '</p>' +
      '<button type="button" class="btn btn-primary" style="margin-top:16px" ' +
      'onclick="location.href=\'index.html\'">Retour à la connexion</button></div>';
  }

  function goToLogin(message) {
    if (message) {
      try { window.sessionStorage.setItem('ecem-flash', message); } catch (e) {}
    }
    window.location.replace('index.html');
  }

  /* Charge le profil du compte connecté, puis tout le reste. */
  function loadProfile(userId) {
    return sb
      .from('profiles')
      .select('id, prenom, role, points, last_seen_at, created_at')
      .eq('id', userId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;

        if (!res.data) {
          /* Session valide mais profil absent : inscription jamais terminée. */
          return sb.auth.signOut().then(function () {
            goToLogin('Ton compte n’est pas activé. Réinscris-toi pour le terminer.');
          });
        }

        state.me = res.data;
        rebuildIndex();
        paintIdentity();

        bootText('Chargement de la classe…');
        return Promise.all([loadSettings(), loadProfiles(), loadEvents(), loadMessages()])
          .then(function () {
            state.ready = true;
            dom.boot.classList.add('is-hidden');
            dom.main.classList.remove('is-hidden');
            dom.footer.hidden = false;

            buildTabs();
            showTab(firstTab());
            startHeartbeat();
            startRealtime();
            startAutoRefresh();
            bindGlobalControls();
            showFlash();
          });
      });
  }

  function showFlash() {
    var msg = null;
    try {
      msg = window.sessionStorage.getItem('ecem-flash');
      window.sessionStorage.removeItem('ecem-flash');
    } catch (e) {}
    if (msg) UI.toast(msg, 'info');
  }

  function rebuildIndex() {
    state.byId = {};
    state.profiles.forEach(function (p) { state.byId[p.id] = p; });
  }

  function paintIdentity() {
    dom.mePrenom.textContent = state.me.prenom;
    dom.meRole.textContent = UI.roleLabel(state.me.role);
    dom.meRole.className = 'badge badge--' + state.me.role;
    dom.mePoints.hidden = !isEleve();
    dom.mePointsValue.textContent = state.me.points;
    dom.mePresence.querySelector('.dot').classList.add('is-online');
  }

  function isEleve() { return state.me && state.me.role === 'eleve'; }
  function isStaff() { return state.me && UI.isStaff(state.me.role); }
  function canAward() {
    if (!state.me) return false;
    if (state.me.role === 'delegue') return true;
    if (state.me.role === 'suppleant') return !!state.settings.suppleant_can_award;
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement des données                                                  */
  /* ---------------------------------------------------------------------- */
  function loadSettings() {
    return sb.from('app_settings').select('*').eq('id', 1).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      if (res.data) state.settings = Object.assign(state.settings, res.data);
      return state.settings;
    });
  }

  function loadProfiles() {
    return sb
      .from('profiles')
      .select('id, prenom, role, points, last_seen_at, created_at')
      .order('prenom', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        state.profiles = res.data || [];
        rebuildIndex();
        if (state.me && state.byId[state.me.id]) {
          state.me = Object.assign(state.me, state.byId[state.me.id]);
        }
        return state.profiles;
      });
  }

  function loadEvents() {
    /* La RLS filtre déjà : un élève ne reçoit que ce qui le concerne. */
    return sb
      .from('point_events')
      .select('id, kind, amount, subject_id, counterparty_id, actor_id, note, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(function (res) {
        if (res.error) throw res.error;
        state.events = res.data || [];
        return state.events;
      });
  }

  function loadMessages() {
    if (!isStaff()) { state.messages = []; return Promise.resolve([]); }
    return sb
      .from('staff_messages')
      .select('id, author_id, body, created_at')
      .order('created_at', { ascending: true })
      .limit(300)
      .then(function (res) {
        if (res.error) throw res.error;
        state.messages = res.data || [];
        return state.messages;
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Onglets                                                                 */
  /* ---------------------------------------------------------------------- */
  function tabsFor() { return isEleve() ? TABS.eleve : TABS.staff; }
  function firstTab() { return 'home'; }

  function buildTabs() {
    dom.tabbar.innerHTML = '';
    tabsFor().forEach(function (tab) {
      var btn = UI.el('button', {
        type: 'button',
        text: tab.label,
        dataset: { tab: tab.id },
        role: 'tab',
        onclick: function () { showTab(tab.id); }
      });
      dom.tabbar.appendChild(btn);
    });
  }

  function showTab(id) {
    var allowed = tabsFor().some(function (t) { return t.id === id; });
    if (!allowed) id = 'home';
    state.tab = id;

    UI.$$('#tabbar button').forEach(function (b) {
      var active = b.dataset.tab === id;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    tabsFor().forEach(function (t) {
      var section = document.getElementById(t.view);
      if (!section) return;
      var on = t.id === id;
      section.hidden = !on;
    });

    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderCurrentView() {
    switch (state.tab) {
      case 'home':    renderHome(); break;
      case 'give':    renderGive(); break;
      case 'send':    renderSend(); break;
      case 'rank':    renderRank(); break;
      case 'history': renderHistory(); break;
      case 'chat':    renderChat(); break;
    }
    renderFooter();
  }

  /* ---------------------------------------------------------------------- */
  /* Petits calculateurs                                                     */
  /* ---------------------------------------------------------------------- */
  function onlineWindow() {
    return (state.settings.online_window_seconds || 90) * 1000;
  }

  function isOnline(profile) {
    if (!profile || !profile.last_seen_at) return false;
    return Date.now() - new Date(profile.last_seen_at).getTime() < onlineWindow();
  }

  function students() {
    return state.profiles.filter(function (p) { return p.role === 'eleve'; });
  }

  function nameOf(id) {
    var p = state.byId[id];
    return p ? p.prenom : 'un compte supprimé';
  }

  function totalPoints() {
    return students().reduce(function (sum, p) { return sum + (p.points || 0); }, 0);
  }

  function initials(prenom) {
    var parts = String(prenom || '').trim().split(/[\s-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /* ---------------------------------------------------------------------- */
  /* ACCUEIL                                                                 */
  /* ---------------------------------------------------------------------- */
  function renderHome() {
    var host = UI.$('#home-content');
    host.innerHTML = '';
    host.appendChild(isEleve() ? homeEleve() : homeStaff());
  }

  function homeEleve() {
    var wrap = UI.el('div', { class: 'home-grid' });
    var rank = rankOf(state.me.id);

    var hero = UI.el('div', { class: 'card hero-card' }, [
      UI.el('h3', { text: 'Tes points' }),
      UI.el('div', { class: 'hero-score', text: String(state.me.points) }),
      UI.el('p', {
        class: 'hero-sub',
        text: rank
          ? 'Tu es ' + rank + (rank === 1 ? 'er' : 'e') + ' sur ' + students().length +
            ' élève' + (students().length > 1 ? 's' : '') + ' · ' +
            (isOnline(state.me) ? 'tu es connecté·e' : 'tu apparais hors ligne')
          : 'Bienvenue dans la classe.'
      }),
      UI.el('div', { class: 'hero-actions' }, [
        UI.el('button', {
          type: 'button', class: 'btn btn--solid', text: '🔁 Envoyer des points',
          onclick: function () { showTab('send'); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn', text: '🏆 Classement',
          onclick: function () { showTab('rank'); }
        })
      ])
    ]);
    wrap.appendChild(hero);

    /* Derniers mouvements qui me concernent. */
    var mine = state.events.slice(0, 6);
    var panel = UI.el('div', { class: 'card' });
    panel.appendChild(UI.el('div', { class: 'panel-title' }, [
      UI.el('span', { text: 'Activité récente' }),
      UI.el('button', { type: 'button', class: 'link', text: 'Tout voir', onclick: function () { showTab('history'); } })
    ]));
    if (!mine.length) {
      panel.appendChild(UI.el('p', { class: 'sub', text: 'Aucun mouvement pour le moment. Les délégués n’ont pas encore distribué de points.' }));
    } else {
      var ul = UI.el('ul', { class: 'event-list' });
      mine.forEach(function (ev) { ul.appendChild(eventRow(ev)); });
      panel.appendChild(ul);
    }
    wrap.appendChild(panel);

    /* Top 3 de la classe. */
    wrap.appendChild(topPanel());
    return wrap;
  }

  function homeStaff() {
    var wrap = UI.el('div', { class: 'home-grid' });
    var eleves = students();
    var enLigne = eleves.filter(isOnline).length;
    var encadrement = state.profiles.filter(function (p) { return UI.isStaff(p.role); });

    var hero = UI.el('div', { class: 'card hero-card' }, [
      UI.el('h3', { text: 'Bonjour ' + state.me.prenom }),
      UI.el('div', { class: 'hero-score', text: String(enLigne) }),
      UI.el('p', {
        class: 'hero-sub',
        text: 'élève' + (enLigne > 1 ? 's' : '') + ' connecté' + (enLigne > 1 ? 's' : '') +
              ' sur ' + eleves.length + ' dans la classe'
      }),
      UI.el('div', { class: 'hero-actions' }, [
        UI.el('button', {
          type: 'button', class: 'btn btn--solid', text: '🎯 Donner des points',
          onclick: function () { showTab('give'); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn', text: '💬 Tchat',
          onclick: function () { showTab('chat'); }
        })
      ])
    ]);
    wrap.appendChild(hero);

    var stats = UI.el('div', { class: 'stat-grid' });
    stats.appendChild(statCard(String(eleves.length), 'Élèves inscrits', ''));
    stats.appendChild(statCard(String(enLigne), 'Connectés maintenant', 'stat--online'));
    stats.appendChild(statCard(String(totalPoints()), 'Points en circulation', 'stat--points'));
    stats.appendChild(statCard(String(encadrement.length), 'Délégués + suppléants', 'stat--staff'));
    wrap.appendChild(stats);

    if (!canAward()) {
      wrap.appendChild(UI.el('div', { class: 'notice' }, [
        UI.el('strong', { text: 'Lecture seule. ' }),
        document.createTextNode(
          state.me.role === 'suppleant'
            ? 'En tant que suppléant, tu vois la classe et tu participes au tchat. ' +
              'Le droit de donner ou retirer des points appartient aux délégués ' +
              '(il peut être ouvert aux suppléants dans la table app_settings).'
            : 'Ton rôle ne permet pas de modifier les points.'
        )
      ]));
    }

    wrap.appendChild(topPanel());
    return wrap;
  }

  function statCard(value, label, extraClass) {
    return UI.el('div', { class: 'stat ' + (extraClass || '') }, [
      UI.el('b', { text: value }),
      UI.el('span', { text: label })
    ]);
  }

  function topPanel() {
    var top = students().slice().sort(function (a, b) { return b.points - a.points; }).slice(0, 3);
    var panel = UI.el('div', { class: 'card' });
    panel.appendChild(UI.el('div', { class: 'panel-title' }, [
      UI.el('span', { text: 'Tête de classe' }),
      UI.el('button', { type: 'button', class: 'link', text: 'Classement complet', onclick: function () { showTab('rank'); } })
    ]));

    if (!top.length) {
      panel.appendChild(UI.el('p', { class: 'sub', text: 'Aucun élève inscrit pour l’instant.' }));
      return panel;
    }

    var medals = ['🥇', '🥈', '🥉'];
    var ul = UI.el('ul', { class: 'event-list' });
    top.forEach(function (p, i) {
      ul.appendChild(UI.el('li', { class: 'event' }, [
        UI.el('div', { class: 'event-ico', text: medals[i] || '⭐' }),
        UI.el('div', { class: 'event-body' }, [
          UI.el('div', { class: 'event-text' }, [UI.el('b', { text: p.prenom })]),
          UI.el('div', { class: 'event-when', text: isOnline(p) ? 'en ligne' : 'hors ligne' })
        ]),
        UI.el('div', { class: 'event-amount', text: p.points + ' pts' })
      ]));
    });
    panel.appendChild(ul);
    return panel;
  }

  function rankOf(id) {
    var sorted = students().slice().sort(function (a, b) { return b.points - a.points; });
    for (var i = 0; i < sorted.length; i++) if (sorted[i].id === id) return i + 1;
    return 0;
  }

  /* ---------------------------------------------------------------------- */
  /* DONNER / RETIRER (encadrement)                                          */
  /* ---------------------------------------------------------------------- */
  function renderGive() {
    var min = state.settings.award_min || 1;
    var max = state.settings.award_max || 4;
    UI.$('#give-min').textContent = min;
    UI.$('#give-max').textContent = max;

    var noticeHost = UI.$('#give-notice');
    noticeHost.innerHTML = '';
    if (!canAward()) {
      noticeHost.appendChild(UI.el('div', { class: 'notice' }, [
        document.createTextNode(
          state.me.role === 'suppleant'
            ? 'Les suppléants peuvent consulter la classe mais pas modifier les points. ' +
              'Le réglage se change dans Supabase (table app_settings, colonne suppleant_can_award).'
            : 'Ton rôle ne permet pas de modifier les points.'
        )
      ]));
    }

    renderStudentList({
      hostId: 'give-list',
      searchId: 'give-search',
      onlineId: 'give-online-only',
      countId: 'give-count',
      mode: 'award'
    });
  }

  /* ---------------------------------------------------------------------- */
  /* ENVOYER (élève)                                                          */
  /* ---------------------------------------------------------------------- */
  function renderSend() {
    UI.$('#send-balance').textContent = state.me.points;
    renderStudentList({
      hostId: 'send-list',
      searchId: 'send-search',
      onlineId: 'send-online-only',
      countId: null,
      mode: 'send'
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Liste d'élèves partagée (donner / envoyer)                              */
  /* ---------------------------------------------------------------------- */
  function renderStudentList(opts) {
    var host = UI.$('#' + opts.hostId);
    var search = UI.$('#' + opts.searchId);
    var onlineBox = UI.$('#' + opts.onlineId);
    if (!host) return;

    var term = (search && search.value || '').trim().toLowerCase();
    var onlineOnly = !!(onlineBox && onlineBox.checked);

    var list = students()
      .filter(function (p) { return p.id !== state.me.id; })
      .filter(function (p) { return !onlineOnly || isOnline(p); })
      .filter(function (p) { return !term || p.prenom.toLowerCase().indexOf(term) >= 0; })
      .sort(function (a, b) {
        var oa = isOnline(a) ? 0 : 1, ob = isOnline(b) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return a.prenom.localeCompare(b.prenom, 'fr');
      });

    /* Mémorise les montants saisis pour ne pas les perdre au rafraîchissement. */
    var drafts = {};
    UI.$$('input[data-draft-for]', host).forEach(function (inp) {
      drafts[inp.dataset.draftFor] = inp.value;
    });

    host.innerHTML = '';

    if (opts.countId) {
      UI.$('#' + opts.countId).textContent =
        list.length + ' élève' + (list.length > 1 ? 's' : '') + ' affiché' + (list.length > 1 ? 's' : '');
    }

    if (!list.length) {
      host.appendChild(UI.el('div', {
        class: 'empty',
        text: onlineOnly
          ? 'Aucun élève connecté pour l’instant. Décoche « connectés seulement » pour voir toute la classe.'
          : term
            ? 'Personne ne correspond à « ' + term + ' ».'
            : 'Aucun élève inscrit pour le moment.'
      }));
      return;
    }

    list.forEach(function (p) {
      host.appendChild(opts.mode === 'award' ? awardCard(p, drafts) : sendCard(p, drafts));
    });
  }

  function studentHead(p) {
    return UI.el('div', { class: 'student-top' }, [
      UI.el('div', { class: 'avatar', text: initials(p.prenom) }),
      UI.el('div', { class: 'student-id' }, [
        UI.el('div', { class: 'student-name' }, [document.createTextNode(p.prenom)]),
        UI.el('div', { class: 'student-meta' }, [
          UI.el('span', { class: 'dot' + (isOnline(p) ? ' is-online' : ''), dataset: { dot: p.id } }),
          UI.el('span', { text: isOnline(p) ? 'connecté' : 'hors ligne', dataset: { state: p.id } })
        ])
      ]),
      UI.el('div', { class: 'student-score' }, [
        UI.el('b', { text: String(p.points), dataset: { score: p.id } }),
        UI.el('span', { text: 'points' })
      ])
    ]);
  }

  function awardCard(p, drafts) {
    var enabled = canAward();
    var min = state.settings.award_min || 1;
    var max = state.settings.award_max || 4;

    var awardRow = UI.el('div', { class: 'award-row' });
    for (var n = min; n <= max; n++) {
      awardRow.appendChild(UI.el('button', {
        type: 'button',
        class: 'btn btn-plus',
        text: '+' + n,
        disabled: !enabled,
        title: enabled ? 'Donner ' + n + ' point' + (n > 1 ? 's' : '') + ' à ' + p.prenom
                       : 'Réservé aux délégués',
        dataset: { act: 'award', id: p.id, amount: String(n) }
      }));
    }

    var removeRow = UI.el('div', { class: 'remove-row' }, [
      UI.el('input', {
        type: 'number', min: '1', step: '1', value: '1',
        placeholder: 'Nb',
        'aria-label': 'Nombre de points à retirer à ' + p.prenom,
        disabled: !enabled,
        dataset: { draftFor: p.id }
      }),
      UI.el('button', {
        type: 'button', class: 'btn btn-minus', text: 'Retirer',
        disabled: !enabled || p.points === 0,
        title: enabled ? 'Retirer des points à ' + p.prenom : 'Réservé aux délégués',
        dataset: { act: 'remove', id: p.id }
      })
    ]);

    var card = UI.el('div', {
      class: 'student-card' + (isOnline(p) ? '' : ' is-offline'),
      dataset: { id: p.id }
    }, [studentHead(p), awardRow, removeRow]);

    if (drafts[p.id] !== undefined) {
      var inp = card.querySelector('input[data-draft-for]');
      if (inp) inp.value = drafts[p.id];
    }
    return card;
  }

  function sendCard(p, drafts) {
    var maxSend = state.me.points;
    var quick = [1, 2, 3].filter(function (n) { return n <= maxSend; });

    var chips = UI.el('div', { class: 'quick-chips' });
    quick.forEach(function (n) {
      chips.appendChild(UI.el('button', {
        type: 'button', class: 'quick-chip', text: String(n),
        title: 'Envoyer ' + n + ' point' + (n > 1 ? 's' : '') + ' à ' + p.prenom,
        dataset: { act: 'quick', id: p.id, amount: String(n) }
      }));
    });

    var row = UI.el('div', { class: 'send-row' }, [
      UI.el('input', {
        type: 'number', min: String(state.settings.transfer_min || 1), step: '1',
        max: String(Math.max(maxSend, 1)), value: String(state.settings.transfer_min || 1),
        'aria-label': 'Nombre de points à envoyer à ' + p.prenom,
        disabled: maxSend < (state.settings.transfer_min || 1),
        dataset: { draftFor: p.id }
      }),
      UI.el('button', {
        type: 'button', class: 'btn btn-send', text: 'Envoyer',
        disabled: maxSend < (state.settings.transfer_min || 1),
        dataset: { act: 'send', id: p.id }
      })
    ]);

    var card = UI.el('div', {
      class: 'student-card' + (isOnline(p) ? '' : ' is-offline'),
      dataset: { id: p.id }
    }, [studentHead(p)]);

    if (quick.length) card.appendChild(chips);
    card.appendChild(row);

    if (drafts[p.id] !== undefined) {
      var inp = card.querySelector('input[data-draft-for]');
      if (inp) inp.value = drafts[p.id];
    }
    return card;
  }

  /* ---------------------------------------------------------------------- */
  /* Actions sur les points                                                  */
  /* ---------------------------------------------------------------------- */
  function bindGlobalControls() {
    /* Délégation : un seul écouteur pour toutes les cartes élèves. */
    dom.main.addEventListener('click', onListClick);

    var giveSearch = UI.$('#give-search');
    var giveOnline = UI.$('#give-online-only');
    var sendSearch = UI.$('#send-search');
    var sendOnline = UI.$('#send-online-only');

    if (giveSearch) giveSearch.addEventListener('input', renderGive);
    if (giveOnline) giveOnline.addEventListener('change', renderGive);
    if (sendSearch) sendSearch.addEventListener('input', renderSend);
    if (sendOnline) sendOnline.addEventListener('change', renderSend);

    UI.$$('#history-filters .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.historyKind = chip.dataset.kind;
        UI.$$('#history-filters .chip').forEach(function (c) {
          c.classList.toggle('is-active', c === chip);
        });
        renderHistory();
      });
    });

    UI.$('#chat-form').addEventListener('submit', onSendChat);
  }

  function onListClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var btn = target.closest('button[data-act]');
    if (!btn || btn.disabled) return;

    var id = btn.dataset.id;
    var profile = state.byId[id];
    if (!profile) return;

    var act = btn.dataset.act;

    if (act === 'award') {
      return runAction('award_points', { p_target: id, p_amount: parseInt(btn.dataset.amount, 10) },
        '+' + btn.dataset.amount + ' point' + (btn.dataset.amount > 1 ? 's' : '') + ' pour ' + profile.prenom, btn);
    }

    if (act === 'remove') {
      var input = btn.parentNode.querySelector('input[data-draft-for]');
      var amount = parseInt(input && input.value, 10);
      if (!amount || amount < 1) { UI.err('Indique un nombre de points à retirer.'); input && input.focus(); return; }
      if (profile.points === 0) { UI.err(profile.prenom + ' n’a déjà plus aucun point.'); return; }
      return runAction('remove_points', { p_target: id, p_amount: amount },
        amount + ' point' + (amount > 1 ? 's' : '') + ' retiré' + (amount > 1 ? 's' : '') + ' à ' + profile.prenom, btn);
    }

    if (act === 'quick' || act === 'send') {
      var amount2 = act === 'quick'
        ? parseInt(btn.dataset.amount, 10)
        : parseInt(btn.parentNode.querySelector('input[data-draft-for]').value, 10);

      if (!amount2 || amount2 < (state.settings.transfer_min || 1)) {
        UI.err('Indique un nombre de points valide.'); return;
      }
      if (amount2 > state.me.points) {
        UI.err('Tu n’as que ' + state.me.points + ' point' + (state.me.points > 1 ? 's' : '') + '.'); return;
      }
      return runAction('transfer_points', { p_target: id, p_amount: amount2 },
        amount2 + ' point' + (amount2 > 1 ? 's' : '') + ' envoyé' + (amount2 > 1 ? 's' : '') + ' à ' + profile.prenom, btn);
    }
  }

  function runAction(fn, args, successText, btn) {
    var card = btn ? btn.closest('.student-card') : null;
    if (card) card.classList.add('is-busy');
    if (btn) btn.disabled = true;

    return sb.rpc(fn, args).then(function (res) {
      if (res.error) throw res.error;
      if (res.data && typeof res.data.points === 'number' && fn === 'transfer_points') {
        state.me.points = res.data.points;
        dom.mePointsValue.textContent = res.data.points;
      }
      UI.ok(successText);
      /* Realtime se charge du reste, mais on rafraîchit tout de suite l'écran. */
      return loadProfiles().then(function () {
        renderCurrentView();
      });
    }).catch(function (err) {
      UI.err(UI.humanError(err));
      if (card) card.classList.remove('is-busy');
      if (btn) btn.disabled = false;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* CLASSEMENT                                                              */
  /* ---------------------------------------------------------------------- */
  function renderRank() {
    var podiumHost = UI.$('#podium');
    var body = UI.$('#rank-body');
    var sorted = state.profiles.slice().sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.prenom.localeCompare(b.prenom, 'fr');
    });

    podiumHost.innerHTML = '';
    var medals = ['🥇', '🥈', '🥉'];
    var classes = ['podium-card--1', 'podium-card--2', 'podium-card--3'];
    sorted.slice(0, 3).forEach(function (p, i) {
      podiumHost.appendChild(UI.el('div', { class: 'podium-card ' + classes[i] }, [
        UI.el('span', { class: 'medal', text: medals[i] }),
        UI.el('div', { class: 'who', text: p.prenom }),
        UI.el('div', { class: 'pts', text: p.points + ' pts' }),
        UI.el('div', { class: 'badge badge--' + p.role, style: 'margin-top:8px', text: UI.roleLabel(p.role) })
      ]));
    });

    body.innerHTML = '';
    if (!sorted.length) {
      body.appendChild(UI.el('tr', {}, [UI.el('td', { colspan: '5', text: 'Personne dans la classe pour l’instant.' })]));
      return;
    }

    sorted.forEach(function (p, i) {
      body.appendChild(UI.el('tr', { class: p.id === state.me.id ? 'is-me' : '' }, [
        UI.el('td', { class: 'pos', text: String(i + 1) }),
        UI.el('td', {}, [
          UI.el('strong', { text: p.prenom }),
          p.id === state.me.id ? UI.el('span', { class: 'hint', text: '  (toi)' }) : null
        ]),
        UI.el('td', { class: 'hide-sm' }, [
          UI.el('span', { class: 'badge badge--' + p.role, text: UI.roleLabel(p.role) })
        ]),
        UI.el('td', { class: 'num' }, [UI.el('strong', { text: String(p.points) })]),
        UI.el('td', { class: 'hide-sm' }, [
          UI.el('span', { class: 'dot' + (isOnline(p) ? ' is-online' : '') }),
          document.createTextNode(' ' + (isOnline(p) ? 'connecté' : 'hors ligne'))
        ])
      ]));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* HISTORIQUE                                                              */
  /* ---------------------------------------------------------------------- */
  function renderHistory() {
    var list = UI.$('#history-list');
    UI.$('#history-title').textContent = isEleve() ? 'Mon historique' : 'Historique de la classe';
    UI.$('#history-sub').textContent = isEleve()
      ? 'Tout ce qui a bougé sur ton compte.'
      : 'Chaque point donné, retiré ou échangé dans la classe.';

    var rows = state.events.filter(function (ev) {
      return state.historyKind === 'all' || ev.kind === state.historyKind;
    });

    list.innerHTML = '';
    if (!rows.length) {
      list.appendChild(UI.el('li', {
        class: 'empty',
        text: 'Rien à afficher pour l’instant.'
      }));
      return;
    }

    rows.forEach(function (ev) { list.appendChild(eventRow(ev)); });
  }

  function eventRow(ev) {
    var icons = { gain: '⭐', retrait: '➖', transfert: '🔁' };
    var signs = { gain: '+', retrait: '−', transfert: '↔' };
    var li = UI.el('li', { class: 'event event--' + ev.kind });

    li.appendChild(UI.el('div', { class: 'event-ico', text: icons[ev.kind] || '•' }));

    var text;
    if (ev.kind === 'gain') {
      text = [UI.el('b', { text: nameOf(ev.actor_id) }), document.createTextNode(' a donné ' + ev.amount + ' point' + (ev.amount > 1 ? 's' : '') + ' à '), UI.el('b', { text: nameOf(ev.subject_id) })];
    } else if (ev.kind === 'retrait') {
      text = [UI.el('b', { text: nameOf(ev.actor_id) }), document.createTextNode(' a retiré ' + ev.amount + ' point' + (ev.amount > 1 ? 's' : '') + ' à '), UI.el('b', { text: nameOf(ev.subject_id) })];
    } else {
      text = [UI.el('b', { text: nameOf(ev.subject_id) }), document.createTextNode(' a envoyé ' + ev.amount + ' point' + (ev.amount > 1 ? 's' : '') + ' à '), UI.el('b', { text: nameOf(ev.counterparty_id) })];
    }

    li.appendChild(UI.el('div', { class: 'event-body' }, [
      UI.el('div', { class: 'event-text' }, text),
      UI.el('div', { class: 'event-when', text: UI.clockTime(ev.created_at) + ' · ' + UI.timeAgo(ev.created_at) })
    ]));

    li.appendChild(UI.el('div', { class: 'event-amount', text: signs[ev.kind] + ev.amount }));
    return li;
  }

  /* ---------------------------------------------------------------------- */
  /* TCHAT                                                                   */
  /* ---------------------------------------------------------------------- */
  function renderChat() {
    if (!isStaff()) return;

    var members = UI.$('#chat-members');
    var log = UI.$('#chat-log');

    members.innerHTML = '';
    state.profiles
      .filter(function (p) { return UI.isStaff(p.role); })
      .sort(function (a, b) { return (a.role === 'delegue' ? 0 : 1) - (b.role === 'delegue' ? 0 : 1); })
      .forEach(function (p) {
        members.appendChild(UI.el('span', { class: 'member-chip' }, [
          UI.el('span', { class: 'dot' + (isOnline(p) ? ' is-online' : '') }),
          document.createTextNode(p.prenom + ' · ' + UI.roleLabel(p.role))
        ]));
      });

    var stickToBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 60;
    log.innerHTML = '';

    if (!state.messages.length) {
      log.appendChild(UI.el('div', {
        class: 'empty',
        text: 'Aucun message. Écris le premier mot aux autres délégués et suppléants.'
      }));
      return;
    }

    var lastDay = '';
    state.messages.forEach(function (m) {
      var day = new Date(m.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (day !== lastDay) {
        log.appendChild(UI.el('div', { class: 'chat-day', text: day }));
        lastDay = day;
      }
      var mine = m.author_id === state.me.id;
      log.appendChild(UI.el('div', { class: 'msg' + (mine ? ' msg--mine' : '') }, [
        UI.el('div', { class: 'msg-head' }, [
          UI.el('b', { text: mine ? 'Toi' : nameOf(m.author_id) }),
          UI.el('span', { text: UI.clockTime(m.created_at) })
        ]),
        UI.el('div', { class: 'msg-bubble', text: m.body })
      ]));
    });

    if (stickToBottom) log.scrollTop = log.scrollHeight;
  }

  function onSendChat(event) {
    event.preventDefault();
    var input = UI.$('#chat-input');
    var btn = UI.$('#chat-send');
    var body = input.value.trim();

    if (!body) return;

    btn.disabled = true;
    sb.from('staff_messages')
      .insert({ author_id: state.me.id, body: body })
      .then(function (res) {
        if (res.error) throw res.error;
        input.value = '';
        return loadMessages().then(renderChat);
      })
      .catch(function (err) { UI.err(UI.humanError(err)); })
      .then(function () { btn.disabled = false; input.focus(); });
  }

  /* ---------------------------------------------------------------------- */
  /* Pied de page                                                            */
  /* ---------------------------------------------------------------------- */
  function renderFooter() {
    var eleves = students();
    var enLigne = eleves.filter(isOnline).length;
    dom.footerStats.textContent =
      eleves.length + ' élève' + (eleves.length > 1 ? 's' : '') + ' · ' +
      enLigne + ' connecté' + (enLigne > 1 ? 's' : '') + ' · ' +
      totalPoints() + ' point' + (totalPoints() > 1 ? 's' : '') + ' en circulation';
  }

  /* ---------------------------------------------------------------------- */
  /* Présence : battement de cœur                                            */
  /* ---------------------------------------------------------------------- */
  function startHeartbeat() {
    beat();
    state.heartbeatTimer = window.setInterval(beat, cfg.HEARTBEAT_MS || 25000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { beat(); refreshAll(); }
    });
    window.addEventListener('beforeunload', function () { beat(); });
  }

  function beat() {
    sb.rpc('heartbeat').then(function (res) {
      if (res.error || !res.data) return;
      state.me.last_seen_at = res.data;
      if (state.byId[state.me.id]) state.byId[state.me.id].last_seen_at = res.data;
    }).catch(function () {});
  }

  /* ---------------------------------------------------------------------- */
  /* Rafraîchissement périodique (filet de sécurité si Realtime décroche)    */
  /* ---------------------------------------------------------------------- */
  function startAutoRefresh() {
    state.refreshTimer = window.setInterval(function () {
      if (!document.hidden) refreshPresenceOnly();
    }, 20000);
  }

  /* Recalcule seulement qui est « connecté » : pas de requête réseau. */
  function refreshPresenceOnly() {
    patchPresence();
    renderFooter();
    if (state.tab === 'give' || state.tab === 'send') {
      var onlineBox = UI.$(state.tab === 'give' ? '#give-online-only' : '#send-online-only');
      /* Ne réorganise la liste que si personne n'est en train de saisir. */
      if (onlineBox && onlineBox.checked && !saisieEnCours()) renderCurrentView();
    }
  }

  function refreshAll() {
    return Promise.all([loadProfiles(), loadEvents(), loadMessages()])
      .then(function () { renderCurrentView(); })
      .catch(function () {});
  }

  /* ---------------------------------------------------------------------- */
  /* Temps réel                                                              */
  /* ---------------------------------------------------------------------- */
  function startRealtime() {
    state.channel = sb
      .channel('ecem-classe-' + state.me.role)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onProfileChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'point_events' }, onNewEvent)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_messages' }, onNewMessage)
      .subscribe(function (status) {
        if (dom.footerLive) {
          dom.footerLive.textContent =
            status === 'SUBSCRIBED' ? 'temps réel activé' : 'temps réel : ' + status;
        }
        if (status === 'SUBSCRIBED') refreshAll();
      });

    sb.auth.onAuthStateChange(function (evt) {
      if (evt === 'SIGNED_OUT') goToLogin();
    });
  }

  function onProfileChange(payload) {
    var row = payload.new && payload.new.id ? payload.new : payload.old;
    if (!row) return;

    var avant = state.byId[row.id];
    var pointsAvant = avant ? avant.points : null;

    if (payload.eventType === 'DELETE') {
      state.profiles = state.profiles.filter(function (p) { return p.id !== row.id; });
      delete state.byId[row.id];
      state.structureChanged = true;
    } else {
      if (!avant) {
        state.profiles.push(row);
        state.byId[row.id] = row;
        state.structureChanged = true;
      } else {
        Object.assign(avant, row);
      }
      if (state.me && row.id === state.me.id) Object.assign(state.me, row);
    }

    rebuildIndex();

    var apres = state.byId[row.id];
    var pointsOntChange = !!apres && pointsAvant !== null && pointsAvant !== apres.points;
    var cestMoi = !!(state.me && row.id === state.me.id);

    if (cestMoi || apres) dom.mePointsValue.textContent = state.me ? state.me.points : 0;

    /* Un battement de cœur (last_seen_at) ne change rien à l'affichage des
     * points : on se contente de recolorer les pastilles. Un vrai changement
     * de solde, en revanche, mérite un redraw de l'écran courant — mais jamais
     * pendant que l'utilisateur tape dans un champ. */
    if (state.structureChanged) {
      state.structureChanged = false;
      renderCurrentView();
      return;
    }

    patchPresence();
    renderFooter();

    if (!pointsOntChange && !cestMoi) return;

    var vues = { home: 1, rank: 1, send: 1, give: 1 };
    if (vues[state.tab] && !saisieEnCours()) renderCurrentView();
  }

  /* Vrai si le focus est dans un champ : on évite alors de tout redessiner. */
  function saisieEnCours() {
    var el = document.activeElement;
    if (!el || !el.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'button';
  }

  function onNewEvent(payload) {
    var row = payload.new;
    if (!row) return;
    if (state.events.some(function (e) { return e.id === row.id; })) return;
    state.events.unshift(row);
    if (state.events.length > 200) state.events.pop();

    if (state.tab === 'history' || state.tab === 'home') renderCurrentView();
  }

  function onNewMessage(payload) {
    var row = payload.new;
    if (!row) return;
    if (state.messages.some(function (m) { return String(m.id) === String(row.id); })) return;
    state.messages.push(row);
    if (state.tab === 'chat') renderChat();
  }

  /* Met à jour scores et pastilles sans tout redessiner : les champs de
   * saisie en cours ne sont donc jamais perdus. */
  function patchPresence() {
    UI.$$('[data-score]').forEach(function (node) {
      var p = state.byId[node.dataset.score];
      if (p) node.textContent = String(p.points);
    });
    UI.$$('[data-dot]').forEach(function (node) {
      var p = state.byId[node.dataset.dot];
      node.classList.toggle('is-online', !!p && isOnline(p));
    });
    UI.$$('[data-state]').forEach(function (node) {
      var p = state.byId[node.dataset.state];
      node.textContent = p && isOnline(p) ? 'connecté' : 'hors ligne';
    });
    /* Le bouton « Retirer » n'a plus de raison d'être actif à 0 point. */
    UI.$$('button[data-act="remove"]').forEach(function (btn) {
      var p = state.byId[btn.dataset.id];
      if (p) btn.disabled = !canAward() || p.points === 0;
    });
    UI.$$('.student-card').forEach(function (card) {
      var p = state.byId[card.dataset.id];
      if (p) card.classList.toggle('is-offline', !isOnline(p));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Déconnexion                                                             */
  /* ---------------------------------------------------------------------- */
  function logout() {
    if (state.heartbeatTimer) window.clearInterval(state.heartbeatTimer);
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    if (state.channel) sb.removeChannel(state.channel);

    dom.btnLogout.disabled = true;
    sb.auth.signOut().then(function () {
      window.location.replace('index.html');
    }).catch(function () {
      window.location.replace('index.html');
    });
  }
})();
