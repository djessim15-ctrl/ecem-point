/* ============================================================================
 * ECEM Point — Progression, séries et roue de la fortune
 * ----------------------------------------------------------------------------
 * Ce module ne touche pas aux données : il lit l'état déjà chargé par data.js
 * (profils, événements, réglages) et fabrique des morceaux d'interface.
 *
 *   • Niveaux et titres (paliers de points).
 *   • Série en cours (jours consécutifs avec au moins un point reçu).
 *   • « Qui m'a donné quoi » pour l'historique personnel.
 *   • Roue de la fortune : un tirage par semaine (RPC wheel_spin).
 *   • Heure dorée : points comptés double pendant quelques minutes.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM && window.ECEM.UI;

  var NIVEAUX = [
    { min: 0, titre: 'Novice', emoji: '🌱' },
    { min: 10, titre: 'Apprenti', emoji: '📘' },
    { min: 25, titre: 'Éclaireur', emoji: '🧭' },
    { min: 45, titre: 'Aventurier', emoji: '⚡' },
    { min: 70, titre: 'Expert', emoji: '🎯' },
    { min: 100, titre: 'Maître', emoji: '🏅' },
    { min: 140, titre: 'Légende', emoji: '👑' }
  ];

  function niveauDe(points) {
    var valeur = Math.max(0, Number(points) || 0);
    var index = 0;

    for (var i = 0; i < NIVEAUX.length; i++) {
      if (valeur >= NIVEAUX[i].min) index = i;
    }

    var courant = NIVEAUX[index];
    var suivant = NIVEAUX[index + 1] || null;
    var base = courant.min;
    var cible = suivant ? suivant.min : courant.min;
    var progres = suivant
      ? Math.max(0, Math.min(100, Math.round(((valeur - base) / (cible - base)) * 100)))
      : 100;

    return {
      index: index,
      titre: courant.titre,
      emoji: courant.emoji,
      suivant: suivant ? suivant.titre : null,
      reste: suivant ? Math.max(0, cible - valeur) : 0,
      progres: progres,
      palier: cible
    };
  }

  function store() {
    return window.ECEM && window.ECEM.Store;
  }

  function sb() {
    return window.ECEM && window.ECEM.sb;
  }

  function serieDe(events, id) {
    var insights = window.ECEM && window.ECEM.Insights;
    if (insights && insights.streak) return insights.streak(events, id);
    return 0;
  }

  /* --------------------------------------------------------------------------
   * Bandeau « heure dorée »
   * ----------------------------------------------------------------------- */
  function heureDorAte(settings) {
    if (!settings || !settings.golden_until) return null;
    var fin = new Date(settings.golden_until).getTime();
    if (!(fin > Date.now())) return null;
    return { fin: fin, multiplicateur: settings.golden_multiplier || 2 };
  }

  function bandeauDore(settings) {
    var dore = heureDorAte(settings);
    if (!dore) return null;

    return UI.el('div', { class: 'golden-strip' }, [
      UI.el('span', { class: 'golden-strip-ico', text: '⚡' }),
      UI.el('span', {
        class: 'golden-strip-txt',
        text: 'Heure dorée : chaque point compte ×' + dore.multiplicateur +
          ' jusqu’à ' + new Date(dore.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.'
      })
    ]);
  }

  /* --------------------------------------------------------------------------
   * Carte de progression (accueil)
   * ----------------------------------------------------------------------- */
  function carteProgression(options) {
    options = options || {};
    var me = options.me;
    var events = options.events || [];
    var settings = options.settings || {};
    var eleve = options.eleve !== false;

    var niveau = niveauDe(me.points);
    var serie = eleve ? serieDe(events, me.id) : 0;

    var barre = UI.el('div', { class: 'prog-bar' }, [
      UI.el('span', {
        class: 'prog-fill',
        style: { width: niveau.progres + '%' }
      })
    ]);

    var gauche = UI.el('div', { class: 'prog-bloc' }, [
      UI.el('div', { class: 'prog-entete' }, [
        UI.el('span', { class: 'prog-emoji', text: niveau.emoji }),
        UI.el('div', {}, [
          UI.el('div', { class: 'prog-titre', text: niveau.titre }),
          UI.el('div', {
            class: 'faint',
            text: niveau.suivant
              ? 'Encore ' + niveau.reste + ' point' + (niveau.reste > 1 ? 's' : '') + ' pour devenir ' + niveau.suivant
              : 'Palier maximal atteint 👑'
          })
        ])
      ]),
      barre
    ]);

    var enfants = [gauche];

    if (eleve) {
      enfants.push(
        UI.el('div', { class: 'prog-serie' + (serie > 0 ? ' is-active' : '') }, [
          UI.el('span', { class: 'prog-flamme', text: '🔥' }),
          UI.el('div', {}, [
            UI.el('b', { text: serie > 0 ? serie + ' jour' + (serie > 1 ? 's' : '') : 'Pas encore de série' }),
            UI.el('span', { class: 'faint', text: serie > 0 ? ' d’affilée avec au moins 1 point' : ' gagne un point aujourd’hui pour lancer la flamme' })
          ])
        ])
      );
    }

    return UI.el('section', { class: 'card prog-card' }, [
      UI.el('div', { class: 'card-head' }, [
        UI.el('h3', { text: eleve ? 'Ma progression' : 'Progression de la classe' }),
        UI.el('span', { class: 'pill pill--muted', text: me.points + ' pts' })
      ]),
      UI.el('div', { class: 'prog-corps' }, enfants)
    ]);
  }

  /* --------------------------------------------------------------------------
   * « Qui m'a donné quoi »
   * ----------------------------------------------------------------------- */
  function carteDonneurs(events, me, profiles) {
    var donneurs = {};

    (events || []).forEach(function (event) {
      if (event.kind !== 'gain' || event.subject_id !== me.id) return;
      var cle = event.actor_id || 'inconnu';
      if (!donneurs[cle]) donneurs[cle] = { total: 0, fois: 0 };
      donneurs[cle].total += event.amount;
      donneurs[cle].fois += 1;
    });

    var liste = Object.keys(donneurs)
      .map(function (id) {
        var profil = (profiles || []).filter(function (p) { return p.id === id; })[0];
        return {
          id: id,
          prenom: profil ? profil.prenom : 'Compte supprimé',
          total: donneurs[id].total,
          fois: donneurs[id].fois
        };
      })
      .sort(function (a, b) { return b.total - a.total; });

    var total = liste.reduce(function (n, d) { return n + d.total; }, 0);

    var corps;
    if (!liste.length) {
      corps = UI.el('p', { class: 'faint', text: 'Personne ne t’a encore donné de point. Ça vient !' });
    } else {
      var max = liste[0].total || 1;
      corps = UI.el('ul', { class: 'donneurs' }, liste.slice(0, 8).map(function (d) {
        return UI.el('li', {}, [
          UI.avatar(d.prenom, { size: 26 }),
          UI.el('span', { class: 'donneur-nom', text: d.prenom }),
          UI.el('span', { class: 'donneur-bar' }, [
            UI.el('span', {
              class: 'donneur-fill',
              style: { width: Math.max(6, Math.round((d.total / max) * 100)) + '%' }
            })
          ]),
          UI.el('span', { class: 'donneur-n', text: '+' + d.total }),
          UI.el('span', { class: 'faint', text: d.fois > 1 ? d.fois + ' fois' : '1 fois' })
        ]);
      }));
    }

    return UI.el('section', { class: 'card donneurs-card' }, [
      UI.el('div', { class: 'card-head' }, [
        UI.el('h3', { text: 'Qui m’a donné quoi' }),
        UI.el('span', { class: 'pill pill--muted', text: total + ' pts reçus' })
      ]),
      corps
    ]);
  }

  /* --------------------------------------------------------------------------
   * Roue de la fortune
   * ----------------------------------------------------------------------- */
  function carteRoue(me, onDone) {
    var bouton = UI.el('button', {
      type: 'button',
      class: 'btn btn-gold btn-block',
      disabled: true
    }, [UI.el('span', { text: 'Tourner la roue' })]);

    var texte = UI.el('p', { class: 'faint', text: 'Vérification du tirage de la semaine…' });

    var carte = UI.el('section', { class: 'card roue-card' }, [
      UI.el('div', { class: 'card-head' }, [
        UI.el('h3', { text: 'Roue de la fortune' }),
        UI.el('span', { class: 'pill pill--gold', text: '1 tour / semaine' })
      ]),
      UI.el('div', { class: 'roue-visuel', text: '🎡' }),
      texte,
      bouton
    ]);

    var client = sb();
    if (!client || typeof client.rpc !== 'function') {
      texte.textContent = 'La roue a besoin d’une connexion à la base.';
      return carte;
    }

    client.rpc('wheel_state').then(function (res) {
      if (res.error) {
        texte.textContent = 'La roue sera disponible dès la prochaine connexion.';
        return;
      }
      var etat = res.data || {};
      if (etat.deja) {
        texte.textContent = 'Tu as déjà tourné cette semaine : +' + (etat.dernier || 0) + ' point' + (etat.dernier > 1 ? 's' : '') + '. Reviens lundi !';
        bouton.disabled = true;
        bouton.firstChild.textContent = 'Déjà tournée';
      } else {
        texte.textContent = 'Un tirage gratuit par semaine : 1, 2, 3 ou 5 points.';
        bouton.disabled = false;
      }
    });

    bouton.addEventListener('click', function () {
      bouton.disabled = true;
      bouton.firstChild.textContent = 'La roue tourne…';
      carte.classList.add('is-spinning');

      client.rpc('wheel_spin').then(function (res) {
        window.setTimeout(function () {
          carte.classList.remove('is-spinning');
          if (res.error) {
            bouton.firstChild.textContent = 'Déjà tournée';
            texte.textContent = 'Tu as déjà tourné cette semaine. Reviens lundi !';
            return;
          }
          var gain = (res.data && res.data.gain) || 0;
          texte.textContent = 'Tu as gagné ' + gain + ' point' + (gain > 1 ? 's' : '') + ' ! 🎉';
          bouton.firstChild.textContent = 'Gagné +' + gain;
          UI.toast('La roue t’offre ' + gain + ' point' + (gain > 1 ? 's' : '') + ' !', 'star');
          if (window.ECEM.FX) window.ECEM.FX.celebrate();
          if (typeof onDone === 'function') onDone();
        }, 900);
      });
    });

    return carte;
  }

  /* --------------------------------------------------------------------------
   * Contrôles d'encadrement (heure dorée, compliment forcé)
   * ----------------------------------------------------------------------- */
  function boutonHeureDoree(settings, onDone) {
    var dore = heureDorAte(settings);

    return UI.el('button', {
      type: 'button',
      class: 'btn btn-sm ' + (dore ? 'btn-ghost' : 'btn-gold'),
      onclick: function () {
        var client = sb();
        if (!client || typeof client.rpc !== 'function') return;
        var appel = dore ? client.rpc('stop_golden') : client.rpc('start_golden', { p_minutes: 30 });
        appel.then(function (res) {
          if (res.error) { UI.err(UI.humanError(res.error)); return; }
          UI.toast(dore ? 'Heure dorée terminée.' : 'Heure dorée lancée : points ×2 pendant 30 minutes !', 'star');
          if (typeof onDone === 'function') onDone();
        });
      }
    }, [UI.el('span', { text: dore ? 'Arrêter l’heure dorée' : 'Lancer une heure dorée' })]);
  }

  window.ECEM = window.ECEM || {};
  window.ECEM.Progress = {
    NIVEAUX: NIVEAUX,
    niveauDe: niveauDe,
    bandeauDore: bandeauDore,
    carteProgression: carteProgression,
    carteDonneurs: carteDonneurs,
    carteRoue: carteRoue,
    boutonHeureDoree: boutonHeureDoree
  };
})();
