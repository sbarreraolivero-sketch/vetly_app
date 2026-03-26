create table if not exists campaigns (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid references clinic_settings(id) on delete cascade not null,
  name text not null,
  segment_tag text, -- Tag to filter patients by, e.g. 'Botox'
  template_name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'completed', 'failed')),
  scheduled_at timestamptz,
  sent_count integer default 0,
  total_target integer default 0,
  created_at timestamptz default now()
);

alter table campaigns enable row level security;

create policy "Users can view campaigns of their clinic"
  on campaigns for select
  using (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

create policy "Users can insert campaigns for their clinic"
  on campaigns for insert
  with check (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

create policy "Users can update campaigns of their clinic"
  on campaigns for update
  using (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

create policy "Users can delete campaigns of their clinic"
  on campaigns for delete
  using (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

-- Add campaign_id to messages to track which campaign authorized the message
alter table messages 
add column if not exists campaign_id uuid references campaigns(id) on delete set null;

create index if not exists idx_messages_campaign_id on messages(campaign_id);
create index if not exists idx_campaigns_clinic_id on campaigns(clinic_id);
