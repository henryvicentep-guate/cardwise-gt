import { useState } from 'react';
import type { CardPriority, CurrencyAmounts } from '../cards/types';
import { formatCurrency } from '../../lib/currency/formatCurrency';
import { formatShortDate } from '../../lib/dates/formatDate';
import { localDateValue, summarizeCardConsumption } from './consumption';
import type { CardExpense } from './types';

const amounts = (totals: CurrencyAmounts) => `${formatCurrency(totals.GTQ, 'GTQ')} · ${formatCurrency(totals.USD, 'USD')}`;

export function CardConsumption({ card, expenses, onRegister }: {
  card: CardPriority;
  expenses: CardExpense[];
  onRegister: (cardId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(10);
  const today = new Date();
  const todayValue = localDateValue(today);
  const summary = summarizeCardConsumption(expenses, card.id, localDateValue(card.nextCutDate), todayValue);
  const month = new Intl.DateTimeFormat('es-GT', { month: 'long' }).format(today);
  return (
    <section className="mt-4 min-w-0 rounded-lg border border-teal-200 bg-teal-50 p-3" aria-label={`Consumos de ${card.alias}`}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <p className="text-sm text-teal-900">Consumos para el próximo corte · {formatShortDate(card.nextCutDate)}</p>
      <p className="mt-1 break-words text-lg font-bold text-teal-950">{amounts(summary.cycle)}</p>
      <p className="mt-3 text-sm text-slate-600">En {month} llevas gastado</p>
      <p className="font-semibold text-slate-950">{amounts(summary.month)}</p>
      <p className="mt-2 text-xs text-slate-500">Consumos registrados hasta hoy. Las cuotas se muestran por separado.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="min-h-11 rounded-md bg-teal-700 px-2 text-sm font-semibold text-white" onClick={() => onRegister(card.id)} aria-label={`Registrar consumo en ${card.alias}`}>+ Consumo</button>
        <button className="min-h-11 rounded-md bg-white px-2 text-sm font-semibold text-teal-900" aria-expanded={open} aria-controls={`consumos-${card.id}`} onClick={() => { setOpen(!open); setLimit(10); }}>{open ? 'Ocultar movimientos' : 'Ver movimientos'}</button>
      </div>
      {open ? <div id={`consumos-${card.id}`} className="mt-3 border-t border-teal-200 pt-3">
        <p className="text-sm font-semibold">Últimos movimientos · {summary.movements.length}</p>
        {summary.movements.length === 0 ? <p className="mt-2 text-sm text-slate-500">Todavía no has registrado consumos en esta tarjeta.</p> : <ul className="mt-2 divide-y divide-teal-100">
          {summary.movements.slice(0, limit).map((expense) => <li key={expense.id} className="py-2 text-sm">
            <div className="flex flex-wrap justify-between gap-x-2"><span className="min-w-0 break-words font-medium">{expense.description}</span><strong>{formatCurrency(expense.amount, expense.currency)}</strong></div>
            <p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium' }).format(new Date(`${expense.date}T12:00:00`))} · {expense.categoryName}{expense.date > todayValue ? ' · Programado' : ''}</p>
          </li>)}
        </ul>}
        {summary.movements.length > limit ? <button className="mt-2 min-h-11 w-full rounded-md bg-white text-sm font-semibold text-teal-900" onClick={() => setLimit(limit + 10)}>Ver más ({summary.movements.length - limit} restantes)</button> : null}
      </div> : null}
    </section>
  );
}
