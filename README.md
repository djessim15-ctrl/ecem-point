# Les points de notre classe

Site statique, en français, pensé pour téléphone, pour **18 comptes : 2 délégués, 2 suppléants et 14 élèves**. HTML, CSS et JavaScript natif en modules ES ; aucune compilation, aucun framework. Supabase héberge les données, Auth, les règles de sécurité et le tchat Realtime.

**Obtenir l’accord du CPE / du professeur avant d’inscrire les élèves.** Le responsable du projet conserve les identifiants administrateur ; les élèves ne reçoivent jamais la clé `service_role`.

## Fichiers complets

Dans l’ordre de livraison :

1. `schema.sql` — script SQL unique pour un projet Supabase neuf et dédié.
2. `config.js` — URL Supabase et clé publique `anon` uniquement.
3. `index.html` — tous les écrans, affichés selon le rôle.
4. `style.css` — interface mobile accessible et contrastée.
5. `app.js` — interface, connexion, RPC et tchat temps réel.
6. `creer_comptes.js` — script Node local de provisionnement, ignoré par Git.
7. `comptes.csv` — modèle de 18 comptes, ignoré par Git.
8. `README.md` — ce guide.

Un fichier supplémentaire, `.gitignore`, exclut les outils locaux et les fichiers de secrets.

Les fichiers locaux ignorés existent dans le dossier livré mais **n’apparaîtront pas dans un clone GitHub** : télécharge-les et garde-les sur l’ordinateur du professeur avant de publier. Aucun mot de passe réel n’est livré dans le modèle.

## Branchement, dans cet ordre

### 1. Créer le projet Supabase

- Crée un projet Supabase **dédié à cette classe**, dans une région Europe.
- Note son URL de projet, sa clé publique legacy `anon` et sa clé secrète legacy `service_role` depuis les paramètres API du projet.
- Conserve la clé `service_role` dans ton gestionnaire de mots de passe, jamais dans GitHub, dans `config.js`, dans un navigateur ou dans une conversation.
- Ne réutilise pas un projet contenant déjà des utilisateurs ou des tables d’une autre application.

Le script utilise la clé JWT legacy `service_role`, pas une clé `anon` ni une clé `sb_publishable_…`. Le site utilise la clé publique legacy `anon`. Les mots « legacy » désignent ici le format des clés dans les paramètres Supabase, pas une bibliothèque obsolète.

### 2. Régler Authentication

- Dans **Authentication → configuration des fournisseurs → Email**, désactive les nouvelles inscriptions publiques.
- Désactive la confirmation d’email, puisque les adresses fictives ne reçoivent pas de courrier.
- Conserve la connexion par email et mot de passe active.
- Désactive les autres fournisseurs, la connexion anonyme, les liens magiques et les connexions par téléphone si ces options sont activées.
- Fixe la longueur minimale des mots de passe à **12 caractères** dans les paramètres de sécurité Auth.

Les emplacements exacts peuvent varier dans le tableau de bord ; l’objectif est de permettre uniquement les 18 comptes créés par l’API admin. Le script confirme aussi explicitement chaque email.

### 3. Installer la base

- Ouvre **SQL Editor**, colle tout `schema.sql` et exécute-le une seule fois.
- Vérifie que l’exécution se termine sans erreur.
- Vérifie que les six tables publiques ont RLS activée.
- Vérifie que seule `chat_messages` appartient à la publication `supabase_realtime`.

Le script est atomique (`BEGIN` / `COMMIT`) et **n’est pas une migration réexécutable** : ne le relance pas sur une base déjà installée. Il retire les autres tables de la publication Realtime, raison supplémentaire d’utiliser un projet dédié. La table privée d’empreintes de mots de passe n’est pas exposée par l’API.

### 4. Remplir les 18 comptes

- Remplace les 18 prénoms du modèle `comptes.csv` par des prénoms d’affichage uniques.
- Garde exactement deux rôles `delegue`, deux rôles `suppleant` et quatorze rôles `eleve`.
- Remplace chaque valeur `A_REMPLACER_…` par un mot de passe provisoire unique et aléatoire de 12 à 128 caractères.
- Enregistre le CSV en UTF-8, avec des virgules comme séparateurs.

