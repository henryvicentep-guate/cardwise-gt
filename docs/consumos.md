# Consumos por tarjeta

La ficha principal muestra consumos registrados para el siguiente corte y gasto del mes calendario actual, ambos en GTQ y USD. Son compras normales registradas; las cuotas y el saldo del estado de cuenta se mantienen separados para evitar duplicarlos. Un consumo no modifica el saldo manual del estado de cuenta ni se reduce por un abono: estos indicadores muestran gasto bruto, no deuda neta.

El botón **+ Consumo** abre el formulario con la tarjeta de esa ficha como única opción. Guarda fecha, descripción, categoría, moneda y monto. El detalle abre los 10 movimientos más recientes por fecha de consumo y permite ampliar de 10 en 10. La pestaña Consumos también pagina sus resultados filtrados.

## Fechas y cortes

- El día de corte está incluido en ese corte, como en el registro existente.
- El día siguiente corresponde al próximo mes. Un corte 31 se ajusta al último día del mes.
- El gasto mensual usa la fecha del consumo, sin importar su corte.
- Los movimientos futuros se muestran como programados; se suman a los indicadores al llegar su fecha.
- El corte asignado se guarda con el consumo; editar después la tarjeta no reasigna movimientos históricos.
- Ejemplo con corte 15: Q1000 el 16/10, Q200 el 20/10 y Q300 el 14/11 corresponden al 15/11. Al 14/11: próximo corte Q1500 y noviembre Q300. Al 30/10: próximo corte Q1200 y octubre Q1200.

## Preparación para captura desde chat

`src/features/expenses/consumption.ts` expone `createCardExpense(input, cards, categories, id?)`, usada por el formulario. Este es el contrato para un futuro adaptador autenticado de Claude, Codex o importación:

```json
{
  "cardId": "identificador-real-de-la-tarjeta",
  "categoryId": "transporte",
  "currency": "GTQ",
  "description": "Gasolina",
  "amount": 100,
  "date": "2026-10-15"
}
```

La función valida tarjeta y categoría activas, moneda habilitada, monto positivo, fecha real y descripción; redondea a centavos y calcula el corte. La identidad estable es `cardId`; `cardAlias` es una etiqueta histórica. La resolución de frases como “Fico Gas” debe buscar entre las tarjetas del usuario y pedir aclaración si hay coincidencias ambiguas. Una fecha sin año y una moneda omitida deben resolverse explícitamente antes de escribir.

El adaptador deberá autenticar al propietario, usar un identificador estable por solicitud para evitar duplicados y persistir el resultado. No hay todavía un endpoint ni un conector de chat activado. No escribir desde un cliente externo directamente en las tablas mientras la app esté abierta: la sincronización actual reemplaza colecciones completas y debe cambiarse a operaciones por registro antes de permitir escritores simultáneos.

## Persistencia y despliegue

Se reutilizan `cardwise.expenses.v1` y `public.cardwise_expenses`, con el esquema existente de Supabase y políticas por propietario. No se requieren columnas nuevas. Antes de publicar, verificar que se ejecutó `supabase/schema.sql`, incluidas las tablas de categorías, consumos y abonos a consumos. Si faltan tablas, se conserva la copia local y se informa el error de sincronización.

Verificación: `npm test`, `npm run lint` y `npm run build`. Las pruebas incluyen el ejemplo de Q1500, separación de tarjetas/monedas, fechas futuras, precisión en centavos y límites de corte.
