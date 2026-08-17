#!/usr/bin/env node
// Crea en Paddle los 4 planes de suscripción (Core/Starter/Pro/Enterprise),
// el precio anual de Core, y los 2 descuentos de lanzamiento (LANZAMIENTO17
// mensual y anual). Complemento de create-paddle-packs.js.
//
// Uso (producción):
//   PADDLE_ENVIRONMENT=production PADDLE_API_KEY=pdl_live_apikey_... node scripts/create-paddle-plans.js

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_ENVIRONMENT = process.env.PADDLE_ENVIRONMENT || 'sandbox';
const PADDLE_API_HOST = PADDLE_ENVIRONMENT === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';

if (!PADDLE_API_KEY) {
    console.error('Falta PADDLE_API_KEY.');
    process.exit(1);
}

async function paddleFetch(path, body) {
    const res = await fetch(`${PADDLE_API_HOST}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PADDLE_API_KEY}` },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Paddle API error (${res.status}) en ${path}: ${JSON.stringify(data)}`);
    return data.data;
}

async function createProduct(name, description) {
    return paddleFetch('/products', { name, tax_category: 'saas', description });
}

async function createRecurringPrice(productId, description, amountUsdCents, interval) {
    return paddleFetch('/prices', {
        product_id: productId,
        description,
        unit_price: { amount: String(amountUsdCents), currency_code: 'USD' },
        billing_cycle: { interval, frequency: 1 },
    });
}

const PLANS = [
    { id: 'core', name: 'Vetly — Plan Core', monthlyCents: 3900, annualCents: 39000 },
    { id: 'starter', name: 'Vetly — Plan Starter', monthlyCents: 8900, annualCents: null },
    { id: 'pro', name: 'Vetly — Plan Pro', monthlyCents: 16900, annualCents: null },
    { id: 'enterprise', name: 'Vetly — Plan Enterprise', monthlyCents: 34900, annualCents: null },
];

async function main() {
    console.log(`Creando planes en Paddle [${PADDLE_ENVIRONMENT}] (${PADDLE_API_HOST})...\n`);

    const results = {};

    for (const plan of PLANS) {
        const product = await createProduct(plan.name, `Suscripción mensual/anual — ${plan.name}`);
        const monthlyPrice = await createRecurringPrice(product.id, `${plan.name} — Mensual`, plan.monthlyCents, 'month');
        let annualPriceId = null;
        if (plan.annualCents) {
            const annualPrice = await createRecurringPrice(product.id, `${plan.name} — Anual`, plan.annualCents, 'year');
            annualPriceId = annualPrice.id;
        }
        results[plan.id] = { productId: product.id, monthlyPriceId: monthlyPrice.id, annualPriceId };
        console.log(`✓ ${plan.name} → product=${product.id} monthly=${monthlyPrice.id}${annualPriceId ? ` annual=${annualPriceId}` : ''}`);
    }

    // Descuento de lanzamiento — Core mensual, $22 off, recurrente, tope 100 usos
    const discountMonthly = await paddleFetch('/discounts', {
        description: 'Lanzamiento Core — $17/mes',
        type: 'flat',
        amount: '2200',
        currency_code: 'USD',
        recur: true,
        usage_limit: 100,
        restrict_to: [results.core.productId],
        enabled_for_checkout: true,
    });
    console.log(`✓ Descuento LANZAMIENTO17 (mensual) → ${discountMonthly.id}`);

    // Descuento de lanzamiento — Core anual, $220 off, recurrente, tope 100 usos
    const discountAnnual = await paddleFetch('/discounts', {
        description: 'Lanzamiento Core Anual — $170/año',
        type: 'flat',
        amount: '22000',
        currency_code: 'USD',
        recur: true,
        usage_limit: 100,
        restrict_to: [results.core.productId],
        enabled_for_checkout: true,
    });
    console.log(`✓ Descuento LANZAMIENTO17_ANUAL → ${discountAnnual.id}`);

    console.log('\n─── Resumen (pegar en el chat, no son secretos) ───\n');
    for (const [id, r] of Object.entries(results)) {
        console.log(`${id}: product=${r.productId} monthly=${r.monthlyPriceId}${r.annualPriceId ? ` annual=${r.annualPriceId}` : ''}`);
    }
    console.log(`LAUNCH_DISCOUNT_ID = ${discountMonthly.id}`);
    console.log(`LAUNCH_DISCOUNT_ID_ANNUAL = ${discountAnnual.id}`);
}

main().catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
});
