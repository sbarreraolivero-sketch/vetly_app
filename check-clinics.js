import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
    const { data, error } = await sb.from('clinic_settings').select('*');
    console.log('Data:', data, 'Error:', error);
}
run();
