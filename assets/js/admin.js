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
    onglet: 'comptes',   /* comptes | codes | moderation | connexions | climat */
    chargement: false,
    erreur: '',
    extras: {}           /* données des onglets lourds, chargées à la demande */
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

  /* ---------------------------------------------------------------------- */
  /* Modération centralisée                                                 */
  /* ---------------------------------------------------------------------- *
   * Un seul onglet pour tout ce qui est signalé : les messages du tchat de
   * classe passés au filtre, les 🚩 posés par les élèves et les messages
   * privés filtrés. Depuis ici on masque, on réécrit ou on supprime.
   * ---------------------------------------------------------------------- */
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

  function extra(cle) {
    if (!etat.extras[cle]) etat.extras[cle] = { donnees: null, chargement: false, erreur: '' };
    return etat.extras[cle];
  }

  function prenomDe(id) {
    var trouve = etat.comptes.filter(function (compte) { return compte.id === id; })[0];
    return trouve ? trouve.prenom : 'compte supprimé';
  }

  function familleLabel(cle) {
    if (!cle) return 'autre';
    return FAMILLES_LABEL[cle] || String(cle).replace(/_/g, ' ');
  }

  function chargerExtra(cle, force) {
    var boite = extra(cle);
    if (boite.chargement) return Promise.resolve();
    if (boite.donnees && !force) return Promise.resolve();

    boite.chargement = true;
    boite.erreur = '';
    peindre();

    var taches;
    if (cle === 'moderation') {
      taches = Promise.all([
        rpc('class_chat_feed', { p_limit: 200 }),
        rpc('class_reports_feed', { p_limit: 40 }),
        rpc('private_flagged', { p_limit: 30 })
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        return {
          messages: (res[0].data || []).filter(function (m) { return m.flagged || m.hidden; }),
          signalements: res[1].error ? [] : (res[1].data || []),
          prives: res[2].error ? [] : (res[2].data || [])
        };
      });
    } else if (cle === 'connexions') {
      taches = rpc('admin_login_attempts', { p_limit: 80 }).then(function (res) {
        if (res.error) throw res.error;
        return res.data || {};
      });
    } else {
      taches = Promise.resolve({});
    }

    return taches.then(function (donnees) {
      boite.donnees = donnees;
      boite.chargement = false;
      peindre();
    }).catch(function (err) {
      boite.chargement = false;
      boite.erreur = messageErreur(err);
      peindre();
    });
  }

  function rechargerExtra(cle) {
    return chargerExtra(cle, true);
  }

  function badgeFamille(message) {
    var familles = message.categories && message.categories.length
      ? message.categories
      : (message.motif ? [message.motif] : []);
    if (!familles.length) return UI.el('span', { class: 'pill pill--muted', text: 'signalé' });
    return UI.el('span', { class: 'pill pill--danger', text: familleLabel(familles[0]) });
  }

  function actionsMessage(message, apres) {
    var id = message.id != null ? message.id : message.message_id;

    return UI.el('div', { class: 'admin-actions' }, [
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        text: message.hidden ? 'Réafficher' : 'Masquer',
        onclick: function () {
          rpc('admin_message_hide', { p_id: id, p_hidden: !message.hidden }).then(function (res) {
            if (res.error) { UI.err(messageErreur(res.error)); return; }
            if (UI.toast) UI.toast(message.hidden ? 'Message réaffiché.' : 'Message masqué.', 'ok');
            apres();
          });
        }
      }),
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: 'Modifier',
        onclick: function () { modifierMessage(id, message.body || message.extrait || '', apres); }
      }),
      UI.el('button', {
        type: 'button', class: 'btn btn-danger btn-sm', text: 'Supprimer',
        onclick: function () {
          UI.confirm({
            title: 'Supprimer ce message ?',
            message: 'Il disparaîtra pour tout le monde. L’action est définitive.',
            danger: true,
            confirmLabel: 'Supprimer'
          }).then(function (ok) {
            if (!ok) return;
            rpc('class_chat_delete', { p_id: id }).then(function (res) {
              if (res.error) { UI.err(messageErreur(res.error)); return; }
              if (UI.toast) UI.toast('Message supprimé.', 'ok');
              apres();
            });
          });
        }
      })
    ]);
  }

  function modifierMessage(id, texte, apres) {
    var champ = UI.el('textarea', { class: 'input', rows: 4, maxlength: 1000 });
    champ.value = texte;

    var modale = UI.modal({
      title: 'Modifier le message',
      sub: 'La version corrigée remplace le texte pour tout le monde.',
      eye: 'edit',
      body: UI.el('div', { class: 'field' }, [
        UI.el('label', { text: 'Nouveau texte' }),
        champ
      ]),
      footer: [
        UI.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onclick: function () { modale.close(); } }),
        UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Enregistrer',
          onclick: function () {
            var version = champ.value.trim();
            if (!version) { UI.err('Le message ne peut pas être vide.'); return; }
            modale.close();
            rpc('admin_message_edit', { p_id: id, p_body: version }).then(function (res) {
              if (res.error) { UI.err(messageErreur(res.error)); return; }
              if (UI.toast) UI.toast('Message corrigé.', 'ok');
              apres();
            });
          }
        })
      ]
    });
  }

  function peindreModeration(hote) {
    var boite = extra('moderation');

    hote.appendChild(UI.el('div', { class: 'admin-barre' }, [
      UI.el('p', { class: 'sub', text:
        'Tout ce que le filtre a retenu, les messages signalés par les élèves et les messages privés filtrés.' }),
      UI.el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: 'Rafraîchir',
        onclick: function () { rechargerExtra('moderation'); }
      })
    ]));

    if (boite.erreur) hote.appendChild(UI.el('div', { class: 'alert alert--error', text: boite.erreur }));

    if (boite.chargement && !boite.donnees) {
      hote.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'spinner' }),
        UI.el('div', { class: 'empty-text', text: 'Chargement des signalements…' })
      ]));
      return;
    }

    var donnees = boite.donnees || { messages: [], signalements: [], prives: [] };

    /* 1. Messages signalés par les élèves (🚩). */
    var secSignal = UI.el('div', { class: 'panel' });
    secSignal.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('alert', { size: 16 })]),
          document.createTextNode(' Signalements 🚩')
        ]),
        UI.el('div', { class: 'panel-sub', text: donnees.signalements.length + ' message' +
          (donnees.signalements.length > 1 ? 's' : '') + ' signalé' +
          (donnees.signalements.length > 1 ? 's' : '') + ' par les élèves' })
      ])
    ]));
    var corpsSignal = UI.el('div', { class: 'panel-body panel-body--flush' });
    if (!donnees.signalements.length) {
      corpsSignal.appendChild(UI.el('div', { class: 'empty-text', style: { padding: '14px' }, text: 'Aucun signalement. 👍' }));
    } else {
      donnees.signalements.forEach(function (ligne) {
        corpsSignal.appendChild(UI.el('div', { class: 'admin-ligne' }, [
          UI.el('div', { class: 'admin-ligne-tete' }, [
            UI.el('b', { text: ligne.auteur || '—' }),
            UI.el('span', { class: 'pill pill--danger', text: (ligne.nb || 1) + ' 🚩' }),
            UI.el('span', { class: 'faint', text: dateCourte(ligne.created_at) })
          ]),
          UI.el('p', { class: 'admin-extrait', text: ligne.extrait || '' }),
          actionsMessage({ id: ligne.message_id, body: ligne.extrait, hidden: false }, function () {
            rechargerExtra('moderation');
          })
        ]));
      });
    }
    secSignal.appendChild(corpsSignal);
    hote.appendChild(secSignal);

    /* 2. Messages du tchat de classe retenus par le filtre. */
    var secFiltre = UI.el('div', { class: 'panel' });
    secFiltre.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('filter', { size: 16 })]),
          document.createTextNode(' Messages filtrés (tchat de classe)')
        ]),
        UI.el('div', { class: 'panel-sub', text: donnees.messages.length + ' message' +
          (donnees.messages.length > 1 ? 's' : '') + ' à surveiller' })
      ])
    ]));
    var corpsFiltre = UI.el('div', { class: 'panel-body panel-body--flush' });
    if (!donnees.messages.length) {
      corpsFiltre.appendChild(UI.el('div', { class: 'empty-text', style: { padding: '14px' }, text: 'Rien à surveiller pour le moment.' }));
    } else {
      donnees.messages.forEach(function (message) {
        corpsFiltre.appendChild(UI.el('div', {
          class: 'admin-ligne' + (message.hidden ? ' is-muted' : '')
        }, [
          UI.el('div', { class: 'admin-ligne-tete' }, [
            UI.el('b', { text: prenomDe(message.author_id) }),
            badgeFamille(message),
            message.severity ? UI.el('span', { class: 'pill pill--muted', text: 'sévérité ' + message.severity }) : null,
            message.hidden ? UI.el('span', { class: 'pill pill--danger', text: 'masqué' }) : null,
            UI.el('span', { class: 'faint', text: dateCourte(message.created_at) })
          ]),
          UI.el('p', { class: 'admin-extrait', text: (message.body || '').slice(0, 240) }),
          message.cible ? UI.el('p', { class: 'faint', text: 'Cible : ' + message.cible }) : null,
          actionsMessage(message, function () { rechargerExtra('moderation'); })
        ]));
      });
    }
    secFiltre.appendChild(corpsFiltre);
    hote.appendChild(secFiltre);

    /* 3. Messages privés filtrés. */
    if (donnees.prives && donnees.prives.length) {
      var secPrive = UI.el('div', { class: 'panel' });
      secPrive.appendChild(UI.el('div', { class: 'panel-head' }, [
        UI.el('div', {}, [
          UI.el('div', { class: 'panel-title' }, [
            UI.el('span', {}, [UI.icon('mail', { size: 16 })]),
            document.createTextNode(' Messages privés filtrés')
          ]),
          UI.el('div', { class: 'panel-sub', text: donnees.prives.length + ' échange' +
            (donnees.prives.length > 1 ? 's' : '') + ' entre élèves' })
        ])
      ]));
      var corpsPrive = UI.el('div', { class: 'panel-body panel-body--flush' });
      donnees.prives.forEach(function (ligne) {
        corpsPrive.appendChild(UI.el('div', { class: 'admin-ligne' }, [
          UI.el('div', { class: 'admin-ligne-tete' }, [
            UI.el('b', { text: (ligne.sender || '?') + ' → ' + (ligne.recipient || '?') }),
            badgeFamille(ligne),
            UI.el('span', { class: 'faint', text: dateCourte(ligne.created_at) })
          ]),
          UI.el('p', { class: 'admin-extrait', text: ligne.excerpt || '' }),
          UI.el('div', { class: 'admin-actions' }, [
            UI.el('button', {
              type: 'button', class: 'btn btn-danger btn-sm', text: 'Supprimer',
              onclick: function () {
                UI.confirm({
                  title: 'Supprimer ce message privé ?',
                  message: 'Il disparaîtra de la conversation des deux élèves.',
                  danger: true,
                  confirmLabel: 'Supprimer'
                }).then(function (ok) {
                  if (!ok) return;
                  rpc('private_delete', { p_id: ligne.id }).then(function (res) {
                    if (res.error) { UI.err(messageErreur(res.error)); return; }
                    if (UI.toast) UI.toast('Message privé supprimé.', 'ok');
                    rechargerExtra('moderation');
                  });
                });
              }
            })
          ])
        ]));
      });
      secPrive.appendChild(corpsPrive);
      hote.appendChild(secPrive);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Qui essaie de se connecter                                             */
  /* ---------------------------------------------------------------------- */
  function peindreConnexions(hote) {
    var boite = extra('connexions');

    hote.appendChild(UI.el('div', { class: 'admin-barre' }, [
      UI.el('p', { class: 'sub', text:
        'Chaque tentative de connexion est enregistrée : prénom, réussite, appareil et date. ' +
        'Au bout de 5 échecs en 15 minutes, le prénom est bloqué un quart d’heure.' }),
      UI.el('div', { class: 'admin-actions' }, [
        UI.el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', text: 'Rafraîchir',
          onclick: function () { rechargerExtra('connexions'); }
        }),
        UI.el('button', {
          type: 'button', class: 'btn btn-danger btn-sm', text: 'Purger le journal',
          onclick: function () {
            UI.confirm({
              title: 'Vider le journal des connexions ?',
              message: 'Toutes les tentatives enregistrées seront effacées, et les blocages levés.',
              danger: true,
              confirmLabel: 'Purger'
            }).then(function (ok) {
              if (!ok) return;
              rpc('admin_clear_login_attempts').then(function (res) {
                if (res.error) { UI.err(messageErreur(res.error)); return; }
                if (UI.toast) UI.toast('Journal purgé (' + (res.data || 0) + ' lignes).', 'ok');
                rechargerExtra('connexions');
              });
            });
          }
        })
      ])
    ]));

    if (boite.erreur) hote.appendChild(UI.el('div', { class: 'alert alert--error', text: boite.erreur }));

    if (boite.chargement && !boite.donnees) {
      hote.appendChild(UI.el('div', { class: 'empty' }, [
        UI.el('span', { class: 'spinner' }),
        UI.el('div', { class: 'empty-text', text: 'Chargement du journal…' })
      ]));
      return;
    }

    var donnees = boite.donnees || {};
    var essais = donnees.essais || [];
    var liste = donnees.liste || [];

    var secEssais = UI.el('div', { class: 'panel' });
    secEssais.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('shield', { size: 16 })]),
          document.createTextNode(' Prénoms qui échouent')
        ]),
        UI.el('div', { class: 'panel-sub', text: essais.length + ' prénom' + (essais.length > 1 ? 's' : '') + ' avec au moins un échec (30 derniers jours)' })
      ])
    ]));
    var corpsEssais = UI.el('div', { class: 'panel-body panel-body--flush' });
    if (!essais.length) {
      corpsEssais.appendChild(UI.el('div', { class: 'empty-text', style: { padding: '14px' }, text: 'Aucun échec de connexion. 👍' }));
    } else {
      essais.forEach(function (ligne) {
        corpsEssais.appendChild(UI.el('div', { class: 'admin-ligne' }, [
          UI.el('div', { class: 'admin-ligne-tete' }, [
            UI.el('b', { text: ligne.prenom || '—' }),
            ligne.bloque ? UI.el('span', { class: 'pill pill--danger', text: 'bloqué' }) : null,
            UI.el('span', { class: 'pill pill--muted', text: (ligne.echecs || 0) + ' échec' + ((ligne.echecs || 0) > 1 ? 's' : '') }),
            UI.el('span', { class: 'pill pill--ok', text: (ligne.succes || 0) + ' réussie' + ((ligne.succes || 0) > 1 ? 's' : '') }),
            UI.el('span', { class: 'faint', text: dateCourte(ligne.dernier) })
          ])
        ]));
      });
    }
    secEssais.appendChild(corpsEssais);
    hote.appendChild(secEssais);

    var secJournal = UI.el('div', { class: 'panel' });
    secJournal.appendChild(UI.el('div', { class: 'panel-head' }, [
      UI.el('div', {}, [
        UI.el('div', { class: 'panel-title' }, [
          UI.el('span', {}, [UI.icon('clock', { size: 16 })]),
          document.createTextNode(' Dernières tentatives')
        ]),
        UI.el('div', { class: 'panel-sub', text: liste.length + ' tentative' + (liste.length > 1 ? 's' : '') + ' enregistrée' + (liste.length > 1 ? 's' : '') })
      ])
    ]));

    var table = UI.el('div', { class: 'admin-table' });
    if (!liste.length) {
      table.appendChild(UI.el('div', { class: 'empty-text', style: { padding: '14px' }, text: 'Journal vide.' }));
    } else {
      liste.forEach(function (ligne) {
        table.appendChild(UI.el('div', { class: 'admin-table-ligne' }, [
          UI.el('span', { class: 'admin-table-nom', text: ligne.prenom || '—' }),
          UI.el('span', {
            class: 'pill ' + (ligne.ok ? 'pill--ok' : 'pill--danger'),
            text: ligne.ok ? 'connecté' : 'refusé'
          }),
          UI.el('span', { class: 'admin-table-agent', title: ligne.agent || '', text: agentCourt(ligne.agent) }),
          UI.el('span', { class: 'faint', text: dateCourte(ligne.at) })
        ]));
      });
    }
    secJournal.appendChild(UI.el('div', { class: 'panel-body panel-body--flush' }, [table]));
    hote.appendChild(secJournal);
  }

  function agentCourt(agent) {
    var texte = String(agent || '');
    if (!texte) return 'appareil inconnu';
    if (/android/i.test(texte)) return 'Android';
    if (/iphone|ipad|ios/i.test(texte)) return 'iPhone / iPad';
    if (/windows/i.test(texte)) return 'Windows';
    if (/macintosh|mac os/i.test(texte)) return 'Mac';
    if (/linux/i.test(texte)) return 'Linux';
    return texte.slice(0, 28) + (texte.length > 28 ? '…' : '');
  }

  /* ---------------------------------------------------------------------- */
  /* Rapport de climat                                                      */
  /* ---------------------------------------------------------------------- */
  function peindreClimat(hote) {
    /* Le rapport vit dans son propre module : il est aussi accessible depuis
       l'onglet « Climat » de la navigation, pour l'encadrement. */
    if (window.ECEM && window.ECEM.Climat) {
      window.ECEM.Climat.mount(hote);
      return;
    }

    hote.appendChild(UI.el('div', { class: 'empty' }, [
      UI.el('span', { class: 'empty-ico' }, [UI.icon('chart', { size: 26 })]),
      UI.el('div', { class: 'empty-title', text: 'Rapport indisponible' }),
      UI.el('div', { class: 'empty-text', text: 'Le module du rapport de climat n’a pas pu se charger.' })
    ]));
  }

  function peindre() {
    if (!dom.hote) return;
    UI.clear(dom.hote);

    var s = etat.stats || {};

    dom.hote.appendChild(UI.el('div', { class: 'admin-tete' }, [
      UI.el('h2', { class: 'admin-titre', text: 'Administration' }),
      UI.el('p', { class: 'sub', text:
        'Comptes, codes d’inscription, modération centralisée, tentatives de connexion et rapport de climat.' })
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
      boutonOnglet('codes', 'Codes'),
      boutonOnglet('moderation', 'Modération'),
      boutonOnglet('connexions', 'Connexions'),
      boutonOnglet('climat', 'Climat')
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
    else if (etat.onglet === 'moderation') peindreModeration(dom.hote);
    else if (etat.onglet === 'connexions') peindreConnexions(dom.hote);
    else if (etat.onglet === 'climat') peindreClimat(dom.hote);
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
        if (cle === 'moderation' || cle === 'connexions') {
          chargerExtra(cle);
        }
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
