-- Sistema genérico de captura de leads para recursos gratuitos (checklists,
-- calculadoras, diagnósticos, etc. en public/recursos/). Reusable para
-- CUALQUIER recurso nuevo — solo cambia `resource_slug`. A diferencia de
-- `diagnostic_leads` (INSERT directo desde el navegador con la anon key),
-- acá el insert SIEMPRE pasa por la edge function `resource-lead-capture`
-- (service_role) porque también dispara el envío del correo con el
-- resultado vía Resend — no tiene sentido exponer un policy anon-insert
-- cuando de todos modos hace falta la function para el correo.

create table public.resource_leads (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    resource_slug text not null,          -- 'checklist-a-ciegas', futuros: 'calculadora', etc.
    full_name text not null,
    email text not null,
    marketing_opt_in boolean not null default false,  -- checkbox explícito, para la secuencia de correos futura
    score integer,
    score_pct integer,
    level text,
    answers jsonb,
    email_sent boolean not null default false,
    resend_id text,
    wa_clicked boolean not null default false,
    source_url text,
    referrer text
);

create index resource_leads_slug_idx on public.resource_leads (resource_slug, created_at desc);
create index resource_leads_opt_in_idx on public.resource_leads (resource_slug) where marketing_opt_in = true;
create index resource_leads_email_idx on public.resource_leads (email);

alter table public.resource_leads enable row level security;

-- Solo service_role (la edge function) escribe. Sin policy de INSERT/UPDATE
-- para anon/authenticated a propósito — todo pasa por resource-lead-capture.
create policy service_role_all_resource_leads
    on public.resource_leads for all to service_role
    using (true) with check (true);

-- HQ puede ver todos los leads de recursos (mismo criterio que diagnostic_leads).
create policy hq_admin_select_resource_leads
    on public.resource_leads for select to authenticated
    using (is_platform_admin());

-- RPC para marcar el clic en WhatsApp desde la página pública (anon), sin
-- exponer ningún UPDATE directo sobre la tabla — mismo patrón ya usado por
-- mark_diagnostic_wa_clicked (sesión 41: nunca una policy anon UPDATE
-- abierta, siempre una RPC que solo puede tocar esa columna puntual).
create or replace function public.mark_resource_lead_wa_clicked(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.resource_leads set wa_clicked = true where id = p_id;
end;
$$;

revoke all on function public.mark_resource_lead_wa_clicked(uuid) from public;
grant execute on function public.mark_resource_lead_wa_clicked(uuid) to anon, authenticated;
