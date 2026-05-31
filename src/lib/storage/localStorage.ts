import type { BalanceSnapshot } from '../../features/balances/types';
import { demoCards } from '../../features/cards/demoCards';
import type { CreditCardAccount, Currency } from '../../features/cards/types';
import type { InstallmentPlan } from '../../features/installments/types';
import type { PayableAccount, PayableAccountPayment } from '../../features/payables/types';
import type { PaymentRecord } from '../../features/payments/types';

const CARDS_STORAGE_KEY = 'cardwise.cards.v1';
const PAYMENTS_STORAGE_KEY = 'cardwise.payments.v1';
const INSTALLMENTS_STORAGE_KEY = 'cardwise.installments.v1';
const BALANCE_SNAPSHOTS_STORAGE_KEY = 'cardwise.balanceSnapshots.v1';
const PAYABLES_STORAGE_KEY = 'cardwise.payables.v1';
const PAYABLE_PAYMENTS_STORAGE_KEY = 'cardwise.payablePayments.v1';

function readCollection<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined') return fallback;

  const stored = window.localStorage.getItem(key);
  if (!stored) return fallback;

  try {
    const parsed = JSON.parse(stored) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeCollection<T>(key: string, items: T[]) {
  window.localStorage.setItem(key, JSON.stringify(items));
}

type LegacyCreditCardAccount = Omit<CreditCardAccount, 'currencies' | 'primaryCurrency' | 'creditLimits' | 'currentBalances'> & {
  currency?: Currency;
  creditLimit?: number;
  currentBalance?: number;
};

function migrateCard(card: CreditCardAccount | LegacyCreditCardAccount): CreditCardAccount {
  if ('currencies' in card && 'creditLimits' in card && 'currentBalances' in card) {
    return {
      ...card,
      currencies: card.currencies.length > 0 ? card.currencies : [card.primaryCurrency],
      creditLimits: { GTQ: card.creditLimits.GTQ ?? 0, USD: card.creditLimits.USD ?? 0 },
      currentBalances: { GTQ: card.currentBalances.GTQ ?? 0, USD: card.currentBalances.USD ?? 0 }
    };
  }

  const currency = card.currency ?? 'GTQ';

  return {
    id: card.id,
    bank: card.bank,
    alias: card.alias,
    currencies: [currency],
    primaryCurrency: currency,
    creditLimits: {
      GTQ: currency === 'GTQ' ? card.creditLimit ?? 0 : 0,
      USD: currency === 'USD' ? card.creditLimit ?? 0 : 0
    },
    annualInterestRate: card.annualInterestRate,
    cutDay: card.cutDay,
    graceDays: card.graceDays,
    colorHex: card.colorHex,
    active: card.active,
    currentBalances: {
      GTQ: currency === 'GTQ' ? card.currentBalance ?? 0 : 0,
      USD: currency === 'USD' ? card.currentBalance ?? 0 : 0
    }
  };
}

function migrateInstallment(plan: InstallmentPlan & { currency?: Currency }, cards: CreditCardAccount[]): InstallmentPlan {
  if (plan.currency) return plan;

  const card = cards.find((item) => item.id === plan.cardId);
  return {
    ...plan,
    currency: card?.primaryCurrency ?? 'GTQ'
  };
}

function getMergeKey(card: CreditCardAccount): string {
  return [card.bank.trim().toLowerCase(), normalizeAliasForMerge(card.alias), card.cutDay, card.graceDays, card.annualInterestRate].join('|');
}

function mergeCards(cards: CreditCardAccount[]): { cards: CreditCardAccount[]; idMap: Record<string, string> } {
  const mergedCards: CreditCardAccount[] = [];
  const cardByKey = new Map<string, CreditCardAccount>();
  const idMap: Record<string, string> = {};

  cards.forEach((card) => {
    const key = getMergeKey(card);
    const existingCard = cardByKey.get(key);

    if (!existingCard) {
      cardByKey.set(key, card);
      mergedCards.push(card);
      idMap[card.id] = card.id;
      return;
    }

    const currencies = Array.from(new Set([...existingCard.currencies, ...card.currencies]));
    const nextCard = {
      ...existingCard,
      alias: getMergedAlias(existingCard, card),
      currencies,
      creditLimits: {
        GTQ: Math.max(existingCard.creditLimits.GTQ, card.creditLimits.GTQ),
        USD: Math.max(existingCard.creditLimits.USD, card.creditLimits.USD)
      },
      currentBalances: {
        GTQ: existingCard.currentBalances.GTQ + card.currentBalances.GTQ,
        USD: existingCard.currentBalances.USD + card.currentBalances.USD
      }
    };

    cardByKey.set(key, nextCard);
    mergedCards[mergedCards.findIndex((item) => item.id === existingCard.id)] = nextCard;
    idMap[card.id] = existingCard.id;
  });

  return { cards: mergedCards, idMap };
}

function getMergedAlias(firstCard: CreditCardAccount, secondCard: CreditCardAccount): string {
  const bank = firstCard.bank.trim();
  const aliases = [firstCard.alias, secondCard.alias].map((alias) => alias.trim());
  const normalizedAliases = aliases.map(normalizeAliasForMerge);

  if (normalizedAliases[0] === normalizedAliases[1]) return aliases[0];
  return bank || aliases[0];
}

function normalizeAliasForMerge(alias: string): string {
  return alias.toLowerCase().replace(/\b(gtq|usd|q|\$)\b/g, '').replace(/\s+/g, ' ').trim();
}

function loadMigratedCards() {
  const cards = readCollection<CreditCardAccount | LegacyCreditCardAccount>(CARDS_STORAGE_KEY, demoCards).map(migrateCard);
  return mergeCards(cards.length > 0 ? cards : demoCards);
}

function migratePayable(payable: PayableAccount): PayableAccount {
  return {
    ...payable,
    amountType: payable.amountType ?? 'variable',
    dueDate: payable.dueDate,
    endDate: payable.endDate,
    endMode: payable.endMode ?? 'never',
    frequency: payable.frequency ?? 'monthly'
  };
}

export const localCardsStorage = {
  load(): CreditCardAccount[] {
    return loadMigratedCards().cards;
  },
  save(cards: CreditCardAccount[]) {
    writeCollection(CARDS_STORAGE_KEY, cards);
  }
};

export const localPaymentsStorage = {
  load(): PaymentRecord[] {
    const { idMap } = loadMigratedCards();
    return readCollection<PaymentRecord>(PAYMENTS_STORAGE_KEY, []).map((payment) => ({
      ...payment,
      cardId: idMap[payment.cardId] ?? payment.cardId
    }));
  },
  save(payments: PaymentRecord[]) {
    writeCollection(PAYMENTS_STORAGE_KEY, payments);
  }
};

export const localInstallmentsStorage = {
  load(): InstallmentPlan[] {
    const { cards, idMap } = loadMigratedCards();
    return readCollection<InstallmentPlan>(INSTALLMENTS_STORAGE_KEY, []).map((plan) =>
      migrateInstallment({ ...plan, cardId: idMap[plan.cardId] ?? plan.cardId }, cards)
    );
  },
  save(installments: InstallmentPlan[]) {
    writeCollection(INSTALLMENTS_STORAGE_KEY, installments);
  }
};

export const localBalanceSnapshotsStorage = {
  load(): BalanceSnapshot[] {
    const { idMap } = loadMigratedCards();
    return readCollection<BalanceSnapshot>(BALANCE_SNAPSHOTS_STORAGE_KEY, []).map((snapshot) => ({
      ...snapshot,
      cardId: idMap[snapshot.cardId] ?? snapshot.cardId
    }));
  },
  save(snapshots: BalanceSnapshot[]) {
    writeCollection(BALANCE_SNAPSHOTS_STORAGE_KEY, snapshots);
  }
};

export const localPayablesStorage = {
  load(): PayableAccount[] {
    return readCollection<PayableAccount>(PAYABLES_STORAGE_KEY, []).map(migratePayable);
  },
  save(payables: PayableAccount[]) {
    writeCollection(PAYABLES_STORAGE_KEY, payables);
  }
};

export const localPayablePaymentsStorage = {
  load(): PayableAccountPayment[] {
    return readCollection<PayableAccountPayment>(PAYABLE_PAYMENTS_STORAGE_KEY, []);
  },
  save(payments: PayableAccountPayment[]) {
    writeCollection(PAYABLE_PAYMENTS_STORAGE_KEY, payments);
  }
};
