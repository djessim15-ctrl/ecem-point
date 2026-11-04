-- ============================================================================
-- ECEM Point — codes d'encadrement réutilisables
-- ============================================================================
-- Un code délégué / suppléant peut désormais créer **plusieurs comptes**.
-- C'est le fonctionnement attendu en classe : le même code est distribué aux
-- délégués de l'année, et il ne « grille » plus après la première inscription.
--
-- Ce qui ne change pas :
--   • le code n'est jamais stocké en clair (empreinte sha256) ;
--   • il faut connaître le code pour s'inscrire comme délégué / suppléant ;
--   • `used_by` / `used_at` gardent la trace du dernier compte créé et
--     `use_count` compte les inscriptions.
-- ============================================================================

alter table public.staff_codes
  add column if not exists use_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- 1) Réservation : plus de filtre sur used_by
-- ---------------------------------------------------------------------------
create or replace function public.claim_staff_code(p_role text, p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_token   uuid := gen_random_uuid();
  v_hash    text;
  v_id      uuid;
  v_other   boolean;
begin
  if p_role is null or p_role not in ('suppleant', 'delegue') then
    raise exception 'ROLE_INVALIDE';
  end if;

  if p_code is null or char_length(btrim(p_code)) < 4 or char_length(btrim(p_code)) > 64 then
    raise exception 'CODE_INVALIDE';
  end if;

  v_hash := encode(extensions.digest(btrim(p_code), 'sha256'), 'hex');

  -- Libère les réservations périmées (inscription abandonnée en cours de route).
  update public.staff_codes
     set claimed_token = null,
         claimed_at    = null
   where claimed_token is not null
     and claimed_at < now() - interval '10 minutes';

  -- Un code déjà utilisé reste valable : on privilégie simplement une ligne
  -- encore vierge s'il en existe une, puis la plus ancienne.
  update public.staff_codes s
     set claimed_token = v_token,
         claimed_at    = now()
    from (
           select c.id
             from public.staff_codes c
            where c.role      = p_role
              and c.code_hash = v_hash
            order by (c.used_by is null) desc, c.created_at
            limit 1
         ) pick
   where s.id = pick.id
  returning s.id into v_id;

  if v_id is null then
    select exists (
      select 1 from public.staff_codes c
       where c.code_hash = v_hash
         and c.role <> p_role
    ) into v_other;

    if v_other then
      raise exception 'CODE_MAUVAIS_ROLE';
    end if;
    raise exception 'CODE_INVALIDE';
  end if;

  return v_token;
end
$function$;

-- ---------------------------------------------------------------------------
-- 2) Activation : accepte un code déjà consommé et compte les usages
-- ---------------------------------------------------------------------------
create or replace function public.activate_account(p_prenom text, p_role text, p_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  if p_role <> 'eleve' then
    if p_token is null then
      raise exception 'CODE_INVALIDE';
    end if;

    select c.id into v_code_id
      from public.staff_codes c
     where c.claimed_token = p_token
       and c.role          = p_role
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

  if v_code_id is not null then
    update public.staff_codes
       set used_by       = v_uid,
           used_at       = now(),
           use_count     = coalesce(use_count, 0) + 1,
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
$function$;
