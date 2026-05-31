import type { Currency } from '../cards/types';

export type PaymentType = 'abono' | 'pago_total' | 'minimo';

export type PaymentRecord = {
  id: string;
  cardId: string;
  cardAlias: string;
  currency: Currency;
  amount: number;
  date: string;
  type: PaymentType;
  createdAt: string;
};
