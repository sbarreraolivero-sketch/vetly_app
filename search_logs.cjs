const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function search() {
  const { data, error } = await sb.from('debug_logs')
    .select('*')
    .or('payload->>phone.eq.+56986270988,payload->whatsappInboundMessage->>from.eq.+56986270988')
    .order('created_at', { ascending: false });
  console.log('Logs:', JSON.stringify(data, null, 2));
}
search();
