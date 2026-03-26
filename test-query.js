import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function test() {
  const { data, error } = await sb.from('appointments')
    .select('patient_name, appointment_date, status, created_at, phone_number')
    .order('created_at', { ascending: false })
    .limit(5)
  console.log('Appointments:', data)
  console.log('Error:', error)
}
test().then(() => process.exit(0)).catch(console.error)
