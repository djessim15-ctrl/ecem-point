-- ---------------------------------------------------------------------------
-- 0020 · Les délégués et les suppléants peuvent, eux aussi, gagner des points
--
-- Jusqu'ici seuls les élèves pouvaient recevoir des points : un délégué ou un
-- suppléant donnait, mais n'avait jamais de solde. C'est terminé.
--
--   • `award_points()` et `remove_points()` acceptent n'importe quel compte
--     comme cible (sauf soi-même).
--   • `transfer_points()` n'impose plus que les deux comptes soient élèves :
--     on peut envoyer des points à un délégué et un délégué peut en envoyer.
--   • `wheel_spin()` n'est plus réservé aux élèves : la roue hebdomadaire est
--     ouverte à tous les rôles.
--
-- Rien d'autre ne bouge : le droit de *donner* reste contrôlé par
-- `can_award()` (délégué, ou suppléant si `suppleant_can_award`), un compte ne
-- peut jamais s'auto-attribuer des points, et chaque mouvement reste
-- journalisé dans `point_events`.
-- ---------------------------------------------------------------------------

-- 1. Donner des points ------------------------------------------------------
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
  v_golden boolean;
  v_mult   integer;
  v_amount integer;
  v_event  uuid;
  v_target public.profiles;
begin
  if not public.can_award() then
    raise exception 'INTERDIT';
  end if;

  select award_min, award_max, golden_multiplier,
         (golden_until is not null and golden_until > now())
    into v_min, v_max, v_mult, v_golden
    from public.app_settings where id = 1;

  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_actor then
    raise exception 'CIBLE_INVALIDE';
  end if;

  v_amount := p_amount * case when v_golden then coalesce(v_mult, 2) else 1 end;

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'ELEVE_INTROUVABLE';
  end if;

  -- Plus de filtre sur le rôle : un délégué ou un suppléant peut en donner
  -- comme en recevoir.

  update public.profiles set points = points + v_amount where id = p_target;

  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('gain', v_amount, p_target, v_actor)
  returning id into v_event;

  return jsonb_build_object(
    'prenom', v_target.prenom,
    'points', v_target.points + v_amount,
    'amount', v_amount,
    'bonus', v_amount - p_amount,
    'event_id', v_event
  );
end
$fn$;

-- 2. Retirer des points -----------------------------------------------------
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
  v_event   uuid;
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

  v_removed := least(p_amount, v_target.points);

  if v_removed = 0 then
    return jsonb_build_object('prenom', v_target.prenom, 'points', 0, 'retires', 0, 'event_id', null);
  end if;

  update public.profiles set points = points - v_removed where id = p_target;

  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('retrait', v_removed, p_target, v_actor)
  returning id into v_event;

  return jsonb_build_object(
    'prenom', v_target.prenom,
    'points', v_target.points - v_removed,
    'retires', v_removed,
    'event_id', v_event
  );
end
$fn$;

-- 3. Envoyer ses points à quelqu'un -----------------------------------------
create or replace function public.transfer_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from  uuid := auth.uid();
  v_min   integer;
  v_a     public.profiles;
  v_b     public.profiles;
  v_event uuid;
begin
  select transfer_min into v_min from public.app_settings where id = 1;

  if p_amount is null or p_amount < v_min then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_from then
    raise exception 'CIBLE_INVALIDE';
  end if;

  -- Verrouillage toujours dans le même ordre, pour éviter les interblocages.
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
  if v_a.points < p_amount then
    raise exception 'POINTS_INSUFFISANTS';
  end if;

  update public.profiles set points = points - p_amount where id = v_from;
  update public.profiles set points = points + p_amount where id = p_target;

  insert into public.point_events (kind, amount, subject_id, counterparty_id, actor_id)
  values ('transfert', p_amount, v_from, p_target, v_from)
  returning id into v_event;

  return jsonb_build_object(
    'points',       v_a.points - p_amount,
    'cible_prenom', v_b.prenom,
    'cible_points', v_b.points + p_amount,
    'event_id',     v_event
  );
end
$fn$;

-- 4. Roue de la fortune : ouverte à tous les rôles --------------------------
create or replace function public.wheel_spin()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_lundi date := date_trunc('week', now())::date;
  v_gain  integer;
  v_roue  integer[] := array[1, 1, 1, 2, 2, 3, 5];
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  if exists (select 1 from public.wheel_spins where user_id = v_uid and week_start = v_lundi) then
    raise exception 'DEJA_TOURNE';
  end if;

  v_gain := v_roue[1 + floor(random() * array_length(v_roue, 1))::int];

  insert into public.wheel_spins (user_id, week_start, amount) values (v_uid, v_lundi, v_gain);

  update public.profiles set points = points + v_gain where id = v_uid;
  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('gain', v_gain, v_uid, null);

  return jsonb_build_object('gain', v_gain);
end
$fn$;

revoke all on function public.award_points(uuid, integer) from public;
revoke all on function public.remove_points(uuid, integer) from public;
revoke all on function public.transfer_points(uuid, integer) from public;
revoke all on function public.wheel_spin() from public;

grant execute on function public.award_points(uuid, integer) to authenticated;
grant execute on function public.remove_points(uuid, integer) to authenticated;
grant execute on function public.transfer_points(uuid, integer) to authenticated;
grant execute on function public.wheel_spin() to authenticated;
