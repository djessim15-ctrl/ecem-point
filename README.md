# ⭐ ECEM Point

**Les points de la classe, gérés par les délégués et les suppléants.**

Un mini-site (HTML / CSS / JavaScript pur, sans framework, sans étape de build)
adossé à **Supabase** : les comptes, les points, l’historique et le tchat vivent
dans une base PostgreSQL, et les écrans se mettent à jour en temps réel.

> **Version 2** — refonte complète de l’interface (design system clair/sombre,
> polices locales, icônes SVG), nouvelles pages **Statistiques**, **Succès** et
> **Profil**, mode **démo** sans compte, application **installable** (PWA),
> palette de commandes, confettis… Voir le détail au § 0.

```bash
# pour visiter tout de suite, sans compte :
python3 -m http.server 8080
# http://localhost:8080/app.html?demo=1
```

---

## 0. Nouveautés de la version 2

### Design
- **Design system complet** : jetons de couleurs, rayons, ombres, typographies
  variables **Inter** et **Plus Jakarta Sans** servies localement (aucun CDN).
- **Thème clair / sombre / auto**, mémorisé par appareil, appliqué avant le
  premier rendu (pas de flash blanc) et synchronisé avec la barre du navigateur.
- **Barre latérale** sur ordinateur, **barre inférieure + bouton flottant** sur
  mobile, surfaces en verre, dégradés « aurore » et grain discret.
- **Icônes SVG** maison (plus d’emojis structurels), avatars colorés de façon
  stable, squelettes et états vides soignés, animations respectant
  `prefers-reduced-motion`.
- Page de connexion repensée : argumentaire, aperçu animé, FAQ intégrée et
  **accès direct à la démo**.

### Fonctionnalités ajoutées
| Nouveauté | Où | Ce que ça fait |
|---|---|---|
| **Tableau de bord** | Accueil | solde animé, rang, semaine, objectif, activité récente, tête de classe |
| **Statistiques** | Statistiques | gains/retraits sur 7 jours, répartition, top donneurs et receveurs, activité horaire |
| **Succès** | Succès | 10 à 12 badges calculés depuis l’historique, avec progression |
| **Profil & réglages** | Profil | thème, sons, animations, notifications, changement de mot de passe, export, lien de classe |
| **Classement par période** | Classement | « depuis toujours » ou « 7 derniers jours », recherche, barre de progression |
| **Fiche élève** | Classement, listes | points, rang, historique personnel, actions rapides |
| **Notifications** | cloche | dernières activités, compteur de nouveautés |
| **Palette de commandes** | `Ctrl/⌘ + K` | naviguer, chercher un élève, lancer une action au clavier |
| **Export CSV** | Historique, Profil | téléchargement de l’historique (compatible Excel) |
| **Recherche insensible aux accents** | toutes les listes | « ines » trouve « Inès » |
| **Tchat amélioré** | Tchat | envoi optimiste, séparateurs de jours, avatars, sélecteur d’emoji, Entrée pour envoyer |
| **Confettis, sons, vibrations** | partout | retours immédiats, désactivables dans le profil |
| **Mode démo** | `app.html?demo=1` | classe fictive en mémoire, bascule élève / suppléant / délégué |
| **Installation PWA** | navigateur | manifeste, icônes, service worker (coquille hors ligne) |
| **Hors ligne & erreurs** | global | indicateur de connexion, messages clairs, bouton « Réessayer » |
| **Diagnostic de connexion** | bandeau / écran d’erreur | test de la base, cause probable, lien « Ouvrir Supabase », voir § 0 bis |

### Corrections
- Les **délégués et suppléants n’apparaissent plus dans le classement** (ils
  n’ont pas de solde : seuls les élèves sont classés).
- La **présence** est recalculée à partir de `last_seen_at` au lieu d’être
  affichée « connecté » en dur sur son propre compte.
- Les **recherches** ne perdent plus la saisie en cours lors d’un rafraîchissement
  temps réel (les brouillons de montant sont conservés).
