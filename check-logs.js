import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
async function run() {
    console.log('--- Recent Debug Logs ---');
    const { data: logs, error: logError } = await sb.from('debug_logs').select('*').order('created_at', { ascending: false }).limit(10)
    if (logError) {
        console.error('Log Error:', logError)
    } else {
        console.log(JSON.stringify(logs, null, 2))
    }

    console.log('\n--- Recent Messages ---');
    const { data: msgs, error: msgError } = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(10)
    if (msgError) {
        console.error('Msg Error:', msgError)
    } else {
        console.log(JSON.stringify(msgs, null, 2))
    }
}
run().then(() => process.exit(0)).catch(console.error)


