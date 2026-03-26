-- Create trigger function to auto-create default CRM pipeline stages
CREATE OR REPLACE FUNCTION public.create_default_crm_stages()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.crm_pipeline_stages (clinic_id, name, color, position, is_default)
  VALUES
    (NEW.id, 'Nuevo prospecto', '#3B82F6', 1, true),
    (NEW.id, 'Calificado', '#EAB308', 2, false),
    (NEW.id, 'Cita Agendada', '#22C55E', 3, false),
    (NEW.id, 'Comprobante Enviado', '#A855F7', 4, false),
    (NEW.id, 'Cerrado', '#64748B', 5, false);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Map the trigger to the clinic_settings table
DROP TRIGGER IF EXISTS trg_create_default_crm_stages ON public.clinic_settings;
CREATE TRIGGER trg_create_default_crm_stages
  AFTER INSERT ON public.clinic_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_crm_stages();