- Le **retrait** affiche le montant réellement retiré (borné par le solde).
- **Fins de session** et comptes non activés redirigés proprement avec un message.
- Les **erreurs réseau** ne laissent plus d’écran vide : message + réessai.
- Les **timestamps** et la date de membre sont formatés en français partout.
- Le **pied de page** fixe ne recouvre plus le contenu sur mobile.
- Les champs de saisie ne sont plus écrasés par les mises à jour temps réel.

---

## 0 bis. « La base de données ne répond pas » — que faire ?

Un projet Supabase **gratuit se met en pause** tout seul après environ une
semaine sans aucune visite. Pendant la pause, son adresse ne répond plus :
le site affiche alors un bandeau orange **« La base de données ne répond pas »**
(et non plus « Vérifie ton réseau », qui n’aidait pas).

**Rien n’est perdu** : les comptes, les points et l’historique restent dans la
base. Il suffit de réveiller le projet.

1. Ouvrir le tableau de bord du projet :
   <https://supabase.com/dashboard/project/qrpblycsztdelikvurah>
2. Cliquer sur **Restore project** (ou **Restaurer**) et attendre 1 à 3 minutes.
3. Recharger le site. C’est reparti.

Depuis le site, le bouton **Diagnostic** (bandeau de connexion, ou écran
d’erreur de l’application) affiche l’adresse testée, l’état de la clé, la
latence, et propose **Ouvrir Supabase** + **Réessayer**.

| Symptôme du diagnostic | Cause | Solution |
|---|---|---|
| `Serveur injoignable` | projet en pause ou supprimé | restaurer le projet (ci-dessus) |
| `Clé refusée` | clé `anon` régénérée | recopier la clé dans `assets/js/config.js` |
| `Tables absentes` | migrations non jouées | rejouer `supabase/migrations/0001…0005` |
| `Navigateur hors ligne` | Wi-Fi / réseau de l’appareil | se reconnecter, puis « Réessayer » |

> Pour changer de projet Supabase : remplacer `SUPABASE_URL` et
> `SUPABASE_ANON_KEY` dans `assets/js/config.js`, puis redéployer. Le reste du
> site (et le mode démo) continue de fonctionner sans modification.

---

## 1. Le principe

| Qui | Ce qu’il peut faire |
|---|---|
| **Délégué** (2) | Donner **1, 2, 3 ou 4 points** à un élève connecté · **retirer le nombre de points voulu** · voir toute la classe et tout l’historique · parler dans le **tchat** avec les suppléants |
| **Suppléant** (2) | Voir toute la classe, l’historique et le classement · participer au **tchat** délégués ↔ suppléants · *(peut aussi donner/retirer des points si le réglage `suppleant_can_award` est activé — voir § 8)* |
| **Élève** | Voir ses points · **envoyer ses points à un autre élève** (transfert direct, immédiat) · voir son historique personnel · voir le classement |

### Codes d’inscription (délégué / suppléant)

Un code = **un compte**, utilisable **une seule fois**. Il n’est jamais stocké
en clair (seule son empreinte SHA‑256 est en base), donc il est **impossible de
le relire** : si un code est perdu ou déjà consommé, on en crée un nouveau.

```sql
-- SQL Editor → créer un code (remplacer par le code choisi, entre guillemets)
insert into public.staff_codes (label, role, code_hash)
values ('Délégué 5', 'delegue',
        encode(extensions.digest('DEL-XXXX-XXXX', 'sha256'), 'hex'))
on conflict (code_hash) do nothing;

-- Voir l’état des codes : LIBRE ou UTILISÉ, et par qui
select s.label, s.role,
       case when s.used_by is null then 'LIBRE' else 'UTILISÉ' end as etat,
       p.prenom as utilise_par
  from public.staff_codes s
  left join public.profiles p on p.id = s.used_by
 order by s.role, s.created_at;
```

Le code est **sensible à la casse** : il doit être recopié exactement
(majuscules et tirets compris). Pour « rendre » un code consommé par erreur :

