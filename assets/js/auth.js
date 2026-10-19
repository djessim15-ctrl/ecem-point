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
 *   1. claim_staff_code()  réserve le code (jeton valable 10 min). Un code déjà
 *      consommé est refusé ici : c'est la garantie « un seul compte par code ».
 *   2. auth.signUp()       crée le compte de connexion (le code devient le mot
 *                          de passe personnel du compte).
 *   3. activate_account()  crée la ligne profiles et CONSOMME le code.
 *
 * Si l'étape 2 ou 3 échoue, le code n'est pas perdu : la réservation expire
 * toute seule et le mode « terminer mon inscription » prend le relais.
 * ==========================================================================*/
(function () {
  'use strict';

  var UI = window.ECEM.UI;
  var sb = window.ECEM.sb;
  if (!sb || !UI) return;

  var dom = {};
  var recoveryMode = false;   // compte Auth déjà créé mais pas encore activé

  /* -------------------------------------------------------------------------
   * Démarrage
   * ---------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
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
      staffNote: UI.$('#signup-staff-note'),
      staffWord: UI.$('#signup-staff-word'),
      btnSignup: UI.$('#btn-signup'),
      alert: UI.$('#auth-alert'),
      status: UI.$('#auth-status')
    };

    bindTabs();
    bindRoles();
    bindEyes();

    dom.formLogin.addEventListener('submit', onLogin);
    dom.formSignup.addEventListener('submit', onSignup);

    restoreSession();
  }

  /* -------------------------------------------------------------------------
   * Session existante : on évite de redemander un mot de passe inutilement
   * ---------------------------------------------------------------------- */
  function restoreSession() {
    setStatus('Vérification de ta session…');

    sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) {
        setStatus('');
        return;
      }

      return sb
        .from('profiles')
        .select('id, prenom, role, points')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;

          if (r.data) {
            setStatus('Déjà connecté·e, redirection…');
            window.location.replace('app.html');
            return;
          }

          /* Compte de connexion présent, profil absent : inscription à finir. */
          enterRecovery(session);
        })
        .catch(function (err) {
          setStatus('');
          showAlert(UI.humanError(err), 'error');
          sb.auth.signOut();
        });
    });
  }

  function enterRecovery(session) {
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
    (login ? dom.loginPrenom : dom.signupPrenom).focus();
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
      dom.signupPassword.parentNode.parentNode.classList.toggle('is-hidden', recoveryMode && role === 'eleve');
      return;
    }

    dom.signupPasswordLabel.textContent = 'Mot de passe ' + word;
    dom.signupPasswordHelp.innerHTML =
      'Saisis le mot de passe <strong>' + word + '</strong> qui t’a été communiqué. ' +
      'Il sert une seule fois, puis il devient ton mot de passe.';
    dom.signupPassword.required = true;
    dom.signupPassword.minLength = 6;
    dom.signupPassword.placeholder = 'Code ' + word;
    dom.signupPassword.parentNode.parentNode.classList.remove('is-hidden');
    dom.staffWord.textContent = word;
    dom.staffNote.classList.remove('is-hidden');
  }

  /* Afficher / masquer le mot de passe. */
  function bindEyes() {
    UI.$$('.eye').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.target);
        if (!input) return;
        var shown = input.type === 'text';
        input.type = shown ? 'password' : 'text';
        btn.classList.toggle('is-on', !shown);
        btn.setAttribute('aria-label', shown ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
      });
    });
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

    sb.auth
      .signInWithPassword({ email: UI.emailFromPrenom(prenom), password: password })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.from('profiles').select('id, role').eq('id', res.data.user.id).maybeSingle();
      })
      .then(function (res) {
        if (res.error) throw res.error;

        if (!res.data) {
          /* Jamais activé : on repasse la main à l'onglet Inscription. */
          return sb.auth.getSession().then(function (r) {
            setBusy(dom.btnLogin, false, 'Se connecter');
            enterRecovery(r.data.session);
          });
        }

        setStatus('Bienvenue, redirection…');
        window.location.replace('app.html');
      })
      .catch(function (err) {
        setBusy(dom.btnLogin, false, 'Se connecter');
        showAlert(UI.humanError(err), 'error');
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

        /* Mode récupération avec un prénom modifié : il faut recréer un compte
         * de connexion, donc un vrai mot de passe (le champ était masqué). */
        if (!staff && password.length < 6) {
          recoveryMode = false;
          applyRoleUi(role);
          dom.signupPassword.focus();
          throw new Error(
            'Tu as changé de prénom : choisis un mot de passe de 6 caractères minimum.'
          );
        }

        setBusy(dom.btnSignup, true, 'Création du compte…');
        return sb.auth.signUp({ email: wantEmail, password: password }).then(function (res) {
          if (res.error) throw res.error;
          if (!res.data.session) {
            throw new Error(
              "Le compte a été créé mais la session n'est pas ouverte : " +
              'active « autoconfirm » dans Supabase (Authentication → Providers → Email).'
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
        UI.ok('Compte créé. Bienvenue ' + res.data.prenom + ' !');
        setStatus('Redirection…');
        window.location.replace('app.html');
      })
      .catch(function (err) {
        setBusy(dom.btnSignup, false, recoveryMode ? 'Terminer mon inscription' : 'Créer mon compte');
        var message = UI.humanError(err);

        /* L'activation a échoué : on rend le code disponible tout de suite au
         * lieu d'attendre l'expiration de la réservation (10 minutes). */
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

            /* Session sur un autre compte : on nettoie, rien à récupérer. */
            if (session && !memeCompte) {
              return sb.auth.signOut().then(function () { showAlert(message, 'error'); });
            }

            /* Le compte de connexion existe mais l'activation a échoué :
             * on bascule en mode récupération pour ne pas faire perdre le code. */
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
          .catch(function () {
            showAlert(message, 'error');
          });
      });
  }

  /* -------------------------------------------------------------------------
   * Petit outillage d'affichage
   * ---------------------------------------------------------------------- */
  function showAlert(message, kind) {
    dom.alert.textContent = message;
    dom.alert.className = 'alert alert--' + (kind || 'info');
  }

  function hideAlert() {
    dom.alert.textContent = '';
    dom.alert.className = 'alert is-hidden';
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
