import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Aucun rôle reçu du navigateur n'est utilisé comme autorisation serveur.
const $ = (id) => document.getElementById(id);
let client = null;
let profil = null;
let comptes = [];
let cadeaux = [];
let page = 'connexion';
let occupe = false;
let canal = null;
let generation = 0;
let motDePasseProvisoire = '';
let minuteurTchat = null;
const nomsRoles = { eleve: 'Élève', delegue: 'Délégué', suppleant: 'Suppléant' };
const statuts = { en_attente: 'En attente', en_impression: 'En cours d’impression', donne: 'Donné', annulee: 'Annulée', acceptee: 'Acceptée', refusee: 'Refusée' };
const titresTransactions = { gain: 'Gagné', envoi: 'Envoyé', reception: 'Reçu', depense: 'Dépensé', remboursement: 'Remboursé', annulation: 'Annulation d’un échange' };
const permissions = { connexion: [], 'mot-de-passe': [], accueil: ['eleve','delegue','suppleant'], historique: ['eleve','delegue','suppleant'], envoi: ['eleve','delegue','suppleant'], boutique: ['eleve','delegue','suppleant'], commandes: ['eleve','delegue','suppleant'], idees: ['eleve','suppleant'], delegue: ['delegue'], suppleant: ['suppleant'], tchat: ['delegue','suppleant'] };

function stockageLire(cle, session = false) {
  try { return (session ? sessionStorage : localStorage).getItem(cle); } catch { return null; }
}
function stockageEcrire(cle, valeur, session = false) {
  try {
    const stockage = session ? sessionStorage : localStorage;
    if (valeur === null) stockage.removeItem(cle); else stockage.setItem(cle, valeur);
  } catch { /* La navigation reste possible si le stockage est désactivé. */ }
}
function tailleTexte(taille) {
  const valeur = Math.max(20, Math.min(32, taille || 20));
  document.documentElement.style.fontSize = `${valeur}px`;
  stockageEcrire('classe-taille-texte', String(valeur));
  $('texte-plus').dataset.indisponible = String(valeur >= 32);
  $('texte-moins').dataset.indisponible = String(valeur <= 20);
  boutonsOccupes();
}
tailleTexte(Number(stockageLire('classe-taille-texte')));
$('texte-plus').addEventListener('click', () => tailleTexte(parseFloat(document.documentElement.style.fontSize) + 2));
$('texte-moins').addEventListener('click', () => tailleTexte(parseFloat(document.documentElement.style.fontSize) - 2));

