-- HQ (platform admin) debe poder registrar cargas manuales en el historial de créditos.
-- Antes solo existía SELECT, así que el insert de handleManualCharge fallaba en silencio.
create policy ai_credit_tx_platform_admin_insert on public.ai_credit_transactions
  for insert to public with check (public.is_platform_admin());
