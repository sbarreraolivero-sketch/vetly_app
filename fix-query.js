import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
async function run() {
  const { data, error } = await sb.from('appointments').select('*').order('created_at', { ascending: false }).limit(2)
  console.log('Appointments:', JSON.stringify(data, null, 2))
}
run().then(() => process.exit(0)).catch(console.error)
