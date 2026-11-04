-- ============================================================================
-- ECEM Point — messages d'erreur plus précis pour les codes d'inscription
-- ============================================================================
-- Avant : `CODE_INVALIDE` pour trois situations très différentes (code mal
-- recopié, code déjà consommé, code de l'autre rôle). Impossible de savoir
-- quoi corriger.
--
-- Après :
--   CODE_INVALIDE      le code n'existe pas (faute de frappe, code d'un autre
--                      projet Supabase…) ;
--   CODE_DEJA_UTILISE  ce code a déjà créé un compte : il faut se connecter
--                      avec (prénom + ce code comme mot de passe) ;
--   CODE_MAUVAIS_ROLE  le code existe, mais pour l'autre rôle (délégué vs
--                      suppléant) : la case cochée n'est pas la bonne.
--
-- Le code est désormais comparé après `btrim()` : un espace ajouté par un
-- clavier de téléphone ne fait plus échouer l'inscription.
-- ============================================================================

create or replace function public.claim_staff_code(p_role text, p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_token  uuid := gen_random_uuid();
  v_hash   text;
  v_id     uuid;
  v_reason text;
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

  update public.staff_codes s
     set claimed_token = v_token,
         claimed_at    = now()
    from (
           select c.id
             from public.staff_codes c
            where c.role          = p_role
              and c.code_hash     = v_hash
              and c.used_by       is null
              and c.claimed_token is null
            order by c.created_at
            limit 1
         ) pick
   where s.id = pick.id
  returning s.id into v_id;

  if v_id is null then
    select case
             when exists (
               select 1 from public.staff_codes c
                where c.code_hash = v_hash
                  and c.used_by is not null
             ) then 'used'
             when exists (
               select 1 from public.staff_codes c
                where c.code_hash = v_hash
                  and c.role <> p_role
             ) then 'role'
             else 'none'
           end
      into v_reason;

    if v_reason = 'used' then
      raise exception 'CODE_DEJA_UTILISE';
    end if;
    if v_reason = 'role' then
      raise exception 'CODE_MAUVAIS_ROLE';
    end if;
    raise exception 'CODE_INVALIDE';
  end if;

  return v_token;
end
$function$;