En-tête obligatoire : `prenom,role,mot_de_passe_provisoire`.

Les identifiants sont normalisés de la même manière dans le script et dans le site : accents supprimés, minuscules, lettres latines et chiffres conservés, espaces et ponctuation retirés. `Élise` devient `elise@classe.local` ; `Lina M` devient `linam@classe.local`. L’email technique n’est jamais affiché dans l’interface. Deux prénoms ayant le même identifiant normalisé sont refusés **avant toute création**. Ajoute une lettre distinctive ; n’utilise pas de nom de famille complet. Pour un prénom uniquement arabe, utilise un prénom d’affichage accompagné d’un alias latin distinctif ; les idées et les messages peuvent librement être en arabe et s’affichent plus grands.

Les champs contenant une virgule doivent être entourés de guillemets doubles ; un guillemet à l’intérieur d’un champ s’écrit `""`. Évite les retours à la ligne dans les prénoms et les mots de passe.

### 5. Créer les comptes sur ton ordinateur

- Installe **Node 22 ou ultérieur** sur ton ordinateur.
- Place `creer_comptes.js` et ton `comptes.csv` dans un dossier local privé.
- Ouvre un terminal dans ce dossier et définis les deux variables d’environnement.

**macOS / Linux, avec Bash :**

```bash
export SUPABASE_URL='https://VOTRE-PROJET.supabase.co'
read -r -s -p 'Clé secrète service_role : ' SUPABASE_SERVICE_ROLE_KEY
printf '\n'
export SUPABASE_SERVICE_ROLE_KEY
node creer_comptes.js
unset SUPABASE_SERVICE_ROLE_KEY
```

La saisie avec `read -s` évite de mettre la clé dans l’historique du terminal. Ne colle pas directement la clé dans une commande enregistrée.

**Windows PowerShell :**

```powershell
$env:SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co'
$secret = Read-Host 'Clé secrète service_role' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
node creer_comptes.js
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
$secret = $null
```

- Vérifie que le terminal indique que les 18 comptes sont prêts.
- Distribue individuellement chaque prénom d’affichage et chaque mot de passe provisoire.
- Ferme le terminal après avoir retiré la variable secrète.
- Supprime le CSV contenant les mots de passe quand la distribution et le changement des mots de passe sont terminés, ou conserve-le seulement dans un stockage chiffré autorisé par l’établissement.

Aucun `npm install` n’est nécessaire : le script utilise les API REST Supabase avec `fetch` natif. Il valide tout le CSV avant d’écrire. En cas d’interruption, relancer **le même script avec le même CSV** complète les comptes manquants sans réinitialiser les mots de passe ni modifier les rôles existants. Un profil incompatible ou un compte étranger à la classe provoque l’arrêt. Une création Auth et une insertion Postgres sont deux opérations distinctes ; cette reprise couvre une interruption entre les deux.

### 6. Brancher le site

- Remplis `SUPABASE_URL` dans `config.js` avec l’URL du projet.
- Remplis `SUPABASE_ANON_KEY` avec la clé publique `anon`, et seulement celle-là.

```js
export const SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
export const SUPABASE_ANON_KEY = 'VOTRE-CLE-ANON-PUBLIQUE';
```

La clé `anon` sera visible par tous : c’est prévu et sûr **uniquement avec les règles SQL installées**. `app.js` charge supabase-js depuis jsDelivr en version **exactement 2.57.4**, avec l’URL ESM `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm` : le lien `@2` demandé désigne une version flottante, alors que cette URL fixe réellement la version. Aucune compilation n’est nécessaire.

### 7. Tester en local

- Prépare un sous-dossier nommé `site-public` contenant uniquement `index.html`, `style.css`, `app.js` et `config.js` remplis.
- Depuis un terminal dans `site-public`, lance `python -m http.server 8000 --bind 127.0.0.1` avec Python 3 installé.
- Ouvre `http://localhost:8000` dans ton navigateur.
- Connecte-toi avec un prénom d’affichage et son mot de passe provisoire.
- Choisis le mot de passe personnel demandé avant d’utiliser les points.

