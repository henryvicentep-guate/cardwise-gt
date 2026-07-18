import type { BalanceSnapshot } from '../../features/balances/types';
import type { CreditCardAccount } from '../../features/cards/types';
import type { CardExpense, ExpenseCategory, ExpensePayment } from '../../features/expenses/types';
import type { InstallmentPlan } from '../../features/installments/types';
import type { PayableAccount, PayableAccountPayment } from '../../features/payables/types';
import type { PaymentRecord } from '../../features/payments/types';
import { supabase } from '../supabase/client';

type CardWiseTable =
  | 'cardwise_cards'
  | 'cardwise_payments'
  | 'cardwise_installments'
  | 'cardwise_balance_snapshots'
  | 'cardwise_expense_categories'
  | 'cardwise_expense_payments'
  | 'cardwise_expenses'
  | 'cardwise_payables'
  | 'cardwise_payable_payments';

type CloudRecord<T> = {
  id: string;
  payload: T;
  updated_at?: string;
  user_id?: string;
};

export type CardWiseCloudData = {
  balanceSnapshots: BalanceSnapshot[];
  cards: CreditCardAccount[];
  expenseCategories: ExpenseCategory[];
  expensePayments: ExpensePayment[];
  expenses: CardExpense[];
  installments: InstallmentPlan[];
  payablePayments: PayableAccountPayment[];
  payables: PayableAccount[];
  payments: PaymentRecord[];
};

export async function getCloudUser() {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signInToCloud(email: string, password: string) {
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpToCloud(email: string, password: string) {
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const emailRedirectTo = `${window.location.origin}/`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo }
  });
  if (error) throw error;
  return data.session;
}

export async function sendPasswordReset(email: string) {
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const redirectTo = `${window.location.origin}/`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function signOutFromCloud() {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function loadCloudData(): Promise<CardWiseCloudData> {
  const [cards, payments, installments, balanceSnapshots, payables, payablePayments, expenseCategories, expenses, expensePayments] = await Promise.all([
    loadCloudCollection<CreditCardAccount>('cardwise_cards'),
    loadCloudCollection<PaymentRecord>('cardwise_payments'),
    loadCloudCollection<InstallmentPlan>('cardwise_installments'),
    loadCloudCollection<BalanceSnapshot>('cardwise_balance_snapshots'),
    loadCloudCollection<PayableAccount>('cardwise_payables'),
    loadCloudCollection<PayableAccountPayment>('cardwise_payable_payments'),
    loadOptionalCloudCollection<ExpenseCategory>('cardwise_expense_categories'),
    loadOptionalCloudCollection<CardExpense>('cardwise_expenses'),
    loadOptionalCloudCollection<ExpensePayment>('cardwise_expense_payments')
  ]);

  return { balanceSnapshots, cards, expenseCategories, expensePayments, expenses, installments, payablePayments, payables, payments };
}

export async function saveCloudData(data: CardWiseCloudData) {
  await Promise.all([
    replaceCloudCollection('cardwise_cards', data.cards),
    replaceCloudCollection('cardwise_payments', data.payments),
    replaceCloudCollection('cardwise_installments', data.installments),
    replaceCloudCollection('cardwise_balance_snapshots', data.balanceSnapshots),
    replaceCloudCollection('cardwise_payables', data.payables),
    replaceCloudCollection('cardwise_payable_payments', data.payablePayments),
    replaceOptionalCloudCollection('cardwise_expense_categories', data.expenseCategories),
    replaceOptionalCloudCollection('cardwise_expenses', data.expenses),
    replaceOptionalCloudCollection('cardwise_expense_payments', data.expensePayments)
  ]);
}

async function loadCloudCollection<T>(table: CardWiseTable): Promise<T[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.from(table).select('payload').order('updated_at', { ascending: false });
  if (error) throw error;

  return (data as Array<Pick<CloudRecord<T>, 'payload'>> | null)?.map((record) => record.payload) ?? [];
}

async function loadOptionalCloudCollection<T>(table: CardWiseTable): Promise<T[]> {
  try {
    return await loadCloudCollection<T>(table);
  } catch (error) {
    if (isMissingCloudTableError(error)) return [];
    throw error;
  }
}

async function replaceCloudCollection<T extends { id: string }>(table: CardWiseTable, items: T[]) {
  if (!supabase) return;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Inicia sesion para sincronizar.');

  const incomingIds = items.map((item) => item.id);
  const { data: existingRows, error: existingError } = await supabase.from(table).select('id');
  if (existingError) throw existingError;

  const staleIds =
    (existingRows as Array<Pick<CloudRecord<T>, 'id'>> | null)
      ?.map((record) => record.id)
      .filter((id) => !incomingIds.includes(id)) ?? [];

  if (staleIds.length > 0) {
    const { error } = await supabase.from(table).delete().in('id', staleIds);
    if (error) throw error;
  }

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    id: item.id,
    payload: item,
    user_id: userData.user.id
  }));

  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw error;
}

async function replaceOptionalCloudCollection<T extends { id: string }>(table: CardWiseTable, items: T[]) {
  try {
    await replaceCloudCollection(table, items);
  } catch (error) {
    if (isMissingCloudTableError(error)) return;
    throw error;
  }
}

function isMissingCloudTableError(error: unknown): boolean {
  if (!(error instanceof Error) && (typeof error !== 'object' || error === null)) return false;

  const cloudError = error as { code?: string; message?: string };
  return cloudError.code === '42P01' || cloudError.message?.includes('does not exist') === true;
}
