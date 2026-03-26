# Citenly AI

SaaS premium para clínicas estéticas que gestiona citas por WhatsApp usando IA.

## 🚀 Características

- **Dashboard intuitivo** con diseño Soft Luxury
- **Gestión de citas** con confirmaciones automáticas
- **Chat de WhatsApp** integrado con YCloud API
- **Asistente IA** con OpenAI GPT-4o-mini
- **Recordatorios automáticos** vía cron job

## 🛠️ Stack Tecnológico

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS con tokens Soft Luxury
- **Backend**: Supabase (Auth, Postgres, Edge Functions)
- **WhatsApp**: YCloud API
- **IA**: OpenAI GPT-4o-mini con Function Calling

## 📦 Instalación

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# Build para producción
npm run build
```

## ⚙️ Configuración

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

### Supabase

1. Crea un nuevo proyecto en [Supabase](https://supabase.com)
2. Ejecuta el script SQL en `supabase/migrations/001_initial_schema.sql`
3. Despliega las Edge Functions:

```bash
supabase functions deploy ycloud-whatsapp-webhook
supabase functions deploy send-reminders
```

4. Configura el cron job para recordatorios en la consola de Supabase.

### YCloud

1. Crea una cuenta en [YCloud](https://ycloud.com)
2. Configura tu número de WhatsApp Business
3. Configura el webhook URL: `https://tu-proyecto.supabase.co/functions/v1/ycloud-whatsapp-webhook`
4. Guarda tu API Key en la configuración de la clínica

### OpenAI

1. Obtén una API Key de [OpenAI](https://platform.openai.com)
2. Guarda la API Key en la configuración de la clínica

## 📁 Estructura del Proyecto

```
citenly-ai/
├── src/
│   ├── components/
│   │   └── layout/
│   │       └── DashboardLayout.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Messages.tsx
│   │   ├── Appointments.tsx
│   │   └── Settings.tsx
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── utils.ts
│   ├── types/
│   │   └── database.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── functions/
│       ├── ycloud-whatsapp-webhook/
│       │   └── index.ts
│       └── send-reminders/
│           └── index.ts
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

## 🎨 Sistema de Diseño

### Colores

| Token | Valor | Uso |
|-------|-------|-----|
| Ivory | #FAFAF8 | Fondo principal |
| Silk Beige | #EDE6DE | Fondo secundario |
| Charcoal | #2E2E2E | Texto principal |
| Gold Soft | #C8A96A | Acentos |
| Primary 500 | #1F6F5C | Verde clínico |

### Tipografía

- **Fuente**: Plus Jakarta Sans
- **H1**: 48px / Bold
- **Body**: 16px / Regular

## 📄 Licencia

MIT © 2024 Citenly AI
