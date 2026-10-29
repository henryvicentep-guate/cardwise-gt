import { getLastCutDate, getNextCutDate } from '../cards/priority';
import type { CreditCardAccount, Currency } from '../cards/types';
import type { InstallmentPlan } from './types';

const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export function isInstallmentActive(plan: InstallmentPlan): boolean {
  return plan.status !== 'closed' && plan.paidInstallments < plan.totalInstallments;
}

export function summarizeInstallments(plans: InstallmentPlan[]) {
  const active = plans.filter(isInstallmentActive);
  const currencies: Currency[] = ['GTQ', 'USD'];
  return currencies.filter((currency) => currency === 'GTQ' || active.some((plan) => plan.currency === currency)).map((currency) => {
    const matching = active.filter((plan) => plan.currency === currency);
    return {
      currency,
      monthly: matching.reduce((sum, plan) => sum + Math.round(plan.monthlyPayment * 100), 0) / 100,
      pending: matching.reduce((sum, plan) => sum + Math.round(plan.monthlyPayment * 100) * Math.max(plan.totalInstallments - plan.paidInstallments, 0), 0) / 100
    };
  });
}

export function applyAutomaticInstallmentProgress(plans: InstallmentPlan[], cards: CreditCardAccount[], today: Date): InstallmentPlan[] {
  let changed = false;
  const next = plans.map((plan) => {
    if (!isInstallmentActive(plan)) return plan;
    const card = cards.find((item) => item.id === plan.cardId);
    if (!card) return plan;
    const latest = getLastCutDate(today, card.cutDay);
    // Legacy plans without a checkpoint start tracking now; do not invent past payments.
    if (!plan.lastAppliedCutDate) {
      changed = true;
      return { ...plan, lastAppliedCutDate: dateValue(latest) };
    }
    const checkpoint = parseDate(plan.lastAppliedCutDate);
    const after = new Date(checkpoint.getFullYear(), checkpoint.getMonth(), checkpoint.getDate() + 1);
    let cursor = getNextCutDate(after, card.cutDay);
    let paid = plan.paidInstallments;
    let last = plan.lastAppliedCutDate;
    while (cursor <= latest && paid < plan.totalInstallments) {
      if (cursor >= parseDate(plan.startDate || plan.createdAt.slice(0, 10))) paid += 1;
      last = dateValue(cursor);
      cursor = getNextCutDate(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1), card.cutDay);
    }
    if (last === plan.lastAppliedCutDate) return plan;
    changed = true;
    const completed = paid >= plan.totalInstallments;
    return { ...plan, paidInstallments: paid, lastAppliedCutDate: last,
      ...(completed ? { status: 'closed' as const, closureReason: 'completed' as const, closedAt: parseDate(last).toISOString() } : {}) };
  });
  return changed ? next : plans;
}
