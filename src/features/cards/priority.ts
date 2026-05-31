import type { CardPriority, CreditCardAccount, UrgencyLevel } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildPriorityRanking(cards: CreditCardAccount[], today = new Date()): CardPriority[] {
  return cards
    .filter((card) => card.active)
    .map((card) => buildCardPriority(card, today))
    .sort((a, b) => b.availableDays - a.availableDays);
}

export function buildCardPriority(card: CreditCardAccount, today = new Date()): CardPriority {
  const lastCutDate = getLastCutDate(today, card.cutDay);
  const nextCutDate = getNextCutDate(today, card.cutDay);
  const nextPaymentDate = addDays(nextCutDate, card.graceDays);
  const daysSinceLastCut = diffInCalendarDays(lastCutDate, today);
  const availableDays = diffInCalendarDays(today, nextPaymentDate);

  return {
    ...card,
    lastCutDate,
    nextCutDate,
    nextPaymentDate,
    daysSinceLastCut,
    availableDays,
    urgencyLevel: getUrgencyLevel(availableDays)
  };
}

export function getNextCutDate(today: Date, cutDay: number): Date {
  const safeCutDay = Math.min(Math.max(cutDay, 1), 31);
  const year = today.getFullYear();
  const month = today.getMonth();
  const thisMonthCut = buildDateClamped(year, month, safeCutDay);

  if (stripTime(today).getTime() <= thisMonthCut.getTime()) {
    return thisMonthCut;
  }

  return buildDateClamped(year, month + 1, safeCutDay);
}

export function getLastCutDate(today: Date, cutDay: number): Date {
  const safeCutDay = Math.min(Math.max(cutDay, 1), 31);
  const year = today.getFullYear();
  const month = today.getMonth();
  const thisMonthCut = buildDateClamped(year, month, safeCutDay);

  if (stripTime(today).getTime() >= thisMonthCut.getTime()) {
    return thisMonthCut;
  }

  return buildDateClamped(year, month - 1, safeCutDay);
}

export function getDaysSinceLastCut(today: Date, cutDay: number): number {
  return diffInCalendarDays(getLastCutDate(today, cutDay), today);
}

function getUrgencyLevel(days: number): UrgencyLevel {
  if (days >= 30) return 'high';
  if (days >= 15) return 'medium';
  if (days >= 8) return 'low';
  return 'urgent';
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return stripTime(nextDate);
}

function diffInCalendarDays(start: Date, end: Date): number {
  return Math.ceil((stripTime(end).getTime() - stripTime(start).getTime()) / MS_PER_DAY);
}

function buildDateClamped(year: number, month: number, preferredDay: number): Date {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(preferredDay, lastDayOfMonth));
}

function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
