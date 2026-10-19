# ⭐ ECEM Point

**Les points de la classe, gérés par les délégués et les suppléants.**

Un mini-site (HTML / CSS / JavaScript pur, sans framework, sans étape de build)
adossé à **Supabase** : les comptes, les points, l’historique et le tchat vivent
dans une base PostgreSQL, et les écrans se mettent à jour en temps réel.

---

## 1. Le principe

| Qui | Ce qu’il peut faire |
|---|---|
| **Délégué** (2) | Donner **1, 2, 3 ou 4 points** à un élève connecté · **retirer le nombre de points voulu** · voir toute la classe et tout l’historique · parler dans le **tchat** avec les suppléants |
| **Suppléant** (2) | Voir toute la classe, l’historique et le classement · participer au **tchat** délégués ↔ suppléants · *(peut aussi donner/retirer des points si le réglage `suppleant_can_award` est activé — voir § 8)* |
| **Élève** | Voir ses points · **envoyer ses points à un autre élève** (transfert direct, immédiat) · voir son historique personnel · voir le classement |

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
├── index.html                     Connexion + inscription (3 rôles)
├── app.html                       L’application (onglets selon le rôle)
├── README.md                      Ce document
├── .gitignore
├── assets/
│   ├── css/
│   │   └── style.css              Toute l’apparence (une seule feuille)
│   ├── js/
│   │   ├── config.js              URL + clé anon Supabase, réglages du site
│   │   ├── db.js                  Création du client Supabase
│   │   ├── ui.js                  Helpers DOM, dates FR, toasts, erreurs
│   │   ├── auth.js                Logique de index.html
│   │   └── app.js                 Logique de app.html
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