Ne double-clique pas sur `index.html` : les modules ES nécessitent HTTP. Le dossier public séparé évite d’exposer accidentellement le CSV ou le script local par le serveur. Si Python n’est pas disponible, utilise `npx --yes http-server@14.1.1 . -p 8000 -a 127.0.0.1 -c-1` dans ce même dossier ; il s’agit d’un serveur de fichiers, pas d’un outil de build. Une connexion Internet est nécessaire pour le CDN et Supabase.

### 8. Publier sans les fichiers privés

**Le plus simple ici : GitHub Pages**, puisque le site n’a besoin ni de serveur applicatif ni de compilation.

- Conserve `.gitignore` à la racine du dépôt avant d’y copier des données réelles.
- Vérifie avec `git check-ignore creer_comptes.js comptes.csv` que les deux fichiers locaux sont ignorés.
- Vérifie avec `git ls-files creer_comptes.js comptes.csv` que la commande ne retourne aucun fichier suivi.
- Vérifie que `config.js` contient uniquement l’URL et la clé publique `anon`.
- Ajoute les fichiers publics, `schema.sql`, `README.md` et `.gitignore` à ton dépôt GitHub, puis pousse ton travail.
- Ouvre **Settings → Pages → Deploy from a branch** dans GitHub.
- Choisis la branche contenant le site et le dossier `/ (root)` puis enregistre.
- Attends le déploiement et ouvre l’adresse HTTPS indiquée par GitHub Pages.

Dans ce dépôt, le travail est sur `arena/d9a47029-ecem-point` ; publie depuis cette branche ou fais intégrer le travail par une pull request. Les chemins relatifs du site fonctionnent aussi sous `https://compte.github.io/nom-du-depot/`.

**Alternative Netlify :** dépose seulement le contenu de `site-public` dans le déploiement manuel de Netlify ; aucun champ de commande de build n’est nécessaire.

**Alternative Vercel :** importe un dépôt ne contenant que les fichiers publics, choisis le préréglage « Other », aucune commande de build et le dossier racine comme sortie statique.

Un `.gitignore` ne retire pas un secret déjà suivi ou présent dans l’historique : si cela arrive, révoque immédiatement la clé concernée dans Supabase et nettoie l’historique. Ne publie jamais les vrais mots de passe, même provisoires.

### 9. Régler l’adresse publique dans Auth

- Dans **Authentication → URL Configuration**, renseigne l’adresse publique HTTPS du site comme **Site URL**.
- Ajoute cette même adresse, avec son chemin GitHub Pages éventuel, aux URL de redirection autorisées.
- Ajoute `http://localhost:8000` aux URL autorisées pour les essais locaux.
- Évite les autorisations larges avec des jokers pour des domaines qui ne t’appartiennent pas.

La connexion utilisée n’envoie pas d’email et n’a pas besoin d’un lien de redirection ; ces réglages gardent néanmoins Auth cohérent avec le site publié. La CSP de la page autorise les projets hébergés sous `supabase.co` ; un domaine Supabase personnalisé nécessiterait d’adapter cette CSP.

### 10. Effectuer les tests ci-dessous

- Effectue les tests de rôles, de soldes et de temps réel avant l’ouverture à la classe.
- Effectue les tests d’accessibilité sur téléphone et sur un écran d’ordinateur.
- Informe les élèves que leurs idées sont signées et que les délégués voient les échanges.

## Tests à faire dans le navigateur

Utilise des profils de navigateur séparés ou une fenêtre normale et une fenêtre privée pour ne pas mélanger les comptes. Les tests produisent des opérations réelles et **immuables** : réalise-les idéalement dans un projet de recette avec 18 comptes fictifs, puis installe un projet de production neuf. On ne « remet pas à zéro » le journal en supprimant ses lignes.

### A. Paliers et absence de stockage des notes

Dans l’espace délégué, sélectionne un autre compte et observe le calcul avant validation :

| Type | Note | Points |
| --- | ---: | ---: |
| Sommative | 16,9 | 0 |
| Sommative | 17 | 1 |
| Sommative | 18,4 | 1 |
| Sommative | 18,5 | 2 |
| Sommative | 19,4 | 2 |
| Sommative | 19,5 | 3 |
| Sommative | 20 | 3 |
| Formative | 8,9 | 0 |
| Formative | 9 | 1 |
| Formative | 10 | 1 |

