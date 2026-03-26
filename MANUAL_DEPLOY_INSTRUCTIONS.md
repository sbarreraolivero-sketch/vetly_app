# Estado del CLI de Supabase

He verificado tu entorno y **no tienes el CLI de Supabase instalado**.
- Comando intentado: `supabase --version`
- Resultado: `supabase: command not found`

Esto significa que no puedes realizar despliegues automáticos desde la terminal.

## 🚀 Pasos para Desplegar la Edge Function Manualmente

1.  **Ve a tu Dashboard de Supabase:**
    Entra a tu proyecto en [supabase.com/dashboard](https://supabase.com/dashboard).

2.  **Sección Edge Functions:**
    En el menú lateral, ve a **Edge Functions**.

3.  **Crear Nueva Función:**
    Haz clic en el botón **"Create new Function"**.
    *   **Nombre de la Función:** `send-invite-email` (Debe ser exacto).

4.  **Copiar el Código:**
    Copia todo el contenido del archivo `supabase/functions/send-invite-email/index.ts` que ya tienes en tu proyecto local y pégalo en el editor online de Supabase.

5.  **Desplegar:**
    Haz clic en **Deployed** o **Save**.

6.  **(Opcional) Configurar Email Real:**
    En la configuración de la función, busca **"Secrets"** o **Variables de Entorno**.
    *   Añade: `RESEND_API_KEY`
    *   Valor: Tu clave de API de Resend (si no la tienes, el sistema simulará el envío).

## ⚠️ Recordatorio Importante:
Recuerda aplicar la migración SQL (` supabase/migrations/20260218183000_invite_system_improvements.sql`) en el **SQL Editor** de Supabase para que el registro de usuarios funcione correctamente.
