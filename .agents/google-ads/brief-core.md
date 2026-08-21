> **NOTA DE VIGENCIA — leer antes de usar cualquier cifra de este documento.**
>
> - Copia de `~/Desktop/BRIEFGOOGLEADSVETLYCORE.md`, **fechado 19-08-2026**. Los precios de
>   competidores, las SERPs y los tipos de cambio son de esa fecha: reverificar antes de usarlos
>   en copy público o en una comparativa.
> - **El brief razona en USD. La cuenta de Google Ads de Vetly cobra en CLP** (`2149932315`).
>   Toda cifra de presupuesto, CPC tope o tCPA debe convertirse a CLP antes de cargarse.
> - El estado real de la cuenta y del tracking está en `estado-cuenta.md`, no aquí. Este
>   documento es la **estrategia**; aquel es el **hecho**. Si se contradicen, manda el hecho.

# Brief Google Ads — Vetly Core (Chile + México)

**Para:** Claude Code (equipo de producto Vetly)
**De:** Especialista Google Ads
**Fecha:** 19 de agosto de 2026
**Objetivo:** conseguir registros al trial de 30 días del **Plan Core** en `vetly.pro/core`
**Presupuesto:** USD 150–300/mes
**Mercados fase 1:** Chile y México
**Conversión principal:** `sign_up` → cuenta creada con `plan=core`

---

## 0. TL;DR — las 6 decisiones que definen el resultado

1. **No se puede lanzar hasta que exista tracking de conversión.** Hoy no hay señal de conversión medible en `/core`. Con USD 250/mes no hay margen para gastar a ciegas. Esta es la tarea bloqueante #1.
2. **La subasta está casi vacía.** En Chile solo pujan 3 anunciantes (Veti, Okvet, Qvet) y en México la query cabeza `software veterinario` no mostró **ningún** anuncio. Los CPC serán bajos: se puede comprar tráfico de alta intención barato durante los próximos meses.
3. **El trial de 30 días sin tarjeta es la mayor ventaja competitiva de Core**, por encima del precio. Veti da 15 días, Sami 14, Wirevet 7, VetLink ni siquiera da trial (solo demo). Debe ser el headline #1 de todos los anuncios.
4. **El nicho de veterinario a domicilio / independiente está totalmente desatendido en la subasta** y es exactamente el origen del producto (Movilvets). Es la campaña con mejor ratio esfuerzo/retorno.
5. **Hay que arreglar la incoherencia de precios y de CTA antes de gastar.** La home muestra Core a $39 con botón "Agendar demo gratis"; `/core` muestra $17 con "Crear cuenta gratis". Eso rompe conversión y además es riesgo de desaprobación por política de Google (precio del anuncio ≠ precio del destino).
6. **Falta facturación electrónica (SII en Chile, CFDI en México).** Es la objeción #1 del segmento y hoy es una fuga de presupuesto silenciosa. Se resuelve con negativas + una sección honesta en la landing, no ignorándola.

---

## 1. Diagnóstico del activo actual

### 1.1 Lo que vende Vetly hoy

| Plan | Precio | Trial | CTA en la web |
|---|---|---|---|
| Core | $39 USD/mes (landing `/core` muestra $17 de lanzamiento) | **30 días** (según `/core`) | "Crear cuenta gratis" → `/register?plan=core` |
| Starter | $89 USD/mes | 7 días | "Agendar demo gratis" |
| Pro | $169 USD/mes | 7 días | "Agendar demo gratis" |
| Enterprise | $349 USD/mes | 7 días | "Agendar demo gratis" |

**Core incluye:** 3 usuarios · 1 agenda · dashboard y métricas · calendario de citas · fichas médicas · finanzas · inventario · fidelización y referidos · recordatorios WhatsApp manuales ilimitados + 25 automáticos/mes.
**Core NO incluye:** agente IA conversacional (Lía), logística móvil (Goldi), campañas masivas segmentadas.

### 1.2 Problemas que van a matar el CVR (arreglar antes de gastar USD 1)

| # | Problema | Impacto | Prioridad |
|---|---|---|---|
| P1 | Home dice Core **$39 / 7 días** y `/core` dice **$17 / 30 días** | El usuario que llega por ad y navega a `/precios` ve otro precio → abandona. Riesgo de desaprobación de anuncio por "precio inconsistente con el destino". | **Bloqueante** |
| P2 | El card de Core en `/precios` tiene CTA "Agendar demo gratis" | Contradice el modelo self-serve del trial. El usuario de Core NO quiere reunión, quiere entrar. | **Bloqueante** |
| P3 | Precios en USD para tráfico chileno y mexicano | Fricción cognitiva alta. El veterinario chileno compara contra "$21.900 CLP" de Veti y "$59.990" de Wirevet, no contra dólares. | Alta |
| P4 | `/core` no tiene prueba social propia | La home tiene testimonios reales (Animalgrace, VetMóvil, PetHome), `/core` no. | Alta |
| P5 | No hay landing por país | Mismo copy para CL y MX. México usa "expediente clínico", no "ficha clínica". | Media |
| P6 | Nada aborda SII / CFDI / boleta electrónica | Objeción #1 del segmento en ambos países. Silencio = abandono. | Alta |
| P7 | No hay tracking de conversión configurado | Sin esto la campaña no puede optimizar. | **Bloqueante** |

---

## 2. Análisis competitivo — Chile

### 2.1 Quién puja realmente en Google (SERP verificada, agosto 2026)