```sql
update public.staff_codes
   set used_by = null, used_at = null, claimed_token = null, claimed_at = null
 where label = 'Délégué 5';
```

Règles du jeu appliquées côté serveur :

- un don est borné entre `award_min` (1) et `award_max` (4) ;
- un retrait est libre en montant, mais **le solde ne descend jamais sous zéro** ;
- un transfert entre élèves est immédiat, **dans la limite du solde de l’expéditeur** ;
- chaque mouvement est **journalisé** (qui, quoi, combien, quand) dans `point_events` ;
- un élève est considéré **« connecté »** s’il a envoyé un battement de cœur il y a moins
  de `online_window_seconds` (90 s par défaut).

---

## 2. Les comptes et les mots de passe

On s’inscrit avec **un prénom + un mot de passe**. Le prénom est l’identifiant :
il est **unique dans toute la classe** (insensible à la casse).

- **Élève** → il choisit son mot de passe (6 caractères minimum).
- **Suppléant / Délégué** → le mot de passe demandé **est le code confidentiel**
  remis par la classe. Ce code sert **une seule fois** : il est consommé à
  l’inscription puis devient le mot de passe personnel du compte.

### 🔒 Où sont les codes ?

**Ils ne sont pas dans ce dépôt.** Le dépôt est public : y écrire les codes en
clair reviendrait à laisser n’importe qui s’inscrire délégué.

Les 4 codes (2 suppléants + 2 délégués) ont été insérés **directement dans la
base**, sous forme d’empreinte **sha256** dans la table `public.staff_codes`.
Cette table :

- a la **RLS activée sans aucune politique** → aucune ligne n’est lisible depuis
  un navigateur ;
- n’a **aucun droit `SELECT` accordé** aux rôles `anon` / `authenticated` ;
- n’est accessible qu’aux fonctions `SECURITY DEFINER` qui vérifient le code.

Le site envoie le code saisi à `claim_staff_code()`, qui le hache et le compare.
Le code en clair ne transite jamais dans le JavaScript et n’est jamais stocké.

> Tu veux changer un code, en ajouter un, voir lesquels sont libres ?
> Tout est au § 9 — c’est 3 lignes de SQL dans le *SQL Editor* de Supabase.

---

## 3. Accès

| Ressource | Adresse |
|---|---|
| Projet Supabase | `qrpblycsztdelikvurah` (région **eu-west-3**, Paris) |
| Console | https://supabase.com/dashboard/project/qrpblycsztdelikvurah |
| API | `https://qrpblycsztdelikvurah.supabase.co` |

Le site est **100 % statique** : n’importe quel hébergeur de fichiers fait
l’affaire (GitHub Pages, Netlify, Vercel, un `python3 -m http.server` en classe,
une clé USB servie en local…).

```bash
# lancer le site en local
cd ecem-point
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

> ⚠️ Il faut le servir **en HTTP**, pas l’ouvrir en double-cliquant sur
> `index.html` : l’authentification Supabase utilise `localStorage` et `fetch`,
> qui sont bridés sur le protocole `file://`.

---

## 4. Arborescence du dépôt

