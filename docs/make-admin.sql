-- Correr en: Supabase Dashboard → SQL Editor
-- Reemplazar el email por el tuyo

UPDATE public.perfiles
SET rol = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'TU_EMAIL_AQUI'
);

-- Verificar:
SELECT p.id, p.nombre, p.rol, u.email
FROM public.perfiles p
JOIN auth.users u ON u.id = p.id;
