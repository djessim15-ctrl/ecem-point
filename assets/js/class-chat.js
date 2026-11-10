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
 * réécrit en disant le CONTRAIRE du message.
 *
 * Le filtre est OBLIGATOIRE et ne peut pas être désactivé : ni par un élève,
 * ni par un délégué, ni par l'admin. Le serveur refuse d'ailleurs tout message
 * qui contient encore une insulte (fonction `contient_insulte`).
 *
 * Droits :
 *   • Élève     : lire et écrire dans les deux tchats, réagir, répondre.
 *   • Délégué / suppléant : mêmes droits + annonces + épingler + modération
 *     des messages privés signalés.
 *   • Admin     : masquer (bloquer), modifier et supprimer n'importe quel
 *     message du tchat de classe, et voir les messages masqués.
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
    doux: { label: 'Contraire', aide: 'Le message est remplacé par son contraire, sans aucune insulte.' },
    genant: { label: 'Très contraire', aide: 'Le contraire, avec des excuses en plus.' },
    ultra: { label: 'Mielleux', aide: 'Le contraire, en version débordante de compliments.' }
  };

  var EMOJIS = ['❤️', '😂', '👏'];

  var CATEGORIES = {
    insulte: 'insulte ou humiliation',
    humiliation: 'humiliation',
    harcelement: 'harcèlement',
    harcelement_sexuel: 'harcèlement sexuel',
    agressivite: 'agressivité',
    menace: 'menace ou intimidation',
    discrimination: 'propos discriminatoire',
    exclusion: 'exclusion organisée',
    rumeur: 'rumeur ou diffamation',
    indirecte: 'attaque indirecte',
    usurpation: 'usurpation ou manipulation',
    acharnement: 'acharnement ciblé',
    spam: 'spam',
    flood: 'flood',
    majuscules: 'majuscules agressives',
    haine: 'haine',
    donnees_perso: 'données personnelles'
  };

  /* Les familles les plus lourdes : elles déclenchent une alerte immédiate
     dans « Détections » et sont expliquées à l'auteur du message. */
  var FAMILLES_GRAVES = ['harcelement_sexuel', 'menace', 'discrimination', 'usurpation', 'exclusion'];

  /* --------------------------------------------------------------------------
   * Préférences locales
   * ----------------------------------------------------------------------- */
  function lirePrefs() {
    try {
      var brut = window.localStorage.getItem(LS_KEY);
      var objet = brut ? JSON.parse(brut) : null;
      return {
        niveau: objet && NIVEAUX[objet.niveau] ? objet.niveau : 'doux',
        stats: !!(objet && objet.stats)
      };
    } catch (e) {
      return { niveau: 'doux', stats: false };
    }
  }

  function garderPrefs() {
    try {
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ niveau: etat.niveau, stats: etat.statsOuvertes })
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
    niveau: prefs.niveau,
    annonce: false,
    statsOuvertes: prefs.stats,
    onglet: 'classe',
    messages: [],
    stats: null,
    journal: [],
    signales: [],
    fils: [],
    fil: null,
    messagesPrives: [],
    annonces: [],
    signalements: [],
    signalesFaits: {},
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

  function estAdmin() {
    var store = window.ECEM && window.ECEM.Store;
    return !!(store && store.isAdmin && store.isAdmin());
  }

  /* Annonces : délégués, suppléants et admins. */
  function peutAnnoncer() {
    return estStaff() || estAdmin();
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

  /* Devine la personne visée : premier prénom de la classe mentionné dans le
     message d'origine. Sert à repérer l'acharnement (même cible, plusieurs
     fois) même quand l'IA n'est pas disponible. */
  function detecterCible(texte) {
    var plat = normaliser(texte);
    if (!plat) return null;

    var trouvee = null;
    profils().forEach(function (profil) {
      var prenom = normaliser(profil.prenom);
      if (prenom.length < 3) return;
      if (plat.indexOf(prenom) === -1) return;
      if (!trouvee || prenom.length > normaliser(trouvee).length) trouvee = profil.prenom;
    });

    return trouvee;
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
  /* --------------------------------------------------------------------------
   * Filtre local : neuf familles de violences, chacune avec sa réécriture.
   *
   * Chaque famille sait :
   *   • la reconnaître (mots, phrases ou expressions régulières) ;
   *   • la réécrire en disant le CONTRAIRE (remplacements de phrases) ;
   *   • produire une phrase de secours sûre si un morceau blessant subsiste.
   *
   * Règle absolue : après réécriture, on relit le résultat. S'il contient
   * encore un motif d'une famille, on le remplace entièrement par la phrase
   * de secours de la famille la plus grave. Aucune insulte ne sort jamais.
   * ----------------------------------------------------------------------- */
  var GROS_MOTS = [
    'abruti', 'andouille', 'batard', 'bete', 'bouffon', 'brute', 'con', 'conne',
    'connard', 'connasse', 'connerie', 'cretin', 'debile', 'enculé', 'encule',
    'fdp', 'idiot', 'idiote', 'imbecile', 'merde', 'naze', 'nul', 'nulle',
    'pauvre type', 'putain', 'salaud', 'salope', 'stupide', 'ta gueule',
    'ferme la', 'va te faire', 'chier', 'chieur', 'bordel', 'tarlouze',
    'tapette', 'mongol', 'attardé', 'raton', 'pede'
  ];

  var AGRESSIFS = [
    'je te deteste', 'tu me degoutes', 'degage', 'casse toi', 'la ferme',
    'tu vas voir', 'je vais te', 'personne ne t aime', 'tout le monde te deteste',
    'tu ne comprends jamais rien', 'tu sers a rien', 'tu es une honte'
  ];

  var INVERSIONS = [
    [/\bje (?:te|t')\s*(?:d[eé]teste|hais|ha[iï]s)\b/gi, 'je t’aime'],
    [/\bje vous (?:d[eé]teste|hais)\b/gi, 'je vous aime'],
    [/\b(?:tout le monde|personne ne) te (?:d[eé]teste|aime)\b/gi, 'tout le monde t’adore'],
    [/\bta gueule\b/gi, 'je t’écoute avec plaisir'],
    [/\b(?:ferme|fermez)[\s-]*(?:la|ta gueule|ton clapet)\b/gi, 'raconte-moi encore'],
    [/\b(?:d[eé]gage|casse[- ]toi|barre[- ]toi|d[eé]campe)\b/gi, 'reste avec moi'],
    [/\bva te faire (?:foutre|voir)\b/gi, 'viens me faire un câlin'],
    [/\btu me (?:saoules?|casses? les pieds|gonfles?)\b/gi, 'tu me fais rire'],
    [/\btu me d[eé]go[uû]tes?\b/gi, 'tu me plais beaucoup'],
    [/\bje vais te (?:casser|tuer|frapper)\b/gi, 'je vais te faire un compliment'],
    [/\btu vas voir\b/gi, 'tu vas être content'],
    [/\bpersonne ne t'?aime\b/gi, 'tout le monde t’aime'],
    [/\btu ne comprends jamais rien\b/gi, 'tu comprends très vite'],
    [/\btu sers à rien\b/gi, 'tu es précieux pour le groupe'],
    [/\btu es une honte\b/gi, 'tu es quelqu’un de bien']
  ];

  var CONTRAIRES = [
    [/\b(?:abruti|abrutie|abruti?e?s?)\b/gi, 'champion'],
    [/\b(?:idiot|idiote|idiots)\b/gi, 'génie'],
    [/\b(?:imb[eé]cile|imb[eé]ciles)\b/gi, 'personne brillante'],
    [/\b(?:d[eé]bile|d[eé]biles)\b/gi, 'malin'],
    [/\b(?:cr[eé]tin|cr[eé]tine|cr[eé]tins)\b/gi, 'talentueux'],
    [/\b(?:connard|connasse|conard)\b/gi, 'personne géniale'],
    [/\b(?:con|conne|cons)\b/gi, 'génial'],
    [/\b(?:nul|nulle|nuls|naze)\b/gi, 'incroyable'],
    [/\b(?:moche|moches)\b/gi, 'magnifique'],
    [/\b(?:salaud|salope|ordure|raclure)\b/gi, 'trésor'],
    [/\b(?:bouffon|clown)\b/gi, 'étoile'],
    [/\b(?:andouille|brute|b[êe]te)\b/gi, 'merveille'],
    [/\b(?:batard|b[âa]tard)\b/gi, 'ami formidable'],
    [/\b(?:stupide)\b/gi, 'brillant'],
    [/\b(?:merde|bordel)\b/gi, 'mince alors'],
    [/\b(?:putain|pute)\b/gi, 'waouh'],
    [/\b(?:fdp|encul[eé]|encule)\b/gi, 'mon ami'],
    [/\b(?:chier|chieur|chieuse)\b/gi, 'rigoler'],
    [/\b(?:pauvre type)\b/gi, 'personne attachante'],
    [/\b(?:tapette|tarlouze|p[eé]d[eé])\b/gi, 'personne formidable'],
    [/\b(?:mongol|attard[eé])\b/gi, 'personne brillante'],
    [/\b(?:raton)\b/gi, 'personne respectable']
  ];

  /* Les familles, de la plus grave à la plus légère. */
  var FAMILLES = [
    {
      cle: 'harcelement_sexuel',
      label: 'harcèlement sexuel',
      severite: 3,
      motifs: [
        /(envoie|envoies|envoi)[- ]moi .{0,20}(photo|nue?s?|nudes?|video)/,
        /photo de (toi|ton corps|tes fesses)/,
        /arrete de dire non/,
        /(montre|deshabille)[- ]toi/,
        /tu es (bonne|bandante|sexy)/,
        /suce[- ]moi/,
        /(montre|envoie).{0,15}(ton|tes) (corps|seins|fesses)/
      ],
      remplacements: [
        [/\barr[eê]te de dire non\b/gi, 'je respecte ton non'],
        [/\benvoie[- ]moi (?:une )?(?:photo|nue?s?|nudes?|vidéo)[^.!?]*/gi, 'ne m’envoie rien du tout, ta vie privée t’appartient'],
        [/\bphoto de (?:toi|ton corps|tes fesses)\b[^.!?]*/gi, 'prends soin de toi, je respecte ton intimité'],
        [/\b(?:montre|déshabille)[- ]toi\b[^.!?]*/gi, 'reste comme tu es, tu es très bien'],
        [/\btu es (?:bonne|bandante|sexy)\b/gi, 'tu es une personne respectée'],
        [/\bsuce[- ]moi\b/gi, 'je te respecte']
      ],
      secours: function () {
        return 'Je respecte ton non et ton intimité, et je ne te demanderai jamais rien.';
      }
    },
    {
      cle: 'menace',
      label: 'menace ou intimidation',
      severite: 3,
      motifs: [
        /tu vas (le|la|me|nous) ?(regretter|payer)/,
        /(si tu|quand tu) (parles|dis|racontes|balances).{0,60}(regretter|payer|va voir)/,
        /je vais te (casser|frapper|tuer|buter|faire mal)/,
        /(attention|gare) a toi/,
        /je sais ou tu habites/,
        /tu vas voir ce que/
      ],
      remplacements: [
        [/\bsi tu (?:parles|dis|racontes|balances)[^.!?]{0,60}?(?:au prof|à quelqu’un|à qui que ce soit)\b/gi, 'tu peux en parler au prof'],
        [/\btu vas (?:le|la|me) (?:regretter|payer)\b/gi, 'tu n’as rien à craindre'],
        [/\bje vais te (?:casser|frapper|tuer|buter|faire mal)\b/gi, 'je vais te faire un compliment'],
        [/\b(?:attention|gare) à toi\b/gi, 'prends soin de toi'],
        [/\bje sais où tu habites\b/gi, 'je te souhaite un bon retour chez toi'],
        [/\btu vas voir ce que\b/gi, 'tu vas être content de']
      ],
      secours: function () {
        return 'Je te souhaite de te sentir en sécurité, et je m’excuse si mes mots ont pu faire peur.';
      }
    },
    {
      cle: 'discrimination',
      label: 'propos discriminatoire',
      severite: 3,
      motifs: [
        /retourne dans ton pays/,
        /sale (arabe|juif|noir|musulman|gouine|pede|pd)/,
        /a cause de (ton|ta|tes) (origine|religion|couleur|peau|handicap|accent|nom)/,
        /pas a ta place (ici|dans)/,
        /tu n'?as rien a faire (ici|dans (notre|cette) classe)/
      ],
      remplacements: [
        [/\btu ne devrais pas être dans (?:notre|cette|la) classe\b/gi, 'tu as toute ta place dans notre classe'],
        [/\bà cause de (?:ton|ta|tes) (?:origine|religion|couleur|peau|handicap|accent|nom)\b/gi, 'quelle que soit ton origine'],
        [/\bretourne dans ton pays\b/gi, 'tu es chez toi ici'],
        [/\bsale (?:arabe|juif|noir|musulman|gouine|pédé|pd)\b/gi, 'personne formidable'],
        [/\btu n'?as rien à faire (?:ici|dans (?:notre|cette) classe)\b/gi, 'tu as toute ta place ici']
      ],
      secours: function () {
        return 'Tu as toute ta place dans cette classe, quelle que soit ton origine. Je te respecte.';
      }
    },
    {
      cle: 'usurpation',
      label: 'usurpation ou manipulation',
      severite: 3,
      motifs: [
        /en pretendant etre/,
        /fais[- ]toi passer pour/,
        /fais semblant d'?etre/,
        /(prends|pirate|vole) (son|le) (compte|pseudo)/,
        /avec (son|le) (compte|pseudo) (de|d')/
      ],
      remplacements: [],
      secours: function () {
        return 'Je ne me fais jamais passer pour quelqu’un d’autre : je parle en mon nom, gentiment.';
      }
    },
    {
      cle: 'exclusion',
      label: 'exclusion organisée',
      severite: 2,
      motifs: [
        /ignorez[- ](le|la|les)/,
        /ne (la|le|les) (laissez|invitez) pas/,
        /personne ne (lui )?parle/,
        /on ne (lui )?parle plus/,
        /(virez|excluez)[- ](le|la|les)/,
        /faites[- ](le|la) partir/,
        /ne le laissez pas rejoindre/
      ],
      remplacements: [
        [/\bignorez[- ](le|la|les)\b/gi, 'accueillez $1'],
        [/\bne (?:la|le|les) (?:laissez|invitez) pas\b/gi, 'invitez $1'],
        [/\bne (?:la|le) laissez pas rejoindre (?:le|notre) groupe\b/gi, 'faites-le rejoindre le groupe'],
        [/\bpersonne ne (?:lui )?parle\b/gi, 'tout le monde lui parle'],
        [/\bon ne (?:lui )?parle plus\b/gi, 'on lui parle toujours'],
        [/\b(?:virez|excluez)[- ](?:le|la|les)\b/gi, 'gardez tout le monde'],
        [/\bfaites[- ](?:le|la) partir\b/gi, 'gardez-le avec nous']
      ],
      secours: function (cible) {
        if (cible) {
          return 'Tout le monde est bienvenu : accueillons ' + cible + ' et faisons-lui une place dans le groupe.';
        }
        return 'Tout le monde est bienvenu : accueillons chaque personne du groupe.';
      }
    },
    {
      cle: 'rumeur',
      label: 'rumeur ou diffamation',
      severite: 2,
      motifs: [
        /faites tourner/,
        /il parait que/,
        /j'?ai entendu (que|dire)/,
        /tout le monde dit que/,
        /(balancez|diffusez|faites circuler)/,
        /quelque chose de honteux/
      ],
      remplacements: [],
      secours: function (cible) {
        if (cible) {
          return 'Je ne fais pas circuler de rumeur : ' + cible + ' mérite le respect.';
        }
        return 'Je ne fais pas circuler de rumeur et je ne répète rien sans preuve.';
      }
    },
    {
      cle: 'indirecte',
      label: 'attaque indirecte',
      severite: 1,
      motifs: [
        /certains feraient mieux/,
        /je ne vise personne/,
        /ceux qui se reconnaissent/,
        /tu sais tres bien (que je parle de toi|de qui je parle)/,
        /sans vouloir viser personne/,
        /comme par hasard/
      ],
      remplacements: [],
      secours: function () {
        return 'Je parle de toi avec respect, sans sous-entendu ni allusion.';
      }
    },
    {
      cle: 'acharnement',
      label: 'acharnement ciblé',
      severite: 2,
      motifs: [
        /encore toi/,
        /personne ne veut (te lire|lire tes messages)/,
        /(on en a marre|tout le monde a marre) de toi/,
        /tu reviens encore/
      ],
      remplacements: [
        [/\bencore toi\b/gi, 'ravi de te lire'],
        [/\bpersonne ne veut (?:te lire|lire tes messages)\b/gi, 'tout le monde aime te lire'],
        [/\b(?:on en a marre|tout le monde a marre) de toi\b/gi, 'on t’apprécie'],
        [/\btu reviens encore\b/gi, 'tu es toujours le bienvenu']
      ],
      secours: function (cible) {
        if (cible) return 'Je suis content de lire ' + cible + ', tout le monde mérite sa place ici.';
        return 'Je suis content de te lire, et tout le monde mérite sa place ici.';
      }
    },
    {
      cle: 'insulte',
      label: 'insulte ou humiliation',
      severite: 2,
      mots: GROS_MOTS,
      phrases: AGRESSIFS,
      motifs: [],
      remplacements: [],
      secours: function () {
        return 'Je préfère ne rien dire de méchant et te souhaiter une très bonne journée.';
      }
    }
  ];

  function echapper(texte) {
    return String(texte).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normaliser(texte) {
    return String(texte || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inverser(texte) {
    var sortie = String(texte || '');
    var change = false;

    INVERSIONS.concat(CONTRAIRES).forEach(function (paire) {
      var avant = sortie;
      sortie = sortie.replace(paire[0], paire[1]);
      if (sortie !== avant) change = true;
    });

    return { texte: sortie.replace(/\s+/g, ' ').trim(), change: change };
  }

  /* Une famille correspond-elle à ce texte ? */
  function familleTouche(famille, plat) {
    if (famille.mots) {
      var mot = famille.mots.some(function (m) {
        return new RegExp('(^|[^a-z])' + echapper(m) + '([^a-z]|$)').test(plat);
      });
      if (mot) return true;
    }

    if (famille.phrases) {
      var phrase = famille.phrases.some(function (p) { return plat.indexOf(p) !== -1; });
      if (phrase) return true;
    }

    if (famille.motifs) {
      return famille.motifs.some(function (motif) { return motif.test(plat); });
    }

    return false;
  }

  function famillesDetectees(texte) {
    var plat = normaliser(texte);
    return FAMILLES.filter(function (famille) { return familleTouche(famille, plat); });
  }

  /* Réécrit un texte en disant le contraire, famille par famille, puis
     vérifie qu'il ne reste aucun motif. */
  function contredire(texte, familles, cible) {
    var sortie = String(texte || '');
    var change = false;

    familles.forEach(function (famille) {
      (famille.remplacements || []).forEach(function (paire) {
        var avant = sortie;
        sortie = sortie.replace(paire[0], paire[1]);
        if (sortie !== avant) change = true;
      });
    });

    var retourne = inverser(sortie);
    sortie = retourne.texte;
    change = change || retourne.change;

    var restantes = famillesDetectees(sortie);

    if (restantes.length) {
      var grave = restantes[0]; /* la liste est triée du plus grave au plus léger */
      return { texte: grave.secours(cible), change: true, secours: true };
    }

    return { texte: sortie, change: change, secours: false };
  }

  /* Filet de sécurité appliqué aux textes renvoyés par l'IA. */
  function sansInsulte(texte) {
    if (!texte) return texte;
    var familles = famillesDetectees(texte);
    if (!familles.length) return String(texte);
    return contredire(texte, familles, null).texte;
  }

  function analyserLocalement(brut, cible) {
    var texte = String(brut || '');
    var familles = famillesDetectees(texte);
    var categories = familles.map(function (f) { return f.cle; });
    var severite = familles.reduce(function (max, f) { return Math.max(max, f.severite); }, 0);

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

    if (/(\b[\w'-]+\b)(\s+\1){4,}/i.test(normaliser(texte))) {
      categories.push('spam');
      severite = Math.max(severite, 1);
    }

    if (!categories.length) {
      return { flagged: false, categories: [], severity: 0, doux: texte, genant: texte, ultra: texte };
    }

    var retourne = contredire(texte, familles, cible);
    var base = retourne.texte;

    return {
      flagged: true,
      categories: categories,
      severity: Math.min(3, severite),
      douteux: retourne.secours,
      doux: base,
      genant: 'Pardon, je me suis emporté ! ' + base + ' Je m’excuse platement 🙏',
      ultra: base + ' Tu es une personne magnifique, brillante et merveilleuse 💖🌟 Je te respecte infiniment 🙇'
    };
  }

  /* --------------------------------------------------------------------------
   * Analyse IA (Edge Function `moderate` → Groq)
   * ----------------------------------------------------------------------- */
  function analyserAvecIA(texte, cible) {
    var cfg = (window.ECEM && window.ECEM.cfg) || {};
    var client = sb();

    if (!client || !client.auth || !cfg.SUPABASE_URL || demo()) {
      return Promise.resolve(degrade(analyserLocalement(texte, cible)));
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
          body: JSON.stringify({ text: texte, cible: cible || null }),
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
            /* Filet de sécurité : si l'IA a laissé un morceau blessant, on le
             * réécrit localement pour que le message dise le contraire. */
            return {
              flagged: donnees.flagged === true,
              categories: Array.isArray(donnees.categories) ? donnees.categories : [],
              severity: Number(donnees.severity) || 0,
              doux: sansInsulte(donnees.doux),
              genant: sansInsulte(donnees.genant || donnees.doux),
              ultra: sansInsulte(donnees.ultra || donnees.genant || donnees.doux),
              cible: donnees.cible || cible || null,
              source: 'ia:' + (donnees.modele || 'gpt-oss-120b'),
              ms: donnees.ms || 0
            };
          })
          .catch(function () {
            window.clearTimeout(minuteur);
            return degrade(analyserLocalement(texte, cible));
          });
      })
      .catch(function () {
        return degrade(analyserLocalement(texte, cible));
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
    if (texte.indexOf('INTERDIT') !== -1) return 'Action réservée aux délégués, suppléants et administrateurs.';
    if (texte.indexOf('CONTENU_INTERDIT') !== -1 || texte.indexOf('INSULTE_INTERDITE') !== -1) {
      return 'Ton message contient encore une violence (insulte, menace, exclusion…). ' +
        'Le filtre l’a refusé : utilise ✨ Inverser, ou dis-le autrement.';
    }
    if (texte.indexOf('CIBLE_INVALIDE') !== -1) return 'Tu ne peux pas signaler ton propre message.';
    if (texte.indexOf('MESSAGE_INTROUVABLE') !== -1) return 'Ce message n’existe plus.';
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

    if (estStaff() || estAdmin()) {
      taches.signales = rpc('private_flagged', { p_limit: 30 });
      taches.signalements = rpc('class_reports_feed', { p_limit: 40 });
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
          if (paire.cle === 'feed') {
            etat.messages = res.data || [];
            etat.annonces = etat.messages.filter(function (m) { return !!m.is_annonce; });
          }
          if (paire.cle === 'stats') etat.stats = res.data || null;
          if (paire.cle === 'journal') etat.journal = res.data || [];
          if (paire.cle === 'fils') etat.fils = res.data || [];
          if (paire.cle === 'fil') etat.messagesPrives = res.data || [];
          if (paire.cle === 'signales') etat.signales = res.data || [];
          if (paire.cle === 'signalements') etat.signalements = res.data || [];
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
    /* Le filtre n'est pas une option : il n'y a volontairement aucun bouton
       pour le couper. Ce badge le rappelle. */
    dom.verrou = UI.el('span', {
      class: 'tchat-verrou',
      title: 'Le filtre ne peut pas être désactivé : chaque message, public ou privé, est relu avant publication.',
      role: 'status'
    }, [
      UI.el('span', { class: 'tchat-verrou-ico', text: '🔒' }),
      UI.el('span', { class: 'hide-sm', text: 'Filtre obligatoire' })
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
          text: 'Chaque message, public comme privé, est relu et inversé si besoin. Le filtre est obligatoire pour tout le monde.'
        })
      ]),
      UI.el('div', { class: 'tchat-outils' }, [
        dom.verrou,
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
      title: 'Remplace ton message par son contraire, sans aucune insulte',
      onclick: function () { adoucir(); }
    }, [UI.el('span', { text: '✨' }), UI.el('span', { class: 'hide-sm', text: 'Inverser' })]);

    dom.btnAnnonce = null;
    if (peutAnnoncer()) {
      dom.btnAnnonce = UI.el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm tchat-annonce-bouton',
        title: 'Publier une annonce visible en haut du tchat de classe',
        onclick: function () { basculerAnnonce(); }
      }, [UI.el('span', { text: '📣' }), UI.el('span', { class: 'hide-sm', text: 'Annonce' })]);
    }

    dom.form = UI.el('form', {
      class: 'chat-form',
      onsubmit: function (evenement) {
        evenement.preventDefault();
        envoyer(null);
      }
    }, [dom.btnAnnonce, dom.btnAdoucir, dom.champ, dom.btnEnvoyer]);

    dom.reponse = UI.el('div', { class: 'tchat-reponse', hidden: true });
    dom.annonces = UI.el('div', { class: 'tchat-annonces', hidden: true });
    dom.epingles = UI.el('div', { class: 'tchat-epingles', hidden: true });

    dom.panneauClasse = UI.el('div', { class: 'tchat-panneau', dataset: { panneau: 'classe' } }, [
      dom.annonces,
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

    var force = complimentForce();
    if (force && etat.niveau !== 'ultra') etat.niveau = 'ultra';

    UI.$$('.tchat-seg-btn', dom.niveaux).forEach(function (bouton) {
      bouton.classList.toggle('is-active', bouton.dataset.niveau === etat.niveau);
      bouton.disabled = !!force;
      bouton.title = force
        ? 'Compliment forcé : tout le monde écrit en version Mielleux'
        : NIVEAUX[bouton.dataset.niveau].aide;
    });

    if (dom.btnAnnonce) {
      dom.btnAnnonce.classList.toggle('is-active', etat.annonce);
      dom.btnAnnonce.setAttribute('aria-pressed', etat.annonce ? 'true' : 'false');
      dom.champ.placeholder = etat.annonce
        ? '📣 Annonce à toute la classe… (Entrée pour publier)'
        : 'Écris à la classe… (Entrée pour envoyer)';
      if (dom.form) dom.form.classList.toggle('is-annonce', etat.annonce);
    }

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
      peindreAnnonces();
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

    if (message.is_annonce) {
      meta.push(UI.el('span', { class: 'tchat-badge tchat-badge--annonce', title: 'Annonce de l’encadrement', text: '📣 annonce' }));
    }

    if (message.hidden) {
      meta.push(UI.el('span', { class: 'tchat-badge tchat-badge--masque', title: 'Message masqué : invisible pour les autres', text: 'masqué' }));
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

      if (!mien) {
        actions.appendChild(UI.el('button', {
          type: 'button',
          class: 'tchat-action' + (etat.signalesFaits[message.id] ? ' is-on' : ''),
          title: 'Signaler ce message à l’encadrement',
          'aria-label': 'Signaler ce message',
          onclick: function () { signaler(message); }
        }, [UI.el('span', { text: '🚩' })]));
      }

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

    /* Admin : masquer (bloquer) et modifier, en plus de supprimer. */
    if (!cible && estAdmin()) {
      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'tchat-action' + (message.hidden ? ' is-on' : ''),
        title: message.hidden ? 'Rétablir ce message' : 'Masquer ce message (bloquer)',
        'aria-label': message.hidden ? 'Rétablir le message' : 'Masquer le message',
        onclick: function () { masquerMessage(message); }
      }, [UI.el('span', { text: message.hidden ? '👁' : '🙈' })]));

      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'tchat-action',
        title: 'Modifier le texte de ce message',
        'aria-label': 'Modifier le message',
        onclick: function () { modifierMessage(message); }
      }, [UI.el('span', { text: '✏️' })]));
    }

    if (mien || estStaff() || estAdmin()) {
      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'tchat-suppr',
        title: 'Supprimer ce message',
        'aria-label': 'Supprimer ce message',
        onclick: function () { supprimer(message.id, cible ? 'prive' : 'classe'); }
      }, [UI.icon('trash', { size: 13 })]));
    }

    if (actions.childNodes.length) children.push(actions);

    var classes = 'msg' + (mien ? ' msg--mine' : '') + (message.pending ? ' msg--pending' : '') +
      (message.is_annonce ? ' msg--annonce' : '') + (message.hidden ? ' msg--masque' : '');

    return UI.el('div', { class: classes }, [
      UI.avatar(auteur, { size: 30 }),
      UI.el('div', { class: 'msg-col' }, children)
    ]);
  }

  /* Signalement par un élève : le message remonte dans « Détections » pour
     l'encadrement, sans que l'auteur sache qui a signalé. */
  function signaler(message) {
    if (etat.signalesFaits[message.id]) {
      UI.toast('Tu as déjà signalé ce message.', 'info');
      return;
    }

    rpc('class_report', { p_id: message.id, p_motif: 'signale' })
      .then(function (res) {
        if (res.error) throw res.error;
        etat.signalesFaits[message.id] = true;
        UI.toast('Message signalé à l’encadrement. Merci de veiller sur la classe.', 'success');
        return charger(true);
      })
      .catch(function (erreur) { UI.err(messageErreur(erreur)); });
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

    analyserAvecIA(texte, detecterCible(texte))
      .then(function (resultat) {
        var version = resultat[etat.niveau] || resultat.doux || texte;
        dom.champ.value = version;
        dom.statut.textContent = resultat.flagged
          ? 'Message inversé : il dit maintenant le contraire, sans insulte.'
          : 'Rien à inverser : ton message est déjà gentil.';
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

  function peindreAnnonces() {
    if (!dom.annonces) return;

    var liste = (etat.annonces || []).filter(function (m) { return !m.hidden; });

    if (!liste.length) {
      dom.annonces.hidden = true;
      UI.clear(dom.annonces);
      return;
    }

    dom.annonces.hidden = false;
    UI.clear(dom.annonces);

    dom.annonces.appendChild(UI.el('span', { class: 'tchat-annonces-titre' }, [
      UI.el('span', { text: '📣' }),
      UI.el('span', { text: 'Annonces de l’encadrement' })
    ]));

    liste.slice(-3).forEach(function (message) {
      var heure = new Date(message.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });

      dom.annonces.appendChild(UI.el('div', { class: 'tchat-annonce' }, [
        UI.el('div', { class: 'tchat-annonce-txt' }, [
          UI.el('b', { text: nomDe(message.author_id) + ' · ' }),
          UI.el('span', { text: String(message.body).slice(0, 180) }),
          UI.el('span', { class: 'faint', text: ' · ' + heure })
        ]),
        estStaff() || estAdmin()
          ? UI.el('button', {
              type: 'button',
              class: 'tchat-annonce-x',
              title: 'Retirer cette annonce',
              'aria-label': 'Retirer cette annonce',
              onclick: function () { supprimer(message.id, 'classe'); }
            }, [UI.icon('x', { size: 12 })])
          : null
      ]));
    });
  }

  /* --------------------------------------------------------------------------
   * Annonces : mode de rédaction réservé à l'encadrement
   * ----------------------------------------------------------------------- */
  function basculerAnnonce() {
    if (!peutAnnoncer()) return;
    etat.annonce = !etat.annonce;
    peindre();
    if (etat.annonce && dom.champ) dom.champ.focus();
    if (etat.annonce) {
      UI.toast('Mode annonce : ton message sera publié en haut du tchat.', 'info');
    }
  }

  /* --------------------------------------------------------------------------
   * Admin : masquer / rétablir un message
   * ----------------------------------------------------------------------- */
  function masquerMessage(message) {
    var masquer = !message.hidden;

    rpc('admin_message_hide', { p_id: message.id, p_hidden: masquer })
      .then(function (res) {
        if (res.error) throw res.error;
        UI.toast(
          masquer ? 'Message masqué : les autres ne le voient plus.' : 'Message rétabli pour tout le monde.',
          'success'
        );
        return charger(true);
      })
      .catch(function (erreur) { UI.err(messageErreur(erreur)); });
  }

  /* --------------------------------------------------------------------------
   * Admin : modifier le texte d'un message (le filtre s'applique aussi)
   * ----------------------------------------------------------------------- */
  function modifierMessage(message) {
    var champ = UI.el('textarea', {
      class: 'chat-input',
      rows: '3',
      maxlength: String(MAX_CARACTERES),
      value: message.body
    });
    champ.value = message.body;

    var aide = UI.el('p', { class: 'sub', style: { fontSize: '.82rem' },
      text: 'Le nouveau texte passe lui aussi par le filtre : impossible de publier une insulte.' });

    var piedEnregistrer, piedFiltrer;

    var modal = UI.modal({
      title: 'Modifier le message',
      eye: 'edit',
      body: UI.frag([aide, champ]),
      footer: [
        UI.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler',
          onclick: function () { modal.close(); } }),
        piedFiltrer = UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: '✨ Inverser',
          onclick: function () {
            var texte = String(champ.value || '').trim();
            if (!texte) { champ.focus(); return; }
            analyserAvecIA(texte).then(function (resultat) {
              champ.value = resultat.doux || texte;
              UI.toast('Texte inversé : il dit maintenant le contraire, sans insulte.', 'info');
            });
          }
        }),
        piedEnregistrer = UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Enregistrer',
          onclick: function () {
            var texte = String(champ.value || '').trim();
            if (!texte) { champ.focus(); return; }

            piedEnregistrer.disabled = true;
            piedFiltrer.disabled = true;

            /* On repasse le texte par le filtre avant l'enregistrement. */
            analyserAvecIA(texte)
              .then(function (resultat) {
                var version = resultat.flagged ? (resultat.doux || texte) : texte;
                return rpc('admin_message_edit', { p_id: message.id, p_body: version });
              })
              .then(function (res) {
                if (res.error) throw res.error;
                modal.close();
                UI.toast('Message modifié.', 'success');
                return charger(true);
              })
              .catch(function (erreur) {
                piedEnregistrer.disabled = false;
                piedFiltrer.disabled = false;
                UI.err(messageErreur(erreur));
              });
          }
        })
      ]
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

      /* Accès direct au rapport complet, pour l'encadrement. */
      if (estStaff() || estAdmin()) {
        hote.appendChild(UI.el('div', { class: 'climat-lien' }, [
          UI.el('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: function () {
              if (window.ECEM && window.ECEM.App && window.ECEM.App.showTab) {
                window.ECEM.App.showTab('climat');
              } else {
                window.location.hash = 'climat';
              }
            }
          }, [
            UI.icon('chart', { size: 15 }),
            document.createTextNode(' Voir le rapport de climat complet')
          ])
        ]));
      }

      if ((estStaff() || estAdmin()) && Number(climat.nb_paires) > 0) {
        hote.appendChild(UI.el('div', { class: 'tchat-alerte' }, [
          UI.el('b', { text: '⚠️ Harcèlement répété en privé' }),
          UI.el('span', {
            text: ' : ' + climat.paires.map(function (paire) {
              return paire.a + ' → ' + paire.b + ' (' + paire.n + ' fois)';
            }).join(' · ')
          })
        ]));
      }
    }

    /* Acharnement ciblé : la même personne visée plusieurs fois dans la classe. */
    var alertes = (climat && climat.alertes) || [];
    if ((estStaff() || estAdmin()) && alertes.length) {
      hote.appendChild(UI.el('div', { class: 'tchat-alerte tchat-alerte--grave' }, [
        UI.el('b', { text: '🚨 Acharnement possible' }),
        UI.el('span', {
          text: ' : ' + alertes.map(function (a) {
            return a.cible + ' visée ' + a.messages + ' fois par ' + a.auteurs +
              (a.auteurs > 1 ? ' personnes' : ' personne');
          }).join(' · ')
        })
      ]));
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

    /* Messages signalés par les élèves : visible par l'encadrement. */
    if (estStaff() || estAdmin()) {
      hote.appendChild(
        UI.el('div', { class: 'tchat-signales' }, [
          UI.el('h4', { text: 'Messages signalés par la classe' }),
          etat.signalements.length
            ? UI.el('ul', { class: 'tchat-signales-liste' }, etat.signalements.map(function (entree) {
                return UI.el('li', {}, [
                  UI.el('span', { class: 'tchat-signales-qui', text: (entree.auteur || 'Compte') + ' · ' + (entree.nb || 1) + ' signalement(s)' }),
                  UI.el('span', { class: 'tchat-signales-extrait', text: '« ' + (entree.extrait || '') + ' »' }),
                  UI.el('button', {
                    type: 'button',
                    class: 'icon-btn tchat-signales-suppr',
                    title: 'Supprimer ce message',
                    'aria-label': 'Supprimer ce message',
                    onclick: function () { supprimer(entree.message_id, 'classe'); }
                  }, [UI.icon('trash', { size: 13 })])
                ]);
              }))
            : UI.el('p', { class: 'faint', text: 'Aucun message signalé. Tout va bien.' })
        ])
      );
    }

    /* Messages privés signalés : visible par les modérateurs uniquement. */
    if (estStaff() || estAdmin()) {
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

    var annonce = !cible && etat.annonce && peutAnnoncer();
    var vise = detecterCible(texte);

    etat.envoi = true;
    reglerBoutons(true);
    dom.statut.textContent = 'Le filtre de gentillesse relit ton message…';

    /* Le filtre ne se désactive pas : tout message passe par l'analyse. */
    analyserAvecIA(texte, vise)
      .then(function (resultat) {
        var version = resultat[etat.niveau] || resultat.doux || texte;
        return envoyerAuServeur(version, texte, resultat, cible, annonce, vise);
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

  function envoyerAuServeur(version, original, analyse, cible, annonce, vise) {
    var adouci = !!(analyse && analyse.flagged);
    var categories = adouci ? (analyse.categories || []) : [];

    var enveloppe = {
      p_body: version,
      p_body_raw: adouci ? original : null,
      p_level: etat.niveau,
      p_flagged: adouci,
      p_categories: categories,
      p_severity: adouci ? (analyse.severity || 0) : 0,
      p_source: analyse && analyse.source ? analyse.source : null,
      p_motif: categories.length ? categories[0] : null,
      p_cible: adouci ? (analyse.cible || vise || null) : null
    };

    if (cible) {
      enveloppe.p_to = cible;
    } else if (etat.reponse) {
      enveloppe.p_reply_to = etat.reponse.id;
    }

    var appel = cible
      ? rpc('private_send', enveloppe)
      : (annonce ? rpc('class_annonce_send', enveloppe) : rpc('class_chat_send', enveloppe));

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

      if (annonce) {
        UI.toast('Annonce publiée en haut du tchat de classe.', 'success');
        etat.annonce = false;
      } else if (adouci) {
        var quoi = analyse.categories && analyse.categories.length
          ? ' (' + (CATEGORIES[analyse.categories[0]] || analyse.categories[0]) + ')'
          : '';
        UI.toast(
          'Message repéré' + quoi + ' : il dit maintenant le contraire, sans violence.',
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