- Vérifie aussi que 18,45 en sommative donne 2 points après arrondi à 18,5.
- Vérifie que −0,1, 20,01 en sommative et 10,01 en formative sont refusés, même si l’arrondi semblerait les ramener dans les limites.
- Vérifie qu’un gain de 0 point figure dans l’historique sans modifier le solde.
- Vérifie dans `transactions` que la note brute n’existe pas et que le type d’évaluation, les points, la date et l’auteur de saisie sont présents.

Le palier 19,5 donne 3 points, **jamais 6**.

### B. Première connexion obligatoire

- Connecte-toi avec un compte neuf et vérifie que seul le changement de mot de passe est accessible.
- Avant le changement, appelle `confirmer_changement_mdp` depuis la console et vérifie le refus.
- Avant le changement, appelle `mon_solde` et vérifie le refus.
- Change le mot de passe avec le formulaire, puis vérifie que l’accueil devient accessible.
- Déconnecte-toi et vérifie que le mot de passe personnel fonctionne.

### C. Préparer les tests de sécurité depuis la console

Dans la console du navigateur **déjà connecté**, crée un client avec la même bibliothèque et la même session locale :

```js
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./config.js');
const testSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const utilisateurTest = (await testSupabase.auth.getUser()).data.user.id;
const comptesTest = (await testSupabase.rpc('liste_comptes')).data;
const autreTest = comptesTest.find(c => c.id !== utilisateurTest).id;
```

`testSupabase` est seulement un outil de recette local ; l’application n’expose pas son client sur `window`. Inspecte les champs `data` et `error` de chaque résultat : **un SELECT interdit par RLS renvoie généralement une liste vide, pas une erreur**, alors qu’une écriture sans privilège ou une RPC refusée renvoie une erreur. Une liste vide est bien un refus de divulguer les données.

### D. Un délégué ne peut pas saisir sa propre note

Connecté comme délégué :

```js
await testSupabase.rpc('saisir_note', {
  eleve: utilisateurTest, type: 'sommative', note: 20
});
```

Attendu : erreur française indiquant que l’autre délégué doit le faire ; aucun gain créé. Son propre prénom n’apparaît pas non plus dans la liste de saisie.

### E. Tentatives d’un élève hostile

Connecté comme élève **après changement du mot de passe**, exécute :

```js
// Points d'un autre : aucune ligne divulguée.
await testSupabase.from('transactions').select('*').eq('compte_id', autreTest);
// Historique global : refus.
await testSupabase.rpc('toutes_les_transactions');
// Saisir une note : refus.
await testSupabase.rpc('saisir_note', { eleve: autreTest, type: 'sommative', note: 20 });
// Idées d'un autre : aucune ligne divulguée.
await testSupabase.from('ideas').select('*').eq('auteur_id', autreTest);
// Trop de points : refus, aucun changement de solde.
const soldeTest = Number((await testSupabase.rpc('mon_solde')).data);
await testSupabase.rpc('envoyer_points', { destinataire: autreTest, montant: soldeTest + 1 });
// Envoi à soi-même : refus.
await testSupabase.rpc('envoyer_points', { destinataire: utilisateurTest, montant: 1 });
// Tchat : aucune ligne, même s'il contient déjà des messages de l'équipe.
await testSupabase.from('chat_messages').select('*');
// Écrire dans le tchat : refus.
await testSupabase.rpc('envoyer_message_tchat', { texte: 'Essai interdit' });
// Modifier son rôle ou le booléen de changement de mot de passe : refus.
await testSupabase.from('profiles').update({ role: 'delegue', doit_changer_mdp: false }).eq('id', utilisateurTest);
// Crédit arbitraire dans le journal : refus.
await testSupabase.from('transactions').insert({ compte_id: utilisateurTest, type: 'reception', montant: 999, operateur_id: utilisateurTest });
// Réécrire ou effacer son historique : refus.
await testSupabase.from('transactions').update({ montant: 999 }).eq('compte_id', utilisateurTest);
await testSupabase.from('transactions').delete().eq('compte_id', utilisateurTest);
// Commande sans passer par la fonction : refus.
await testSupabase.from('orders').insert({ eleve_id: utilisateurTest });
// Modifier directement une décision : refus.
await testSupabase.from('ideas').update({ statut: 'acceptee' }).eq('auteur_id', utilisateurTest);
// Gestion de la boutique : refus.
await testSupabase.rpc('enregistrer_cadeau', { nom: 'Interdit', description: '', prix: 1, actif: true });
// Annulation d'échange : refus de rôle avant toute recherche d'identifiant.
await testSupabase.rpc('annuler_echange', { id: crypto.randomUUID() });
```

