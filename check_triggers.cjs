const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkTriggers() {
    const sql = `
    SELECT 
        tgname AS trigger_name,
        proname AS function_name,
        prosrc AS function_source
    FROM 
        pg_trigger t
    JOIN 
        pg_proc p ON t.tgfoid = p.oid
    JOIN 
        pg_class c ON t.tgrelid = c.oid
    WHERE 
        c.relname = 'appointments'
        AND t.tgisinternal = false;
  `;
    const { data, error } = await sb.rpc('execute_sql_internal', { sql });
    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

checkTriggers();
