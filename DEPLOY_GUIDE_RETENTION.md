# Guía de Despliegue: Revenue Retention Engine™

Para activar la automatización completa del motor de retención en la nube, sigue estos pasos.

## 1. Prerrequisitos
Asegúrate de tener el CLI de Supabase instalado y vinculado a tu proyecto.

```bash
# Si no estás logueado
supabase login

# Vincula tu proyecto (necesitas el Reference ID, ej: hubjqllcmbzoojyidgcu)
supabase link --project-ref hubjqllcmbzoojyidgcu
```

## 2. Desplegar Edge Functions
Ejecuta los siguientes comandos en tu terminal (en la raíz del proyecto):

```bash
# 1. Desplegar el motor de cálculo diario
# Esta función recalcula scores y genera nuevas acciones pendientes/aprobadas
supabase functions deploy cron-retention-compute --no-verify-jwt

# 2. Desplegar el ejecutor de acciones
# Esta función procesa la cola de "aprobados" y envía los mensajes reales
supabase functions deploy cron-retention-execute --no-verify-jwt
```

> **Nota**: El flag `--no-verify-jwt` es importante para permitir que el Cron interno de Supabase invoque las funciones sin necesidad de un usuario logueado.

## 3. Configurar Automatización (Cron Jobs)
Una vez desplegadas, debes decirles cuándo ejecutarse. Puedes hacerlo desde el Dashboard de Supabase o mediante configuración.

### A. Desde el Dashboard (Más fácil)
1. Ve a **Edge Functions** en tu proyecto de Supabase.
2. Selecciona `cron-retention-compute`.
   - Busca la opción de "Schedules" o invocación periódica.
   - Configura: `0 8 * * *` (Ejecutar diariamente a las 8:00 AM UTC).
3. Selecciona `cron-retention-execute`.
   - Configura: `*/10 * * * *` (Ejecutar cada 10 minutos para procesar la cola rápidamente).

### B. Vía Archivo de Configuración (Mejor práctica)
Si tienes un archivo `supabase/config.toml`, añade estas secciones:

```toml
[functions.cron-retention-compute]
verify_jwt = false
schedule = "0 8 * * *"

[functions.cron-retention-execute]
verify_jwt = false
schedule = "*/10 * * * *"
```
Luego vuelve a hacer el deploy.

## 4. Variables de Entorno
Las funciones deberían funcionar con las variables por defecto de Supabase.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan automáticamente.
- Las API Keys de YCloud se leen directamente de tu tabla `clinic_settings`, por lo que **no necesitas configurarlas** manualmente en las funciones. ¡Ya está listo!
