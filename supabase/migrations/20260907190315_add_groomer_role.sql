-- Rol nuevo `groomer` para el Área de Estética Canina.
-- Debe estar committeado en la DB antes de que cualquier código inserte
-- clinic_members.role = 'groomer'. No hay CHECK constraint en clinic_members.role
-- (verificado), pero invite_member_v2 / update_member_permissions usan el tipo
-- enum public.user_role, así que el valor debe existir en el enum.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'groomer';
