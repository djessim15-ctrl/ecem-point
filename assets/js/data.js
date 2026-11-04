/* ============================================================================
 * ECEM Point — couche de données
 * ----------------------------------------------------------------------------
 * Un seul endroit qui parle à Supabase : lecture de la classe, du journal et du
 * tchat, présence, temps réel, et les trois actions de points (toujours via les
 * fonctions RPC, jamais en écriture directe).
 *
 * Le reste de l'interface écoute Store.on(...) et se redessine : les écrans ne
 * connaissent ni SQL ni Realtime.
 * ==========================================================================*/
(function () {
  'use strict';

  var sb = window.ECEM.sb;
  var cfg = window.ECEM.cfg || {};
  if (!sb) return;

  var DEFAULT_SETTINGS = {
    suppleant_can_award: false,
    award_min: 1,
    award_max: 4,
    transfer_min: 1,
    online_window_seconds: 90
  };

  var state = {
    me: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    profiles: [],
    events: [],
    messages: [],
    ready: false,
    demo: !!window.ECEM.demo,
    completedBadges: [],
    isAdmin: false
  };

  var listeners = [];
  var channel = null;
  var heartbeatTimer = null;
  var refreshTimer = null;
  var tickTimer = null;
  var lastEventId = null;

  /* -------------------------------------------------------------------------
   * Événements internes
   * ---------------------------------------------------------------------- */
  function emit(kind, detail) {
    listeners.slice().forEach(function (fn) {
      try { fn(kind, detail); } catch (error) {
        if (window.console && console.error) console.error('[ECEM]', error);
      }
    });
  }

  /* -------------------------------------------------------------------------
   * Accès calculés
   * ---------------------------------------------------------------------- */
  var Store = { state: state, on: on, emit: emit };

  function on(fn) {
    listeners.push(fn);
    return function () {
      var index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  Store.isAdmin = function () {
    return !!state.isAdmin;
  };

  Store.profileById = function (id) {
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].id === id) return state.profiles[i];
    }
    return null;
  };

  Store.nameOf = function (id) {
    var profile = Store.profileById(id);
    if (profile) return profile.prenom;
    if (state.me && state.me.id === id) return state.me.prenom;
    return 'un camarade';
  };

  Store.isEleve = function () { return !!state.me && state.me.role === 'eleve'; };
  Store.isStaff = function () { return !!state.me && (state.me.role === 'suppleant' || state.me.role === 'delegue'); };
  Store.isDelegue = function () { return !!state.me && state.me.role === 'delegue'; };

  Store.canAward = function () {
    if (!state.me) return false;
    if (state.me.role === 'delegue') return true;
    if (state.me.role === 'suppleant') return !!state.settings.suppleant_can_award;
    return false;
  };

  Store.students = function () {
    return state.profiles.filter(function (profile) { return profile.role === 'eleve'; });
  };

  Store.staff = function () {
    return state.profiles.filter(function (profile) { return profile.role !== 'eleve'; });
  };

  Store.isOnline = function (profile) {
    if (!profile || !profile.last_seen_at) return false;
    var windowMs = (state.settings.online_window_seconds || 90) * 1000;
    var seen = new Date(profile.last_seen_at).getTime();
    if (isNaN(seen)) return false;
    return Date.now() - seen < windowMs;
  };

  Store.onlineStudents = function () {
    return Store.students().filter(Store.isOnline);
  };

  Store.totalPoints = function () {
    return Store.students().reduce(function (total, profile) { return total + (profile.points || 0); }, 0);
  };

  Store.sortByPoints = function (list) {
    return (list || Store.students()).slice().sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.prenom.localeCompare(b.prenom, 'fr');
    });
  };

  Store.rankOf = function (id) {
    var sorted = Store.sortByPoints();
    for (var i = 0; i < sorted.length; i++) if (sorted[i].id === id) return i + 1;
    return 0;
  };

  Store.nextRankGap = function () {
    var sorted = Store.sortByPoints();
    var index = -1;
    sorted.forEach(function (profile, i) { if (state.me && profile.id === state.me.id) index = i; });
    if (index <= 0) return null;
    return {
      ahead: sorted[index - 1],
      points: sorted[index - 1].points - sorted[index].points + 1
    };
  };

  Store.myPoints = function () {
    return state.me ? state.me.points : 0;
  };

  /* -------------------------------------------------------------------------
   * Chargements
   * ---------------------------------------------------------------------- */
  Store.init = function () {
    return sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) {
        var error = new Error('NO_SESSION');
        error.code = 'NO_SESSION';
        throw error;
      }
      return loadMe(session.user.id);
    }).then(function () {
      return loadAdminFlag();
    }).then(function () {
      return loadAll();
    }).then(function () {
      state.ready = true;
      start();
      return state;
    });
  };

  function loadMe(userId) {
    return sb
      .from('profiles')
      .select('id, prenom, role, points, last_seen_at, created_at, banned_at, ban_reason')
      .eq('id', userId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) {
          var error = new Error('NO_PROFILE');
          error.code = 'NO_PROFILE';
          throw error;
        }
        state.me = res.data;
        return state.me;
      });
  }

  function loadAdminFlag() {
    return sb.rpc('am_i_admin').then(function (res) {
      state.isAdmin = !res.error && res.data === true;
      return state.isAdmin;
    }).catch(function () {
      state.isAdmin = false;
      return false;
    });
  }

  function loadAll() {
    return Promise.all([
      loadAdminFlag(),
      loadSettings(),
      loadProfiles(),
      loadEvents(),
      Store.isStaff() ? loadMessages() : Promise.resolve([])
    ]);
  }

  function loadSettings() {
    return sb.from('app_settings').select('*').eq('id', 1).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      if (res.data) state.settings = Object.assign({}, DEFAULT_SETTINGS, res.data);
      return state.settings;
    });
  }

  function loadProfiles() {
    return sb
      .from('profiles')
      .select('id, prenom, role, points, last_seen_at, created_at, banned_at, ban_reason')
      .order('prenom', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        state.profiles = res.data || [];
        var mine = Store.profileById(state.me.id);
        if (mine) state.me = Object.assign({}, state.me, mine);
        return state.profiles;
      });
  }

  function loadEvents() {
    return sb
      .from('point_events')
      .select('id, kind, amount, subject_id, counterparty_id, actor_id, note, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(function (res) {
        if (res.error) throw res.error;
        state.events = res.data || [];
        if (state.events.length) lastEventId = state.events[0].id;
        return state.events;
      });
  }

  function loadMessages() {
    if (!Store.isStaff()) return Promise.resolve([]);
    return sb
      .from('staff_messages')
      .select('id, author_id, body, created_at')
      .order('created_at', { ascending: true })
      .limit(400)
      .then(function (res) {
        if (res.error) throw res.error;
        state.messages = res.data || [];
        return state.messages;
      });
  }

  Store.refreshProfiles = function () {
    return loadProfiles().then(function (list) {
      emit('profiles', { silent: true });
      return list;
    });
  };

  Store.refreshEvents = function () {
    return loadEvents().then(function (list) {
      emit('events', { silent: true });
      return list;
    });
  };

  Store.refreshMessages = function () {
    return loadMessages().then(function (list) {
      emit('messages', { silent: true });
      return list;
    });
  };

  Store.refreshAll = function () {
    return Promise.all([
      loadAdminFlag(),
      loadSettings(),
      loadProfiles(),
      loadEvents(),
      Store.isStaff() ? loadMessages() : Promise.resolve([])
    ]).then(function () {
      emit('refresh');
    });
  };

  /* -------------------------------------------------------------------------
   * Actions
   * ---------------------------------------------------------------------- */
  function callRpc(name, args) {
    return sb.rpc(name, args).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  Store.award = function (targetId, amount) {
    return callRpc('award_points', { p_target: targetId, p_amount: Number(amount) })
      .then(function (data) {
        return loadProfiles().then(function () {
          emit('points', { targetId: targetId, amount: Number(amount), kind: 'gain' });
          return data;
        });
      });
  };

  Store.remove = function (targetId, amount) {
    return callRpc('remove_points', { p_target: targetId, p_amount: Number(amount) })
      .then(function (data) {
        return loadProfiles().then(function () {
          emit('points', { targetId: targetId, amount: Number(amount), kind: 'retrait', removed: data && data.retires });
          return data;
        });
      });
  };

  Store.transfer = function (targetId, amount) {
    return callRpc('transfer_points', { p_target: targetId, p_amount: Number(amount) })
      .then(function (data) {
        if (data && typeof data.points === 'number') {
          state.me.points = data.points;
          var mine = Store.profileById(state.me.id);
          if (mine) mine.points = data.points;
        }
        return loadProfiles().then(function () {
          emit('points', { targetId: targetId, amount: Number(amount), kind: 'transfert' });
          return data;
        });
      });
  };

  Store.sendMessage = function (body) {
    var text = String(body || '').trim();
    if (!text) return Promise.reject(new Error('Message vide.'));

    /* Envoi optimiste : le message apparaît tout de suite, puis le serveur
     * renvoie la ligne réelle (avec son horodatage et son identifiant). */
    var tempId = 'temp-' + Date.now();
    var optimistic = {
      id: tempId,
      author_id: state.me.id,
      body: text,
      created_at: new Date().toISOString(),
      pending: true
    };
    state.messages.push(optimistic);
    emit('messages', { optimistic: optimistic });

    return sb.from('staff_messages')
      .insert({ author_id: state.me.id, body: text })
      .then(function (res) {
        if (res.error) throw res.error;
        var index = state.messages.indexOf(optimistic);
        if (index >= 0) state.messages.splice(index, 1);
        return loadMessages().then(function () {
          emit('messages', { sent: true });
        });
      })
      .catch(function (error) {
        var index = state.messages.indexOf(optimistic);
        if (index >= 0) state.messages.splice(index, 1);
        emit('messages', { failed: true });
        throw error;
      });
  };

  /* -------------------------------------------------------------------------
   * Présence, temps réel, filets de sécurité
   * ---------------------------------------------------------------------- */
  function start() {
    beat();
    heartbeatTimer = window.setInterval(beat, cfg.HEARTBEAT_MS || 25000);

    startRealtime();

    refreshTimer = window.setInterval(function () {
      if (!document.hidden) {
        Store.refreshAll().catch(function () {});
      }
    }, cfg.REFRESH_MS || 60000);

    tickTimer = window.setInterval(function () {
      if (!document.hidden) emit('tick');
    }, 15000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        beat();
        Store.refreshAll().catch(function () {});
      }
    });

    window.addEventListener('focus', function () {
      if (!document.hidden) Store.refreshProfiles().catch(function () {});
    });
  }

  function beat() {
    if (!state.me) return;
    sb.rpc('heartbeat').then(function (res) {
      if (res.error || !res.data) return;
      var stamp = res.data;
      state.me.last_seen_at = stamp;
      var mine = Store.profileById(state.me.id);
      if (mine) mine.last_seen_at = stamp;
    }).catch(function () {});
  }

  Store.stop = function () {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (tickTimer) window.clearInterval(tickTimer);
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
    heartbeatTimer = refreshTimer = tickTimer = channel = null;
  };

  Store.signOut = function () {
    Store.stop();
    return sb.auth.signOut();
  };

  function startRealtime() {
    channel = sb
      .channel('ecem-classe-' + state.me.role)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onProfileChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'point_events' }, onNewEvent)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_messages' }, onNewMessage)
      .subscribe(function (status) {
        emit('realtime', { status: status });
        if (status === 'SUBSCRIBED') {
          Store.refreshAll().catch(function () {});
        }
      });

    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') emit('signed-out');
    });
  }

  function onProfileChange(payload) {
    var row = payload.new && payload.new.id ? payload.new : payload.old;
    if (!row) return;

    var previous = Store.profileById(row.id);
    var before = previous ? previous.points : null;

    if (payload.eventType === 'DELETE') {
      state.profiles = state.profiles.filter(function (profile) { return profile.id !== row.id; });
      emit('profiles', { removed: row.id });
      return;
    }

    if (!previous) {
      state.profiles.push(row);
      emit('profiles', { added: row });
      return;
    }

    Object.assign(previous, row);
    if (state.me && row.id === state.me.id) Object.assign(state.me, row);

    emit('profiles', {
      updated: previous,
      pointsChanged: before !== null && before !== previous.points
    });
  }

  function onNewEvent(payload) {
    var row = payload.new;
    if (!row) return;
    if (state.events.some(function (event) { return String(event.id) === String(row.id); })) return;
    state.events.unshift(row);
    if (state.events.length > 300) state.events.pop();
    emit('event', { row: row });
  }

  function onNewMessage(payload) {
    var row = payload.new;
    if (!row) return;
    if (state.messages.some(function (message) { return String(message.id) === String(row.id); })) return;
    state.messages.push(row);
    emit('message', { row: row });
  }

  Store.lastEventId = function () { return lastEventId; };
  Store.loadMessages = loadMessages;
  Store.loadEvents = loadEvents;

  window.ECEM.Store = Store;
})();
