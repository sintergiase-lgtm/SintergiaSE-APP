-- Local synthetic QA only. Never apply this partial schema to a hosted project.
create schema if not exists sintergia;

create table if not exists sintergia.server_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

create table if not exists sintergia.app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table sintergia.server_secrets enable row level security;
alter table sintergia.app_state enable row level security;

-- Public synthetic credential used only by this local test stack.
insert into sintergia.server_secrets(name, value)
values ('session_hmac', 'local-qa-only-hmac-secret-not-a-production-value')
on conflict (name) do update set value = excluded.value;

CREATE OR REPLACE FUNCTION sintergia.touch_app_state_v18(p_id text, p_state jsonb, p_updated_by text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'sintergia'
AS $function$
DECLARE
 v bigint; old_state jsonb; merged jsonb; k text; peer_id text; canonical_id text;
 incoming_horario jsonb; old_horario jsonb; horario_old_ts timestamptz; horario_new_ts timestamptz;
BEGIN
 IF p_id IS NULL OR btrim(p_id)='' OR length(p_id)>128 THEN
   RAISE EXCEPTION 'invalid_app_state_id';
 END IF;
 IF p_state IS NULL OR jsonb_typeof(p_state) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'invalid_app_state_payload';
 END IF;
 canonical_id:=CASE WHEN p_id IN ('admin','tecnico') THEN 'sintergia-operativo' ELSE p_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended(canonical_id,0));
 SELECT state INTO old_state FROM sintergia.app_state WHERE id=canonical_id FOR UPDATE;
 merged:=CASE WHEN old_state IS NULL THEN p_state ELSE old_state||p_state END;
 FOREACH k IN ARRAY ARRAY['clientes','partes','facturas','pendientes','stock','stockListas','compras'] LOOP
   IF old_state IS NOT NULL AND (old_state?k OR p_state?k) THEN
     merged:=jsonb_set(merged,ARRAY[k],sintergia.merge_entity_array_v18(old_state->k,p_state->k),true);
   ELSIF old_state IS NULL AND p_state?k THEN
     merged:=jsonb_set(merged,ARRAY[k],sintergia.merge_entity_array_v18('[]'::jsonb,p_state->k),true);
   END IF;
 END LOOP;
 IF (old_state IS NOT NULL AND old_state?'tombstones') OR p_state?'tombstones' THEN
   merged:=jsonb_set(merged,ARRAY['tombstones'],sintergia.merge_tombstone_array_v18(old_state->'tombstones',p_state->'tombstones'),true);
 ELSE
   merged:=jsonb_set(merged,ARRAY['tombstones'],'[]'::jsonb,true);
 END IF;
 FOREACH k IN ARRAY ARRAY['clientes','partes','facturas','pendientes','stock','stockListas','compras'] LOOP
   IF merged?k THEN
     merged:=jsonb_set(merged,ARRAY[k],sintergia.filter_tombstoned_entities_v18(k,merged->k,merged->'tombstones'),true);
   END IF;
 END LOOP;
 IF (old_state IS NOT NULL AND old_state?'horario') OR p_state?'horario' THEN
   old_horario:=COALESCE(old_state->'horario','{}'::jsonb);
   incoming_horario:=COALESCE(p_state->'horario','{}'::jsonb);
   horario_old_ts:=sintergia.safe_timestamptz_v18(old_horario->>'updatedAt');
   horario_new_ts:=sintergia.safe_timestamptz_v18(incoming_horario->>'updatedAt');
   IF old_state IS NULL OR horario_new_ts>=horario_old_ts THEN
     merged:=jsonb_set(merged,ARRAY['horario'],incoming_horario,true);
   ELSE
     merged:=jsonb_set(merged,ARRAY['horario'],old_horario,true);
   END IF;
 END IF;
 merged:=jsonb_set(merged,ARRAY['serverMergedAt'],to_jsonb(now()),true);
 merged:=jsonb_set(merged,ARRAY['syncSchema'],to_jsonb(8),true);
 INSERT INTO sintergia.app_state(id,state,version,updated_by) VALUES(canonical_id,merged,1,p_updated_by)
 ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,version=sintergia.app_state.version+1,updated_at=now(),updated_by=EXCLUDED.updated_by
 RETURNING version INTO v;
 IF p_id IN ('admin','tecnico') THEN
  FOREACH peer_id IN ARRAY ARRAY['admin','tecnico'] LOOP
   INSERT INTO sintergia.app_state(id,state,version,updated_by) VALUES(peer_id,merged,v,p_updated_by)
   ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,updated_at=now(),updated_by=EXCLUDED.updated_by;
  END LOOP;
 END IF;
 RETURN v;
END;
$function$