Vérifie aussi qu’un suppléant ne peut ni saisir de note ni lire les idées des autres, et qu’un délégué ne peut ni gérer les cadeaux ni envoyer d’idée. L’équipe peut utiliser le tchat. Un visiteur non connecté n’a accès à aucune donnée de la classe.

### F. Double commande et double dépense

- Fais attribuer exactement le prix d’un cadeau à un compte de test.
- Clique deux fois rapidement sur « Commander » puis confirme ; le bouton doit être désactivé pendant l’appel et une seule commande doit apparaître.
- Prépare ensuite le même solde et le même cadeau, et simule deux demandes réellement concurrentes depuis la console :

```js
const cadeauTest = (await testSupabase.from('gifts').select('id').eq('actif', true)).data[0].id;
await Promise.all([
  testSupabase.rpc('commander_cadeau', { cadeau_id: cadeauTest, requete: crypto.randomUUID() }),
  testSupabase.rpc('commander_cadeau', { cadeau_id: cadeauTest, requete: crypto.randomUUID() })
]);
```

Attendu, avec exactement le prix en solde : **une réussite, un refus de solde, une dépense, une commande**. Si tu réutilises le même UUID de `requete` pour les deux appels, les deux réponses désignent la même commande, sans second débit. Le verrou serveur protège aussi deux onglets et un navigateur hostile, pas seulement les boutons de l’interface. Fais le même essai avec deux envois dépassant ensemble le solde : il ne doit jamais devenir négatif.

### G. Annuler un échange après une dépense

- Fais envoyer 3 points du compte A au compte B.
- Fais dépenser ces 3 points par B en commandant un cadeau.
- Depuis un compte délégué, tente d’annuler l’échange.
- Vérifie le message « le destinataire n’a plus assez de points » et l’absence d’opérations inverses.
- Après remboursement ou nouveau gain de B, annule l’échange et vérifie les deux opérations inverses.
- Tente de l’annuler une seconde fois et vérifie le refus.

### H. Commandes, prix figé et remboursement unique

- Commande un cadeau puis modifie son prix depuis un compte suppléant.
- Vérifie que l’ancienne commande garde son nom et son prix au moment de l’achat.
- Passe une commande de « en attente » à « en cours d’impression » puis à « donné ».
- Tente le retour en arrière et le saut direct de « en attente » à « donné » depuis la console ; les deux doivent être refusés.
- Annule une autre commande en attente ou en impression et vérifie un seul remboursement du prix payé.
- Depuis la console d’un suppléant, rappelle `annuler_commande` avec le même identifiant et vérifie le refus et l’absence de second remboursement.
- Vérifie qu’une commande déjà donnée ne peut plus être annulée.
- Désactive un cadeau et vérifie qu’il disparaît de la boutique sans effacer les anciennes commandes.

### I. Idées et blocage

- Envoie une idée comme élève et vérifie qu’un autre élève ne la voit pas.
- Accepte ou refuse cette idée comme délégué avec un petit message, puis vérifie la réponse depuis le compte auteur.
- Bloque l’auteur et vérifie son message de blocage et le refus de `envoyer_idee`, même depuis la console.
- Débloque l’auteur et vérifie qu’il peut à nouveau proposer une idée.
- Vérifie que le délégué n’a pas de formulaire d’envoi d’idée.

### J. Tchat privé et injection de code

