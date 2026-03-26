const { createClient } = require('@supabase/supabase-js');

const url = "https://hubjqllcmbzoojyidgcu.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmpxbGxjbWJ6b29qeWlkZ2N1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDE0OTc3MCwiZXhwIjoyMDg1NzI1NzcwfQ.lnOepDZP06NwIvROxdHZG6sLST4vJs51QIDCQs7cF6o";
const sb = createClient(url, key);

async function check() {
    const { data, error } = await sb.rpc('execute_sql_internal', {
        sql: `
      SELECT
          conname AS constraint_name,
          pg_get_constraintdef(c.oid) AS constraint_definition
      FROM
          pg_constraint c
      JOIN
          pg_namespace n ON n.oid = c.connamespace
      JOIN
          pg_class rel ON rel.oid = c.conrelid
      WHERE
          contype IN ('u', 'p')
          AND n.nspname = 'public'
          AND rel.relname = 'patients';
    `
    });

    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}
check();
