import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: configs, error } = await sb.from('clinic_settings').select('id, ycloud_phone_number, ycloud_api_key, openai_model').limit(2);
  console.log('Configs:', configs, 'Error:', error);
}
run();
