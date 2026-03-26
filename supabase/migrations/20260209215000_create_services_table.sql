create table if not exists services (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid references clinic_settings(id) on delete cascade not null,
  name text not null,
  duration integer not null,
  price numeric not null,
  upselling_enabled boolean default false,
  upselling_days_after integer default 0,
  upselling_message text,
  created_at timestamptz default now()
);

alter table services enable row level security;

create policy "Users can view services of their clinic"
  on services for select
  using (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

create policy "Users can insert services for their clinic"
  on services for insert
  with check (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

create policy "Users can update services of their clinic"
  on services for update
  using (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));

create policy "Users can delete services of their clinic"
  on services for delete
  using (clinic_id in (
    select clinic_id from user_profiles where id = auth.uid()
  ));
