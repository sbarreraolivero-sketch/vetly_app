import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
    console.log('--- Checking messages table columns ---');
    // We can try to select a single row and see what we get, 
    // but if it fails with RLS we might need another way.
    // However, if we can see debug_logs, maybe we can see others.
    
    // Let's try to insert a dummy message WITHOUT payload to see if it works.
    const { data, error } = await sb.from('messages').insert({
        clinic_id: '00000000-0000-0000-0000-000000000000', // HQ_ID
        phone_number: 'test',
        content: 'test content',
        direction: 'inbound'
    }).select()
    
    if (error) {
        console.error('Insert Error:', error)
    } else {
        console.log('Insert Success:', data)
    }
}

run().then(() => process.exit(0)).catch(console.error)
