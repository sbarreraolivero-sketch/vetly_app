-- Idempotencia de eventos Meta CAPI por tutor.
--
-- Contexto: hasta ahora LeadSubmitted se disparaba con el primer mensaje de cualquier
-- contacto nuevo que viniera de un anuncio C2W (294 eventos enviados a Meta entre el
-- 25-jun y el 18-jul). Esa definicion no distingue intencion: el 98,5% de los leads
-- medidos mencionaba precio, comuna o servicio, asi que filtrar por palabras clave no
-- discriminaba nada. La senal que si separa es la profundidad de la conversacion.
--
-- Estas dos columnas permiten disparar cada evento una sola vez por tutor, ahora que
-- LeadSubmitted deja de coincidir con "primer mensaje" y Purchase puede dispararse
-- tanto desde el AI agent como desde el dashboard.

ALTER TABLE public.tutors
    ADD COLUMN IF NOT EXISTS capi_lead_sent_at     TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS capi_purchase_sent_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.tutors.capi_lead_sent_at IS
    'Momento en que se envio LeadSubmitted a Meta CAPI por este tutor. NULL = nunca enviado.';
COMMENT ON COLUMN public.tutors.capi_purchase_sent_at IS
    'Momento en que se envio Purchase a Meta CAPI por este tutor. NULL = nunca enviado.';

-- Los tutores que ya recibieron LeadSubmitted bajo la regla anterior quedan marcados
-- para no reportarlos otra vez cuando alcancen el nuevo umbral de 3 mensajes.
UPDATE public.tutors
SET capi_lead_sent_at = COALESCE(created_at, NOW())
WHERE ctwa_clid IS NOT NULL
  AND capi_lead_sent_at IS NULL;
