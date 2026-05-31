import type { Currency } from '../cards/types';

export type PayableCategory = 'servicios' | 'educacion' | 'hipoteca' | 'seguros' | 'suscripciones' | 'otros';

export type PayablePaymentMethod = 'tarjeta' | 'debito' | 'transferencia' | 'efectivo';

export type PayableAmountType = 'fixed' | 'variable';

export type PayableFrequency = 'once' | 'monthly' | 'quarterly' | 'annual';

export type PayableEndMode = 'never' | 'date';

export type PayableAccount = {
  id: string;
  name: string;
  category: PayableCategory;
  currency: Currency;
  amount: number;
  amountType: PayableAmountType;
  frequency: PayableFrequency;
  dueDay: number;
  dueDate?: string;
  endDate?: string;
  endMode: PayableEndMode;
  paymentMethod: PayablePaymentMethod;
  cardId?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
};

export type PayableAccountPayment = {
  id: string;
  payableId: string;
  payableName: string;
  currency: Currency;
  amount: number;
  dueDate: string;
  paidAt: string;
  notes?: string;
  createdAt: string;
};
