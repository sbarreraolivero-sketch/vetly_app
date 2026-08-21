/**
 * Crea en Paddle el pack de créditos para análisis de facturas (plan Core).
 *
 * Uso:
 *   PADDLE_API_KEY=pdl_live_... node scripts/create-paddle-invoice-pack.js
 *
 * Al terminar imprime el priceId: pégalo en `PADDLE_CREDIT_PACKS.pack_facturas`
 * (src/lib/paddle.ts). Mientras ese campo esté vacío, el checkout internacional
 * de este pack corta con un mensaje claro en vez de abrir un overlay roto.
 */
const KEY = process.env.PADDLE_API_KEY;
const HOST = (process.env.PADDLE_ENVIRONMENT || 'production') === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

if (!KEY) {
    console.error('Falta PADDLE_API_KEY. Génerala en Paddle → Developer tools → Authentication.');
    process.exit(1);
}

const api = async (ruta, body) => {
    const r = await fetch(`${HOST}${ruta}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
        console.error(`Error en ${ruta}:`, JSON.stringify(j.error || j, null, 2));
        process.exit(1);
    }
    return j.data;
};

const main = async () => {
    const producto = await api('/products', {
        name: 'Pack Facturas — Créditos IA',
        description: '600 créditos de IA para análisis de facturas (unas 30 facturas). Pago único, sin vencimiento.',
        tax_category: 'saas',
    });
    console.log('producto:', producto.id);

    const precio = await api('/prices', {
        product_id: producto.id,
        description: '600 créditos IA',
        unit_price: { amount: '300', currency_code: 'USD' }, // 300 centavos = US$3
        billing_cycle: null,                                  // pago único
        quantity: { minimum: 1, maximum: 10 },
    });

    console.log('\n✅ Listo. Pega este priceId en PADDLE_CREDIT_PACKS.pack_facturas:\n');
    console.log(`   priceId: '${precio.id}',\n`);
};

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
