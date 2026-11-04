/* ============================================================================
 * ECEM Point — Tchat de classe avec « filtre de gentillesse »
 * ----------------------------------------------------------------------------
 * Tous les comptes connectés discutent ici. Avant publication, le message passe
 * par une IA (GPT-OSS 120B via Groq, appelée depuis l'Edge Function `moderate`)
 * qui repère insultes, gros mots, spam, harcèlement, agressivité, flood ou
 * majuscules agressives, puis le réécrit en trois versions de plus en plus
 * gentilles : Doux, Gênant, Ultra.
 *
 * Rien ne dépend du réseau pour rester utilisable : si l'IA ne répond pas
 * (hors-ligne, quota, panne), un filtre local prend le relais et le message
 * part quand même, adouci.
 *
 * L'original d'un message n'est renvoyé qu'à son auteur et à l'encadrement :
 * c'est la fonction SQL class_chat_feed() qui masque la colonne aux autres.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM && window.ECEM.UI;
  var ECEM = window.ECEM || {};

  var LS_KEY = 'ecem-tchat-classe';
  var RAFRAICHIR_MS = 10000;
  var MAX_CARACTERES = 800;

  var NIVEAUX = {
    doux: { label: 'Doux', aide: 'Une version polie, presque normale.' },
    genant: { label: 'Gênant', aide: 'Trop gentil : excuses et politesse gênantes.' },
    ultra: { label: 'Ultra', aide: 'Absurde et mielleux, emojis partout.' }
  };

  var CATEGORIES = {
    insulte: 'insulte',
    gros_mot: 'gros mot',
    harcelement: 'harcèlement',
    agressivite: 'agressivité',
    menace: 'menace',
    spam: 'spam',
    flood: 'flood',
    majuscules: 'majuscules agressives',
    haine: 'haine',
    donnees_perso: 'données personnelles'
  };

  /* --------------------------------------------------------------------------
   * Préférences locales
   * ----------------------------------------------------------------------- */
  function lirePrefs() {
    try {
      var brut = window.localStorage.getItem(LS_KEY);
      var objet = brut ? JSON.parse(brut) : null;
      return {
        filtre: objet && objet.filtre === false ? false : true,
        niveau: objet && NIVEAUX[objet.niveau] ? objet.niveau : 'genant',
        stats: !!(objet && objet.stats)
      };
    } catch (e) {
      return { filtre: true, niveau: 'genant', stats: false };
    }
  }

  function garderPrefs() {
    try {
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ filtre: etat.filtre, niveau: etat.niveau, stats: etat.statsOuvertes })
      );
    } catch (e) {
      /* mode privé : on continue sans mémoriser */
    }
  }

  /* --------------------------------------------------------------------------
   * État
   * ----------------------------------------------------------------------- */
  var prefs = lirePrefs();

  var etat = {
    monte: false,
    chargement: false,
    envoi: false,
    filtre: prefs.filtre,
    niveau: prefs.niveau,
    statsOuvertes: prefs.stats,
    messages: [],
    stats: null,
    journal: [],
    erreur: null,
    statut: '',
    originaux: {},
    minuteur: null,
    dernierChargement: 0
  };

  var racine = null;
  var dom = {};

  function sb() {
    return window.ECEM && window.ECEM.sb;
  }

  function demo() {
    return !!(window.ECEM && window.ECEM.demo);
  }

  function moi() {
    var store = window.ECEM && window.ECEM.Store;
    return (store && store.state && store.state.me) || null;
  }

  function estStaff() {
    var store = window.ECEM && window.ECEM.Store;
    return !!(store && store.isStaff && store.isStaff());
  }

  function nomDe(id) {
    var store = window.ECEM && window.ECEM.Store;
    if (store && store.nameOf) return store.nameOf(id);
    return 'Compte';
  }

  /* --------------------------------------------------------------------------
   * Analyse locale (filet de sécurité quand l'IA est injoignable)
   * ----------------------------------------------------------------------- */
  var GROS_MOTS = [
    'abruti', 'andouille', 'batard', 'bete', 'bouffon', 'brute', 'con', 'conne',
    'connard', 'connasse', 'connerie', 'cretin', 'debile', 'enculé', 'encule',
    'fdp', 'idiot', 'idiote', 'imbecile', 'merde', 'naze', 'nul', 'nulle',
    'pauvre type', 'putain', 'salaud', 'salope', 'stupide', 'ta gueule',
    'ferme la', 'va te faire', 'chier', 'chieur', 'bordel'
  ];

  var AGRESSIFS = [
    'je te deteste', 'tu me degoutes', 'degage', 'casse toi', 'la ferme',
    'tu vas voir', 'je vais te', 'personne ne t aime', 'tout le monde te deteste'
  ];

  function normaliser(texte) {
    return String(texte || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Motif tolérant aux accents et aux pluriels : « abruti » attrape « abrutis ». */
  var ACCENTS = {
    a: '[aàâä]', e: '[eéèêë]', i: '[iîï]', o: '[oôö]', u: '[uùûü]',
    y: '[yÿ]', c: '[cç]'
  };

  function motifSouple(mot) {
    return mot
      .split('')
      .map(function (caractere) {
        if (/\s/.test(caractere)) return '\\s+';
        if (ACCENTS[caractere]) return ACCENTS[caractere];
        if (/[.*+?^${}()|[\]\\-]/.test(caractere)) return '\\' + caractere;
        return caractere;
      })
      .join('') + '[a-z]*';
  }

  function analyserLocalement(brut) {
    var texte = String(brut || '');
    var plat = normaliser(texte);
    var categories = [];
    var severite = 0;

    var mots = GROS_MOTS.filter(function (mot) {
      return new RegExp('(^|[^a-z])' + mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(plat);
    });

    if (mots.length) {
      categories.push('insulte');
      severite = Math.max(severite, 2);
    }

    if (AGRESSIFS.some(function (phrase) { return plat.indexOf(phrase) !== -1; })) {
      categories.push('agressivite');
      severite = Math.max(severite, 2);
    }

    var lettres = texte.replace(/[^A-Za-zÀ-ÿ]/g, '');
    var majuscules = (texte.match(/[A-ZÀ-Þ]/g) || []).length;
    if (lettres.length >= 10 && majuscules / lettres.length > 0.62) {
      categories.push('majuscules');
      severite = Math.max(severite, 1);
    }

    if (/(.)\1{6,}/.test(texte) || texte.length > 500) {
      categories.push('flood');
      severite = Math.max(severite, 1);
    }

    if ((texte.match(/https?:\/\//g) || []).length >= 2) {
      categories.push('spam');
      severite = Math.max(severite, 1);
    }

    if (/(\b[\w'-]+\b)(\s+\1){4,}/i.test(plat)) {
      categories.push('spam');
      severite = Math.max(severite, 1);
    }

    var doux = texte;
    if (mots.length) {
      mots.forEach(function (mot) {
        doux = doux.replace(new RegExp(motifSouple(mot), 'gi'), 'petit nuage');
      });
    }

    if (!categories.length) {
      return { flagged: false, categories: [], severity: 0, doux: texte, genant: texte, ultra: texte };
    }

    return {
      flagged: true,
      categories: categories,
      severity: Math.min(3, severite),
      doux: doux.trim() || 'Je préfère reformuler plus gentiment.',
      genant: 'Oh là là, pardon ! ' + (doux.trim() || 'Je retire ce que j’ai dit.') +
        ' Je m’excuse platement, tu es quelqu’un de très bien 🙏',
      ultra: 'Pardon, pardon, pardon ✨ ' + (doux.trim() || 'Je retire tout.') +
        ' Tu es une personne magnifique, brillante et merveilleuse 💖🌟 Je te respecte infiniment 🙇'
    };
  }

  /* --------------------------------------------------------------------------
   * Analyse IA (Edge Function `moderate` → Groq GPT-OSS 120B)
   * ----------------------------------------------------------------------- */
  function analyserAvecIA(texte) {
    var cfg = (window.ECEM && window.ECEM.cfg) || {};
    var client = sb();

    if (!client || !client.auth || !cfg.SUPABASE_URL || demo()) {
      return Promise.resolve(degrade(analyserLocalement(texte)));
    }

    return client.auth
      .getSession()
      .then(function (res) {
        var session = res && res.data && res.data.session;
        if (!session || !session.access_token) throw new Error('session');

        var controleur = window.AbortController ? new window.AbortController() : null;
        var minuteur = window.setTimeout(function () {
          if (controleur) controleur.abort();
        }, 9000);

        return fetch(cfg.SUPABASE_URL + '/functions/v1/moderate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + session.access_token
          },
          body: JSON.stringify({ text: texte }),
          signal: controleur ? controleur.signal : undefined
        })
          .then(function (reponse) {
            window.clearTimeout(minuteur);
            if (!reponse.ok) throw new Error('http-' + reponse.status);
            return reponse.json();
          })
          .then(function (donnees) {
            if (!donnees || donnees.error || typeof donnees.doux !== 'string') {
              throw new Error('reponse');
            }
            return {
              flagged: donnees.flagged === true,
              categories: Array.isArray(donnees.categories) ? donnees.categories : [],
              severity: Number(donnees.severity) || 0,
              doux: donnees.doux,
              genant: donnees.genant || donnees.doux,
              ultra: donnees.ultra || donnees.genant || donnees.doux,
              source: 'ia:' + (donnees.modele || 'gpt-oss-120b'),
              ms: donnees.ms || 0
            };
          })
          .catch(function () {
            window.clearTimeout(minuteur);
            return degrade(analyserLocalement(texte));
          });
      })
      .catch(function () {
        return degrade(analyserLocalement(texte));
      });
  }

  function degrade(resultat) {
    resultat.source = 'local';
    resultat.degrade = true;
    return resultat;
  }

  /* --------------------------------------------------------------------------
   * Chargement des données
   * ----------------------------------------------------------------------- */
  function charger(silencieux) {
    var client = sb();
    if (!client || !client.rpc) {
      etat.erreur = 'Le tchat a besoin d’une connexion à la base.';
      return Promise.resolve();
    }

    if (!silencieux) {
      etat.chargement = true;
      peindre();
    }

    var appels = [
      client.rpc('class_chat_feed', { p_limit: 200 }),
      client.rpc('moderation_stats'),
      client.rpc('moderation_feed', { p_limit: 40 })
    ];

    return Promise.all(appels)
      .then(function (resultats) {
        var feed = resultats[0] || {};
        var stats = resultats[1] || {};
        var journal = resultats[2] || {};

        if (feed.error) throw feed.error;

        etat.messages = Array.isArray(feed.data) ? feed.data : [];
        etat.stats = !stats.error && stats.data ? stats.data : null;
        etat.journal = !journal.error && Array.isArray(journal.data) ? journal.data : [];
        etat.erreur = null;
        etat.dernierChargement = Date.now();
      })
      .catch(function (erreur) {
        etat.erreur = messageErreur(erreur);
        if (window.console && console.warn) console.warn('[tchat]', erreur);
      })
      .then(function () {
        etat.chargement = false;
        peindre();
      });
  }

  function messageErreur(erreur) {
    var texte = String((erreur && (erreur.message || erreur.hint)) || erreur || '');
    if (texte.indexOf('TROP_VITE') !== -1) return 'Doucement : tu envoies trop de messages d’affilée.';
    if (texte.indexOf('NON_CONNECTE') !== -1) return 'Ta session a expiré : reconnecte-toi.';
    if (texte.indexOf('MESSAGE_VIDE') !== -1) return 'Le message est vide.';
    if (texte.indexOf('NIVEAU_INVALIDE') !== -1) return 'Niveau de gentillesse inconnu.';
    if (texte.indexOf('JWT') !== -1 || texte.indexOf('permission') !== -1) {
      return 'La base refuse l’accès au tchat (session ou droits à vérifier).';
    }
    return 'Le tchat n’a pas pu se charger. Réessaie dans un instant.';
  }

  /* --------------------------------------------------------------------------
   * Peinture de l'interface
   * ----------------------------------------------------------------------- */
  function monter(root) {
    racine = root;
    if (!racine) return;

    if (!etat.monte) {
      construire();
      etat.monte = true;
    }

    peindre();
    charger(false);

    if (!etat.minuteur) {
      etat.minuteur = window.setInterval(function () {
        if (document.hidden) return;
        if (!etat.monte) return;
        charger(true);
      }, RAFRAICHIR_MS);
    }
  }

  function stop() {
    etat.monte = false;
    if (etat.minuteur) {
      window.clearInterval(etat.minuteur);
      etat.minuteur = null;
    }
  }

  function construire() {
    UI.clear(racine);

    dom.titre = UI.el('h2', { id: 'tchat-title', text: 'Tchat de la classe' });
    dom.sousTitre = UI.el('p', {
      class: 'sub',
      text: 'Tout le monde se parle ici. Un filtre de gentillesse relit les messages avant publication.'
    });

    dom.bascule = UI.el('button', {
      type: 'button',
      class: 'tchat-switch',
      'aria-pressed': 'true',
      onclick: function () {
        etat.filtre = !etat.filtre;
        garderPrefs();
        peindre();
        UI.toast(etat.filtre ? 'Filtre de gentillesse activé.' : 'Filtre désactivé : les messages partent tels quels.', etat.filtre ? 'success' : 'warning');
      }
    }, [
      UI.el('span', { class: 'tchat-switch-rail' }, [UI.el('span', { class: 'tchat-switch-knob' })]),
      UI.el('span', { class: 'tchat-switch-text', text: 'Filtre de gentillesse' })
    ]);

    dom.niveaux = UI.el('div', { class: 'tchat-seg', role: 'group', 'aria-label': 'Niveau de gentillesse' });
    Object.keys(NIVEAUX).forEach(function (cle) {
      dom.niveaux.appendChild(
        UI.el('button', {
          type: 'button',
          class: 'tchat-seg-btn',
          dataset: { niveau: cle },
          title: NIVEAUX[cle].aide,
          onclick: function () {
            etat.niveau = cle;
            garderPrefs();
            peindre();
          }
        }, [NIVEAUX[cle].label])
      );
    });

    dom.btnStats = UI.el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      onclick: function () {
        etat.statsOuvertes = !etat.statsOuvertes;
        garderPrefs();
        peindre();
      }
    }, [UI.icon('chart', { size: 16 }), UI.el('span', { text: 'Détections' })]);

    dom.compteur = UI.el('span', { class: 'pill pill--muted' });

    dom.panneauStats = UI.el('div', { class: 'tchat-stats', hidden: true });

    dom.log = UI.el('div', {
      class: 'chat-log tchat-log',
      'aria-live': 'polite',
      'aria-label': 'Messages du tchat de classe'
    });

    dom.champ = UI.el('textarea', {
      class: 'chat-input',
      rows: '1',
      maxlength: String(MAX_CARACTERES),
      autocomplete: 'off',
      placeholder: 'Écris ton message… (Entrée pour envoyer)',
      'aria-label': 'Ton message'
    });

    dom.champ.addEventListener('input', function () {
      dom.champ.style.height = 'auto';
      dom.champ.style.height = Math.min(160, dom.champ.scrollHeight) + 'px';
    });

    dom.champ.addEventListener('keydown', function (evenement) {
      if (evenement.key === 'Enter' && !evenement.shiftKey) {
        evenement.preventDefault();
        envoyer();
      }
    });

    dom.btnEnvoyer = UI.el('button', {
      type: 'submit',
      class: 'btn btn-primary chat-send'
    }, [UI.icon('send', { size: 17 }), UI.el('span', { class: 'hide-sm', text: 'Envoyer' })]);

    dom.form = UI.el('form', {
      class: 'chat-form',
      onsubmit: function (evenement) {
        evenement.preventDefault();
        envoyer();
      }
    }, [dom.champ, dom.btnEnvoyer]);

    dom.statut = UI.el('p', { class: 'tchat-statut', 'aria-live': 'polite' });

    dom.alerte = UI.el('div', { class: 'alert alert--error is-hidden' });

    dom.entete = UI.el('div', { class: 'tchat-head' }, [
      UI.el('div', { class: 'tchat-head-txt' }, [dom.titre, dom.sousTitre]),
      UI.el('div', { class: 'tchat-outils' }, [dom.bascule, dom.niveaux, dom.btnStats, dom.compteur])
    ]);

    racine.appendChild(
      UI.el('div', { class: 'tchat' }, [
        dom.entete,
        dom.alerte,
        dom.panneauStats,
        dom.log,
        dom.form,
        dom.statut
      ])
    );
  }

  function peindre() {
    if (!racine || !etat.monte) return;

    dom.bascule.setAttribute('aria-pressed', etat.filtre ? 'true' : 'false');
    dom.bascule.classList.toggle('is-off', !etat.filtre);

    UI.$$('.tchat-seg-btn', dom.niveaux).forEach(function (bouton) {
      bouton.classList.toggle('is-active', bouton.dataset.niveau === etat.niveau);
      bouton.disabled = !etat.filtre;
    });

    dom.compteur.textContent = etat.messages.length + (etat.messages.length > 1 ? ' messages' : ' message');
    dom.btnStats.classList.toggle('is-active', etat.statsOuvertes);

    dom.panneauStats.hidden = !etat.statsOuvertes;
    if (etat.statsOuvertes) peindreStats();

    if (etat.erreur) {
      dom.alerte.className = 'alert alert--error';
      dom.alerte.textContent = etat.erreur;
    } else {
      dom.alerte.className = 'alert alert--error is-hidden';
    }

    if (etat.chargement && !etat.messages.length) {
      UI.clear(dom.log);
      dom.log.appendChild(UI.el('div', { class: 'tchat-vide' }, [
        UI.el('span', { class: 'spinner' }),
        UI.el('span', { text: 'Chargement des messages…' })
      ]));
      return;
    }

    peindreMessages();
  }

  function peindreMessages() {
    var log = dom.log;
    var bas = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    UI.clear(log);

    if (!etat.messages.length) {
      log.appendChild(
        UI.el('div', { class: 'tchat-vide' }, [
          UI.icon('chat', { size: 26 }),
          UI.el('div', { class: 'tchat-vide-titre', text: 'Personne n’a encore parlé' }),
          UI.el('div', { class: 'tchat-vide-texte', text: 'Écris le premier message : il sera relu et adouci si besoin.' })
        ])
      );
      return;
    }

    var jourCourant = null;

    etat.messages.forEach(function (message) {
      var jour = UI.dayLabel ? UI.dayLabel(message.created_at) : '';
      if (jour !== jourCourant) {
        jourCourant = jour;
        log.appendChild(UI.el('div', { class: 'chat-day', text: jour }));
      }
      log.appendChild(bulle(message));
    });

    if (bas) log.scrollTop = log.scrollHeight;
  }

  function bulle(message) {
    var store = window.ECEM && window.ECEM.Store;
    var mien = store && store.state.me ? message.author_id === store.state.me.id : false;
    var prenom = nomDe(message.author_id);
    var heure = new Date(message.created_at).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    var metaEnfants = [
      UI.el('b', { text: mien ? 'Toi' : prenom }),
      UI.el('span', { text: heure })
    ];

    if (message.flagged) {
      var etiquettes = (message.categories || []).map(function (c) { return CATEGORIES[c] || c; });
      metaEnfants.push(
        UI.el('span', {
          class: 'tchat-badge',
          title: 'Message repéré par le filtre et adouci',
          text: 'adouci · ' + (etiquettes.join(', ') || 'à surveiller')
        })
      );
    }

    var children = [
      UI.el('div', { class: 'msg-meta' }, metaEnfants),
      UI.el('div', { class: 'msg-bubble' }, [UI.el('span', { class: 'tchat-corps', text: message.body })])
    ];

    if (message.body_raw) {
      var cle = String(message.id);
      var ouvert = !!etat.originaux[cle];

      var boutonOriginal = UI.el('button', {
        type: 'button',
        class: 'tchat-original-btn',
        'aria-expanded': ouvert ? 'true' : 'false',
        onclick: function () {
          etat.originaux[cle] = !etat.originaux[cle];
          peindreMessages();
          var boite = dom.log.querySelector('[data-original="' + cle + '"]');
          if (boite && etat.originaux[cle] && boite.scrollIntoView) boite.scrollIntoView({ block: 'nearest' });
        }
      }, [
        UI.icon('eye', { size: 14 }),
        UI.el('span', { text: ouvert ? 'Masquer l’original' : 'Voir l’original' })
      ]);

      children.push(boutonOriginal);

      if (ouvert) {
        children.push(
          UI.el('div', {
            class: 'tchat-original',
            dataset: { original: cle }
          }, [message.body_raw])
        );
      }
    }

    if (mien || estStaff()) {
      children.push(
        UI.el('button', {
          type: 'button',
          class: 'tchat-suppr',
          title: 'Supprimer ce message',
          'aria-label': 'Supprimer ce message',
          onclick: function () {
            supprimer(message.id);
          }
        }, [UI.icon('trash', { size: 13 })])
      );
    }

    return UI.el('div', { class: 'msg' + (mien ? ' msg--mine' : '') + (message.pending ? ' msg--pending' : '') }, [
      UI.avatar(prenom, { size: 30 }),
      UI.el('div', { class: 'msg-col' }, children)
    ]);
  }

  function peindreStats() {
    var hote = dom.panneauStats;
    UI.clear(hote);

    var stats = etat.stats || {};
    var total = Number(stats.total || 0);
    var jour = Number(stats.dernier_jour || 0);
    var parNiveau = stats.par_niveau || {};
    var parCategorie = stats.par_categorie || {};

    var chiffres = UI.el('div', { class: 'tchat-chiffres' }, [
      chiffre(total, 'détections au total'),
      chiffre(jour, 'sur les dernières 24 h'),
      chiffre(Number(parNiveau[etat.niveau] || 0), 'adoucis en « ' + NIVEAUX[etat.niveau].label + ' »')
    ]);

    hote.appendChild(UI.el('div', { class: 'tchat-stats-head' }, [
      UI.el('h3', { text: 'Journal des détections' }),
      UI.el('p', { class: 'sub', text: estStaff()
        ? 'Ce que le filtre a repéré, et comment chaque message a été réécrit.'
        : 'Ce que le filtre a repéré dans tes messages.' })
    ]));

    hote.appendChild(chiffres);

    var cats = Object.keys(parCategorie).sort(function (a, b) {
      return parCategorie[b] - parCategorie[a];
    });

    if (cats.length) {
      var max = parCategorie[cats[0]] || 1;
      hote.appendChild(
        UI.el('div', { class: 'tchat-cats' }, cats.map(function (cat) {
          return UI.el('div', { class: 'tchat-cat' }, [
            UI.el('span', { class: 'tchat-cat-nom', text: CATEGORIES[cat] || cat }),
            UI.el('span', { class: 'tchat-cat-bar' }, [
              UI.el('span', {
                class: 'tchat-cat-fill',
                style: { width: Math.max(6, Math.round((parCategorie[cat] / max) * 100)) + '%' }
              })
            ]),
            UI.el('span', { class: 'tchat-cat-n', text: String(parCategorie[cat]) })
          ]);
        }))
      );
    }

    if (!etat.journal.length) {
      hote.appendChild(UI.el('p', { class: 'faint', text: 'Aucune détection pour le moment. Tout le monde est très sage.' }));
      return;
    }

    hote.appendChild(
      UI.el('ul', { class: 'tchat-journal' }, etat.journal.slice(0, 20).map(function (entree) {
        var quand = new Date(entree.created_at);
        var etiquettes = (entree.categories || []).map(function (c) { return CATEGORIES[c] || c; });
        return UI.el('li', {}, [
          UI.el('span', { class: 'tchat-journal-qui', text: estStaff() ? (entree.prenom || 'Compte') : 'Toi' }),
          UI.el('span', { class: 'tchat-journal-quoi', text: etiquettes.join(', ') || 'à surveiller' }),
          UI.el('span', {
            class: 'tchat-journal-quand',
            text: quand.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          }),
          UI.el('span', {
            class: 'tchat-journal-src',
            title: entree.source || '',
            text: (entree.source || '').indexOf('ia') === 0 ? 'IA' : 'local'
          })
        ]);
      }))
    );
  }

  function chiffre(valeur, legende) {
    return UI.el('div', { class: 'tchat-chiffre' }, [
      UI.el('b', { text: String(valeur) }),
      UI.el('span', { text: legende })
    ]);
  }

  /* --------------------------------------------------------------------------
   * Envoi
   * ----------------------------------------------------------------------- */
  function envoyer() {
    if (etat.envoi) return;

    var texte = String(dom.champ.value || '').trim();
    if (!texte) {
      dom.champ.focus();
      return;
    }

    etat.envoi = true;
    dom.btnEnvoyer.disabled = true;
    dom.champ.disabled = true;
    dom.statut.textContent = etat.filtre ? 'Le filtre de gentillesse relit ton message…' : 'Envoi…';

    var analyse = etat.filtre
      ? analyserAvecIA(texte)
      : Promise.resolve({ flagged: false, categories: [], severity: 0, doux: texte, genant: texte, ultra: texte, source: 'filtre-off' });

    analyse
      .then(function (resultat) {
        var version = etat.filtre ? (resultat[etat.niveau] || resultat.doux || texte) : texte;
        return envoyerAuServeur(version, texte, resultat);
      })
      .then(function () {
        dom.champ.value = '';
        dom.champ.style.height = 'auto';
        dom.statut.textContent = '';
      })
      .catch(function (erreur) {
        dom.statut.textContent = '';
        UI.err(messageErreur(erreur));
      })
      .then(function () {
        etat.envoi = false;
        dom.btnEnvoyer.disabled = false;
        dom.champ.disabled = false;
        dom.champ.focus();
      });
  }

  function envoyerAuServeur(version, original, analyse) {
    var client = sb();
    if (!client || !client.rpc) return Promise.reject(new Error('hors-ligne'));

    var adouci = !!(etat.filtre && analyse && analyse.flagged);
    var enveloppe = {
      p_body: version,
      p_body_raw: adouci ? original : null,
      p_level: etat.niveau,
      p_flagged: adouci,
      p_categories: adouci ? (analyse.categories || []) : [],
      p_severity: adouci ? (analyse.severity || 0) : 0,
      p_source: analyse && analyse.source ? analyse.source : null
    };

    return client.rpc('class_chat_send', enveloppe).then(function (res) {
      if (res.error) throw res.error;
      var id = res.data && res.data.id;

      if (adouci && id) {
        client
          .rpc('moderation_log', {
            p_message_id: id,
            p_categories: analyse.categories || [],
            p_severity: analyse.severity || 0,
            p_level: etat.niveau,
            p_source: analyse.source || null,
            p_excerpt: original.slice(0, 180)
          })
          .catch(function () { /* journal secondaire : jamais bloquant */ });
      }

      if (adouci) {
        UI.toast('Message adouci avant publication (niveau ' + NIVEAUX[etat.niveau].label + ').', 'info');
      }

      return charger(true);
    });
  }

  function supprimer(id) {
    var client = sb();
    if (!client || !client.rpc) return;
    if (!window.confirm('Supprimer ce message ?')) return;

    client
      .rpc('class_chat_delete', { p_id: id })
      .then(function (res) {
        if (res.error) throw res.error;
        return charger(true);
      })
      .then(function () { UI.toast('Message supprimé.', 'success'); })
      .catch(function (erreur) { UI.err(messageErreur(erreur)); });
  }

  /* --------------------------------------------------------------------------
   * Export
   * ----------------------------------------------------------------------- */
  window.ECEM = window.ECEM || {};
  window.ECEM.ClassChat = {
    mount: monter,
    stop: stop,
    analyserLocalement: analyserLocalement
  };
})();
