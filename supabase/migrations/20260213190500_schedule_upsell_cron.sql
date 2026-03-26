select
  cron.schedule(
    'process-upsell-hourly',
    '30 * * * *', -- Run at minute 30 of every hour (offset from reminders/surveys)
    $$
    select
      net.http_post(
        url:='https://[YOUR_PROJECT_ID].supabase.co/functions/v1/cron-process-upsell',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer [YOUR_SERVICE_ROLE_KEY]"}'::jsonb
      ) as request_id;
    $$
  );
