import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('.env', 'utf-8')
const getEnv = (key) => env.split('\n').find(l => l.startsWith(key))?.split('=')[1]

const supabase = createClient(getEnv('VITE_SUPABASE_URL'), getEnv('VITE_SUPABASE_ANON_KEY'))

async function check() {
    const { data: users } = await supabase.from('user_profiles').select('*').eq('email', 'elizabeth.zibaaa@gmail.com')
    console.log('User profile:', users)
    if (users?.length) {
        const cid = users[0].clinic_id
        const { data: sub } = await supabase.from('subscriptions').select('*').eq('clinic_id', cid)
        console.log('Sub:', sub)
        const { data: cs } = await supabase.from('clinic_settings').select('*').eq('id', cid)
        console.log('Settings:', cs)
    }
}

check()
