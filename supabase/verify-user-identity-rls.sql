-- Rollback-only checks for migration 007.
-- Run the entire script in the Supabase SQL Editor. It inserts temporary auth
-- users and one occurrence, then rolls every fixture back. Do not commit.
--
-- Requires 007_add_user_identity.sql and at least one raw events row whose id
-- is not also an event_occurrences.id.

begin;
do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  fixture_id uuid;
  fixture_occurrence_id uuid;
  raw_event_id uuid;
  names text[];
  literals text[];
  literal text;
  col record;
  blocked boolean;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Apply supabase/migrations/007_add_user_identity.sql before this verification';
  end if;

  foreach fixture_id in array array[user_a, user_b] loop
    names := array[]::text[];
    literals := array[]::text[];
    for col in
      select column_name, data_type, is_nullable, column_default, is_generated, is_identity
      from information_schema.columns
      where table_schema = 'auth' and table_name = 'users'
      order by ordinal_position
    loop
      if col.is_generated = 'ALWAYS' or col.is_identity = 'YES' then
        continue;
      end if;
      literal := case col.column_name
        when 'id' then quote_literal(fixture_id::text) || '::uuid'
        when 'instance_id' then quote_literal('00000000-0000-0000-0000-000000000000') || '::uuid'
        when 'aud' then quote_literal('authenticated')
        when 'role' then quote_literal('authenticated')
        when 'email' then quote_literal(fixture_id::text || '@campusradar.invalid')
        when 'encrypted_password' then quote_literal('rollback-only')
        when 'email_confirmed_at' then 'now()'
        when 'raw_app_meta_data' then quote_literal('{"provider":"email","providers":["email"]}') || '::jsonb'
        when 'raw_user_meta_data' then quote_literal('{}') || '::jsonb'
        when 'created_at' then 'now()'
        when 'updated_at' then 'now()'
        else null
      end;
      if literal is null then
        if col.column_default is not null or col.is_nullable = 'YES' then
          continue;
        end if;
        literal := case col.data_type
          when 'uuid' then 'gen_random_uuid()'
          when 'text' then quote_literal('')
          when 'character varying' then quote_literal('')
          when 'boolean' then 'false'
          when 'smallint' then '0'
          when 'integer' then '0'
          when 'bigint' then '0'
          when 'jsonb' then quote_literal('{}') || '::jsonb'
          when 'json' then quote_literal('{}') || '::json'
          when 'timestamp with time zone' then 'now()'
          when 'timestamp without time zone' then 'now()'
          else null
        end;
        if literal is null then
          raise exception 'auth.users.% (%) has no rollback-test placeholder', col.column_name, col.data_type;
        end if;
      end if;
      names := array_append(names, quote_ident(col.column_name));
      literals := array_append(literals, literal);
    end loop;
    execute format(
      'insert into auth.users (%s) values (%s)',
      array_to_string(names, ', '),
      array_to_string(literals, ', ')
    );
  end loop;

  if (select count(*) from public.profiles where id in (user_a, user_b)) <> 2 then
    raise exception 'Profile trigger did not create a row for each new auth user';
  end if;

  insert into public.event_occurrences default values returning id into fixture_occurrence_id;
  select e.id into raw_event_id
  from public.events e
  where not exists (
    select 1 from public.event_occurrences o where o.id = e.id
  )
  limit 1;
  if raw_event_id is null then
    raise exception 'Need one events.id that is not an event_occurrences.id';
  end if;

  insert into public.profile_career_interests (user_id, interest_slug)
  values (user_b, 'consulting');
  insert into public.user_occurrence_states (user_id, occurrence_id, status)
  values (user_b, fixture_occurrence_id, 'interested');

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text,
    true
  );

  set local role anon;
  blocked := false;
  begin
    perform 1 from public.profiles limit 1;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'anon read profiles'; end if;
  blocked := false;
  begin
    perform 1 from public.user_occurrence_states limit 1;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'anon read occurrence states'; end if;
  if (select count(*) from public.career_interests) <> 11 then
    raise exception 'anon could not read the career-interest vocabulary';
  end if;
  perform 1 from public.events limit 1;
  perform 1 from public.event_occurrences limit 1;
  blocked := false;
  begin
    insert into public.events default values;
  exception
    when insufficient_privilege then
      blocked := true;
    when not_null_violation then
      raise exception 'anon passed the events privilege check';
  end;
  if not blocked then raise exception 'anon wrote events'; end if;

  set local role authenticated;
  if (select count(*) from public.profiles) <> 1
    or (select id from public.profiles) <> user_a then
    raise exception 'profile read was not limited to auth.uid()';
  end if;
  if exists (select 1 from public.profile_career_interests where user_id = user_b) then
    raise exception 'career-interest read crossed users';
  end if;
  if exists (select 1 from public.user_occurrence_states where user_id = user_b) then
    raise exception 'occurrence-state read crossed users';
  end if;

  update public.profiles set updated_at = created_at where id = user_a;
  if not found then raise exception 'user could not update own profile'; end if;
  update public.profiles set updated_at = now() where id = user_b;
  if found then raise exception 'user updated another profile'; end if;

  blocked := false;
  begin
    insert into public.profiles (id) values (user_a);
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'user inserted a profile directly'; end if;

  insert into public.profile_career_interests (user_id, interest_slug)
  values (user_a, 'software-engineering');
  blocked := false;
  begin
    insert into public.profile_career_interests (user_id, interest_slug)
    values (user_b, 'fintech');
  exception when insufficient_privilege then
    blocked := true;
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  if not blocked then raise exception 'cross-user career-interest insert succeeded'; end if;

  blocked := false;
  begin
    insert into public.user_occurrence_states (user_id, occurrence_id, status)
    values (user_a, raw_event_id, 'interested');
  exception when foreign_key_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'events.id was accepted as an occurrence id'; end if;

  insert into public.user_occurrence_states (user_id, occurrence_id, status)
  values (user_a, fixture_occurrence_id, 'interested');
  update public.user_occurrence_states
  set status = 'going'
  where user_id = user_a and occurrence_id = fixture_occurrence_id;
  if not found then raise exception 'user could not update own occurrence state'; end if;
  blocked := false;
  begin
    update public.user_occurrence_states
    set status = 'already_going'
    where user_id = user_a and occurrence_id = fixture_occurrence_id;
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'invalid occurrence status was stored'; end if;
  if (select status from public.user_occurrence_states where user_id = user_a) <> 'going' then
    raise exception 'rejected status update changed the stored state';
  end if;
  update public.user_occurrence_states
  set status = 'going'
  where user_id = user_b;
  if found then raise exception 'user updated another occurrence state'; end if;

  delete from public.user_occurrence_states
  where user_id = user_a and occurrence_id = fixture_occurrence_id;
  if not found then raise exception 'user could not clear own occurrence state'; end if;
  if exists (
    select 1 from public.user_occurrence_states where user_id = user_a
  ) then
    raise exception 'cleared occurrence state row remained';
  end if;

  reset role;
end $$;
rollback;

select 'PASS: own-row RLS, anon event reads, events.id rejected, unset row, fixtures rolled back' as user_identity_rls;