Búsquedas ejecutadas en `google.com` con `gl=cl`:

| Query | Anunciantes visibles |
|---|---|
| `software veterinario chile` | **Veti**, **Okvet**, **Qvet** + Okvet repetido en bottom ads |
| `programa de gestion para clinica veterinaria` | **Veti**, **Okvet** + Okvet en bottom ads |
| `software veterinario gratis` | **ninguno** |
| `ficha clinica veterinaria digital app` | **ninguno** |
| `software veterinario con whatsapp agenda recordatorios` | **ninguno** |
| `software veterinaria movil a domicilio gestion` | **ninguno** |

**Lectura:** solo 3 anunciantes, y solo en las 2 queries cabeza. Toda la cola larga está vacía. La subasta chilena es barata y poco sofisticada.

**Copys que están corriendo (para no imitarlos y diferenciarse):**

- **Veti:** "Software Veterinario Veti | Solicita tu Demo de 15 días" — "El Software Veterinario más Simple." — sitelinks: *Precios · Prueba Gratis 15 Días · Soporte Local en Chile*. Segunda variante: "Hecho por Veterinarios | +300 Veterinarios lo Usan" — "Fichas, agenda, recordatorios y presupuestos en una sola app."
- **Okvet:** "Okvet | Software Veterinario - Empieza Gratis Hoy" — "Control total de su veterinaria totalmente en la nube. Usuarios & pacientes ilimitados." — sitelinks: *Planes · Aplicación para Veterinarios · Software Veterinario*. Callout: "Más de 10.000 visitas en el último mes".
- **Qvet:** "28 años de experiencia - Más de 8000 clientes" — sitelinks: *Recomendador Ares con IA · Líder en gestión veterinaria*. Es un jugador español enterprise, no compite por Core.

### 2.2 Mapa de precios Chile

| Competidor | Precio real | Trial | Posicionamiento | ¿Puja? |
|---|---|---|---|---|
| **Veti** (veti.app) | Básico **UF 0,45 + IVA ≈ $21.900 CLP/mes ≈ USD 23** · 1 usuario · usuario extra 0,15 UF | **15 días sin tarjeta** | "La app veterinaria más simple", hecha en Chile, +300 clientes, 16 regiones, soporte humano. **Plan Pro (inventario + ventas) "próximamente"** | **Sí, agresivo** |
| **Wirevet** (wirevet.cl) | Lite **$59.990 CLP/mes ≈ USD 62** (USD 59 fuera de Chile) | 7 días sin tarjeta | Ficha + agenda + **boleta electrónica SII** + WhatsApp + telemedicina + laboratorio. Claim: "reduce inasistencias hasta 38%" | No (SEO muy fuerte: rankea en casi toda la cola larga) |
| **VetLink** (vetlink.cl) | **$29.990 + IVA ≈ $35.700 CLP ≈ USD 37** · usuarios ilimitados. Módulo WhatsApp IA: **$1.990.000 pago único** | **Sin trial**, solo demo | IA clínica (SOAP, transcripción), hospitalización, catálogo SAG, MercadoPago, boleta SII | No |
| **GVET** (gvet.cl / gvet.mx) | No público | **3 meses gratis** | Petshop + clínica, facturación electrónica multi-país, app para el tutor | No (SEO fuerte en CL y MX) |
| **ACVet** (acvet.app) | Plan **$0/mes** (1 usuario, 100 fichas/mes) + planes pagos con "30% menos prepagando 3 meses" | **30 días** | Multi-país CL/MX/AR/CO, cuota de WhatsApp 50–200 msj según plan | No |
| **DodoZooft** | No público | — | 100% web, admin + ventas + pacientes | No |
| **Volki** (volki.vet) | **US$9,50** (según Capterra) | — | Veterinarios domiciliarios y clínicas hispanohablantes | No |
| **SamyVet, MiVetApp, Vet360, VetPraxis, Milovet, ConectaSitios, sistemaveterinario.cl** | Bajo/medio, no público | — | Jugadores locales de nicho, sin inversión publicitaria | No |

### 2.3 El competidor que importa: **Veti**

Es el rival directo de Core. Mismo ICP (veterinario independiente y clínica pequeña), precio casi idéntico, y es el único que compra el tráfico.

**Dónde Vetly Core le gana:**

| Dimensión | Veti Básico | Vetly Core | Ventaja |
|---|---|---|---|
| Trial | 15 días | **30 días** | **2×** |
| Usuarios incluidos | 1 (extra: 0,15 UF c/u) | **3** | **3×** |
| Inventario | ❌ "próximamente" | ✅ incluido | **Decisivo** |
| Finanzas / cierre de caja | ❌ | ✅ | **Decisivo** |
| Fidelización y referidos | ❌ | ✅ | Diferencial único |
| Recordatorios WhatsApp | ✅ | ✅ (ilimitados manuales + 25 auto) | Paridad |
| Registro | Formulario largo (7 campos) → espera | **Cuenta inmediata** | Fricción menor |
| Precio | ≈ USD 23 (1 usuario) | USD 17–39 (3 usuarios) | Mejor por usuario |
| Ruta a IA conversacional | ❌ no existe | ✅ upgrade a Starter | Expansión de LTV |

**Dónde Veti gana:** marca instalada desde 2020, +300 clientes, +300K fichas, testimonios con nombre y apellido, "soporte local en Chile", y una promesa de simplicidad muy nítida. Vetly Core debe evitar competir en "más completo" y competir en **"todo lo que Veti te cobra aparte, incluido — y 30 días para probarlo"**.

