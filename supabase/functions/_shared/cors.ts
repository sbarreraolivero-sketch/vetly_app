// CORS con Access-Control-Allow-Origin: '*' es INTENCIONAL.
// Este archivo lo usan funciones llamadas desde el BROWSER (chat-agent, ai-simulator),
// no desde webhooks externos. Los webhooks (ycloud, mercadopago, lemonsqueezy)
// usan sus propios headers CORS restrictivos definidos en cada función.
// NO cambiar a un origen específico aquí sin revisar qué funciones lo importan.

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
