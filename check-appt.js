import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
    const { data, error } = await sb.from('appointments').select('id, patient_name, service, status, payment_status, price, appointment_date').order('created_at', { ascending: false }).limit(5);
    console.log('Recent appointments:', JSON.stringify(data, null, 2));
    if (error) console.log('Error:', error);
}
run();
