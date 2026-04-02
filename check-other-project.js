import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = "https://hubjqllcmbzoojyidgcu.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmpxbGxjbWJ6b29qeWlkZ2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxNDk3NzAsImV4cCI6MjA4NTcyNTc3MH0.Zdnra9emXSIfmDJibsRqE-QJcvlUNK9VaGHZd0w1kv8"
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    const email = 'claubarreraolivero@gmail.com'
    console.log(`Checking for email in Hub project: ${email}`)

    // 1. Check clinic_members
    const { data: members, error: err1 } = await supabase
        .from('clinic_members')
        .select('*, clinic_settings(*)')
        .eq('email', email)
    
    console.log('Members:', JSON.stringify(members, null, 2))
}

check()
