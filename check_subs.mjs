import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('.env', 'utf-8')
const getEnv = (key) => env.split('\n').find(l => l.startsWith(key))?.split('=')[1]

const supabase = createClient(getEnv('VITE_SUPABASE_URL'), getEnv('VITE_SUPABASE_ANON_KEY'))

async function check() {
  const { data: subs } = await supabase.from('subscriptions').select('*')
  console.log('Subs:', JSON.stringify(subs, null, 2))
}

check()
