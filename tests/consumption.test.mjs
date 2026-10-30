import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const priority = moduleUrl(readFileSync(new URL('../src/features/cards/priority.ts', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/features/expenses/consumption.ts', import.meta.url), 'utf8').replace("'../cards/priority'", JSON.stringify(priority));
const { createCardExpense, summarizeCardConsumption } = await import(moduleUrl(source));
const card = { id: 'gas', alias: 'Fico Gas', active: true, cutDay: 15, currencies: ['GTQ', 'USD'] };
const categories = [{ id: 'transporte', name: 'Transporte', active: true }];
const input = { cardId: 'gas', categoryId: 'transporte', currency: 'GTQ', description: 'Gasolina', amount: 100, date: '2026-10-15' };
const expense = (overrides = {}, cardOverride = {}) => createCardExpense({ ...input, ...overrides }, [{ ...card, ...cardOverride }], categories, 'expense-id');

test('October 16 and 20 plus November 14 sum to Q1500 at November 15 cut, November spend Q300', () => {
  const expenses = [expense({ date: '2026-10-16', amount: 1000 }), expense({ date: '2026-10-20', amount: 200 }), expense({ date: '2026-11-14', amount: 300 })];
  const summary = summarizeCardConsumption(expenses, 'gas', '2026-11-15', '2026-11-14');
  assert.deepEqual(summary.cycle, { GTQ: 1500, USD: 0 });
  assert.deepEqual(summary.month, { GTQ: 300, USD: 0 });
  assert.equal(summary.movements[0].date, '2026-11-14');
  assert.equal(expenses[0].date, '2026-10-16', 'does not mutate stored order');
  const october = summarizeCardConsumption(expenses, 'gas', '2026-11-15', '2026-10-30');
  assert.deepEqual(october.cycle, { GTQ: 1200, USD: 0 }, 'future entries do not inflate spend to date');
  assert.deepEqual(october.month, { GTQ: 1200, USD: 0 });
});

test('card, cycle and currency stay separate; cent arithmetic is exact', () => {
  const expenses = [expense({ amount: 0.1 }), expense({ amount: 0.2 }), expense({ currency: 'USD', amount: 20 }), expense({ date: '2026-10-16', amount: 500 }), { ...expense({ amount: 999 }), cardId: 'other' }];
  const summary = summarizeCardConsumption(expenses, 'gas', '2026-10-15', '2026-10-15');
  assert.deepEqual(summary.cycle, { GTQ: 0.3, USD: 20 });
  assert.equal(summary.movements.length, 4);
  assert.deepEqual(summarizeCardConsumption([], 'gas', '2026-11-15', '2026-11-01').month, { GTQ: 0, USD: 0 });
});

test('cut day itself is included, after cut rolls forward, month end and year rollover clamp', () => {
  assert.equal(expense().cycleCutDate, '2026-10-15');
  assert.equal(expense({ date: '2026-10-16' }).cycleCutDate, '2026-11-15');
  assert.equal(expense({ date: '2026-02-28' }, { cutDay: 31 }).cycleCutDate, '2026-02-28');
  assert.equal(expense({ date: '2026-12-31' }).cycleCutDate, '2027-01-15');
});

test('shared entry validates card, category, currency, amount, date and description', () => {
  for (const override of [{ cardId: 'unknown' }, { categoryId: 'unknown' }, { currency: 'EUR' }, { amount: 0 }, { amount: -1 }, { amount: 0.001 }, { amount: Number.MAX_VALUE }, { amount: NaN }, { amount: Infinity }, { date: '2026-02-30' }, { date: 'invalid' }, { description: ' ' }]) {
    assert.throws(() => expense(override));
  }
  assert.throws(() => expense({}, { active: false }));
  const result = expense({ description: ' Gasolina ', amount: 100.999 });
  assert.equal(result.amount, 101);
  assert.equal(result.description, 'Gasolina');
  assert.equal(result.cardAlias, 'Fico Gas');
});
