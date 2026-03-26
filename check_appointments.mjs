import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envStr = fs.readFileSync('.env', 'utf-8')
const lines = envStr.split('\n').map(l => l.trim())
const urlObj = lines.find(l => l.startsWith('VITE_SUPABASE_URL='))
const keyObj = lines.find(l => l.startsWith('VITE_SUPABASE_ANON_KEY='))

const url = urlObj.substring('VITE_SUPABASE_URL='.length).trim()
const key = keyObj.substring('VITE_SUPABASE_ANON_KEY='.length).trim()

const supabase = createClient(url, key)

async function check() {
    const { data: users } = await supabase.from('user_profiles').select('*').eq('email', 'elizabeth.zibaaa@gmail.com')
    if (users?.length) {
        const cid = users[0].clinic_id
        const { data: appts } = await supabase.from('appointments').select('*').eq('clinic_id', cid).ilike('patient_name', '%Cecilia%').order('created_at', { ascending: false }).limit(5)
        console.log('Appts:', appts)
    }
}

check()
