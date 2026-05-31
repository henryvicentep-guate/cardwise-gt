# Deployment - CardWise GT

CardWise GT puede correr en dos modos:

- Desarrollo local: Vite en tu Mac, accesible por `localhost` o por IP en la red Wi-Fi.
- Produccion privada: frontend publicado en internet, acceso propio de CardWise, Auth con Supabase y datos en Postgres.

## Produccion recomendada

La ruta simple es:

1. Supabase para Auth + base de datos.
2. Vercel para publicar la PWA React/Vite.
3. Dominio propio opcional.

El usuario ve una pantalla de acceso de CardWise GT. Supabase funciona por debajo como proveedor de identidad y datos.

## Variables de produccion

Configurar estas variables en el hosting:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
VITE_REQUIRE_AUTH=true
```

`VITE_REQUIRE_AUTH=true` hace que la app no muestre tarjetas ni datos locales si no hay sesion iniciada.

No configurar `SUPABASE_SERVICE_ROLE_KEY` en el frontend.

## Build

```bash
npm install
npm run build
```

Directorio de salida:

```bash
dist
```

## Vercel

Configuracion esperada:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

El archivo `vercel.json` agrega:

- fallback a `index.html`
- headers basicos de seguridad
- `X-Robots-Tag: noindex, nofollow` para que la app privada no se indexe

## GitHub + Vercel para produccion

Estado esperado:

- Repo GitHub privado: `cardwise-gt`
- Dominio de produccion: `cardwise.henryvicente.com`
- Backend/Auth/Base de datos: Supabase
- Hosting PWA: Vercel

### 1. Inicializar y subir a GitHub

El repositorio local debe tener `main` como rama principal.

```bash
git status
git remote add origin git@github.com:TU_USUARIO/cardwise-gt.git
git push -u origin main
```

Si prefieres HTTPS:

```bash
git remote add origin https://github.com/TU_USUARIO/cardwise-gt.git
git push -u origin main
```

Antes del primer push, confirma que `.env.local`, `node_modules/` y `dist/` esten ignorados:

```bash
git status --ignored --short
```

### 2. Importar en Vercel

En Vercel:

- Importar el repo privado desde GitHub.
- Framework preset: `Vite`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Install command: `npm install`.

Variables de entorno de produccion:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
VITE_REQUIRE_AUTH=true
```

No configurar llaves secretas de Supabase en Vercel.

### 3. Dominio

Agregar este dominio al proyecto en Vercel:

```bash
cardwise.henryvicente.com
```

Despues, configurar el DNS del dominio segun los registros que indique Vercel.

### 4. Supabase Auth

En Supabase, actualizar Auth URLs:

```bash
Site URL: https://cardwise.henryvicente.com
Redirect URL: https://cardwise.henryvicente.com/**
```

Mantener las URLs locales solo si todavia se necesita probar Auth desde Vite local.

### 5. Verificacion final

Probar en produccion:

- Login desde Mac.
- Recuperacion de contrasena.
- Crear o editar una tarjeta.
- Confirmar sync en Supabase.
- Login desde iPhone.
- Confirmar que la misma tarjeta aparece en iPhone.
- Instalar la PWA en iPhone y volver a abrirla desde el icono.

## Checklist antes de publicar

1. Ejecutar `supabase/schema.sql` en Supabase.
2. Crear al menos un usuario privado en Supabase Auth.
3. Configurar variables de produccion en el hosting.
4. Publicar la app.
5. Entrar desde Mac con la cuenta.
6. Registrar o sincronizar datos.
7. Entrar desde iPhone con la misma cuenta y validar que aparecen los mismos datos.

## Desarrollo local despues de activar Supabase

Para seguir probando sin bloquear la app local:

```bash
VITE_REQUIRE_AUTH=false
```

Para probar local como produccion:

```bash
VITE_REQUIRE_AUTH=true
```
