/* ============================================================================
 * ECEM Point — calculs et réussites
 * ----------------------------------------------------------------------------
 * Toutes les statistiques sont dérivées de l'historique déjà chargé
 * (point_events). Aucune requête supplémentaire, aucun changement de base :
 * les chiffres s'adaptent donc à ce que la RLS laisse voir au compte connecté.
 * ==========================================================================*/
(function () {
  'use strict';

  var DAY = 86400000;

  function startOfDay(d) {
    var copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function ts(value) {
    var t = new Date(value).getTime();
    return isNaN(t) ? 0 : t;
  }

  function recent(events, days) {
    var limit = Date.now() - days * DAY;
    return events.filter(function (e) { return ts(e.created_at) >= limit; });
  }

  function sum(list, fn) {
    return list.reduce(function (total, item) { return total + (fn ? fn(item) : item.amount || 0); }, 0);
  }

  var I = {};

  I.DAY = DAY;

  /* Série de 7 jours (du plus ancien à aujourd'hui) : gains / retraits / échanges. */
  I.weekSeries = function (events) {
    var days = [];
    var today = startOfDay(new Date());
    var names = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

    for (var i = 6; i >= 0; i--) {
      var day = new Date(today.getTime() - i * DAY);
      days.push({
        date: day,
        key: day.getTime(),
        label: i === 0 ? "auj." : names[day.getDay()],
        gain: 0,
        lose: 0,
        transfer: 0,
        net: 0,
        count: 0,
        today: i === 0
      });
    }

    var index = {};
    days.forEach(function (d) { index[d.key] = d; });

    events.forEach(function (event) {
      var day = startOfDay(event.created_at).getTime();
      var bucket = index[day];
      if (!bucket) return;
      bucket.count++;
      if (event.kind === 'gain') bucket.gain += event.amount;
      else if (event.kind === 'retrait') bucket.lose += event.amount;
      else if (event.kind === 'transfert') bucket.transfer += event.amount;
      bucket.net = bucket.gain - bucket.lose;
    });

    return days;
  };

  I.kindTotals = function (events) {
    var totals = { gain: 0, retrait: 0, transfert: 0, count: events.length };
    events.forEach(function (event) {
      if (totals[event.kind] !== undefined) totals[event.kind] += event.amount;
    });
    return totals;
  };

  I.received = function (events, id) {
    return events.reduce(function (total, event) {
      if (event.kind === 'gain' && event.subject_id === id) return total + event.amount;
      if (event.kind === 'transfert' && event.counterparty_id === id) return total + event.amount;
      return total;
    }, 0);
  };

  I.sent = function (events, id) {
    return events.reduce(function (total, event) {
      if (event.kind === 'transfert' && event.subject_id === id) return total + event.amount;
      return total;
    }, 0);
  };

  I.removed = function (events, id) {
    return events.reduce(function (total, event) {
      if (event.kind === 'retrait' && event.subject_id === id) return total + event.amount;
      return total;
    }, 0);
  };

  I.netFor = function (events, id) {
    return I.received(events, id) - I.removed(events, id) - I.sent(events, id);
  };

  I.netForSince = function (events, id, days) {
    return I.netFor(recent(events, days), id);
  };

  I.givenBy = function (events, id) {
    return events.reduce(function (total, event) {
      if (event.kind === 'gain' && event.actor_id === id) return total + event.amount;
      if (event.kind === 'retrait' && event.actor_id === id) return total + event.amount;
      return total;
    }, 0);
  };

  /* Jours consécutifs avec au moins un mouvement positif reçu. */
  I.streak = function (events, id) {
    var good = {};
    events.forEach(function (event) {
      var positive = (event.kind === 'gain' && event.subject_id === id) ||
        (event.kind === 'transfert' && event.counterparty_id === id);
      if (positive) good[startOfDay(event.created_at).getTime()] = true;
    });

    var streak = 0;
    var cursor = startOfDay(new Date()).getTime();
    if (!good[cursor]) cursor -= DAY; /* la journée n'est pas finie : on tolère hier */
    while (good[cursor]) {
      streak++;
      cursor -= DAY;
    }
    return streak;
  };

  /* Nombre de personnes différentes qui m'ont donné des points. */
  I.uniqueSenders = function (events, id) {
    var map = {};
    events.forEach(function (event) {
      if (event.kind === 'gain' && event.subject_id === id && event.actor_id) map[event.actor_id] = true;
      if (event.kind === 'transfert' && event.counterparty_id === id && event.subject_id) map[event.subject_id] = true;
    });
    return Object.keys(map).length;
  };

  I.uniqueReceivers = function (events, id) {
    var map = {};
    events.forEach(function (event) {
      if (event.kind === 'transfert' && event.subject_id === id && event.counterparty_id) map[event.counterparty_id] = true;
    });
    return Object.keys(map).length;
  };

  I.topDonors = function (events, profiles, days) {
    var filtered = days ? recent(events, days) : events;
    var map = {};

    filtered.forEach(function (event) {
      if (event.kind !== 'gain' || !event.actor_id) return;
      map[event.actor_id] = (map[event.actor_id] || 0) + event.amount;
    });

    return Object.keys(map).map(function (id) {
      var profile = profiles.filter(function (p) { return p.id === id; })[0];
      return { id: id, label: profile ? profile.prenom : 'Compte supprimé', value: map[id], color: '#f5b94a' };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 5);
  };

  I.topGainers = function (events, profiles, days) {
    var filtered = days ? recent(events, days) : events;
    var map = {};

    filtered.forEach(function (event) {
      if (event.kind === 'gain') map[event.subject_id] = (map[event.subject_id] || 0) + event.amount;
      if (event.kind === 'transfert') map[event.counterparty_id] = (map[event.counterparty_id] || 0) + event.amount;
    });

    return Object.keys(map).map(function (id) {
      var profile = profiles.filter(function (p) { return p.id === id; })[0];
      return { id: id, label: profile ? profile.prenom : 'Compte supprimé', value: map[id], color: '#8b5cf6' };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 5);
  };

  I.weeklyNetByStudent = function (events) {
    var map = {};
    recent(events, 7).forEach(function (event) {
      if (event.kind === 'gain') map[event.subject_id] = (map[event.subject_id] || 0) + event.amount;
      if (event.kind === 'retrait') map[event.subject_id] = (map[event.subject_id] || 0) - event.amount;
      if (event.kind === 'transfert') {
        map[event.subject_id] = (map[event.subject_id] || 0) - event.amount;
        map[event.counterparty_id] = (map[event.counterparty_id] || 0) + event.amount;
      }
    });
    return map;
  };

  I.hourActivity = function (events) {
    var hours = [];
    for (var h = 0; h < 24; h++) hours.push(0);
    events.forEach(function (event) {
      var date = new Date(event.created_at);
      if (!isNaN(date.getTime())) hours[date.getHours()]++;
    });
    return hours;
  };

  I.busiestHour = function (hours) {
    var best = 0;
    hours.forEach(function (value, hour) { if (value > hours[best]) best = hour; });
    return { hour: best, count: hours[best] };
  };

  /* -------------------------------------------------------------------------
   * Réussites
   * ---------------------------------------------------------------------- */
  I.badges = function (opts) {
    var me = opts.me;
    var events = opts.events || [];
    var profiles = opts.profiles || [];
    var messages = opts.messages || [];
    var staff = me && (me.role === 'suppleant' || me.role === 'delegue');
    var id = me ? me.id : null;

    var received = id ? I.received(events, id) : 0;
    var sent = id ? I.sent(events, id) : 0;
    var given = id ? I.givenBy(events, id) : 0;
    var streak = id ? I.streak(events, id) : 0;
    var senders = id ? I.uniqueSenders(events, id) : 0;
    var receivers = id ? I.uniqueReceivers(events, id) : 0;

    var sorted = profiles
      .filter(function (p) { return p.role === 'eleve'; })
      .slice()
      .sort(function (a, b) { return b.points - a.points; });
    var myRank = 0;
    sorted.forEach(function (p, index) { if (p.id === id) myRank = index + 1; });

    var nightOwl = false;
    events.forEach(function (event) {
      var hour = new Date(event.created_at).getHours();
      var mine = event.subject_id === id || event.counterparty_id === id || event.actor_id === id;
      if (mine && (hour >= 22 || hour < 5)) nightOwl = true;
    });

    var memberDays = me && me.created_at
      ? Math.floor((Date.now() - new Date(me.created_at).getTime()) / DAY)
      : 0;

    var defs = [
      {
        id: 'first', label: 'Premier point', icon: 'star', tone: 'violet',
        desc: 'Recevoir son tout premier point.',
        value: Math.min(received, 1), goal: 1
      },
      {
        id: 'collector', label: 'Collectionneur', icon: 'sparkles', tone: 'violet',
        desc: 'Accumuler 10 points reçus.',
        value: Math.min(received, 10), goal: 10
      },
      {
        id: 'star', label: 'Star de la classe', icon: 'crown', tone: 'gold',
        desc: 'Atteindre 25 points reçus.',
        value: Math.min(received, 25), goal: 25
      },
      {
        id: 'podium', label: 'Sur le podium', icon: 'trophy', tone: 'gold',
        desc: 'Figurer dans les trois premiers du classement.',
        value: myRank && myRank <= 3 ? 1 : 0, goal: 1
      },
      {
        id: 'generous', label: 'Grand cœur', icon: 'heart', tone: 'rose',
        desc: 'Envoyer 5 points à tes camarades.',
        value: Math.min(sent, 5), goal: 5
      },
      {
        id: 'network', label: 'Bien entouré', icon: 'users', tone: 'blue',
        desc: 'Envoyer des points à 5 personnes différentes.',
        value: Math.min(receivers, 5), goal: 5
      },
      {
        id: 'popular', label: 'Populaire', icon: 'flame', tone: 'gold',
        desc: 'Recevoir des points de 3 personnes différentes.',
        value: Math.min(senders, 3), goal: 3
      },
      {
        id: 'streak', label: 'Série en cours', icon: 'zap', tone: 'green',
        desc: 'Recevoir des points 3 jours de suite.',
        value: Math.min(streak, 3), goal: 3
      },
      {
        id: 'night', label: 'Noctambule', icon: 'moon', tone: 'blue',
        desc: 'Un mouvement de points entre 22 h et 5 h.',
        value: nightOwl ? 1 : 0, goal: 1
      },
      {
        id: 'veteran', label: 'Fidèle au poste', icon: 'shield', tone: 'green',
        desc: 'Faire partie de la classe depuis 7 jours.',
        value: Math.min(Math.max(memberDays, 0), 7), goal: 7
      },
      {
        id: 'patron', label: 'Mécène', icon: 'gift', tone: 'gold', staffOnly: true,
        desc: 'Distribuer 20 points à la classe.',
        value: Math.min(given, 20), goal: 20
      },
      {
        id: 'voice', label: 'Voix de la classe', icon: 'chat', tone: 'violet', staffOnly: true,
        desc: 'Écrire un message dans le tchat de l’encadrement.',
        value: messages.some(function (m) { return m.author_id === id; }) ? 1 : 0, goal: 1
      }
    ];

    return defs.filter(function (badge) {
      return !badge.staffOnly || staff;
    }).map(function (badge) {
      badge.unlocked = badge.value >= badge.goal;
      badge.progress = badge.goal ? Math.min(100, Math.round((badge.value / badge.goal) * 100)) : 0;
      return badge;
    });
  };

  window.ECEM = window.ECEM || {};
  window.ECEM.Insights = I;
})();
