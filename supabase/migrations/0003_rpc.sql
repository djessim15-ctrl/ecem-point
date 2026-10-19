-- ============================================================================
-- ECEM Point — Migration 0003 : les fonctions appelées par le site
-- ============================================================================
-- Toutes sont SECURITY DEFINER (exécutées en tant que propriétaire des tables)
-- avec search_path figé : elles font le travail que la RLS interdit au client,
-- mais uniquement après avoir vérifié qui appelle et si les règles sont
-- respectées. Chaque mouvement de points est journalisé dans point_events.
--
-- Codes d'erreur renvoyés (le site les traduit en français) :
--   NON_CONNECTE, ROLE_INVALIDE, PRENOM_INVALIDE, PRENOM_PRIS,
--   COMPTE_DEJA_ACTIVE, CODE_INVALIDE, MONTANT_INVALIDE, INTERDIT,
--   ELEVE_INTROUVABLE, CIBLE_INVALIDE, POINTS_INSUFFISANTS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 3.1 Réservation d'un code suppléant / délégué
-- ---------------------------------------------------------------------------
-- Appelée AVANT la création du compte Auth, par un visiteur anonyme.
-- Renvoie un jeton à usage unique (valable 10 minutes) qui sera consommé par
-- activate_account(). Un code déjà utilisé ne renvoie jamais de jeton :
-- c'est ce qui garantit « un seul compte par code ».
create or replace function public.claim_staff_code(p_role text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_token uuid := gen_random_uuid();
  v_id    uuid;
begin
  if p_role is null or p_role not in ('suppleant', 'delegue') then
    raise exception 'ROLE_INVALIDE';
  end if;

  if p_code is null or char_length(btrim(p_code)) < 4 or char_length(p_code) > 64 then
    raise exception 'CODE_INVALIDE';
  end if;

  -- Libère les réservations périmées (inscription abandonnée en cours de route).
  update public.staff_codes
     set claimed_token = null,
         claimed_at    = null
   where claimed_token is not null
     and claimed_at < now() - interval '10 minutes';

  -- Réserve le premier code libre correspondant (rôle + empreinte sha256).
  update public.staff_codes s
     set claimed_token = v_token,
         claimed_at    = now()
    from (
           select c.id
             from public.staff_codes c
            where c.role          = p_role
              and c.code_hash     = encode(extensions.digest(p_code, 'sha256'), 'hex')
              and c.used_by       is null
              and c.claimed_token is null
            order by c.created_at
            limit 1
         ) pick
   where s.id = pick.id
  returning s.id into v_id;

  if v_id is null then
    raise exception 'CODE_INVALIDE';
  end if;

  return v_token;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3.2 Activation du compte (création de la ligne profiles)
-- ---------------------------------------------------------------------------
-- Appelée juste après signUp(). Pour un élève : p_token = null.
-- Pour un suppléant / délégué : p_token = le jeton de claim_staff_code().
create or replace function public.activate_account(p_prenom text, p_role text, p_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_prenom   text := btrim(coalesce(p_prenom, ''));
  v_code_id  uuid;
  v_profile  public.profiles;
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  if p_role is null or p_role not in ('eleve', 'suppleant', 'delegue') then
    raise exception 'ROLE_INVALIDE';
  end if;

  if char_length(v_prenom) < 2 or char_length(v_prenom) > 24
     or v_prenom !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9]+([ _''-][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*$' then
    raise exception 'PRENOM_INVALIDE';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'COMPTE_DEJA_ACTIVE';
  end if;

  -- Vérification du code secret pour les comptes à responsabilité.
  if p_role <> 'eleve' then
    if p_token is null then
      raise exception 'CODE_INVALIDE';
    end if;

    select c.id into v_code_id
      from public.staff_codes c
     where c.claimed_token = p_token
       and c.role          = p_role
       and c.used_by       is null
       and c.claimed_at   >= now() - interval '10 minutes';

    if v_code_id is null then
      raise exception 'CODE_INVALIDE';
    end if;
  end if;

  begin
    insert into public.profiles (id, prenom, role)
    values (v_uid, v_prenom, p_role)
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'PRENOM_PRIS';
  end;

  -- Le code est consommé : plus personne ne pourra s'inscrire avec.
  if v_code_id is not null then
    update public.staff_codes
       set used_by       = v_uid,
           used_at       = now(),
           claimed_token = null,
           claimed_at    = null
     where id = v_code_id;
  end if;

  return jsonb_build_object(
    'id',     v_profile.id,
    'prenom', v_profile.prenom,
    'role',   v_profile.role,
    'points', v_profile.points
  );
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3.3 Présence : « les élèves connectés »
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_now timestamptz := now();
begin
  update public.profiles
     set last_seen_at = v_now
   where id = auth.uid();
  return v_now;
end
$fn$;

-- Vrai si le compte est passé par là récemment (fenêtre réglable).
create or replace function public.online_count()
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select count(*)::integer
    from public.profiles p, public.app_settings s
   where s.id = 1
     and p.role = 'eleve'
     and p.last_seen_at > now() - make_interval(secs => s.online_window_seconds);
$fn$;

-- ---------------------------------------------------------------------------
-- 3.4 Donner des points (délégué ; suppléant si le réglage l'autorise)
-- ---------------------------------------------------------------------------
create or replace function public.award_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_min    integer;
  v_max    integer;
  v_target public.profiles;
begin
  if not public.can_award() then
    raise exception 'INTERDIT';
  end if;

  select award_min, award_max into v_min, v_max from public.app_settings where id = 1;

  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_actor then
    raise exception 'CIBLE_INVALIDE';
  end if;

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'ELEVE_INTROUVABLE';
  end if;
  if v_target.role <> 'eleve' then
    raise exception 'CIBLE_INVALIDE';
  end if;

  update public.profiles
     set points = points + p_amount
   where id = p_target;

  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('gain', p_amount, p_target, v_actor);

  return jsonb_build_object('prenom', v_target.prenom, 'points', v_target.points + p_amount);
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3.5 Retirer des points (le montant voulu, dans la limite du solde)
-- ---------------------------------------------------------------------------
create or replace function public.remove_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor   uuid := auth.uid();
  v_target  public.profiles;
  v_removed integer;
begin
  if not public.can_award() then
    raise exception 'INTERDIT';
  end if;

  if p_amount is null or p_amount < 1 then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_actor then
    raise exception 'CIBLE_INVALIDE';
  end if;

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'ELEVE_INTROUVABLE';
  end if;
  if v_target.role <> 'eleve' then
    raise exception 'CIBLE_INVALIDE';
  end if;

  -- Le solde ne peut pas descendre sous zéro : on retire au maximum ce qu'il y a.
  v_removed := least(p_amount, v_target.points);

  if v_removed = 0 then
    return jsonb_build_object('prenom', v_target.prenom, 'points', 0, 'retires', 0);
  end if;

  update public.profiles
     set points = points - v_removed
   where id = p_target;

  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('retrait', v_removed, p_target, v_actor);

  return jsonb_build_object('prenom', v_target.prenom, 'points', v_target.points - v_removed, 'retires', v_removed);
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3.6 Échange de points entre élèves (transfert direct)
-- ---------------------------------------------------------------------------
create or replace function public.transfer_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from uuid := auth.uid();
  v_min  integer;
  v_a    public.profiles;   -- l'expéditeur (moi)
  v_b    public.profiles;   -- le destinataire
begin
  select transfer_min into v_min from public.app_settings where id = 1;

  if p_amount is null or p_amount < v_min then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_from then
    raise exception 'CIBLE_INVALIDE';
  end if;

  -- Verrouillage dans un ordre déterministe pour éviter tout interblocage
  -- quand deux élèves s'envoient des points au même moment.
  if v_from < p_target then
    select * into v_a from public.profiles where id = v_from   for update;
    select * into v_b from public.profiles where id = p_target for update;
  else
    select * into v_b from public.profiles where id = p_target for update;
    select * into v_a from public.profiles where id = v_from   for update;
  end if;

  if v_a.id is null then
    raise exception 'NON_CONNECTE';
  end if;
  if v_b.id is null then
    raise exception 'ELEVE_INTROUVABLE';
  end if;
  if v_a.role <> 'eleve' then
    raise exception 'INTERDIT';
  end if;
  if v_b.role <> 'eleve' then
    raise exception 'CIBLE_INVALIDE';
  end if;
  if v_a.points < p_amount then
    raise exception 'POINTS_INSUFFISANTS';
  end if;

  update public.profiles set points = points - p_amount where id = v_from;
  update public.profiles set points = points + p_amount where id = p_target;

  insert into public.point_events (kind, amount, subject_id, counterparty_id, actor_id)
  values ('transfert', p_amount, v_from, p_target, v_from);

  return jsonb_build_object(
    'points',        v_a.points - p_amount,
    'cible_prenom',  v_b.prenom,
    'cible_points',  v_b.points + p_amount
  );
end
$fn$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------
-- claim_staff_code doit être appelable avant d'être connecté (anonyme).
grant execute on function public.claim_staff_code(text, text)              to anon, authenticated;
grant execute on function public.activate_account(text, text, uuid)        to authenticated;
grant execute on function public.heartbeat()                               to authenticated;
grant execute on function public.online_count()                            to anon, authenticated;
grant execute on function public.award_points(uuid, integer)               to authenticated;
grant execute on function public.remove_points(uuid, integer)              to authenticated;
grant execute on function public.transfer_points(uuid, integer)            to authenticated;