function normaliserPrenom(prenom) {
  return prenom.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function message(texte, erreur = false) {
  $('message').textContent = texte;
  $('message').classList.toggle('erreur', erreur);
  $('message').hidden = !texte;
  $('message').setAttribute('role', erreur ? 'alert' : 'status');
}
function erreurFrancaise(erreur) {
  const texte = erreur?.message || '';
  if (/Invalid login credentials/i.test(texte)) return 'Prénom ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(texte)) return 'Ce compte n’a pas été confirmé. Demande au professeur.';
  if (/password.*(least|short|weak|different|same)/i.test(texte)) return 'Choisis un nouveau mot de passe différent, d’au moins 12 caractères.';
  if (/rate limit|too many requests|security purposes/i.test(texte)) return 'Trop de tentatives. Attends un peu avant de réessayer.';
  if (/fetch|network|Failed to|Load failed/i.test(texte)) return 'Connexion réseau interrompue. Actualise pour vérifier si ton action a été enregistrée avant de réessayer.';
  if (/JWT|token.*expired|session.*missing/i.test(texte)) return 'Ta session a expiré. Déconnecte-toi et reconnecte-toi.';
  if (/permission denied|row-level security|42501/i.test(texte) || erreur?.code === '42501') return 'Accès refusé : ton compte n’a pas cette permission.';
  if (/invalid input syntax|out of range|integer/i.test(texte)) return 'Valeur invalide : vérifie les champs et utilise un montant entier.';
  if (erreur?.code === '23505') return 'Cette opération est déjà enregistrée. Actualise la page avant de recommencer.';
  if (erreur?.code === 'P0001') return texte;
  return 'L’action n’a pas pu être terminée. Vérifie ta connexion et la configuration, puis réessaie.';
}
function boutonsOccupes() {
  document.querySelectorAll('button').forEach((bouton) => {
    bouton.disabled = occupe || bouton.dataset.indisponible === 'true';
  });
  $('contenu').setAttribute('aria-busy', String(occupe));
}
async function action(travail) {
  if (occupe) return;
  occupe = true;
  boutonsOccupes();
  message('Action en cours…');
  try { await travail(); }
  catch (erreur) { message(erreurFrancaise(erreur), true); }
  finally { occupe = false; boutonsOccupes(); }
}
async function resultat(requete) {
  const { data, error } = await requete;
  if (error) throw error;
  return data;
}
async function rpc(nom, argumentsRPC = {}) {
  if (!client) throw new Error('Configuration manquante');
  return resultat(client.rpc(nom, argumentsRPC));
}
function element(tag, texte, classe = '') {
  const noeud = document.createElement(tag);
  if (texte !== undefined && texte !== null) noeud.textContent = String(texte);
  if (classe) noeud.className = classe;
  if (texte && /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(String(texte))) noeud.classList.add('arabe');
  return noeud;
}
function bouton(texte, clic, classe = '') {
  const noeud = element('button', texte, classe);
  noeud.type = 'button';
  noeud.disabled = occupe;
  noeud.addEventListener('click', () => action(clic));
  return noeud;
}
function carte(titre, ...paragraphes) {
  const bloc = element('article', null, 'carte');
  bloc.append(element('h3', titre));
  paragraphes.forEach((texte) => bloc.append(element('p', texte, 'texte-libre')));
  return bloc;
}
function nom(id) { return comptes.find((compte) => compte.id === id)?.prenom || 'Compte de la classe'; }
function date(valeur) { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(valeur)); }
function liste(id, lignes, construire) {
  const conteneur = $(id);
  conteneur.replaceChildren();
  if (!lignes.length) conteneur.append(element('p', 'Rien à afficher pour le moment.'));
  else lignes.forEach((ligne) => conteneur.append(construire(ligne)));
}
function selectComptes(id) {
  const champ = $(id);
  const ancien = champ.value;
  champ.replaceChildren(element('option', 'Choisis un prénom'));
  champ.firstChild.value = '';
  comptes.filter((compte) => compte.id !== profil.id).forEach((compte) => {
    const option = element('option', compte.prenom);
    option.value = compte.id;
    champ.append(option);
  });
  if ([...champ.options].some((option) => option.value === ancien)) champ.value = ancien;
}
function montrerPage(nouvellePage) {
  if (profil?.doit_changer_mdp) nouvellePage = 'mot-de-passe';
  else if (!profil) nouvellePage = 'connexion';
  else if (!permissions[nouvellePage]?.includes(profil.role)) nouvellePage = 'accueil';
  page = nouvellePage;
  document.querySelectorAll('[data-page]').forEach((section) => { section.hidden = section.id !== `ecran-${page}`; });
  const pret = profil && !profil.doit_changer_mdp;
  $('navigation').hidden = !pret;
  $('identite').hidden = !profil;
  $('deconnexion').hidden = !profil;
  $('identite').textContent = profil ? `${profil.prenom} · ${nomsRoles[profil.role]}` : '';
  document.querySelectorAll('[data-ecran]').forEach((lien) => {
    lien.hidden = !pret || !permissions[lien.dataset.ecran]?.includes(profil.role);
    if (lien.dataset.ecran === page) lien.setAttribute('aria-current', 'page'); else lien.removeAttribute('aria-current');
  });
  $(`ecran-${page}`).querySelector('h2').focus();
}
async function chargerProfil() {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) { await viderSession(); return; }
  const jeton = generation;
  const nouveauProfil = await resultat(client.from('profiles').select('id,prenom,role,bloque_idees,doit_changer_mdp').eq('id', data.user.id).single());
  if (jeton !== generation) return;
  profil = nouveauProfil;
  if (!profil.doit_changer_mdp) {
    comptes = await rpc('liste_comptes');
    await connecterTchat();
  }
  montrerPage(profil.doit_changer_mdp ? 'mot-de-passe' : 'accueil');
  await actualiserPage();
}
async function viderSession() {
  generation++;
  if (canal) { const ancien = canal; canal = null; await client.removeChannel(ancien); }
  clearTimeout(minuteurTchat);
  profil = null; comptes = []; cadeaux = []; motDePasseProvisoire = '';
  document.querySelectorAll('.liste, .grille').forEach((zone) => zone.replaceChildren());
  document.querySelectorAll('form').forEach((formulaire) => formulaire.reset());
  $('solde').textContent = '—';
  montrerPage('connexion');
}
async function actualiserSolde() { $('solde').textContent = String(await rpc('mon_solde')); }
async function actualiserPage() {
  if (!profil || profil.doit_changer_mdp) return;
  await actualiserSolde();
  if (page === 'historique') await historique();
  if (page === 'envoi') selectComptes('destinataire');
  if (page === 'boutique') await boutique();
  if (page === 'commandes') await commandes(false);
  if (page === 'idees') await idees(false);
  if (page === 'delegue') { selectComptes('eleve-note'); await echanges(); await idees(true); await blocages(); }
  if (page === 'suppleant') { await catalogue(); await commandes(true); }
  if (page === 'tchat') await tchat();
}
// Une mutation réussie reste annoncée comme réussie même si la lecture suivante échoue.
async function apresMutation(texte) {
  try { await actualiserPage(); message(texte); }
  catch { message(`${texte} L’actualisation a échoué ; utilise « Actualiser » ou rouvre cet écran.`, true); }
}
function requeteStable(cle) {
  const nomCle = `classe-requete-${profil.id}-${cle}`;
  let valeur = stockageLire(nomCle, true);
  if (!valeur || !/^[0-9a-f-]{36}$/i.test(valeur)) { valeur = crypto.randomUUID(); stockageEcrire(nomCle, valeur, true); }
  return { id: valeur, terminer: () => stockageEcrire(nomCle, null, true) };
}

