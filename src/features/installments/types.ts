import type { Currency } from '../cards/types';

export type InstallmentPlanStatus = 'active' | 'closed';

export type InstallmentPlan = {
  id: string;
  cardId: string;
  currency: Currency;
  description: string;
  totalAmount: number;
  monthlyPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  startDate: string;
  lastAppliedCutDate?: string;
  status?: InstallmentPlanStatus;
  closedAt?: string;
  createdAt: string;
};
