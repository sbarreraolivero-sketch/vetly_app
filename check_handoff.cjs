const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await sb.from('crm_prospects').select('phone, requires_human').eq('phone', '+56957380466').single();
  console.log('Prospect:', data, 'Error:', error);
}
check();
