alter table appointments 
add column if not exists upsell_sent_at timestamptz;

-- Index for faster querying by status and date
create index if not exists idx_appointments_upsell_status 
on appointments(status, upsell_sent_at, appointment_date);
