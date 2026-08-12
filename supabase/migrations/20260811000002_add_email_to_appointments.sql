-- Campo de correo electrónico (opcional) en la creación de citas.
-- Se guarda en appointments.email (mismo patrón que phone_number/address:
-- dato del tutor duplicado en la cita) y se sincroniza hacia tutors.email
-- desde el frontend y los webhooks de IA para que aparezca como dato de
-- contacto en la ficha del tutor.
ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS email TEXT;
