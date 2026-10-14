-- À exécuter UNE SEULE FOIS dans un projet Supabase neuf.
-- Les notes ne sont jamais enregistrées ; seul le palier gagné est conservé.
begin;
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  prenom text not null unique check (char_length(prenom) between 1 and 60),
  role text not null check (role in ('eleve', 'delegue', 'suppleant')),
  bloque_idees boolean not null default false,
  doit_changer_mdp boolean not null default true
);
-- Cette empreinte n'est jamais accessible depuis le navigateur.
create table private.mots_de_passe_initiaux (
  id uuid primary key references public.profiles(id) on delete restrict,
  empreinte text not null
);
alter table private.mots_de_passe_initiaux enable row level security;

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(btrim(nom)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  prix integer not null check (prix between 1 and 1000000),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  eleve_id uuid not null references public.profiles(id),
  cadeau_id uuid not null references public.gifts(id),
  nom_cadeau text not null,
  prix integer not null check (prix between 1 and 1000000),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'en_impression', 'donne', 'annulee')),
  requete_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references public.profiles(id),
  type text not null check (type in ('gain','envoi','reception','depense','remboursement','annulation')),
  montant integer not null,
  evaluation text check (evaluation in ('sommative','formative')),
  operateur_id uuid not null references public.profiles(id),
  echange_id uuid,
  contrepartie_id uuid references public.profiles(id),
  commande_id uuid references public.orders(id),
  annule_transaction_id uuid unique references public.transactions(id),
  created_at timestamptz not null default now(),
  check (
    (type = 'gain' and montant between 0 and 3 and evaluation is not null) or
    (type in ('reception','remboursement') and montant > 0) or
    (type in ('envoi','depense') and montant < 0) or
    (type = 'annulation' and montant <> 0 and annule_transaction_id is not null)
  ),
  check ((type in ('envoi','reception')) = (echange_id is not null and annule_transaction_id is null) or type = 'annulation'),
  check (contrepartie_id is null or contrepartie_id <> compte_id)
);
create unique index un_type_par_echange on public.transactions(echange_id, type) where type in ('envoi','reception');
create unique index une_operation_par_commande on public.transactions(commande_id, type) where type in ('depense','remboursement');
create index transactions_compte_date on public.transactions(compte_id, created_at desc);
create index orders_eleve_date on public.orders(eleve_id, created_at desc);
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  auteur_id uuid not null references public.profiles(id),
  texte text not null check (char_length(btrim(texte)) between 1 and 2000),
  statut text not null default 'en_attente' check (statut in ('en_attente','acceptee','refusee')),
  reponse text check (char_length(reponse) <= 1000),
  repondu_par uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  auteur_id uuid not null references public.profiles(id),
  texte text not null check (char_length(btrim(texte)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index chat_date on public.chat_messages(created_at desc);

-- Fonctions internes : aucun argument ne permet de choisir l'identité connectée.
create function public.role_actif() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and not doit_changer_mdp
$$;
create function public.exiger_compte() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi pour continuer.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Ce compte ne fait pas partie de la classe.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and doit_changer_mdp) then
    raise exception 'Change ton mot de passe provisoire avant de continuer.';
  end if;
  return auth.uid();
end $$;
create function public.exiger_role(roles text[]) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare utilisateur uuid;
begin
  utilisateur := public.exiger_compte();
  if not (public.role_actif() = any(roles)) then raise exception 'Ton rôle ne permet pas cette action.'; end if;
  return utilisateur;
end $$;
create function private.sauver_empreinte() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into private.mots_de_passe_initiaux(id, empreinte)
    select new.id, encrypted_password from auth.users where id = new.id;
  return new;
end $$;
create trigger sauvegarde_mdp after insert on public.profiles
for each row execute function private.sauver_empreinte();
create function public.confirmer_changement_mdp() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi pour continuer.'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Compte de classe introuvable.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and not doit_changer_mdp) then return; end if;
  if not exists (
    select 1 from auth.users u join private.mots_de_passe_initiaux m on m.id = u.id
    where u.id = auth.uid() and u.encrypted_password is not null
      and u.encrypted_password <> m.empreinte
  ) then raise exception 'Le mot de passe doit d’abord être changé avec Supabase Auth.'; end if;
  update public.profiles set doit_changer_mdp = false where id = auth.uid();
  delete from private.mots_de_passe_initiaux where id = auth.uid();
end $$;
-- Même une écriture privilégiée ne peut pas réécrire le journal.
create function private.journal_immuable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'Le journal est immuable : ajoute une opération inverse.'; end $$;
create trigger journal_immuable before update or delete or truncate on public.transactions
for each statement execute function private.journal_immuable();

create function public.mon_solde() returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare utilisateur uuid;
begin
  utilisateur := public.exiger_compte();
  return (select coalesce(sum(montant),0) from public.transactions where compte_id = utilisateur);
end $$;
create function public.mon_historique() returns setof public.transactions
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare utilisateur uuid;
begin
  utilisateur := public.exiger_compte();
  return query select * from public.transactions where compte_id = utilisateur order by created_at desc, id;
end $$;
create function public.liste_comptes() returns table(id uuid, prenom text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.exiger_compte();
  return query select p.id, p.prenom from public.profiles p order by p.prenom;
end $$;
create function public.saisir_note(eleve uuid, type text, note numeric) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; points integer; arrondie numeric; maximum integer;
begin
  acteur := public.exiger_role(array['delegue']);
  if eleve = acteur then raise exception 'L’autre délégué doit saisir ta note.'; end if;
  if type is null or type not in ('sommative','formative') then raise exception 'Type d’évaluation invalide.'; end if;
  maximum := case when type = 'sommative' then 20 else 10 end;
  if note is null or note::text in ('NaN','Infinity','-Infinity') or note < 0 or note > maximum then
    raise exception 'La note doit être comprise entre 0 et %.', maximum;
  end if;
  arrondie := round(note, 1);
  points := case when type = 'formative' then case when arrondie >= 9 then 1 else 0 end
    when arrondie >= 19.5 then 3 when arrondie >= 18.5 then 2 when arrondie >= 17 then 1 else 0 end;
  perform 1 from public.profiles where id = eleve for update;
  if not found then raise exception 'Élève introuvable.'; end if;
  insert into public.transactions(compte_id,type,montant,evaluation,operateur_id)
    values(eleve,'gain',points,type,acteur);
  return points;
end $$;
create function public.envoyer_points(destinataire uuid, montant integer, requete uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; solde bigint; precedent public.transactions;
begin
  acteur := public.exiger_compte();
  if destinataire is null or destinataire = acteur then raise exception 'Choisis un autre compte que le tien.'; end if;
  if montant is null or montant not between 1 and 1000000 or requete is null then raise exception 'Le montant doit être un entier entre 1 et 1 000 000.'; end if;
  -- Toujours le même ordre de verrouillage pour éviter les interblocages.
  perform id from public.profiles where id in (acteur,destinataire) order by id for update;
  if not exists (select 1 from public.profiles where id = destinataire) then raise exception 'Destinataire introuvable.'; end if;
  select * into precedent from public.transactions where echange_id = requete and type = 'envoi';
  if found then
    if precedent.compte_id <> acteur or precedent.contrepartie_id <> destinataire or precedent.montant <> -montant then
      raise exception 'Identifiant de demande déjà utilisé.';
    end if;
    return requete;
  end if;
  select coalesce(sum(t.montant),0) into solde from public.transactions t where compte_id = acteur;
  if solde < montant then raise exception 'Solde insuffisant : tu as % point(s).', solde; end if;
  insert into public.transactions(compte_id,type,montant,operateur_id,echange_id,contrepartie_id) values
    (acteur,'envoi',-montant,acteur,requete,destinataire),
    (destinataire,'reception',montant,acteur,requete,acteur);
  return requete;
end $$;
create function public.annuler_echange(id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; envoi public.transactions; reception public.transactions; solde bigint;
begin
  acteur := public.exiger_role(array['delegue']);
  select * into envoi from public.transactions t where t.echange_id = annuler_echange.id and t.type = 'envoi';
  if not found then raise exception 'Échange introuvable.'; end if;
  perform p.id from public.profiles p where p.id in (envoi.compte_id,envoi.contrepartie_id) order by p.id for update;
  if exists (select 1 from public.transactions t where t.annule_transaction_id = envoi.id) then
    raise exception 'Cet échange a déjà été annulé.';
  end if;
  select * into reception from public.transactions t where t.echange_id = annuler_echange.id and t.type = 'reception';
  select coalesce(sum(t.montant),0) into solde from public.transactions t where t.compte_id = reception.compte_id;
  if solde < reception.montant then raise exception 'Annulation impossible : le destinataire n’a plus assez de points.'; end if;
  insert into public.transactions(compte_id,type,montant,operateur_id,echange_id,contrepartie_id,annule_transaction_id) values
    (envoi.compte_id,'annulation',-envoi.montant,acteur,envoi.echange_id,envoi.contrepartie_id,envoi.id),
    (reception.compte_id,'annulation',-reception.montant,acteur,envoi.echange_id,reception.contrepartie_id,reception.id);
end $$;
create function public.commander_cadeau(cadeau_id uuid, requete uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; cadeau public.gifts; commande public.orders; solde bigint; nouvelle uuid;
begin
  acteur := public.exiger_compte();
  if requete is null then raise exception 'Identifiant de demande manquant.'; end if;
  perform 1 from public.profiles where id = acteur for update;
  select * into commande from public.orders where requete_id = requete;
  if found then
    if commande.eleve_id <> acteur or commande.cadeau_id <> commander_cadeau.cadeau_id then raise exception 'Identifiant de demande déjà utilisé.'; end if;
    return commande.id;
  end if;
  select * into cadeau from public.gifts g where g.id = commander_cadeau.cadeau_id for update;
  if not found or not cadeau.actif then raise exception 'Ce cadeau n’est plus disponible.'; end if;
  select coalesce(sum(montant),0) into solde from public.transactions where compte_id = acteur;
  if solde < cadeau.prix then raise exception 'Solde insuffisant : ce cadeau coûte % point(s).', cadeau.prix; end if;
  insert into public.orders(eleve_id,cadeau_id,nom_cadeau,prix,requete_id)
    values(acteur,cadeau.id,cadeau.nom,cadeau.prix,requete) returning orders.id into nouvelle;
  insert into public.transactions(compte_id,type,montant,operateur_id,commande_id)
    values(acteur,'depense',-cadeau.prix,acteur,nouvelle);
  return nouvelle;
end $$;
create function public.changer_statut_commande(id uuid, statut text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare commande public.orders;
begin
  perform public.exiger_role(array['suppleant']);
  select * into commande from public.orders o where o.id = changer_statut_commande.id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if statut is null or not ((commande.statut = 'en_attente' and statut = 'en_impression') or (commande.statut = 'en_impression' and statut = 'donne')) then
    raise exception 'Transition refusée : attente → impression → donné uniquement.';
  end if;
  update public.orders o set statut = changer_statut_commande.statut, updated_at = now() where o.id = commande.id;
end $$;
create function public.annuler_commande(id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; commande public.orders; proprietaire uuid;
begin
  acteur := public.exiger_role(array['suppleant']);
  select eleve_id into proprietaire from public.orders o where o.id = annuler_commande.id;
  if not found then raise exception 'Commande introuvable.'; end if;
  -- Compte avant commande : ordre compatible avec les achats.
  perform 1 from public.profiles where profiles.id = proprietaire for update;
  select * into commande from public.orders o where o.id = annuler_commande.id for update;
  if commande.statut = 'annulee' then raise exception 'Cette commande a déjà été remboursée.'; end if;
  if commande.statut = 'donne' then raise exception 'Un cadeau déjà donné ne peut plus être annulé.'; end if;
  update public.orders o set statut = 'annulee', updated_at = now() where o.id = commande.id;
  insert into public.transactions(compte_id,type,montant,operateur_id,commande_id)
    values(commande.eleve_id,'remboursement',commande.prix,acteur,commande.id);
end $$;
create function public.enregistrer_cadeau(nom text, description text, prix integer, actif boolean, cadeau_id uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare resultat uuid;
begin
  perform public.exiger_role(array['suppleant']);
  if nom is null or char_length(btrim(nom)) not between 1 and 100 or description is null or char_length(description) > 1000
    or prix is null or prix not between 1 and 1000000 or actif is null then raise exception 'Nom, description ou prix du cadeau invalide.'; end if;
  if cadeau_id is null then
    insert into public.gifts(nom,description,prix,actif) values(btrim(nom),description,prix,actif) returning gifts.id into resultat;
  else
    update public.gifts g set nom = btrim(enregistrer_cadeau.nom), description = enregistrer_cadeau.description,
      prix = enregistrer_cadeau.prix, actif = enregistrer_cadeau.actif where g.id = cadeau_id returning g.id into resultat;
    if not found then raise exception 'Cadeau introuvable.'; end if;
  end if;
  return resultat;
end $$;
create function public.envoyer_idee(texte text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; resultat uuid;
begin
  acteur := public.exiger_role(array['eleve','suppleant']);
  perform 1 from public.profiles where id = acteur for update;
  if exists (select 1 from public.profiles where id = acteur and bloque_idees) then raise exception 'Tes idées sont bloquées jusqu’au déblocage par un délégué.'; end if;
  if texte is null or char_length(btrim(texte)) not between 1 and 2000 then raise exception 'Écris une idée de 1 à 2 000 caractères.'; end if;
  insert into public.ideas(auteur_id,texte) values(acteur,btrim(texte)) returning ideas.id into resultat;
  return resultat;
end $$;
create function public.repondre_idee(id uuid, statut text, reponse text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid;
begin
  acteur := public.exiger_role(array['delegue']);
  if statut is null or statut not in ('acceptee','refusee') or reponse is null or char_length(btrim(reponse)) not between 1 and 1000 then
    raise exception 'Choisis acceptée ou refusée et écris une réponse de 1 à 1 000 caractères.';
  end if;
  update public.ideas i set statut = repondre_idee.statut, reponse = btrim(repondre_idee.reponse), repondu_par = acteur
    where i.id = repondre_idee.id and i.statut = 'en_attente';
  if not found then raise exception 'Idée introuvable ou déjà traitée.'; end if;
end $$;
create function public.bloquer_eleve(id uuid, bloque boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.exiger_role(array['delegue']);
  if bloque is null then raise exception 'Choisis bloquer ou débloquer.'; end if;
  update public.profiles p set bloque_idees = bloque where p.id = bloquer_eleve.id and p.role in ('eleve','suppleant');
  if not found then raise exception 'Compte introuvable ou délégué non concerné par les idées.'; end if;
end $$;
create function public.liste_blocages() returns table(id uuid, prenom text, bloque_idees boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.exiger_role(array['delegue']);
  return query select p.id,p.prenom,p.bloque_idees from public.profiles p where p.role in ('eleve','suppleant') order by p.prenom;
end $$;
create function public.envoyer_message_tchat(texte text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare acteur uuid; resultat uuid;
begin
  acteur := public.exiger_role(array['delegue','suppleant']);
  if texte is null or char_length(btrim(texte)) not between 1 and 2000 then raise exception 'Écris un message de 1 à 2 000 caractères.'; end if;
  insert into public.chat_messages(auteur_id,texte) values(acteur,btrim(texte)) returning chat_messages.id into resultat;
  return resultat;
end $$;
create function public.toutes_les_transactions() returns setof public.transactions
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.exiger_role(array['delegue']);
  return query select * from public.transactions order by created_at desc, id;
end $$;

-- Aucune écriture directe, même si l'interface est contournée.
alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.gifts enable row level security;
alter table public.orders enable row level security;
alter table public.ideas enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.profiles, public.transactions, public.gifts, public.orders, public.ideas, public.chat_messages from public, anon, authenticated;
grant select on public.profiles, public.transactions, public.gifts, public.orders, public.ideas, public.chat_messages to authenticated;
-- Provisionnement exclusivement depuis le script local avec service_role.
grant select, insert on public.profiles to service_role;
create policy profil_personnel on public.profiles for select to authenticated using (id = auth.uid());
create policy journal_personnel_ou_delegue on public.transactions for select to authenticated
  using (public.role_actif() is not null and (compte_id = auth.uid() or public.role_actif() = 'delegue'));
create policy cadeaux_disponibles on public.gifts for select to authenticated
  using (public.role_actif() is not null and (actif or public.role_actif() = 'suppleant'));
create policy commandes_personnelles_ou_suppleant on public.orders for select to authenticated
  using (public.role_actif() is not null and (eleve_id = auth.uid() or public.role_actif() = 'suppleant'));
create policy idees_personnelles_ou_delegue on public.ideas for select to authenticated
  using (public.role_actif() is not null and (auteur_id = auth.uid() or public.role_actif() = 'delegue'));
create policy tchat_equipe on public.chat_messages for select to authenticated
  using (public.role_actif() in ('delegue','suppleant'));

-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : retirer ce droit explicitement.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.role_actif(), public.confirmer_changement_mdp(), public.mon_solde(), public.mon_historique(), public.liste_comptes(),
  public.saisir_note(uuid,text,numeric), public.envoyer_points(uuid,integer,uuid), public.annuler_echange(uuid),
  public.commander_cadeau(uuid,uuid), public.changer_statut_commande(uuid,text), public.annuler_commande(uuid),
  public.enregistrer_cadeau(text,text,integer,boolean,uuid), public.envoyer_idee(text), public.repondre_idee(uuid,text,text),
  public.bloquer_eleve(uuid,boolean), public.liste_blocages(), public.envoyer_message_tchat(text), public.toutes_les_transactions() to authenticated;
alter default privileges in schema public revoke execute on functions from public;

-- Seul le tchat est publié. Le projet doit être dédié à cette classe.
do $$
declare ligne record;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    raise exception 'La publication Realtime doit être dédiée, pas FOR ALL TABLES.';
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  for ligne in select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' loop
    execute format('alter publication supabase_realtime drop table %I.%I', ligne.schemaname, ligne.tablename);
  end loop;
  alter publication supabase_realtime add table public.chat_messages;
end $$;
commit;
