# CardWise GT

PWA privada para gestionar tarjetas de credito, saldos, pagos recurrentes y vencimientos en GTQ y USD.

## Estado actual

Base inicial del proyecto creada con:

- React + Vite + TypeScript
- Tailwind CSS
- PWA manifest con `vite-plugin-pwa`
- UI mobile-first para iPhone
- Motor inicial de prioridad por dias disponibles
- CRUD local de tarjetas con persistencia en `localStorage`
- Capa local de persistencia separada para preparar migracion a Supabase
- Sincronizacion opcional con Supabase Auth + Postgres, manteniendo `localStorage` como cache local
- Ficha de tarjeta multi-moneda para manejar GTQ y USD en una sola tarjeta fisica
- Montos, saldos, limites y cuotas aceptan enteros y decimales
- Registro manual de abonos con historial local y descuento inmediato del saldo
- Pestaña `Pagos realizados` para historial de abonos y pagos de tarjetas
- Pestaña `Cuentas por pagar` para pagos recurrentes no-tarjeta y agenda combinada con vencimientos de tarjetas
- Cuentas por pagar con monto fijo/variable, frecuencia, vencimiento unico o recurrente, y opcion de no tener fecha final
- Actualizacion mensual manual de saldo actual con snapshots locales separados de pagos
- Abonos, snapshots y extrafinanciamientos registran moneda para no mezclar GTQ/USD
- Detalle por tarjeta con estado de cuenta local e historial filtrado
- Extrafinanciamientos locales informativos por tarjeta con avance automatico por corte, edicion, cierre, progreso, monto pendiente y cuota mensual esperada

## Persistencia local

- `cardwise.cards.v1`
- `cardwise.payments.v1`
- `cardwise.installments.v1`
- `cardwise.balanceSnapshots.v1`
- `cardwise.payables.v1`
- `cardwise.payablePayments.v1`

## Comandos

```bash
npm install
npm run dev
npm run build
npm run lint
```

Servidor local:

```bash
http://127.0.0.1:5173/
```

## Acceso privado y Supabase

1. Crea un proyecto en Supabase.
2. Ejecuta el SQL de `supabase/schema.sql` en el SQL Editor.
3. Copia `.env.example` a `.env.local` y completa:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Tambien se acepta `VITE_SUPABASE_ANON_KEY` por compatibilidad.

Con esas variables, CardWise muestra su propio acceso dentro de la app. Supabase queda como proveedor interno de Auth y base de datos. Al iniciar sesion, descarga datos remotos si existen; si la nube esta vacia, sube los datos locales del dispositivo.

Guia detallada: `SUPABASE_SETUP.md`.

## Produccion privada

Para publicar la PWA en internet, usar las variables de `.env.production.example` y activar:

```bash
VITE_REQUIRE_AUTH=true
```

Con ese modo, CardWise GT no muestra datos sin sesion.

Guia de despliegue: `DEPLOYMENT.md`.

## Siguiente paso recomendado

Validar Supabase en iPhone y Mac con una misma cuenta. Luego preparar importacion por OCR de estado de cuenta.
