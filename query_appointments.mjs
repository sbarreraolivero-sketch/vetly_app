import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.VITE_SUPABASE_URL || 'https://hubjqllcmbzoojyidgcu.supabase.co';
const SB_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const sb = createClient(SB_URL, SB_KEY);
async function run() {
  const { data, error } = await sb.from("appointments").select("appointment_date, patient_name").order("created_at", { ascending: false }).limit(2);
  console.log(data, error);
}
run();
