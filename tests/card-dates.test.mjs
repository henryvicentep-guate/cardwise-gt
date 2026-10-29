import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/cards/priority.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { buildCardPriority, buildPriorityRanking, sortCardsForDisplay } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const today = new Date(2026, 9, 29);
const card = (overrides = {}) => ({
  id: 'cashback', alias: 'CashBack', bank: 'Ficohsa', active: true,
  currencies: ['GTQ'], primaryCurrency: 'GTQ', creditLimits: { GTQ: 1000, USD: 0 },
  currentBalances: { GTQ: 402.46, USD: 0 }, annualInterestRate: 0, colorHex: '#000000',
  cutDay: 16, graceDays: 22, paymentDueDate: '2026-11-09', ...overrides
});

test('the screenshot cards share 11 days to payment despite different grace periods', () => {
  const cashback = buildCardPriority(card(), today);
  const gas = buildCardPriority(card({ id: 'gas', graceDays: 15 }), today);
  assert.equal(cashback.availableDays, 40);
  assert.equal(gas.availableDays, 33);
  assert.equal(cashback.daysUntilPayment, 11);
  assert.equal(gas.daysUntilPayment, 11);
  assert.equal(cashback.paymentDeadline.getTime(), gas.paymentDeadline.getTime());
  assert.equal(cashback.daysSinceLastCut, 13);
});

test('BI screenshot dates belong to separate cycles: 21 days to November, 51 to December', () => {
  const bi = buildCardPriority(card({ cutDay: 25, graceDays: 24, paymentDueDate: '2026-11-19' }), today);
  assert.equal(bi.daysUntilPayment, 21);
  assert.equal(bi.paymentDeadline.getMonth(), 10);
  assert.equal(bi.paymentDeadline.getDate(), 19);
  assert.equal(bi.availableDays, 51);
  assert.equal(bi.nextPaymentDate.getMonth(), 11);
  assert.equal(bi.nextPaymentDate.getDate(), 19);
});

test('default order prioritizes the longest estimated payment term for new purchases', () => {
  const ranking = buildPriorityRanking([
    card({ id: 'nov', alias: 'Noviembre', cutDay: 16, graceDays: 60 }),
    card({ id: 'oct', alias: 'Octubre', cutDay: 30, graceDays: 0 }),
    card({ id: 'inactive', active: false })
  ], today);
  assert.equal(ranking[0].id, 'nov');
  assert.deepEqual(sortCardsForDisplay([...ranking].reverse()).map(({ id }) => id), ['nov', 'oct']);
  assert.equal(ranking[0].id, 'nov', 'sorting must preserve the recommendation ranking');
});

test('payment order follows actual due dates, with overdue payments first', () => {
  const ranking = buildPriorityRanking([
    card({ id: 'later', graceDays: 60, paymentDueDate: '2026-11-09' }),
    card({ id: 'soon', graceDays: 30, paymentDueDate: '2026-10-30' }),
    card({ id: 'overdue', graceDays: 0, paymentDueDate: '2026-10-26' }),
    card({ id: 'today', graceDays: 15, paymentDueDate: '2026-10-29' })
  ], today);
  assert.deepEqual(sortCardsForDisplay(ranking, 'payment-due').map(({ id }) => id), ['overdue', 'today', 'soon', 'later']);
  assert.equal(ranking[0].id, 'later', 'the best card recommendation must not change');
});

test('today and overdue dates stay explicit instead of rolling into another month', () => {
  assert.equal(buildCardPriority(card({ paymentDueDate: '2026-10-29' }), today).daysUntilPayment, 0);
  assert.equal(buildCardPriority(card({ paymentDueDate: '2026-10-27' }), today).daysUntilPayment, -2);
  assert.equal(buildCardPriority(card(), new Date(2026, 9, 30)).daysUntilPayment, 10);
});

test('missing payment date uses the same estimate for its displayed date and counter', () => {
  const priority = buildCardPriority(card({ paymentDueDate: undefined }), today);
  assert.equal(priority.daysUntilPayment, priority.availableDays);
  assert.equal(priority.paymentDeadline.getTime(), priority.nextPaymentDate.getTime());
});

test('cut day 31 clamps to month end and handles year rollover and leap years', () => {
  assert.equal(buildCardPriority(card({ cutDay: 31 }), new Date(2028, 1, 10)).nextCutDate.getDate(), 29);
  const priority = buildCardPriority(card({ cutDay: 16 }), new Date(2026, 11, 29));
  assert.equal(priority.nextCutDate.getFullYear(), 2027);
  assert.equal(priority.nextCutDate.getMonth(), 0);
});

test('calendar-day counting is independent of daylight saving time', () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const priority = buildCardPriority(card({ paymentDueDate: '2026-11-03' }), new Date(2026, 9, 31));
    assert.equal(priority.daysUntilPayment, 3);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
