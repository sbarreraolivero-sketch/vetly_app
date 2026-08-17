#!/usr/bin/env node
// Crea en Paddle los 9 packs de precio fijo (créditos IA mini/4o + recordatorios)
// + 1 producto "contenedor" sin precio (usado por paddle-create-transaction para
// los checkouts de monto variable: reminders por unidad y créditos de campaña).
//
// Uso (sandbox, default):
//   PADDLE_API_KEY=pdl_sdbx_apikey_... node scripts/create-paddle-packs.js
//
// Uso (producción, Fase B de la migración):
//   PADDLE_ENVIRONMENT=production PADDLE_API_KEY=pdl_live_apikey_... node scripts/create-paddle-packs.js
//
// La key nunca se pasa por argumento ni queda en shell history si se exporta
// primero (`export PADDLE_API_KEY=...` en una línea separada).

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_ENVIRONMENT = process.env.PADDLE_ENVIRONMENT || 'sandbox';
const PADDLE_API_HOST = PADDLE_ENVIRONMENT === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';

if (!PADDLE_API_KEY) {
    console.error('Falta PADDLE_API_KEY. Uso: PADDLE_API_KEY=pdl_sdbx_apikey_... node scripts/create-paddle-packs.js');
    process.exit(1);
}

async function paddleFetch(path, body) {
    const res = await fetch(`${PADDLE_API_HOST}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${PADDLE_API_KEY}`,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Paddle API error (${res.status}) en ${path}: ${JSON.stringify(data)}`);
    }
    return data.data;
}

async function createProduct(name, description) {
    return paddleFetch('/products', { name, tax_category: 'saas', description });
}

async function createOneTimePrice(productId, description, amountUsdCents) {
    return paddleFetch('/prices', {
        product_id: productId,
        description,
        unit_price: { amount: String(amountUsdCents), currency_code: 'USD' },
    });
}

// price en USD, ya en centavos
const CREDIT_PACKS_MINI = [
    { id: 'pack_500',  name: 'Pack Inicial (Mini)',     credits: 4000,  priceCents: 900 },
    { id: 'pack_1500', name: 'Pack Pro (Mini)',         credits: 8000,  priceCents: 1500 },
    { id: 'pack_4000', name: 'Pack Enterprise (Mini)',  credits: 20000, priceCents: 2900 },
];

const CREDIT_PACKS_4O = [
    { id: 'pack_500_4o',  name: 'Pack Inicial (GPT-4o)',    credits: 500,  priceCents: 1000 },
    { id: 'pack_1500_4o', name: 'Pack Pro (GPT-4o)',        credits: 1500, priceCents: 3000 },
    { id: 'pack_4000_4o', name: 'Pack Enterprise (GPT-4o)', credits: 4000, priceCents: 8000 },
];

const REMINDER_PACKS = [
    { id: 'reminders_50',        name: 'Pack Básico (Recordatorios)',     units: 80,   priceCents: 900 },
    { id: 'reminders_350',       name: 'Pack Pro (Recordatorios)',        units: 350,  priceCents: 1900 },
    { id: 'reminders_unlimited', name: 'Pack Ilimitado (Recordatorios)',  units: 9999, priceCents: 2900 },
];

async function main() {
    console.log(`Creando catálogo de packs en Paddle [${PADDLE_ENVIRONMENT}] (${PADDLE_API_HOST})...\n`);

    const results = [];

    // Producto contenedor — sin precio fijo, solo product_id para transacciones no-catálogo
    const container = await createProduct(
        'Vetly — Compra de monto variable',
        'Producto contenedor para checkouts de precio dinámico (recordatorios por unidad, créditos de campaña). No tiene precio propio.'
    );
    console.log(`✓ Producto contenedor creado: ${container.id}`);

    for (const pack of CREDIT_PACKS_MINI) {
        const product = await createProduct(`Vetly — ${pack.name}`, `${pack.credits.toLocaleString()} créditos de IA (GPT-4o-mini)`);
        const price = await createOneTimePrice(product.id, pack.name, pack.priceCents);
        results.push({ id: pack.id, name: pack.name, productId: product.id, priceId: price.id, priceUsd: pack.priceCents / 100 });
        console.log(`✓ ${pack.name} → product=${product.id} price=${price.id}`);
    }

    for (const pack of CREDIT_PACKS_4O) {
        const product = await createProduct(`Vetly — ${pack.name}`, `${pack.credits.toLocaleString()} créditos de IA (GPT-4o)`);
        const price = await createOneTimePrice(product.id, pack.name, pack.priceCents);
        results.push({ id: pack.id, name: pack.name, productId: product.id, priceId: price.id, priceUsd: pack.priceCents / 100 });
        console.log(`✓ ${pack.name} → product=${product.id} price=${price.id}`);
    }

    for (const pack of REMINDER_PACKS) {
        const product = await createProduct(`Vetly — ${pack.name}`, `${pack.units.toLocaleString()} recordatorios`);
        const price = await createOneTimePrice(product.id, pack.name, pack.priceCents);
        results.push({ id: pack.id, name: pack.name, productId: product.id, priceId: price.id, priceUsd: pack.priceCents / 100 });
        console.log(`✓ ${pack.name} → product=${product.id} price=${price.id}`);
    }

    console.log('\n─── Resumen (pegar en el chat, no son secretos) ───\n');
    console.log(`PADDLE_CONTAINER_PRODUCT_ID = ${container.id}\n`);
    console.log('| pack_id | product_id | price_id |');
    console.log('|---|---|---|');
    for (const r of results) {
        console.log(`| ${r.id} | ${r.productId} | ${r.priceId} |`);
    }
}

main().catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
});
