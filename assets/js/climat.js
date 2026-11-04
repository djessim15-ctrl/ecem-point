/* ============================================================================
 * ECEM Point — rapport de climat de la classe
 * ----------------------------------------------------------------------------
 * Un écran à part entière (onglet « Climat », réservé à l'encadrement) qui
 * reprend `climat_report()` : score sur 100, familles de violence, personnes
 * visées, paires en conflit. Il est aussi réutilisé par l'onglet Climat de
 * l'administration, pour n'avoir qu'un seul rendu à maintenir.
 *
 * Deux sorties : un fichier CSV (compatible Excel) et une impression navigateur
 * (« Enregistrer au format PDF »). Aucune donnée n'est envoyée ailleurs.
 * ==========================================================================*/
(function () {
  'use strict';

  var ECEM = (window.ECEM = window.ECEM || {});
  var UI = window.ECEM.UI;

  var FAMILLES_LABEL = {
    harcelement_sexuel: 'Harcèlement sexuel',
    menace: 'Menace',
    discrimination: 'Discrimination',
    usurpation: 'Usurpation',
    exclusion: 'Exclusion',
    rumeur: 'Rumeur',
    acharnement: 'Acharnement',
    indirecte: 'Violence indirecte',
    insulte: 'Insulte'
  };

  var etat = { donnees: null, chargement: false, erreur: '', charge: false, at: 0 };
  var dom = { hote: null };

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
    if (UI && UI.humanError) return UI.humanError(err);
    return String((err && err.message) || err || 'Erreur inconnue');
  }

  function familleLabel(cle) {
    if (!cle) return 'autre';
    return FAMILLES_LABEL[cle] || String(cle).replace(/_/g, ' ');
  }

  function chiffre(label, valeur) {
    return UI.el('div', { class: 'admin-chiffre' }, [
      UI.el('b', { text: String(valeur == null ? '—' : valeur) }),
      UI.el('span', { class: 'faint', text: label })
    ]);
  }

  function dateTexte(iso) {
    var date = iso ? new Date(iso) : new Date();
    if (isNaN(date)) date = new Date();
    return date.toLocaleString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement                                                             */
  /* ---------------------------------------------------------------------- */
  function charger() {
    etat.chargement = true;
    etat.erreur = '';
    peindre();

    return rpc('climat_report').then(function (res) {
      etat.chargement = false;
      if (res && res.error) {
        etat.erreur = messageErreur(res.error);
      } else {
        etat.donnees = res.data || {};
        etat.charge = true;
        etat.at = Date.now();
      }
      peindre();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Rendu                                                                  */
  /* ---------------------------------------------------------------------- */
  function peindre() {
    if (!dom.hote) return;
    UI.clear(dom.hote);

    var data = etat.donnees || {};
    var score = data.score == null ? 0 : data.score;

    /* Barre d'outils ------------------------------------------------------ */
    dom.hote.appendChild(UI.el('div', { class: 'climat-barre-outils' }, [
      UI.el('p', { class: 'sub', style: { margin: '0' }, text:
        'Ce que la classe vit en ce moment : score, familles de violence, personnes visées et paires en conflit.' }),
      UI.el('div', { class: 'admin-actions' }, [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', text: 'Rafraîchir',
          onclick: charger
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          onclick: exporterCsv
        }, [UI.icon('download', { size: 15 }), document.createTextNode(' CSV')]),
        UI.el('button', {
          type: 'button', class: 'btn btn-primary btn-sm',
          onclick: imprimer
        }, [UI.icon('upload', { size: 15 }), document.createTextNode(' Imprimer / PDF')])
      ])
    ]));

    if (etat.erreur) {
      dom.hote.appendChild(UI.el('div', { class: 'alert alert--error', text: etat.erreur }));
    }

    if (etat.chargement && !etat.charge) {
      dom.hote.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'spinner' }),
        UI.el('div', { class: 'empty-text', text: 'Calcul du climat…' })
      ]));
      return;
    }

    /* En-tête : score + chiffres ----------------------------------------- */
    dom.hote.appendChild(UI.el('div', { class: 'climat-entete' }, [
      UI.el('div', { class: 'climat-score' }, [
        window.ECEM.Charts
          ? window.ECEM.Charts.ring(score, 100, { caption: '/ 100', size: 132 })
          : UI.el('b', { text: String(score) })
      ]),
      UI.el('div', { class: 'climat-chiffres' }, [
        chiffre('Messages (7 j)', data.messages_7j),
        chiffre('Drapeaux (7 j)', data.drapeaux_7j),
        chiffre('Signalements (30 j)', data.signalements_30j),
        chiffre('Comptes', data.comptes),
        chiffre('Suspendus', data.suspendus)
      ])
    ]));

    /* Familles ----------------------------------------------------------- */
    var familles = data.familles || [];
    var secFamilles = UI.el('div', { class: 'panel' });
    secFamilles.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('filter', { size: 16 })]),
          document.createTextNode(' Familles de violence (30 jours)')
        ]),
        UI.el('div', { class: 'panel-sub', text: familles.length
          ? 'Du plus fréquent au moins fréquent'
          : 'Aucun message filtré sur la période' })
      ])
    ]));

    var corpsFamilles = UI.el('div', { class: 'panel-body' });
    if (!familles.length) {
      corpsFamilles.appendChild(UI.el('div', { class: 'empty-text', text: 'Aucune famille détectée. 👍' }));
    } else {
      var maxi = familles.reduce(function (max, ligne) { return Math.max(max, ligne.nombre || 0); }, 1);
      familles.forEach(function (ligne) {
        corpsFamilles.appendChild(UI.el('div', { class: 'climat-barre' }, [
          UI.el('span', { class: 'climat-barre-nom', text: familleLabel(ligne.famille) }),
          UI.el('span', { class: 'climat-barre-piste' }, [
            UI.el('span', { style: { width: Math.round(((ligne.nombre || 0) / maxi) * 100) + '%' } })
          ]),
          UI.el('b', { text: String(ligne.nombre || 0) })
        ]));
      });
    }
    secFamilles.appendChild(corpsFamilles);
    dom.hote.appendChild(secFamilles);

    /* Cibles ------------------------------------------------------------- */
    var cibles = data.cibles || [];
    var secCibles = UI.el('div', { class: 'panel' });
    secCibles.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('target', { size: 16 })]),
          document.createTextNode(' Personnes visées')
        ]),
        UI.el('div', { class: 'panel-sub', text: 'Au moins deux messages filtrés contre la même personne' })
      ])
    ]));
    var corpsCibles = UI.el('div', { class: 'panel-body panel-body--flush' });
    if (!cibles.length) {
      corpsCibles.appendChild(UI.el('div', { class: 'empty-text', style: { padding: '14px' },
        text: 'Personne n’est visé de façon répétée.' }));
    } else {
      cibles.forEach(function (ligne) {
        corpsCibles.appendChild(UI.el('div', { class: 'admin-ligne' }, [
          UI.el('div', { class: 'admin-ligne-tete' }, [
            UI.el('b', { text: ligne.cible || '—' }),
            UI.el('span', { class: 'pill pill--danger', text: (ligne.messages || 0) + ' message' + ((ligne.messages || 0) > 1 ? 's' : '') }),
            UI.el('span', { class: 'pill pill--muted', text: (ligne.auteurs || 0) + ' auteur' + ((ligne.auteurs || 0) > 1 ? 's' : '') })
          ])
        ]));
      });
    }
    secCibles.appendChild(corpsCibles);
    dom.hote.appendChild(secCibles);

    /* Paires ------------------------------------------------------------- */
    var paires = data.paires || [];
    var secPaires = UI.el('div', { class: 'panel' });
    secPaires.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('users', { size: 16 })]),
          document.createTextNode(' Paires en conflit')
        ]),
        UI.el('div', { class: 'panel-sub', text: 'Trois messages privés filtrés ou plus entre les deux mêmes élèves' })
      ])
    ]));
    var corpsPaires = UI.el('div', { class: 'panel-body panel-body--flush' });
    if (!paires.length) {
      corpsPaires.appendChild(UI.el('div', { class: 'empty-text', style: { padding: '14px' },
        text: 'Aucune paire récurrente.' }));
    } else {
      paires.forEach(function (ligne) {
        corpsPaires.appendChild(UI.el('div', { class: 'admin-ligne' }, [
          UI.el('div', { class: 'admin-ligne-tete' }, [
            UI.el('b', { text: (ligne.a || '?') + ' ↔ ' + (ligne.b || '?') }),
            UI.el('span', { class: 'pill pill--danger', text: (ligne.n || 0) + ' messages' })
          ])
        ]));
      });
    }
    secPaires.appendChild(corpsPaires);
    dom.hote.appendChild(secPaires);

    dom.hote.appendChild(UI.el('p', { class: 'faint', text:
      'Rapport généré le ' + dateTexte(data.genere_le) + '. Visible par l’encadrement uniquement.' }));
  }

  /* ---------------------------------------------------------------------- */
  /* Export CSV                                                             */
  /* ---------------------------------------------------------------------- */
  function lignesCsv() {
    var data = etat.donnees || {};
    var lignes = [
      ['Rapport de climat — ECEM Point'],
      ['Généré le', dateTexte(data.genere_le)],
      [],
      ['Score', data.score == null ? '' : data.score],
      ['Messages (7 jours)', data.messages_7j || 0],
      ['Messages filtrés (7 jours)', data.drapeaux_7j || 0],
      ['Signalements (30 jours)', data.signalements_30j || 0],
      ['Comptes', data.comptes || 0],
      ['Comptes suspendus', data.suspendus || 0],
      [],
      ['Famille', 'Messages']
    ];

    var familles = data.familles || [];
    if (!familles.length) lignes.push(['Aucune', 0]);
    familles.forEach(function (ligne) { lignes.push([familleLabel(ligne.famille), ligne.nombre || 0]); });

    lignes.push([]);
    lignes.push(['Personne visée', 'Messages', 'Auteurs']);
    var cibles = data.cibles || [];
    if (!cibles.length) lignes.push(['Aucune', 0, 0]);
    cibles.forEach(function (ligne) { lignes.push([ligne.cible || '', ligne.messages || 0, ligne.auteurs || 0]); });

    lignes.push([]);
    lignes.push(['Élève A', 'Élève B', 'Messages privés filtrés']);
    var paires = data.paires || [];
    if (!paires.length) lignes.push(['Aucune', '', 0]);
    paires.forEach(function (ligne) { lignes.push([ligne.a || '', ligne.b || '', ligne.n || 0]); });

    return lignes;
  }

  function exporterCsv() {
    if (!etat.donnees) {
      if (UI.err) UI.err('Le rapport n’est pas encore chargé.');
      return;
    }
    if (!UI.download || !UI.csv) return;
    var nom = 'ecem-climat-' + new Date().toISOString().slice(0, 10) + '.csv';
    UI.download(nom, '\uFEFF' + UI.csv(lignesCsv()), 'text/csv;charset=utf-8');
    if (UI.toast) UI.toast('Rapport exporté.', 'ok');
  }

  /* ---------------------------------------------------------------------- */
  /* Impression / PDF                                                       */
  /* ---------------------------------------------------------------------- */
  function imprimer() {
    var data = etat.donnees;
    if (!data) {
      if (UI.err) UI.err('Le rapport n’est pas encore chargé.');
      return;
    }

    function esc(texte) {
      return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    var html = '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
      '<title>Rapport de climat — ECEM Point</title><style>' +
      'body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1730;margin:32px}' +
      'h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.05rem;margin:24px 0 8px}' +
      '.sub{color:#5b5470;margin:0 0 18px}' +
      'table{border-collapse:collapse;width:100%;margin-bottom:8px}' +
      'th,td{border-bottom:1px solid #e6e1f5;padding:6px 8px;text-align:left}' +
      'th{background:#f3f0ff}.score{font-size:2.2rem;font-weight:800}' +
      '</style></head><body>';

    html += '<h1>Rapport de climat — ECEM Point</h1>';
    html += '<p class="sub">Généré le ' + esc(dateTexte(data.genere_le)) + '</p>';
    html += '<div class="score">' + esc(data.score == null ? '—' : data.score) + ' / 100</div>';

    html += '<h2>Chiffres</h2><table><tbody>' +
      '<tr><th>Messages (7 jours)</th><td>' + esc(data.messages_7j || 0) + '</td></tr>' +
      '<tr><th>Messages filtrés (7 jours)</th><td>' + esc(data.drapeaux_7j || 0) + '</td></tr>' +
      '<tr><th>Signalements (30 jours)</th><td>' + esc(data.signalements_30j || 0) + '</td></tr>' +
      '<tr><th>Comptes</th><td>' + esc(data.comptes || 0) + '</td></tr>' +
      '<tr><th>Comptes suspendus</th><td>' + esc(data.suspendus || 0) + '</td></tr>' +
      '</tbody></table>';

    html += '<h2>Familles de violence (30 jours)</h2><table><thead><tr><th>Famille</th><th>Messages</th></tr></thead><tbody>';
    if (!(data.familles || []).length) html += '<tr><td colspan="2">Aucune.</td></tr>';
    (data.familles || []).forEach(function (ligne) {
      html += '<tr><td>' + esc(familleLabel(ligne.famille)) + '</td><td>' + esc(ligne.nombre) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<h2>Personnes visées</h2><table><thead><tr><th>Personne</th><th>Messages</th><th>Auteurs</th></tr></thead><tbody>';
    if (!(data.cibles || []).length) html += '<tr><td colspan="3">Aucune.</td></tr>';
    (data.cibles || []).forEach(function (ligne) {
      html += '<tr><td>' + esc(ligne.cible) + '</td><td>' + esc(ligne.messages) + '</td><td>' + esc(ligne.auteurs) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<h2>Paires en conflit</h2><table><thead><tr><th>Élève A</th><th>Élève B</th><th>Messages</th></tr></thead><tbody>';
    if (!(data.paires || []).length) html += '<tr><td colspan="3">Aucune.</td></tr>';
    (data.paires || []).forEach(function (ligne) {
      html += '<tr><td>' + esc(ligne.a) + '</td><td>' + esc(ligne.b) + '</td><td>' + esc(ligne.n) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<p class="sub" style="margin-top:24px">Document interne à l’encadrement de la classe.</p>';
    html += '</body></html>';

    var fenetre = window.open('', '_blank');
    if (!fenetre) {
      if (UI.err) UI.err('Autorise les fenêtres surgissantes pour imprimer le rapport.');
      return;
    }
    fenetre.document.open();
    fenetre.document.write(html);
    fenetre.document.close();
    window.setTimeout(function () {
      try { fenetre.focus(); fenetre.print(); } catch (e) {}
    }, 350);
  }

  /* ---------------------------------------------------------------------- */
  /* Point d'entrée                                                         */
  /* ---------------------------------------------------------------------- */
  function mount(hote) {
    if (!hote) return;
    dom.hote = hote;
    /* Rapport de moins de 30 s : on réaffiche sans refaire l'appel, pour ne pas
       relancer une requête à chaque rafraîchissement de la page. */
    if (etat.charge && Date.now() - etat.at < 30000) {
      peindre();
      return;
    }
    charger();
  }

  ECEM.Climat = {
    mount: mount,
    refresh: charger,
    exportCsv: exporterCsv,
    imprimer: imprimer,
    donnees: function () { return etat.donnees; }
  };
})();