```
ecem-point/
├── index.html                     Connexion + inscription (3 rôles) + démo
├── app.html                       L’application (sections selon le rôle)
├── manifest.webmanifest           Application installable (nom, icônes, raccourcis)
├── sw.js                          Service worker : coquille en cache, hors ligne
├── README.md                      Ce document
├── .gitignore
├── assets/
│   ├── css/
│   │   └── style.css              Design system complet (clair + sombre)
│   ├── fonts/                     Inter + Plus Jakarta Sans (WOFF2, licences OFL)
│   ├── icons/                     Icône de l’application (SVG, maskable)
│   ├── js/
│   │   ├── config.js              URL + clé anon Supabase, réglages du site
│   │   ├── theme.js               Thème clair/sombre/auto + préférences locales
│   │   ├── icons.js               Jeu d’icônes SVG (aucune dépendance)
│   │   ├── ui.js                  Helpers DOM, dates FR, toasts, modales, erreurs
│   │   ├── fx.js                  Confettis, compteurs animés, sons, vibrations
│   │   ├── charts.js              Graphiques SVG (courbe, barres, anneau, heatmap)
│   │   ├── insights.js            Statistiques et succès calculés depuis l’historique
│   │   ├── demo.js                Faux client Supabase en mémoire (mode démo)
│   │   ├── db.js                  Création du client Supabase (ou client démo)
│   │   ├── data.js                Store : chargement, temps réel, actions RPC
│   │   ├── auth.js                Logique de index.html
│   │   ├── app.js                 Logique de app.html (toutes les vues)
│   │   └── pwa.js                 Service worker + proposition d’installation
│   └── vendor/
│       └── supabase.js            Librairie Supabase v2 (build UMD, vendue
│                                  avec le repo : aucune dépendance à un CDN)
└── supabase/
    ├── migrations/
    │   ├── 0001_core.sql          Tables, index, fonctions utilitaires, droits
    │   ├── 0002_rls.sql           Row Level Security (politiques)
    │   ├── 0003_rpc.sql           Les fonctions appelées par le site
    │   ├── 0004_realtime.sql      Publication des tables sur le canal temps réel
    │   └── 0005_release_code.sql  Libération d’une réservation de code
    └── seed-codes.example.sql     Modèle d’insertion des codes secrets
```

> **Aucune migration supplémentaire n’est nécessaire pour la version 2** :
> les nouvelles pages lisent les tables existantes (`profiles`, `point_events`,
> `staff_messages`, `app_settings`) et continuent de passer par les mêmes
> fonctions RPC. Les statistiques et les succès sont calculés dans le navigateur
> à partir de ce que la RLS laisse voir au compte connecté.

---

## 4 bis. Mode démo, raccourcis, installation

### Visiter sans compte

`app.html?demo=1` charge la même interface avec un **faux client Supabase en
mémoire** (`assets/js/demo.js`) : 18 élèves fictifs, un journal de 7 jours, un
tchat, des statistiques. Le bandeau en haut de page permet de changer de rôle
(élève / délégué / suppléant) et de quitter la démo. Rien ne part sur le réseau
et rien n’est écrit en base ; un rechargement remet les données à zéro.

Depuis la page de connexion, le bouton **Explorer la démo** propose les trois
rôles. La démo est totalement inerte quand l’URL ne contient pas `?demo=1`.

### Raccourcis clavier

| Touche | Action |
|---|---|
| `Ctrl` / `⌘` + `K` | palette de commandes (navigation, élèves, actions) |
| `/` | aller au champ de recherche de la section courante |
| `↑` `↓` puis `Entrée` | naviguer dans la palette |
| `Entrée` | envoyer un message dans le tchat (`Maj+Entrée` = retour à la ligne) |
| `Échap` | fermer une fenêtre, la palette ou le menu mobile |

### Installer l’application (PWA)

Le site embarque un `manifest.webmanifest` et un `sw.js`. Sur Chrome / Edge /
Android, une pastille « Installer ECEM Point » apparaît quand le navigateur le
permet ; sur iOS, *Partager → Sur l’écran d’accueil*. Le service worker met en
cache la coquille (HTML, CSS, JS, polices) : l’interface s’ouvre instantanément
et reste consultable hors ligne — les requêtes vers Supabase ne sont jamais
mises en cache, les points restent donc toujours à jour.

### Accessibilité

- navigation complète au clavier, focus visible, `aria-current` sur l’onglet actif ;
- lien d’évitement (« Aller au contenu »), libellés `aria-label` sur les icônes ;
- fenêtres modales avec piège à focus et fermeture par `Échap` ;
- respect de `prefers-reduced-motion` (confettis, transitions et compteurs) ;
- contraste vérifié dans les deux thèmes, tailles de texte relatives.

---

## 5. Parcours d’inscription