- Ouvre les comptes d’un délégué et d’un suppléant dans deux profils de navigateur et vérifie l’arrivée automatique des messages.
- Coupe puis rétablis le réseau et vérifie la reconnexion ou le fonctionnement du bouton Actualiser.
- Vérifie qu’un élève ne dispose d’aucun écran ni d’aucune donnée du tchat.
- Envoie le texte `<img src=x onerror=alert(1)>` dans une idée ou le tchat et vérifie qu’il apparaît comme texte sans aucune exécution.

### K. Accessibilité

- Vérifie les écrans à une largeur de 320 px et en zoom navigateur de 200 %.
- Navigue au clavier avec Tab, Entrée et le lien « Aller au contenu ».
- Vérifie que les champs ont des labels et que les erreurs sont annoncées par un lecteur d’écran.
- Clique sur « Texte plus gros », recharge la page et vérifie la mémorisation.
- Clique sur « Texte plus petit » et vérifie que la taille de base ne descend jamais sous 20 px.
- Vérifie que les boutons mesurent au moins 52 px de haut et que le solde est très grand.
- Envoie un message arabe, par exemple `فكرة جميلة`, et vérifie son affichage agrandi.

## Architecture et garanties

- Le solde est uniquement la somme du journal ; aucun solde modifiable n’est stocké dans `profiles`.
- `transactions` est append-only : aucune écriture directe du navigateur et un déclencheur bloque UPDATE, DELETE et TRUNCATE, même lors d’une écriture privilégiée normale.
- Les RPC sensibles sont `SECURITY DEFINER`, fixent `search_path = public, pg_temp` et vérifient `auth.uid()`, le compte, le mot de passe initial et le rôle.
- Chaque débit verrouille d’abord le compte avec `FOR UPDATE` ; les échanges verrouillent les deux comptes dans l’ordre de leurs UUID pour éviter les interblocages.
- Une RPC SQL constitue une seule transaction ; une exception annule toutes ses écritures.
- Les achats et les envois acceptent un UUID de demande pour rendre une répétition identique idempotente.
- Les annulations ajoutent des opérations inverses ; des contraintes uniques interdisent un second remboursement ou une seconde inversion.
- Un blocage d’idées utilise le même verrou de compte que l’envoi d’idée pour éviter un contournement concurrent.
- Les rôles et le booléen du mot de passe ne sont jamais modifiables par `anon` ou `authenticated`.
- Le booléen du premier mot de passe ne peut passer à faux qu’après une modification effective de l’empreinte dans Supabase Auth, vérifiée côté serveur contre une empreinte initiale conservée en schéma privé puis supprimée après validation.
- Les autres comptes ne sont présentés que par identifiant et prénom, via `liste_comptes` ; seuls les délégués reçoivent en plus l’état de blocage via `liste_blocages`.
- Les idées, prénoms et messages sont rendus avec `textContent`, jamais avec `innerHTML`.
- Le navigateur mémorise la taille du texte, la session Auth et des UUID de demandes en attente ; il ne mémorise pas un rôle faisant autorité, les notes ni les mots de passe saisis.
- Realtime est activé uniquement pour le tchat et sa lecture reste soumise à RLS.

### RPC disponibles

`mon_solde`, `mon_historique`, `saisir_note`, `envoyer_points`, `annuler_echange`, `commander_cadeau`, `changer_statut_commande`, `annuler_commande`, `envoyer_idee`, `repondre_idee`, `bloquer_eleve`, `liste_comptes`, `envoyer_message_tchat`, `toutes_les_transactions`, plus `enregistrer_cadeau`, `liste_blocages`, `confirmer_changement_mdp` et le prédicat RLS `role_actif`.

La saisie d’une note conserve une opération de gain même pour 0 point. L’historique affiche toutes les opérations personnelles, y compris les inversions d’échanges.

## Choix que j’ai faits