---

## 3. Análisis competitivo — México

### 3.1 SERP verificada (`gl=mx`)

| Query | Anunciantes visibles |
|---|---|
| `software para veterinarias mexico` | **Vetmanger**, **Okvet** |
| `software veterinario` | **ninguno** ← query cabeza sin anuncios |
| `expediente clinico veterinario software` | **ninguno** |
| `sistema para veterinaria precio` | **ninguno** — pero la SERP se llena de Shopping de equipamiento (monitores, ecógrafos, rayos X) ⚠️ |

**Hallazgo clave:** la query cabeza `software veterinario` en México no mostró anuncios. La subasta mexicana está prácticamente desierta y con volumen mucho mayor que Chile.

**Trampa detectada:** `sistema para veterinaria precio` y variantes con "precio"/"sistema" en México devuelven listados de **equipo médico veterinario** (monitores de signos vitales $28.000 MXN, ecógrafos, anestesia). Esa intención NO es software de gestión. Hay que negativizarla agresivamente o se quema el 30% del presupuesto.

### 3.2 Mapa competitivo México

| Competidor | Precio | Trial | Posicionamiento | ¿Puja? |
|---|---|---|---|---|
| **Vetmanger** (vetmanger.xyz) | **$2.000 MXN inicial + $640 MXN/mes** · semestral $3.840 · anual $4.992 (≈ USD 22/mes) | Demo personalizada 30–60 min, sin tarjeta | "100% mexicano", expediente + agenda + inventario + **CFDI** + WhatsApp, módulo IA nuevo | **Sí** |
| **Okvet** (okvet.co) | Versión gratuita + PRO (no público) | Freemium permanente | Colombiano, 24+ países, freemium | **Sí** |
| **Sami** (sami.vet) | No público (Essentials / Professional / Enterprise) | **14 días** | "Software Veterinario #1 con IA en México", +600 clínicas, +2.000 médicos, dictado por voz → nota clínica | No (SEO #2 orgánico) |
| **GVET México** (gvet.mx) | No público | 3 meses gratis | Facturación electrónica, app para tutores | No |
| **Zuvet** (zuvet.ai) | No público | — | "Hecho en México", expediente + IA | No |
| **SICAR** (sicar.mx) | **$4.940 MXN licencia** (pago único) | — | Punto de venta con CFDI 4.0, lotes y caducidades | No |
| **Squenda** | **$499 MXN** (vía Pet Markt) | — | Software de escritorio para clínicas y estéticas | No |
| **Medware, Vetlogy, Volki, Vet Cloud, SaelVET, PetsApp** | Variado | — | Cola larga | No |

**Conclusión México:** solo 2 anunciantes activos, ninguno con trial de 30 días self-serve. Vetmanger cobra **$2.000 MXN de setup** — Vetly puede atacar eso directamente con "sin costo de implementación, implementación incluida gratis".

---

## 4. Las 8 oportunidades ordenadas por retorno esperado

### O1 — La cola larga está vacía en ambos países ⭐⭐⭐⭐⭐
`ficha clínica veterinaria digital`, `expediente clínico veterinario`, `agenda para veterinaria`, `software veterinaria a domicilio`, `recordatorios whatsapp veterinaria`: **cero anuncios**. Son búsquedas de intención altísima con CPC de piso. Aquí va el grueso del presupuesto, no en la cabeza donde puja Veti.

### O2 — El nicho "veterinario a domicilio / independiente" no lo trabaja nadie ⭐⭐⭐⭐⭐
Vetly nació de Movilvets. Los testimonios reales son de clínicas móviles (Animalgrace, VetMóvil Santiago, PetHome Valparaíso). Nadie compra esa intención. Es el ICP más barato de adquirir y el que mejor entiende el producto. Además es el que después hace upgrade a Starter por Goldi.

### O3 — 30 días sin tarjeta, contra 15/14/7/0 de todos ⭐⭐⭐⭐⭐
Ángulo de anuncio que ningún competidor puede igualar rápido (salvo GVET con 3 meses, que no puja). Debe ir en el H1 de todos los RSA.

### O4 — "Todo incluido" contra el upsell de Veti ⭐⭐⭐⭐
Veti Básico no tiene inventario ni ventas y cobra 0,15 UF por usuario extra. Core trae 3 usuarios, inventario, finanzas y fidelización. Ángulo: *"3 usuarios, inventario y finanzas incluidos. Sin cobros por usuario extra."*

### O5 — Marcas de competidores sin defensa ⭐⭐⭐⭐
No hay anuncios defendiendo: **Wirevet, GVET, ACVet, DodoZooft, Sami, Vetmanger, Squenda, SamyVet, Volki, MiVetApp**. Campaña de conquista con concordancia exacta, presupuesto capado, y landing comparativa. CPC bajísimo y CTR alto por curiosidad. *(Nota: no incluir la marca del competidor en el texto del anuncio — solo como keyword — para no violar la política de marcas registradas de Google.)*

### O6 — La búsqueda de "gratis" es enorme y no la compra nadie ⭐⭐⭐
`software veterinario gratis` tiene alto volumen, cero anuncios, y ACVet/Okvet la ganan orgánicamente con freemium. Core con **30 días gratis sin tarjeta a $17** puede capturarla. Tráfico de menor calidad → campaña separada, presupuesto capado al 10–15%, y se mata si el CPA no cierra.

### O7 — Vetmanger cobra $2.000 MXN de implementación ⭐⭐⭐
Vetly regala la implementación. Es un ángulo directo y verificable para México: *"Implementación incluida. Sin costo de instalación."*

### O8 — Escalera de producto hacia Starter ⭐⭐⭐
Core a $17–39 es un producto de entrada. El LTV real está en el upgrade a Starter ($89) por Lía. Eso permite tolerar un CPA de adquisición más alto que el que sugiere el ticket de Core. **Hay que instrumentar el upgrade como conversión secundaria con valor**, o se va a optimizar contra el objetivo equivocado.

---

## 5. Riesgos y objeciones que hay que neutralizar

| Riesgo | Detalle | Mitigación |
|---|---|---|
| **Sin facturación electrónica** | Wirevet, VetLink, GVET (CL) y Vetmanger, SICAR, Vetlogy (MX) venden boleta SII / CFDI 4.0 como diferencial. Vetly no lo tiene. | Negativizar `sii`, `boleta electrónica`, `facturación electrónica`, `cfdi`, `factura electrónica`. En la landing, FAQ honesta: *"¿Emite boleta electrónica? Core registra cobros y envía comprobante por WhatsApp; la emisión tributaria se hace en tu sistema actual."* Mejor perder el clic que pagarlo y perder al lead. |
| **Cobro en USD** | Paddle en USD; MercadoPago CLP existe pero no se comunica. México queda sin ruta local clara. | Mostrar precio en CLP/MXN con nota "cobrado en USD". Evaluar OXXO/SPEI vía Paddle o MercadoPago MX. |
| **Precio "$17 de lanzamiento"** | Google puede desaprobar por precio inconsistente entre anuncio y destino si la home dice $39. | Unificar mensaje: precio de lista $39, "oferta de lanzamiento $17" visible en ambas páginas con fecha de término. |
| **Presupuesto muy ajustado** | USD 150–300/mes entre 2 países y 4–5 campañas = fragmentación y ninguna campaña sale de la fase de aprendizaje. | **Empezar solo en Chile.** Añadir México en el mes 2 con datos ya recogidos. |
| **Contaminación por equipamiento veterinario (MX)** | La SERP de "sistema/precio veterinaria" se llena de monitores y ecógrafos. | Lista de negativas de hardware obligatoria desde el día 1. |
| **Intención académica** | "software veterinario" atrae estudiantes, tesis, cursos. | Negativas: `curso`, `carrera`, `universidad`, `tesis`, `pdf`, `plantilla`, `formato word`, `apuntes`. |

---

## 6. Estructura de campañas recomendada

### 6.1 Reparto de presupuesto (escenario USD 250/mes)

| Fase | Chile | México | Nota |
|---|---|---|---|
| **Mes 1** | USD 250 (100%) | — | Recoger datos en un solo mercado. ~USD 8,3/día. |
| **Mes 2** | USD 150 (60%) | USD 100 (40%) | Abrir México solo si CL tiene CPA validado. |
| **Mes 3+** | 50% | 50% | Reasignar según CPA real, no según intuición. |

Si el presupuesto final es **USD 150**: Chile únicamente, y solo las campañas C1 y C2. Con menos de USD 5/día no se puede sostener más de 2 campañas sin matarlas de hambre.

### 6.2 Campañas

**C1 · `[CL] Search — Gestión Veterinaria (Genéricas)`** — 40% del presupuesto CL
Intención cabeza. Compite contra Veti y Okvet.

**C2 · `[CL] Search — Veterinario a Domicilio e Independiente`** — 25%
El nicho sin competencia. Copy y landing específicos.

**C3 · `[CL] Search — Funcionalidad (Ficha / Agenda / Inventario)`** — 20%
Cola larga por módulo. CPC más bajo, CVR más alto.

**C4 · `[CL] Search — Competidores`** — 10%, con tope diario duro
Concordancia exacta. Landing comparativa.

**C5 · `[CL/MX] Search — Marca Vetly`** — 5%, CPC manual muy bajo
Defensa. Okvet y Qvet ya pujan en el sector; barato asegurarla.

**C6 · `[MX] Search — Gestión Veterinaria + Expediente Clínico`** — todo el presupuesto MX del mes 2
Arranca con las genéricas y `expediente clínico veterinario` (que en MX no tiene anuncios).

**C7 · Demand Gen / Remarketing** — solo cuando se acumulen ≥50 conversiones/mes
Audiencia: visitó `/core` y no completó registro + abandonó onboarding.

**Nunca antes de tener 30 conversiones:** Performance Max. Con USD 250/mes PMax canibaliza marca y no da control de búsqueda. Prohibido en fase 1.

### 6.3 Estrategia de puja

| Semana | Estrategia | Racional |
|---|---|---|
| 1–3 | **Maximizar clics** con CPC máx. **USD 0,60 (CL) / USD 0,45 (MX)** | Sin histórico no hay Smart Bidding posible. El tope evita que Google gaste todo en la cabeza cara. |
| 4–8 | **Maximizar conversiones** (sin tCPA) | Cuando haya ≥15 conversiones/mes. |
| 9+ | **tCPA** en USD 12–18 por registro de trial | Solo con ≥30 conversiones/mes acumuladas. |

**Ajustes obligatorios desde el inicio:**

- Ubicación: Chile / México, y **"Presencia: personas en la ubicación"**, nunca "interés". Sin esto se paga tráfico de España y Colombia.
- Idioma: español.
- Dispositivos: sin exclusiones al inicio, pero medir móvil vs escritorio (el registro a un SaaS de gestión suele completarse en escritorio; puede requerir −20% en móvil).
- Programación: sin restricción el mes 1; luego mirar el informe horario (probable pico 20:00–23:00, el veterinario administra su clínica de noche).
- Red de Display y socios de búsqueda: **desactivadas**.

---

## 7. Keywords

### 7.1 Chile

**C1 — Genéricas (concordancia de frase, salvo indicado)**

```
"software veterinario"
"software veterinario chile"
"software para veterinarias"
"software para clinica veterinaria"
"programa para veterinaria"
"programa de gestion veterinaria"
"sistema para clinica veterinaria"
"sistema de gestion veterinaria"
"software gestion clinica veterinaria"
[software veterinario chile]
[mejor software veterinario]
"app para veterinarios"
"plataforma para veterinarias"
```

**C2 — Domicilio e independiente (frase + amplia con Smart Bidding cuando exista)**

```
"software veterinaria a domicilio"
"software para veterinario a domicilio"
"app veterinario domicilio"
"gestion veterinaria movil"
"software para veterinario independiente"
"sistema para consulta veterinaria pequeña"
"programa para veterinario particular"
"software clinica veterinaria movil"
"organizar mi consulta veterinaria"
```

**C3 — Por funcionalidad**

```
"ficha clinica veterinaria digital"
"ficha clinica veterinaria online"
"historial clinico veterinario software"
"historia clinica veterinaria digital"
"agenda para veterinaria"
"agenda online veterinaria"
"software agenda citas veterinaria"
"recordatorios whatsapp veterinaria"
"recordatorio de vacunas veterinaria software"
"control de inventario veterinaria software"
"software inventario clinica veterinaria"
"sistema de fidelizacion veterinaria"
"crm veterinario"
```

**C4 — Competidores (solo exacta)**

```
[veti app]
[veti software veterinario]
[wirevet]
[wirevet precio]
[gvet software veterinario]
[gvet chile]
[acvet]
[acvet software]
[dodozooft]
[okvet]
[vetlink software veterinario]
[samyvet]
[mivetapp]
[volki software veterinario]
[alternativa a wirevet]
[alternativa software veterinario]
```

**C6bis — "Gratis" (campaña separada, tope duro USD 1,5/día)**

```
"software veterinario gratis"
"programa veterinario gratis"
"app veterinaria gratis"
"sistema veterinario gratis"
```

### 7.2 México

```
"software veterinario"
"software para veterinarias"
"software para veterinarias mexico"
"sistema para clinica veterinaria"
"programa para veterinaria"
"expediente clinico veterinario"          ← sin anuncios, alta intención
"expediente clinico veterinario digital"
"software expediente veterinario"
"historial clinico veterinario app"
"agenda para veterinaria"
"recordatorios whatsapp veterinaria"
"control de inventario veterinaria"
"software para consultorio veterinario"
"sistema para consultorio veterinario"
[vetmanger]
[sami vet]
[zuvet]
[gvet mexico]
[squenda]
[medware veterinaria]
[alternativa vetmanger]
```

### 7.3 Lista de negativas (nivel cuenta — cargar antes del primer clic)

**Hardware y equipamiento (crítico en MX):**
```
monitor, monitores, signos vitales, ecografo, ecógrafo, ultrasonido, rayos x,
radiologia, radiología, tomografo, tomógrafo, anestesia, electrocardiografo,
electrocardiógrafo, capnografia, capnografía, autoclave, jaula, jaulas, mesa,
quirurgico, quirúrgico, equipo, equipos, instrumental, insumos, mercadolibre,
amazon, aliexpress, precio equipo, usado, segunda mano, reacondicionado
```

**Intención académica / no comercial:**
```
curso, cursos, carrera, universidad, tesis, apuntes, pdf, plantilla, formato,
word, excel, ejemplo, definicion, definición, que es, significado, wikipedia,
diplomado, capacitacion, capacitación
```

**Empleo:**
```
empleo, trabajo, vacante, sueldo, salario, cv, contratar veterinario
```

**Piratería:**
```
crack, gratis para siempre, full, mega, torrent, serial, licencia gratis, descargar gratis
```

**Fuera de ICP:**
```
ganado, ganaderia, ganadería, bovino, porcino, avicola, avícola, equino,
produccion animal, producción animal, agropecuario, zoologico, zoológico,
peluqueria canina (evaluar), hotel para mascotas, guarderia canina,
veterinaria cerca de mi, veterinaria 24 horas, urgencia veterinaria,
consulta veterinaria precio, vacuna perro precio
```
*(las últimas líneas capturan al **dueño de mascota**, no al veterinario — es la fuga más común y más cara)*

**Funcionalidad que Vetly Core no tiene (evita clics que no cierran):**
```
boleta electronica, boleta electrónica, facturacion electronica,
facturación electrónica, factura electronica, sii, dte, cfdi, cfdi 4.0,
timbrado, nomina, nómina, contabilidad
```
*(revisar en el mes 3: si Vetly incorpora facturación, se liberan y se convierten en campaña propia)*

---

## 8. Anuncios (RSA) listos para cargar

### 8.1 Chile — C1 Genéricas

**Títulos (15):**
```
1.  Software Veterinario | 30 Días Gratis
2.  Gestiona Tu Clínica Veterinaria
3.  30 Días Gratis, Sin Tarjeta
4.  Ficha, Agenda e Inventario
5.  Desde USD 17 al Mes
6.  3 Usuarios Incluidos
7.  Deja las Planillas de Excel
8.  Implementación Gratis Incluida
9.  Hecho por un Veterinario Chileno
10. Recordatorios por WhatsApp
11. Todo Tu Historial en un Lugar
12. Sin Contrato, Cancela Cuando Quieras
13. Software Veterinario en la Nube
14. Prueba Real de 30 Días
15. Finanzas, Stock y Fichas Incluidos
```

**Descripciones (4):**
```
1. Ficha clínica, agenda, finanzas, inventario y fidelización en una sola plataforma. 30 días gratis, sin tarjeta de crédito.
2. Creado por un veterinario chileno que tuvo su propia clínica. Implementación incluida y soporte en español.
3. 3 usuarios, inventario y finanzas incluidos. Sin cobros por usuario adicional ni permanencia mínima.
4. Deja las planillas y los cuadernos. Tu clínica ordenada desde el primer día. Crea tu cuenta en 2 minutos.
```

**Fijaciones:** fijar "Software Veterinario | 30 Días Gratis" en Posición 1 durante las primeras 2 semanas para forzar el diferencial, luego liberar.

### 8.2 Chile — C2 Domicilio / Independiente

**Títulos:**
```
1.  Software para Veterinario a Domicilio
2.  Gestiona Tu Consulta Desde el Celular
3.  30 Días Gratis, Sin Tarjeta
4.  Hecho por un Vet Móvil Chileno
5.  Fichas y Agenda en Terreno
6.  Para Veterinarios Independientes
7.  Desde USD 17 al Mes
8.  Tus Pacientes Siempre Contigo
9.  Adiós al Cuaderno y a Excel
10. Recordatorios Automáticos WhatsApp
11. Cobra y Registra en la Visita
12. Implementación Incluida Gratis
```

**Descripciones:**
```
1. Creado por el fundador de una clínica veterinaria móvil. Fichas, agenda, cobros y recordatorios desde tu teléfono.
2. Registra la atención en la casa del paciente y envía el comprobante por WhatsApp al terminar.
3. 30 días gratis sin tarjeta de crédito. Sin contrato ni permanencia mínima.
4. Pensado para veterinarios que trabajan solos o en terreno, no para hospitales de 20 personas.
```

### 8.3 Chile — C4 Competidores
*(sin mencionar marcas ajenas en el texto)*

```
Títulos: Alternativa Real y Más Completa · 30 Días Gratis para Comparar ·
Inventario y Finanzas Incluidos · 3 Usuarios, Sin Costo Extra ·
Migramos Tus Datos Gratis · Desde USD 17 al Mes · Compara Antes de Decidir

Descripciones:
1. Compara funciones y precios con 30 días gratis y sin tarjeta. Inventario, finanzas y fidelización incluidos.
2. 3 usuarios incluidos y sin cobro por usuario adicional. Implementación gratuita por nuestro equipo.
```

### 8.4 México — C6

```
Títulos: Software Veterinario | 30 Días Gratis · Expediente Clínico Digital ·
Sin Costo de Implementación · Agenda, Inventario y Finanzas · Desde USD 17 al Mes ·
3 Usuarios Incluidos · Recordatorios por WhatsApp · Prueba Sin Tarjeta de Crédito ·
Tu Consultorio Ordenado en 1 Día · Cancela Cuando Quieras

Descripciones:
1. Expediente clínico, agenda, inventario y finanzas en una sola plataforma. 30 días gratis sin tarjeta.
2. Sin cuota de instalación ni contrato. Implementación incluida por nuestro equipo, en español.
3. Creado por un veterinario que tuvo su propia clínica. Pensado para consultorios y clínicas pequeñas.
```

### 8.5 Extensiones (todas las campañas)

**Sitelinks:**
| Texto | Descripción | URL |
|---|---|---|
| Precios y planes | Core desde USD 17. Sin costos ocultos. | `/precios` |
| Crear cuenta gratis | 30 días. Sin tarjeta de crédito. | `/register?plan=core` |
| Qué incluye Core | Fichas, agenda, finanzas e inventario. | `/core#funciones` |
| Cómo funciona | Implementación incluida por nuestro equipo. | `/#como-funciona` |

**Textos destacados:** `30 días gratis` · `Sin tarjeta de crédito` · `Implementación incluida` · `3 usuarios incluidos` · `Soporte en español` · `Sin permanencia` · `Hecho por veterinarios`

**Fragmentos estructurados** (tipo: Servicios): `Ficha clínica` · `Agenda de citas` · `Inventario` · `Finanzas` · `Recordatorios WhatsApp` · `Fidelización y referidos`

**Extensión de imagen:** captura real del calendario y de la ficha de paciente (no ilustraciones).

---

## 9. Tareas técnicas para Claude Code

> Orden estricto. Nada de lo que sigue a T3 tiene sentido si T1–T3 no están cerradas.

### T1 — Medición (BLOQUEANTE, sin esto no se lanza)

**T1.1 · Instalar GA4 + etiqueta de Google Ads**
- GA4 vía `gtag.js` o GTM en todo `vetly.pro`.
- Etiqueta de Google Ads (`AW-XXXXXXX`) con **Enhanced Conversions** habilitado.
- **Consent Mode v2** obligatorio (Google lo exige para modelado de conversiones). `analytics_storage` y `ad_storage` en `denied` por defecto hasta aceptación.

**T1.2 · Eventos a instrumentar**

| Evento | Se dispara cuando | Tipo en Ads | Valor |
|---|---|---|---|
| `view_core_page` | Carga de `/core` | — (solo GA4 / audiencia) | — |
| `begin_signup` | Click en "Crear cuenta gratis" | Secundaria | — |
| `sign_up` | Cuenta creada con `plan=core` ✅ | **PRINCIPAL** | USD 15 (valor proxy) |
| `onboarding_complete` | Primer paciente o primera cita creada | Secundaria | USD 40 |
| `trial_to_paid` | Primer cobro de Core exitoso | Secundaria (offline import) | USD 39 |
| `upgrade_starter` | Upgrade Core → Starter | Secundaria (offline import) | USD 89 |

> `sign_up` es la conversión de optimización. `trial_to_paid` y `upgrade_starter` son las que dicen la verdad sobre la calidad del tráfico — por eso hay que importarlas aunque lleguen 30–60 días tarde.

**T1.3 · Captura y persistencia de `gclid` + UTMs**
```
1. En el primer landing, leer de la query: gclid, wbraid, gbraid,
   utm_source, utm_medium, utm_campaign, utm_term, utm_content.
2. Guardar en cookie first-party (90 días) + localStorage.
3. En el POST de /register, enviarlos al backend.
4. Persistir en Supabase, tabla `attribution`:
   user_id, gclid, wbraid, gbraid, utm_*, landing_url, referrer,
   country (por IP), created_at.
5. Índice por gclid.
```
Sin esto no se puede hacer importación de conversiones offline y el CPA real de cliente pagado queda invisible.

**T1.4 · Importación de conversiones offline**
- Job diario (edge function de Supabase + pg_cron) que consulte usuarios con `trial_to_paid` o `upgrade_starter` de las últimas 24 h y tengan `gclid`.
- Subir vía **Google Ads API** (`ConversionUploadService`) o, en fase 1, exportar CSV semanal y subir a mano en *Herramientas → Conversiones → Cargas*.
- Formato CSV: `Google Click ID, Conversion Name, Conversion Time, Conversion Value, Conversion Currency`.

**T1.5 · Enhanced Conversions for Web**
- En el evento `sign_up`, enviar el email normalizado (minúsculas, sin espacios) al tag; Google lo hashea con SHA-256 del lado del cliente.
- Aumenta la atribución medida un 5–15%, crítico con volúmenes tan bajos.

**T1.6 · Vincular cuentas**
GA4 ↔ Google Ads · Google Search Console ↔ GA4 · Google Ads ↔ Merchant (no aplica).

---

### T2 — Correcciones de landing (BLOQUEANTE)

**T2.1 · Unificar precio y trial de Core en toda la web**
- Decidir **un** mensaje: recomiendo `$39 USD/mes — Oferta de lanzamiento $17 USD/mes` con fecha de término visible.
- Corregir el card de Core en la home/precios: **7 días → 30 días**.
- El precio y el trial deben coincidir carácter por carácter entre `/`, `/precios` y `/core`.

**T2.2 · Cambiar el CTA del card Core**
`Agendar demo gratis` → **`Crear cuenta gratis`** → `/register?plan=core`. El resto de los planes mantienen demo.

**T2.3 · Precio en moneda local**
- Detección por IP (o `?geo=cl|mx`) y render del precio convertido al tipo de cambio del día, con nota al pie *"cobrado en USD"*.
- Usar una fuente de tipo de cambio automática (no hardcodear): mindicador.cl para CLP, Banxico/API para MXN. Cachear 24 h.
- Referencia verificada al 19-08-2026: **1 UF = $40.856,64 CLP** (Banco Central).

**T2.4 · Prueba social en `/core`**
Traer los testimonios de la home a `/core`, priorizando los que hablan de **gestión** y no de IA:
- Dra. Nicole/Claudia — clínica móvil, ahorro de tiempo.
- Datos duros: 84 h/mes ahorradas · ticket promedio USD 37 · 79 citas/mes.
- Si existen, añadir logos o el contador de clínicas activas.

**T2.5 · FAQ que neutralice objeciones** (bloque nuevo en `/core`)
```
¿Necesito tarjeta de crédito? No. 30 días completos sin ingresar datos de pago.
¿Emite boleta o factura electrónica? Core registra cobros y envía comprobante
  por WhatsApp. La emisión tributaria (SII / CFDI) se mantiene en tu sistema actual.
¿Puedo migrar mis datos actuales? Sí, el equipo Vetly hace la implementación sin costo.
¿Sirve si atiendo a domicilio? Sí, funciona desde el celular. Fue creado por un
  veterinario de clínica móvil.
¿Qué pasa al terminar los 30 días? Eliges plan o tu cuenta queda en pausa.
  No hay cobro automático.
¿Cuántos usuarios incluye? 3 usuarios, sin costo adicional por usuario.
```

**T2.6 · Reducir fricción del registro**
- Máximo 3 campos: **email, contraseña, nombre de la clínica**. Todo lo demás en el onboarding post-registro.
- Botón "Continuar con Google" (reduce abandono ~20–30% en este tipo de SaaS).
- El campo teléfono, si se mantiene, opcional.

**T2.7 · Landings por mercado**
- `/core` (Chile, por defecto): lenguaje "ficha clínica", precios CLP, testimonios chilenos.
- `/core/mx`: **"expediente clínico"** en H1 y copy, precios MXN, mención explícita de que no hay cuota de implementación.
- Ambas con el mismo `sign_up`, diferenciadas por parámetro para reporting.

**T2.8 · Landing comparativa** `/core/comparar`
Tabla neutral (sin difamar): Core vs "software veterinario tradicional" con las filas trial / usuarios incluidos / inventario / finanzas / fidelización / costo de implementación. Destino de C4.

**T2.9 · Rendimiento**
- LCP < 2,5 s en móvil (Google Ads penaliza landings lentas vía nivel de calidad).
- CTA sticky en móvil.
- Verificar con PageSpeed Insights en 4G simulado.

---

### T3 — Configuración de la cuenta Google Ads

```
□ Crear cuenta y verificar el anunciante (verificación de identidad obligatoria)
□ Zona horaria: America/Santiago · Moneda: USD (coincide con el pricing)
□ Cargar la lista de negativas de la sección 7.3 a nivel cuenta
□ Desactivar "socios de búsqueda" y "red de Display"
□ Ubicación: "Presencia: personas en la ubicación" (NO "interés")
□ Crear las conversiones de la tabla T1.2 con sus valores
□ Marcar solo sign_up como "conversión principal" (Optimizar hacia)
□ Activar informes de términos de búsqueda y revisarlos 2× por semana el mes 1
□ Configurar alerta de gasto y tope de presupuesto de cuenta
□ Activar el autoetiquetado (gclid) — imprescindible para T1.3
```

---

### T4 — Rutina de optimización

**Semanas 1–4 (diario, 15 min):**
- Informe de términos de búsqueda → negativizar todo lo irrelevante. Es el 80% del trabajo el primer mes.
- Verificar que las conversiones se registren (probar un registro real y confirmarlo en Ads).

**Semanas 5–8:**
- Pausar keywords con >40 clics y 0 conversiones.
- Subir puja en las que convierten; si una campaña no convierte en 60 clics, pausarla.
- Cambiar a Maximizar conversiones al llegar a 15 conv./mes.

**Mes 3:**
- Primera importación de conversiones offline → recalcular CPA por cliente pagado.
- Test A/B de landing (H1 "30 días gratis" vs H1 "Deja las planillas").
- Evaluar apertura de Colombia y Perú si el CPA de MX < USD 15.

---

## 10. Métricas objetivo y modelo económico

**Supuestos de trabajo (a validar con datos reales):**

| Métrica | Chile | México |
|---|---|---|
| CPC estimado | USD 0,35–0,80 | USD 0,15–0,40 |
| CTR objetivo | 5–9% | 5–9% |
| CVR clic → registro trial | 4–8% | 3–6% |
| CVR trial → pago | 20–30% | 15–25% |
| **CPA por registro de trial** | **USD 8–15** | **USD 5–10** |
| **CAC por cliente pagado** | **USD 30–65** | **USD 25–55** |

**Con USD 250/mes:** ~400–700 clics → **20–45 registros de trial** → **4–11 clientes Core pagados**.

**Umbral de decisión:** Core a $39/mes con retención de 12 meses ≈ USD 470 de ingreso bruto. Un CAC bajo USD 80 es sano; bajo USD 50 es muy bueno. Si a los 60 días el CAC supera USD 120, el problema no es la campaña — es la landing o la oferta, y hay que volver a T2 antes de subir presupuesto.

**No escalar presupuesto** hasta tener 2 meses consecutivos con CAC por debajo del objetivo. Escalar +30% mensual como máximo para no romper el aprendizaje del algoritmo.

---

## 11. Secuencia de ejecución

```
Semana 1   T1 (medición completa) + T2.1, T2.2, T2.6
Semana 2   T2.3, T2.4, T2.5, T2.9 + T3 (cuenta configurada)
Semana 3   LANZAMIENTO Chile: C1 + C2 (USD 8/día, Maximizar clics con tope)
Semana 4   Añadir C3 y C5. Limpieza diaria de términos de búsqueda.
Semana 6   T2.7 (/core/mx) + T2.8 (/core/comparar). Añadir C4.
Semana 8   Revisión de CPA. Si CL valida → abrir México (C6).
Semana 12  Primera importación offline. Decidir escalado o rediseño de oferta.
```

---

## 12. Fuentes

> **Nota sobre conversiones a USD:** las equivalencias en dólares de esta tabla son aproximadas, calculadas con ~950 CLP/USD y ~18,5 MXN/USD. Los precios de referencia firmes son los que están en moneda local. Reverificar el tipo de cambio antes de usar cualquier cifra en copy público.

Datos verificados mediante búsquedas en Google (`gl=cl` y `gl=mx`) y lectura directa de los sitios el 19 de agosto de 2026. Los precios pueden cambiar; reverificar antes de usarlos en copy comparativo público.

- [Vetly](https://vetly.pro/) · [Vetly Core](https://vetly.pro/core)
- [Veti](https://www.veti.app/)
- [Wirevet](https://www.wirevet.cl/)
- [VetLink](https://vetlink.cl/)
- [GVET](https://www.gvet.cl/)
- [ACVet](https://www.acvet.app/)
- [Okvet](https://okvet.co/)
- [Vetmanger — Precios](https://vetmanger.xyz/precios/)
- [Sami](https://sami.vet/)
- [ComparaSoftware Chile — Software para Veterinarias](https://www.comparasoftware.cl/veterinario)
- [ComparaSoftware México — Software Veterinario](https://www.comparasoftware.com/veterinario)
- [Banco Central de Chile — Valor UF](https://si3.bcentral.cl/indicadoressiete/secure/indicadoresdiarios.aspx)