```
                 ┌─ élève ──────────────────────────────┐
prénom + rôle +  │                                      │
mot de passe     │   auth.signUp(prénom@ecem-point.fr)  │
                 │   rpc activate_account(prénom, rôle) │
                 └──────────────────────────────────────┘

                 ┌─ suppléant / délégué ────────────────────────────────┐
prénom + rôle +  │ 1. rpc claim_staff_code(rôle, code)  → jeton 10 min  │
code confidentiel│    · code inconnu ou déjà utilisé → refus immédiat   │
                 │ 2. auth.signUp(prénom@ecem-point.fr, code)           │
                 │ 3. rpc activate_account(prénom, rôle, jeton)         │
                 │    · crée le profil ET consomme définitivement le code│
                 │ 4. échec ? rpc release_staff_code(jeton)             │
                 │    · le code redevient utilisable tout de suite      │
                 └──────────────────────────────────────────────────────┘
```

L’adresse de connexion est **dérivée du prénom**
(`Léa-Marie` → `lea.marie@ecem-point.fr`). Elle est purement technique :
la confirmation par courriel est **désactivée** (`mailer_autoconfirm = true`),
personne ne reçoit jamais rien. C’est ce qui permet de se reconnecter plus tard
avec seulement **prénom + mot de passe**.

Un compte de connexion créé mais jamais activé (navigateur fermé au mauvais
moment) est récupérable : la page d’inscription repasse en mode
**« terminer mon inscription »** et réutilise la session existante.

---

## 6. Modèle de données

### `public.profiles` — un compte
| Colonne | Type | Rôle |
|---|---|---|
| `id` | `uuid` PK → `auth.users` | le compte Supabase Auth |
| `prenom` | `text` | affiché, **unique** (`lower(prenom)`) |
| `role` | `text` | `eleve` \| `suppleant` \| `delegue` |
| `points` | `integer` | solde, contrainte `>= 0` |
| `last_seen_at` | `timestamptz` | présence (« connecté ») |
| `created_at` | `timestamptz` | date d’inscription |

### `public.staff_codes` — les codes secrets
`label`, `role`, `code_hash` (sha256, **unique**), `claimed_token` +
`claimed_at` (réservation temporaire de 10 min), `used_by` + `used_at`
(**un code = un compte, une seule fois**).

### `public.point_events` — le journal
`kind` (`gain` \| `retrait` \| `transfert`), `amount` (`> 0`), `subject_id`
(l’élève concerné), `counterparty_id` (l’autre élève pour un transfert),
`actor_id` (qui a déclenché), `note`, `created_at`.

### `public.staff_messages` — le tchat
`author_id` → `profiles`, `body` (1 à 1000 caractères), `created_at`.

### `public.app_settings` — les règles (1 ligne)
`suppleant_can_award`, `award_min`, `award_max`, `transfer_min`,
`online_window_seconds`.

---

## 7. Les fonctions SQL (`rpc`)

Toutes sont `SECURITY DEFINER` avec `search_path` figé : elles font ce que la
RLS interdit au navigateur, **mais seulement après avoir vérifié qui appelle**.

| Fonction | Appelable par | Ce qu’elle fait |
|---|---|---|
| `claim_staff_code(rôle, code)` | anonyme | Vérifie un code et le **réserve 10 min**. Renvoie un jeton. |
| `release_staff_code(jeton)` | anonyme | Annule une réservation après un échec. |
| `activate_account(prénom, rôle, jeton)` | connecté | Crée le profil, **consomme le code**. |
| `heartbeat()` | connecté | Met à jour `last_seen_at` (présence). |
| `online_count()` | anonyme | Nombre d’élèves connectés. |
| `award_points(élève, n)` | délégué | Donne `n` points, `award_min ≤ n ≤ award_max`. |
| `remove_points(élève, n)` | délégué | Retire `n` points (plafonné au solde). |
| `transfer_points(élève, n)` | élève | Envoie `n` de ses points à un autre élève. |
| `my_role()`, `is_staff()`, `is_delegue()`, `can_award()` | tous | Prédicats utilisés par la RLS. |

