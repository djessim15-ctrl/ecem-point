/* ============================================================================
 * ECEM Point — cartes à collectionner
 * ----------------------------------------------------------------------------
 * Douze cartes, quatre raretés, un paquet par semaine et par élève. Tout est
 * calculé côté serveur (`open_card_pack()` tire la rareté, `my_cards()` renvoie
 * la collection) : le navigateur ne décide jamais quelle carte on gagne.
 *
 * Les doublons sont conservés et comptés (`quantite`). Hors-ligne ou en mode
 * démo, le module retombe sur son propre tirage local pour rester utilisable.
 * ==========================================================================*/
(function () {
  'use strict';

  var ECEM = (window.ECEM = window.ECEM || {});
  var UI = window.ECEM.UI;

  var RARETES = {
    commune:    { label: 'Commune',    couleur: 'bleu',   poids: 55 },
    rare:       { label: 'Rare',       couleur: 'vert',   poids: 28 },
    epique:     { label: 'Épique',     couleur: 'or',     poids: 12 },
    legendaire: { label: 'Légendaire', couleur: 'rose',   poids: 5 }
  };

  var CATALOGUE = [
    { code: 'cartable', nom: 'Le Cartable', rarete: 'commune', emoji: '🎒', description: 'Toujours prêt, jamais léger.' },
    { code: 'gomme', nom: 'La Gomme', rarete: 'commune', emoji: '🧽', description: 'Efface les erreurs, pas les efforts.' },
    { code: 'stylo', nom: 'Le Stylo', rarete: 'commune', emoji: '🖊️', description: 'Quatre couleurs, mille idées.' },
    { code: 'cahier', nom: 'Le Cahier', rarete: 'commune', emoji: '📓', description: 'Le compagnon des bons jours.' },
    { code: 'regle', nom: 'La Règle', rarete: 'commune', emoji: '📏', description: 'Toujours droit dans ses bottes.' },
    { code: 'compas', nom: 'Le Compas', rarete: 'rare', emoji: '🧭', description: 'Ne perd jamais le nord.' },
    { code: 'calculatrice', nom: 'La Calculatrice', rarete: 'rare', emoji: '🧮', description: 'Compte les points mieux que personne.' },
    { code: 'dictionnaire', nom: 'Le Dictionnaire', rarete: 'rare', emoji: '📚', description: 'Les mots justes, au bon moment.' },
    { code: 'trophee', nom: 'Le Trophée', rarete: 'epique', emoji: '🏆', description: 'Pour celles et ceux qui n’abandonnent pas.' },
    { code: 'medaille', nom: 'La Médaille', rarete: 'epique', emoji: '🥇', description: 'Le mérite se voit de loin.' },
    { code: 'couronne', nom: 'La Couronne', rarete: 'legendaire', emoji: '👑', description: 'Réservée aux légendes de la classe.' },
    { code: 'etoile', nom: 'L’Étoile de Classe', rarete: 'legendaire', emoji: '🌟', description: 'Une sur cent, comme les vrais champions.' }
  ];

  var CLE_LOCALE = 'ecem-cartes-demo';

  var etat = {
    collection: null,   /* résultat de my_cards() */
    catalogue: CATALOGUE,
    chargement: false,
    erreur: '',
    revele: null        /* carte qui vient d'être tirée */
  };

  var dom = { hote: null, corps: null };

  /* ---------------------------------------------------------------------- */
  /* Outils                                                                 */
  /* ---------------------------------------------------------------------- */
  function sb() {
    return ECEM.sb;
  }

  function rpc(nom, args) {
    var client = sb();
    if (!client || typeof client.rpc !== 'function') {
      return Promise.resolve({ data: null, error: { message: 'NON_CONNECTE' } });
    }
    return client.rpc(nom, args || {}).then(function (res) {
      return res || { data: null, error: { message: 'REPONSE_VIDE' } };
    }, function (err) {
      return { data: null, error: err };
    });
  }

  function messageErreur(err) {
    var texte = String((err && err.message) || err || '');
    if (texte.indexOf('PAQUET_DEJA_OUVERT') !== -1) {
      return 'Tu as déjà ouvert ton paquet cette semaine. Le prochain arrive bientôt !';
    }
    if (texte.indexOf('NON_CONNECTE') !== -1) {
      return 'Connecte-toi pour ouvrir ta collection.';
    }
    if (UI && UI.humanError) return UI.humanError(err);
    return texte || 'Erreur inconnue';
  }

  function rareteDe(cle) {
    return RARETES[cle] || RARETES.commune;
  }

  function resteTexte(iso) {
    if (!iso) return '';
    var fin = new Date(iso).getTime();
    if (isNaN(fin)) return '';
    var reste = Math.max(0, fin - Date.now());
    var jours = Math.floor(reste / 86400000);
    var heures = Math.floor((reste % 86400000) / 3600000);
    if (jours >= 1) return jours + ' jour' + (jours > 1 ? 's' : '') + (heures ? ' et ' + heures + ' h' : '');
    if (heures >= 1) return heures + ' heure' + (heures > 1 ? 's' : '');
    var minutes = Math.max(1, Math.round(reste / 60000));
    return minutes + ' minute' + (minutes > 1 ? 's' : '');
  }

  /* Repli local : même probabilités que la base, utile hors-ligne et en démo. */
  function tirageLocal() {
    var tirage = Math.floor(Math.random() * 100);
    var cle = tirage < 55 ? 'commune' : tirage < 83 ? 'rare' : tirage < 95 ? 'epique' : 'legendaire';
    var choix = etat.catalogue.filter(function (carte) { return carte.rarete === cle; });
    if (!choix.length) choix = etat.catalogue;
    return choix[Math.floor(Math.random() * choix.length)];
  }

  function lireLocal() {
    try {
      var brut = window.localStorage.getItem(CLE_LOCALE);
      return brut ? JSON.parse(brut) : null;
    } catch (e) {
      return null;
    }
  }

  function garderLocal(valeur) {
    try {
      window.localStorage.setItem(CLE_LOCALE, JSON.stringify(valeur));
    } catch (e) {}
  }

  function collectionLocale() {
    var memoire = lireLocal() || { cartes: [], last_open: null, ouverts: 0 };
    var cartes = (memoire.cartes || []).map(function (carte) {
      var modele = etat.catalogue.filter(function (c) { return c.code === carte.code; })[0] || carte;
      return {
        code: carte.code,
        nom: modele.nom,
        rarete: modele.rarete,
        emoji: modele.emoji,
        description: modele.description,
        quantite: carte.quantite || 1
      };
    });

    var peutOuvrir = !memoire.last_open ||
      (Date.now() - new Date(memoire.last_open).getTime()) >= 7 * 86400000;

    return {
      cartes: cartes,
      possibles: etat.catalogue.length,
      distinctes: cartes.length,
      paquets: memoire.ouverts || 0,
      peut_ouvrir: peutOuvrir,
      prochain: peutOuvrir ? null : new Date(new Date(memoire.last_open).getTime() + 7 * 86400000).toISOString(),
      local: true
    };
  }

  function enregistrerTirageLocal(carte) {
    var memoire = lireLocal() || { cartes: [], last_open: null, ouverts: 0 };
    var trouvee = null;
    memoire.cartes = (memoire.cartes || []).map(function (ligne) {
      if (ligne.code === carte.code) {
        trouvee = ligne;
        ligne.quantite = (ligne.quantite || 1) + 1;
      }
      return ligne;
    });
    if (!trouvee) memoire.cartes.push({ code: carte.code, quantite: 1 });
    memoire.last_open = new Date().toISOString();
    memoire.ouverts = (memoire.ouverts || 0) + 1;
    garderLocal(memoire);
    return memoire;
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement                                                             */
  /* ---------------------------------------------------------------------- */
  function charger() {
    etat.chargement = true;
    peindre();

    return Promise.all([
      rpc('my_cards'),
      rpc('cards_catalogue')
    ]).then(function (res) {
      var collection = res[0];
      var catalogue = res[1];

      if (catalogue && !catalogue.error && Array.isArray(catalogue.data) && catalogue.data.length) {
        etat.catalogue = catalogue.data;
      }

      if (collection && !collection.error && collection.data) {
        etat.collection = collection.data;
      } else {
        /* Hors-ligne, base indisponible ou démo : la collection locale prend
           le relais pour que l'écran ne reste jamais vide. */
        etat.collection = collectionLocale();
      }

      etat.chargement = false;
      etat.erreur = '';
      peindre();
    }).catch(function (err) {
      etat.chargement = false;
      etat.collection = collectionLocale();
      etat.erreur = messageErreur(err);
      peindre();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Rendu                                                                  */
  /* ---------------------------------------------------------------------- */
  function carteVue(carte, possedee) {
    var rarete = rareteDe(carte.rarete);
    var quantite = carte.quantite || 0;

    return UI.el('div', {
      class: 'carte carte--' + rarete.couleur + (possedee ? ' is-owned' : ' is-locked'),
      title: possedee ? (carte.description || '') : 'Carte pas encore trouvée'
    }, [
      UI.el('div', { class: 'carte-vitrine' }, [
        UI.el('span', { class: 'carte-emoji', text: possedee ? (carte.emoji || '⭐') : '❔' })
      ]),
      UI.el('div', { class: 'carte-nom', text: possedee ? carte.nom : '???' }),
      UI.el('div', { class: 'carte-raretes' }, [
        UI.el('span', { class: 'pill pill--' + rarete.couleur, text: rarete.label })
      ]),
      quantite > 1
        ? UI.el('span', { class: 'carte-doublon', text: '×' + quantite })
        : null
    ]);
  }

  function grille() {
    var collection = etat.collection || { cartes: [] };
    var parCode = {};
    (collection.cartes || []).forEach(function (carte) { parCode[carte.code] = carte; });

    var grille = UI.el('div', { class: 'cartes-grille' });
    etat.catalogue.forEach(function (carte) {
      grille.appendChild(carteVue(parCode[carte.code] || carte, !!parCode[carte.code]));
    });
    return grille;
  }

  function ouvrir() {
    if (etat.ouverturePaquet) return;
    var collection = etat.collection || {};
    if (collection.peut_ouvrir === false) return;

    etat.ouverturePaquet = true;

    rpc('open_card_pack').then(function (res) {
      if (res && res.error) {
        var local = res.error.message && String(res.error.message).indexOf('NON_CONNECTE') !== -1;
        if (!local && String(res.error.message).indexOf('PAQUET_DEJA_OUVERT') === -1) {
          /* base en vrac : on bascule sur le tirage local */
          return tirageHorsLigne();
        }
        etat.erreur = messageErreur(res.error);
        peindre();
        return null;
      }
      if (res && res.data && res.data.carte) {
        return afficherTirage(res.data.carte, res.data.nouvelle).then(charger);
      }
      return tirageHorsLigne();
    }).then(function () {
      etat.ouverturePaquet = false;
    }, function () {
      etat.ouverturePaquet = false;
    });
  }

  function tirageHorsLigne() {
    var collection = etat.collection || {};
    if (collection.peut_ouvrir === false) {
      etat.erreur = 'Tu as déjà ouvert ton paquet cette semaine.';
      peindre();
      return Promise.resolve();
    }
    var carte = tirageLocal();
    var memoire = enregistrerTirageLocal(carte);
    var dejaLa = (memoire.cartes || []).filter(function (ligne) {
      return ligne.code === carte.code;
    })[0];
    etat.collection = collectionLocale();
    peindre();
    return afficherTirage({
      code: carte.code,
      nom: carte.nom,
      rarete: carte.rarete,
      emoji: carte.emoji,
      description: carte.description,
      quantite: dejaLa ? dejaLa.quantite : 1
    }, false);
  }

  function afficherTirage(carte, nouvelle) {
    var rarete = rareteDe(carte.rarete);

    return new Promise(function (resolve) {
      var modale = UI.modal({
        title: nouvelle ? 'Une nouvelle carte !' : 'Un doublon… mais il compte',
        sub: nouvelle
          ? 'Elle rejoint ta collection. Reviens la semaine prochaine pour un autre paquet.'
          : 'Tu l’avais déjà : chaque exemplaire est compté dans ta collection.',
        eye: carte.rarete === 'legendaire' ? 'sparkles' : 'gift',
        body: UI.el('div', { class: 'tirage' }, [
          UI.el('div', { class: 'carte carte--' + rarete.couleur + ' carte--grande is-owned is-revealed' }, [
            UI.el('div', { class: 'carte-vitrine' }, [
              UI.el('span', { class: 'carte-emoji', text: carte.emoji || '⭐' })
            ]),
            UI.el('div', { class: 'carte-nom', text: carte.nom }),
            UI.el('div', { class: 'carte-raretes' }, [
              UI.el('span', { class: 'pill pill--' + rarete.couleur, text: rarete.label })
            ])
          ]),
          UI.el('p', { class: 'sub', style: { textAlign: 'center', marginTop: '12px' }, text: carte.description || '' })
        ]),
        footer: [
          UI.el('button', {
            type: 'button', class: 'btn btn-primary', text: 'Super !',
            onclick: function () { modale.close(); resolve(); }
          })
        ],
        onClose: resolve
      });

      if (window.ECEM.FX) window.ECEM.FX.sound(nouvelle ? 'success' : 'send');
    });
  }

  function peindre() {
    if (!dom.hote) return;
    UI.clear(dom.hote);

    var collection = etat.collection || {};
    var distinctes = collection.distinctes || 0;
    var possibles = collection.possibles || etat.catalogue.length;
    var peutOuvrir = collection.peut_ouvrir !== false;

    var panneau = UI.el('div', { class: 'panel cartes-panel' });

    panneau.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('gift', { size: 17 })]),
          document.createTextNode(' Ma collection de cartes')
        ]),
        UI.el('div', { class: 'panel-sub', text: distinctes + ' carte' + (distinctes > 1 ? 's' : '') +
          ' sur ' + possibles + ' · ' + (collection.paquets || 0) + ' paquet' +
          ((collection.paquets || 0) > 1 ? 's' : '') + ' ouvert' + ((collection.paquets || 0) > 1 ? 's' : '') })
      ]),
      peutOuvrir
        ? UI.el('button', {
            type: 'button', class: 'btn btn-primary btn-sm', id: 'btn-paquet',
            onclick: ouvrir
          }, [
            UI.icon('gift', { size: 15 }),
            document.createTextNode(' Ouvrir mon paquet')
          ])
        : UI.el('span', { class: 'pill pill--muted', text: 'Prochain dans ' + resteTexte(collection.prochain) })
    ]));

    if (etat.erreur) {
      panneau.appendChild(UI.el('div', { class: 'alert alert--error', text: etat.erreur }));
    }

    var corps = UI.el('div', { class: 'panel-body' });
    if (etat.chargement && !etat.collection) {
      corps.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'spinner' }),
        UI.el('div', { class: 'empty-text', text: 'Chargement de la collection…' })
      ]));
    } else {
      corps.appendChild(grille());
      corps.appendChild(UI.el('p', {
        class: 'sub cartes-legende',
        text: 'Un paquet par semaine. Raretés : commune 55 %, rare 28 %, épique 12 %, légendaire 5 %. ' +
          'Les doublons sont conservés et comptés.'
      }));
    }

    panneau.appendChild(corps);
    dom.hote.appendChild(panneau);
  }

  /* ---------------------------------------------------------------------- */
  /* Point d'entrée                                                         */
  /* ---------------------------------------------------------------------- */
  function mount(hote) {
    if (!hote) return;
    dom.hote = hote;
    charger();
  }

  ECEM.Cards = {
    mount: mount,
    refresh: charger,
    ouvrir: ouvrir
  };
})();
