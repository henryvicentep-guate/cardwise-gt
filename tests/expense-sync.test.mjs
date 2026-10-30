import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const clientUrl = moduleUrl(`
export const state = { missing: true, fail: false };
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  from(table) {
    const result = () => state.fail
      ? { error: { code: 'network', message: 'offline' } }
      : state.missing && table.includes('expense')
        ? { error: { code: 'PGRST205' } }
        : { data: [] };
    return {
      select: () => ({ order: async () => result(), then: (resolve) => Promise.resolve(result()).then(resolve) }),
      upsert: async () => result()
    };
  }
};`);
const localUrl = moduleUrl(`
export const localExpenseCategoriesStorage = { load: () => [{ id: 'transporte' }] };
export const localExpensePaymentsStorage = { load: () => [{ id: 'local-payment' }] };
export const localExpensesStorage = { load: () => [{ id: 'local-expense', amount: 100 }] };
`);
const source = readFileSync(new URL('../src/lib/storage/cloudStorage.ts', import.meta.url), 'utf8')
  .replace("'../supabase/client'", JSON.stringify(clientUrl))
  .replace("'./localStorage'", JSON.stringify(localUrl));
const { loadCloudData, saveCloudData } = await import(moduleUrl(source));
const { state } = await import(clientUrl);
const empty = { balanceSnapshots: [], cards: [], expenseCategories: [], expensePayments: [], expenses: [], installments: [], payablePayments: [], payables: [], payments: [] };

test('missing expense tables preserve local expense collections on load', async () => {
  const data = await loadCloudData();
  assert.equal(data.expenses[0].id, 'local-expense');
  assert.equal(data.expensePayments[0].id, 'local-payment');
  assert.equal(data.expenseCategories[0].id, 'transporte');
});

test('missing tables cannot report a successful save for populated expenses', async () => {
  await assert.rejects(saveCloudData({ ...empty, expenses: [{ id: 'new-expense' }] }), /Falta actualizar/);
  await saveCloudData(empty);
});

test('existing empty tables are authoritative and actual failures still surface', async () => {
  state.missing = false;
  assert.deepEqual((await loadCloudData()).expenses, []);
  await saveCloudData({ ...empty, expenses: [{ id: 'new-expense' }] });
  state.fail = true;
  await assert.rejects(loadCloudData(), (error) => error.code === 'network');
  await assert.rejects(saveCloudData(empty), (error) => error.code === 'network');
});
