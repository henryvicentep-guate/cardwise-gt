import type { BalanceSnapshot } from '../../features/balances/types';
import type { CreditCardAccount } from '../../features/cards/types';
import type { InstallmentPlan } from '../../features/installments/types';
import type { PayableAccount, PayableAccountPayment } from '../../features/payables/types';
import type { PaymentRecord } from '../../features/payments/types';
import { supabase } from '../supabase/client';

type CardWiseTable =
  | 'cardwise_cards'
  | 'cardwise_payments'
  | 'cardwise_installments'
  | 'cardwise_balance_snapshots'
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
  const [cards, payments, installments, balanceSnapshots, payables, payablePayments] = await Promise.all([
    loadCloudCollection<CreditCardAccount>('cardwise_cards'),
    loadCloudCollection<PaymentRecord>('cardwise_payments'),
    loadCloudCollection<InstallmentPlan>('cardwise_installments'),
    loadCloudCollection<BalanceSnapshot>('cardwise_balance_snapshots'),
    loadCloudCollection<PayableAccount>('cardwise_payables'),
    loadCloudCollection<PayableAccountPayment>('cardwise_payable_payments')
  ]);

  return { balanceSnapshots, cards, installments, payablePayments, payables, payments };
}

export async function saveCloudData(data: CardWiseCloudData) {
  await Promise.all([
    replaceCloudCollection('cardwise_cards', data.cards),
    replaceCloudCollection('cardwise_payments', data.payments),
    replaceCloudCollection('cardwise_installments', data.installments),
    replaceCloudCollection('cardwise_balance_snapshots', data.balanceSnapshots),
    replaceCloudCollection('cardwise_payables', data.payables),
    replaceCloudCollection('cardwise_payable_payments', data.payablePayments)
  ]);
}

async function loadCloudCollection<T>(table: CardWiseTable): Promise<T[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.from(table).select('payload').order('updated_at', { ascending: false });
  if (error) throw error;

  return (data as Array<Pick<CloudRecord<T>, 'payload'>> | null)?.map((record) => record.payload) ?? [];
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