**Codes d’erreur** renvoyés (traduits en français par `ui.js`) :
`NON_CONNECTE`, `ROLE_INVALIDE`, `PRENOM_INVALIDE`, `PRENOM_PRIS`,
`COMPTE_DEJA_ACTIVE`, `CODE_INVALIDE`, `MONTANT_INVALIDE`, `INTERDIT`,
`ELEVE_INTROUVABLE`, `CIBLE_INVALIDE`, `POINTS_INSUFFISANTS`.

---

## 8. Sécurité : pourquoi on ne peut pas tricher

Le client n’a **aucun droit d’écriture direct** :

| Table | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `profiles` | ✅ tout compte connecté | ❌ | ❌ | ❌ |
| `point_events` | ✅ si staff, ou lignes me concernant | ❌ | ❌ | ❌ |
| `staff_messages` | ✅ staff seulement | ✅ staff seulement | ❌ | ❌ |
| `app_settings` | ✅ lecture | ❌ | ❌ | ❌ |
| `staff_codes` | ❌ **invisible** | ❌ | ❌ | ❌ |

Concrètement, un élève qui ouvre la console du navigateur et tape
`update profiles set points = 9999` ne modifie **rien** : la politique RLS ne
laisse passer aucune ligne. Idem pour un élève qui essaierait de poster dans le
tchat des délégués → `new row violates row-level security policy`.

Vérifications réellement testées sur la base :

- ✅ un délégué donne 3 puis 4 points → solde 7 ; retire 2 → solde 5 ;
- ✅ un don de **5** points est refusé (`MONTANT_INVALIDE`) ;
- ✅ un **élève** qui appelle `award_points` est refusé (`INTERDIT`) ;
- ✅ un **suppléant** est refusé tant que `suppleant_can_award = false`,
  et accepté dès qu’on passe le réglage à `true` ;
- ✅ un transfert de 2 points débite bien l’expéditeur et crédite le destinataire ;
- ✅ un code déjà consommé est refusé (`CODE_INVALIDE`) ;
- ✅ `staff_codes` renvoie `permission denied` à un compte connecté ;
- ✅ un élève ne voit que **son** historique, pas celui des autres ;
- ✅ la modification directe du solde est silencieusement ignorée.

> **Note honnête sur la clé `anon`.** Elle est publique par conception (c’est
> une clé « navigable » Supabase, faite pour être embarquée dans le front).
> Elle ne donne aucun pouvoir au-delà de ce que les politiques RLS autorisent.
> La clé `service_role`, elle, ne doit **jamais** sortir du tableau de bord.

> **Note sur le cassage de code.** `claim_staff_code()` est appelable sans
> compte. Une personne très motivée pourrait essayer des codes au hasard.
> Pour un usage de classe le risque est faible (codes longs, 4 possibilités,
> GoTrue limite déjà le débit), mais si tu veux durcir : ajoute un délai
> artificiel dans la fonction, ou fais valider les codes par une
> *Edge Function* avec un compteur de tentatives.

### Donner le pouvoir aux suppléants

```sql
update public.app_settings
   set suppleant_can_award = true, updated_at = now()
 where id = 1;
```

L’interface s’adapte toute seule : les boutons **+1 +2 +3 +4** et **Retirer**
passent du gris au violet pour les suppléants.

---

## 9. Administration courante

Tout se fait dans **SQL Editor** → https://supabase.com/dashboard/project/qrpblycsztdelikvurah/sql/new

**Voir l’état des codes (libre / utilisé, par qui)**
```sql
select s.label,
       s.role,
       case when s.used_by is null then 'LIBRE' else 'UTILISÉ' end as etat,
       p.prenom as utilise_par,
       s.used_at
  from public.staff_codes s
  left join public.profiles p on p.id = s.used_by
 order by s.role, s.created_at;
```

