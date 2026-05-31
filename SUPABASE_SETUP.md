# Supabase setup - CardWise GT

## 1. Crear proyecto

Crear un proyecto nuevo en Supabase y guardar:

- Project URL
- Publishable key o anon public key

No uses `service_role` en la PWA. Esa llave solo sirve para backend privado.

## 2. Crear tablas

Abrir SQL Editor en Supabase y ejecutar:

```sql
-- contenido de supabase/schema.sql
```

El esquema crea cuatro tablas:

- `cardwise_cards`
- `cardwise_payments`
- `cardwise_installments`
- `cardwise_balance_snapshots`
- `cardwise_payables`
- `cardwise_payable_payments`

Cada tabla guarda el objeto actual de la app en `payload` y protege las filas con RLS por `auth.uid()`.

## 3. Configurar variables locales

Crear `.env.local`:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
```

Si el proyecto muestra una anon public key en vez de publishable key:

```bash
VITE_SUPABASE_ANON_KEY=tu_anon_key
```

Reiniciar Vite despues de cambiar `.env.local`.

## 4. Auth privado

El login visible pertenece a CardWise GT. Supabase Auth solo valida credenciales, mantiene la sesion y permite aplicar RLS en las tablas.

Para una app privada, hay dos caminos simples:

- Crear usuarios manualmente en Supabase Auth y usar "Entrar" en CardWise GT.
- Permitir "Crear" desde la app y decidir si Supabase debe exigir confirmacion por correo.

Si la confirmacion por correo esta activa, el usuario debe confirmar el correo antes de iniciar sesion.

## 5. Primera sincronizacion

Al iniciar sesion:

- Si Supabase ya tiene datos, la app los descarga y actualiza el cache local.
- Si Supabase esta vacio, la app sube los datos locales actuales.
- Despues, cada cambio se guarda en `localStorage` y se sincroniza con Supabase.

Para validar entre Mac y iPhone, usar la misma cuenta en ambos dispositivos.
