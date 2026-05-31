import type { Currency } from '../../features/cards/types';

const formatters: Record<Currency, Intl.NumberFormat> = {
  GTQ: new Intl.NumberFormat('es-GT', {
    style: 'currency',
    currency: 'GTQ',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }),
  USD: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })
};

export function formatCurrency(value: number, currency: Currency): string {
  return formatters[currency].format(value);
}