**Ajouter un code** (remplace `MON_CODE` et le label)
```sql
insert into public.staff_codes (label, role, code_hash)
values ('Délégué 3', 'delegue', encode(extensions.digest('MON_CODE', 'sha256'), 'hex'))
on conflict (code_hash) do nothing;
```

**Libérer un code déjà consommé** (ex. un délégué a changé, il faut un remplaçant)
```sql
update public.staff_codes
   set used_by = null, used_at = null, claimed_token = null, claimed_at = null
 where label = 'Délégué 1';
```

**Changer la plage de points donnés** (ex. jusqu’à 6)
```sql
update public.app_settings set award_min = 1, award_max = 6, updated_at = now() where id = 1;
```

**Donner / retirer des points à la main**
```sql
update public.profiles set points = points + 5 where prenom = 'Léa';
```

**Remettre tous les compteurs à zéro**
```sql
update public.profiles set points = 0 where role = 'eleve';
delete from public.point_events;
```

**Nouvelle année scolaire : supprimer les élèves** (le journal et le tchat
suivent grâce aux cascades)
```sql
delete from auth.users
 where id in (select id from public.profiles where role = 'eleve');
```

**Nettoyer les comptes de connexion jamais activés**
```sql
delete from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
   and u.created_at < now() - interval '1 day';
```

**Réinitialiser le mot de passe d’un élève** — le plus simple est de supprimer
son compte (`delete from auth.users where id = …`) et de le laisser se
réinscrire : son historique est conservé si tu recrées le profil avec le même
`id`, sinon il repart de zéro.

---

## 10. Temps réel

Le site s’abonne à `supabase_realtime` sur `profiles`, `point_events` et
`staff_messages` (migration `0004`). La **RLS reste appliquée** au flux :
un élève reçoit uniquement les lignes qu’il a le droit de lire, il ne reçoit
**jamais** le tchat des délégués.

Effets visibles :

- un point donné par un délégué apparaît immédiatement chez l’élève ;
- le classement et les pastilles « connecté » se rafraîchissent tout seuls ;
- le tchat défile en direct.

Un rafraîchissement complet toutes les 20 s sert de filet de sécurité si la
websocket tombe (réseau de l’établissement capricieux). L’état du canal est
affiché en bas de page : **« temps réel activé »**.

---

## 11. Réinstaller le projet de zéro

1. Crée un projet Supabase (région de ton choix).
2. **Authentication → Sign In / Up → Email** : laisse *Enable Email provider*
   activé et **désactive *Confirm email***.
3. **SQL Editor** : rejoue les migrations dans l’ordre
   `0001_core.sql` → `0002_rls.sql` → `0003_rpc.sql` → `0004_realtime.sql` →
   `0005_release_code.sql`.
4. Insère tes codes secrets (modèle : `supabase/seed-codes.example.sql`).
5. **Project Settings → API** : copie l’URL du projet et la clé `anon`
   dans `assets/js/config.js`.
6. Sers le dossier en HTTP. C’est tout.

---

## 12. Limites assumées

- **Pas d’adresse courriel réelle** : le « mot de passe oublié » n’existe donc
  pas. Un élève qui a perdu son mot de passe passe par l’admin (§ 9).
- **Le prénom est l’identifiant** : deux homonymes dans la même classe devront
  se distinguer (ex. `Léa M` et `Léa B`).
- **Pas de modération automatique du tchat** : il est privé, réservé aux 4
  comptes d’encadrement.
- **Une seule classe par projet** : pour plusieurs classes, duplique le projet
  Supabase (ou ajoute une colonne `classe_id` partout, ce qui est un vrai
  chantier).

---

## 13. Stack

- HTML5 / CSS3 / JavaScript **vanilla** (ES5-compatible, aucune transpilation)
- [`@supabase/supabase-js` v2](https://github.com/supabase/supabase-js) — build
  UMD **vendu dans le dépôt** (`assets/vendor/supabase.js`), donc zéro CDN,
  zéro `npm install`, le site fonctionne hors ligne côté dépendances
- PostgreSQL (Supabase) — RLS, fonctions `SECURITY DEFINER`, Realtime
