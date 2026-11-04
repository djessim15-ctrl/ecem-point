/* ============================================================================
 * ECEM Point — mode démo
 * ----------------------------------------------------------------------------
 * Un faux client Supabase, entièrement en mémoire, qui imite l'API utilisée par
 * le site (from().select().eq()…, rpc(), auth, realtime). Il sert à :
 *
 *   • visiter l'application sans compte ni base (app.html?demo=1) ;
 *   • montrer l'interface, les statistiques, les succès et le tchat ;
 *   • tester les trois rôles (élève / suppléant / délégué).
 *
 * Rien n'est envoyé sur le réseau, rien n'est écrit ailleurs que dans la
 * mémoire de l'onglet. Dès que l'URL ne contient plus ?demo=1, le site utilise
 * le vrai client Supabase : la démo est totalement inerte.
 * ==========================================================================*/
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var ON = params.get('demo') === '1';
  var ROLE_KEY = 'ecem-demo-role';

  if (!ON) return;

  /* -------------------------------------------------------------------------
   * Petits outils
   * ---------------------------------------------------------------------- */
  var seed = 20261104;

  function rand() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  function between(min, max) {
    return Math.floor(rand() * (max - min + 1)) + min;
  }

  function pick(list) {
    return list[Math.floor(rand() * list.length)];
  }

  function uuid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 10);
  }

  var now = Date.now();
  var iso = function (ago) { return new Date(now - ago).toISOString(); };

  function getRole() {
    try {
      var value = window.localStorage.getItem(ROLE_KEY);
      return value === 'eleve' || value === 'suppleant' || value === 'delegue' ? value : 'delegue';
    } catch (e) {
      return 'delegue';
    }
  }

  function setRole(role) {
    try { window.localStorage.setItem(ROLE_KEY, role); } catch (e) {}
    db.meId = idsFor(role);
  }

  var ACCOUNTS = {
    delegue: { id: 'demo-delegue', prenom: 'Mme Roux' },
    suppleant: { id: 'demo-suppleant', prenom: 'Lina' },
    eleve: { id: 'demo-eleve', prenom: 'Léa' }
  };

  function idsFor(role) {
    return ACCOUNTS[role] ? ACCOUNTS[role].id : ACCOUNTS.delegue.id;
  }

  /* -------------------------------------------------------------------------
   * Jeu de données
   * ---------------------------------------------------------------------- */
  var ELEVES = [
    'Léa', 'Yanis', 'Inès', 'Adam', 'Sofia', 'Noah', 'Jade', 'Lucas',
    'Emma', 'Rayan', 'Chloé', 'Nino', 'Manon', 'Gabriel', 'Sarah', 'Théo',
    'Aya', 'Maël'
  ];

  var STAFF = [
    { id: 'demo-delegue', prenom: 'Mme Roux', role: 'delegue' },
    { id: 'demo-delegue-2', prenom: 'Karim', role: 'delegue' },
    { id: 'demo-suppleant', prenom: 'Lina', role: 'suppleant' },
    { id: 'demo-suppleant-2', prenom: 'Paul', role: 'suppleant' }
  ];

  function makeProfiles() {
    var list = [];

    ELEVES.forEach(function (prenom, index) {
      var id = index === 0 ? ACCOUNTS.eleve.id : 'demo-eleve-' + (index + 1);
      list.push({
        id: id,
        prenom: prenom,
        role: 'eleve',
        points: 0,
        last_seen_at: iso(between(20, 60) * 60000 * (index % 3 === 0 ? 1 : between(1, 40))),
        created_at: iso(between(9, 60) * 86400000)
      });
    });

    STAFF.forEach(function (member) {
      list.push({
        id: member.id,
        prenom: member.prenom,
        role: member.role,
        points: 0,
        last_seen_at: iso(between(1, 9) * 60000),
        created_at: iso(between(30, 70) * 86400000)
      });
    });

    /* Quelques camarades doivent être « en ligne » pour la démo. */
    list.forEach(function (profile, index) {
      if (profile.role === 'eleve' && index % 4 === 0) profile.last_seen_at = iso(between(1, 40) * 1000);
    });

    return list;
  }

  var profiles = makeProfiles();

  function studentIds() {
    return profiles.filter(function (p) { return p.role === 'eleve'; }).map(function (p) { return p.id; });
  }

  function staffIds() {
    return profiles.filter(function (p) { return p.role !== 'eleve'; }).map(function (p) { return p.id; });
  }

  function byId(id) {
    for (var i = 0; i < profiles.length; i++) if (profiles[i].id === id) return profiles[i];
    return null;
  }

  function makeEvents() {
    var events = [];
    var counter = 0;

    function add(event) {
      counter++;
      events.push(Object.assign({
        id: 'evt-' + counter,
        note: null,
        created_at: iso(between(1, 6) * 86400000)
      }, event));
    }

    /* 7 journées d'activité, avec plus de mouvements aujourd'hui. */
    for (var day = 6; day >= 0; day--) {
      var count = day === 0 ? 11 : between(4, 9);
      for (var i = 0; i < count; i++) {
        var moment = day * 86400000 + between(8, 20) * 3600000 + between(0, 59) * 60000;
        var student = pick(studentIds());
        var staff = pick(staffIds());
        var roll = rand();

        if (roll < 0.58) {
          add({ kind: 'gain', amount: between(1, 4), subject_id: student, counterparty_id: null, actor_id: staff, created_at: iso(moment) });
        } else if (roll < 0.78) {
          add({ kind: 'retrait', amount: between(1, 2), subject_id: student, counterparty_id: null, actor_id: staff, created_at: iso(moment) });
        } else {
          var other = pick(studentIds());
          if (other === student) continue;
          add({ kind: 'transfert', amount: between(1, 2), subject_id: student, counterparty_id: other, actor_id: student, created_at: iso(moment) });
        }
      }
    }

    /* Quelques mouvements garantis pour le compte élève de la démo : le
     * tableau de bord a ainsi toujours de quoi raconter quelque chose. */
    events.push(
      { id: 'evt-forced-1', kind: 'gain', amount: 3, subject_id: ACCOUNTS.eleve.id, counterparty_id: null, actor_id: 'demo-delegue', note: null, created_at: iso(35 * 60000) },
      { id: 'evt-forced-2', kind: 'transfert', amount: 2, subject_id: 'demo-eleve-4', counterparty_id: ACCOUNTS.eleve.id, actor_id: 'demo-eleve-4', note: null, created_at: iso(20 * 3600000) },
      { id: 'evt-forced-3', kind: 'gain', amount: 2, subject_id: ACCOUNTS.eleve.id, counterparty_id: null, actor_id: 'demo-suppleant', note: null, created_at: iso(2 * 86400000 + 3600000) },
      { id: 'evt-forced-4', kind: 'gain', amount: 1, subject_id: ACCOUNTS.eleve.id, counterparty_id: null, actor_id: 'demo-delegue-2', note: null, created_at: iso(4 * 86400000 + 7200000) }
    );

    events.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });

    /* On rejoue l'historique pour que les soldes soient cohérents. */
    profiles.forEach(function (p) { if (p.role === 'eleve') p.points = 0; });
    events.forEach(function (event) {
      var subject = byId(event.subject_id);
      var other = event.counterparty_id ? byId(event.counterparty_id) : null;
      if (event.kind === 'gain' && subject) subject.points += event.amount;
      if (event.kind === 'transfert' && subject && other && subject.points >= event.amount) {
        subject.points -= event.amount;
        other.points += event.amount;
      }
      if (event.kind === 'retrait' && subject) subject.points = Math.max(0, subject.points - event.amount);
    });

    /* Personne ne doit rester à zéro dans une démo. */
    profiles.forEach(function (p) {
      if (p.role === 'eleve' && p.points < 3) p.points += 3 + (p.prenom.length % 7);
    });

    return events;
  }

  var events = makeEvents();

  var messages = [
    { id: 1, author_id: 'demo-delegue-2', body: 'Salut tout le monde 👋 On distribue les points cet après-midi, pensez à vous connecter !', created_at: iso(5 * 3600000) },
    { id: 2, author_id: 'demo-suppleant', body: 'Ça marche. Les 3e ont été très participatifs ce matin, je propose +2 pour ceux qui ont rendu leur fiche.', created_at: iso(4.6 * 3600000) },
    { id: 3, author_id: 'demo-delegue', body: 'Bonne idée. Je m’occupe de la liste, on valide ensemble avant 15 h ?', created_at: iso(4.2 * 3600000) },
    { id: 4, author_id: 'demo-suppleant-2', body: 'Je peux m’occuper du tchat pendant la récré si besoin.', created_at: iso(3.4 * 3600000) },
    { id: 5, author_id: 'demo-delegue-2', body: 'Parfait. Et n’oubliez pas : on ne descend jamais sous zéro 🙂', created_at: iso(1.8 * 3600000) },
    { id: 6, author_id: 'demo-suppleant', body: 'D’ailleurs le classement bouge pas mal cette semaine, Jade revient fort 🔥', created_at: iso(52 * 60000) }
  ];

  /* Tchat de classe : messages de démonstration, dont un adouci par le filtre. */
  var classMessages = [
    {
      id: 901, author_id: 'demo-eleve',
      body: 'Bonjour à tous ! Est-ce que quelqu’un peut m’expliquer l’exercice 4 ?',
      body_raw: null, level: 'doux', flagged: false, categories: [], severity: 0,
      source: 'ia:gpt-oss-120b', created_at: iso(3.2 * 3600000),
      is_annonce: false, hidden: false, edited_at: null
    },
    {
      id: 902, author_id: 'demo-eleve-2',
      body: 'N’importe quoi… enfin si, tu es vraiment un champion !',
      body_raw: 'N’importe quoi, t’es vraiment un abruti', level: 'doux',
      flagged: true, categories: ['insulte'], severity: 2,
      source: 'ia:gpt-oss-120b', created_at: iso(2.1 * 3600000),
      is_annonce: false, hidden: false, edited_at: null
    },
    {
      id: 903, author_id: 'demo-delegue',
      body: 'Sortie pédagogique jeudi : rendez-vous devant le collège à 8 h 15, avec un pique-nique.',
      body_raw: null, level: 'doux', flagged: false, categories: [], severity: 0,
      source: 'ia:gpt-oss-120b', created_at: iso(1.4 * 3600000),
      is_annonce: true, hidden: false, edited_at: null
    },
    {
      id: 904, author_id: 'demo-delegue',
      body: 'Merci à tous pour votre calme, vous êtes absolument formidables ✨',
      body_raw: null, level: 'ultra', flagged: false, categories: [], severity: 0,
      source: 'ia:gpt-oss-120b', created_at: iso(0.6 * 3600000),
      is_annonce: false, hidden: false, edited_at: null
    }
  ];

  /* Messages privés de démonstration (dont un signalé par le filtre). */
  var reactions = [];
  var reports = [];
  var privateMessages = [
    {
      id: 801, sender_id: 'demo-eleve-2', recipient_id: 'demo-eleve',
      body: 'Salut ! Tu peux m’envoyer la photo du cours de maths ?',
      body_raw: null, level: 'genant', flagged: false, categories: [], severity: 0,
      source: 'ia:gpt-oss-120b', created_at: iso(2.4 * 3600000)
    },
    {
      id: 803, sender_id: 'demo-eleve-2', recipient_id: 'demo-delegue',
      body: 'Je suis désolé de t’avoir répondu comme ça, je m’excuse platement 🙏',
      body_raw: 'Tu sers à rien comme délégué', level: 'genant',
      flagged: true, categories: ['agressivite'], severity: 2,
      source: 'ia:gpt-oss-120b', created_at: iso(1.1 * 3600000)
    },
    {
      id: 804, sender_id: 'demo-delegue', recipient_id: 'demo-eleve-2',
      body: 'Merci pour ce message. Si quelque chose ne va pas, viens m’en parler 🙂',
      body_raw: null, level: 'genant', flagged: false, categories: [], severity: 0,
      source: 'ia:gpt-oss-120b', created_at: iso(0.9 * 3600000)
    },
    {
      id: 805, sender_id: 'demo-eleve-2', recipient_id: 'demo-suppleant',
      body: 'Bonjour, est-ce que je peux te parler après le cours ?',
      body_raw: null, level: 'genant', flagged: false, categories: [], severity: 0,
      source: 'ia:gpt-oss-120b', created_at: iso(0.5 * 3600000)
    },
    {
      id: 802, sender_id: 'demo-eleve', recipient_id: 'demo-eleve-2',
      body: 'Je ne suis pas d’accord, mais je te respecte petit nuage.',
      body_raw: 'Mais t’es vraiment un abruti ou quoi ?', level: 'doux',
      flagged: true, categories: ['insulte'], severity: 2,
      source: 'ia:gpt-oss-120b', created_at: iso(1.6 * 3600000)
    }
  ];

  var settings = {
    id: 1,
    golden_until: null,
    golden_multiplier: 2,
    compliment_force: false,
    suppleant_can_award: true,
    award_min: 1,
    award_max: 4,
    transfer_min: 1,
    online_window_seconds: 90
  };

  /* -------------------------------------------------------------------------
   * Abonnés « temps réel »
   * ---------------------------------------------------------------------- */
  var listeners = { profiles: [], point_events: [], staff_messages: [] };

  function emit(table, payload) {
    (listeners[table] || []).forEach(function (cb) {
      try { cb(payload); } catch (e) { /* la démo ne doit jamais casser l'UI */ }
    });
  }

  function touchProfile(profile) {
    emit('profiles', { eventType: 'UPDATE', new: Object.assign({}, profile), old: {} });
  }

  function addEvent(event) {
    events.push(event);
    emit('point_events', { eventType: 'INSERT', new: Object.assign({}, event) });
  }

  /* -------------------------------------------------------------------------
   * Requêtes façon Supabase
   * ---------------------------------------------------------------------- */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function tableData(table) {
    if (table === 'profiles') return profiles;
    if (table === 'point_events') return events;
    if (table === 'staff_messages') return messages;
    if (table === 'app_settings') return [settings];
    return [];
  }

  function Builder(table) {
    this.table = table;
    this.filters = [];
    this.orderBy = null;
    this.limitTo = null;
    this.mode = 'select';
    this.payload = null;
    this.singleMode = null;
    this.columns = '*';
  }

  Builder.prototype.select = function (cols) {
    this.columns = cols || '*';
    return this;
  };

  Builder.prototype.eq = function (column, value) {
    this.filters.push({ column: column, value: value });
    return this;
  };

  Builder.prototype.neq = function (column, value) {
    this.filters.push({ column: column, value: value, not: true });
    return this;
  };

  Builder.prototype.order = function (column, opts) {
    this.orderBy = { column: column, ascending: !opts || opts.ascending !== false };
    return this;
  };

  Builder.prototype.limit = function (n) {
    this.limitTo = n;
    return this;
  };

  Builder.prototype.maybeSingle = function () {
    this.singleMode = 'maybe';
    return this;
  };

  Builder.prototype.single = function () {
    this.singleMode = 'single';
    return this;
  };

  Builder.prototype.insert = function (row) {
    this.mode = 'insert';
    this.payload = row;
    return this;
  };

  Builder.prototype.then = function (resolve, reject) {
    var promise;
    try {
      promise = Promise.resolve(this.run());
    } catch (error) {
      promise = Promise.reject(error);
    }
    return promise.then(resolve, reject);
  };

  Builder.prototype.run = function () {
    var rows = tableData(this.table).slice();

    if (this.mode === 'insert') {
      var list = Array.isArray(this.payload) ? this.payload : [this.payload];
      var added = list.map(function (row) {
        var clean = Object.assign({}, row);
        if (this.table === 'staff_messages') {
          clean.id = Math.max.apply(null, messages.map(function (m) { return m.id; }).concat([0])) + 1;
          clean.created_at = new Date().toISOString();
        }
        tableData(this.table).push(clean);
        return clean;
      }, this);

      added.forEach(function (row) {
        emit(this.table, { eventType: 'INSERT', new: Object.assign({}, row) });
      }, this);

      return { data: this.singleMode ? (added[0] || null) : added, error: null };
    }

    var self = this;
    rows = rows.filter(function (row) {
      return self.filters.every(function (filter) {
        var match = row[filter.column] === filter.value;
        return filter.not ? !match : match;
      });
    });

    if (this.orderBy) {
      var column = this.orderBy.column;
      var direction = this.orderBy.ascending ? 1 : -1;
      rows.sort(function (a, b) {
        var va = a[column];
        var vb = b[column];
        if (va === vb) return 0;
        return (va > vb ? 1 : -1) * direction;
      });
    }

    if (this.limitTo) rows = rows.slice(0, this.limitTo);
    rows = clone(rows);

    if (this.singleMode) {
      var row = rows[0] || null;
      if (!row && this.singleMode === 'single') {
        return { data: null, error: { message: 'Ligne introuvable (démo).', code: 'PGRST116' } };
      }
      return { data: row, error: null };
    }

    return { data: rows, error: null };
  };

  /* -------------------------------------------------------------------------
   * RPC
   * ---------------------------------------------------------------------- */
  function fail(code) {
    throw new Error(code);
  }

  function session() {
    var role = getRole();
    var account = ACCOUNTS[role];
    return {
      access_token: 'demo-token',
      token_type: 'bearer',
      user: { id: account.id, email: account.prenom.toLowerCase().replace(/\W+/g, '.') + '@ecem-point.fr' }
    };
  }

  var rpc = {
    claim_staff_code: function () { return 'demo-token'; },
    release_staff_code: function () { return true; },
    activate_account: function (args) { return { id: String(args.p_prenom), prenom: args.p_prenom, role: args.p_role, points: 0 }; },
    class_chat_feed: function () {
      var admin = !!db.demoAdmin || getRole() === 'delegue';
      return classMessages.filter(function (m) { return admin || !m.hidden; }).map(function (m) {
        return {
          id: m.id, author_id: m.author_id, body: m.body, body_raw: m.body_raw || null,
          level: m.level, flagged: !!m.flagged, categories: m.categories || [],
          severity: m.severity || 0, created_at: m.created_at,
          reply_to: m.reply_to || null, pinned: !!m.pinned,
          is_annonce: !!m.is_annonce, hidden: !!m.hidden, edited_at: m.edited_at || null,
          cible: m.cible || null, motif: m.motif || null
        };
      });
    },
    class_chat_send: function (args) {
      var me = byId(db.meId);
      var row = {
        id: classMessages.length + 1000,
        author_id: me ? me.id : profiles[0].id,
        body: args.p_body,
        body_raw: args.p_body_raw || null,
        level: args.p_level || 'genant',
        flagged: !!args.p_flagged,
        categories: args.p_categories || [],
        severity: args.p_severity || 0,
        source: args.p_source || null,
        reply_to: args.p_reply_to || null,
        pinned: false,
        is_annonce: false, hidden: false, edited_at: null,
        cible: args.p_cible || null, motif: args.p_motif || null,
        created_at: new Date().toISOString()
      };
      classMessages.push(row);
      return { id: row.id, created_at: row.created_at, flagged: row.flagged };
    },
    class_annonce_send: function (args) {
      if (getRole() === 'eleve' && !db.demoAdmin) fail('INTERDIT');
      var me = byId(db.meId);
      var row = {
        id: classMessages.length + 2000,
        author_id: me ? me.id : profiles[0].id,
        body: args.p_body,
        body_raw: args.p_body_raw || null,
        level: args.p_level || 'doux',
        flagged: !!args.p_flagged,
        categories: args.p_categories || [],
        severity: args.p_severity || 0,
        source: args.p_source || null,
        reply_to: null,
        pinned: false,
        is_annonce: true, hidden: false, edited_at: null,
        cible: args.p_cible || null, motif: args.p_motif || null,
        created_at: new Date().toISOString()
      };
      classMessages.push(row);
      return { id: row.id, created_at: row.created_at, annonce: true, flagged: row.flagged };
    },
    admin_message_hide: function (args) {
      if (!db.demoAdmin && getRole() !== 'delegue') fail('INTERDIT');
      var masquer = args.p_hidden !== false;
      for (var i = 0; i < classMessages.length; i++) {
        if (String(classMessages[i].id) === String(args.p_id)) {
          classMessages[i].hidden = masquer;
          return { id: args.p_id, hidden: masquer };
        }
      }
      fail('MESSAGE_INTROUVABLE');
    },
    admin_message_edit: function (args) {
      if (!db.demoAdmin && getRole() !== 'delegue') fail('INTERDIT');
      for (var i = 0; i < classMessages.length; i++) {
        if (String(classMessages[i].id) === String(args.p_id)) {
          classMessages[i].body = args.p_body;
          classMessages[i].edited_at = new Date().toISOString();
          return { id: args.p_id, body: args.p_body };
        }
      }
      fail('MESSAGE_INTROUVABLE');
    },
    class_report: function (args) {
      var id = String(args.p_id);
      for (var i = 0; i < reports.length; i++) {
        if (String(reports[i].message_id) === id && reports[i].reporter_id === db.meId) {
          return { signale: true, deja: true };
        }
      }
      reports.push({
        id: reports.length + 1,
        message_id: args.p_id,
        reporter_id: db.meId,
        motif: args.p_motif || 'signale',
        created_at: new Date().toISOString()
      });
      return { signale: true, deja: false };
    },
    class_reports_feed: function (args) {
      if (getRole() === 'eleve' && !db.demoAdmin) fail('INTERDIT');
      var groupes = {};
      reports.forEach(function (r) {
        var cle = String(r.message_id);
        if (!groupes[cle]) groupes[cle] = { message_id: r.message_id, motif: r.motif, nb: 0, created_at: r.created_at };
        groupes[cle].nb += 1;
      });
      var limite = (args && args.p_limit) || 40;
      return Object.keys(groupes).map(function (cle) {
        var g = groupes[cle];
        var message = null;
        for (var i = 0; i < classMessages.length; i++) {
          if (String(classMessages[i].id) === cle) message = classMessages[i];
        }
        var auteur = message ? byId(message.author_id) : null;
        return {
          id: g.message_id,
          message_id: g.message_id,
          auteur: auteur ? auteur.prenom : 'Compte',
          extrait: message ? String(message.body).slice(0, 180) : '',
          motif: g.motif,
          nb: g.nb,
          created_at: g.created_at
        };
      }).slice(0, limite);
    },
    admin_message_delete: function (args) {
      if (!db.demoAdmin && getRole() !== 'delegue') fail('INTERDIT');
      for (var i = classMessages.length - 1; i >= 0; i--) {
        if (String(classMessages[i].id) === String(args.p_id)) { classMessages.splice(i, 1); return true; }
      }
      return false;
    },
    class_chat_delete: function (args) {
      for (var i = classMessages.length - 1; i >= 0; i--) {
        if (String(classMessages[i].id) === String(args.p_id)) classMessages.splice(i, 1);
      }
      return true;
    },
    moderation_log: function () { return null; },
    moderation_stats: function () {
      var drapeaux = classMessages.filter(function (m) { return m.flagged; });
      var cats = {};
      drapeaux.forEach(function (m) {
        (m.categories || []).forEach(function (c) { cats[c] = (cats[c] || 0) + 1; });
      });
      return {
        total: drapeaux.length,
        dernier_jour: drapeaux.length,
        par_niveau: {},
        par_categorie: cats,
        par_auteur: []
      };
    },
    moderation_feed: function () {
      return classMessages
        .filter(function (m) { return m.flagged; })
        .map(function (m) {
          var auteur = byId(m.author_id);
          return {
            id: m.id,
            author_id: m.author_id,
            prenom: auteur ? auteur.prenom : 'Compte',
            categories: m.categories || [],
            severity: m.severity || 0,
            level: m.level,
            source: m.source || 'local',
            excerpt: m.body_raw || '',
            created_at: m.created_at
          };
        });
    },
    private_threads: function () {
      var moi = db.meId;
      var vus = {};
      var sortie = [];
      privateMessages.forEach(function (m) {
        if (m.sender_id !== moi && m.recipient_id !== moi) return;
        var autre = m.sender_id === moi ? m.recipient_id : m.sender_id;
        var deja = vus[autre];
        if (!deja) {
          deja = { other_id: autre, last_body: m.body, last_at: m.created_at, signales: 0 };
          vus[autre] = deja;
          sortie.push(deja);
        }
        if (new Date(m.created_at) >= new Date(deja.last_at)) {
          deja.last_at = m.created_at;
          deja.last_body = m.body;
        }
        if (m.flagged) deja.signales += 1;
      });
      sortie.forEach(function (fil) {
        var profil = byId(fil.other_id);
        fil.prenom = profil ? profil.prenom : 'Compte';
        fil.role = profil ? profil.role : 'eleve';
      });
      return sortie.sort(function (a, b) { return new Date(b.last_at) - new Date(a.last_at); });
    },
    private_feed: function (args) {
      var moi = db.meId;
      return privateMessages
        .filter(function (m) {
          return (m.sender_id === moi && m.recipient_id === args.p_with)
            || (m.sender_id === args.p_with && m.recipient_id === moi);
        })
        .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    },
    private_send: function (args) {
      if (!args.p_to) fail('DESTINATAIRE_INVALIDE');
      var row = {
        id: privateMessages.length + 900,
        sender_id: db.meId,
        recipient_id: args.p_to,
        body: args.p_body,
        body_raw: args.p_body_raw || null,
        level: args.p_level || 'genant',
        flagged: !!args.p_flagged,
        categories: args.p_categories || [],
        severity: args.p_severity || 0,
        source: args.p_source || null,
        created_at: new Date().toISOString()
      };
      privateMessages.push(row);
      return { id: row.id, created_at: row.created_at, flagged: row.flagged };
    },
    private_delete: function (args) {
      if (!(getRole() === 'delegue' || getRole() === 'suppleant')) fail('INTERDIT');
      for (var i = privateMessages.length - 1; i >= 0; i--) {
        if (String(privateMessages[i].id) === String(args.p_id)) privateMessages.splice(i, 1);
      }
      return true;
    },
    private_flagged: function () {
      if (getRole() === 'eleve') fail('INTERDIT');
      return privateMessages
        .filter(function (m) { return m.flagged; })
        .map(function (m) {
          var exp = byId(m.sender_id);
          var dest = byId(m.recipient_id);
          return {
            id: m.id,
            sender_id: m.sender_id,
            sender: exp ? exp.prenom : 'Compte',
            recipient_id: m.recipient_id,
            recipient: dest ? dest.prenom : 'Compte',
            categories: m.categories || [],
            severity: m.severity || 0,
            level: m.level,
            excerpt: m.body_raw || m.body,
            created_at: m.created_at
          };
        });
    },
    cancel_event: function (args) {
      for (var i = 0; i < events.length; i++) {
        if (events[i].id !== args.p_event) continue;

        var evt = events[i];
        var sujet = byId(evt.subject_id);
        var autre = byId(evt.counterparty_id);

        if (evt.kind === 'gain' && sujet) {
          sujet.points = Math.max(0, sujet.points - evt.amount);
        } else if (evt.kind === 'retrait' && sujet) {
          sujet.points += evt.amount;
        } else if (evt.kind === 'transfert') {
          var retour = Math.min(evt.amount, autre ? autre.points : 0);
          if (autre) autre.points -= retour;
          if (sujet) sujet.points += retour;
        }

        if (sujet) touchProfile(sujet);
        if (autre) touchProfile(autre);

        events.splice(i, 1);
        return { annule: true, kind: evt.kind, amount: evt.amount };
      }
      fail('INTROUVABLE');
    },
    start_golden: function () {
      settings.golden_until = new Date(Date.now() + 30 * 60000).toISOString();
      return settings.golden_until;
    },
    stop_golden: function () { settings.golden_until = null; },
    set_compliment: function (args) { settings.compliment_force = !!args.p_on; return settings.compliment_force; },
    wheel_state: function () {
      return { deja: db.wheelDone || false, dernier: db.wheelGain || null };
    },
    wheel_spin: function () {
      if (db.wheelDone) fail('DEJA_TOURNE');
      var gain = [1, 2, 3, 5][Math.floor(Math.random() * 4)];
      db.wheelDone = true;
      db.wheelGain = gain;
      var moi = byId(db.meId);
      if (moi) { moi.points += gain; touchProfile(moi); }
      return { gain: gain };
    },
    class_react: function (args) {
      var cle = String(args.p_message) + '|' + args.p_emoji;
      var index = -1;
      for (var i = 0; i < reactions.length; i++) if (reactions[i].cle === cle && reactions[i].user_id === db.meId) index = i;
      if (index >= 0) reactions.splice(index, 1);
      else reactions.push({ cle: cle, message_id: args.p_message, emoji: args.p_emoji, user_id: db.meId });
    },
    class_reactions_feed: function () {
      var map = {};
      reactions.forEach(function (r) {
        var cle = r.message_id + '|' + r.emoji;
        if (!map[cle]) map[cle] = { message_id: r.message_id, emoji: r.emoji, total: 0, moi: false };
        map[cle].total += 1;
        if (r.user_id === db.meId) map[cle].moi = true;
      });
      return Object.keys(map).map(function (k) { return map[k]; });
    },
    class_chat_pin: function (args) {
      if (getRole() === 'eleve') fail('INTERDIT');
      for (var i = 0; i < classMessages.length; i++) {
        if (String(classMessages[i].id) === String(args.p_id)) {
          classMessages[i].pinned = args.p_pinned !== false;
          return true;
        }
      }
      return false;
    },
    class_climate: function () {
      var semaine = classMessages.filter(function (m) {
        return Date.now() - new Date(m.created_at).getTime() < 7 * 86400000;
      });
      var drapeaux = semaine.filter(function (m) { return m.flagged; });
      var paires = [];
      var compte = {};
      privateMessages.forEach(function (m) {
        if (!m.flagged) return;
        var cle = m.sender_id + '|' + m.recipient_id;
        compte[cle] = (compte[cle] || 0) + 1;
      });
      Object.keys(compte).forEach(function (cle) {
        if (compte[cle] >= 3) {
          var morceaux = cle.split('|');
          var a = byId(morceaux[0]);
          var b = byId(morceaux[1]);
          paires.push({ a: a ? a.prenom : '?', b: b ? b.prenom : '?', n: compte[cle] });
        }
      });
      var parCible = {};
      semaine.forEach(function (m) {
        if (!m.flagged || !m.cible) return;
        if (!parCible[m.cible]) parCible[m.cible] = { cible: m.cible, messages: 0, auteurs: {} };
        parCible[m.cible].messages += 1;
        parCible[m.cible].auteurs[m.author_id] = true;
      });
      var alertes = Object.keys(parCible)
        .map(function (c) {
          return {
            cible: parCible[c].cible,
            messages: parCible[c].messages,
            auteurs: Object.keys(parCible[c].auteurs).length
          };
        })
        .filter(function (a) { return a.messages >= 2; });

      var score = semaine.length
        ? Math.max(0, Math.min(100, Math.round(100 * (1 - drapeaux.length / semaine.length))
          - 5 * paires.length - 3 * alertes.length))
        : 100;
      return {
        score: score,
        messages_7j: semaine.length,
        drapeaux_7j: drapeaux.length,
        paires: paires,
        nb_paires: paires.length,
        alertes: alertes,
        nb_alertes: alertes.length
      };
    },
    am_i_admin: function () { return getRole() === 'delegue' || !!db.demoAdmin; },
    admin_claim: function (args) {
      /* En démo, n'importe quel code d'au moins 6 caractères est accepté :
       * le vrai code n'est jamais présent dans le dépôt public. */
      if (!args.p_code || String(args.p_code).length < 6) fail('CODE_INVALIDE');
      db.demoAdmin = true;
      return { admin: true };
    },
    is_admin: function () { return getRole() === 'delegue'; },
    is_banned: function () { return false; },
    admin_list: function () {
      if (getRole() !== 'delegue') fail('INTERDIT');
      return profiles.map(function (p) {
        return {
          id: p.id,
          prenom: p.prenom,
          role: p.role,
          points: p.points,
          banned_at: p.banned_at || null,
          ban_reason: p.ban_reason || null,
          created_at: p.created_at || null,
          last_seen_at: p.last_seen_at || null,
          admin: p.role === 'delegue'
        };
      });
    },
    admin_stats: function () {
      if (getRole() !== 'delegue') fail('INTERDIT');
      var semaine = Date.now() - 7 * 86400000;
      return {
        comptes: profiles.length,
        bannis: profiles.filter(function (p) { return p.banned_at; }).length,
        admins: profiles.filter(function (p) { return p.role === 'delegue'; }).length,
        codes: 9,
        codes_libres: 9,
        mouvements_7j: events.filter(function (e) {
          return new Date(e.created_at).getTime() > semaine;
        }).length,
        messages_7j: classMessages.filter(function (m) {
          return new Date(m.created_at).getTime() > semaine;
        }).length
      };
    },
    admin_ban: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      var cible = byId(args.p_user);
      if (!cible) fail('ELEVE_INTROUVABLE');
      if (args.p_user === db.meId) fail('CIBLE_INVALIDE');
      cible.banned_at = new Date().toISOString();
      cible.ban_reason = args.p_reason || null;
      touchProfile(cible);
      return { prenom: cible.prenom, suspendu: true };
    },
    admin_unban: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      var cible = byId(args.p_user);
      if (!cible) fail('ELEVE_INTROUVABLE');
      cible.banned_at = null;
      cible.ban_reason = null;
      touchProfile(cible);
      return { prenom: cible.prenom, suspendu: false };
    },
    admin_delete: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      if (args.p_user === db.meId) fail('CIBLE_INVALIDE');
      var cible = byId(args.p_user);
      if (!cible) fail('ELEVE_INTROUVABLE');
      var index = profiles.indexOf(cible);
      if (index >= 0) profiles.splice(index, 1);
      return { prenom: cible.prenom, supprime: true };
    },
    admin_set_role: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      var cible = byId(args.p_user);
      if (!cible) fail('ELEVE_INTROUVABLE');
      cible.role = args.p_role;
      touchProfile(cible);
      return { prenom: cible.prenom, role: args.p_role };
    },
    admin_set_admin: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      var cible = byId(args.p_user);
      if (!cible) fail('ELEVE_INTROUVABLE');
      return { prenom: cible.prenom, admin: !!args.p_admin };
    },
    admin_reset_password: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      var cible = byId(args.p_user);
      if (!cible) fail('ELEVE_INTROUVABLE');
      if (!args.p_password || args.p_password.length < 6) fail('MOT_DE_PASSE_TROP_COURT');
      return { prenom: cible.prenom, reinitialise: true };
    },
    admin_add_code: function (args) {
      if (getRole() !== 'delegue') fail('INTERDIT');
      if (!args.p_code || args.p_code.length < 4) fail('CODE_INVALIDE');
      return { role: args.p_role, ajoute: true };
    },
    my_role: function () { return getRole(); },
    is_staff: function () { return getRole() !== 'eleve'; },
    can_award: function () { return getRole() === 'delegue' || (getRole() === 'suppleant' && settings.suppleant_can_award); },
    online_count: function () {
      var windowSeconds = settings.online_window_seconds * 1000;
      return profiles.filter(function (p) {
        return p.role === 'eleve' && Date.now() - new Date(p.last_seen_at).getTime() < windowSeconds;
      }).length;
    },
    heartbeat: function () {
      var me = byId(db.meId);
      if (!me) fail('NON_CONNECTE');
      me.last_seen_at = new Date().toISOString();
      touchProfile(me);
      return me.last_seen_at;
    },
    award_points: function (args) {
      var me = byId(db.meId);
      var target = byId(args.p_target);
      if (!me || (me.role !== 'delegue' && !(me.role === 'suppleant' && settings.suppleant_can_award))) fail('INTERDIT');
      if (!target) fail('ELEVE_INTROUVABLE');
      if (target.role !== 'eleve') fail('CIBLE_INVALIDE');
      if (!args.p_amount || args.p_amount < settings.award_min || args.p_amount > settings.award_max) fail('MONTANT_INVALIDE');

      var dore = settings.golden_until && new Date(settings.golden_until) > new Date();
      var montant = args.p_amount * (dore ? (settings.golden_multiplier || 2) : 1);

      target.points += montant;
      var evtGain = {
        id: uuid('evt'), kind: 'gain', amount: montant, subject_id: target.id,
        counterparty_id: null, actor_id: me.id, note: null, created_at: new Date().toISOString()
      };
      addEvent(evtGain);
      touchProfile(target);
      return {
        prenom: target.prenom,
        points: target.points,
        amount: montant,
        bonus: montant - args.p_amount,
        event_id: evtGain.id
      };
    },
    remove_points: function (args) {
      var me = byId(db.meId);
      var target = byId(args.p_target);
      if (!me || (me.role !== 'delegue' && !(me.role === 'suppleant' && settings.suppleant_can_award))) fail('INTERDIT');
      if (!target) fail('ELEVE_INTROUVABLE');
      if (!args.p_amount || args.p_amount < 1) fail('MONTANT_INVALIDE');

      var removed = Math.min(args.p_amount, target.points);
      target.points -= removed;

      var evtRetrait = null;
      if (removed > 0) {
        evtRetrait = {
          id: uuid('evt'), kind: 'retrait', amount: removed, subject_id: target.id,
          counterparty_id: null, actor_id: me.id, note: null, created_at: new Date().toISOString()
        };
        addEvent(evtRetrait);
      }
      touchProfile(target);
      return {
        prenom: target.prenom,
        points: target.points,
        retires: removed,
        event_id: evtRetrait ? evtRetrait.id : null
      };
    },
    transfer_points: function (args) {
      var me = byId(db.meId);
      var target = byId(args.p_target);
      if (!me) fail('NON_CONNECTE');
      if (!target) fail('ELEVE_INTROUVABLE');
      if (me.role !== 'eleve') fail('INTERDIT');
      if (target.role !== 'eleve') fail('CIBLE_INVALIDE');
      if (target.id === me.id) fail('CIBLE_INVALIDE');
      if (!args.p_amount || args.p_amount < settings.transfer_min) fail('MONTANT_INVALIDE');
      if (me.points < args.p_amount) fail('POINTS_INSUFFISANTS');

      me.points -= args.p_amount;
      target.points += args.p_amount;

      var evtTransfert = {
        id: uuid('evt'), kind: 'transfert', amount: args.p_amount, subject_id: me.id,
        counterparty_id: target.id, actor_id: me.id, note: null, created_at: new Date().toISOString()
      };
      addEvent(evtTransfert);
      touchProfile(me);
      touchProfile(target);
      return {
        points: me.points,
        cible_prenom: target.prenom,
        cible_points: target.points,
        event_id: evtTransfert.id
      };
    }
  };

  /* -------------------------------------------------------------------------
   * Client
   * ---------------------------------------------------------------------- */
  var ME_ID = idsFor(getRole());

  var db = {
    meId: ME_ID,
    profiles: profiles,
    events: events,
    messages: messages,
    settings: settings,
    setRole: setRole,
    role: getRole,

    from: function (table) {
      return new Builder(table);
    },

    rpc: function (name, args) {
      try {
        if (!rpc[name]) throw new Error('RPC inconnue (démo) : ' + name);
        return Promise.resolve({ data: rpc[name](args || {}), error: null });
      } catch (error) {
        return Promise.resolve({ data: null, error: { message: String(error.message || error), code: String(error.message || error) } });
      }
    },

    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: session() }, error: null });
      },
      getUser: function () {
        return Promise.resolve({ data: { user: session().user }, error: null });
      },
      signInWithPassword: function () {
        return Promise.resolve({ data: { session: session(), user: session().user }, error: null });
      },
      signUp: function () {
        return Promise.resolve({ data: { session: session(), user: session().user }, error: null });
      },
      signOut: function () {
        return Promise.resolve({ error: null });
      },
      updateUser: function () {
        return Promise.resolve({ data: { user: session().user }, error: null });
      },
      onAuthStateChange: function () {
        return { data: { subscription: { unsubscribe: function () {} } } };
      }
    },

    channel: function (name) {
      var channel = {
        name: name,
        on: function (event, filter, callback) {
          var table = filter && filter.table;
          if (table) {
            listeners[table] = listeners[table] || [];
            listeners[table].push(callback);
          }
          return channel;
        },
        subscribe: function (callback) {
          if (callback) window.setTimeout(function () { callback('SUBSCRIBED'); }, 120);
          return channel;
        },
        unsubscribe: function () { return Promise.resolve('ok'); }
      };
      return channel;
    },

    removeChannel: function () { return Promise.resolve('ok'); }
  };

  /* Une petite activité automatique pour que le temps réel se voie. */
  window.setInterval(function () {
    if (document.hidden) return;
    var student = byId(pick(studentIds()));
    var staff = byId(pick(staffIds()));
    if (!student || !staff) return;
    var amount = between(1, 3);
    student.points += amount;
    addEvent({
      id: uuid('evt'), kind: 'gain', amount: amount, subject_id: student.id,
      counterparty_id: null, actor_id: staff.id, note: null, created_at: new Date().toISOString()
    });
    touchProfile(student);
  }, 26000);

  window.ECEM_DEMO = {
    on: true,
    client: function () { return db; },
    data: db,
    isOn: function () { return ON; },
    reset: function () {
      window.location.reload();
    }
  };
})();
