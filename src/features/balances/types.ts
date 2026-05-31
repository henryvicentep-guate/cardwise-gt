import type { Currency } from '../cards/types';

export type BalanceSnapshotSource = 'manual' | 'ocr';

export type BalanceSnapshot = {
  id: string;
  cardId: string;
  cardAlias: string;
  currency: Currency;
  previousBalance: number;
  newBalance: number;
  statementDate: string;
  source: BalanceSnapshotSource;
  notes?: string;
  createdAt: string;
};
