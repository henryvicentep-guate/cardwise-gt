export type Currency = 'GTQ' | 'USD';

export type CurrencyAmounts = Record<Currency, number>;

export type CreditCardAccount = {
  id: string;
  bank: string;
  alias: string;
  currencies: Currency[];
  primaryCurrency: Currency;
  creditLimits: CurrencyAmounts;
  benefitsDescription?: string;
  annualInterestRate: number;
  cutDay: number;
  graceDays: number;
  colorHex: string;
  active: boolean;
  currentBalances: CurrencyAmounts;
  paymentDueDate?: string;
};

export type UrgencyLevel = 'high' | 'medium' | 'low' | 'urgent';

export type CardPriority = CreditCardAccount & {
  lastCutDate: Date;
  nextCutDate: Date;
  nextPaymentDate: Date;
  daysSinceLastCut: number;
  availableDays: number;
  urgencyLevel: UrgencyLevel;
};
