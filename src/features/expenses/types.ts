import type { Currency } from '../cards/types';

export type ExpenseCategory = {
  id: string;
  name: string;
  colorHex: string;
  active: boolean;
  createdAt: string;
};

export type CardExpense = {
  id: string;
  cardId: string;
  cardAlias: string;
  categoryId: string;
  categoryName: string;
  currency: Currency;
  description: string;
  amount: number;
  date: string;
  cycleCutDate: string;
  createdAt: string;
};

export type ExpensePayment = {
  id: string;
  cardId: string;
  cardAlias: string;
  currency: Currency;
  amount: number;
  date: string;
  cycleCutDate: string;
  notes?: string;
  createdAt: string;
};
