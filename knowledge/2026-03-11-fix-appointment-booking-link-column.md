# Acierto: Solución a Error de Agendamiento (Columna 'link' faltante)

**Fecha:** 2026-03-11  
**Módulo:** Agendamiento / Base de Datos (Supabase)  
**Severidad:** Crítica (Impedía el registro de nuevas citas)

## 1. El Problema
Los pacientes (y el simulador) no podían completar el proceso de agendamiento. Al intentar confirmar la cita, el sistema devolvía un error técnico o se quedaba bloqueado.

## 2. Diagnóstico (Root Cause)
Gracias a un bypass técnico en el simulador, identificamos el error exacto:
`⚠️ DEBUG ERROR: Error DB-DETAIL: column "link" of relation "notifications" does not exist (Code: 42703).`

**Explicación:**
La tabla `public.appointments` tiene un **Trigger** llamado `trigger_appointment_notifications`. Este trigger se activa automáticamente cada vez que se inserta una cita para notificar a la clínica. El trigger intentaba insertar un registro en la tabla `notifications` incluyendo un campo `link` (con el valor `'/appointments'`), pero dicha columna no existía en la estructura actual de la tabla en la base de datos de producción.

## 3. Solución Aplicada
Se ejecutó un script SQL para normalizar la base de datos:

1. **Creación de columna:** Se añadió la columna `link` de tipo `TEXT` a la tabla `public.notifications`.
2. **Actualización de Función:** Se recreó la función `public.handle_appointment_notifications()` para asegurar que el trigger maneje correctamente los datos.

### Código SQL de la solución:
```sql
-- 1. Agregar columna faltante
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- 2. Re-asegurar integridad de la función del trigger
CREATE OR REPLACE FUNCTION public.handle_appointment_notifications()
RETURNS TRIGGER AS $$
DECLARE
    prefs RECORD;
    notif_title TEXT;
    notif_msg TEXT;
    notif_type TEXT;
    should_notify BOOLEAN := false;
BEGIN
    SELECT * INTO prefs FROM public.notification_preferences WHERE clinic_id = NEW.clinic_id LIMIT 1;
    
    IF TG_OP = 'INSERT' THEN
        notif_type := 'new_appointment';
        notif_title := 'Nueva Cita';
        notif_msg := 'Se ha agendado una cita para ' || NEW.patient_name || ' (' || COALESCE(NEW.service, 'consulta') || ').';
        IF prefs IS NULL OR COALESCE(prefs.new_appointment, true) THEN should_notify := true; END IF;
    -- (Resto de la lógica de update omitida por brevedad)

    IF should_notify THEN
        INSERT INTO public.notifications (clinic_id, type, title, message, link)
        VALUES (NEW.clinic_id, notif_type, notif_title, notif_msg, '/appointments');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 4. Prevención para el Futuro
*   Siempre verificar que las funciones de los Triggers coincidan exactamente con las columnas existentes en las tablas relacionadas.
*   En caso de error en agendamiento sin log claro, habilitar el reporte de error detallado en la función `createAppt` del Edge Function `ai-simulator`.
