/* ============================================================================
 * ECEM Point — page de connexion / inscription (index.html)
 * ----------------------------------------------------------------------------
 * Deux écrans en un :
 *
 *  CONNEXION  : prénom + mot de passe  ->  signInWithPassword
 *  INSCRIPTION: prénom + rôle + mot de passe
 *               - élève                -> le mot de passe est libre (6 car. min)
 *               - suppléant / délégué  -> le mot de passe attendu EST le code
 *                                         confidentiel de la classe
 *
 * Déroulé d'une inscription « à responsabilité » :
 *   1. claim_staff_code()  réserve le code (jeton valable 10 min).
 *   2. auth.signUp()       crée le compte de connexion (le code devient le mot
 *                          de passe personnel du compte).
 *   3. activate_account()  crée la ligne profiles et CONSOMME le code.
 *
 * Si l'étape 2 ou 3 échoue, le code n'est pas perdu : la réservation expire
 * toute seule et le mode « terminer mon inscription » prend le relais.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM && window.ECEM.UI;
  var sb = window.ECEM && window.ECEM.sb;
  var Theme = window.ECEM && window.ECEM.Theme;
  var Health = window.ECEM && window.ECEM.Health;

  if (!sb || !UI) return;

  var dom = {};
  var recoveryMode = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    hydrateIcons();

    dom = {
      tabLogin: UI.$('#tab-login'),
      tabSignup: UI.$('#tab-signup'),
      formLogin: UI.$('#form-login'),
      formSignup: UI.$('#form-signup'),
      loginPrenom: UI.$('#login-prenom'),
      loginPassword: UI.$('#login-password'),
      btnLogin: UI.$('#btn-login'),
      signupPrenom: UI.$('#signup-prenom'),
      signupPassword: UI.$('#signup-password'),
      signupPasswordLabel: UI.$('#signup-password-label'),
      signupPasswordHelp: UI.$('#signup-password-help'),
      signupStrength: UI.$('#signup-strength'),
      signupField: UI.$('#signup-password').closest('.field'),
      staffNote: UI.$('#signup-staff-note'),
      staffWord: UI.$('#signup-staff-word'),
      btnSignup: UI.$('#btn-signup'),
      btnDemo: UI.$('#btn-demo'),
      btnHelp: UI.$('#btn-help'),
      btnQr: UI.$('#btn-qr'),
      alert: UI.$('#auth-alert'),
      backendAlert: UI.$('#backend-alert'),
      status: UI.$('#auth-status'),
      themeBtn: UI.$('#btn-theme')
    };

    bindTabs();
    bindRoles();
    bindEyes();
    bindTheme();
    bindExtras();

    dom.formLogin.addEventListener('submit', onLogin);
    dom.formSignup.addEventListener('submit', onSignup);
    dom.signupPassword.addEventListener('input', updateStrength);

    if (dom.loginPrenom) dom.loginPrenom.focus({ preventScroll: true });

    checkBackend();
    restoreSession();
  }

  /* -------------------------------------------------------------------------
   * Santé de la base : le bandeau n'apparaît que si quelque chose cloche
   * ---------------------------------------------------------------------- */
  function checkBackend() {
    if (!Health) return;
    Health.onChange(paintBackend);
    Health.check().then(paintBackend);
  }

  function paintBackend(state) {
    if (!dom.backendAlert) return;
    if (state.status === 'ok') {
      dom.backendAlert.classList.add('is-hidden');
      UI.clear(dom.backendAlert);
      return;
    }
    Health.renderNotice(dom.backendAlert, { demo: true });
  }

  /* Message d'erreur : le diagnostic réseau affine celui de UI.humanError. */
  function errorText(err) {
    if (Health) {
      var explained = Health.explain(err);
      if (explained) return explained;
    }
    return UI.humanError(err);
  }

  function hydrateIcons() {
    UI.$$('[data-icon]').forEach(function (node) {
      var size = parseInt(node.getAttribute('data-size'), 10) || 20;
      UI.clear(node);
      node.appendChild(UI.icon(node.getAttribute('data-icon'), { size: size }));
    });
  }

  /* -------------------------------------------------------------------------
   * Session existante : on évite de redemander un mot de passe inutilement
   * ---------------------------------------------------------------------- */
  function restoreSession() {
    var flash = null;
    try {
      flash = window.sessionStorage.getItem('ecem-flash');
      window.sessionStorage.removeItem('ecem-flash');
    } catch (e) {}
    if (flash) setTimeout(function () { UI.info(flash); }, 400);

    setStatus('Vérification de ta session…');

    sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) { setStatus(''); return null; }

      return sb
        .from('profiles')
        .select('id, prenom, role, points')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;

          if (r.data) {
            setStatus('Content de te revoir, ' + r.data.prenom + ' — redirection…');
            window.location.replace('app.html');
            return;
          }

          /* Compte de connexion présent, profil absent : inscription à finir. */
          enterRecovery(session);
        });
    }).catch(function (err) {
      setStatus('');
      showAlert(errorText(err), 'error');
      sb.auth.signOut();
    });
  }

  function enterRecovery(session) {
    if (!session || !session.user) {
      showAlert(
        'Mot de passe accepté, mais la session n’a pas pu être enregistrée sur cet appareil. ' +
        'Vérifie que les cookies et le stockage local ne sont pas bloqués, puis réessaie.',
        'error'
      );
      return;
    }

    recoveryMode = true;
    var brut = (session.user.email || '').split('@')[0] || '';

    switchTab('signup');
    dom.signupPrenom.value = brut
      .replace(/\./g, ' ')
      .replace(/(^|\s|-)([a-zà-ÿ])/g, function (m, sep, c) { return sep + c.toUpperCase(); });
    dom.btnSignup.querySelector('.btn-label').textContent = 'Terminer mon inscription';
    setStatus('');
    showAlert(
      'Ton compte existe mais n’a jamais été activé. Choisis ton rôle ' +
      '(et ton code si tu es suppléant ou délégué) pour terminer.',
      'info'
    );
    applyRoleUi(currentRole());
  }

  /* -------------------------------------------------------------------------
   * Onglets
   * ---------------------------------------------------------------------- */
  function bindTabs() {
    dom.tabLogin.addEventListener('click', function () { switchTab('login'); });
    dom.tabSignup.addEventListener('click', function () { switchTab('signup'); });
  }

  function switchTab(which) {
    var login = which === 'login';
    dom.tabLogin.classList.toggle('is-active', login);
    dom.tabSignup.classList.toggle('is-active', !login);
    dom.tabLogin.setAttribute('aria-selected', login ? 'true' : 'false');
    dom.tabSignup.setAttribute('aria-selected', login ? 'false' : 'true');
    dom.formLogin.classList.toggle('is-hidden', !login);
    dom.formSignup.classList.toggle('is-hidden', login);
    hideAlert();
    (login ? dom.loginPrenom : dom.signupPrenom).focus({ preventScroll: true });
    if (!login) updateStrength();
  }

  /* -------------------------------------------------------------------------
   * Choix du rôle : le libellé du mot de passe s'adapte
   * ---------------------------------------------------------------------- */
  function bindRoles() {
    UI.$$('input[name="role"]').forEach(function (radio) {
      radio.addEventListener('change', function () { applyRoleUi(currentRole()); });
    });
    applyRoleUi('eleve');
  }

  function currentRole() {
    var checked = UI.$('input[name="role"]:checked');
    return checked ? checked.value : 'eleve';
  }

  function applyRoleUi(role) {
    var staff = UI.isStaff(role);
    var word = role === 'delegue' ? 'délégué' : role === 'suppleant' ? 'suppléant' : '';

    if (!staff) {
      dom.signupPasswordLabel.textContent = 'Mot de passe';
      dom.signupPasswordHelp.innerHTML =
        'Choisis un mot de passe de 6&nbsp;caractères minimum. Tu le réutiliseras à chaque connexion.';
      dom.signupPassword.required = !(recoveryMode && role === 'eleve');
      dom.signupPassword.minLength = 6;
      dom.signupPassword.placeholder = '••••••••';
      dom.staffNote.classList.add('is-hidden');
      dom.signupField.classList.toggle('is-hidden', recoveryMode && role === 'eleve');
      dom.signupStrength.classList.remove('is-hidden');
      return;
    }

    dom.signupPasswordLabel.textContent = 'Mot de passe ' + word;
    dom.signupPasswordHelp.innerHTML =
      'Saisis le mot de passe <strong>' + word + '</strong> qui t’a été communiqué. ' +
      'Il sert une seule fois, puis il devient ton mot de passe.';
    dom.signupPassword.required = true;
    dom.signupPassword.minLength = 4;
    dom.signupPassword.placeholder = 'Code ' + word;
    dom.signupField.classList.remove('is-hidden');
    dom.signupStrength.classList.add('is-hidden');
    dom.staffWord.textContent = word;
    dom.staffNote.classList.remove('is-hidden');
  }

  function updateStrength() {
    if (!dom.signupStrength || dom.signupStrength.classList.contains('is-hidden')) return;
    var value = dom.signupPassword.value || '';
    var score = 0;
    if (value.length >= 6) score++;
    if (value.length >= 10) score++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
    if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
    if (!value) score = 0;
    dom.signupStrength.className = 'strength' + (score ? ' s' + score : '');
  }

  /* Afficher / masquer le mot de passe. */
  function bindEyes() {
    UI.$$('.eye').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.target);
        if (!input) return;
        var shown = input.type === 'text';
        input.type = shown ? 'password' : 'text';
        btn.innerHTML = '';
        btn.appendChild(UI.icon(shown ? 'eye' : 'eye-off', { size: 18 }));
        btn.setAttribute('aria-label', shown ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
      });
    });
  }

  function bindTheme() {
    if (!Theme || !dom.themeBtn) return;
    var paint = function () {
      var mode = Theme.mode();
      var actual = Theme.resolved();
      dom.themeBtn.innerHTML = '';
      dom.themeBtn.appendChild(UI.icon(actual === 'dark' ? 'moon' : 'sun', { size: 19 }));
      dom.themeBtn.setAttribute('title', 'Thème : ' + Theme.label(mode));
      dom.themeBtn.setAttribute('aria-label', 'Thème : ' + Theme.label(mode) + '. Changer de thème.');
    };
    paint();
    dom.themeBtn.addEventListener('click', function () {
      Theme.cycle();
      paint();
    });
    document.addEventListener('ecem:theme', paint);
  }

  /* -------------------------------------------------------------------------
   * Démo + aide
   * ---------------------------------------------------------------------- */
  function bindExtras() {
    if (dom.btnDemo) {
      dom.btnDemo.addEventListener('click', openDemo);
    }
    if (dom.btnHelp) {
      dom.btnHelp.addEventListener('click', openHelp);
    }
    if (dom.btnQr) {
      dom.btnQr.addEventListener('click', openQr);
    }
    UI.$$('a[href="app.html?demo=1"]').forEach(function (link) {
      link.addEventListener('click', function () {
        try { window.localStorage.setItem('ecem-demo-role', 'delegue'); } catch (e) {}
      });
    });
  }

  /* QR de partage : dessiné sur l'appareil par assets/vendor/qrcode.js. */
  function openQr() {
    if (!window.ECEM || !window.ECEM.QR) {
      showAlert('Le générateur de QR n’a pas pu se charger. Recharge la page.', 'error');
      return;
    }
    var modale = UI.modal({
      title: 'Partager ECEM Point',
      sub: 'Ce QR code est fabriqué sur ton appareil : il fonctionne même sans connexion.',
      eye: 'share',
      body: window.ECEM.QR.bloc(),
      footer: [
        UI.el('button', {
          type: 'button', class: 'btn btn-primary', text: 'Fermer',
          onclick: function () { modale.close(); }
        })
      ]
    });
  }

  function openDemo() {
    var roles = [
      { id: 'delegue', label: 'Délégué', icon: 'crown', desc: 'Distribue les points et ouvre le tchat.' },
      { id: 'suppleant', label: 'Suppléant', icon: 'shield', desc: 'Suit la classe et participe au tchat.' },
      { id: 'eleve', label: 'Élève', icon: 'user', desc: 'Reçoit et envoie ses points.' }
    ];

    var list = UI.el('div', { class: 'role-grid' });
    var modal;

    roles.forEach(function (role) {
      list.appendChild(UI.el('button', {
        type: 'button', class: 'role-option', style: { textAlign: 'left', width: '100%' },
        onclick: function () {
          try { window.localStorage.setItem('ecem-demo-role', role.id); } catch (e) {}
          window.location.href = 'app.html?demo=1';
        }
      }, [
        UI.el('span', { class: 'role-ico' }, [UI.icon(role.icon, { size: 16 })]),
        UI.el('span', { class: 'role-body' }, [
          UI.el('span', { class: 'role-title', text: role.label }),
          UI.el('span', { class: 'role-sub', text: role.desc })
        ])
      ]));
    });

    modal = UI.modal({
      title: 'Explorer la démo',
      sub: 'Une classe fictive, trois rôles, aucune inscription.',
      eye: 'wand',
      body: UI.frag([
        UI.el('div', { class: 'notice', style: { marginBottom: '16px' } }, [
          UI.icon('info', { size: 16 }),
          UI.el('span', {}, [
            UI.el('strong', { text: 'Rien n’est réel. ' }),
            document.createTextNode('Les données restent dans cet onglet et disparaissent au rechargement.')
          ])
        ]),
        list
      ]),
      footer: [
        UI.el('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onclick: function () { modal.close(); } })
      ]
    });
  }

  function openHelp() {
    var faq = [
      {
        q: 'Comment obtenir mon mot de passe délégué ou suppléant ?',
        a: 'Le code confidentiel est remis par la classe (un code par poste). Il sert une seule fois, à l’inscription : il devient ensuite ton mot de passe personnel.'
      },
      {
        q: 'Mon prénom est déjà pris.',
        a: 'Les prénoms sont uniques dans la classe. Ajoute ton initiale de nom, par exemple « Léa M », pour te distinguer.'
      },
      {
        q: 'J’ai oublié mon mot de passe.',
        a: 'Aucune adresse e-mail réelle n’est utilisée : demande à un délégué de créer un nouveau compte avec un prénom légèrement différent, puis préviens l’encadrement.'
      },
      {
        q: 'Qui voit mes points et mon historique ?',
        a: 'Les délégués et suppléants voient la classe entière. Chaque élève ne voit que les mouvements qui le concernent.'
      }
    ];

    var body = UI.el('div', { class: 'stack', style: { gap: '14px' } });
    faq.forEach(function (item) {
      body.appendChild(UI.el('div', {}, [
        UI.el('div', { style: { fontWeight: 700, marginBottom: '3px' }, text: item.q }),
        UI.el('p', { class: 'sub', style: { fontSize: '.88rem' }, text: item.a })
      ]));
    });

    var modal = UI.modal({
      title: 'Un coup de main ?',
      sub: 'Les questions qui reviennent le plus souvent.',
      eye: 'info',
      body: body,
      footer: [
        UI.el('button', { type: 'button', class: 'btn btn-primary', text: 'Compris', onclick: function () { modal.close(); } })
      ]
    });
  }

  /* -------------------------------------------------------------------------
   * Anti-bruteforce
   * ---------------------------------------------------------------------- *
   * Chaque tentative — réussie ou non — part dans `login_attempts` avec le
   * prénom et l'appareil. `login_guard()` répond si le prénom est bloqué
   * (5 échecs en 15 minutes). Rien de tout cela ne bloque la connexion si la
   * base est injoignable : on ne fait jamais échouer une connexion à cause
   * du journal.
   * ---------------------------------------------------------------------- */
  function agentTexte() {
    try {
      return String(window.navigator.userAgent || '').slice(0, 180);
    } catch (e) {
      return '';
    }
  }

  function dureeTexte(secondes) {
    var s = Math.max(0, Math.round(secondes || 0));
    if (s <= 60) return Math.max(1, s) + ' seconde' + (s > 1 ? 's' : '');
    var minutes = Math.ceil(s / 60);
    return minutes + ' minute' + (minutes > 1 ? 's' : '');
  }

  function journaliser(prenom, ok) {
    try {
      var appel = sb.rpc('log_login_attempt', {
        p_prenom: prenom,
        p_ok: !!ok,
        p_agent: agentTexte()
      });
      if (appel && appel.then) appel.then(function () {}, function () {});
    } catch (e) {}
  }

  function verifierBlocage(prenom) {
    try {
      return sb.rpc('login_guard', { p_prenom: prenom }).then(function (res) {
        return (res && !res.error && res.data) || null;
      }, function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /* -------------------------------------------------------------------------
   * Connexion
   * ---------------------------------------------------------------------- */
  function onLogin(event) {
    event.preventDefault();
    hideAlert();

    var prenom = dom.loginPrenom.value.trim();
    var password = dom.loginPassword.value;

    if (!prenom || !password) {
      showAlert('Renseigne ton prénom et ton mot de passe.', 'error');
      return;
    }

    setBusy(dom.btnLogin, true, 'Connexion…');

    verifierBlocage(prenom)
      .then(function (garde) {
        /* Prénom bloqué : on s'arrête là, sans même tenter l'authentification. */
        if (garde && garde.bloque) {
          setBusy(dom.btnLogin, false, 'Se connecter');
          showAlert(
            'Trop de tentatives pour « ' + prenom + ' ». Réessaie dans ' +
            dureeTexte(garde.restant_secondes) + '.',
            'error'
          );
          if (window.ECEM.FX) window.ECEM.FX.sound('error');
          return null;
        }

        return sb.auth
          .signInWithPassword({ email: UI.emailFromPrenom(prenom), password: password })
          .then(function (res) {
            if (res.error) {
              journaliser(prenom, false);
              throw res.error;
            }
            journaliser(prenom, true);
            return sb.from('profiles').select('id, role, prenom').eq('id', res.data.user.id).maybeSingle();
          })
          .then(function (res) {
            if (!res) return;
            if (res.error) throw res.error;

            if (!res.data) {
              return sb.auth.getSession().then(function (r) {
                setBusy(dom.btnLogin, false, 'Se connecter');
                enterRecovery(r.data.session);
              });
            }

            setStatus('Bienvenue ' + res.data.prenom + ', redirection…');
            window.location.replace('app.html');
          });
      })
      .catch(function (err) {
        setBusy(dom.btnLogin, false, 'Se connecter');
        var texte = errorText(err);
        showAlert(texte, 'error');
        if (window.ECEM.FX) window.ECEM.FX.sound('error');
        dom.loginPassword.select();

        /* On prévient avant le blocage plutôt qu'après. */
        verifierBlocage(prenom).then(function (garde) {
          if (garde && !garde.bloque && garde.echecs >= 2 && garde.max) {
            showAlert(texte + ' Encore ' + Math.max(0, garde.max - garde.echecs) +
              ' essai' + (garde.max - garde.echecs > 1 ? 's' : '') +
              ' avant un blocage de 15 minutes.', 'error');
          }
        });
      });
  }

  /* -------------------------------------------------------------------------
   * Inscription
   * ---------------------------------------------------------------------- */
  function onSignup(event) {
    event.preventDefault();
    hideAlert();

    var prenom = dom.signupPrenom.value.trim();
    var role = currentRole();
    var password = dom.signupPassword.value;
    var staff = UI.isStaff(role);

    if (prenom.length < 2) {
      showAlert('Ton prénom doit faire au moins 2 caractères.', 'error');
      return;
    }
    if (!staff && !recoveryMode && password.length < 6) {
      showAlert('Le mot de passe doit faire au moins 6 caractères.', 'error');
      return;
    }
    if (staff && !password) {
      showAlert('Le mot de passe ' + UI.roleLabel(role).toLowerCase() + ' est obligatoire.', 'error');
      return;
    }

    setBusy(dom.btnSignup, true, 'Création…');

    var token = null;
    var wantEmail = UI.emailFromPrenom(prenom);

    /* 1. Réservation du code (suppléant / délégué uniquement). */
    var step1 = staff
      ? sb.rpc('claim_staff_code', { p_role: role, p_code: password }).then(function (res) {
          if (res.error) throw res.error;
          token = res.data;
        })
      : Promise.resolve();

    step1
      /* 2. Compte de connexion : créé, ou réutilisé en mode récupération. */
      .then(function () {
        return sb.auth.getSession().then(function (res) {
          var session = res.data && res.data.session;
          var sameAccount =
            session && session.user &&
            String(session.user.email || '').toLowerCase() === wantEmail;

          if (session && !sameAccount) return sb.auth.signOut().then(function () { return false; });
          return sameAccount;
        });
      })
      .then(function (alreadyExists) {
        if (alreadyExists) return null;

        if (!staff && password.length < 6) {
          recoveryMode = false;
          applyRoleUi(role);
          dom.signupPassword.focus();
          throw new Error('Tu as changé de prénom : choisis un mot de passe de 6 caractères minimum.');
        }

        setBusy(dom.btnSignup, true, 'Création du compte…');
        return sb.auth.signUp({ email: wantEmail, password: password }).then(function (res) {
          if (res.error) throw res.error;

          /* Supabase ne signale pas un e-mail déjà pris : il renvoie un
             utilisateur fantôme (identities vide) et aucune session.
             On transforme ce silence en message clair. */
          var ghost = res.data && res.data.user;
          if (ghost && Array.isArray(ghost.identities) && ghost.identities.length === 0) {
            throw new Error(
              'Ce prénom a déjà un compte sur le site. Choisis un autre prénom, ' +
              'ou connecte-toi dans l’onglet Connexion si c’est le tien.'
            );
          }

          if (!res.data.session) {
            throw new Error(
              'Le compte a été créé mais la session n’est pas ouverte : active « autoconfirm » ' +
              'dans Supabase (Authentication → Providers → Email).'
            );
          }
          return res.data.session;
        });
      })
      /* 3. Activation : crée le profil et consomme le code. */
      .then(function () {
        setBusy(dom.btnSignup, true, 'Activation…');
        return sb.rpc('activate_account', {
          p_prenom: prenom,
          p_role: role,
          p_token: token
        });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        recoveryMode = false;
        setStatus('Compte créé, redirection…');
        window.location.replace('app.html');
      })
      .catch(function (err) {
        setBusy(dom.btnSignup, false, recoveryMode ? 'Terminer mon inscription' : 'Créer mon compte');
        var message = errorText(err);

        /* L'activation a échoué : on rend le code disponible tout de suite. */
        if (token) {
          sb.rpc('release_staff_code', { p_token: token }).catch(function () {});
          token = null;
        }

        sb.auth
          .getSession()
          .then(function (res) {
            var session = res.data && res.data.session;
            var memeCompte =
              session && String(session.user.email || '').toLowerCase() === wantEmail;

            if (session && !memeCompte) {
              return sb.auth.signOut().then(function () { showAlert(message, 'error'); });
            }

            if (memeCompte) {
              recoveryMode = true;
              setBusy(dom.btnSignup, false, 'Terminer mon inscription');
              applyRoleUi(currentRole());
              showAlert(message + ' Ton compte existe déjà : corrige puis relance.', 'error');
              return null;
            }

            showAlert(message, 'error');
            return null;
          })
          .catch(function () { showAlert(message, 'error'); });
      });
  }

  /* -------------------------------------------------------------------------
   * Petit outillage d'affichage
   * ---------------------------------------------------------------------- */
  function showAlert(message, kind) {
    dom.alert.className = 'alert alert--' + (kind || 'info');
    UI.clear(dom.alert);
    dom.alert.appendChild(UI.icon(kind === 'error' ? 'alert' : 'info', { size: 16 }));
    dom.alert.appendChild(UI.el('span', { text: message }));
  }

  function hideAlert() {
    dom.alert.className = 'alert alert--info is-hidden';
    UI.clear(dom.alert);
  }

  function setStatus(text) {
    dom.status.textContent = text || '';
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = !!busy;
    button.classList.toggle('is-busy', !!busy);
    var span = button.querySelector('.btn-label');
    if (span && label) span.textContent = label;
  }
})();