1. Un projet Supabase neuf et dédié, sans réexécution destructive du schéma.
2. Une version CDN exacte plutôt que le lien flottant `@2`.
3. Un mot de passe de 12 caractères minimum, à régler aussi dans Auth pour que le navigateur ne soit pas l’autorité.
4. Des comptes accessibles après changement de mot de passe uniquement, avec vérification serveur de l’empreinte Auth et aucune confiance dans une simple confirmation du navigateur.
5. Aucun accès direct en écriture aux tables, même pour les cadeaux et le tchat : toutes les écritures passent par des RPC vérifiées.
6. Un cadeau déjà donné n’est plus annulable ; seuls l’attente et l’impression peuvent être annulées pour impression ratée.
7. Une idée reçoit une seule décision définitive et un message non vide ; aucune édition silencieuse d’une réponse déjà reçue.
8. Les suppléants peuvent aussi être bloqués pour leurs idées, puisqu’ils utilisent la même boîte que les élèves.
9. Les gains de 0 point sont conservés, mais les notes ne le sont jamais.
10. Des montants et prix entiers de 1 à 1 000 000, avec le solde calculé en bigint.
11. Une taille de base de 20 à 32 px, mémorisée par appareil, avec les textes arabes encore agrandis.
12. Le nom et le prix d’un cadeau sont copiés à l’achat pour préserver l’historique si le catalogue change.
13. Les comptes et demandes répétées sont protégés contre les doublons ; une commande et son débit restent atomiques.
14. Le tchat affiche les 100 derniers messages, sans classement des élèves ni notifications révélant un solde.
15. Les délégués lisent tous les échanges et peuvent accéder au journal global comme demandé ; les élèves et suppléants ne lisent que leur journal personnel.
16. Les fichiers de provisionnement restent locaux et ignorés par Git, et le serveur local ne sert que les quatre fichiers publics.
17. Aucun envoi d’email ni récupération de mot de passe automatique, puisqu’il n’existe pas de véritable adresse email.

## Limites connues et exploitation

- L’URL et les clés doivent être remplies et le projet Supabase configuré : un site statique seul ne peut pas créer sa base ni ses comptes.
- Internet, jsDelivr et Supabase sont nécessaires ; il n’existe pas de mode hors ligne ni de synchronisation différée de points.
- Le CDN est figé mais reste une dépendance tierce ; une évolution maîtrisée de version doit être retestée et un usage sans CDN demanderait un hébergement local de la bibliothèque.
- Supabase Auth conserve les identifiants techniques fictifs et ses métadonnées de sécurité ; la base applicative conserve seulement les données nécessaires au fonctionnement.
- Un projet peut être soumis aux quotas ou à la mise en veille de son offre Supabase ; vérifie ses conditions actuelles et ses sauvegardes avant un usage durable.
- La suppression d’un compte ou de son historique n’est pas proposée, pour préserver le journal ; définis avec l’établissement une durée de conservation et une procédure administrative d’archivage ou de suppression de la classe complète.
- Un administrateur Supabase peut techniquement modifier le schéma, désactiver les déclencheurs ou changer des rôles ; protège les accès au tableau de bord et n’utilise pas la clé `service_role` dans le site.
- Le script contrôle la répartition 2/2/14 au provisionnement, mais un administrateur hors application pourrait la modifier ; aucun navigateur ne le peut.
- Sans note ni identifiant d’évaluation stocké, le serveur ne peut pas reconnaître deux saisies manuelles de la même note ; les délégués doivent se coordonner et vérifier l’historique avant de ressaisir après une coupure réseau.
- Les idées et le tchat ne disposent pas d’antispam avancé ; les idées peuvent être bloquées, les champs sont bornés et les membres du tchat sont limités à quatre comptes.
- L’historique personnel et le journal global sont chargés intégralement ; une classe accumulant beaucoup d’opérations nécessiterait ultérieurement une pagination côté serveur.
- Le site n’a pas de formulaire de changement de mot de passe après la première connexion ni de récupération email ; un mot de passe oublié est réinitialisé par le professeur depuis l’administration Auth, avec distribution privée du nouveau mot de passe.
- Le prix appliqué est celui du cadeau à l’instant où le serveur traite l’achat ; si un suppléant modifie le prix entre la consultation et la confirmation, le nouveau prix fait autorité, comme indiqué dans la confirmation.
- Sur un appareil partagé, la session reste dans le navigateur jusqu’à la déconnexion ; ne coche aucun enregistrement de mot de passe sur l’appareil de la classe.
- Les tests locaux de développement ne remplacent pas la recette dans un vrai projet Supabase : Auth, WebSocket Realtime, publication distante, hébergement HTTPS et concurrence multi-connexions doivent être vérifiés après branchement.
