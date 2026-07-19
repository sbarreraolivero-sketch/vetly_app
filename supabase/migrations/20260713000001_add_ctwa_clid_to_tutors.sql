-- Persistir el ctwa_clid (Click-to-WhatsApp ad click ID) del primer contacto.
-- Meta solo adjunta este dato en el mensaje inicial que resulta de tocar el anuncio;
-- el agendamiento real ocurre varios mensajes (y varias invocaciones del webhook) después,
-- por lo que sin persistirlo el evento Purchase de Meta CAPI nunca puede dispararse.
ALTER TABLE public.tutors ADD COLUMN IF NOT EXISTS ctwa_clid TEXT DEFAULT NULL;
