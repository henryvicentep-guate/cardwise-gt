import { getNextCutDate } from '../cards/priority';
import type { CreditCardAccount, Currency, CurrencyAmounts } from '../cards/types';
import type { CardExpense, ExpenseCategory } from './types';

export type ExpenseInput = {
  cardId: string;
  categoryId: string;
  currency: Currency;
  description: string;
  amount: number;
  date: string;
};

export function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Shared entry point for the form and future authenticated chat/import adapters. */
export function createCardExpense(input: ExpenseInput, cards: CreditCardAccount[], categories: ExpenseCategory[], id: string = crypto.randomUUID()): CardExpense {
  const card = cards.find((item) => item.id === input.cardId && item.active);
  const category = categories.find((item) => item.id === input.categoryId && item.active);
  if (!card) throw new Error('Selecciona una tarjeta activa.');
  if (!category) throw new Error('Selecciona una categoria activa.');
  if (!card.currencies.includes(input.currency)) throw new Error('La moneda no esta habilitada en esta tarjeta.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('El monto debe ser mayor que cero.');
  const cents = Math.round((input.amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Ingresa un monto valido de al menos 0.01.');
  if (!input.description.trim()) throw new Error('Ingresa una descripcion.');
  const date = new Date(`${input.date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(date.getTime()) || localDateValue(date) !== input.date) {
    throw new Error('Ingresa una fecha valida.');
  }
  return {
    ...input,
    id,
    amount: cents / 100,
    description: input.description.trim(),
    cardAlias: card.alias,
    categoryName: category.name,
    cycleCutDate: localDateValue(getNextCutDate(date, card.cutDay)),
    createdAt: new Date().toISOString()
  };
}

export function summarizeCardConsumption(expenses: CardExpense[], cardId: string, nextCutDate: string, today: string) {
  const movements = expenses.filter((expense) => expense.cardId === cardId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const cycle: CurrencyAmounts = { GTQ: 0, USD: 0 };
  const month: CurrencyAmounts = { GTQ: 0, USD: 0 };
  for (const expense of movements) {
    if (expense.date > today) continue;
    if (expense.cycleCutDate === nextCutDate) cycle[expense.currency] += Math.round(expense.amount * 100);
    if (expense.date.slice(0, 7) === today.slice(0, 7)) month[expense.currency] += Math.round(expense.amount * 100);
  }
  for (const currency of ['GTQ', 'USD'] as const) {
    cycle[currency] /= 100;
    month[currency] /= 100;
  }
  return { cycle, month, movements };
}
