# Ambiente de pruebas local

Todo corre en tu PC: **no toca la base real ni la web publicada**.

| Pieza | Qué es | Puerto |
|---|---|---|
| Postgres 17 embebido | La base de datos (paquete `embedded-postgres`, sin instalar nada en Windows) | 54322 |
| PostgREST 12 | El mismo motor de API que usa Supabase (se descarga solo la primera vez) | 54323 |
| Servidor web | Sirve el sitio y redirige `/rest/v1` a PostgREST | **8080** |

## Uso

```bash
npm run dev          # levanta todo → http://localhost:8080
npm run dev:reset    # borra la base local y la crea de nuevo con datos de prueba
```

En VS Code: **Terminal → Run Task → DANICHAP: ambiente local**.

### Usuarios de prueba (solo local)

| Usuario | Rol | Contraseña |
|---|---|---|
| `admin@danichap.test` | admin (ve Gestión y Admin) | `danichap-dev` |
| `cliente@danichap.test` | cliente | `danichap-dev` |

Entrá por `http://localhost:8080/login.html`.

## Cómo funciona

- Las migraciones son **los mismos SQL de `docs/`** que se corren en Supabase, en el orden de
  `dev/config.mjs → MIGRACIONES`, precedidos por `dev/supabase-shim.sql` (roles, `auth.uid()`,
  `storage`). Si un SQL falla acá, también fallaría en Supabase.
- Cada migración se aplica una sola vez (tabla `_dev.migraciones`). Para un SQL nuevo:
  agregalo a `docs/` y a la lista `MIGRACIONES`.
- `dev/seed.sql` carga usuarios, productos, clientes y precios de ejemplo.
- `dev/server.mjs` inyecta `/__dev/config.js` en cada HTML; con eso `supabase.js` apunta al
  ambiente local y simula el login. En producción ese archivo no existe y nada cambia.
- Las fotos que se suben desde el admin quedan en `.dev/storage/`.

## Robots contra la base local

1. `npm run dev` (deja `.dev/supabase.env` con la URL y la clave locales).
2. Copiá `.env.local.example` como `.env.local` y completá usuario/contraseña del distribuidor.
3. En otra terminal: `npm run dev:robot:dm` o `npm run dev:robot:pr`.

## Datos locales

Todo vive en `.dev/` (ignorado por git). Borrar esa carpeta = empezar de cero.
