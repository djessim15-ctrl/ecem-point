/* ============================================================================
 * ECEM Point — Tchats (classe + privés) avec « filtre de gentillesse »
 * ----------------------------------------------------------------------------
 * Deux espaces :
 *   • Classe   : tout le monde se parle, messages visibles par tous.
 *   • Privés   : conversations 1 à 1 entre deux comptes.
 *
 * Dans les deux cas, chaque message passe par une IA (GPT-OSS 120B via Groq,
 * appelée depuis l'Edge Function `moderate`) qui repère insultes, gros mots,
 * spam, harcèlement, agressivité, flood ou majuscules agressives, puis le
 * réécrit en trois versions de plus en plus gentilles : Doux, Gênant, Ultra.
 * Le filtre s'applique à TOUT LE MONDE, délégués et suppléants compris.
 *
 * Délégués et suppléants sont modérateurs : ils voient dans « Détections » les
 * messages privés signalés et peuvent les supprimer. Ils ne lisent pas les
 * conversations privées ordinaires.
 *
 * Rien ne dépend du réseau pour rester utilisable : si l'IA ne répond pas
 * (hors-ligne, quota, panne), un filtre local prend le relais.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM && window.ECEM.UI;

  var LS_KEY = 'ecem-tchat-classe';
  var RAFRAICHIR_MS = 10000;
  var MAX_CARACTERES = 800;

  var NIVEAUX = {
    doux: { label: 'Doux', aide: 'Une version polie, presque normale.' },
    genant: { label: 'Gênant', aide: 'Trop gentil : excuses et politesse gênantes.' },
    ultra: { label: 'Ultra', aide: 'Absurde et mielleux, emojis partout.' }
  };

  var EMOJIS = ['❤️', '😂', '👏'];

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
    onglet: 'classe',
    messages: [],
    stats: null,
    journal: [],
    signales: [],
    fils: [],
    fil: null,
    messagesPrives: [],
    reactions: {},
    climat: null,
    reponse: null,
    choixOuvert: false,
    choixRecherche: '',
    erreur: null,
    statut: '',
    minuteur: null,
    dernierChargement: 0,
    autoOuvert: false
  };

  var racine = null;
  var dom = {};

  function sb() {
    return window.ECEM && window.ECEM.sb;
  }

  function demo() {
    return !!(window.ECEM && window.ECEM.demo);
  }

  function reglages() {
    var store = window.ECEM && window.ECEM.Store;
    return (store && store.state && store.state.settings) || {};
  }

  function complimentForce() {
    return !!(reglages() && reglages().compliment_force);
  }

  function resumeSemaine(climat) {
    if (!climat) return '';
    var messages = Number(climat.messages_7j) || 0;
    var drapeaux = Number(climat.drapeaux_7j) || 0;
    var score = Number(climat.score) || 0;

    if (!messages) return 'Aucun message cette semaine : le climat ne peut pas encore être évalué.';

    var ton = score >= 80 ? 'très serein' : score >= 60 ? 'globalement serein' : score >= 40 ? 'un peu tendu' : 'difficile';

    var phrase = 'Cette semaine : ' + messages + ' message' + (messages > 1 ? 's' : '') +
      ' dans la classe, ' + drapeaux + ' repéré' + (drapeaux > 1 ? 's' : '') +
      ' par le filtre. Le climat est ' + ton + ' (' + score + '/100).';

    if (climat.nb_paires > 0) {
      phrase += ' Attention : ' + climat.nb_paires + ' échange' + (climat.nb_paires > 1 ? 's' : '') +
        ' privé' + (climat.nb_paires > 1 ? 's' : '') + ' répété' + (climat.nb_paires > 1 ? 's' : '') +
        ' entre les mêmes personnes.';
    }

    return phrase;
  }

  function estStaff() {
    var store = window.ECEM && window.ECEM.Store;
    return !!(store && store.isStaff && store.isStaff());
  }

  function profils() {
    var store = window.ECEM && window.ECEM.Store;
    return (store && store.state && store.state.profiles) || [];
  }

  function monId() {
    var store = window.ECEM && window.ECEM.Store;
    return store && store.state && store.state.me ? store.state.me.id : null;
  }

  function profilDe(id) {
    var liste = profils();
    for (var i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
    return null;
  }

  function nomDe(id) {
    var profil = profilDe(id);
    if (profil) return profil.prenom;
    var store = window.ECEM && window.ECEM.Store;
    return (store && store.nameOf && store.nameOf(id)) || 'Compte';
  }

  function rpc(nom, args) {
    var client = sb();
    if (!client || typeof client.rpc !== 'function') {
      return Promise.resolve({ data: null, error: { message: 'HORS_LIGNE' } });
    }
    try {
      return Promise.resolve(client.rpc(nom, args || {})).then(
        function (res) { return res || { data: null, error: { message: 'REPONSE_VIDE' } }; },
        function (erreur) { return { data: null, error: erreur }; }
      );
    } catch (erreur) {
      return Promise.resolve({ data: null, error: erreur });
    }
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
   * Chargement
   * ----------------------------------------------------------------------- */
  function messageErreur(erreur) {
    var texte = String((erreur && (erreur.message || erreur.hint)) || erreur || '');
    if (texte.indexOf('TROP_VITE') !== -1) return 'Doucement : tu envoies trop de messages d’affilée.';
    if (texte.indexOf('NON_CONNECTE') !== -1) return 'Ta session a expiré : reconnecte-toi.';
    if (texte.indexOf('MESSAGE_VIDE') !== -1) return 'Le message est vide.';
    if (texte.indexOf('NIVEAU_INVALIDE') !== -1) return 'Niveau de gentillesse inconnu.';
    if (texte.indexOf('DESTINATAIRE') !== -1) return 'Ce destinataire n’existe plus.';
    if (texte.indexOf('INTERDIT') !== -1) return 'Action réservée aux délégués et suppléants.';
    if (texte.indexOf('HORS_LIGNE') !== -1 || texte.indexOf('REPONSE_VIDE') !== -1) {
      return 'Le tchat a besoin d’une connexion à la base.';
    }
    if (texte.indexOf('JWT') !== -1 || texte.indexOf('permission') !== -1) {
      return 'La base refuse l’accès au tchat (session ou droits à vérifier).';
    }
    return 'Le tchat n’a pas pu se charger. Réessaie dans un instant.';
  }

  function charger(silencieux) {
    if (!sb()) {
      etat.erreur = 'Le tchat a besoin d’une connexion à la base.';
      peindre();
      return Promise.resolve();
    }

    if (!silencieux) {
      etat.chargement = true;
      peindre();
    }

    var taches = {
      feed: rpc('class_chat_feed', { p_limit: 200 }),
      stats: rpc('moderation_stats'),
      journal: rpc('moderation_feed', { p_limit: 40 }),
      reactions: rpc('class_reactions_feed', { p_limit: 300 }),
      climat: rpc('class_climate')
    };

    if (etat.onglet === 'prive') {
      taches.fils = rpc('private_threads');
      if (etat.fil) taches.fil = rpc('private_feed', { p_with: etat.fil, p_limit: 200 });
    }

    if (estStaff()) {
      taches.signales = rpc('private_flagged', { p_limit: 30 });
    }

    return Promise.all(
      Object.keys(taches).map(function (cle) {
        return taches[cle].then(function (res) { return { cle: cle, res: res }; });
      })
    )
      .then(function (paires) {
        paires.forEach(function (paire) {
          var res = paire.res;
          if (res.error) {
            if (paire.cle === 'feed') throw res.error;
            return;
          }
          if (paire.cle === 'feed') etat.messages = res.data || [];
          if (paire.cle === 'stats') etat.stats = res.data || null;
          if (paire.cle === 'journal') etat.journal = res.data || [];
          if (paire.cle === 'fils') etat.fils = res.data || [];
          if (paire.cle === 'fil') etat.messagesPrives = res.data || [];
          if (paire.cle === 'signales') etat.signales = res.data || [];
          if (paire.cle === 'climat') etat.climat = res.data || null;
          if (paire.cle === 'reactions') {
            var carte = {};
            (res.data || []).forEach(function (ligne) {
              if (!carte[ligne.message_id]) carte[ligne.message_id] = [];
              carte[ligne.message_id].push(ligne);
            });
            etat.reactions = carte;
          }
        });
        etat.erreur = null;
        etat.dernierChargement = Date.now();

        /* Première ouverture de l'onglet privé : on ouvre la conversation
           la plus récente pour ne pas laisser l'écran vide. */
        if (etat.onglet === 'prive' && !etat.fil && etat.fils.length) {
          etat.fil = etat.fils[0].other_id;
          etat.autoOuvert = true;
        }
      })
      .catch(function (erreur) {
        etat.erreur = messageErreur(erreur);
        if (window.console && console.warn) console.warn('[tchat]', erreur);
      })
      .then(function () {
        etat.chargement = false;

        if (etat.autoOuvert) {
          etat.autoOuvert = false;
          return charger(true);
        }

        peindre();
      });
  }

  /* --------------------------------------------------------------------------
   * Montage / démontage
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
        if (document.hidden || !etat.monte) return;
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

  /* --------------------------------------------------------------------------
   * Construction de l'interface
   * ----------------------------------------------------------------------- */
  function construire() {
    UI.clear(racine);

    /* --- en-tête ------------------------------------------------------- */
    dom.bascule = UI.el('button', {
      type: 'button',
      class: 'tchat-switch',
      'aria-pressed': 'true',
      onclick: function () {
        etat.filtre = !etat.filtre;
        garderPrefs();
        peindre();
        UI.toast(
          etat.filtre ? 'Filtre de gentillesse activé.' : 'Filtre désactivé : les messages partent tels quels.',
          etat.filtre ? 'success' : 'warning'
        );
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

    dom.btnCompliment = null;
    if (estStaff()) {
      dom.btnCompliment = UI.el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm tchat-compliment',
        onclick: function () {
          var client = sb();
          if (!client || typeof client.rpc !== 'function') return;
          client.rpc('set_compliment', { p_on: !complimentForce() }).then(function (res) {
            if (res.error) { UI.err(messageErreur(res.error)); return; }
            var store = window.ECEM.Store;
            if (store && store.refreshAll) {
              store.refreshAll().then(function () { peindre(); }).catch(function () { peindre(); });
            } else {
              peindre();
            }
          });
        }
      }, [UI.el('span', { text: '💖' }), UI.el('span', { class: 'hide-sm', text: 'Compliment forcé' })]);
    }

    dom.entete = UI.el('div', { class: 'tchat-head' }, [
      UI.el('div', { class: 'tchat-head-txt' }, [
        UI.el('h2', { id: 'tchat-title', text: 'Tchats' }),
        UI.el('p', {
          class: 'sub',
          text: 'Un filtre de gentillesse relit chaque message, public comme privé, avant publication.'
        })
      ]),
      UI.el('div', { class: 'tchat-outils' }, [
        dom.bascule,
        dom.niveaux,
        dom.btnStats,
        dom.btnCompliment,
        dom.compteur
      ])
    ]);

    /* --- onglets ------------------------------------------------------- */
    dom.onglets = UI.el('div', { class: 'tchat-onglets', role: 'tablist' }, [
      boutonOnglet('classe', 'Classe', 'chat'),
      boutonOnglet('prive', 'Messages privés', 'send')
    ]);

    /* --- panneau « classe » ------------------------------------------- */
    dom.log = UI.el('div', {
      class: 'chat-log tchat-log',
      'aria-live': 'polite',
      'aria-label': 'Messages du tchat de classe'
    });

    dom.champ = creerChamp('Écris à la classe… (Entrée pour envoyer)');
    dom.btnEnvoyer = boutonEnvoi();
    dom.btnAdoucir = UI.el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm tchat-adoucir',
      title: 'L’IA réécrit ton message plus gentiment avant l’envoi',
      onclick: function () { adoucir(); }
    }, [UI.el('span', { text: '✨' }), UI.el('span', { class: 'hide-sm', text: 'Adoucir' })]);

    dom.form = UI.el('form', {
      class: 'chat-form',
      onsubmit: function (evenement) {
        evenement.preventDefault();
        envoyer(null);
      }
    }, [dom.btnAdoucir, dom.champ, dom.btnEnvoyer]);

    dom.reponse = UI.el('div', { class: 'tchat-reponse', hidden: true });
    dom.epingles = UI.el('div', { class: 'tchat-epingles', hidden: true });

    dom.panneauClasse = UI.el('div', { class: 'tchat-panneau', dataset: { panneau: 'classe' } }, [
      dom.epingles,
      dom.log,
      dom.reponse,
      dom.form
    ]);

    /* --- panneau « privés » ------------------------------------------- */
    dom.filsListe = UI.el('div', { class: 'tchat-fils-liste' });
    dom.filEntete = UI.el('div', { class: 'tchat-fil-entete' });
    dom.filLog = UI.el('div', {
      class: 'chat-log tchat-log tchat-fil-log',
      'aria-live': 'polite',
      'aria-label': 'Messages privés'
    });
    dom.filChamp = creerChamp('Écris en privé… (Entrée pour envoyer)');
    dom.filEnvoyer = boutonEnvoi();
    dom.filForm = UI.el('form', {
      class: 'chat-form',
      onsubmit: function (evenement) {
        evenement.preventDefault();
        envoyer(etat.fil);
      }
    }, [dom.filChamp, dom.filEnvoyer]);

    dom.filBloc = UI.el('div', { class: 'tchat-fil' }, [dom.filEntete, dom.filLog, dom.filForm]);

    dom.choix = UI.el('div', { class: 'tchat-choix', hidden: true });

    dom.filsBouton = UI.el('button', {
      type: 'button',
      class: 'btn btn-soft btn-sm btn-block',
      onclick: function () {
        etat.choixOuvert = !etat.choixOuvert;
        etat.choixRecherche = '';
        peindre();
      }
    }, [UI.icon('plus', { size: 15 }), UI.el('span', { text: 'Nouvelle conversation' })]);

    dom.panneauPrive = UI.el('div', { class: 'tchat-panneau', dataset: { panneau: 'prive' }, hidden: true }, [
      UI.el('div', { class: 'tchat-prive' }, [
        UI.el('aside', { class: 'tchat-fils' }, [
          dom.filsBouton,
          dom.choix,
          dom.filsListe
        ]),
        dom.filBloc
      ])
    ]);

    /* --- panneau détections ------------------------------------------- */
    dom.panneauStats = UI.el('div', { class: 'tchat-stats', hidden: true });

    dom.alerte = UI.el('div', { class: 'alert alert--error is-hidden' });
    dom.statut = UI.el('p', { class: 'tchat-statut', 'aria-live': 'polite' });

    racine.appendChild(
      UI.el('div', { class: 'tchat' }, [
        dom.entete,
        dom.alerte,
        dom.onglets,
        dom.panneauStats,
        dom.panneauClasse,
        dom.panneauPrive,
        dom.statut
      ])
    );
  }

  function boutonOnglet(cle, libelle, icone) {
    return UI.el('button', {
      type: 'button',
      class: 'tchat-onglet',
      role: 'tab',
      dataset: { onglet: cle },
      onclick: function () {
        if (etat.onglet === cle) return;
        etat.onglet = cle;
        etat.choixOuvert = false;
        if (cle === 'prive' && !etat.fil && etat.fils.length) etat.fil = etat.fils[0].other_id;
        peindre();
        charger(false);
      }
    }, [UI.icon(icone, { size: 16 }), UI.el('span', { text: libelle })]);
  }

  function creerChamp(placeholder) {
    var champ = UI.el('textarea', {
      class: 'chat-input',
      rows: '1',
      maxlength: String(MAX_CARACTERES),
      autocomplete: 'off',
      placeholder: placeholder,
      'aria-label': placeholder
    });

    champ.addEventListener('input', function () {
      champ.style.height = 'auto';
      champ.style.height = Math.min(160, champ.scrollHeight) + 'px';
    });

    champ.addEventListener('keydown', function (evenement) {
      if (evenement.key === 'Enter' && !evenement.shiftKey) {
        evenement.preventDefault();
        envoyer(champ === dom.filChamp ? etat.fil : null);
      }
    });

    return champ;
  }

  function boutonEnvoi() {
    return UI.el('button', { type: 'submit', class: 'btn btn-primary chat-send' }, [
      UI.icon('send', { size: 17 }),
      UI.el('span', { class: 'hide-sm', text: 'Envoyer' })
    ]);
  }

  /* --------------------------------------------------------------------------
   * Peinture
   * ----------------------------------------------------------------------- */
  function peindre() {
    if (!racine || !etat.monte) return;

    dom.bascule.setAttribute('aria-pressed', etat.filtre ? 'true' : 'false');
    dom.bascule.classList.toggle('is-off', !etat.filtre);

    var force = complimentForce();
    if (force && etat.niveau !== 'ultra') etat.niveau = 'ultra';

    UI.$$('.tchat-seg-btn', dom.niveaux).forEach(function (bouton) {
      bouton.classList.toggle('is-active', bouton.dataset.niveau === etat.niveau);
      bouton.disabled = !etat.filtre || force;
    });

    if (dom.btnCompliment) {
      dom.btnCompliment.classList.toggle('is-active', force);
      dom.btnCompliment.title = force
        ? 'Compliment forcé activé : tout le monde écrit en version Ultra'
        : 'Forcer la version Ultra pour tout le monde';
    }

    UI.$$('.tchat-onglet', dom.onglets).forEach(function (bouton) {
      var actif = bouton.dataset.onglet === etat.onglet;
      bouton.classList.toggle('is-active', actif);
      bouton.setAttribute('aria-selected', actif ? 'true' : 'false');
    });

    var signales = (etat.journal || []).length + (etat.signales || []).length;
    dom.compteur.textContent = etat.onglet === 'classe'
      ? etat.messages.length + (etat.messages.length > 1 ? ' messages' : ' message')
      : etat.fils.length + (etat.fils.length > 1 ? ' conversations' : ' conversation');
    dom.compteur.title = signales + ' détection(s)';

    dom.btnStats.classList.toggle('is-active', etat.statsOuvertes);
    dom.panneauStats.hidden = !etat.statsOuvertes;
    if (etat.statsOuvertes) peindreStats();

    if (etat.erreur) {
      dom.alerte.className = 'alert alert--error';
      dom.alerte.textContent = etat.erreur;
    } else {
      dom.alerte.className = 'alert alert--error is-hidden';
    }

    dom.panneauClasse.hidden = etat.onglet !== 'classe';
    dom.panneauPrive.hidden = etat.onglet !== 'prive';

    if (etat.onglet === 'classe') {
      peindreMessages();
      peindreEpingles();
      peindreReponse();
    } else {
      peindrePrives();
    }
  }

  function peindreMessages() {
    var log = dom.log;
    var enBas = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    UI.clear(log);

    if (etat.chargement && !etat.messages.length) {
      log.appendChild(chargement());
      return;
    }

    if (!etat.messages.length) {
      log.appendChild(
        vide('chat', 'Personne n’a encore parlé', 'Écris le premier message : il sera relu et adouci si besoin.')
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
      log.appendChild(bulle(message, nomDe(message.author_id), message.author_id === monId(), null));
    });

    if (enBas) log.scrollTop = log.scrollHeight;
  }

  function trouverMessage(id) {
    for (var i = 0; i < etat.messages.length; i++) {
      if (String(etat.messages[i].id) === String(id)) return etat.messages[i];
    }
    return null;
  }

  function rangeeReactions(messageId) {
    var liste = etat.reactions[messageId] || [];
    var parEmoji = {};
    liste.forEach(function (ligne) { parEmoji[ligne.emoji] = ligne; });

    return UI.el('div', { class: 'tchat-reactions' }, EMOJIS.map(function (emoji) {
      var info = parEmoji[emoji];
      return UI.el('button', {
        type: 'button',
        class: 'tchat-reaction' + (info && info.moi ? ' is-active' : ''),
        title: info && Number(info.total) ? info.total + ' réaction(s)' : 'Réagir',
        'aria-label': 'Réagir ' + emoji,
        onclick: function () { reagir(messageId, emoji); }
      }, [
        UI.el('span', { class: 'tchat-reaction-emoji', text: emoji }),
        info && Number(info.total) > 0
          ? UI.el('span', { class: 'tchat-reaction-n', text: String(info.total) })
          : null
      ]);
    }));
  }

  function bulle(message, auteur, mien, cible) {
    var heure = new Date(message.created_at).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    var meta = [UI.el('b', { text: mien ? 'Toi' : auteur }), UI.el('span', { text: heure })];

    if (message.flagged) {
      var etiquettes = (message.categories || []).map(function (c) { return CATEGORIES[c] || c; });
      meta.push(
        UI.el('span', {
          class: 'tchat-badge',
          title: 'Message repéré par le filtre et adouci',
          text: 'adouci · ' + (etiquettes.join(', ') || 'à surveiller')
        })
      );
    }

    var children = [UI.el('div', { class: 'msg-meta' }, meta)];

    if (message.reply_to) {
      var cite = trouverMessage(message.reply_to);
      children.push(UI.el('div', { class: 'tchat-cite' }, [
        UI.el('span', { class: 'tchat-cite-qui', text: '↩︎ ' + (cite ? nomDe(cite.author_id) : 'message supprimé') }),
        UI.el('span', { class: 'tchat-cite-txt', text: cite ? String(cite.body).slice(0, 90) : '—' })
      ]));
    }

    children.push(
      UI.el('div', { class: 'msg-bubble' }, [UI.el('span', { class: 'tchat-corps', text: message.body })])
    );

    if (!cible) children.push(rangeeReactions(message.id));

    var actions = UI.el('div', { class: 'tchat-actions' });

    if (!cible) {
      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'tchat-action',
        title: 'Répondre à ce message',
        'aria-label': 'Répondre',
        onclick: function () { repondre(message); }
      }, [UI.icon('chat', { size: 13 })]));

      if (estStaff()) {
        actions.appendChild(UI.el('button', {
          type: 'button',
          class: 'tchat-action' + (message.pinned ? ' is-on' : ''),
          title: message.pinned ? 'Décrocher ce message' : 'Épingler ce message',
          'aria-label': 'Épingler',
          onclick: function () { basculerEpingle(message); }
        }, [UI.el('span', { text: '📌' })]));
      }
    }

    if (mien || estStaff()) {
      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'tchat-suppr',
        title: 'Supprimer ce message',
        'aria-label': 'Supprimer ce message',
        onclick: function () { supprimer(message.id, cible ? 'prive' : 'classe'); }
      }, [UI.icon('trash', { size: 13 })]));
    }

    if (actions.childNodes.length) children.push(actions);

    return UI.el('div', { class: 'msg' + (mien ? ' msg--mine' : '') + (message.pending ? ' msg--pending' : '') }, [
      UI.avatar(auteur, { size: 30 }),
      UI.el('div', { class: 'msg-col' }, children)
    ]);
  }

  function reagir(messageId, emoji) {
    rpc('class_react', { p_message: messageId, p_emoji: emoji }).then(function (res) {
      if (res.error) {
        UI.err(messageErreur(res.error));
        return;
      }
      charger(true);
    });
  }

  function repondre(message) {
    etat.reponse = message;
    peindreReponse();
    if (dom.champ) dom.champ.focus();
  }

  function basculerEpingle(message) {
    rpc('class_chat_pin', { p_id: message.id, p_pinned: !message.pinned }).then(function (res) {
      if (res.error) {
        UI.err(messageErreur(res.error));
        return;
      }
      UI.toast(message.pinned ? 'Message décroché.' : 'Message épinglé en haut du tchat.', 'ok');
      charger(true);
    });
  }

  function adoucir() {
    var texte = String(dom.champ.value || '').trim();
    if (!texte) { dom.champ.focus(); return; }
    if (etat.envoi) return;

    etat.envoi = true;
    reglerBoutons(true);
    dom.statut.textContent = 'Le filtre relit ton message…';

    analyserAvecIA(texte)
      .then(function (resultat) {
        var version = resultat[etat.niveau] || resultat.doux || texte;
        dom.champ.value = version;
        dom.statut.textContent = resultat.flagged
          ? 'Version adoucie proposée — tu peux la modifier ou l’envoyer telle quelle.'
          : 'Rien à adoucir : ton message est déjà tout doux.';
        if (resultat.flagged) {
          UI.toast('Message réécrit en version « ' + NIVEAUX[etat.niveau].label + ' ».', 'info');
        }
      })
      .then(function () {
        etat.envoi = false;
        reglerBoutons(false);
        dom.champ.focus();
      });
  }

  function peindreReponse() {
    if (!dom.reponse) return;

    if (!etat.reponse) {
      dom.reponse.hidden = true;
      UI.clear(dom.reponse);
      return;
    }

    dom.reponse.hidden = false;
    UI.clear(dom.reponse);
    dom.reponse.appendChild(UI.el('span', { class: 'tchat-reponse-qui', text: '↩︎ ' + nomDe(etat.reponse.author_id) }));
    dom.reponse.appendChild(UI.el('span', { class: 'tchat-reponse-txt', text: String(etat.reponse.body).slice(0, 90) }));
    dom.reponse.appendChild(UI.el('button', {
      type: 'button',
      class: 'icon-btn tchat-reponse-x',
      'aria-label': 'Annuler la réponse',
      onclick: function () { etat.reponse = null; peindreReponse(); }
    }, [UI.icon('x', { size: 13 })]));
  }

  function peindreEpingles() {
    if (!dom.epingles) return;

    var epingles = etat.messages.filter(function (m) { return m.pinned; });

    if (!epingles.length) {
      dom.epingles.hidden = true;
      UI.clear(dom.epingles);
      return;
    }

    dom.epingles.hidden = false;
    UI.clear(dom.epingles);
    dom.epingles.appendChild(UI.el('span', { class: 'tchat-epingles-titre', text: '📌 Épinglé' }));

    epingles.slice(-2).forEach(function (message) {
      dom.epingles.appendChild(UI.el('span', { class: 'tchat-epingles-item' }, [
        UI.el('b', { text: nomDe(message.author_id) + ' : ' }),
        UI.el('span', { text: String(message.body).slice(0, 110) })
      ]));
    });
  }

  function peindrePrives() {
    peindreFils();
    peindreFil();
    peindreChoix();
  }

  function peindreFils() {
    UI.clear(dom.filsListe);

    if (!etat.fils.length) {
      dom.filsListe.appendChild(
        vide('send', 'Aucune conversation', 'Choisis « Nouvelle conversation » pour écrire à quelqu’un.')
      );
      return;
    }

    etat.fils.forEach(function (fil) {
      var actif = fil.other_id === etat.fil;
      var item = UI.el('button', {
        type: 'button',
        class: 'tchat-fil-item' + (actif ? ' is-active' : ''),
        onclick: function () {
          etat.fil = fil.other_id;
          etat.choixOuvert = false;
          peindre();
          charger(true);
        }
      }, [
        UI.avatar(fil.prenom, { size: 32 }),
        UI.el('div', { class: 'tchat-fil-item-txt' }, [
          UI.el('div', { class: 'tchat-fil-item-nom' }, [
            UI.el('span', { text: fil.prenom }),
            UI.el('span', { class: 'faint', text: '· ' + UI.roleLabel(fil.role) })
          ]),
          UI.el('div', { class: 'tchat-fil-item-apercu', text: fil.last_body || '' })
        ]),
        Number(fil.signales) > 0
          ? UI.el('span', { class: 'tchat-fil-item-badge', title: 'Messages signalés', text: String(fil.signales) })
          : null
      ]);
      dom.filsListe.appendChild(item);
    });
  }

  function peindreFil() {
    var client = etat.fil ? profilDe(etat.fil) : null;
    UI.clear(dom.filEntete);

    if (!etat.fil) {
      dom.filBloc.classList.add('is-vide');
      UI.clear(dom.filLog);
      dom.filLog.appendChild(vide('send', 'Choisis une conversation', 'Sélectionne quelqu’un à gauche, ou lance une nouvelle conversation.'));
      dom.filForm.hidden = true;
      dom.filEntete.appendChild(UI.el('div', { class: 'tchat-fil-titre' }, [
        UI.el('h3', { text: 'Messages privés' })
      ]));
      return;
    }

    dom.filBloc.classList.remove('is-vide');
    dom.filForm.hidden = false;

    var nom = client ? client.prenom : nomDe(etat.fil);

    dom.filEntete.appendChild(UI.el('div', { class: 'tchat-fil-titre' }, [
      UI.avatar(nom, { size: 34 }),
      UI.el('div', {}, [
        UI.el('h3', { text: nom }),
        UI.el('p', {
          class: 'faint',
          text: (client ? UI.roleLabel(client.role) : 'Compte') + ' · conversation privée, filtrée comme le reste'
        })
      ])
    ]));

    var log = dom.filLog;
    var enBas = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    UI.clear(log);

    if (!etat.messagesPrives.length) {
      log.appendChild(
        vide('send', 'Aucun message', 'Dis bonjour : ton message sera relu et adouci si nécessaire.')
      );
      return;
    }

    var jourCourant = null;
    etat.messagesPrives.forEach(function (message) {
      var jour = UI.dayLabel ? UI.dayLabel(message.created_at) : '';
      if (jour !== jourCourant) {
        jourCourant = jour;
        log.appendChild(UI.el('div', { class: 'chat-day', text: jour }));
      }
      log.appendChild(bulle(message, nomDe(message.sender_id), message.sender_id === monId(), etat.fil));
    });

    if (enBas) log.scrollTop = log.scrollHeight;
  }

  function peindreChoix() {
    var hote = dom.choix;
    hote.hidden = !etat.choixOuvert;
    if (!etat.choixOuvert) return;

    UI.clear(hote);

    var recherche = UI.el('input', {
      type: 'search',
      placeholder: 'Chercher un prénom…',
      value: etat.choixRecherche,
      oninput: function (evenement) {
        etat.choixRecherche = evenement.target.value;
        peindreChoix();
        var champ = dom.choix.querySelector('input');
        if (champ) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
      }
    });

    hote.appendChild(recherche);

    var moi = monId();
    var filtre = normaliser(etat.choixRecherche);
    var liste = profils()
      .filter(function (profil) { return profil.id !== moi; })
      .filter(function (profil) { return !filtre || normaliser(profil.prenom).indexOf(filtre) !== -1; })
      .sort(function (a, b) { return a.prenom.localeCompare(b.prenom, 'fr'); });

    if (!liste.length) {
      hote.appendChild(UI.el('p', { class: 'faint', text: 'Personne à qui écrire pour l’instant.' }));
      return;
    }

    hote.appendChild(
      UI.el('div', { class: 'tchat-choix-liste' }, liste.slice(0, 40).map(function (profil) {
        return UI.el('button', {
          type: 'button',
          class: 'tchat-choix-item',
          onclick: function () {
            etat.fil = profil.id;
            etat.choixOuvert = false;
            peindre();
            charger(false);
          }
        }, [
          UI.avatar(profil.prenom, { size: 26 }),
          UI.el('span', { text: profil.prenom }),
          UI.el('span', { class: 'faint', text: UI.roleLabel(profil.role) })
        ]);
      }))
    );
  }

  function chargement() {
    return UI.el('div', { class: 'tchat-vide' }, [
      UI.el('span', { class: 'spinner' }),
      UI.el('span', { text: 'Chargement des messages…' })
    ]);
  }

  function vide(icone, titre, texte) {
    return UI.el('div', { class: 'tchat-vide' }, [
      UI.icon(icone, { size: 26 }),
      UI.el('div', { class: 'tchat-vide-titre', text: titre }),
      UI.el('div', { class: 'tchat-vide-texte', text: texte })
    ]);
  }

  /* --------------------------------------------------------------------------
   * Panneau des détections
   * ----------------------------------------------------------------------- */
  function peindreStats() {
    var hote = dom.panneauStats;
    UI.clear(hote);

    var stats = etat.stats || {};
    var total = Number(stats.total || 0);
    var jour = Number(stats.dernier_jour || 0);
    var parNiveau = stats.par_niveau || {};
    var parCategorie = stats.par_categorie || {};

    hote.appendChild(UI.el('div', { class: 'tchat-stats-head' }, [
      UI.el('h3', { text: 'Journal des détections' }),
      UI.el('p', {
        class: 'sub',
        text: estStaff()
          ? 'Ce que le filtre a repéré, dans la classe comme en privé, et comment chaque message a été réécrit.'
          : 'Ce que le filtre a repéré dans tes messages.'
      })
    ]));

    var climat = etat.climat;
    if (climat && typeof climat.score === 'number') {
      var tonClimat = climat.score >= 80 ? 'très serein'
        : climat.score >= 60 ? 'correct'
        : climat.score >= 40 ? 'tendu' : 'difficile';

      hote.appendChild(UI.el('div', { class: 'climat' }, [
        UI.el('div', { class: 'climat-tete' }, [
          UI.el('b', { text: 'Climat de classe : ' + climat.score + '/100' }),
          UI.el('span', { class: 'faint', text: ' · ' + tonClimat })
        ]),
        UI.el('div', { class: 'climat-jauge' }, [
          UI.el('span', { class: 'climat-fill', style: { width: Math.max(2, climat.score) + '%' } })
        ]),
        UI.el('p', { class: 'sub climat-resume', text: resumeSemaine(climat) })
      ]));

      if (estStaff() && Number(climat.nb_paires) > 0) {
        hote.appendChild(UI.el('div', { class: 'tchat-alerte' }, [
          UI.el('b', { text: '⚠️ Harcèlement répété' }),
          UI.el('span', {
            text: ' : ' + climat.paires.map(function (paire) {
              return paire.a + ' → ' + paire.b + ' (' + paire.n + ' fois)';
            }).join(' · ')
          })
        ]));
      }
    }

    hote.appendChild(UI.el('div', { class: 'tchat-chiffres' }, [
      chiffre(total, 'détections au total'),
      chiffre(jour, 'sur les dernières 24 h'),
      chiffre(Number(parNiveau[etat.niveau] || 0), 'adoucis en « ' + NIVEAUX[etat.niveau].label + ' »')
    ]));

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

    /* Messages privés signalés : visible par les modérateurs uniquement. */
    if (estStaff()) {
      hote.appendChild(
        UI.el('div', { class: 'tchat-signales' }, [
          UI.el('h4', { text: 'Messages privés signalés' }),
          etat.signales.length
            ? UI.el('ul', { class: 'tchat-signales-liste' }, etat.signales.map(function (entree) {
                return UI.el('li', {}, [
                  UI.el('span', { class: 'tchat-signales-qui', text: entree.sender + ' → ' + entree.recipient }),
                  UI.el('span', {
                    class: 'tchat-signales-extrait',
                    text: '« ' + (entree.excerpt || '') + ' »'
                  }),
                  UI.el('span', {
                    class: 'tchat-signales-cat',
                    text: (entree.categories || []).map(function (c) { return CATEGORIES[c] || c; }).join(', ') || 'à surveiller'
                  }),
                  UI.el('button', {
                    type: 'button',
                    class: 'icon-btn tchat-signales-suppr',
                    title: 'Supprimer ce message privé',
                    'aria-label': 'Supprimer ce message privé',
                    onclick: function () { supprimerPrive(entree.id); }
                  }, [UI.icon('trash', { size: 13 })])
                ]);
              }))
            : UI.el('p', { class: 'faint', text: 'Aucun message privé signalé. Tout va bien.' })
        ])
      );
    }

    if (!etat.journal.length) {
      hote.appendChild(UI.el('p', { class: 'faint', text: 'Aucune détection dans les messages de classe pour le moment.' }));
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
  function envoyer(cible) {
    if (etat.envoi) return;

    var champ = cible ? dom.filChamp : dom.champ;
    var texte = String(champ.value || '').trim();

    if (!texte) {
      champ.focus();
      return;
    }

    etat.envoi = true;
    reglerBoutons(true);
    dom.statut.textContent = etat.filtre ? 'Le filtre de gentillesse relit ton message…' : 'Envoi…';

    var analyse = etat.filtre
      ? analyserAvecIA(texte)
      : Promise.resolve({
          flagged: false, categories: [], severity: 0,
          doux: texte, genant: texte, ultra: texte, source: 'filtre-off'
        });

    analyse
      .then(function (resultat) {
        var version = etat.filtre ? (resultat[etat.niveau] || resultat.doux || texte) : texte;
        return envoyerAuServeur(version, texte, resultat, cible);
      })
      .then(function () {
        champ.value = '';
        champ.style.height = 'auto';
        dom.statut.textContent = '';
      })
      .catch(function (erreur) {
        dom.statut.textContent = '';
        UI.err(messageErreur(erreur));
      })
      .then(function () {
        etat.envoi = false;
        reglerBoutons(false);
        champ.focus();
      });
  }

  function reglerBoutons(occupe) {
    [dom.btnEnvoyer, dom.filEnvoyer].forEach(function (bouton) {
      if (bouton) bouton.disabled = occupe;
    });
    [dom.champ, dom.filChamp].forEach(function (champ) {
      if (champ) champ.disabled = occupe;
    });
  }

  function envoyerAuServeur(version, original, analyse, cible) {
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

    if (cible) {
      enveloppe.p_to = cible;
    } else if (etat.reponse) {
      enveloppe.p_reply_to = etat.reponse.id;
    }

    var appel = cible ? rpc('private_send', enveloppe) : rpc('class_chat_send', enveloppe);

    return appel.then(function (res) {
      if (res.error) throw res.error;
      var id = res.data && res.data.id;

      if (adouci && id && !cible) {
        rpc('moderation_log', {
          p_message_id: id,
          p_categories: analyse.categories || [],
          p_severity: analyse.severity || 0,
          p_level: etat.niveau,
          p_source: analyse.source || null,
          p_excerpt: original.slice(0, 180)
        });
      }

      if (adouci) {
        UI.toast(
          'Message adouci avant publication (niveau ' + NIVEAUX[etat.niveau].label + ').',
          'info'
        );
      }

      etat.reponse = null;
      return charger(true);
    });
  }

  function supprimer(id, espace) {
    if (!window.confirm('Supprimer ce message ?')) return;

    var appel = espace === 'prive'
      ? rpc('private_delete', { p_id: id })
      : rpc('class_chat_delete', { p_id: id });

    appel
      .then(function (res) {
        if (res.error) throw res.error;
        return charger(true);
      })
      .then(function () { UI.toast('Message supprimé.', 'success'); })
      .catch(function (erreur) { UI.err(messageErreur(erreur)); });
  }

  function supprimerPrive(id) {
    if (!window.confirm('Supprimer ce message privé signalé ?')) return;

    rpc('private_delete', { p_id: id })
      .then(function (res) {
        if (res.error) throw res.error;
        return charger(true);
      })
      .then(function () { UI.toast('Message privé supprimé.', 'success'); })
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
