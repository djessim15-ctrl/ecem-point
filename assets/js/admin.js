/* ============================================================================
 * ECEM Point — panneau d'administration
 * ----------------------------------------------------------------------------
 * Réservé aux comptes présents dans public.admins (vérifié côté serveur par
 * chaque fonction admin_*). L'interface ne fait que déclencher les RPC :
 *   admin_list · admin_stats · admin_ban · admin_unban · admin_delete
 *   admin_set_role · admin_set_admin · admin_reset_password · admin_add_code
 *
 * Tout est en HTML/CSS/JS natif, sans build.
 * ==========================================================================*/
(function () {
  'use strict';

  var ECEM = (window.ECEM = window.ECEM || {});
  var UI = window.ECEM.UI;

  var etat = {
    comptes: [],
    stats: null,
    filtre: '',
    onglet: 'comptes',   /* comptes | codes */
    chargement: false,
    erreur: ''
  };

  var dom = {};

  /* ---------------------------------------------------------------------- */
  /* Utilitaires                                                            */
  /* ---------------------------------------------------------------------- */
  function sb() {
    return ECEM.sb;
  }

  function moi() {
    return (ECEM.Store && ECEM.Store.state && ECEM.Store.state.me) || null;
  }

  function rpc(nom, args) {
    var client = sb();
    if (!client || typeof client.rpc !== 'function') {
      return Promise.resolve({ data: null, error: { message: 'NON_CONNECTE' } });
    }
    return client.rpc(nom, args || {});
  }

  function messageErreur(err) {
    if (UI && UI.humanError) return UI.humanError(err);
    return String((err && err.message) || err || 'Erreur inconnue');
  }

  function dateCourte(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var jours = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (jours <= 0) return "aujourd'hui";
    if (jours === 1) return 'hier';
    if (jours < 30) return 'il y a ' + jours + ' j';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  function roleLabel(role) {
    if (UI && UI.roleLabel) return UI.roleLabel(role);
    return role;
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement                                                             */
  /* ---------------------------------------------------------------------- */
  function charger() {
    etat.chargement = true;
    etat.erreur = '';
    peindre();

    return Promise.all([
      rpc('admin_list'),
      rpc('admin_stats')
    ]).then(function (resultats) {
      if (resultats[0].error) throw resultats[0].error;
      if (resultats[1].error) throw resultats[1].error;

      etat.comptes = resultats[0].data || [];
      etat.stats = resultats[1].data || null;
      etat.chargement = false;
      peindre();
    }).catch(function (err) {
      etat.chargement = false;
      etat.erreur = messageErreur(err);
      peindre();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                */
  /* ---------------------------------------------------------------------- */
  function apresAction(message) {
    if (UI && UI.toast) UI.toast(message, 'ok');
    if (ECEM.Store && ECEM.Store.refreshAll) ECEM.Store.refreshAll().catch(function () {});
    charger();
  }

  function bannir(compte) {
    var motif = UI.el('input', {
      class: 'input',
      type: 'text',
      maxlength: '120',
      placeholder: 'Motif (facultatif) : insultes, spam…'
    });

    var modale = UI.modal({
      title: 'Suspendre ' + compte.prenom,
      sub: 'Le compte ne pourra plus envoyer de messages, de points ni réagir. Il peut être réactivé à tout moment.',
      eye: 'alert',
      body: UI.el('div', { class: 'field' }, [
        UI.el('label', { text: 'Motif' }),
        motif
      ]),
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Annuler',
          onclick: function () { modale.close(); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-danger', text: 'Suspendre',
          onclick: function () {
            modale.close();
            rpc('admin_ban', { p_user: compte.id, p_reason: motif.value || null }).then(function (res) {
              if (res.error) { UI.err(messageErreur(res.error)); return; }
              apresAction(compte.prenom + ' est suspendu.');
            });
          }
        })
      ]
    });
  }

  function reactiver(compte) {
    rpc('admin_unban', { p_user: compte.id }).then(function (res) {
      if (res.error) { UI.err(messageErreur(res.error)); return; }
      apresAction(compte.prenom + ' peut de nouveau participer.');
    });
  }

  function supprimer(compte) {
    var saisie = UI.el('input', {
      class: 'input',
      type: 'text',
      autocomplete: 'off',
      placeholder: compte.prenom
    });

    var confirmer = UI.el('button', {
      type: 'button', class: 'btn btn-danger', text: 'Supprimer définitivement',
      disabled: true,
      onclick: function () {
        /* Double garde : même si le bouton était activé par erreur, on vérifie
         * que le prénom recopié correspond bien. */
        if (saisie.value.trim().toLowerCase() !== String(compte.prenom).toLowerCase()) return;
        modale.close();
        rpc('admin_delete', { p_user: compte.id }).then(function (res) {
          if (res.error) { UI.err(messageErreur(res.error)); return; }
          apresAction(compte.prenom + ' a été supprimé.');
        });
      }
    });

    saisie.addEventListener('input', function () {
      confirmer.disabled = saisie.value.trim().toLowerCase() !== String(compte.prenom).toLowerCase();
    });

    var modale = UI.modal({
      title: 'Supprimer ' + compte.prenom,
      sub: 'Compte, points et messages associés seront effacés. Cette action est irréversible.',
      eye: 'alert',
      body: UI.el('div', { class: 'field' }, [
        UI.el('label', { text: 'Recopie le prénom « ' + compte.prenom + ' » pour confirmer' }),
        saisie
      ]),
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Annuler',
          onclick: function () { modale.close(); }
        }),
        confirmer
      ]
    });
  }

  function changerRole(compte) {
    var choix = UI.el('select', { class: 'input' }, [
      UI.el('option', { value: 'eleve', text: 'Élève' }),
      UI.el('option', { value: 'suppleant', text: 'Suppléant' }),
      UI.el('option', { value: 'delegue', text: 'Délégué' })
    ]);
    choix.value = compte.role;

    var modale = UI.modal({
      title: 'Rôle de ' + compte.prenom,
      sub: 'Le rôle change immédiatement ses droits dans toute l’application.',
      eye: 'user',
      body: UI.el('div', { class: 'field' }, [
        UI.el('label', { text: 'Nouveau rôle' }),
        choix
      ]),
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Annuler',
          onclick: function () { modale.close(); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Enregistrer',
          onclick: function () {
            modale.close();
            rpc('admin_set_role', { p_user: compte.id, p_role: choix.value }).then(function (res) {
              if (res.error) { UI.err(messageErreur(res.error)); return; }
              apresAction(compte.prenom + ' est maintenant ' + roleLabel(choix.value).toLowerCase() + '.');
            });
          }
        })
      ]
    });
  }

  function motDePasse(compte) {
    var champ = UI.el('input', {
      class: 'input', type: 'text', autocomplete: 'off', placeholder: '6 caractères minimum'
    });

    var modale = UI.modal({
      title: 'Nouveau mot de passe pour ' + compte.prenom,
      sub: 'Communique-le à l’intéressé : il remplace immédiatement l’ancien.',
      eye: 'lock',
      body: UI.el('div', { class: 'field' }, [
        UI.el('label', { text: 'Mot de passe' }),
        champ
      ]),
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Annuler',
          onclick: function () { modale.close(); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Réinitialiser',
          onclick: function () {
            if (champ.value.length < 6) {
              UI.err('Le mot de passe doit faire au moins 6 caractères.');
              return;
            }
            modale.close();
            rpc('admin_reset_password', { p_user: compte.id, p_password: champ.value }).then(function (res) {
              if (res.error) { UI.err(messageErreur(res.error)); return; }
              apresAction('Mot de passe de ' + compte.prenom + ' réinitialisé.');
            });
          }
        })
      ]
    });
  }

  function basculerAdmin(compte) {
    rpc('admin_set_admin', { p_user: compte.id, p_admin: !compte.admin }).then(function (res) {
      if (res.error) { UI.err(messageErreur(res.error)); return; }
      apresAction(compte.admin
        ? compte.prenom + ' n’est plus administrateur.'
        : compte.prenom + ' peut maintenant administrer le site.');
    });
  }

  function ajouterCode() {
    var role = UI.el('select', { class: 'input' }, [
      UI.el('option', { value: 'delegue', text: 'Délégué' }),
      UI.el('option', { value: 'suppleant', text: 'Suppléant' })
    ]);
    var code = UI.el('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: 'ex. DEL-2027-XYZ' });
    var label = UI.el('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: 'À qui le code est destiné' });

    var modale = UI.modal({
      title: 'Ajouter un code d’inscription',
      sub: 'Le code est stocké chiffré : il ne peut plus être relu ensuite.',
      eye: 'lock',
      body: UI.el('div', { class: 'stack', style: { gap: '12px' } }, [
        UI.el('div', { class: 'field' }, [UI.el('label', { text: 'Rôle' }), role]),
        UI.el('div', { class: 'field' }, [UI.el('label', { text: 'Code' }), code]),
        UI.el('div', { class: 'field' }, [UI.el('label', { text: 'Étiquette (facultatif)' }), label])
      ]),
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost', text: 'Annuler',
          onclick: function () { modale.close(); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Ajouter',
          onclick: function () {
            modale.close();
            rpc('admin_add_code', { p_role: role.value, p_code: code.value, p_label: label.value || null })
              .then(function (res) {
                if (res.error) { UI.err(messageErreur(res.error)); return; }
                apresAction('Code ' + roleLabel(role.value).toLowerCase() + ' ajouté.');
              });
          }
        })
      ]
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Rendu                                                                  */
  /* ---------------------------------------------------------------------- */
  function ligne(compte) {
    var suspendu = !!compte.banned_at;
    var estMoi = moi() && moi().id === compte.id;

    var actions = UI.el('div', { class: 'admin-actions' });

    if (!estMoi) {
      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'icon-btn',
        title: 'Changer le rôle',
        'aria-label': 'Changer le rôle',
        onclick: function () { changerRole(compte); }
      }, [UI.icon('user', { size: 15 })]));

      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'icon-btn',
        title: 'Réinitialiser le mot de passe',
        'aria-label': 'Réinitialiser le mot de passe',
        onclick: function () { motDePasse(compte); }
      }, [UI.icon('lock', { size: 15 })]));

      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'icon-btn' + (compte.admin ? ' is-on' : ''),
        title: compte.admin ? 'Retirer les droits admin' : 'Nommer administrateur',
        'aria-label': 'Administrateur',
        onclick: function () { basculerAdmin(compte); }
      }, [UI.icon('shield', { size: 15 })]));

      if (suspendu) {
        actions.appendChild(UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', text: 'Réactiver',
          onclick: function () { reactiver(compte); }
        }));
      } else {
        actions.appendChild(UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', text: 'Suspendre',
          onclick: function () { bannir(compte); }
        }));
      }

      actions.appendChild(UI.el('button', {
        type: 'button',
        class: 'icon-btn icon-btn--danger',
        title: 'Supprimer définitivement',
        'aria-label': 'Supprimer',
        onclick: function () { supprimer(compte); }
      }, [UI.icon('trash', { size: 15 })]));
    } else {
      actions.appendChild(UI.el('span', { class: 'faint', text: 'toi' }));
    }

    return UI.el('div', { class: 'admin-row' + (suspendu ? ' is-banned' : '') }, [
      UI.avatar(compte.prenom, { size: 34 }),
      UI.el('div', { class: 'admin-identite' }, [
        UI.el('div', { class: 'admin-nom' }, [
          UI.el('span', { text: compte.prenom }),
          compte.admin ? UI.el('span', { class: 'pill pill--gold', text: 'admin' }) : null,
          suspendu ? UI.el('span', { class: 'pill pill--danger', text: 'suspendu' }) : null
        ]),
        UI.el('div', { class: 'faint admin-sous', text:
          roleLabel(compte.role) + ' · ' + compte.points + ' pts · vu ' + dateCourte(compte.last_seen_at) })
      ]),
      actions
    ]);
  }

  function peindreComptes(hote) {
    var champ = UI.el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Chercher un prénom…',
      value: etat.filtre
    });
    champ.addEventListener('input', function () {
      etat.filtre = champ.value;
      peindreListe();
    });

    dom.liste = UI.el('div', { class: 'admin-liste' });

    hote.appendChild(UI.el('div', { class: 'admin-barre' }, [
      champ,
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: 'Rafraîchir',
        onclick: charger
      })
    ]));
    hote.appendChild(dom.liste);

    peindreListe();
  }

  function peindreListe() {
    if (!dom.liste) return;
    UI.clear(dom.liste);

    var filtre = (etat.filtre || '').trim().toLowerCase();
    var comptes = etat.comptes.filter(function (c) {
      return !filtre || String(c.prenom).toLowerCase().indexOf(filtre) !== -1;
    });

    if (!comptes.length) {
      dom.liste.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'empty-ico' }, [UI.icon('user', { size: 24 })]),
        UI.el('div', { class: 'empty-title', text: 'Aucun compte' }),
        UI.el('div', { class: 'empty-text', text: filtre
          ? 'Aucun prénom ne correspond à « ' + etat.filtre + ' ».'
          : 'Les inscriptions apparaîtront ici.' })
      ]));
      return;
    }

    comptes.forEach(function (compte) { dom.liste.appendChild(ligne(compte)); });
  }

  function peindreCodes(hote) {
    var s = etat.stats || {};

    hote.appendChild(UI.el('div', { class: 'admin-codes' }, [
      UI.el('p', { class: 'sub', text:
        (s.codes || 0) + ' code' + ((s.codes || 0) > 1 ? 's' : '') + ' d’inscription enregistré' +
        ((s.codes || 0) > 1 ? 's' : '') + '. Les codes ne sont jamais stockés en clair : impossible de les relire, ' +
        'mais ils restent valables tant qu’ils n’ont pas été supprimés.' }),
      UI.el('button', {
        type: 'button', class: 'btn btn-primary btn-sm', text: 'Ajouter un code',
        onclick: ajouterCode
      })
    ]));
  }

  function peindre() {
    if (!dom.hote) return;
    UI.clear(dom.hote);

    var s = etat.stats || {};

    dom.hote.appendChild(UI.el('div', { class: 'admin-tete' }, [
      UI.el('h2', { class: 'admin-titre', text: 'Administration' }),
      UI.el('p', { class: 'sub', text: 'Suspendre, réactiver, changer de rôle ou supprimer un compte.' })
    ]));

    dom.hote.appendChild(UI.el('div', { class: 'admin-stats' }, [
      chiffre('Comptes', s.comptes),
      chiffre('Suspendus', s.bannis),
      chiffre('Admins', s.admins),
      chiffre('Points (7 j)', s.mouvements_7j),
      chiffre('Messages (7 j)', s.messages_7j)
    ]));

    if (etat.erreur) {
      dom.hote.appendChild(UI.el('div', { class: 'alert alert--error', text: etat.erreur }));
    }

    var onglets = UI.el('div', { class: 'seg admin-seg' }, [
      boutonOnglet('comptes', 'Comptes'),
      boutonOnglet('codes', 'Codes d’inscription')
    ]);
    dom.hote.appendChild(onglets);

    if (etat.chargement) {
      dom.hote.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'spinner' }),
        UI.el('div', { class: 'empty-text', text: 'Chargement…' })
      ]));
      return;
    }

    if (etat.onglet === 'codes') peindreCodes(dom.hote);
    else peindreComptes(dom.hote);
  }

  function chiffre(label, valeur) {
    return UI.el('div', { class: 'admin-chiffre' }, [
      UI.el('b', { text: String(valeur == null ? '—' : valeur) }),
      UI.el('span', { class: 'faint', text: label })
    ]);
  }

  function boutonOnglet(cle, libelle) {
    return UI.el('button', {
      type: 'button',
      class: 'seg-btn' + (etat.onglet === cle ? ' is-active' : ''),
      text: libelle,
      onclick: function () {
        etat.onglet = cle;
        peindre();
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Point d'entrée                                                         */
  /* ---------------------------------------------------------------------- */
  function mount(hote) {
    if (!hote) return;
    dom.hote = hote;

    if (!ECEM.Store || !ECEM.Store.isAdmin || !ECEM.Store.isAdmin()) {
      UI.clear(hote);
      hote.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'empty-ico' }, [UI.icon('lock', { size: 26 })]),
        UI.el('div', { class: 'empty-title', text: 'Accès réservé' }),
        UI.el('div', { class: 'empty-text', text: 'Cet espace est réservé aux administrateurs du site.' })
      ]));
      return;
    }

    charger();
  }

  ECEM.Admin = {
    mount: mount,
    refresh: charger
  };
})();
