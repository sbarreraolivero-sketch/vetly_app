const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function search() {
  const { data, error } = await sb.from('debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  console.log('Logs:', JSON.stringify(data, null, 2));
}
search();
