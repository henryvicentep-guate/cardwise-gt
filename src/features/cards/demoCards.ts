import type { CreditCardAccount } from './types';

export const demoCards: CreditCardAccount[] = [
  {
    id: 'bac',
    bank: 'BAC',
    alias: 'BAC principal',
    currencies: ['GTQ', 'USD'],
    primaryCurrency: 'GTQ',
    creditLimits: { GTQ: 25000, USD: 3200 },
    annualInterestRate: 49,
    cutDay: 25,
    graceDays: 15,
    colorHex: '#0f766e',
    active: true,
    currentBalances: { GTQ: 1250, USD: 0 }
  },
  {
    id: 'bi',
    bank: 'Banco Industrial',
    alias: 'BI compras',
    currencies: ['GTQ', 'USD'],
    primaryCurrency: 'GTQ',
    creditLimits: { GTQ: 18000, USD: 2300 },
    annualInterestRate: 48,
    cutDay: 8,
    graceDays: 20,
    colorHex: '#2563eb',
    active: true,
    currentBalances: { GTQ: 3420, USD: 0 }
  },
  {
    id: 'cuscatlan',
    bank: 'Cuscatlan',
    alias: 'Cuscatlan',
    currencies: ['GTQ', 'USD'],
    primaryCurrency: 'GTQ',
    creditLimits: { GTQ: 12000, USD: 3500 },
    annualInterestRate: 42,
    cutDay: 14,
    graceDays: 15,
    colorHex: '#0f766e',
    active: true,
    currentBalances: { GTQ: 2250, USD: 1245 }
  },
  {
    id: 'gt',
    bank: 'G&T',
    alias: 'G&T emergencias',
    currencies: ['GTQ', 'USD'],
    primaryCurrency: 'GTQ',
    creditLimits: { GTQ: 12000, USD: 1500 },
    annualInterestRate: 50,
    cutDay: 30,
    graceDays: 15,
    colorHex: '#dc2626',
    active: true,
    currentBalances: { GTQ: 780, USD: 0 }
  }
];