async function historique() {
  const lignes = await rpc('mon_historique');
  liste('liste-historique', lignes, (operation) => {
    const bloc = carte(titresTransactions[operation.type]);
    bloc.append(element('p', `${operation.montant >= 0 ? '+' : '−'}${Math.abs(operation.montant)} point(s)`, `points ${operation.montant >= 0 ? 'positif' : 'negatif'}`));
    if (operation.contrepartie_id) bloc.append(element('p', `${operation.type === 'envoi' ? 'Vers' : operation.type === 'reception' ? 'De' : 'Avec'} ${nom(operation.contrepartie_id)}`));
    if (operation.evaluation) bloc.append(element('p', `Évaluation ${operation.evaluation} · saisie par ${nom(operation.operateur_id)}`));
    bloc.append(element('p', date(operation.created_at), 'date'));
    return bloc;
  });
}
async function boutique() {
  cadeaux = await resultat(client.from('gifts').select('*').eq('actif', true).order('nom'));
  liste('liste-cadeaux', cadeaux, (cadeau) => {
    const bloc = carte(cadeau.nom, cadeau.description);
    bloc.append(element('p', `${cadeau.prix} points`, 'points'));
    bloc.append(bouton('Commander', async () => {
      if (!confirm(`Commander « ${cadeau.nom} » ?\nPrix affiché : ${cadeau.prix} points.\nTes points seront retirés définitivement. Le prix appliqué est celui du cadeau au moment de la commande. En cas d’impression ratée, un suppléant pourra te rembourser.`)) { message('Commande non envoyée.'); return; }
      const demande = requeteStable(`commande-${cadeau.id}`);
      await rpc('commander_cadeau', { cadeau_id: cadeau.id, requete: demande.id });
      demande.terminer();
      await apresMutation('Commande enregistrée. Tu peux la suivre dans « Mes commandes ».');
    }));
    return bloc;
  });
}
async function commandes(gestion) {
  let requete = client.from('orders').select('*').order('created_at', { ascending: false });
  if (!gestion) requete = requete.eq('eleve_id', profil.id);
  const lignes = await resultat(requete);
  liste(gestion ? 'gestion-commandes' : 'liste-commandes', lignes, (commande) => {
    const bloc = carte(commande.nom_cadeau, `${commande.prix} points · ${statuts[commande.statut]}`, date(commande.created_at));
    if (gestion) {
      bloc.append(element('p', `Pour ${nom(commande.eleve_id)}`));
      const suivant = commande.statut === 'en_attente' ? 'en_impression' : commande.statut === 'en_impression' ? 'donne' : null;
      if (suivant) bloc.append(bouton(`Marquer : ${statuts[suivant]}`, async () => {
        if (!confirm(`Passer cette commande au statut « ${statuts[suivant]} » ?`)) { message('Statut inchangé.'); return; }
        await rpc('changer_statut_commande', { id: commande.id, statut: suivant });
        await apresMutation('Statut de la commande mis à jour.');
      }));
      if (['en_attente','en_impression'].includes(commande.statut)) bloc.append(bouton('Annuler et rembourser', async () => {
        if (!confirm(`Annuler pour impression ratée et rembourser ${commande.prix} points à ${nom(commande.eleve_id)} ?`)) { message('Commande conservée.'); return; }
        await rpc('annuler_commande', { id: commande.id });
        await apresMutation('Commande annulée et points remboursés.');
      }, 'danger'));
    }
    return bloc;
  });
}
async function idees(gestion) {
  if (!gestion) {
    const etat = await resultat(client.from('profiles').select('bloque_idees').eq('id', profil.id).single());
    profil.bloque_idees = etat.bloque_idees;
    $('blocage-idees').hidden = !profil.bloque_idees;
    $('form-idee').hidden = profil.bloque_idees;
  }
  let requete = client.from('ideas').select('*').order('created_at', { ascending: false });
  if (!gestion) requete = requete.eq('auteur_id', profil.id);
  const lignes = await resultat(requete);
  liste(gestion ? 'boite-idees' : 'liste-idees', lignes, (idee) => {
    const bloc = carte(gestion ? `Idée de ${nom(idee.auteur_id)}` : 'Mon idée', idee.texte, `${statuts[idee.statut]} · ${date(idee.created_at)}`);
    if (idee.reponse) bloc.append(element('p', `Réponse : ${idee.reponse}`, 'texte-libre'));
    if (gestion && idee.statut === 'en_attente') {
      const formulaire = element('form');
      const statut = element('select'); statut.id = `statut-${idee.id}`;
      [['acceptee','Acceptée'],['refusee','Refusée']].forEach(([valeur, texte]) => { const option = element('option', texte); option.value = valeur; statut.append(option); });
      const libelleStatut = element('label', 'Décision'); libelleStatut.htmlFor = statut.id;
      const reponse = element('textarea'); reponse.required = true; reponse.maxLength = 1000; reponse.rows = 3; reponse.id = `reponse-${idee.id}`;
      const libelleReponse = element('label', 'Petit message de réponse'); libelleReponse.htmlFor = reponse.id;
      const valider = element('button', 'Envoyer la réponse'); valider.type = 'submit'; valider.disabled = occupe;
      formulaire.append(libelleStatut, statut, libelleReponse, reponse, valider);
      formulaire.addEventListener('submit', (evenement) => {
        evenement.preventDefault();
        action(async () => {
          await rpc('repondre_idee', { id: idee.id, statut: statut.value, reponse: reponse.value.trim() });
          await apresMutation('Réponse enregistrée.');
        });
      });
      bloc.append(formulaire);
    }
    return bloc;
  });
}
async function blocages() {
  const lignes = await rpc('liste_blocages');
  liste('liste-blocages', lignes, (compte) => {
    const bloc = carte(compte.prenom, compte.bloque_idees ? 'Idées bloquées' : 'Idées autorisées');
    bloc.append(bouton(compte.bloque_idees ? 'Débloquer les idées' : 'Bloquer les idées', async () => {
      if (!confirm(`${compte.bloque_idees ? 'Débloquer' : 'Bloquer'} les idées de ${compte.prenom} ?`)) { message('Blocage inchangé.'); return; }
      await rpc('bloquer_eleve', { id: compte.id, bloque: !compte.bloque_idees });
      await apresMutation('Autorisation d’envoi d’idées mise à jour.');
    }, compte.bloque_idees ? 'secondaire' : 'danger'));
    return bloc;
  });
}
async function echanges() {
  const lignes = await rpc('toutes_les_transactions');
  const annules = new Set(lignes.filter((ligne) => ligne.annule_transaction_id).map((ligne) => ligne.annule_transaction_id));
  liste('liste-echanges', lignes.filter((ligne) => ligne.type === 'envoi'), (echange) => {
    const bloc = carte(`${nom(echange.compte_id)} → ${nom(echange.contrepartie_id)}`, `${Math.abs(echange.montant)} point(s)`, date(echange.created_at));
    if (annules.has(echange.id)) bloc.append(element('p', 'Échange annulé (opérations inverses enregistrées).'));
    else bloc.append(bouton('Annuler cet échange', async () => {
      if (!confirm('Annuler cet échange suspect ? Le destinataire doit encore avoir assez de points.')) { message('Échange conservé.'); return; }
      await rpc('annuler_echange', { id: echange.echange_id });
      await apresMutation('Échange annulé sans effacer l’historique.');
    }, 'danger'));
    return bloc;
  });
}
function nouveauCadeau() {
  $('form-cadeau').reset(); $('cadeau-id').value = ''; $('titre-cadeau').textContent = 'Ajouter un cadeau';
}
async function catalogue() {
  cadeaux = await resultat(client.from('gifts').select('*').order('nom'));
  liste('gestion-cadeaux', cadeaux, (cadeau) => {
    const bloc = carte(cadeau.nom, cadeau.description, `${cadeau.prix} points · ${cadeau.actif ? 'Disponible' : 'Désactivé'}`);
    bloc.append(bouton('Modifier', async () => {
      $('cadeau-id').value = cadeau.id; $('cadeau-nom').value = cadeau.nom; $('cadeau-description').value = cadeau.description;
      $('cadeau-prix').value = cadeau.prix; $('cadeau-actif').checked = cadeau.actif;
      $('titre-cadeau').textContent = 'Modifier un cadeau'; $('cadeau-nom').focus(); message('Modifie le cadeau puis clique sur « Enregistrer ».');
    }, 'secondaire'));
    bloc.append(bouton(cadeau.actif ? 'Désactiver' : 'Réactiver', async () => {
      if (!confirm(`${cadeau.actif ? 'Désactiver' : 'Réactiver'} « ${cadeau.nom} » ?`)) { message('Cadeau inchangé.'); return; }
      await rpc('enregistrer_cadeau', { cadeau_id: cadeau.id, nom: cadeau.nom, description: cadeau.description, prix: cadeau.prix, actif: !cadeau.actif });
      await apresMutation('Disponibilité du cadeau mise à jour.');
    }, 'secondaire'));
    return bloc;
  });
}
async function tchat() {
  const utilisateur = profil?.id;
  const lignes = await resultat(client.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(100));
  if (!profil || profil.id !== utilisateur || !['delegue','suppleant'].includes(profil.role)) return;
  liste('liste-tchat', lignes.reverse(), (entree) => carte(nom(entree.auteur_id), entree.texte, date(entree.created_at)));
}
async function connecterTchat() {
  if (canal || !['delegue','suppleant'].includes(profil.role)) return;
  canal = client.channel(`equipe-${profil.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => {
      if (page !== 'tchat') return;
      clearTimeout(minuteurTchat);
      minuteurTchat = setTimeout(() => { tchat().catch(() => { $('etat-tchat').textContent = 'Actualisation interrompue. Utilise le bouton Actualiser.'; }); }, 120);
    })
    .subscribe((etat) => {
      $('etat-tchat').textContent = etat === 'SUBSCRIBED' ? 'Temps réel connecté · les 100 derniers messages sont affichés.' : 'Temps réel en reconnexion… Tu peux utiliser Actualiser.';
      // Rattraper les messages manqués pendant une coupure réseau.
      if (etat === 'SUBSCRIBED' && page === 'tchat') tchat().catch(() => { $('etat-tchat').textContent = 'Lecture interrompue : utilise Actualiser.'; });
    });
}
function calculerPoints(note, type) {
  const maximum = type === 'sommative' ? 20 : 10;
  if (!Number.isFinite(note) || note < 0 || note > maximum) return null;
  const arrondie = Math.round((note + Number.EPSILON) * 10) / 10;
  if (type === 'formative') return arrondie >= 9 ? 1 : 0;
  return arrondie >= 19.5 ? 3 : arrondie >= 18.5 ? 2 : arrondie >= 17 ? 1 : 0;
}
function apercuNote() {
  $('note').max = $('type-note').value === 'sommative' ? '20' : '10';
  const points = $('note').value === '' ? null : calculerPoints(Number($('note').value), $('type-note').value);
  $('apercu-points').textContent = points === null ? 'Points calculés : — (note vide ou hors limites)' : `Points calculés : ${points} point(s). La note ne sera pas stockée.`;
}
$('note').addEventListener('input', apercuNote);
$('type-note').addEventListener('change', apercuNote);

function formulaire(id, travail) {
  $(id).addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    action(travail);
  });
}
formulaire('form-connexion', async () => {
  const identifiant = normaliserPrenom($('prenom-connexion').value);
  if (!identifiant) { message('Écris le prénom d’affichage fourni par le professeur.', true); return; }
  motDePasseProvisoire = $('mdp-connexion').value;
  await resultat(client.auth.signInWithPassword({ email: `${identifiant}@classe.local`, password: motDePasseProvisoire }));
  $('mdp-connexion').value = '';
  await chargerProfil();
  if (!profil.doit_changer_mdp) motDePasseProvisoire = '';
  message(profil.doit_changer_mdp ? 'Change ton mot de passe provisoire pour continuer.' : 'Connexion réussie.');
});
formulaire('form-mot-de-passe', async () => {
  const nouveau = $('nouveau-mdp').value;
  if (nouveau.length < 12 || nouveau !== $('confirmation-mdp').value || nouveau === motDePasseProvisoire) {
    message('Utilise au moins 12 caractères, un mot de passe différent du provisoire, et répète-le à l’identique.', true); return;
  }
  await resultat(client.auth.updateUser({ password: nouveau }));
  await rpc('confirmer_changement_mdp');
  $('form-mot-de-passe').reset(); motDePasseProvisoire = '';
  await chargerProfil(); message('Ton mot de passe personnel est enregistré.');
});
formulaire('form-envoi', async () => {
  const destinataire = $('destinataire').value;
  const montant = Number($('montant').value);
  if (!destinataire || destinataire === profil.id || !Number.isInteger(montant) || montant < 1 || montant > 1000000) { message('Choisis un autre compte et un montant entier entre 1 et 1 000 000.', true); return; }
  if (!confirm(`Envoyer ${montant} point(s) à ${nom(destinataire)} ?`)) { message('Envoi non effectué.'); return; }
  const demande = requeteStable(`envoi-${destinataire}-${montant}`);
  await rpc('envoyer_points', { destinataire, montant, requete: demande.id });
  demande.terminer(); $('form-envoi').reset();
  await apresMutation('Points envoyés.');
});
formulaire('form-note', async () => {
  const note = Number($('note').value); const type = $('type-note').value;
  const points = calculerPoints(note, type);
  if ($('note').value === '' || points === null) { message('La note est hors des limites autorisées.', true); return; }
  if (!confirm(`Attribuer ${points} point(s) à ${nom($('eleve-note').value)} ? La note ne sera pas conservée.`)) { message('Note non saisie.'); return; }
  const attribues = await rpc('saisir_note', { eleve: $('eleve-note').value, type, note });
  $('note').value = ''; apercuNote();
  await apresMutation(`${attribues} point(s) attribué(s). La note n’a pas été conservée.`);
});
formulaire('form-idee', async () => {
  await rpc('envoyer_idee', { texte: $('texte-idee').value.trim() });
  $('form-idee').reset(); await apresMutation('Ton idée signée a été envoyée aux délégués.');
});
formulaire('form-cadeau', async () => {
  const prix = Number($('cadeau-prix').value);
  if (!Number.isInteger(prix) || prix < 1 || prix > 1000000) { message('Le prix doit être un entier entre 1 et 1 000 000.', true); return; }
  await rpc('enregistrer_cadeau', { cadeau_id: $('cadeau-id').value || null, nom: $('cadeau-nom').value.trim(), description: $('cadeau-description').value.trim(), prix, actif: $('cadeau-actif').checked });
  nouveauCadeau(); await apresMutation('Cadeau enregistré.');
});
$('nouveau-cadeau').addEventListener('click', nouveauCadeau);
formulaire('form-tchat', async () => {
  await rpc('envoyer_message_tchat', { texte: $('texte-tchat').value.trim() });
  $('form-tchat').reset(); await apresMutation('Message envoyé.');
});
document.querySelectorAll('[data-ecran]').forEach((lien) => lien.addEventListener('click', () => action(async () => {
  montrerPage(lien.dataset.ecran); await actualiserPage(); message('');
})));
document.querySelectorAll('[data-actualiser]').forEach((lien) => lien.addEventListener('click', () => action(async () => { await actualiserPage(); message('Données actualisées.'); })));
$('deconnexion').addEventListener('click', () => action(async () => {
  // scope local supprime la session de cet appareil sans déconnecter les autres.
  await resultat(client.auth.signOut({ scope: 'local' }));
  await viderSession(); message('Tu es déconnecté.');
}));

async function demarrer() {
  if (SUPABASE_URL.includes('VOTRE-') || SUPABASE_ANON_KEY.includes('VOTRE-')) {
    $('form-connexion').querySelector('button').dataset.indisponible = 'true'; boutonsOccupes();
    message('Le site attend sa configuration. Remplis config.js avec l’URL Supabase et la clé publique anon.', true);
    return;
  }
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  // Ne pas appeler une méthode Auth depuis son propre callback (risque de blocage).
  client.auth.onAuthStateChange((evenement) => {
    if (evenement === 'SIGNED_OUT') setTimeout(() => { viderSession().catch(() => {}); }, 0);
  });
  await action(async () => {
    const { session } = await resultat(client.auth.getSession());
    if (session) await chargerProfil();
    message('');
  });
}
demarrer().catch((erreur) => message(erreurFrancaise(erreur), true));
