import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

console.log('ANON length:', process.env.VITE_SUPABASE_ANON_KEY?.length);
console.log('ROLE length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY.trim());

async function run() {
    const { data, error } = await sb.from('debug_logs').select('*').order('created_at', { ascending: false }).limit(5);
    console.log('Logs:', data);
    console.log('Error:', error);
}
run();
