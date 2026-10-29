import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const priorityUrl = dataUrl(compile('../src/features/cards/priority.ts'));
const module = compile('../src/features/installments/progress.ts').replace("'../cards/priority'", JSON.stringify(priorityUrl));
const { applyAutomaticInstallmentProgress: advance, summarizeInstallments: totals } = await import(dataUrl(module));
const card = { id: 'bi', cutDay: 25 };
const plan = (overrides = {}) => ({ id: 'car', cardId: 'bi', currency: 'GTQ', description: 'Carro', monthlyPayment: 100, totalAmount: 4800, totalInstallments: 48, paidInstallments: 0, startDate: '2026-10-29', lastAppliedCutDate: '2026-10-25', createdAt: '2026-10-29', ...overrides });

test('example totals are Q9,600 pending and Q1,100 monthly; USD remains separate', () => {
  assert.deepEqual(totals([plan(), plan({ monthlyPayment: 200, totalInstallments: 12 }), plan({ monthlyPayment: 800, totalInstallments: 3 }), plan({ currency: 'USD', monthlyPayment: 10, totalInstallments: 2 })]), [{ currency: 'GTQ', pending: 9600, monthly: 1100 }, { currency: 'USD', pending: 20, monthly: 10 }]);
});
test('48 becomes 47 at the next cut even when registered one day earlier', () => {
  const plans = [plan({ startDate: '2026-11-24' })];
  assert.equal(advance(plans, [card], new Date(2026, 10, 24)), plans);
  const next = advance(plans, [card], new Date(2026, 10, 25));
  assert.equal(next[0].paidInstallments, 1);
  assert.equal(totals(next)[0].pending, 4700);
  assert.equal(advance(next, [card], new Date(2026, 10, 25)), next);
});
test('entry on cut date starts next month and opening after three cuts catches up once', () => {
  const plans = [plan({ startDate: '2026-10-25' })];
  assert.equal(advance(plans, [card], new Date(2026, 9, 25)), plans);
  const next = advance(plans, [card], new Date(2027, 0, 25));
  assert.equal(next[0].paidInstallments, 3);
  assert.equal(advance(next, [card], new Date(2027, 0, 26)), next);
});
test('month end cuts clamp correctly in February and close at zero without negative balances', () => {
  const next = advance([plan({ startDate: '2027-01-31', lastAppliedCutDate: '2027-01-31', totalInstallments: 2 })], [{ ...card, cutDay: 31 }], new Date(2027, 4, 31));
  assert.equal(next[0].paidInstallments, 2);
  assert.equal(next[0].lastAppliedCutDate, '2027-03-31');
  assert.equal(next[0].closureReason, 'completed');
  assert.deepEqual(totals(next), [{ currency: 'GTQ', pending: 0, monthly: 0 }]);
});
test('closed, settled and removed records remain in history and do not accrue cuts', () => {
  const plans = ['settled', 'removed'].map((closureReason) => plan({ status: 'closed', closureReason }));
  assert.equal(advance(plans, [card], new Date(2028, 1, 25)), plans);
  assert.equal(plans.length, 2);
  assert.equal(totals(plans)[0].pending, 0);
});
test('legacy checkpoint is initialized without assuming past payments; totals use cents', () => {
  const next = advance([plan({ lastAppliedCutDate: undefined, monthlyPayment: 0.1, totalInstallments: 3 })], [card], new Date(2026, 10, 25));
  assert.equal(next[0].paidInstallments, 0);
  assert.equal(next[0].lastAppliedCutDate, '2026-11-25');
  assert.equal(totals(next)[0].pending, 0.3);
});

test('unknown original start date still advances from the registration checkpoint', () => {
  const next = advance([plan({ startDate: undefined })], [card], new Date(2026, 10, 25));
  assert.equal(next[0].paidInstallments, 1);
  assert.equal(next[0].startDate, undefined);
});
