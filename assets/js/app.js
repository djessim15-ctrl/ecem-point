/* ============================================================================
 * ECEM Point — application (app.html)
 * ----------------------------------------------------------------------------
 * Une seule page, des sections calculées selon le rôle du compte connecté :
 *
 *   élève     -> Accueil · Envoyer · Classement · Statistiques · Succès ·
 *                Mon historique · Profil
 *   suppléant -> + Donner / retirer (si le réglage l'autorise) · Tchat
 *   délégué   -> idem, avec le droit de donner / retirer dans tous les cas
 *
 * Toutes les données viennent de Store (data.js). Aucune écriture directe en
 * base : chaque action passe par une fonction SQL. L'interface écoute ensuite
 * les changements Realtime pour se mettre à jour toute seule.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM.UI;
  var FX = window.ECEM.FX;
  var Charts = window.ECEM.Charts;
  var Insights = window.ECEM.Insights;
  var Theme = window.ECEM.Theme;
  var Prefs = window.ECEM.Prefs;
  var Store = window.ECEM.Store;
  var cfg = window.ECEM.cfg || {};
  var sb = window.ECEM.sb;

  if (!UI || !Store || !sb) return;

  /* ---------------------------------------------------------------------- */
  /* État local d'interface                                                 */
  /* ---------------------------------------------------------------------- */
  var state = {
    tab: 'home',
    rankScope: 'all',
    rankFilter: '',
    historyKind: 'all',
    unseenEvents: 0,
    unseenMessages: 0,
    notificationsSeenAt: readNumber('ecem-notif-seen', 0),
    demoRole: null,
    pendingRender: false
  };

  var dom = {};
  var WEEKLY_GOAL = cfg.WEEKLY_GOAL || 15;

  var TABS = {
    eleve: [
      { id: 'home', label: 'Accueil', icon: 'home', group: 'Classe' },
      { id: 'send', label: 'Envoyer des points', icon: 'send', group: 'Classe' },
      { id: 'rank', label: 'Classement', icon: 'trophy', group: 'Classe' },
      { id: 'history', label: 'Mon historique', icon: 'history', group: 'Classe' },
      { id: 'stats', label: 'Statistiques', icon: 'chart', group: 'Analyse' },
      { id: 'badges', label: 'Succès', icon: 'award', group: 'Analyse' },
      { id: 'profile', label: 'Profil & réglages', icon: 'user', group: 'Compte' }
    ],
    staff: [
      { id: 'home', label: 'Accueil', icon: 'home', group: 'Classe' },
      { id: 'give', label: 'Donner / retirer', icon: 'gift', group: 'Classe' },
      { id: 'rank', label: 'Classement', icon: 'trophy', group: 'Classe' },
      { id: 'history', label: 'Historique de la classe', icon: 'history', group: 'Classe' },
      { id: 'stats', label: 'Statistiques', icon: 'chart', group: 'Analyse' },
      { id: 'badges', label: 'Succès', icon: 'award', group: 'Analyse' },
      { id: 'chat', label: 'Tchat encadrement', icon: 'chat', group: 'Encadrement' },
      { id: 'profile', label: 'Profil & réglages', icon: 'user', group: 'Compte' }
    ]
  };

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                              */
  /* ---------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    dom = {
      boot: UI.$('#boot'),
      bootText: UI.$('#boot-text'),
      sidebar: UI.$('#sidebar'),
      scrim: UI.$('#sidebar-scrim'),
      sideNav: UI.$('#side-nav'),
      sideUser: UI.$('#side-user'),
      footerStats: UI.$('#footer-stats'),
      liveText: UI.$('#live-text'),
      liveState: UI.$('#live-state'),
      bottomNav: UI.$('#bottom-nav'),
      fab: UI.$('#fab'),
      main: UI.$('#app-main'),
      topbarLabel: UI.$('#topbar-label'),
      topbarTitle: UI.$('#topbar-title'),
      mePoints: UI.$('#me-points'),
      mePointsValue: UI.$('#me-points-value'),
      meChip: UI.$('#btn-me'),
      bellDot: UI.$('#bell-dot'),
      demoHost: UI.$('#demo-strip-host'),
      btnMenu: UI.$('#btn-menu'),
      btnLogout: UI.$('#btn-logout'),
      btnTheme: UI.$('#btn-theme'),
      btnThemeSide: UI.$('#btn-theme-side'),
      btnBell: UI.$('#btn-bell'),
      btnPalette: UI.$('#btn-palette'),
      btnExport: UI.$('#btn-export'),
      historyFilters: UI.$('#history-filters'),
      rankScope: UI.$('#rank-scope'),
      chatForm: UI.$('#chat-form'),
      chatInput: UI.$('#chat-input'),
      chatSend: UI.$('#chat-send'),
      chatLog: UI.$('#chat-log'),
      chatMembers: UI.$('#chat-members'),
      chatCount: UI.$('#chat-count'),
      btnEmoji: UI.$('#btn-emoji'),
      sendSearch: UI.$('#send-search'),
      sendOnline: UI.$('#send-online-only'),
      giveSearch: UI.$('#give-search'),
      giveOnline: UI.$('#give-online-only')
    };

    hydrateIcons();
    bindShell();
    bindShortcuts();

    boot();

    window.addEventListener('resize', function () {
      if (window.innerWidth > 1023) closeSidebar();
    });
  });

  function boot() {
    setBootText('Connexion à ta classe…');

    Store.init()
      .then(function () {
        setBootText('Chargement des points…');
        if (dom.boot) dom.boot.classList.add('is-hidden');
        buildNavigation();
        paintIdentity();
        paintThemeButtons();
        if (Store.state.demo) buildDemoStrip();
        bindStoreEvents();
        bindViewControls();
        showTab(initialTab());
        updateLiveState('SUBSCRIBED');
        paintFooter();
      })
      .catch(function (error) {
        if (error && error.code === 'NO_SESSION') {
          goToLogin('Connecte-toi pour accéder à la classe.');
          return;
        }
        if (error && error.code === 'NO_PROFILE') {
          sb.auth.signOut().then(function () {
            goToLogin('Ton compte n’est pas activé. Réinscris-toi pour le terminer.');
          });
          return;
        }
        fatal(UI.humanError(error));
      });
  }

  function hydrateIcons() {
    UI.$$('[data-icon]').forEach(function (node) {
      var size = parseInt(node.getAttribute('data-size'), 10) || 20;
      UI.clear(node);
      node.appendChild(UI.icon(node.getAttribute('data-icon'), { size: size }));
    });
  }

  function initialTab() {
    var hash = String(window.location.hash || '').replace('#', '');
    var allowed = tabsFor().some(function (tab) { return tab.id === hash; });
    return allowed ? hash : 'home';
  }

  function setBootText(text) {
    if (dom.bootText) dom.bootText.textContent = text;
  }

  function fatal(message) {
    if (dom.boot) dom.boot.classList.add('is-hidden');
    dom.main.innerHTML = '';
    dom.main.appendChild(UI.el('div', { class: 'empty', style: { marginTop: '40px' } }, [
      UI.el('span', { class: 'empty-ico' }, [UI.icon('alert', { size: 26 })]),
      UI.el('div', { class: 'empty-title', text: 'Impossible d’ouvrir la classe' }),
      UI.el('div', { class: 'empty-text', text: message }),
      UI.el('div', { class: 'row', style: { marginTop: '10px' } }, [
        UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Réessayer',
          onclick: function () { window.location.reload(); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Retour à la connexion',
          onclick: function () { window.location.href = 'index.html'; }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-soft', text: 'Voir la démo',
          onclick: function () { window.location.href = 'app.html?demo=1'; }
        })
      ])
    ]));
  }

  function goToLogin(message) {
    if (message) {
      try { window.sessionStorage.setItem('ecem-flash', message); } catch (e) {}
    }
    window.location.replace('index.html');
  }

  function readNumber(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw === null ? fallback : Number(raw) || 0;
    } catch (e) {
      return fallback;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                             */
  /* ---------------------------------------------------------------------- */
  function tabsFor() {
    return Store.isEleve() ? TABS.eleve : TABS.staff;
  }

  function tabById(id) {
    return tabsFor().filter(function (tab) { return tab.id === id; })[0] || null;
  }

  function buildNavigation() {
    /* --- barre latérale --- */
    UI.clear(dom.sideNav);
    var groups = [];
    tabsFor().forEach(function (tab) {
      var group = groups.filter(function (g) { return g.name === tab.group; })[0];
      if (!group) { group = { name: tab.group, tabs: [] }; groups.push(group); }
      group.tabs.push(tab);
    });

    groups.forEach(function (group) {
      dom.sideNav.appendChild(UI.el('div', { class: 'nav-label', text: group.name }));
      group.tabs.forEach(function (tab) {
        var button = UI.el('button', {
          type: 'button',
          class: 'nav-item',
          dataset: { tab: tab.id },
          onclick: function () { showTab(tab.id); }
        }, [
          UI.icon(tab.icon, { size: 19 }),
          UI.el('span', { class: 'nav-text', text: tab.label }),
          tab.id === 'chat' ? UI.el('span', { class: 'nav-count is-hidden', dataset: { count: 'chat' } }) : null
        ]);
        button.dataset.icon = tab.icon;
        dom.sideNav.appendChild(button);
      });
    });

    /* --- barre inférieure (mobile) --- */
    UI.clear(dom.bottomNav);
    var mobileTabs = [
      { id: 'home', label: 'Accueil', icon: 'home' },
      { id: Store.isEleve() ? 'send' : 'give', label: Store.isEleve() ? 'Envoyer' : 'Points', icon: Store.isEleve() ? 'send' : 'gift' },
      { id: 'rank', label: 'Classement', icon: 'trophy' },
      { id: 'stats', label: 'Stats', icon: 'chart' },
      { id: 'profile', label: 'Profil', icon: 'user' }
    ];
    mobileTabs.forEach(function (tab) {
      dom.bottomNav.appendChild(UI.el('button', {
        type: 'button', class: 'bnav-item', dataset: { tab: tab.id },
        onclick: function () { showTab(tab.id); }
      }, [UI.icon(tab.icon, { size: 21 }), UI.el('span', { text: tab.label })]));
    });
  }

  function updateNavActive() {
    UI.$$('[data-tab]', dom.sideNav).forEach(function (node) {
      var active = node.dataset.tab === state.tab;
      node.classList.toggle('is-active', active);
      if (active) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
    UI.$$('[data-tab]', dom.bottomNav).forEach(function (node) {
      node.classList.toggle('is-active', node.dataset.tab === state.tab);
    });
  }

  function showTab(id) {
    var tab = tabById(id);
    if (!tab) tab = tabById('home');
    state.tab = tab.id;
    state.pendingRender = false;
    closeSidebar();
    closeEmoji();

    tabsFor().forEach(function (item) {
      var section = document.getElementById('view-' + item.id);
      if (section) section.hidden = item.id !== state.tab;
    });

    UI.clear(dom.topbarTitle);
    dom.topbarTitle.appendChild(UI.icon(tab.icon, { size: 19 }));
    dom.topbarTitle.appendChild(UI.el('span', { id: 'topbar-label', text: tab.label }));
    updateNavActive();

    /* Le bouton flottant ne sert à rien sur les écrans d'action ou de saisie. */
    if (dom.fab) {
      dom.fab.hidden = ['give', 'send', 'chat', 'profile'].indexOf(state.tab) !== -1;
    }

    if (state.tab === 'chat') {
      state.unseenMessages = 0;
      paintUnreadCounts();
    }

    renderCurrent();
    if (!document.body.classList.contains('has-modal')) {
      window.scrollTo({ top: 0, behavior: FX.enabled() ? 'smooth' : 'auto' });
    }
  }

  function openSidebar() {
    dom.sidebar.classList.add('is-open');
    dom.scrim.classList.add('is-in');
    dom.btnMenu.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    dom.sidebar.classList.remove('is-open');
    dom.scrim.classList.remove('is-in');
    if (dom.btnMenu) dom.btnMenu.setAttribute('aria-expanded', 'false');
  }

  /* ---------------------------------------------------------------------- */
  /* Identité                                                               */
  /* ---------------------------------------------------------------------- */
  function paintIdentity() {
    var me = Store.state.me;
    if (!me) return;
    var isEleve = Store.isEleve();

    /* barre latérale */
    UI.clear(dom.sideUser);
    dom.sideUser.appendChild(UI.avatar(me.prenom, { size: 38 }));
    dom.sideUser.appendChild(UI.el('div', { class: 'side-user-body' }, [
      UI.el('div', { class: 'side-user-name', text: me.prenom }),
      UI.el('div', { class: 'side-user-meta' }, [
        UI.el('span', { class: 'dot' + (Store.isOnline(me) ? ' is-online' : '') }),
        UI.el('span', { text: UI.roleLabel(me.role) })
      ])
    ]));
    dom.sideUser.appendChild(UI.el('button', {
      type: 'button', class: 'icon-btn', style: { width: '30px', height: '30px', border: '0', background: 'transparent' },
      'aria-label': 'Ouvrir mon profil',
      onclick: function () { showTab('profile'); }
    }, [UI.icon('chevron-right', { size: 16 })]));

    /* pastille de points */
    dom.mePoints.hidden = !isEleve;
    if (isEleve) dom.mePointsValue.textContent = String(me.points);
    dom.mePoints.title = UI.pointsLabel(me.points) + ' disponibles';

    /* chip du haut */
    UI.clear(dom.meChip);
    dom.meChip.appendChild(UI.avatar(me.prenom, { size: 30 }));
    dom.meChip.appendChild(UI.el('span', { class: 'me-chip-name', text: me.prenom }));
    dom.meChip.appendChild(UI.el('span', { class: 'me-chip-role', text: UI.roleLabel(me.role) }));

    paintFooter();
  }

  function paintScores() {
    UI.$$('[data-score]').forEach(function (node) {
      var profile = Store.profileById(node.dataset.score);
      if (profile) {
        var value = String(profile.points);
        if (node.textContent !== value) node.textContent = value;
      }
    });
    UI.$$('[data-dot]').forEach(function (node) {
      var profile = Store.profileById(node.dataset.dot);
      node.classList.toggle('is-online', !!profile && Store.isOnline(profile));
    });
    UI.$$('[data-state]').forEach(function (node) {
      var profile = Store.profileById(node.dataset.state);
      node.textContent = profile && Store.isOnline(profile) ? 'connecté' : 'hors ligne';
    });
    UI.$$('[data-remove]').forEach(function (button) {
      var profile = Store.profileById(button.dataset.remove);
      if (profile) button.disabled = !Store.canAward() || profile.points === 0;
    });
    UI.$$('.student').forEach(function (card) {
      var profile = Store.profileById(card.dataset.id);
      if (profile) card.classList.toggle('is-offline', !Store.isOnline(profile));
    });
    if (Store.isEleve()) {
      dom.mePointsValue.textContent = String(Store.myPoints());
      if (dom.sideUser.querySelector('.dot')) {
        dom.sideUser.querySelector('.dot').classList.toggle('is-online', Store.isOnline(Store.state.me));
      }
    }
  }

  function paintFooter() {
    var students = Store.students();
    var online = Store.onlineStudents().length;
    if (dom.footerStats) {
      dom.footerStats.textContent = online + '/' + students.length + ' en ligne';
    }
  }

  function paintUnreadCounts() {
    UI.$$('[data-count="chat"]').forEach(function (node) {
      node.textContent = String(state.unseenMessages);
      node.classList.toggle('is-hidden', state.unseenMessages === 0);
    });
    dom.bellDot.classList.toggle('is-hidden', state.unseenEvents === 0);
    dom.btnBell.setAttribute('aria-label', state.unseenEvents
      ? state.unseenEvents + ' nouvelle(s) activité(s)'
      : 'Notifications');
  }

  function updateLiveState(status) {
    if (!dom.liveText) return;
    var online = status === 'SUBSCRIBED' || status === 'ok' || status === true;
    dom.liveState.classList.toggle('is-off', !online);
    dom.liveText.textContent = online ? 'temps réel actif' : 'hors ligne';
  }

  function paintThemeButtons() {
    if (!Theme) return;
    var actual = Theme.resolved();
    if (dom.btnTheme) {
      UI.clear(dom.btnTheme);
      dom.btnTheme.appendChild(UI.icon(actual === 'dark' ? 'moon' : 'sun', { size: 19 }));
      dom.btnTheme.title = 'Thème : ' + Theme.label(Theme.mode());
    }
    if (dom.btnThemeSide) {
      UI.clear(dom.btnThemeSide);
      dom.btnThemeSide.appendChild(UI.icon('palette', { size: 18 }));
      dom.btnThemeSide.title = 'Thème : ' + Theme.label(Theme.mode());
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Barre d'outils & écouteurs génériques                                  */
  /* ---------------------------------------------------------------------- */
  function bindShell() {
    dom.btnLogout.addEventListener('click', logout);
    dom.btnMenu.addEventListener('click', openSidebar);
    dom.scrim.addEventListener('click', closeSidebar);
    dom.btnBell.addEventListener('click', openNotifications);
    dom.btnPalette.addEventListener('click', openPalette);
    dom.meChip.addEventListener('click', function () { showTab('profile'); });

    var toggleTheme = function () {
      Theme.cycle();
      paintThemeButtons();
      UI.info('Thème : ' + Theme.label(Theme.mode()), { duration: 1600 });
    };
    if (dom.btnTheme) dom.btnTheme.addEventListener('click', toggleTheme);
    if (dom.btnThemeSide) dom.btnThemeSide.addEventListener('click', toggleTheme);

    dom.fab.addEventListener('click', function () {
      showTab(Store.isEleve() ? 'send' : 'give');
    });

    document.addEventListener('ecem:theme', paintThemeButtons);

    /* Quand on quitte un champ, on rattrape le rendu mis en attente. */
    document.addEventListener('focusout', function () {
      window.setTimeout(function () {
        if (state.pendingRender && !isTyping()) {
          state.pendingRender = false;
          renderCurrent();
        }
      }, 60);
    });

    window.addEventListener('online', function () {
      updateLiveState(true);
      UI.ok('De nouveau en ligne.');
      Store.refreshAll().catch(function () {});
    });
    window.addEventListener('offline', function () {
      updateLiveState(false);
      UI.err('Tu es hors ligne : les points ne partiront pas tant que la connexion n’est pas revenue.');
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) paintScores();
    });
  }

  function bindShortcuts() {
    document.addEventListener('keydown', function (event) {
      var meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.key === 'Escape') {
        closeEmoji();
        closeSidebar();
        return;
      }
      if (event.key === '/' && !isTyping()) {
        var input = UI.$('#view-' + state.tab + ' input[type="search"]');
        if (input) { event.preventDefault(); input.focus(); }
      }
    });
  }

  function isTyping() {
    var el = document.activeElement;
    if (!el || !el.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox';
  }

  /* ---------------------------------------------------------------------- */
  /* Écoute du Store                                                        */
  /* ---------------------------------------------------------------------- */
  function bindStoreEvents() {
    Store.on(function (kind, detail) {
      if (kind === 'signed-out') { goToLogin('Tu as été déconnecté.'); return; }
      if (kind === 'realtime') { updateLiveState(detail && detail.status); return; }
      if (kind === 'tick') { paintScores(); paintFooter(); return; }

      if (kind === 'profiles') {
        var me = Store.state.me;
        var concernsMe = !!detail && me && (
          (detail.updated && detail.updated.id === me.id) ||
          (detail.added && detail.added.id === me.id) ||
          detail.removed === me.id
        );
        if (concernsMe) paintIdentity();
        paintScores();
        paintFooter();
        if (detail && detail.removed) scheduleRender();
        if (detail && (detail.added || detail.pointsChanged)) scheduleRender();
        return;
      }

      if (kind === 'event') {
        var row = detail && detail.row;
        if (row && Store.state.me && row.actor_id !== Store.state.me.id) {
          state.unseenEvents++;
          paintUnreadCounts();
        }
        announceEvent(row);
        if (state.tab === 'home' || state.tab === 'history' || state.tab === 'stats' || state.tab === 'rank' || state.tab === 'badges') {
          scheduleRender();
        }
        return;
      }

      if (kind === 'message') {
        if (detail && detail.row && detail.row.author_id !== Store.state.me.id) {
          if (state.tab === 'chat') {
            renderChat();
          } else {
            state.unseenMessages++;
            paintUnreadCounts();
            UI.info(Store.nameOf(detail.row.author_id) + ' : ' + detail.row.body.slice(0, 60), { duration: 4200 });
            if (FX) FX.sound('message');
          }
        }
        return;
      }

      if (kind === 'messages') {
        if (state.tab === 'chat') renderChat();
        return;
      }

      if (kind === 'points') {
        paintIdentity();
        paintScores();
        return;
      }

      if (kind === 'refresh') {
        paintIdentity();
        paintScores();
        paintFooter();
        scheduleRender();
        return;
      }
    });
  }

  var renderTimer = null;

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(function () {
      renderTimer = null;
      if (isTyping()) { state.pendingRender = true; return; }
      renderCurrent();
    }, 260);
  }

  function announceEvent(event) {
    if (!event || !event.created_at) return;
    if (window.ECEM.Prefs && window.ECEM.Prefs.get('notifications') === false) return;
    if (Date.now() - new Date(event.created_at).getTime() > 20000) return;
    var me = Store.state.me;
    if (!me) return;
    var mine = event.subject_id === me.id || event.counterparty_id === me.id;
    if (event.actor_id === me.id) return;

    if (mine) {
      if (event.kind === 'gain') {
        UI.toast('+' + event.amount + ' point' + (event.amount > 1 ? 's' : '') + ' de ' + Store.nameOf(event.actor_id) + ' !', 'star');
        if (FX) { FX.sound('success'); FX.celebrate(); }
      } else if (event.kind === 'retrait') {
        UI.err(Store.nameOf(event.actor_id) + ' t’a retiré ' + event.amount + ' point' + (event.amount > 1 ? 's' : '') + '.');
      } else if (event.kind === 'transfert' && event.counterparty_id === me.id) {
        UI.toast(Store.nameOf(event.subject_id) + ' t’a envoyé ' + event.amount + ' point' + (event.amount > 1 ? 's' : '') + ' !', 'star');
        if (FX) { FX.sound('success'); FX.burst(null, 30); }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Routage des vues                                                       */
  /* ---------------------------------------------------------------------- */
  function renderCurrent() {
    if (!Store.state.ready) return;
    switch (state.tab) {
      case 'home': renderHome(); break;
      case 'give': renderGive(); break;
      case 'send': renderSend(); break;
      case 'rank': renderRank(); break;
      case 'stats': renderStats(); break;
      case 'history': renderHistory(); break;
      case 'badges': renderBadges(); break;
      case 'chat': renderChat(); break;
      case 'profile': renderProfile(); break;
      default: renderHome();
    }
    paintFooter();
  }

  /* ---------------------------------------------------------------------- */
  /* Composants partagés                                                    */
  /* ---------------------------------------------------------------------- */
  function panel(opts) {
    var head = UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.icon(opts.icon || 'sparkles', { size: 19 }),
          UI.el('span', { text: opts.title })
        ]),
        opts.sub ? UI.el('div', { class: 'panel-sub', text: opts.sub }) : null
      ])
    ]);

    if (opts.action) head.appendChild(opts.action);

    var body = UI.el('div', { class: 'panel-body' + (opts.flush ? ' panel-body--flush' : '') });
    if (opts.content) body.appendChild(opts.content);

    return UI.el('div', { class: 'panel ' + (opts.class || '') }, [head, body]);
  }

  function statCard(opts) {
    var trend = null;
    if (opts.trend !== undefined && opts.trend !== null) {
      var up = opts.trend >= 0;
      trend = UI.el('span', { class: 'stat-trend ' + (up ? 'up' : 'down') }, [
        UI.icon(up ? 'arrow-up' : 'arrow-down', { size: 12 }),
        document.createTextNode(Math.abs(opts.trend) + (opts.trendUnit || ''))
      ]);
    }

    return UI.el('div', { class: 'stat-card' }, [
      UI.el('div', { class: 'stat-top' }, [
        UI.el('span', { class: 'stat-ico stat-ico--' + (opts.tone || 'violet') }, [UI.icon(opts.icon || 'star', { size: 17 })]),
        trend
      ]),
      UI.el('div', { class: 'stat-value', text: opts.value }),
      UI.el('div', { class: 'stat-label', text: opts.label })
    ]);
  }

  function pill(text, tone, icon) {
    return UI.el('span', { class: 'pill' + (tone ? ' pill--' + tone : '') }, [
      icon ? UI.icon(icon, { size: 13 }) : null,
      document.createTextNode(text)
    ]);
  }

  function presence(profile) {
    return UI.el('span', { class: 'presence-label' }, [
      UI.el('span', { class: 'dot' + (Store.isOnline(profile) ? ' is-online' : ''), dataset: { dot: profile.id } }),
      UI.el('span', { text: Store.isOnline(profile) ? 'connecté' : 'hors ligne', dataset: { state: profile.id } })
    ]);
  }

  function eventRow(event, opts) {
    opts = opts || {};
    var icons = { gain: 'star', retrait: 'minus', transfert: 'send' };
    var signs = { gain: '+', retrait: '−', transfert: '↔' };

    var text;
    if (event.kind === 'gain') {
      text = [UI.el('b', { text: Store.nameOf(event.actor_id) }),
        document.createTextNode(' a donné ' + UI.pointsLabel(event.amount) + ' à '),
        UI.el('b', { text: Store.nameOf(event.subject_id) })];
    } else if (event.kind === 'retrait') {
      text = [UI.el('b', { text: Store.nameOf(event.actor_id) }),
        document.createTextNode(' a retiré ' + UI.pointsLabel(event.amount) + ' à '),
        UI.el('b', { text: Store.nameOf(event.subject_id) })];
    } else {
      text = [UI.el('b', { text: Store.nameOf(event.subject_id) }),
        document.createTextNode(' a envoyé ' + UI.pointsLabel(event.amount) + ' à '),
        UI.el('b', { text: Store.nameOf(event.counterparty_id) })];
    }

    return UI.el('div', { class: 'event event--' + event.kind }, [
      UI.el('span', { class: 'event-ico' }, [UI.icon(icons[event.kind] || 'dot', { size: 18 })]),
      UI.el('div', { class: 'event-body' }, [
        UI.el('div', { class: 'event-text' }, text),
        UI.el('div', { class: 'event-time', text: UI.clockTime(event.created_at) + ' · ' + UI.timeAgo(event.created_at) })
      ]),
      opts.hideAmount ? null : UI.el('span', {
        class: 'event-amount',
        text: signs[event.kind] + event.amount
      })
    ]);
  }

  function feedItem(event) {
    var icons = { gain: 'star', retrait: 'minus', transfert: 'send' };
    var signs = { gain: '+', retrait: '−', transfert: '↔' };
    var text;
    if (event.kind === 'gain') {
      text = [UI.el('b', { text: Store.nameOf(event.subject_id) }),
        document.createTextNode(' a reçu ' + UI.pointsLabel(event.amount))];
    } else if (event.kind === 'retrait') {
      text = [UI.el('b', { text: Store.nameOf(event.subject_id) }),
        document.createTextNode(' a perdu ' + UI.pointsLabel(event.amount))];
    } else {
      text = [UI.el('b', { text: Store.nameOf(event.subject_id) }),
        document.createTextNode(' → '),
        UI.el('b', { text: Store.nameOf(event.counterparty_id) })];
    }

    return UI.el('div', { class: 'feed-item' }, [
      UI.el('span', { class: 'feed-ico feed-ico--' + event.kind }, [UI.icon(icons[event.kind] || 'dot', { size: 17 })]),
      UI.el('div', { class: 'feed-body' }, [
        UI.el('div', { class: 'feed-text' }, text),
        UI.el('div', { class: 'feed-time', text: UI.timeAgo(event.created_at) })
      ]),
      UI.el('span', { class: 'feed-amount feed-amount--' + event.kind, text: signs[event.kind] + event.amount })
    ]);
  }

  function emptyState(icon, title, text, action) {
    return UI.el('div', { class: 'empty' }, [
      UI.el('span', { class: 'empty-ico' }, [UI.icon(icon, { size: 24 })]),
      UI.el('div', { class: 'empty-title', text: title }),
      UI.el('div', { class: 'empty-text', text: text }),
      action || null
    ]);
  }

  function sparklineFor(values, opts) {
    var wrap = UI.el('div', { class: 'chart-svg' });
    wrap.appendChild(Charts.sparkline(values, opts));
    return wrap;
  }

  /* ---------------------------------------------------------------------- */
  /* ACCUEIL                                                                */
  /* ---------------------------------------------------------------------- */
  function renderHome() {
    var host = UI.$('#view-home');
    UI.clear(host);
    var dash = UI.el('div', { class: 'dashboard' });

    var me = Store.state.me;
    var events = Store.state.events;
    var week = Insights.weekSeries(events);

    if (Store.isEleve()) {
      var receivedWeek = events.reduce(function (total, event) {
        var since = Date.now() - 7 * Insights.DAY;
        if (new Date(event.created_at).getTime() < since) return total;
        if (event.kind === 'gain' && event.subject_id === me.id) return total + event.amount;
        if (event.kind === 'transfert' && event.counterparty_id === me.id) return total + event.amount;
        return total;
      }, 0);

      var sentWeek = events.reduce(function (total, event) {
        var since = Date.now() - 7 * Insights.DAY;
        if (new Date(event.created_at).getTime() < since) return total;
        if (event.kind === 'transfert' && event.subject_id === me.id) return total + event.amount;
        return total;
      }, 0);

      var removedWeek = events.reduce(function (total, event) {
        var since = Date.now() - 7 * Insights.DAY;
        if (new Date(event.created_at).getTime() < since) return total;
        if (event.kind === 'retrait' && event.subject_id === me.id) return total + event.amount;
        return total;
      }, 0);

      /* Variation jour par jour de MON solde sur 7 jours. */
      var todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      var daily = [0, 0, 0, 0, 0, 0, 0];
      events.forEach(function (event) {
        if (Date.now() - new Date(event.created_at).getTime() > 7 * Insights.DAY) return;
        var delta = 0;
        if (event.kind === 'gain' && event.subject_id === me.id) delta += event.amount;
        else if (event.kind === 'retrait' && event.subject_id === me.id) delta -= event.amount;
        else if (event.kind === 'transfert' && event.subject_id === me.id) delta -= event.amount;
        else if (event.kind === 'transfert' && event.counterparty_id === me.id) delta += event.amount;
        if (!delta) return;
        var day = new Date(event.created_at);
        day.setHours(0, 0, 0, 0);
        var index = 6 - Math.round((todayStart.getTime() - day.getTime()) / Insights.DAY);
        if (index >= 0 && index < 7) daily[index] += delta;
      });

      var rank = Store.rankOf(me.id);
      var totalStudents = Store.students().length;
      var net = receivedWeek - sentWeek - removedWeek;
      var streak = Insights.streak(events, me.id);
      var goal = Math.min(100, Math.round((receivedWeek / WEEKLY_GOAL) * 100));

      dash.appendChild(hero([
        UI.el('span', { class: 'hero-greet' }, [UI.icon('sparkles', { size: 14 }), document.createTextNode('Bonjour ' + me.prenom)]),
        UI.el('div', { class: 'hero-points' }, [
          UI.el('span', { class: 'hero-value', text: String(me.points), dataset: { heroPoints: '1' } }),
          UI.el('span', { class: 'hero-unit', text: 'point' + (me.points > 1 ? 's' : '') })
        ]),
        UI.el('div', { class: 'hero-meta' }, [
          pill(rank ? '#' + rank + ' sur ' + totalStudents : 'Nouveau', 'gold', 'trophy'),
          pill((net >= 0 ? '+' : '−') + Math.abs(net) + ' cette semaine', null, 'trending'),
          pill(Store.isOnline(me) ? 'connecté' : 'hors ligne', null, 'pulse')
        ]),
        UI.el('div', { class: 'hero-actions' }, [
          UI.el('button', {
            type: 'button', class: 'btn btn-gold',
            onclick: function () { showTab('send'); }
          }, [UI.icon('send', { size: 17 }), document.createTextNode('Envoyer des points')]),
          UI.el('button', {
            type: 'button', class: 'btn',
            onclick: function () { showTab('rank'); }
          }, [UI.icon('trophy', { size: 17 }), document.createTextNode('Classement')])
        ])
      ], {
        side: UI.frag([
          UI.el('div', { class: 'hero-side-title', text: 'Ta semaine' }),
          UI.el('div', { class: 'hero-spark' }, [
            Charts.sparkline(daily, { color: 'rgba(255,255,255,.92)', height: 46 })
          ]),
          UI.el('div', { class: 'hero-side-legend' }, [
            UI.el('span', { text: 'reçus' }),
            UI.el('span', { text: UI.fmtSigned(net) + ' pts' })
          ]),
          UI.el('div', { class: 'hero-progress' }, [
            UI.el('span', { style: { width: Math.max(4, goal) + '%' } })
          ]),
          UI.el('div', { class: 'hero-mini' }, [
            UI.icon('target', { size: 14 }),
            document.createTextNode(receivedWeek + ' / ' + WEEKLY_GOAL + ' points reçus')
          ])
        ])
      }));

      dash.appendChild(UI.el('div', { class: 'stat-grid span-8' }, [
        statCard({ icon: 'star', tone: 'gold', value: String(receivedWeek), label: 'Reçus cette semaine' }),
        statCard({ icon: 'send', tone: 'blue', value: String(sentWeek), label: 'Envoyés cette semaine' }),
        statCard({ icon: 'flame', tone: 'rose', value: streak + ' j', label: 'Série en cours' }),
        statCard({ icon: 'trophy', tone: 'violet', value: rank ? '#' + rank : '—', label: 'Ton rang sur ' + totalStudents })
      ]));

      dash.appendChild(panel({
        title: 'Objectif de la semaine',
        icon: 'target',
        sub: 'Encore ' + Math.max(0, WEEKLY_GOAL - receivedWeek) + ' point(s) pour boucler ton objectif.',
        content: UI.el('div', { class: 'row', style: { gap: '16px' } }, [
          Charts.ring(receivedWeek, WEEKLY_GOAL, { caption: '/ ' + WEEKLY_GOAL, color: 'var(--gold)' }),
          UI.el('div', { style: { flex: '1', minWidth: '0' } }, [
            UI.el('div', { class: 'hero-title', style: { color: 'var(--text)' }, text: 'Prochaine réussite' }),
            UI.el('p', { class: 'sub', style: { fontSize: '.86rem', marginTop: '3px' },
              text: nextBadgeHint() }),
            UI.el('button', {
              type: 'button', class: 'link', style: { marginTop: '8px' },
              onclick: function () { showTab('badges'); }
            }, [document.createTextNode('Voir mes succès'), UI.icon('chevron-right', { size: 14 })])
          ])
        ]),
        class: 'span-4'
      }));

      dash.appendChild(panel({
        title: 'Activité récente',
        icon: 'pulse',
        sub: 'Les derniers mouvements qui te concernent',
        action: UI.el('button', {
          type: 'button', class: 'link', onclick: function () { showTab('history'); }
        }, [document.createTextNode('Tout voir'), UI.icon('chevron-right', { size: 14 })]),
        content: activityFeed(events.slice(0, 6), 'Aucun mouvement pour le moment. Les délégués n’ont pas encore distribué de points.'),
        class: 'span-7'
      }));

      dash.appendChild(panel({
        title: 'Tête de classe',
        icon: 'trophy',
        action: UI.el('button', {
          type: 'button', class: 'link', onclick: function () { showTab('rank'); }
        }, [document.createTextNode('Classement'), UI.icon('chevron-right', { size: 14 })]),
        content: top3List(),
        class: 'span-5'
      }));

      host.appendChild(dash);
      return;
    }

    /* ---------------------------- encadrement ---------------------------- */
    var students = Store.students();
    var online = Store.onlineStudents();
    var distributed = week.reduce(function (total, day) { return total + day.gain; }, 0);
    var messagesCount = Store.state.messages.length;

    dash.appendChild(hero([
      UI.el('span', { class: 'hero-greet' }, [UI.icon('sparkles', { size: 14 }), document.createTextNode('Bonjour ' + me.prenom)]),
      UI.el('div', { class: 'hero-points' }, [
        UI.el('span', { class: 'hero-value', text: String(online.length) }),
        UI.el('span', { class: 'hero-unit', text: 'élève' + (online.length > 1 ? 's' : '') + ' en ligne' })
      ]),
      UI.el('div', { class: 'hero-meta' }, [
        pill(students.length + ' inscrits', 'gold', 'users'),
        pill(Store.totalPoints() + ' points en circulation', null, 'star'),
        pill(Store.canAward() ? 'droit de modifier' : 'lecture seule', null, 'shield')
      ]),
      UI.el('div', { class: 'hero-actions' }, [
        UI.el('button', {
          type: 'button', class: 'btn btn-gold', disabled: !Store.canAward(),
          onclick: function () { showTab('give'); }
        }, [UI.icon('gift', { size: 17 }), document.createTextNode('Donner des points')]),
        UI.el('button', {
          type: 'button', class: 'btn', onclick: function () { showTab('chat'); }
        }, [UI.icon('chat', { size: 17 }), document.createTextNode('Tchat')])
      ])
    ], {
      side: UI.frag([
        UI.el('div', { class: 'hero-side-title', text: 'Points distribués · 7 jours' }),
        UI.el('div', { class: 'hero-spark' }, [
          Charts.sparkline(week.map(function (day) { return day.gain; }), { color: 'rgba(255,255,255,.92)', height: 46 })
        ]),
        UI.el('div', { class: 'hero-side-legend' }, [
          UI.el('span', { text: 'total' }),
          UI.el('span', { text: distributed + ' pts' })
        ]),
        UI.el('div', { class: 'hero-mini' }, [
          UI.icon('chat', { size: 14 }),
          document.createTextNode(messagesCount + ' message' + (messagesCount > 1 ? 's' : '') + ' dans le tchat')
        ])
      ])
    }));

    dash.appendChild(UI.el('div', { class: 'stat-grid span-12' }, [
      statCard({ icon: 'users', tone: 'violet', value: String(students.length), label: 'Élèves inscrits' }),
      statCard({ icon: 'pulse', tone: 'green', value: String(online.length), label: 'Connectés maintenant' }),
      statCard({ icon: 'star', tone: 'gold', value: String(Store.totalPoints()), label: 'Points en circulation' }),
      statCard({ icon: 'gift', tone: 'blue', value: String(distributed), label: 'Distribués en 7 jours' })
    ]));

    if (!Store.canAward()) {
      dash.appendChild(UI.el('div', { class: 'notice span-12' }, [
        UI.icon('info', { size: 17 }),
        UI.el('span', {}, [
          UI.el('strong', { text: 'Lecture seule. ' }),
          document.createTextNode(me.role === 'suppleant'
            ? 'En tant que suppléant, tu vois la classe et tu participes au tchat. Le droit de donner ou retirer des points peut être ouvert aux suppléants dans les réglages Supabase (app_settings.suppleant_can_award).'
            : 'Ton rôle ne permet pas de modifier les points.')
        ])
      ]));
    }

    dash.appendChild(panel({
      title: 'À récompenser',
      icon: 'zap',
      sub: online.length ? 'Les élèves connectés, prêts à recevoir des points' : 'Personne n’est connecté pour le moment',
      action: UI.el('button', {
        type: 'button', class: 'link', onclick: function () { showTab('give'); }
      }, [document.createTextNode('Tout voir'), UI.icon('chevron-right', { size: 14 })]),
      content: quickAwardList(online.slice(0, 5)),
      class: 'span-7'
    }));

    dash.appendChild(panel({
      title: 'Activité de la classe',
      icon: 'pulse',
      action: UI.el('button', {
        type: 'button', class: 'link', onclick: function () { showTab('history'); }
      }, [document.createTextNode('Historique'), UI.icon('chevron-right', { size: 14 })]),
      content: activityFeed(Store.state.events.slice(0, 6), 'Aucun mouvement pour l’instant.'),
      class: 'span-5'
    }));

    host.appendChild(dash);
  }

  function hero(mainChildren, opts) {
    opts = opts || {};
    return UI.el('div', { class: 'hero span-12' }, [
      UI.el('div', { class: 'hero-main' }, mainChildren),
      opts.side ? UI.el('div', { class: 'hero-side' }, opts.side) : null
    ]);
  }

  function nextBadgeHint() {
    var badges = Insights.badges({
      me: Store.state.me,
      events: Store.state.events,
      profiles: Store.state.profiles,
      messages: Store.state.messages
    });
    var next = badges.filter(function (badge) { return !badge.unlocked; })[0];
    if (!next) return 'Tous les succès sont débloqués — bravo !';
    return next.label + ' : ' + next.value + ' / ' + next.goal + '. ' + next.desc;
  }

  function activityFeed(events, emptyText) {
    if (!events.length) {
      return emptyState('pulse', 'Rien à afficher', emptyText);
    }
    var wrap = UI.el('div', { class: 'feed' });
    events.forEach(function (event) { wrap.appendChild(feedItem(event)); });
    return wrap;
  }

  function top3List() {
    var top = Store.sortByPoints().slice(0, 3);
    if (!top.length) return emptyState('users', 'Classe vide', 'Aucun élève inscrit pour l’instant.');
    var list = UI.el('div', { class: 'top3' });
    top.forEach(function (profile, index) {
      list.appendChild(UI.el('button', {
        type: 'button', class: 'top3-row',
        onclick: function () { openStudent(profile.id); }
      }, [
        UI.el('span', { class: 'top3-pos', text: String(index + 1) }),
        UI.avatar(profile.prenom, { size: 30 }),
        UI.el('span', { class: 'top3-name', text: profile.prenom + (profile.id === Store.state.me.id ? ' (toi)' : '') }),
        UI.el('span', { class: 'top3-pts', text: profile.points + ' pts' })
      ]));
    });
    return list;
  }

  function quickAwardList(students) {
    if (!students.length) {
      return emptyState('moon', 'Personne en ligne', 'Dès qu’un élève se connecte, il apparaît ici pour recevoir des points en un geste.');
    }

    var list = UI.el('div', { class: 'top3' });
    students.forEach(function (profile) {
      var actions = UI.el('div', { class: 'quick-chips', style: { marginLeft: 'auto' } });
      var min = Store.state.settings.award_min || 1;
      var max = Math.min(Store.state.settings.award_max || 4, min + 2);
      for (var amount = min; amount <= max; amount++) {
        actions.appendChild(UI.el('button', {
          type: 'button', class: 'quick-chip', text: '+' + amount,
          disabled: !Store.canAward(),
          onclick: function (event) {
            doAward(profile, parseInt(this.textContent.replace('+', ''), 10), event.currentTarget);
          }
        }));
      }

      list.appendChild(UI.el('div', { class: 'top3-row' }, [
        UI.avatar(profile.prenom, { size: 32 }),
        UI.el('div', { style: { flex: '1', minWidth: '0' } }, [
          UI.el('div', { class: 'top3-name', text: profile.prenom }),
          UI.el('div', { class: 'student-meta' }, [
            UI.el('span', { class: 'dot is-online', dataset: { dot: profile.id } }),
            UI.el('span', { text: profile.points + ' pts', dataset: { score: profile.id } })
          ])
        ]),
        actions
      ]));
    });
    return list;
  }

  /* ---------------------------------------------------------------------- */
  /* DONNER / RETIRER                                                       */
  /* ---------------------------------------------------------------------- */
  function renderGive() {
    var host = UI.$('#view-give');
    var min = Store.state.settings.award_min || 1;
    var max = Store.state.settings.award_max || 4;
    UI.$('#give-min').textContent = min;
    UI.$('#give-max').textContent = max;

    var notice = UI.$('#give-notice');
    UI.clear(notice);
    if (!Store.canAward()) {
      notice.appendChild(UI.el('div', { class: 'notice', style: { marginBottom: '16px' } }, [
        UI.icon('lock', { size: 17 }),
        UI.el('span', {}, [
          UI.el('strong', { text: 'Lecture seule. ' }),
          document.createTextNode(Store.state.me.role === 'suppleant'
            ? 'Les suppléants consultent la classe sans modifier les points tant que le réglage suppleant_can_award est désactivé.'
            : 'Ton rôle ne permet pas de modifier les points.')
        ])
      ]));
    }

    var online = Store.onlineStudents().length;
    var hint = UI.$('#give-hint');
    UI.clear(hint);
    hint.appendChild(pill(online + ' connecté' + (online > 1 ? 's' : ''), 'green', 'pulse'));
    hint.appendChild(pill('+1 → +' + max, null, 'star'));

    renderStudentGrid({
      host: UI.$('#give-list'),
      mode: 'award',
      countNode: UI.$('#give-count'),
      searchInput: dom.giveSearch,
      onlineBox: dom.giveOnline
    });
  }

  function renderSend() {
    var host = UI.$('#view-send');
    var balance = Store.myPoints();
    var min = Store.state.settings.transfer_min || 1;

    UI.$('#send-balance').textContent = String(balance);
    UI.$('#send-balance-label').textContent = 'point' + (balance > 1 ? 's' : '') + ' disponible' + (balance > 1 ? 's' : '');
    UI.$('#send-min-hint').textContent = 'minimum ' + min + ' pt' + (min > 1 ? 's' : '') + ' par envoi';

    renderStudentGrid({
      host: UI.$('#send-list'),
      mode: 'send',
      countNode: UI.$('#send-count'),
      searchInput: dom.sendSearch,
      onlineBox: dom.sendOnline
    });
  }

  function renderStudentGrid(opts) {
    var host = opts.host;
    if (!host) return;

    var term = UI.normalize(opts.searchInput && opts.searchInput.value || '');
    var onlineOnly = !!(opts.onlineBox && opts.onlineBox.checked);

    var list = Store.students()
      .filter(function (profile) { return profile.id !== Store.state.me.id; })
      .filter(function (profile) { return !onlineOnly || Store.isOnline(profile); })
      .filter(function (profile) { return !term || UI.normalize(profile.prenom).indexOf(term) >= 0; })
      .sort(function (a, b) {
        var oa = Store.isOnline(a) ? 0 : 1;
        var ob = Store.isOnline(b) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return a.prenom.localeCompare(b.prenom, 'fr');
      });

    /* Mémorise les montants saisis pour ne pas les perdre au rafraîchissement. */
    var drafts = {};
    UI.$$('input[data-draft-for]', host).forEach(function (input) {
      drafts[input.dataset.draftFor] = input.value;
    });

    UI.clear(host);

    if (opts.countNode) {
      opts.countNode.textContent = list.length + ' élève' + (list.length > 1 ? 's' : '') + ' affiché' + (list.length > 1 ? 's' : '');
    }

    if (!list.length) {
      var text = onlineOnly
        ? 'Aucun élève connecté pour l’instant. Décoche « Connectés » pour voir toute la classe.'
        : term ? 'Personne ne correspond à « ' + term + ' ».' : 'Aucun élève inscrit pour le moment.';
      host.appendChild(emptyState('users', 'Personne à afficher', text));
      return;
    }

    list.forEach(function (profile) {
      host.appendChild(opts.mode === 'award' ? awardCard(profile, drafts) : sendCard(profile, drafts));
    });
  }

  function studentHead(profile, opts) {
    opts = opts || {};
    return UI.el('div', { class: 'student-head' }, [
      UI.avatar(profile.prenom, { size: 42 }),
      UI.el('div', { class: 'student-id' }, [
        UI.el('div', { class: 'student-name' }, [
          document.createTextNode(profile.prenom),
          profile.id === Store.state.me.id ? UI.el('span', { class: 'pill pill--muted', text: 'toi' }) : null
        ]),
        UI.el('div', { class: 'student-meta' }, [
          UI.el('span', { class: 'dot' + (Store.isOnline(profile) ? ' is-online' : ''), dataset: { dot: profile.id } }),
          UI.el('span', { text: Store.isOnline(profile) ? 'connecté' : 'hors ligne', dataset: { state: profile.id } })
        ])
      ]),
      UI.el('div', { class: 'student-score' }, [
        UI.el('b', { text: String(profile.points), dataset: { score: profile.id } }),
        UI.el('span', { text: 'points' })
      ]),
      opts.action || null
    ]);
  }

  function awardCard(profile, drafts) {
    var enabled = Store.canAward();
    var min = Store.state.settings.award_min || 1;
    var max = Store.state.settings.award_max || 4;

    var actions = UI.el('div', { class: 'student-actions' });
    for (var amount = min; amount <= max; amount++) {
      actions.appendChild(UI.el('button', {
        type: 'button', class: 'btn btn-plus',
        text: '+' + amount,
        disabled: !enabled,
        title: enabled ? 'Donner ' + UI.pointsLabel(amount) + ' à ' + profile.prenom : 'Réservé aux délégués',
        dataset: { act: 'award', id: profile.id, amount: String(amount) }
      }));
    }

    var removeRow = UI.el('div', { class: 'award-remove' }, [
      UI.el('input', {
        type: 'number', min: '1', max: String(Math.max(profile.points, 1)), step: '1', value: '1',
        'aria-label': 'Nombre de points à retirer à ' + profile.prenom,
        disabled: !enabled || profile.points === 0,
        dataset: { draftFor: profile.id, act: 'remove-input', id: profile.id }
      }),
      UI.el('button', {
        type: 'button', class: 'btn btn-minus', text: 'Retirer',
        disabled: !enabled || profile.points === 0,
        title: enabled ? 'Retirer des points à ' + profile.prenom : 'Réservé aux délégués',
        dataset: { act: 'remove', id: profile.id, remove: profile.id }
      })
    ]);

    var card = UI.el('div', {
      class: 'student' + (Store.isOnline(profile) ? '' : ' is-offline'),
      dataset: { id: profile.id }
    }, [
      studentHead(profile, {
        action: UI.el('button', {
          type: 'button', class: 'icon-btn', style: { width: '30px', height: '30px' },
          'aria-label': 'Voir ' + profile.prenom,
          onclick: function () { openStudent(profile.id); }
        }, [UI.icon('chevron-right', { size: 15 })])
      }),
      actions,
      removeRow
    ]);

    if (drafts[profile.id] !== undefined) {
      var input = card.querySelector('input[data-draft-for]');
      if (input) input.value = drafts[profile.id];
    }
    return card;
  }

  function sendCard(profile, drafts) {
    var balance = Store.myPoints();
    var min = Store.state.settings.transfer_min || 1;
    var quickAmounts = [1, 2, 5, 10].filter(function (value) {
      return value <= balance && value >= min;
    });

    var chips = UI.el('div', { class: 'quick-chips' });
    quickAmounts.forEach(function (amount) {
      chips.appendChild(UI.el('button', {
        type: 'button', class: 'quick-chip', text: String(amount),
        disabled: balance < min,
        title: 'Envoyer ' + UI.pointsLabel(amount) + ' à ' + profile.prenom,
        dataset: { act: 'quick', id: profile.id, amount: String(amount) }
      }));
    });

    var row = UI.el('div', { class: 'send-row' }, [
      UI.el('input', {
        type: 'number', min: String(min), max: String(Math.max(balance, min)), step: '1',
        value: String(Math.min(min, Math.max(balance, min))),
        'aria-label': 'Nombre de points à envoyer à ' + profile.prenom,
        disabled: balance < min,
        dataset: { draftFor: profile.id, id: profile.id }
      }),
      UI.el('button', {
        type: 'button', class: 'btn btn-send', text: 'Envoyer',
        disabled: balance < min,
        dataset: { act: 'send', id: profile.id }
      })
    ]);

    var card = UI.el('div', {
      class: 'student' + (Store.isOnline(profile) ? '' : ' is-offline'),
      dataset: { id: profile.id }
    }, [studentHead(profile), chips, row]);

    if (drafts[profile.id] !== undefined) {
      var input = card.querySelector('input[data-draft-for]');
      if (input) input.value = drafts[profile.id];
    }
    return card;
  }

  /* ---------------------------------------------------------------------- */
  /* CLASSEMENT                                                             */
  /* ---------------------------------------------------------------------- */
  function renderRank() {
    var scope = state.rankScope;
    var weekly = Insights.weeklyNetByStudent(Store.state.events);

    var rows = Store.students().map(function (profile) {
      return {
        profile: profile,
        points: scope === 'week' ? (weekly[profile.id] || 0) : profile.points
      };
    }).sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.profile.prenom.localeCompare(b.profile.prenom, 'fr');
    });

    /* Podium */
    var podium = UI.$('#podium');
    UI.clear(podium);
    rows.slice(0, 3).forEach(function (row, index) {
      var place = index + 1;
      var card = UI.el('div', { class: 'podium-card podium-card--' + place, role: 'button', tabindex: '0',
        onclick: function () { openStudent(row.profile.id); },
        onkeydown: function (event) { if (event.key === 'Enter') openStudent(row.profile.id); }
      }, [
        UI.el('span', { class: 'podium-medal', text: String(place) }),
        UI.avatar(row.profile.prenom, { size: 52 }),
        UI.el('div', { class: 'podium-info' }, [
          UI.el('div', { class: 'podium-name', text: row.profile.prenom }),
          UI.el('div', { class: 'podium-pts' }, [
            document.createTextNode(scope === 'week' ? UI.fmtSigned(row.points) : String(row.points)),
            UI.el('small', { text: ' pts' })
          ])
        ])
      ]);
      podium.appendChild(card);
    });

    if (!rows.length) {
      podium.appendChild(emptyState('trophy', 'Pas encore de classement', 'Les points apparaîtront ici dès le premier don.'));
    }

    /* Liste */
    var host = UI.$('#rank-list');
    UI.clear(host);

    var term = UI.normalize(state.rankFilter);
    var filtered = rows.filter(function (row) {
      return !term || UI.normalize(row.profile.prenom).indexOf(term) >= 0;
    });

    UI.$('#rank-sub').textContent =
      (scope === 'week' ? 'Points gagnés sur les 7 derniers jours' : 'Solde actuel de chaque élève') +
      ' · ' + rows.length + ' élève' + (rows.length > 1 ? 's' : '');

    if (!filtered.length) {
      host.appendChild(emptyState('search', 'Aucun résultat', 'Aucun prénom ne correspond à « ' + state.rankFilter + ' ».'));
      return;
    }

    var best = Math.max.apply(null, rows.map(function (row) { return Math.abs(row.points); }).concat([1]));

    filtered.forEach(function (row) {
      var position = rows.indexOf(row) + 1;
      var profile = row.profile;
      var isMe = profile.id === Store.state.me.id;

      host.appendChild(UI.el('button', {
        type: 'button', class: 'rank-row' + (isMe ? ' is-me' : ''),
        onclick: function () { openStudent(profile.id); }
      }, [
        UI.el('span', { class: 'rank-pos', text: String(position) }),
        UI.el('div', { class: 'rank-main' }, [
          UI.avatar(profile.prenom, { size: 34 }),
          UI.el('div', { style: { minWidth: '0', flex: '1' } }, [
            UI.el('div', { class: 'rank-name' }, [
              document.createTextNode(profile.prenom),
              isMe ? UI.el('span', { class: 'pill pill--muted', text: 'toi' }) : null
            ]),
            UI.el('div', { class: 'rank-sub' }, [
              UI.el('span', { class: 'dot' + (Store.isOnline(profile) ? ' is-online' : ''), dataset: { dot: profile.id } }),
              UI.el('span', { text: Store.isOnline(profile) ? 'connecté' : 'hors ligne' })
            ]),
            UI.el('div', { class: 'rank-bar' }, [
              UI.el('span', { style: { width: Math.max(3, Math.round((Math.abs(row.points) / best) * 100)) + '%' } })
            ])
          ])
        ]),
        UI.el('div', { class: 'rank-pts' }, [
          document.createTextNode(scope === 'week' ? UI.fmtSigned(row.points) : String(row.points)),
          UI.el('small', { text: 'points' })
        ])
      ]));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* STATISTIQUES                                                           */
  /* ---------------------------------------------------------------------- */
  function renderStats() {
    var host = UI.$('#stats-content');
    if (!host) return;
    UI.clear(host);

    var events = Store.state.events;
    var week = Insights.weekSeries(events);
    var totals = Insights.kindTotals(events);
    var students = Store.students();
    var hours = Insights.hourActivity(events);
    var busiest = Insights.busiestHour(hours);
    var average = students.length ? Math.round(Store.totalPoints() / students.length) : 0;
    var weekGain = week.reduce(function (total, day) { return total + day.gain; }, 0);
    var weekLose = week.reduce(function (total, day) { return total + day.lose; }, 0);
    var weekTransfer = week.reduce(function (total, day) { return total + day.transfer; }, 0);

    UI.$('#stats-scope').textContent = 'Mis à jour ' + UI.timeAgo(new Date().toISOString());

    var wrap = UI.el('div', { class: 'stack' });

    wrap.appendChild(UI.el('div', { class: 'kpis' }, [
      statCard({ icon: 'star', tone: 'gold', value: String(Store.totalPoints()), label: 'Points en circulation' }),
      statCard({ icon: 'users', tone: 'violet', value: String(average), label: 'Moyenne par élève' }),
      statCard({ icon: 'trending', tone: 'green', value: '+' + weekGain, label: 'Gains sur 7 jours' }),
      statCard({ icon: 'arrow-down', tone: 'rose', value: '−' + weekLose, label: 'Retraits sur 7 jours' }),
      statCard({ icon: 'send', tone: 'blue', value: String(weekTransfer), label: 'Échanges sur 7 jours' })
    ]));

    /* Histogramme */
    var bars = panel({
      title: 'Gains et retraits',
      icon: 'chart',
      sub: 'Jour par jour sur les 7 derniers jours',
      class: 'chart-card'
    });
    var barsBody = bars.querySelector('.panel-body');
    barsBody.appendChild(UI.el('div', { class: 'chart-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'chart-value', text: '+' + weekGain }),
        UI.el('div', { class: 'chart-note', text: 'points distribués cette semaine' })
      ]),
      UI.el('div', { class: 'legend' }, [
        UI.el('span', { class: 'legend-item' }, [
          UI.el('span', { class: 'legend-dot', style: { background: 'var(--gold)' } }), document.createTextNode('Gains')
        ]),
        UI.el('span', { class: 'legend-item' }, [
          UI.el('span', { class: 'legend-dot', style: { background: 'var(--red)' } }), document.createTextNode('Retraits')
        ])
      ])
    ]));
    barsBody.appendChild(UI.el('div', { class: 'chart-body' }, [Charts.bars(week)]));

    /* Donut */
    var donut = panel({
      title: 'Répartition',
      icon: 'compass',
      sub: 'Nature des mouvements enregistrés',
      class: 'chart-card'
    });
    var donutBody = donut.querySelector('.panel-body');
    var donutItems = [
      { label: 'Gains', value: totals.gain, color: Charts.COLORS.gold },
      { label: 'Retraits', value: totals.retrait, color: Charts.COLORS.red },
      { label: 'Échanges', value: totals.transfert, color: Charts.COLORS.accent }
    ];

    var donutWrap = UI.el('div', { class: 'donut-wrap' });
    donutWrap.appendChild(Charts.donut(donutItems, { stroke: 14 }));
    var legend = UI.el('div', { class: 'donut-legend' });
    donutItems.forEach(function (item) {
      legend.appendChild(UI.el('div', { class: 'donut-legend-row' }, [
        UI.el('span', { class: 'legend-dot', style: { background: item.color } }),
        UI.el('span', { text: item.label }),
        UI.el('b', { text: String(item.value) })
      ]));
    });
    donutWrap.appendChild(legend);
    donutBody.appendChild(donutWrap);

    var duo = UI.el('div', { class: 'grid grid--2' }, [bars, donut]);
    wrap.appendChild(duo);

    /* Top donneurs / receveurs */
    var donors = panel({ title: 'Les plus généreux', icon: 'gift', sub: 'Points distribués sur 7 jours' });
    donors.querySelector('.panel-body').appendChild(
      Charts.hbars(Insights.topDonors(events, Store.state.profiles, 7), {
        format: function (value) { return value + ' pts'; },
        empty: 'Aucun point distribué cette semaine.'
      })
    );

    var gainers = panel({ title: 'Les plus récompensés', icon: 'star', sub: 'Points reçus sur 7 jours' });
    gainers.querySelector('.panel-body').appendChild(
      Charts.hbars(Insights.topGainers(events, Store.state.profiles, 7), {
        format: function (value) { return value + ' pts'; },
        empty: 'Personne n’a encore reçu de point cette semaine.'
      })
    );

    wrap.appendChild(UI.el('div', { class: 'grid grid--2' }, [donors, gainers]));

    /* Activité horaire */
    var heatCard = panel({
      title: 'Quand la classe bouge',
      icon: 'clock',
      sub: 'Répartition des mouvements selon l’heure de la journée'
    });
    var heatBody = heatCard.querySelector('.panel-body');
    heatBody.appendChild(Charts.heat(hours));
    heatBody.appendChild(UI.el('div', { class: 'hours' }, [
      UI.el('span', { text: '0 h' }), UI.el('span', { text: '6 h' }),
      UI.el('span', { text: '12 h' }), UI.el('span', { text: '18 h' }),
      UI.el('span', { text: '23 h' })
    ]));
    heatBody.appendChild(UI.el('p', { class: 'chart-note', style: { marginTop: '10px' },
      text: busiest.count
        ? 'Pic d’activité vers ' + busiest.hour + ' h (' + busiest.count + ' mouvement' + (busiest.count > 1 ? 's' : '') + ').'
        : 'Pas encore assez de données pour dégager une tendance.' }));
    wrap.appendChild(heatCard);

    /* Focus personnel */
    if (Store.isEleve()) {
      var me = Store.state.me;
      var mine = panel({ title: 'Ma semaine en un coup d’œil', icon: 'target' });
      var body = mine.querySelector('.panel-body');
      body.appendChild(UI.el('div', { class: 'stat-grid' }, [
        statCard({ icon: 'star', tone: 'gold', value: String(Insights.received(events, me.id)), label: 'Points reçus' }),
        statCard({ icon: 'send', tone: 'blue', value: String(Insights.sent(events, me.id)), label: 'Points envoyés' }),
        statCard({ icon: 'minus', tone: 'rose', value: String(Insights.removed(events, me.id)), label: 'Points retirés' }),
        statCard({ icon: 'flame', tone: 'violet', value: Insights.streak(events, me.id) + ' j', label: 'Série actuelle' })
      ]));
      wrap.appendChild(mine);
    }

    host.appendChild(wrap);
  }

  /* ---------------------------------------------------------------------- */
  /* HISTORIQUE                                                             */
  /* ---------------------------------------------------------------------- */
  function renderHistory() {
    var host = UI.$('#history-list');
    if (!host) return;

    UI.$('#history-title').textContent = Store.isEleve() ? 'Mon historique' : 'Historique de la classe';
    UI.$('#history-sub').textContent = Store.isEleve()
      ? 'Tout ce qui a bougé sur ton compte : points reçus, retirés et envoyés.'
      : 'Chaque point donné, retiré ou échangé dans la classe.';

    var counts = { all: Store.state.events.length, gain: 0, retrait: 0, transfert: 0 };
    Store.state.events.forEach(function (event) { counts[event.kind]++; });

    UI.$$('#history-filters .chip').forEach(function (chip) {
      var kind = chip.dataset.kind;
      chip.classList.toggle('is-active', kind === state.historyKind);
      var old = chip.querySelector('.count');
      if (old) old.remove();
      chip.appendChild(UI.el('span', { class: 'count', text: String(counts[kind] || 0) }));
    });

    var rows = Store.state.events.filter(function (event) {
      return state.historyKind === 'all' || event.kind === state.historyKind;
    });

    UI.$('#history-count').textContent = rows.length + ' mouvement' + (rows.length > 1 ? 's' : '');

    UI.clear(host);
    if (!rows.length) {
      host.appendChild(emptyState('history', 'Rien à afficher',
        state.historyKind === 'all'
          ? 'Aucun mouvement pour l’instant.'
          : 'Aucun mouvement de ce type dans l’historique.'));
      return;
    }

    var lastDay = null;
    rows.forEach(function (event) {
      var day = UI.dayKey(event.created_at);
      if (day !== lastDay) {
        host.appendChild(UI.el('div', { class: 'day-sep', text: UI.dayLabel(event.created_at) }));
        lastDay = day;
      }
      host.appendChild(eventRow(event));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* SUCCÈS                                                                 */
  /* ---------------------------------------------------------------------- */
  function renderBadges() {
    var host = UI.$('#badges-content');
    if (!host) return;
    UI.clear(host);

    var badges = Insights.badges({
      me: Store.state.me,
      events: Store.state.events,
      profiles: Store.state.profiles,
      messages: Store.state.messages
    });
    var unlocked = badges.filter(function (badge) { return badge.unlocked; }).length;

    host.appendChild(UI.el('div', { class: 'badge-overview' }, [
      Charts.ring(unlocked, badges.length, { caption: 'sur ' + badges.length, size: 108 }),
      UI.el('div', { class: 'badge-overview-body' }, [
        UI.el('div', { class: 'badge-overview-title', text: unlocked === badges.length
          ? 'Tous les succès sont débloqués !'
          : unlocked + ' succès sur ' + badges.length }),
        UI.el('div', { class: 'badge-overview-sub', text: unlocked === 0
          ? 'Reçois ton premier point pour débloquer le premier badge.'
          : 'Continue : chaque point reçu ou donné rapproche du prochain palier.' }),
        UI.el('div', { class: 'progress progress--accent', style: { marginTop: '10px', maxWidth: '320px' } }, [
          UI.el('span', { style: { width: Math.round((unlocked / badges.length) * 100) + '%' } })
        ])
      ])
    ]));

    var grid = UI.el('div', { class: 'badges' });
    badges.forEach(function (badge) {
      var stateClass = badge.unlocked ? 'is-unlocked' : 'is-locked';
      grid.appendChild(UI.el('div', { class: 'badge-card ' + stateClass }, [
        UI.el('div', { class: 'badge-top' }, [
          UI.el('span', { class: 'badge-ico badge-ico--' + badge.tone }, [UI.icon(badge.icon, { size: 21 })]),
          UI.el('div', { style: { minWidth: '0' } }, [
            UI.el('div', { class: 'badge-name', text: badge.label }),
            UI.el('div', { class: 'badge-desc', text: badge.desc })
          ])
        ]),
        UI.el('div', { class: 'badge-progress' }, [
          UI.el('span', { style: { width: badge.progress + '%' } })
        ]),
        UI.el('div', { class: 'badge-foot' }, [
          UI.el('span', { class: 'badge-count', text: badge.value + ' / ' + badge.goal }),
          UI.el('span', {}, [
            UI.icon(badge.unlocked ? 'check-circle' : 'lock', { size: 13 }),
            document.createTextNode(badge.unlocked ? ' Débloqué' : ' À débloquer')
          ])
        ])
      ]));
    });

    host.appendChild(grid);
  }

  /* ---------------------------------------------------------------------- */
  /* TCHAT                                                                  */
  /* ---------------------------------------------------------------------- */
  function renderChat() {
    if (!Store.isStaff()) return;

    UI.clear(dom.chatMembers);
    Store.staff()
      .slice()
      .sort(function (a, b) {
        var order = { delegue: 0, suppleant: 1 };
        return (order[a.role] || 2) - (order[b.role] || 2) || a.prenom.localeCompare(b.prenom, 'fr');
      })
      .forEach(function (profile) {
        dom.chatMembers.appendChild(UI.el('span', { class: 'member' }, [
          UI.avatar(profile.prenom, { size: 20 }),
          UI.el('span', { class: 'dot' + (Store.isOnline(profile) ? ' is-online' : '') }),
          document.createTextNode(profile.prenom),
          UI.el('span', { class: 'faint', text: '· ' + UI.roleLabel(profile.role) })
        ]));
      });

    if (dom.chatCount) {
      dom.chatCount.textContent = Store.state.messages.length + ' message' + (Store.state.messages.length > 1 ? 's' : '');
    }

    var log = dom.chatLog;
    if (!log) return;
    var stickToBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 80;
    UI.clear(log);

    if (!Store.state.messages.length) {
      log.appendChild(emptyState('chat', 'Aucun message',
        'Écris le premier mot aux autres délégués et suppléants : ce tchat n’est visible que par l’encadrement.'));
      return;
    }

    var lastDay = null;
    Store.state.messages.forEach(function (message) {
      var day = UI.dayKey(message.created_at);
      if (day !== lastDay) {
        log.appendChild(UI.el('div', { class: 'chat-day', text: UI.dayLabel(message.created_at) }));
        lastDay = day;
      }

      var mine = message.author_id === Store.state.me.id;
      log.appendChild(UI.el('div', {
        class: 'msg' + (mine ? ' msg--mine' : '') + (message.pending ? ' msg--pending' : ''),
        dataset: { messageId: String(message.id) }
      }, [
        mine ? null : UI.avatar(Store.nameOf(message.author_id), { size: 30 }),
        UI.el('div', { class: 'msg-col' }, [
          UI.el('div', { class: 'msg-meta' }, [
            UI.el('b', { text: mine ? 'Toi' : Store.nameOf(message.author_id) }),
            UI.el('span', { text: message.pending ? 'envoi…' : UI.clockTime(message.created_at) })
          ]),
          UI.el('div', { class: 'msg-bubble', text: message.body })
        ])
      ]));
    });

    if (stickToBottom) log.scrollTop = log.scrollHeight;
  }

  function sendChat() {
    var input = dom.chatInput;
    var text = input.value.trim();
    if (!text) { input.focus(); return; }

    dom.chatSend.disabled = true;
    input.value = '';
    autosize(input);

    Store.sendMessage(text)
      .then(function () {
        dom.chatSend.disabled = false;
        input.focus();
        if (state.tab === 'chat') {
          dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
        }
        if (FX) FX.sound('send');
      })
      .catch(function (error) {
        dom.chatSend.disabled = false;
        input.value = text;
        autosize(input);
        UI.err(UI.humanError(error));
      });
  }

  function autosize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(140, textarea.scrollHeight) + 'px';
  }

  function toggleEmoji() {
    var existing = UI.$('.emoji-pop');
    if (existing) { existing.remove(); dom.btnEmoji.setAttribute('aria-expanded', 'false'); return; }

    var emojis = ['😀', '😄', '😉', '😍', '🤩', '😎', '🙌', '👏', '👍', '🔥', '💜', '⭐', '🎉', '🍀', '☀️', '🌙',
      '😅', '🙈', '🤝', '💪', '✨', '🚀', '📚', '☕', '🎯', '😮', '😢', '🤔', '🫶', '✅', '❓', '💬'];

    var pop = UI.el('div', { class: 'emoji-pop', role: 'dialog', 'aria-label': 'Choisir un emoji' });
    emojis.forEach(function (emoji) {
      pop.appendChild(UI.el('button', {
        type: 'button', text: emoji, 'aria-label': 'Insérer ' + emoji,
        onclick: function () {
          var input = dom.chatInput;
          var start = input.selectionStart || input.value.length;
          input.value = input.value.slice(0, start) + emoji + input.value.slice(input.selectionEnd || start);
          input.focus();
          input.selectionStart = input.selectionEnd = start + emoji.length;
          autosize(input);
          closeEmoji();
        }
      }));
    });

    dom.chatForm.parentNode.insertBefore(pop, dom.chatForm);
    dom.btnEmoji.setAttribute('aria-expanded', 'true');
  }

  function closeEmoji() {
    var pop = UI.$('.emoji-pop');
    if (pop) pop.remove();
    if (dom.btnEmoji) dom.btnEmoji.setAttribute('aria-expanded', 'false');
  }

  /* ---------------------------------------------------------------------- */
  /* PROFIL                                                                 */
  /* ---------------------------------------------------------------------- */
  function renderProfile() {
    var host = UI.$('#profile-content');
    if (!host) return;
    UI.clear(host);

    var me = Store.state.me;
    var isEleve = Store.isEleve();
    var memberSince = me.created_at ? UI.monthYear(me.created_at) : '—';

    var heroCard = UI.el('div', { class: 'profile-hero' }, [
      UI.avatar(me.prenom, { size: 76 }),
      UI.el('div', { class: 'profile-info' }, [
        UI.el('div', { class: 'profile-name', text: me.prenom }),
        UI.el('div', { class: 'profile-meta' }, [
          UI.el('span', { class: 'role role--' + me.role, text: UI.roleLabel(me.role) }),
          UI.el('span', {}, [UI.icon('calendar', { size: 13 }), document.createTextNode(' Membre depuis ' + memberSince)]),
          Store.isOnline(me) ? UI.el('span', { class: 'pill pill--green' }, [UI.icon('pulse', { size: 12 }), document.createTextNode('en ligne')]) : null
        ])
      ]),
      isEleve ? UI.el('div', { style: { textAlign: 'right' } }, [
        UI.el('div', { class: 'profile-name', style: { fontSize: '2rem' }, text: String(me.points) }),
        UI.el('div', { class: 'faint', text: 'points · ' + (Store.rankOf(me.id) || '—') + 'e de la classe' })
      ]) : UI.el('div', { style: { textAlign: 'right' } }, [
        UI.el('div', { class: 'profile-name', style: { fontSize: '2rem' }, text: String(Insights.givenBy(Store.state.events, me.id)) }),
        UI.el('div', { class: 'faint', text: 'points distribués' })
      ])
    ]);
    host.appendChild(heroCard);

    /* Préférences */
    var prefs = panel({ title: 'Apparence & confort', icon: 'palette' });
    var prefsBody = prefs.querySelector('.panel-body');

    var themeRow = UI.el('div', { class: 'pref-row' }, [
      UI.el('span', { class: 'pref-ico' }, [UI.icon('sun', { size: 17 })]),
      UI.el('div', { style: { flex: '1' } }, [
        UI.el('div', { class: 'pref-label', text: 'Thème' }),
        UI.el('div', { class: 'pref-desc', text: 'Clair, sombre, ou comme le système.' })
      ])
    ]);
    var seg = UI.el('div', { class: 'segmented pref-action' });
    ['light', 'dark', 'auto'].forEach(function (mode) {
      seg.appendChild(UI.el('button', {
        type: 'button', class: 'seg-btn' + (Theme.mode() === mode ? ' is-active' : ''),
        text: Theme.label(mode),
        onclick: function () {
          Theme.set(mode);
          paintThemeButtons();
          UI.$$('.seg-btn', seg).forEach(function (btn) { btn.classList.remove('is-active'); });
          this.classList.add('is-active');
        }
      }));
    });
    themeRow.appendChild(seg);
    prefsBody.appendChild(themeRow);

    prefsBody.appendChild(prefToggle({
      icon: 'zap',
      label: 'Sons et vibrations',
      desc: 'Petits sons de confirmation lors des mouvements de points.',
      value: Prefs.get('sound') !== false,
      onChange: function (value) { Prefs.set('sound', value); if (value && FX) FX.sound('success'); }
    }));

    prefsBody.appendChild(prefToggle({
      icon: 'sparkles',
      label: 'Animations et confettis',
      desc: 'Désactive les effets visuels si tu préfères un écran calme.',
      value: Prefs.get('motion') !== false,
      onChange: function (value) { Prefs.set('motion', value); }
    }));

    prefsBody.appendChild(prefToggle({
      icon: 'bell',
      label: 'Notifications d’activité',
      desc: 'Afficher une bulle quand un point tombe ou qu’un message arrive.',
      value: Prefs.get('notifications') !== false,
      onChange: function (value) { Prefs.set('notifications', value); }
    }));

    host.appendChild(prefs);

    /* Sécurité */
    var security = panel({ title: 'Sécurité', icon: 'lock', sub: 'Ton mot de passe sert aussi d’identifiant de connexion.' });
    var securityBody = security.querySelector('.panel-body');
    securityBody.appendChild(UI.el('div', { class: 'pref-row' }, [
      UI.el('span', { class: 'pref-ico' }, [UI.icon('key', { size: 17 })]),
      UI.el('div', { style: { flex: '1' } }, [
        UI.el('div', { class: 'pref-label', text: 'Changer mon mot de passe' }),
        UI.el('div', { class: 'pref-desc', text: '6 caractères minimum. Tu restes connecté après le changement.' })
      ]),
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm pref-action', text: 'Modifier',
        onclick: openPasswordModal
      })
    ]));

    host.appendChild(security);

    /* Données */
    var data = panel({ title: 'Mes données', icon: 'download', sub: 'Tu peux récupérer ton historique à tout moment.' });
    var dataBody = data.querySelector('.panel-body');

    dataBody.appendChild(UI.el('div', { class: 'pref-row' }, [
      UI.el('span', { class: 'pref-ico' }, [UI.icon('download', { size: 17 })]),
      UI.el('div', { style: { flex: '1' } }, [
        UI.el('div', { class: 'pref-label', text: 'Exporter mon historique' }),
        UI.el('div', { class: 'pref-desc', text: 'Fichier CSV compatible Excel.' })
      ]),
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm pref-action', text: 'Exporter',
        onclick: exportCsv
      })
    ]));

    dataBody.appendChild(UI.el('div', { class: 'pref-row' }, [
      UI.el('span', { class: 'pref-ico' }, [UI.icon('link', { size: 17 })]),
      UI.el('div', { style: { flex: '1' } }, [
        UI.el('div', { class: 'pref-label', text: 'Partager le lien de la classe' }),
        UI.el('div', { class: 'pref-desc', text: 'À envoyer aux camarades qui ne connaissent pas encore le site.' })
      ]),
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm pref-action', text: 'Copier',
        onclick: function () {
          UI.copy(window.location.origin + window.location.pathname.replace('app.html', 'index.html'),
            'Lien de la classe copié.');
        }
      })
    ]));

    if (Store.state.demo) {
      dataBody.appendChild(UI.el('div', { class: 'pref-row' }, [
        UI.el('span', { class: 'pref-ico' }, [UI.icon('refresh', { size: 17 })]),
        UI.el('div', { style: { flex: '1' } }, [
          UI.el('div', { class: 'pref-label', text: 'Réinitialiser la démo' }),
          UI.el('div', { class: 'pref-desc', text: 'Revenir à la classe fictive de départ.' })
        ]),
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm pref-action', text: 'Réinitialiser',
          onclick: function () { window.location.reload(); }
        })
      ]));
    }

    host.appendChild(data);

    /* À propos + déconnexion */
    var about = panel({ title: 'À propos', icon: 'info' });
    var aboutBody = about.querySelector('.panel-body');
    aboutBody.appendChild(UI.el('p', { class: 'sub', style: { fontSize: '.86rem' },
      text: 'ECEM Point v' + (cfg.APP_VERSION || '2.0') + ' · site statique adossé à Supabase. ' +
        'Les points sont calculés côté serveur par des fonctions SQL : impossible de les modifier depuis le navigateur.' }));
    aboutBody.appendChild(UI.el('div', { class: 'row', style: { marginTop: '12px' } }, [
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: function () { window.open('https://github.com/djessim15-ctrl/ecem-point', '_blank', 'noopener'); }
      }, [UI.icon('github', { size: 16 }), document.createTextNode('Code source')]),
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: openHelpModal
      }, [UI.icon('book', { size: 16 }), document.createTextNode('Comment ça marche')])
    ]));

    var danger = UI.el('div', { class: 'danger-zone' }, [
      UI.el('div', { style: { flex: '1', minWidth: '160px' } }, [
        UI.el('div', { class: 'pref-label', text: 'Se déconnecter' }),
        UI.el('div', { class: 'pref-desc', text: 'Tu devras saisir à nouveau ton prénom et ton mot de passe.' })
      ]),
      UI.el('button', {
        type: 'button', class: 'btn btn-danger', onclick: logout
      }, [UI.icon('logout', { size: 17 }), document.createTextNode('Quitter')])
    ]);
    aboutBody.appendChild(danger);

    host.appendChild(about);
  }

  function prefToggle(opts) {
    var input = UI.el('input', {
      type: 'checkbox', checked: opts.value ? 'checked' : null,
      onchange: function () { opts.onChange(this.checked); }
    });
    return UI.el('div', { class: 'pref-row' }, [
      UI.el('span', { class: 'pref-ico' }, [UI.icon(opts.icon, { size: 17 })]),
      UI.el('div', { style: { flex: '1' } }, [
        UI.el('div', { class: 'pref-label', text: opts.label }),
        UI.el('div', { class: 'pref-desc', text: opts.desc })
      ]),
      UI.el('label', { class: 'switch pref-action' }, [
        input,
        UI.el('span', { class: 'switch-track', 'aria-hidden': 'true' })
      ])
    ]);
  }

  function openPasswordModal() {
    var password = UI.el('input', {
      type: 'password', id: 'new-password', autocomplete: 'new-password',
      placeholder: '••••••••', minlength: '6', required: 'required'
    });
    var confirm = UI.el('input', {
      type: 'password', id: 'new-password-2', autocomplete: 'new-password',
      placeholder: '••••••••', minlength: '6', required: 'required'
    });
    var error = UI.el('div', { class: 'alert alert--error is-hidden', role: 'alert' });
    var submit;

    var body = UI.frag([
      UI.el('p', { class: 'sub', style: { marginBottom: '16px' },
        text: 'Choisis un nouveau mot de passe de 6 caractères minimum. Il remplace immédiatement l’ancien.' }),
      UI.el('div', { class: 'field' }, [UI.el('label', { for: 'new-password', text: 'Nouveau mot de passe' }), password]),
      UI.el('div', { class: 'field' }, [UI.el('label', { for: 'new-password-2', text: 'Confirme le mot de passe' }), confirm]),
      error
    ]);

    var modal = UI.modal({
      title: 'Changer mon mot de passe',
      eye: 'key',
      body: body,
      footer: [
        UI.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onclick: function () { modal.close(); } }),
        submit = UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Enregistrer',
          onclick: function () {
            error.classList.add('is-hidden');
            var value = password.value;
            if (value.length < 6) {
              error.textContent = 'Le mot de passe doit faire au moins 6 caractères.';
              error.classList.remove('is-hidden');
              return;
            }
            if (value !== confirm.value) {
              error.textContent = 'Les deux mots de passe ne correspondent pas.';
              error.classList.remove('is-hidden');
              return;
            }

            submit.disabled = true;
            submit.textContent = 'Enregistrement…';

            sb.auth.updateUser({ password: value }).then(function (res) {
              if (res.error) throw res.error;
              UI.ok('Mot de passe mis à jour.');
              if (FX) FX.sound('success');
              modal.close();
            }).catch(function (err) {
              submit.disabled = false;
              submit.textContent = 'Enregistrer';
              error.textContent = UI.humanError(err);
              error.classList.remove('is-hidden');
            });
          }
        })
      ]
    });
  }

  function openHelpModal() {
    var steps = [
      ['Un prénom, un compte', 'Chaque prénom est unique dans la classe : c’est ton identifiant.'],
      ['Les points', 'Les délégués donnent 1 à 4 points et peuvent en retirer. Un solde ne descend jamais sous zéro.'],
      ['Les échanges', 'Un élève peut envoyer ses points à un camarade, dans la limite de son solde.'],
      ['Les rôles', 'Élève : reçoit et envoie. Suppléant : suit la classe, tchat. Délégué : distribue les points, tchat.'],
      ['La sécurité', 'Aucune écriture directe : tout passe par des fonctions SQL vérifiées côté serveur.']
    ];
    var body = UI.el('div', { class: 'stack', style: { gap: '14px' } });
    steps.forEach(function (step, index) {
      body.appendChild(UI.el('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
        UI.el('span', { class: 'role role--delegue', style: { flex: 'none' }, text: String(index + 1) }),
        UI.el('div', {}, [
          UI.el('div', { style: { fontWeight: 700 }, text: step[0] }),
          UI.el('p', { class: 'sub', style: { fontSize: '.88rem' }, text: step[1] })
        ])
      ]));
    });

    var modal = UI.modal({
      title: 'Comment ça marche',
      eye: 'book',
      body: body,
      footer: [UI.el('button', { type: 'button', class: 'btn btn-primary', text: 'Fermer', onclick: function () { modal.close(); } })]
    });
  }

  /* ---------------------------------------------------------------------- */
  /* ACTIONS SUR LES POINTS                                                 */
  /* ---------------------------------------------------------------------- */
  function doAward(profile, amount, trigger) {
    if (!Store.canAward()) {
      UI.err('Ton rôle ne permet pas de modifier les points.');
      return Promise.resolve();
    }
    if (!amount || amount < 1) { UI.err('Montant invalide.'); return Promise.resolve(); }

    if (FX) { FX.burst(trigger, 22); FX.sound('award'); FX.vibrate(14); }

    return Store.award(profile.id, amount)
      .then(function () {
        UI.toast('+' + amount + ' point' + (amount > 1 ? 's' : '') + ' pour ' + profile.prenom, 'star');
        var node = UI.$('[data-score="' + profile.id + '"]');
        if (node) FX.pop(node);
        refreshAfterAction();
      })
      .catch(function (error) {
        UI.err(UI.humanError(error));
        if (FX) FX.sound('error');
        Store.refreshProfiles().catch(function () {});
      });
  }

  function doRemove(profile, amount, trigger) {
    if (!Store.canAward()) { UI.err('Ton rôle ne permet pas de modifier les points.'); return Promise.resolve(); }
    amount = parseInt(amount, 10);
    if (!amount || amount < 1) { UI.err('Indique un nombre de points à retirer.'); return Promise.resolve(); }
    if (profile.points === 0) { UI.err(profile.prenom + ' n’a déjà plus de point.'); return Promise.resolve(); }

    var effective = Math.min(amount, profile.points);
    if (amount > effective) {
      UI.info('Seuls ' + effective + ' point' + (effective > 1 ? 's' : '') + ' ont pu être retirés.');
    }

    if (trigger) trigger.disabled = true;

    return Store.remove(profile.id, amount)
      .then(function () {
        UI.toast('−' + effective + ' point' + (effective > 1 ? 's' : '') + ' pour ' + profile.prenom, 'info');
        if (FX) { FX.sound('send'); FX.vibrate(10); }
        var node = UI.$('[data-score="' + profile.id + '"]');
        if (node) FX.pop(node);
        refreshAfterAction();
      })
      .catch(function (error) {
        UI.err(UI.humanError(error));
        if (FX) FX.sound('error');
        if (trigger) trigger.disabled = false;
      });
  }

  function doTransfer(profile, amount, trigger) {
    var balance = Store.myPoints();
    var min = Store.state.settings.transfer_min || 1;
    amount = parseInt(amount, 10);

    if (!amount || amount < min) {
      UI.err('Le minimum est de ' + min + ' point' + (min > 1 ? 's' : '') + '.');
      return Promise.resolve();
    }
    if (amount > balance) {
      UI.err('Tu n’as que ' + UI.pointsLabel(balance) + '.');
      return Promise.resolve();
    }

    if (trigger) trigger.disabled = true;
    if (FX) { FX.burst(trigger, 24); FX.sound('send'); FX.vibrate(12); }

    return Store.transfer(profile.id, amount)
      .then(function () {
        UI.toast('Tu as envoyé ' + UI.pointsLabel(amount) + ' à ' + profile.prenom, 'ok');
        if (FX) FX.sound('success');
        var pillNode = dom.mePointsValue;
        if (pillNode) FX.countTo(pillNode, Store.myPoints());
        refreshAfterAction();
      })
      .catch(function (error) {
        UI.err(UI.humanError(error));
        if (FX) FX.sound('error');
        if (trigger) trigger.disabled = false;
        Store.refreshProfiles().catch(function () {});
      });
  }

  function refreshAfterAction() {
    paintIdentity();
    paintScores();
    if (!isTyping()) renderCurrent();
    else state.pendingRender = true;
  }

  function bindViewControls() {
    /* Délégation : un seul écouteur pour toutes les cartes élèves. */
    dom.main.addEventListener('click', onListClick);

    if (dom.giveSearch) dom.giveSearch.addEventListener('input', function () {
      renderStudentGrid({
        host: UI.$('#give-list'), mode: 'award', countNode: UI.$('#give-count'),
        searchInput: dom.giveSearch, onlineBox: dom.giveOnline
      });
    });
    if (dom.giveOnline) dom.giveOnline.addEventListener('change', function () {
      renderStudentGrid({
        host: UI.$('#give-list'), mode: 'award', countNode: UI.$('#give-count'),
        searchInput: dom.giveSearch, onlineBox: dom.giveOnline
      });
    });
    if (dom.sendSearch) dom.sendSearch.addEventListener('input', function () {
      renderStudentGrid({
        host: UI.$('#send-list'), mode: 'send', countNode: UI.$('#send-count'),
        searchInput: dom.sendSearch, onlineBox: dom.sendOnline
      });
    });
    if (dom.sendOnline) dom.sendOnline.addEventListener('change', function () {
      renderStudentGrid({
        host: UI.$('#send-list'), mode: 'send', countNode: UI.$('#send-count'),
        searchInput: dom.sendSearch, onlineBox: dom.sendOnline
      });
    });

    UI.$$('#history-filters .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.historyKind = chip.dataset.kind;
        renderHistory();
      });
    });

    UI.$$('#rank-scope .seg-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        state.rankScope = button.dataset.scope;
        UI.$$('#rank-scope .seg-btn').forEach(function (other) {
          other.classList.toggle('is-active', other === button);
        });
        renderRank();
      });
    });

    var rankSearch = UI.$('#rank-search');
    if (rankSearch) {
      rankSearch.addEventListener('input', UI.debounce(function () {
        state.rankFilter = rankSearch.value;
        renderRank();
      }, 160));
    }

    if (dom.btnExport) dom.btnExport.addEventListener('click', exportCsv);

    if (dom.chatForm) {
      dom.chatForm.addEventListener('submit', function (event) {
        event.preventDefault();
        sendChat();
      });
    }
    if (dom.chatInput) {
      dom.chatInput.addEventListener('input', function () { autosize(dom.chatInput); });
      dom.chatInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendChat();
        }
      });
    }
    if (dom.btnEmoji) dom.btnEmoji.addEventListener('click', toggleEmoji);

    document.addEventListener('click', function (event) {
      var pop = UI.$('.emoji-pop');
      if (!pop) return;
      if (pop.contains(event.target) || (dom.btnEmoji && dom.btnEmoji.contains(event.target))) return;
      closeEmoji();
    });
  }

  function onListClick(event) {
    var button = event.target.closest ? event.target.closest('button[data-act]') : null;
    if (!button || button.disabled) return;

    var profile = Store.profileById(button.dataset.id);
    if (!profile) return;

    var action = button.dataset.act;
    var card = button.closest('.student');

    if (action === 'award') {
      var amount = parseInt(button.dataset.amount, 10);
      if (card) card.classList.add('is-busy');
      doAward(profile, amount, button);
      return;
    }

    if (action === 'remove') {
      var input = card ? card.querySelector('input[data-draft-for]') : null;
      var value = parseInt(input && input.value, 10);
      if (!value || value < 1) {
        UI.err('Indique un nombre de points à retirer.');
        if (input) input.focus();
        return;
      }
      if (card) card.classList.add('is-busy');
      doRemove(profile, value, button);
      return;
    }

    if (action === 'quick' || action === 'send') {
      var quickAmount = action === 'quick'
        ? parseInt(button.dataset.amount, 10)
        : parseInt((card && card.querySelector('input[data-draft-for]') || {}).value, 10);
      doTransfer(profile, quickAmount, button);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* DÉTAIL D'UN ÉLÈVE                                                      */
  /* ---------------------------------------------------------------------- */
  function openStudent(id) {
    var profile = Store.profileById(id);
    if (!profile) return;

    var me = Store.state.me;
    var events = Store.state.events.filter(function (event) {
      return event.subject_id === profile.id || event.counterparty_id === profile.id || event.actor_id === profile.id;
    });
    var rank = profile.role === 'eleve' ? Store.rankOf(profile.id) : 0;

    var stats = UI.el('div', { class: 'student-modal-stats' }, [
      UI.el('div', { class: 'mini-stat' }, [
        UI.el('b', { text: String(profile.points) }),
        UI.el('span', { text: 'points' })
      ]),
      UI.el('div', { class: 'mini-stat' }, [
        UI.el('b', { text: rank ? '#' + rank : '—' }),
        UI.el('span', { text: 'rang' })
      ]),
      UI.el('div', { class: 'mini-stat' }, [
        UI.el('b', { text: String(Insights.received(events, profile.id)) }),
        UI.el('span', { text: 'reçus' })
      ])
    ]);

    var history = UI.el('div', { class: 'feed', style: { marginBottom: '4px' } });
    if (!events.length) {
      history.appendChild(UI.el('p', { class: 'sub', text: 'Aucun mouvement enregistré à son sujet.' }));
    } else {
      events.slice(0, 5).forEach(function (event) { history.appendChild(feedItem(event)); });
    }

    var actions = [];
    if (Store.canAward() && profile.role === 'eleve' && profile.id !== me.id) {
      var row = UI.el('div', { class: 'quick-chips', style: { marginTop: '14px' } });
      var min = Store.state.settings.award_min || 1;
      var max = Store.state.settings.award_max || 4;
      for (var amount = min; amount <= max; amount++) {
        row.appendChild(UI.el('button', {
          type: 'button', class: 'quick-chip', text: 'Donner +' + amount,
          onclick: function (event) {
            doAward(profile, parseInt(this.textContent.replace(/\D+/g, ''), 10), event.currentTarget);
            modal.close();
          }
        }));
      }
      actions.push(UI.el('div', {}, [
        UI.el('div', { class: 'faint', style: { marginTop: '14px', fontWeight: 700 }, text: 'Récompenser' }),
        row
      ]));
    }

    if (Store.isEleve() && profile.role === 'eleve' && profile.id !== me.id && me.points > 0) {
      actions.push(UI.el('div', { style: { marginTop: '12px' } }, [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          onclick: function () { modal.close(); showTab('send'); }
        }, [UI.icon('send', { size: 15 }), document.createTextNode('Envoyer des points à ' + profile.prenom)])
      ]));
    }

    var body = UI.frag([
      UI.el('div', { class: 'student-modal-head' }, [
        UI.avatar(profile.prenom, { size: 56 }),
        UI.el('div', { style: { flex: '1' } }, [
          UI.el('div', { class: 'modal-title', text: profile.prenom }),
          UI.el('div', { class: 'row', style: { gap: '8px', marginTop: '4px' } }, [
            UI.el('span', { class: 'role role--' + profile.role, text: UI.roleLabel(profile.role) }),
            presence(profile)
          ])
        ])
      ]),
      stats,
      UI.el('div', { class: 'faint', style: { fontWeight: 700, marginBottom: '6px' }, text: 'Derniers mouvements' }),
      history
    ].concat(actions));

    var modal = UI.modal({
      title: 'Fiche élève',
      sub: 'Points, rang et derniers mouvements.',
      eye: 'user',
      body: body,
      footer: [
        UI.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onclick: function () { modal.close(); } })
      ]
    });
  }

  /* ---------------------------------------------------------------------- */
  /* NOTIFICATIONS                                                          */
  /* ---------------------------------------------------------------------- */
  function openNotifications() {
    state.unseenEvents = 0;
    paintUnreadCounts();
    try { window.localStorage.setItem('ecem-notif-seen', String(Date.now())); } catch (e) {}

    var events = Store.state.events.slice(0, 14);
    var body = UI.el('div', {}, [
      events.length
        ? (function () {
            var feed = UI.el('div', { class: 'feed' });
            events.forEach(function (event) { feed.appendChild(feedItem(event)); });
            return feed;
          })()
        : emptyState('bell', 'Aucune notification', 'Les prochains mouvements de points apparaîtront ici.')
    ]);

    var modal = UI.modal({
      title: 'Notifications',
      sub: Store.isEleve() ? 'Les derniers mouvements qui te concernent' : 'Les derniers mouvements de la classe',
      eye: 'bell',
      body: body,
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Tout l’historique',
          onclick: function () { modal.close(); showTab('history'); }
        }),
        UI.el('button', { type: 'button', class: 'btn btn-primary', text: 'Fermer', onclick: function () { modal.close(); } })
      ]
    });
  }

  /* ---------------------------------------------------------------------- */
  /* PALETTE DE COMMANDES                                                   */
  /* ---------------------------------------------------------------------- */
  function openPalette() {
    var input = UI.el('input', {
      type: 'text', class: 'palette-input', placeholder: 'Aller à, chercher un élève, lancer une action…',
      autocomplete: 'off', 'aria-label': 'Rechercher'
    });
    var list = UI.el('div', { class: 'palette-list', role: 'listbox' });

    var commands = tabsFor().map(function (tab) {
      return {
        group: 'Navigation', label: tab.label, icon: tab.icon,
        run: function () { showTab(tab.id); }
      };
    });

    commands.push(
      { group: 'Actions', label: 'Exporter l’historique (CSV)', icon: 'download', run: exportCsv },
      { group: 'Actions', label: 'Changer de thème', icon: 'palette', run: function () { Theme.cycle(); paintThemeButtons(); } },
      { group: 'Actions', label: 'Notifications', icon: 'bell', run: openNotifications },
      { group: 'Actions', label: 'Se déconnecter', icon: 'logout', run: logout }
    );

    Store.students().forEach(function (profile) {
      commands.push({
        group: 'Élèves', label: profile.prenom, icon: 'user',
        sub: profile.points + ' pts',
        run: function () { openStudent(profile.id); }
      });
    });

    var active = 0;
    var visible = [];

    function renderList(term) {
      UI.clear(list);
      visible = commands.filter(function (command) {
        return !term || UI.normalize(command.label).indexOf(UI.normalize(term)) >= 0;
      });
      active = 0;

      if (!visible.length) {
        list.appendChild(UI.el('div', { class: 'palette-empty', text: 'Aucun résultat pour « ' + term + ' ».' }));
        return;
      }

      var lastGroup = null;
      visible.forEach(function (command, index) {
        if (command.group !== lastGroup) {
          list.appendChild(UI.el('div', { class: 'palette-group', text: command.group }));
          lastGroup = command.group;
        }
        var item = UI.el('button', {
          type: 'button', class: 'palette-item' + (index === active ? ' is-active' : ''),
          role: 'option', dataset: { index: String(index) },
          onclick: function () { close(); command.run(); }
        }, [
          UI.icon(command.icon, { size: 18 }),
          UI.el('b', { text: command.label }),
          command.sub ? UI.el('span', { class: 'palette-sub', text: command.sub }) : null
        ]);
        list.appendChild(item);
      });
    }

    var modal = UI.modal({
      class: 'modal-wide palette-panel',
      body: UI.frag([
        UI.el('div', { class: 'palette-input-wrap' }, [UI.icon('search', { size: 18 }), input]),
        list,
        UI.el('div', { class: 'palette-foot' }, [
          UI.el('span', {}, [UI.el('kbd', { text: '↑↓' }), document.createTextNode('naviguer')]),
          UI.el('span', {}, [UI.el('kbd', { text: 'Entrée' }), document.createTextNode('ouvrir')]),
          UI.el('span', {}, [UI.el('kbd', { text: 'Échap' }), document.createTextNode('fermer')])
        ])
      ]),
      dismissible: true
    });

    function close() { modal.close(); }

    function move(delta) {
      if (!visible.length) return;
      active = (active + delta + visible.length) % visible.length;
      UI.$$('.palette-item', list).forEach(function (node, index) {
        node.classList.toggle('is-active', index === active);
        if (index === active) node.scrollIntoView({ block: 'nearest' });
      });
    }

    input.addEventListener('input', function () { renderList(input.value.trim()); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        var command = visible[active];
        if (command) { close(); command.run(); }
      }
    });

    renderList('');
    window.setTimeout(function () { input.focus(); }, 20);
  }

  /* ---------------------------------------------------------------------- */
  /* EXPORT                                                                 */
  /* ---------------------------------------------------------------------- */
  function exportCsv() {
    var rows = [['Date', 'Type', 'Points', 'Élève', 'Contrepartie', 'Auteur']];
    Store.state.events.forEach(function (event) {
      rows.push([
        new Date(event.created_at).toLocaleString('fr-FR'),
        event.kind,
        event.amount,
        Store.nameOf(event.subject_id),
        event.counterparty_id ? Store.nameOf(event.counterparty_id) : '',
        event.actor_id ? Store.nameOf(event.actor_id) : ''
      ]);
    });

    if (rows.length === 1) {
      UI.info('Rien à exporter pour l’instant.');
      return;
    }

    UI.download('ecem-point-historique-' + new Date().toISOString().slice(0, 10) + '.csv',
      '\uFEFF' + UI.csv(rows), 'text/csv;charset=utf-8');
    UI.ok('Historique exporté (' + (rows.length - 1) + ' lignes).');
  }

  /* ---------------------------------------------------------------------- */
  /* DÉMO                                                                   */
  /* ---------------------------------------------------------------------- */
  function buildDemoStrip() {
    UI.clear(dom.demoHost);
    var roles = [
      { id: 'eleve', label: 'Élève' },
      { id: 'delegue', label: 'Délégué' },
      { id: 'suppleant', label: 'Suppléant' }
    ];

    var current = 'eleve';
    try { current = window.localStorage.getItem('ecem-demo-role') || 'delegue'; } catch (e) {}

    var seg = UI.el('div', { class: 'segmented' });
    roles.forEach(function (role) {
      seg.appendChild(UI.el('button', {
        type: 'button', class: 'seg-btn' + (role.id === current ? ' is-active' : ''),
        text: role.label,
        onclick: function () {
          try { window.localStorage.setItem('ecem-demo-role', role.id); } catch (e) {}
          window.location.reload();
        }
      }));
    });

    dom.demoHost.appendChild(UI.el('div', { class: 'demo-strip' }, [
      UI.icon('wand', { size: 16 }),
      UI.el('span', {}, [
        UI.el('strong', { text: 'Mode démo' }),
        document.createTextNode(' — classe fictive, données en mémoire. ')
      ]),
      seg,
      UI.el('a', {
        href: 'index.html', class: 'link', style: { marginLeft: 'auto' },
        text: 'Quitter la démo'
      })
    ]));
  }

  /* ---------------------------------------------------------------------- */
  /* DÉCONNEXION                                                            */
  /* ---------------------------------------------------------------------- */
  function logout() {
    if (Store.state.demo) {
      window.location.href = 'index.html';
      return;
    }

    UI.confirm({
      title: 'Se déconnecter ?',
      message: 'Tu devras saisir ton prénom et ton mot de passe pour revenir.',
      confirm: 'Se déconnecter',
      danger: true,
      eye: 'logout'
    }).then(function (ok) {
      if (!ok) return;
      Store.signOut().then(function () {
        window.location.replace('index.html');
      }).catch(function () {
        window.location.replace('index.html');
      });
    });
  }
})();
