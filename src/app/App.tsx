import {
  Banknote,
  ChevronDown,
  ClipboardList,
  Cloud,
  CreditCard,
  Filter,
  GitMerge,
  LogOut,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Tags,
  X
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { BalanceSnapshot } from '../features/balances/types';
import { buildPriorityRanking, getLastCutDate, getNextCutDate } from '../features/cards/priority';
import type { CardPriority, CreditCardAccount, Currency } from '../features/cards/types';
import type { CardExpense, ExpenseCategory, ExpensePayment } from '../features/expenses/types';
import type { InstallmentPlan } from '../features/installments/types';
import type {
  PayableAccount,
  PayableAccountPayment,
  PayableAmountType,
  PayableCategory,
  PayableEndMode,
  PayableFrequency,
  PayablePaymentMethod
} from '../features/payables/types';
import type { PaymentRecord, PaymentType } from '../features/payments/types';
import { formatCurrency } from '../lib/currency/formatCurrency';
import { formatShortDate } from '../lib/dates/formatDate';
import {
  getCloudUser,
  loadCloudData,
  saveCloudData,
  sendPasswordReset,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud,
  updateCloudPassword
} from '../lib/storage/cloudStorage';
import {
  localBalanceSnapshotsStorage,
  localCardsStorage,
  localExpenseCategoriesStorage,
  localExpensePaymentsStorage,
  localExpensesStorage,
  localInstallmentsStorage,
  localPayablePaymentsStorage,
  localPayablesStorage,
  localPaymentsStorage
} from '../lib/storage/localStorage';
import { isAuthRequired, isSupabaseConfigured, supabase } from '../lib/supabase/client';

type ActiveTab = 'cards' | 'calendar' | 'payment-history' | 'payables';

type CardFormState = {
  bank: string;
  alias: string;
  hasGTQ: boolean;
  hasUSD: boolean;
  primaryCurrency: Currency;
  creditLimitGTQ: string;
  creditLimitUSD: string;
  benefitsDescription: string;
  annualInterestRate: string;
  cutDay: string;
  graceDays: string;
  currentBalanceGTQ: string;
  currentBalanceUSD: string;
  paymentDueDate: string;
  colorHex: string;
};

type PaymentFormState = {
  amount: string;
  cardId: string;
  currency: Currency;
  date: string;
  type: PaymentType;
};

type InstallmentFormState = {
  cardId: string;
  currency: Currency;
  description: string;
  totalAmount: string;
  monthlyPayment: string;
  totalInstallments: string;
  paidInstallments: string;
  startDate: string;
};

type BalanceUpdateFormState = {
  amount: string;
  cardId: string;
  currency: Currency;
  notes: string;
  paymentDueDate: string;
  statementDate: string;
};

type ExpenseFormState = {
  amount: string;
  cardId: string;
  categoryId: string;
  currency: Currency;
  date: string;
  description: string;
};

type ExpensePaymentFormState = {
  amount: string;
  cardId: string;
  currency: Currency;
  date: string;
  notes: string;
};

type ExpenseCategoryFormState = {
  colorHex: string;
  name: string;
};

type ExpenseViewMode = 'cycle' | 'month';

type PayableFormState = {
  amount: string;
  amountType: PayableAmountType;
  cardId: string;
  category: PayableCategory;
  currency: Currency;
  dueDay: string;
  dueDate: string;
  endDate: string;
  endMode: PayableEndMode;
  frequency: PayableFrequency;
  name: string;
  notes: string;
  paymentMethod: PayablePaymentMethod;
};

type PayableAgendaItem = {
  amount: number;
  amountLabel?: string;
  currency: Currency;
  dueDate: Date;
  id: string;
  isPaid: boolean;
  kind: 'card' | 'payable';
  subtitle: string;
  title: string;
};

type PayablePaymentDraft = {
  dueDate: Date;
  payable: PayableAccount;
};

type PayablePaymentFormState = {
  amount: string;
  notes: string;
};

type MergeCardsRequest = {
  sourceCardId: string;
  targetCardId: string;
};

type CloudSyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'error';

const emptyForm: CardFormState = {
  bank: '',
  alias: '',
  hasGTQ: true,
  hasUSD: false,
  primaryCurrency: 'GTQ',
  creditLimitGTQ: '',
  creditLimitUSD: '',
  benefitsDescription: '',
  annualInterestRate: '48',
  cutDay: '25',
  graceDays: '15',
  currentBalanceGTQ: '0',
  currentBalanceUSD: '0',
  paymentDueDate: getEstimatedPaymentDueDateInput('25', '15'),
  colorHex: '#0f766e'
};

function loadCurrentInstallments(cards: CreditCardAccount[]): InstallmentPlan[] {
  const storedInstallments = localInstallmentsStorage.load();
  const currentInstallments = applyAutomaticInstallmentProgress(storedInstallments, cards, new Date());

  if (currentInstallments !== storedInstallments && typeof window !== 'undefined') {
    localInstallmentsStorage.save(currentInstallments);
  }

  return currentInstallments;
}

function applyAutomaticInstallmentProgress(
  installments: InstallmentPlan[],
  cards: CreditCardAccount[],
  today: Date
): InstallmentPlan[] {
  let changed = false;

  const nextInstallments = installments.map((plan) => {
    if (!isInstallmentActive(plan)) return plan;

    const card = cards.find((item) => item.id === plan.cardId);
    if (!card) return plan;

    const progress = getInstallmentCutProgress(plan, card, today);
    if (!progress.shouldUpdate) return plan;

    changed = true;
    return {
      ...plan,
      lastAppliedCutDate: progress.lastAppliedCutDate,
      paidInstallments: Math.min(plan.paidInstallments + progress.installmentsToApply, plan.totalInstallments)
    };
  });

  return changed ? nextInstallments : installments;
}

function getInstallmentCutProgress(plan: InstallmentPlan, card: CreditCardAccount, today: Date) {
  const latestCutDate = getLastCutDate(today, card.cutDay);

  if (!plan.lastAppliedCutDate) {
    return {
      installmentsToApply: 0,
      lastAppliedCutDate: getDateInputValue(latestCutDate),
      shouldUpdate: true
    };
  }

  if (plan.paidInstallments >= plan.totalInstallments) {
    return {
      installmentsToApply: 0,
      lastAppliedCutDate: plan.lastAppliedCutDate,
      shouldUpdate: false
    };
  }

  const startDate = parseDateInput(plan.startDate);
  const lastAppliedDate = parseDateInput(plan.lastAppliedCutDate);
  let cutCursor = getNextCutDate(addCalendarDays(lastAppliedDate, 1), card.cutDay);
  let lastProcessedCutDate = lastAppliedDate;
  let installmentsToApply = 0;

  while (cutCursor.getTime() <= latestCutDate.getTime() && plan.paidInstallments + installmentsToApply < plan.totalInstallments) {
    if (cutCursor.getTime() >= startDate.getTime()) {
      installmentsToApply += 1;
    }

    lastProcessedCutDate = cutCursor;
    cutCursor = getNextCutDate(addCalendarDays(cutCursor, 1), card.cutDay);
  }

  return {
    installmentsToApply,
    lastAppliedCutDate: getDateInputValue(lastProcessedCutDate),
    shouldUpdate: installmentsToApply > 0 || lastProcessedCutDate.getTime() !== lastAppliedDate.getTime()
  };
}

function isInstallmentActive(plan: InstallmentPlan): boolean {
  return plan.status !== 'closed' && plan.paidInstallments < plan.totalInstallments;
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('cards');
  const [cards, setCards] = useState<CreditCardAccount[]>(localCardsStorage.load);
  const [editingCard, setEditingCard] = useState<CreditCardAccount | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentCardId, setPaymentCardId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>(localPaymentsStorage.load);
  const [balanceSnapshots, setBalanceSnapshots] = useState<BalanceSnapshot[]>(localBalanceSnapshotsStorage.load);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>(localExpenseCategoriesStorage.load);
  const [expensePayments, setExpensePayments] = useState<ExpensePayment[]>(localExpensePaymentsStorage.load);
  const [expenses, setExpenses] = useState<CardExpense[]>(localExpensesStorage.load);
  const [payables, setPayables] = useState<PayableAccount[]>(localPayablesStorage.load);
  const [payablePayments, setPayablePayments] = useState<PayableAccountPayment[]>(localPayablePaymentsStorage.load);
  const [balanceFormOpen, setBalanceFormOpen] = useState(false);
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [expensePaymentFormOpen, setExpensePaymentFormOpen] = useState(false);
  const [expenseCategoryFormOpen, setExpenseCategoryFormOpen] = useState(false);
  const [payableFormOpen, setPayableFormOpen] = useState(false);
  const [editingPayable, setEditingPayable] = useState<PayableAccount | null>(null);
  const [payablePaymentDraft, setPayablePaymentDraft] = useState<PayablePaymentDraft | null>(null);
  const [balanceCardId, setBalanceCardId] = useState<string | null>(null);
  const [installments, setInstallments] = useState<InstallmentPlan[]>(() => loadCurrentInstallments(cards));
  const [installmentFormOpen, setInstallmentFormOpen] = useState(false);
  const [installmentCardId, setInstallmentCardId] = useState<string | null>(null);
  const [editingInstallment, setEditingInstallment] = useState<InstallmentPlan | null>(null);
  const [mergeCardId, setMergeCardId] = useState<string | null>(null);
  const [mergeFormOpen, setMergeFormOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [cloudUserEmail, setCloudUserEmail] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(isSupabaseConfigured ? 'signed-out' : 'disabled');
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudReady, setCloudReady] = useState(!isSupabaseConfigured);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  const priorityCards = useMemo(() => buildPriorityRanking(cards, new Date()), [cards]);
  const selectedCard = priorityCards.find((card) => card.id === selectedCardId) ?? null;
  const topCard = priorityCards[0];

  useEffect(() => {
    let mounted = true;

    async function bootstrapCloud() {
      if (!isSupabaseConfigured) return;

      try {
        setCloudReady(false);
        const user = await getCloudUser();
        if (!mounted) return;

        if (!user) {
          setCloudUserEmail(null);
          setCloudStatus('signed-out');
          setCloudReady(true);
          return;
        }

        setCloudUserEmail(user.email ?? 'Sesion activa');
        setCloudStatus('syncing');
        const cloudData = await loadCloudData();
        if (!mounted) return;

        if (hasCloudData(cloudData)) {
          setCards(cloudData.cards);
          localCardsStorage.save(cloudData.cards);
          setPayments(cloudData.payments);
          localPaymentsStorage.save(cloudData.payments);
          setInstallments(cloudData.installments);
          localInstallmentsStorage.save(cloudData.installments);
          setBalanceSnapshots(cloudData.balanceSnapshots);
          localBalanceSnapshotsStorage.save(cloudData.balanceSnapshots);
          setExpenseCategories(cloudData.expenseCategories.length > 0 ? cloudData.expenseCategories : localExpenseCategoriesStorage.load());
          localExpenseCategoriesStorage.save(cloudData.expenseCategories.length > 0 ? cloudData.expenseCategories : localExpenseCategoriesStorage.load());
          setExpenses(cloudData.expenses);
          localExpensesStorage.save(cloudData.expenses);
          setExpensePayments(cloudData.expensePayments);
          localExpensePaymentsStorage.save(cloudData.expensePayments);
          setPayables(cloudData.payables);
          localPayablesStorage.save(cloudData.payables);
          setPayablePayments(cloudData.payablePayments);
          localPayablePaymentsStorage.save(cloudData.payablePayments);
        }

        setCloudStatus('synced');
        setCloudMessage(hasCloudData(cloudData) ? 'Datos cargados desde la nube privada.' : 'Listo para subir datos locales.');
        setCloudReady(true);
      } catch (error) {
        if (!mounted) return;
        setCloudStatus('error');
        setCloudMessage(getErrorMessage(error));
        setCloudReady(true);
      }
    }

    void bootstrapCloud();

    const authListener = supabase?.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryOpen(true);
        setCloudMessage('Ingresa una nueva contrasena para terminar la recuperacion.');
      }
      setCloudUserEmail(user?.email ?? null);
      setCloudStatus(user ? 'syncing' : 'signed-out');
      setCloudReady(!user);
      if (!user) return;

      void loadCloudData()
        .then((cloudData) => {
          if (hasCloudData(cloudData)) {
            setCards(cloudData.cards);
            localCardsStorage.save(cloudData.cards);
            setPayments(cloudData.payments);
            localPaymentsStorage.save(cloudData.payments);
            setInstallments(cloudData.installments);
            localInstallmentsStorage.save(cloudData.installments);
            setBalanceSnapshots(cloudData.balanceSnapshots);
            localBalanceSnapshotsStorage.save(cloudData.balanceSnapshots);
            setExpenseCategories(cloudData.expenseCategories.length > 0 ? cloudData.expenseCategories : localExpenseCategoriesStorage.load());
            localExpenseCategoriesStorage.save(cloudData.expenseCategories.length > 0 ? cloudData.expenseCategories : localExpenseCategoriesStorage.load());
            setExpenses(cloudData.expenses);
            localExpensesStorage.save(cloudData.expenses);
            setExpensePayments(cloudData.expensePayments);
            localExpensePaymentsStorage.save(cloudData.expensePayments);
            setPayables(cloudData.payables);
            localPayablesStorage.save(cloudData.payables);
            setPayablePayments(cloudData.payablePayments);
            localPayablePaymentsStorage.save(cloudData.payablePayments);
          }

          setCloudStatus('synced');
          setCloudMessage(hasCloudData(cloudData) ? 'Datos cargados desde la nube privada.' : 'Listo para subir datos locales.');
          setCloudReady(true);
        })
        .catch((error: unknown) => {
          setCloudStatus('error');
          setCloudMessage(getErrorMessage(error));
          setCloudReady(true);
        });
    });
    const subscription = authListener?.data.subscription;

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!cloudReady || !cloudUserEmail) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setCloudStatus('syncing');
      void saveCloudData({ balanceSnapshots, cards, expenseCategories, expensePayments, expenses, installments, payablePayments, payables, payments })
        .then(() => {
          if (cancelled) return;
          setCloudStatus('synced');
          setCloudMessage(`Sincronizado ${formatShortDate(new Date())}.`);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setCloudStatus('error');
          setCloudMessage(getErrorMessage(error));
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [balanceSnapshots, cards, cloudReady, cloudUserEmail, expenseCategories, expensePayments, expenses, installments, payablePayments, payables, payments]);

  function saveCards(nextCards: CreditCardAccount[]) {
    setCards(nextCards);
    localCardsStorage.save(nextCards);
  }

  function savePayments(nextPayments: PaymentRecord[]) {
    setPayments(nextPayments);
    localPaymentsStorage.save(nextPayments);
  }

  function saveBalanceSnapshots(nextSnapshots: BalanceSnapshot[]) {
    setBalanceSnapshots(nextSnapshots);
    localBalanceSnapshotsStorage.save(nextSnapshots);
  }

  function saveExpenseCategories(nextCategories: ExpenseCategory[]) {
    setExpenseCategories(nextCategories);
    localExpenseCategoriesStorage.save(nextCategories);
  }

  function saveExpenses(nextExpenses: CardExpense[]) {
    setExpenses(nextExpenses);
    localExpensesStorage.save(nextExpenses);
  }

  function saveExpensePayments(nextPayments: ExpensePayment[]) {
    setExpensePayments(nextPayments);
    localExpensePaymentsStorage.save(nextPayments);
  }

  function saveInstallments(nextInstallments: InstallmentPlan[]) {
    setInstallments(nextInstallments);
    localInstallmentsStorage.save(nextInstallments);
  }

  function savePayables(nextPayables: PayableAccount[]) {
    setPayables(nextPayables);
    localPayablesStorage.save(nextPayables);
  }

  function savePayablePayments(nextPayments: PayableAccountPayment[]) {
    setPayablePayments(nextPayments);
    localPayablePaymentsStorage.save(nextPayments);
  }

  function openCreateForm() {
    setEditingCard(null);
    setFormOpen(true);
  }

  function openEditForm(card: CreditCardAccount) {
    setEditingCard(card);
    setFormOpen(true);
  }

  function handleSave(card: CreditCardAccount) {
    const nextCards = editingCard ? cards.map((item) => (item.id === card.id ? card : item)) : [card, ...cards];
    const currentInstallments = applyAutomaticInstallmentProgress(installments, nextCards, new Date());

    saveCards(nextCards);
    if (currentInstallments !== installments) {
      saveInstallments(currentInstallments);
    }
    setFormOpen(false);
    setEditingCard(null);
  }

  function handleDeactivate(cardId: string) {
    const nextCards = cards.map((card) => (card.id === cardId ? { ...card, active: false } : card));
    saveCards(nextCards);
    if (selectedCardId === cardId) {
      setSelectedCardId(null);
    }
  }

  function openPaymentForm(cardId?: string) {
    setPaymentCardId(cardId ?? priorityCards[0]?.id ?? null);
    setPaymentFormOpen(true);
  }

  function handlePayment(payment: PaymentRecord) {
    const nextCards = cards.map((card) => {
      if (card.id !== payment.cardId) return card;

      const nextBalance = payment.type === 'pago_total' ? 0 : Math.max(getCardBalance(card, payment.currency) - payment.amount, 0);
      return {
        ...card,
        currentBalances: {
          ...card.currentBalances,
          [payment.currency]: nextBalance
        }
      };
    });

    saveCards(nextCards);
    savePayments([payment, ...payments]);
    setPaymentFormOpen(false);
    setPaymentCardId(null);
  }

  function openBalanceForm(cardId?: string) {
    setBalanceCardId(cardId ?? priorityCards[0]?.id ?? null);
    setBalanceFormOpen(true);
  }

  function handleSaveExpense(expense: CardExpense) {
    saveExpenses([expense, ...expenses]);
    setExpenseFormOpen(false);
  }

  function handleSaveExpensePayment(payment: ExpensePayment) {
    saveExpensePayments([payment, ...expensePayments]);
    setExpensePaymentFormOpen(false);
  }

  function handleSaveExpenseCategory(category: ExpenseCategory) {
    saveExpenseCategories([category, ...expenseCategories]);
    setExpenseCategoryFormOpen(false);
  }

  function handleBalanceUpdate(snapshot: BalanceSnapshot) {
    const nextCards = cards.map((card) => {
      if (card.id !== snapshot.cardId) return card;
      return {
        ...card,
        currentBalances: {
          ...card.currentBalances,
          [snapshot.currency]: snapshot.newBalance
        },
        paymentDueDate: snapshot.paymentDueDate ?? card.paymentDueDate
      };
    });

    saveCards(nextCards);
    saveBalanceSnapshots([snapshot, ...balanceSnapshots]);
    setBalanceFormOpen(false);
    setBalanceCardId(null);
  }

  function openInstallmentForm(cardId: string, plan?: InstallmentPlan) {
    setInstallmentCardId(cardId);
    setEditingInstallment(plan ?? null);
    setInstallmentFormOpen(true);
  }

  function openMergeForm(cardId: string) {
    setMergeCardId(cardId);
    setMergeFormOpen(true);
  }

  function openPayableForm(payable?: PayableAccount) {
    setEditingPayable(payable ?? null);
    setPayableFormOpen(true);
  }

  function handleInstallment(plan: InstallmentPlan) {
    const nextInstallments = editingInstallment
      ? installments.map((item) => (item.id === plan.id ? plan : item))
      : [plan, ...installments];

    saveInstallments(nextInstallments);
    setInstallmentFormOpen(false);
    setInstallmentCardId(null);
    setEditingInstallment(null);
  }

  function handlePayInstallment(planId: string) {
    const nextInstallments = installments.map((plan) => {
      if (plan.id !== planId) return plan;
      const card = cards.find((item) => item.id === plan.cardId);

      return {
        ...plan,
        lastAppliedCutDate: card ? getDateInputValue(getLastCutDate(new Date(), card.cutDay)) : plan.lastAppliedCutDate,
        paidInstallments: Math.min(plan.paidInstallments + 1, plan.totalInstallments)
      };
    });

    saveInstallments(nextInstallments);
  }

  function handleCloseInstallment(planId: string) {
    const nextInstallments = installments.map((plan) => {
      if (plan.id !== planId) return plan;

      return {
        ...plan,
        closedAt: new Date().toISOString(),
        status: 'closed' as const
      };
    });

    saveInstallments(nextInstallments);
  }

  function handleDeleteInstallment(planId: string) {
    saveInstallments(installments.filter((plan) => plan.id !== planId));
  }

  function handleSavePayable(payable: PayableAccount) {
    const nextPayables = editingPayable
      ? payables.map((item) => (item.id === payable.id ? payable : item))
      : [payable, ...payables];

    savePayables(nextPayables);
    setPayableFormOpen(false);
    setEditingPayable(null);
  }

  function handleDeactivatePayable(payableId: string) {
    savePayables(payables.map((payable) => (payable.id === payableId ? { ...payable, active: false } : payable)));
  }

  function handleReactivatePayable(payableId: string) {
    savePayables(payables.map((payable) => (payable.id === payableId ? { ...payable, active: true } : payable)));
  }

  function handleDeletePayable(payableId: string) {
    savePayables(payables.filter((payable) => payable.id !== payableId));
    savePayablePayments(payablePayments.filter((payment) => payment.payableId !== payableId));
  }

  function openPayablePaymentForm(payable: PayableAccount, dueDate: Date) {
    setPayablePaymentDraft({ dueDate, payable });
  }

  function handleMarkPayablePaid(payable: PayableAccount, dueDate: Date, amount: number, notes?: string) {
    const dueDateValue = getDateInputValue(dueDate);
    const existingPayment = payablePayments.find((payment) => payment.payableId === payable.id && payment.dueDate === dueDateValue);

    if (existingPayment) return;

    const payment: PayableAccountPayment = {
      id: createLocalId(),
      payableId: payable.id,
      payableName: payable.name,
      currency: payable.currency,
      amount,
      dueDate: dueDateValue,
      paidAt: new Date().toISOString(),
      notes,
      createdAt: new Date().toISOString()
    };

    savePayablePayments([payment, ...payablePayments]);
    setPayablePaymentDraft(null);
  }

  function handleMergeCards({ sourceCardId, targetCardId }: MergeCardsRequest) {
    if (sourceCardId === targetCardId) return;

    const targetCard = cards.find((card) => card.id === targetCardId);
    const sourceCard = cards.find((card) => card.id === sourceCardId);
    if (!targetCard || !sourceCard) return;

    const mergedCard = mergeCreditCards(targetCard, sourceCard);
    const nextCards = cards.reduce<CreditCardAccount[]>((items, card) => {
      if (card.id === sourceCardId) return items;
      if (card.id === targetCardId) return [...items, mergedCard];
      return [...items, card];
    }, []);
    const moveToMergedCard = <RecordType extends { cardAlias?: string; cardId: string }>(record: RecordType): RecordType =>
      record.cardId === sourceCardId || record.cardId === targetCardId
        ? { ...record, cardAlias: mergedCard.alias, cardId: targetCardId }
        : record;

    saveCards(nextCards);
    savePayments(payments.map(moveToMergedCard));
    saveExpenses(expenses.map(moveToMergedCard));
    saveExpensePayments(expensePayments.map(moveToMergedCard));
    saveInstallments(installments.map((plan) => (plan.cardId === sourceCardId ? { ...plan, cardId: targetCardId } : plan)));
    saveBalanceSnapshots(balanceSnapshots.map(moveToMergedCard));
    setSelectedCardId(targetCardId);
    setMergeCardId(null);
    setMergeFormOpen(false);
  }

  async function handleCloudSignIn(email: string, password: string) {
    setCloudStatus('syncing');
    setCloudMessage('');
    try {
      await signInToCloud(email, password);
    } catch (error) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(error));
      throw error;
    }
  }

  async function handleCloudSignOut() {
    setCloudStatus('syncing');
    try {
      await signOutFromCloud();
      setCloudUserEmail(null);
      setCloudStatus('signed-out');
      setCloudMessage('Sesion cerrada. Tus datos locales siguen en este dispositivo.');
    } catch (error) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(error));
    }
  }

  async function handleCloudSignUp(email: string, password: string) {
    setCloudStatus('syncing');
    setCloudMessage('');
    try {
      const session = await signUpToCloud(email, password);
      if (!session) {
        setCloudStatus('signed-out');
        setCloudMessage('Cuenta creada. Si la app pide confirmar correo, revisa tu inbox antes de iniciar sesion.');
      }
    } catch (error) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(error));
      throw error;
    }
  }

  async function handlePasswordReset(email: string) {
    setCloudStatus('syncing');
    setCloudMessage('');
    try {
      await sendPasswordReset(email);
      setCloudStatus('signed-out');
      setCloudMessage('Te enviamos un enlace para restablecer tu contrasena.');
    } catch (error) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(error));
      throw error;
    }
  }

  async function handlePasswordUpdate(password: string) {
    setCloudStatus('syncing');
    setCloudMessage('');
    try {
      await updateCloudPassword(password);
      setPasswordRecoveryOpen(false);
      setCloudStatus('synced');
      setCloudMessage('Contrasena actualizada. Ya puedes usar CardWise.');
    } catch (error) {
      setCloudStatus('error');
      setCloudMessage(getErrorMessage(error));
      throw error;
    }
  }

  if (isAuthRequired && !cloudUserEmail) {
    return (
      <main className="min-h-dvh bg-slate-950 px-5 py-8 text-white">
        <section className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center">
          <p className="text-sm font-medium text-teal-200">CardWise GT</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">Acceso privado</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Inicia sesion con tu cuenta para sincronizar tarjetas, pagos, saldos y ExtraFin en tu nube privada.
          </p>
          <CloudSyncPanel
            email={cloudUserEmail}
            message={cloudMessage}
            privateMode
            status={cloudReady ? cloudStatus : 'syncing'}
            onPasswordReset={handlePasswordReset}
            onSignIn={handleCloudSignIn}
            onSignOut={handleCloudSignOut}
            onSignUp={handleCloudSignUp}
          />
        </section>
        {passwordRecoveryOpen ? <PasswordRecoveryForm onSave={handlePasswordUpdate} /> : null}
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 text-ink">
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
        <header className="bg-slate-950 px-5 pb-6 pt-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-teal-200">CardWise GT</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-normal">Que tarjeta usar hoy</h1>
            </div>
            <button
              className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-slate-950 shadow-sm"
              aria-label="Agregar tarjeta"
              onClick={openCreateForm}
            >
              <Plus size={22} />
            </button>
          </div>

          {topCard ? <BestCardPanel card={topCard} /> : null}
          <CloudSyncPanel
            email={cloudUserEmail}
            message={cloudMessage}
            onPasswordReset={handlePasswordReset}
            status={cloudStatus}
            onSignIn={handleCloudSignIn}
            onSignOut={handleCloudSignOut}
            onSignUp={handleCloudSignUp}
          />
        </header>

        {activeTab === 'cards' ? (
          <CardsView
            cards={priorityCards}
            onDeactivate={handleDeactivate}
            onEdit={openEditForm}
            onRegisterPayment={openPaymentForm}
            onUpdateBalance={openBalanceForm}
            onSelectCard={setSelectedCardId}
          />
        ) : null}

        {activeTab === 'payment-history' ? (
          <PaymentsView cards={priorityCards} payments={payments} onRegisterPayment={() => openPaymentForm()} />
        ) : null}

        {activeTab === 'payables' ? (
          <PayablesView
            cards={priorityCards}
            payablePayments={payablePayments}
            payables={payables}
            onDeactivatePayable={handleDeactivatePayable}
            onDeletePayable={handleDeletePayable}
            onEditPayable={openPayableForm}
            onMarkPayablePaid={openPayablePaymentForm}
            onReactivatePayable={handleReactivatePayable}
            onRegisterPayable={() => openPayableForm()}
          />
        ) : null}

        {activeTab === 'calendar' ? (
          <ExpensesView
            cards={priorityCards}
            categories={expenseCategories}
            expensePayments={expensePayments}
            expenses={expenses}
            onCreateCategory={() => setExpenseCategoryFormOpen(true)}
            onRegisterExpense={() => setExpenseFormOpen(true)}
            onRegisterExpensePayment={() => setExpensePaymentFormOpen(true)}
          />
        ) : null}

        <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
      </section>

      {formOpen ? (
        <CardForm
          card={editingCard}
          onClose={() => {
            setFormOpen(false);
            setEditingCard(null);
          }}
          onSave={handleSave}
        />
      ) : null}

      {paymentFormOpen ? (
        <PaymentForm
          cards={priorityCards}
          initialCardId={paymentCardId}
          onClose={() => {
            setPaymentFormOpen(false);
            setPaymentCardId(null);
          }}
          onSave={handlePayment}
        />
      ) : null}

      {installmentFormOpen ? (
        <InstallmentForm
          cards={priorityCards}
          installment={editingInstallment}
          initialCardId={installmentCardId}
          onClose={() => {
            setInstallmentFormOpen(false);
            setInstallmentCardId(null);
            setEditingInstallment(null);
          }}
          onSave={handleInstallment}
        />
      ) : null}

      {balanceFormOpen ? (
        <BalanceUpdateForm
          cards={priorityCards}
          initialCardId={balanceCardId}
          onClose={() => {
            setBalanceFormOpen(false);
            setBalanceCardId(null);
          }}
          onSave={handleBalanceUpdate}
        />
      ) : null}

      {expenseFormOpen ? (
        <ExpenseForm
          cards={priorityCards}
          categories={expenseCategories.filter((category) => category.active)}
          onClose={() => setExpenseFormOpen(false)}
          onSave={handleSaveExpense}
        />
      ) : null}

      {expensePaymentFormOpen ? (
        <ExpensePaymentForm
          cards={priorityCards}
          expensePayments={expensePayments}
          expenses={expenses}
          onClose={() => setExpensePaymentFormOpen(false)}
          onSave={handleSaveExpensePayment}
        />
      ) : null}

      {expenseCategoryFormOpen ? (
        <ExpenseCategoryForm onClose={() => setExpenseCategoryFormOpen(false)} onSave={handleSaveExpenseCategory} />
      ) : null}

      {mergeFormOpen ? (
        <MergeCardsForm
          cards={priorityCards}
          initialTargetCardId={mergeCardId}
          onClose={() => {
            setMergeFormOpen(false);
            setMergeCardId(null);
          }}
          onSave={handleMergeCards}
        />
      ) : null}

      {payableFormOpen ? (
        <PayableForm
          cards={priorityCards}
          payable={editingPayable}
          onClose={() => {
            setPayableFormOpen(false);
            setEditingPayable(null);
          }}
          onSave={handleSavePayable}
        />
      ) : null}

      {payablePaymentDraft ? (
        <PayablePaymentForm
          draft={payablePaymentDraft}
          onClose={() => setPayablePaymentDraft(null)}
          onSave={(amount, notes) => handleMarkPayablePaid(payablePaymentDraft.payable, payablePaymentDraft.dueDate, amount, notes)}
        />
      ) : null}

      {selectedCard ? (
        <CardDetailPanel
          card={selectedCard}
          canMerge={priorityCards.length > 1}
          balanceSnapshots={balanceSnapshots.filter((snapshot) => snapshot.cardId === selectedCard.id)}
          installments={installments.filter((plan) => plan.cardId === selectedCard.id)}
          payments={payments.filter((payment) => payment.cardId === selectedCard.id)}
          onClose={() => setSelectedCardId(null)}
          onDeactivate={handleDeactivate}
          onCloseInstallment={handleCloseInstallment}
          onDeleteInstallment={handleDeleteInstallment}
          onEditInstallment={(plan) => openInstallmentForm(selectedCard.id, plan)}
          onEdit={openEditForm}
          onMerge={openMergeForm}
          onPayInstallment={handlePayInstallment}
          onRegisterInstallment={openInstallmentForm}
          onRegisterPayment={openPaymentForm}
          onUpdateBalance={openBalanceForm}
        />
      ) : null}

      {passwordRecoveryOpen ? <PasswordRecoveryForm onSave={handlePasswordUpdate} /> : null}
    </main>
  );
}

function BestCardPanel({ card }: { card: CardPriority }) {
  return (
    <div className="mt-6 rounded-lg bg-white p-4 text-slate-950 shadow-xl shadow-slate-950/20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Mejor opcion</p>
          <h2 className="mt-1 text-xl font-semibold">{card.alias}</h2>
          <p className="text-sm text-slate-500">{card.bank} · {formatCurrencyList(card.currencies)}</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold text-teal-700">{card.availableDays}</p>
          <p className="text-xs font-semibold uppercase text-slate-500">dias</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <DatePill label="Ultimo corte" value={formatShortDate(card.lastCutDate)} />
        <DatePill label="Eso fue hace" value={formatElapsedDays(card.daysSinceLastCut)} />
        <DatePill label="Proximo corte" value={formatShortDate(card.nextCutDate)} />
        <DatePill label="Pago estimado" value={formatShortDate(card.nextPaymentDate)} />
      </div>
    </div>
  );
}

function DatePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-100 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function CloudSyncPanel({
  email,
  message,
  onPasswordReset,
  onSignIn,
  onSignOut,
  onSignUp,
  privateMode = false,
  status
}: {
  email: string | null;
  message: string;
  onPasswordReset: (email: string) => Promise<void>;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  privateMode?: boolean;
  status: CloudSyncStatus;
}) {
  const [authFormOpen, setAuthFormOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authValidationMessage, setAuthValidationMessage] = useState('');
  const disabled = status === 'syncing';
  const displayMessage = authValidationMessage || message;
  const hasValidationError = Boolean(authValidationMessage);

  async function submitAuth(mode: 'sign-in' | 'sign-up') {
    const trimmedEmail = authEmail.trim();
    setAuthValidationMessage('');

    if (!trimmedEmail) {
      setAuthValidationMessage('Ingresa tu correo.');
      return;
    }

    if (!authPassword) {
      setAuthValidationMessage('Ingresa tu contrasena.');
      return;
    }

    if (mode === 'sign-up' && authPassword.length < 8) {
      setAuthValidationMessage('Usa una contrasena de al menos 8 caracteres.');
      return;
    }

    try {
      if (mode === 'sign-in') {
        await onSignIn(trimmedEmail, authPassword);
      } else {
        await onSignUp(trimmedEmail, authPassword);
      }

      setAuthPassword('');
      setAuthFormOpen(false);
    } catch {
      setAuthPassword('');
    }
  }

  async function submitPasswordReset() {
    const trimmedEmail = authEmail.trim();
    setAuthValidationMessage('');

    if (!trimmedEmail) {
      setAuthValidationMessage('Ingresa tu correo para recuperar la contrasena.');
      return;
    }

    try {
      await onPasswordReset(trimmedEmail);
      setAuthPassword('');
    } catch {
      setAuthPassword('');
    }
  }

  if (status === 'disabled') {
    return (
      <div className={`${privateMode ? 'mt-6' : 'mt-4'} rounded-lg bg-white/10 p-3 text-sm text-slate-200`}>
        <div className="flex items-center gap-2 font-semibold text-white">
          <Cloud size={16} />
          Nube privada pendiente
        </div>
        <p className="mt-1">Agrega las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` para activar el acceso privado.</p>
      </div>
    );
  }

  return (
    <section className={`${privateMode ? 'mt-6 p-4' : 'mt-4 p-3'} rounded-lg bg-white/10 text-sm text-slate-200`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-white">
            <Cloud size={16} />
            <span>{email ? 'Cuenta CardWise activa' : 'Cuenta CardWise'}</span>
          </div>
          <p className="mt-1 truncate">{email ?? getCloudStatusLabel(status)}</p>
        </div>
        {email ? (
          <button
            className="grid size-9 shrink-0 place-items-center rounded-md bg-white/10 text-white disabled:opacity-60"
            aria-label="Cerrar sesion de CardWise"
            disabled={disabled}
            onClick={() => void onSignOut()}
          >
            <LogOut size={17} />
          </button>
        ) : (
          <button
            className="min-h-9 rounded-md bg-white px-3 text-xs font-semibold text-slate-950 disabled:opacity-60"
            disabled={disabled}
            onClick={() => setAuthFormOpen((current) => !current)}
          >
            Conectar
          </button>
        )}
      </div>

      {displayMessage ? (
        <p className={`mt-2 ${status === 'error' || hasValidationError ? 'text-red-200' : 'text-slate-300'}`}>{displayMessage}</p>
      ) : null}

      {authFormOpen && !email ? (
        <div className="mt-3 grid gap-2">
          <input
            className="h-10 rounded-md border border-white/20 bg-white px-3 text-base text-slate-950 outline-none"
            inputMode="email"
            placeholder="correo"
            type="email"
            value={authEmail}
            onChange={(event) => setAuthEmail(event.target.value)}
          />
          <input
            className="h-10 rounded-md border border-white/20 bg-white px-3 text-base text-slate-950 outline-none"
            minLength={8}
            placeholder="contrasena"
            type="password"
            value={authPassword}
            onChange={(event) => setAuthPassword(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              className="h-10 rounded-md bg-teal-600 text-sm font-semibold text-white disabled:opacity-60"
              disabled={disabled}
              type="button"
              onClick={() => void submitAuth('sign-in')}
            >
              Entrar
            </button>
            <button
              className="h-10 rounded-md bg-white/10 text-sm font-semibold text-white disabled:opacity-60"
              disabled={disabled}
              type="button"
              onClick={() => void submitAuth('sign-up')}
            >
              Crear
            </button>
          </div>
          <button
            className="min-h-9 text-left text-xs font-semibold text-teal-100 disabled:opacity-60"
            disabled={disabled || !authEmail.trim()}
            type="button"
            onClick={() => void submitPasswordReset()}
          >
            Olvide mi contrasena
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PasswordRecoveryForm({ onSave }: { onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    if (password.length < 8) {
      setMessage('Usa una contrasena de al menos 8 caracteres.');
      return;
    }

    if (password !== confirmation) {
      setMessage('Las contrasenas no coinciden.');
      return;
    }

    try {
      setSaving(true);
      await onSave(password);
      setPassword('');
      setConfirmation('');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-4 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Nueva contrasena</h2>
          <p className="mt-1 text-sm text-slate-500">Completa la recuperacion para volver a entrar a CardWise.</p>
        </div>

        <form className="grid gap-3 px-4 py-4" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Contrasena nueva
            <input
              className="h-11 rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none focus:border-teal-700"
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Confirmar contrasena
            <input
              className="h-11 rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none focus:border-teal-700"
              minLength={8}
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </label>

          {message ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p> : null}

          <button className="h-12 rounded-md bg-slate-950 font-semibold text-white disabled:bg-slate-300" disabled={saving} type="submit">
            {saving ? 'Guardando...' : 'Guardar contrasena'}
          </button>
        </form>
      </div>
    </div>
  );
}

function CardsView({
  cards,
  onDeactivate,
  onEdit,
  onRegisterPayment,
  onSelectCard,
  onUpdateBalance
}: {
  cards: CardPriority[];
  onDeactivate: (cardId: string) => void;
  onEdit: (card: CreditCardAccount) => void;
  onRegisterPayment: (cardId: string) => void;
  onSelectCard: (cardId: string) => void;
  onUpdateBalance: (cardId: string) => void;
}) {
  return (
    <section className="flex-1 px-4 pb-24 pt-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ranking de prioridad</h2>
          <p className="text-sm text-slate-500">Ordenado por dias disponibles sin interes.</p>
        </div>
        <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800">
          {cards.length} activas
        </span>
      </div>

      <div className="space-y-3">
        {cards.map((card) => (
          <PriorityCard
            key={card.id}
            card={card}
            onDeactivate={onDeactivate}
            onEdit={onEdit}
            onRegisterPayment={onRegisterPayment}
            onSelect={onSelectCard}
            onUpdateBalance={onUpdateBalance}
          />
        ))}
      </div>
    </section>
  );
}

function PriorityCard({
  card,
  onDeactivate,
  onEdit,
  onRegisterPayment,
  onSelect,
  onUpdateBalance
}: {
  card: CardPriority;
  onDeactivate: (cardId: string) => void;
  onEdit: (card: CreditCardAccount) => void;
  onRegisterPayment: (cardId: string) => void;
  onSelect: (cardId: string) => void;
  onUpdateBalance: (cardId: string) => void;
}) {
  return (
    <article
      className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(card.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(card.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ backgroundColor: card.colorHex }} />
            <h3 className="truncate text-base font-semibold">{card.alias}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {card.bank} · Pagar antes del {formatShortDate(getCardPaymentDueDate(card))}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            {formatCardBalances(card)} pendiente
          </p>
          {card.benefitsDescription ? (
            <p className="mt-2 line-clamp-2 rounded-md bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900">
              {card.benefitsDescription}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <UrgencyBadge level={card.urgencyLevel} />
          <button
            className="grid size-8 place-items-center rounded-md bg-slate-100 text-slate-700"
            aria-label={`Editar ${card.alias}`}
            onClick={(event) => {
              event.stopPropagation();
              onEdit(card);
            }}
          >
            <Pencil size={16} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <DatePill label="Ultimo corte" value={formatShortDate(card.lastCutDate)} />
          <DatePill label="Hace" value={formatElapsedDays(card.daysSinceLastCut)} />
          <DatePill label="Proximo corte" value={formatShortDate(card.nextCutDate)} />
          <DatePill label="Pagar antes" value={formatShortDate(getCardPaymentDueDate(card))} />
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-slate-950">{card.availableDays}</p>
          <p className="text-xs font-semibold uppercase text-slate-500">dias</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"
          aria-label={`Registrar abono en ${card.alias}`}
          onClick={(event) => {
            event.stopPropagation();
            onRegisterPayment(card.id);
          }}
        >
          <Banknote size={16} />
          Abono
        </button>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-semibold text-slate-800"
          aria-label={`Actualizar saldo de ${card.alias}`}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateBalance(card.id);
          }}
        >
          <RefreshCw size={16} />
          Saldo
        </button>
        <button
          className="min-h-10 px-1 text-sm font-semibold text-red-600"
          aria-label={`Desactivar ${card.alias}`}
          onClick={(event) => {
            event.stopPropagation();
            onDeactivate(card.id);
          }}
        >
          Desactivar
        </button>
      </div>
    </article>
  );
}

function CardDetailPanel({
  balanceSnapshots,
  canMerge,
  card,
  installments,
  payments,
  onClose,
  onDeactivate,
  onCloseInstallment,
  onDeleteInstallment,
  onEdit,
  onEditInstallment,
  onMerge,
  onPayInstallment,
  onRegisterInstallment,
  onRegisterPayment,
  onUpdateBalance
}: {
  balanceSnapshots: BalanceSnapshot[];
  canMerge: boolean;
  card: CardPriority;
  installments: InstallmentPlan[];
  payments: PaymentRecord[];
  onClose: () => void;
  onDeactivate: (cardId: string) => void;
  onCloseInstallment: (planId: string) => void;
  onDeleteInstallment: (planId: string) => void;
  onEdit: (card: CreditCardAccount) => void;
  onEditInstallment: (plan: InstallmentPlan) => void;
  onMerge: (cardId: string) => void;
  onPayInstallment: (planId: string) => void;
  onRegisterInstallment: (cardId: string) => void;
  onRegisterPayment: (cardId: string) => void;
  onUpdateBalance: (cardId: string) => void;
}) {
  const monthPayments = payments.filter((payment) => isCurrentMonth(payment.date));
  const activeInstallments = installments.filter(isInstallmentActive);
  const closedInstallments = installments.filter((plan) => !isInstallmentActive(plan));
  const latestBalanceSnapshot = balanceSnapshots[0];

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: card.colorHex }} />
              <h2 className="truncate text-lg font-semibold">{card.alias}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {card.bank} · {formatCurrencyList(card.currencies)}
            </p>
          </div>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar detalle" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          <section className="rounded-lg bg-slate-950 p-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-teal-200">Saldo pendiente</p>
                <p className="mt-1 text-sm text-slate-300">
                  {latestBalanceSnapshot
                    ? `Actualizado ${latestBalanceSnapshot.currency} · ${formatShortDate(parseDateInput(latestBalanceSnapshot.statementDate))}`
                    : 'Sin actualizacion mensual registrada'}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200">
                {formatCurrencyList(card.currencies)}
              </span>
            </div>

            <p className="mt-2 text-sm text-slate-300">
              Ultimo corte {formatShortDate(card.lastCutDate)} · pagar antes del {formatShortDate(getCardPaymentDueDate(card))}
            </p>
            <div className="mt-4 grid gap-2">
              {card.currencies.map((currency) => (
                <CurrencyBalanceRow
                  key={currency}
                  card={card}
                  currency={currency}
                  paid={sumPaymentsByCurrency(monthPayments, currency)}
                />
              ))}
            </div>
          </section>

          <section className="mt-4">
            <h3 className="text-base font-semibold">Estado de cuenta local</h3>
            <div className="mt-3 grid gap-2">
              {card.currencies.map((currency) => (
                <CurrencyStatementRow
                  key={currency}
                  currency={currency}
                  extras={sumInstallmentsByCurrency(activeInstallments, currency)}
                  paid={sumPaymentsByCurrency(monthPayments, currency)}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <SummaryTile label="Ultimo corte" value={formatShortDate(card.lastCutDate)} />
              <SummaryTile label="Fue hace" value={formatElapsedDays(card.daysSinceLastCut)} />
              <SummaryTile label="Proximo corte" value={formatShortDate(card.nextCutDate)} />
              <SummaryTile label="Pagar antes" value={formatShortDate(getCardPaymentDueDate(card))} />
            </div>
          </section>

          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Historial de saldos</h3>
                <p className="text-sm text-slate-500">Estados de cuenta y ajustes manuales.</p>
              </div>
              <button
                className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-950 text-white"
                aria-label={`Actualizar saldo de ${card.alias}`}
                onClick={() => {
                  onClose();
                  onUpdateBalance(card.id);
                }}
              >
                <RefreshCw size={18} />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {balanceSnapshots.length > 0 ? (
                balanceSnapshots.slice(0, 5).map((snapshot) => <BalanceSnapshotItem key={snapshot.id} snapshot={snapshot} />)
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  Aun no hay saldos registrados para esta tarjeta.
                </div>
              )}
            </div>
          </section>

          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Extrafinanciamientos</h3>
                <p className="text-sm text-slate-500">
                  {activeInstallments.length} activos · {closedInstallments.length} cerrados
                </p>
              </div>
              <button
                className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-950 text-white"
                aria-label={`Agregar extrafinanciamiento en ${card.alias}`}
                onClick={() => {
                  onClose();
                  onRegisterInstallment(card.id);
                }}
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
                Los extras no modifican el saldo principal; solo avanzan cuotas por fecha de corte.
              </div>
              {activeInstallments.length > 0 ? (
                activeInstallments.map((plan) => (
                  <InstallmentItem
                    key={plan.id}
                    currency={plan.currency}
                    onCloseInstallment={onCloseInstallment}
                    onEditInstallment={(selectedPlan) => {
                      onClose();
                      onEditInstallment(selectedPlan);
                    }}
                    onPayInstallment={onPayInstallment}
                    plan={plan}
                  />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  No hay extrafinanciamientos activos para esta tarjeta.
                </div>
              )}

              {closedInstallments.length > 0 ? (
                <div className="space-y-2 pt-1">
                  <h4 className="text-sm font-semibold text-slate-600">Cerrados</h4>
                  {closedInstallments.map((plan) => (
                    <ClosedInstallmentItem key={plan.id} currency={plan.currency} onDeleteInstallment={onDeleteInstallment} plan={plan} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">Historial de movimientos</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{payments.length}</span>
            </div>
            <div className="mt-3 space-y-3">
              {payments.length > 0 ? (
                payments.slice(0, 8).map((payment) => <PaymentItem key={payment.id} payment={payment} />)
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  Aun no hay movimientos para esta tarjeta.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"
            onClick={() => {
              onClose();
              onRegisterPayment(card.id);
            }}
          >
            <Banknote size={16} />
            Abono
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white"
            onClick={() => {
              onClose();
              onUpdateBalance(card.id);
            }}
          >
            <RefreshCw size={16} />
            Saldo
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-semibold text-slate-800"
            onClick={() => {
              onClose();
              onEdit(card);
            }}
          >
            <Pencil size={16} />
            Editar
          </button>
          {canMerge ? (
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 text-sm font-semibold text-slate-800"
              onClick={() => {
                onClose();
                onMerge(card.id);
              }}
            >
              <GitMerge size={16} />
              Fusionar
            </button>
          ) : null}
          <button
            className={`${canMerge ? 'col-span-2' : ''} min-h-11 rounded-md text-sm font-semibold text-red-600`}
            onClick={() => onDeactivate(card.id)}
          >
            Desactivar
          </button>
        </div>
      </div>
    </div>
  );
}

function UrgencyBadge({ level }: { level: CardPriority['urgencyLevel'] }) {
  const styles = {
    high: 'bg-emerald-100 text-emerald-800',
    medium: 'bg-amber-100 text-amber-800',
    low: 'bg-orange-100 text-orange-800',
    urgent: 'bg-red-100 text-red-800'
  };

  const labels = {
    high: 'Alta',
    medium: 'Media',
    low: 'Baja',
    urgent: 'Urgente'
  };

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles[level]}`}>{labels[level]}</span>;
}

function InstallmentItem({
  currency,
  onCloseInstallment,
  onEditInstallment,
  onPayInstallment,
  plan
}: {
  currency: Currency;
  onCloseInstallment: (planId: string) => void;
  onEditInstallment: (plan: InstallmentPlan) => void;
  onPayInstallment: (planId: string) => void;
  plan: InstallmentPlan;
}) {
  const paidInstallments = Math.min(plan.paidInstallments, plan.totalInstallments);
  const remainingInstallments = Math.max(plan.totalInstallments - paidInstallments, 0);
  const progress = plan.totalInstallments > 0 ? (paidInstallments / plan.totalInstallments) * 100 : 0;
  const paidAmount = plan.totalInstallments > 0 ? (plan.totalAmount / plan.totalInstallments) * paidInstallments : 0;
  const pendingAmount = Math.max(plan.totalAmount - paidAmount, 0);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-semibold">{plan.description}</h4>
          <p className="mt-1 text-sm text-slate-500">
            Inicio {formatShortDate(parseDateInput(plan.startDate))} · {paidInstallments}/{plan.totalInstallments} cuotas
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-slate-950">{formatCurrency(plan.monthlyPayment, currency)}</p>
          <button className="mt-1 text-xs font-semibold text-slate-500" onClick={() => onEditInstallment(plan)}>
            Editar
          </button>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-teal-700" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Pendiente</p>
          <p className="mt-0.5 font-semibold text-slate-900">{formatCurrency(pendingAmount, currency)}</p>
        </div>
        <div className="rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Restantes</p>
          <p className="mt-0.5 font-semibold text-slate-900">{remainingInstallments} cuotas</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          className="h-10 rounded-md bg-slate-950 text-sm font-semibold text-white disabled:bg-slate-300"
          disabled={remainingInstallments === 0}
          onClick={() => onPayInstallment(plan.id)}
        >
          Aplicar cuota
        </button>
        <button className="h-10 rounded-md border border-red-200 text-sm font-semibold text-red-600" onClick={() => onCloseInstallment(plan.id)}>
          Cerrar
        </button>
      </div>
    </article>
  );
}

function ClosedInstallmentItem({
  currency,
  onDeleteInstallment,
  plan
}: {
  currency: Currency;
  onDeleteInstallment: (planId: string) => void;
  plan: InstallmentPlan;
}) {
  const paidInstallments = Math.min(plan.paidInstallments, plan.totalInstallments);
  const paidAmount = plan.totalInstallments > 0 ? (plan.totalAmount / plan.totalInstallments) * paidInstallments : 0;
  const pendingAmount = Math.max(plan.totalAmount - paidAmount, 0);

  return (
    <article className="rounded-lg border border-slate-200 bg-slate-100 p-3 text-sm text-slate-600">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h5 className="truncate font-semibold text-slate-800">{plan.description}</h5>
          <p className="mt-1">
            {paidInstallments}/{plan.totalInstallments} cuotas · pendiente {formatCurrency(pendingAmount, currency)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-500">Cerrado</span>
          <button className="mt-2 block text-xs font-semibold text-red-600" onClick={() => onDeleteInstallment(plan.id)}>
            Eliminar
          </button>
        </div>
      </div>
    </article>
  );
}

function PaymentsView({
  cards,
  payments,
  onRegisterPayment
}: {
  cards: CardPriority[];
  payments: PaymentRecord[];
  onRegisterPayment: () => void;
}) {
  const monthPayments = payments.filter((payment) => isCurrentMonth(payment.date));
  const totals = summarizePayments(monthPayments);

  return (
    <section className="flex-1 px-4 pb-24 pt-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Pagos realizados</h2>
          <p className="text-sm text-slate-500">Abonos y pagos registrados en tarjetas.</p>
        </div>
        <button
          className="grid size-11 shrink-0 place-items-center rounded-md bg-slate-950 text-white"
          aria-label="Registrar abono"
          onClick={onRegisterPayment}
          disabled={cards.length === 0}
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SummaryTile label="Pagado GTQ" value={formatCurrency(totals.GTQ, 'GTQ')} />
        <SummaryTile label="Pagado USD" value={formatCurrency(totals.USD, 'USD')} />
      </div>

      <div className="mt-5 space-y-3">
        {payments.length > 0 ? (
          payments.slice(0, 12).map((payment) => <PaymentItem key={payment.id} payment={payment} />)
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">
            Aun no hay pagos registrados.
          </div>
        )}
      </div>
    </section>
  );
}

function ExpensesView({
  cards,
  categories,
  expensePayments,
  expenses,
  onCreateCategory,
  onRegisterExpense,
  onRegisterExpensePayment
}: {
  cards: CardPriority[];
  categories: ExpenseCategory[];
  expensePayments: ExpensePayment[];
  expenses: CardExpense[];
  onCreateCategory: () => void;
  onRegisterExpense: () => void;
  onRegisterExpensePayment: () => void;
}) {
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ExpenseViewMode>('cycle');
  const [monthValue, setMonthValue] = useState(() => getMonthInputValue(new Date()));
  const [cycleCutDate, setCycleCutDate] = useState(() => getDateInputValue(cards[0]?.nextCutDate ?? getNextCutDate(new Date(), 25)));
  const selectedSingleCard = selectedCardIds.length === 1 ? cards.find((card) => card.id === selectedCardIds[0]) : null;
  const effectiveCycleCutDate = selectedSingleCard ? getDateInputValue(selectedSingleCard.nextCutDate) : cycleCutDate;
  const activeCardIds = selectedCardIds.length > 0 ? selectedCardIds : cards.map((card) => card.id);
  const visibleExpenses = expenses
    .filter((expense) => activeCardIds.includes(expense.cardId))
    .filter((expense) => selectedCategoryId === 'all' || expense.categoryId === selectedCategoryId)
    .filter((expense) => (viewMode === 'cycle' ? expense.cycleCutDate === effectiveCycleCutDate : isSameMonthValue(expense.date, monthValue)));
  const visibleExpensePayments = expensePayments
    .filter((payment) => activeCardIds.includes(payment.cardId))
    .filter((payment) => (viewMode === 'cycle' ? payment.cycleCutDate === effectiveCycleCutDate : isSameMonthValue(payment.date, monthValue)));
  const totalByCurrency = summarizeExpenses(visibleExpenses);
  const paidByCurrency = summarizeExpensePayments(visibleExpensePayments);
  const pendingByCurrency = {
    GTQ: Math.max(totalByCurrency.GTQ - paidByCurrency.GTQ, 0),
    USD: Math.max(totalByCurrency.USD - paidByCurrency.USD, 0)
  };
  const availableCycleOptions = getExpenseCycleOptions(cards, expenses);
  const paymentTargetDate = selectedSingleCard
    ? viewMode === 'cycle'
      ? parseDateInput(effectiveCycleCutDate)
      : selectedSingleCard.nextCutDate
    : null;
  const cardSummaryRows = buildExpenseCardSummaryRows(cards, activeCardIds, visibleExpenses, visibleExpensePayments);

  function toggleCard(cardId: string) {
    setSelectedCardIds((current) => (current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]));
  }

  return (
    <section className="flex-1 px-4 pb-24 pt-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Consumos y abonos</h2>
          <p className="text-sm text-slate-500">Saldo objetivo antes del corte, separado del estado de cuenta.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="grid size-11 place-items-center rounded-md bg-slate-100 text-slate-800" aria-label="Crear categoria" onClick={onCreateCategory}>
            <Tags size={20} />
          </button>
          <button className="grid size-11 place-items-center rounded-md bg-slate-950 text-white" aria-label="Registrar consumo" onClick={onRegisterExpense} disabled={cards.length === 0}>
            <Plus size={20} />
          </button>
        </div>
      </div>

      <section className="rounded-lg bg-slate-950 p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-teal-200">Pendiente por consumos</p>
            <p className="mt-1 text-sm text-slate-300">
              {viewMode === 'cycle' ? `Corte ${formatShortDate(parseDateInput(effectiveCycleCutDate))}` : `Mes ${formatMonthLabel(monthValue)}`}
            </p>
          </div>
          <button className="inline-flex min-h-9 items-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-slate-950" onClick={onRegisterExpensePayment} disabled={visibleExpenses.length === 0}>
            <Banknote size={16} />
            Abonar
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-md bg-white/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase text-teal-200">GTQ</p>
            <p className="mt-1 text-xl font-bold">{formatCurrency(pendingByCurrency.GTQ, 'GTQ')}</p>
          </div>
          <div className="rounded-md bg-white/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase text-teal-200">USD</p>
            <p className="mt-1 text-xl font-bold">{formatCurrency(pendingByCurrency.USD, 'USD')}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-300">
          Total {formatCurrency(totalByCurrency.GTQ, 'GTQ')} / {formatCurrency(totalByCurrency.USD, 'USD')} · abonado {formatCurrency(paidByCurrency.GTQ, 'GTQ')} / {formatCurrency(paidByCurrency.USD, 'USD')}
        </p>
        {paymentTargetDate ? (
          <p className="mt-1 text-xs leading-5 text-teal-100">
            Paga antes del {formatShortDate(paymentTargetDate)} para reducir el saldo del proximo corte y posibles intereses.
          </p>
        ) : null}
      </section>

      <ExpenseCardSummaryTable open={summaryOpen} rows={cardSummaryRows} onToggle={() => setSummaryOpen((current) => !current)} />

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Filter size={16} />
          Filtros
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Vista
            <select className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700" value={viewMode} onChange={(event) => setViewMode(event.target.value as ExpenseViewMode)}>
              <option value="cycle">Ciclo tarjeta</option>
              <option value="month">Mes corrido</option>
            </select>
          </label>
          {viewMode === 'cycle' && selectedSingleCard ? (
            <div className="grid gap-1 text-sm font-medium text-slate-700">
              Corte
              <div className="flex min-h-11 items-center rounded-md bg-slate-100 px-3 text-base font-semibold text-slate-700">
                {formatShortDate(parseDateInput(effectiveCycleCutDate))}
              </div>
            </div>
          ) : null}
          {viewMode === 'cycle' && !selectedSingleCard ? (
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Corte
              <select className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700" value={cycleCutDate} onChange={(event) => setCycleCutDate(event.target.value)}>
                {availableCycleOptions.map((dateValue) => (
                  <option key={dateValue} value={dateValue}>
                    {formatShortDate(parseDateInput(dateValue))}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {viewMode === 'month' ? (
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Mes
              <input className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700" type="month" value={monthValue} onChange={(event) => setMonthValue(event.target.value)} />
            </label>
          ) : null}
        </div>
        <label className="mt-3 grid gap-1 text-sm font-medium text-slate-700">
          Categoria
          <select className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700" value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
            <option value="all">Todas</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`min-h-9 rounded-md px-3 text-sm font-semibold ${selectedCardIds.length === 0 ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setSelectedCardIds([])}>
            Todas
          </button>
          {cards.map((card) => (
            <button key={card.id} className={`min-h-9 rounded-md px-3 text-sm font-semibold ${activeCardIds.includes(card.id) && selectedCardIds.length > 0 ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => toggleCard(card.id)}>
              {card.alias}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Consumos</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{visibleExpenses.length}</span>
        </div>
        <div className="mt-3 space-y-3">
          {visibleExpenses.length > 0 ? (
            visibleExpenses.map((expense) => <ExpenseItem key={expense.id} categories={categories} expense={expense} />)
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">
              Registra un consumo y selecciona tarjeta, categoria y fecha.
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function ExpenseItem({ categories, expense }: { categories: ExpenseCategory[]; expense: CardExpense }) {
  const category = categories.find((item) => item.id === expense.categoryId);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ backgroundColor: category?.colorHex ?? '#475569' }} />
            <h4 className="truncate font-semibold">{expense.description}</h4>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {expense.cardAlias} · {expense.categoryName} · {formatShortDate(parseDateInput(expense.date))}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Corte {formatShortDate(parseDateInput(expense.cycleCutDate))}</p>
        </div>
        <p className="shrink-0 text-lg font-bold text-slate-950">{formatCurrency(expense.amount, expense.currency)}</p>
      </div>
    </article>
  );
}

function ExpenseCardSummaryTable({
  onToggle,
  open,
  rows
}: {
  onToggle: () => void;
  open: boolean;
  rows: Array<{ abonos: number; compras: number; currency: Currency; saldo: number; tarjeta: string }>;
}) {
  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
      <button className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left" type="button" onClick={onToggle}>
        <div>
          <h3 className="text-base font-semibold text-slate-950">Resumen por tarjeta</h3>
          <p className="text-sm text-slate-500">{rows.length} saldos visibles</p>
        </div>
        <ChevronDown className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} size={20} />
      </button>

      {open ? (
        <div className="border-t border-slate-200 px-4 py-3">
          {rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[21rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="py-2 pr-3">Tarjeta</th>
                    <th className="px-3 py-2 text-right">Compras</th>
                    <th className="px-3 py-2 text-right">Abonos</th>
                    <th className="py-2 pl-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.tarjeta}-${row.currency}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-semibold text-slate-900">{row.tarjeta}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.compras, row.currency)}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.abonos, row.currency)}</td>
                      <td className="py-2 pl-3 text-right font-bold text-slate-950">{formatCurrency(row.saldo, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">No hay compras ni abonos para resumir con estos filtros.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PayablesView({
  cards,
  payablePayments,
  payables,
  onDeactivatePayable,
  onDeletePayable,
  onEditPayable,
  onMarkPayablePaid,
  onReactivatePayable,
  onRegisterPayable
}: {
  cards: CardPriority[];
  payablePayments: PayableAccountPayment[];
  payables: PayableAccount[];
  onDeactivatePayable: (payableId: string) => void;
  onDeletePayable: (payableId: string) => void;
  onEditPayable: (payable: PayableAccount) => void;
  onMarkPayablePaid: (payable: PayableAccount, dueDate: Date) => void;
  onReactivatePayable: (payableId: string) => void;
  onRegisterPayable: () => void;
}) {
  const activePayables = payables.filter((payable) => payable.active);
  const inactivePayables = payables.filter((payable) => !payable.active);
  const agendaItems = buildPayableAgenda(cards, activePayables, payablePayments, new Date());
  const todayItems = agendaItems.filter((item) => getDateInputValue(item.dueDate) === getDateInputValue(new Date()));
  const upcomingItems = agendaItems.filter((item) => item.dueDate.getTime() > startOfToday().getTime()).slice(0, 8);

  return (
    <section className="flex-1 px-4 pb-24 pt-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Cuentas por pagar</h2>
          <p className="text-sm text-slate-500">Servicios, prestamos y vencimientos proximos.</p>
        </div>
        <button
          className="grid size-11 shrink-0 place-items-center rounded-md bg-slate-950 text-white"
          aria-label="Agregar cuenta por pagar"
          onClick={onRegisterPayable}
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SummaryTile label="Vencen hoy" value={String(todayItems.filter((item) => !item.isPaid).length)} />
        <SummaryTile label="Activas" value={String(activePayables.length)} />
      </div>

      <section className="mt-5">
        <h3 className="text-base font-semibold">Proximos pagos</h3>
        <div className="mt-3 space-y-3">
          {agendaItems.length > 0 ? (
            agendaItems.slice(0, 10).map((item) => (
              <PayableAgendaItemCard
                key={item.id}
                item={item}
                payable={item.kind === 'payable' ? activePayables.find((payable) => payable.id === item.id.split(':')[1]) : undefined}
                onMarkPayablePaid={onMarkPayablePaid}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">
              Agrega luz, telefono, universidad, hipoteca u otra cuenta por pagar.
            </div>
          )}
        </div>
      </section>

      <section className="mt-5">
        <h3 className="text-base font-semibold">Cuentas registradas</h3>
        <div className="mt-3 space-y-3">
          {activePayables.length > 0 ? (
            activePayables.map((payable) => (
              <PayableAccountCard
                key={payable.id}
                payable={payable}
                cardAlias={cards.find((card) => card.id === payable.cardId)?.alias}
                onDeactivate={onDeactivatePayable}
                onDelete={onDeletePayable}
                onEdit={onEditPayable}
                onReactivate={onReactivatePayable}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">
              No hay cuentas recurrentes activas.
            </div>
          )}
        </div>
      </section>

      {inactivePayables.length > 0 ? (
        <section className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Inactivas</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{inactivePayables.length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {inactivePayables.map((payable) => (
              <PayableAccountCard
                key={payable.id}
                inactive
                payable={payable}
                cardAlias={cards.find((card) => card.id === payable.cardId)?.alias}
                onDeactivate={onDeactivatePayable}
                onDelete={onDeletePayable}
                onEdit={onEditPayable}
                onReactivate={onReactivatePayable}
              />
            ))}
          </div>
        </section>
      ) : null}

      {upcomingItems.length > 0 ? (
        <section className="mt-5">
          <h3 className="text-base font-semibold">Calendario rapido</h3>
          <div className="mt-3 space-y-2">
            {upcomingItems.map((item) => (
              <div key={`calendar-${item.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
                <span className={`size-3 rounded-full ${getAgendaUrgencyClass(item.dueDate, item.isPaid)}`} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{item.title}</p>
                  <p className="text-sm text-slate-500">{formatShortDate(item.dueDate)}</p>
                </div>
                <p className="text-sm font-bold text-slate-900">{item.amountLabel ?? formatCurrency(item.amount, item.currency)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function PayableAgendaItemCard({
  item,
  onMarkPayablePaid,
  payable
}: {
  item: PayableAgendaItem;
  onMarkPayablePaid: (payable: PayableAccount, dueDate: Date) => void;
  payable?: PayableAccount;
}) {
  const dueLabel = getAgendaDueLabel(item.dueDate, item.isPaid);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.kind === 'card' ? 'bg-slate-950 text-white' : 'bg-teal-100 text-teal-800'}`}>
              {item.kind === 'card' ? 'Tarjeta' : 'Cuenta'}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getAgendaBadgeClass(item.dueDate, item.isPaid)}`}>
              {dueLabel}
            </span>
          </div>
          <h3 className="mt-2 truncate font-semibold">{item.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{item.subtitle}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-slate-950">{item.amountLabel ?? formatCurrency(item.amount, item.currency)}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{formatShortDate(item.dueDate)}</p>
        </div>
      </div>
      {payable && !item.isPaid ? (
        <button
          className="mt-3 h-10 w-full rounded-md bg-teal-700 text-sm font-semibold text-white"
          onClick={() => onMarkPayablePaid(payable, item.dueDate)}
        >
          Marcar pagado
        </button>
      ) : null}
    </article>
  );
}

function PayableAccountCard({
  cardAlias,
  inactive = false,
  onDeactivate,
  onDelete,
  onEdit,
  onReactivate,
  payable
}: {
  cardAlias?: string;
  inactive?: boolean;
  onDeactivate: (payableId: string) => void;
  onDelete: (payableId: string) => void;
  onEdit: (payable: PayableAccount) => void;
  onReactivate: (payableId: string) => void;
  payable: PayableAccount;
}) {
  return (
    <article className={`rounded-lg border border-slate-200 p-4 shadow-sm ${inactive ? 'bg-slate-100 text-slate-600' : 'bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`truncate font-semibold ${inactive ? 'text-slate-700' : 'text-slate-950'}`}>{payable.name}</h3>
            {inactive ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">Inactiva</span> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {getPayableCategoryLabel(payable.category)} · {getPayableScheduleLabel(payable)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {getPaymentMethodLabel(payable.paymentMethod)}
            {cardAlias ? ` · ${cardAlias}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-slate-950">{formatCurrency(payable.amount, payable.currency)}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{payable.amountType === 'variable' ? 'Variable' : 'Fijo'}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="h-10 rounded-md bg-slate-100 text-sm font-semibold text-slate-800" onClick={() => onEdit(payable)}>
          Editar
        </button>
        {inactive ? (
          <button className="h-10 rounded-md bg-teal-700 text-sm font-semibold text-white" onClick={() => onReactivate(payable.id)}>
            Reactivar
          </button>
        ) : (
          <button className="h-10 rounded-md border border-red-200 text-sm font-semibold text-red-600" onClick={() => onDeactivate(payable.id)}>
            Desactivar
          </button>
        )}
        {inactive ? (
          <button className="col-span-2 h-10 rounded-md border border-red-200 text-sm font-semibold text-red-600" onClick={() => onDelete(payable.id)}>
            Eliminar definitivo
          </button>
        ) : null}
      </div>
    </article>
  );
}

function CurrencyBalanceRow({
  card,
  currency,
  paid
}: {
  card: CreditCardAccount;
  currency: Currency;
  paid: number;
}) {
  return (
    <div className="rounded-md bg-white/10 px-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-teal-200">{currency}</p>
        <p className="text-2xl font-bold">{formatCurrency(getCardBalance(card, currency), currency)}</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs font-medium text-slate-400">Debia</p>
          <p className="mt-0.5 font-semibold">{formatCurrency(getCardBalance(card, currency) + paid, currency)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Abonado</p>
          <p className="mt-0.5 font-semibold">{formatCurrency(paid, currency)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Disponible</p>
          <p className="mt-0.5 font-semibold">{formatCurrency(getAvailableCredit(card, currency), currency)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Limite</p>
          <p className="mt-0.5 font-semibold">{formatCurrency(getCardLimit(card, currency), currency)}</p>
        </div>
      </div>
    </div>
  );
}

function CurrencyStatementRow({
  currency,
  extras,
  paid
}: {
  currency: Currency;
  extras: number;
  paid: number;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
      <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">{currency}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-500">Abonado</p>
        <p className="mt-0.5 break-words text-base font-bold text-slate-950">{formatCurrency(paid, currency)}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-500">ExtraFin</p>
        <p className="mt-0.5 break-words text-base font-bold text-slate-950">{formatCurrency(extras, currency)}</p>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}

function PaymentItem({ payment }: { payment: PaymentRecord }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{payment.cardAlias}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {getPaymentTypeLabel(payment.type)} · {formatShortDate(parseDateInput(payment.date))}
          </p>
        </div>
        <p className="shrink-0 text-lg font-bold text-teal-700">{formatCurrency(payment.amount, payment.currency)}</p>
      </div>
    </article>
  );
}

function BalanceSnapshotItem({ snapshot }: { snapshot: BalanceSnapshot }) {
  const balanceDelta = snapshot.newBalance - snapshot.previousBalance;
  const deltaLabel =
    balanceDelta === 0
      ? 'Sin cambio'
      : `${balanceDelta > 0 ? '+' : ''}${formatCurrency(balanceDelta, snapshot.currency)}`;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">{snapshot.currency}</span>
            <h4 className="font-semibold text-slate-950">Saldo registrado</h4>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Estado {formatShortDate(parseDateInput(snapshot.statementDate))}
            {snapshot.paymentDueDate ? ` · pagar antes del ${formatShortDate(parseDateInput(snapshot.paymentDueDate))}` : ''}
          </p>
          {snapshot.notes ? <p className="mt-2 text-sm text-slate-600">{snapshot.notes}</p> : null}
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {snapshot.source === 'manual' ? 'Manual' : 'OCR'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Antes</p>
          <p className="mt-0.5 font-semibold text-slate-950">{formatCurrency(snapshot.previousBalance, snapshot.currency)}</p>
        </div>
        <div className="rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Nuevo</p>
          <p className="mt-0.5 font-semibold text-slate-950">{formatCurrency(snapshot.newBalance, snapshot.currency)}</p>
        </div>
        <div className="rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Cambio</p>
          <p className="mt-0.5 font-semibold text-slate-950">{deltaLabel}</p>
        </div>
      </div>
    </article>
  );
}

function BottomNav({
  activeTab,
  onSelectTab
}: {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}) {
  const items = [
    { icon: CreditCard, id: 'cards' as const, label: 'Tarjetas' },
    { icon: Tags, id: 'calendar' as const, label: 'Consumos' },
    { icon: ClipboardList, id: 'payables' as const, label: 'Cuentas' },
    { icon: ReceiptText, id: 'payment-history' as const, label: 'Pagos realizados' }
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 pb-4 pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {items.map((item) => (
          <button
            key={item.label}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-semibold leading-tight ${
              activeTab === item.id ? 'bg-slate-950 text-white' : 'text-slate-500'
            }`}
            onClick={() => onSelectTab(item.id)}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function ExpenseForm({
  cards,
  categories,
  onClose,
  onSave
}: {
  cards: CardPriority[];
  categories: ExpenseCategory[];
  onClose: () => void;
  onSave: (expense: CardExpense) => void;
}) {
  const [form, setForm] = useState<ExpenseFormState>(() => ({
    amount: '',
    cardId: cards[0]?.id ?? '',
    categoryId: categories[0]?.id ?? '',
    currency: cards[0]?.primaryCurrency ?? 'GTQ',
    date: getDateInputValue(new Date()),
    description: ''
  }));
  const selectedCard = cards.find((card) => card.id === form.cardId);
  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const cycleCutDate = selectedCard ? getDateInputValue(getNextCutDate(parseDateInput(form.date), selectedCard.cutDay)) : form.date;

  function updateField<Key extends keyof ExpenseFormState>(key: Key, value: ExpenseFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCard || !selectedCategory) return;

    onSave({
      id: createLocalId(),
      amount: parseAmount(form.amount),
      cardAlias: selectedCard.alias,
      cardId: selectedCard.id,
      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name,
      createdAt: new Date().toISOString(),
      currency: form.currency,
      cycleCutDate,
      date: form.date,
      description: form.description.trim()
    });
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Registrar consumo</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <TextField label="Descripcion" value={form.description} onChange={(value) => updateField('description', value)} required />
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Tarjeta
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.cardId}
                onChange={(event) => {
                  const nextCard = cards.find((card) => card.id === event.target.value);
                  setForm((current) => ({ ...current, cardId: event.target.value, currency: nextCard?.primaryCurrency ?? 'GTQ' }));
                }}
                required
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.alias}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Categoria
              <select className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700" value={form.categoryId} onChange={(event) => updateField('categoryId', event.target.value)} required>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedCard ? <CurrencySelect currencies={selectedCard.currencies} value={form.currency} onChange={(currency) => updateField('currency', currency)} /> : null}

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Monto" type="number" value={form.amount} onChange={(value) => updateField('amount', value)} required />
              <TextField label="Fecha" type="date" value={form.date} onChange={(value) => updateField('date', value)} required />
            </div>

            {selectedCard ? (
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
                Este consumo entrara al corte del <span className="font-semibold text-slate-950">{formatShortDate(parseDateInput(cycleCutDate))}</span>.
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpensePaymentForm({
  cards,
  expensePayments,
  expenses,
  onClose,
  onSave
}: {
  cards: CardPriority[];
  expensePayments: ExpensePayment[];
  expenses: CardExpense[];
  onClose: () => void;
  onSave: (payment: ExpensePayment) => void;
}) {
  const [form, setForm] = useState<ExpensePaymentFormState>(() => ({
    amount: '',
    cardId: cards[0]?.id ?? '',
    currency: cards[0]?.primaryCurrency ?? 'GTQ',
    date: getDateInputValue(new Date()),
    notes: ''
  }));
  const selectedCard = cards.find((card) => card.id === form.cardId);
  const cycleCutDate = selectedCard ? getDateInputValue(getNextCutDate(parseDateInput(form.date), selectedCard.cutDay)) : form.date;
  const pending = selectedCard ? getPendingExpenseBalance(expenses, expensePayments, selectedCard.id, form.currency, cycleCutDate) : 0;

  function updateField<Key extends keyof ExpensePaymentFormState>(key: Key, value: ExpensePaymentFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCard) return;

    onSave({
      id: createLocalId(),
      amount: parseAmount(form.amount),
      cardAlias: selectedCard.alias,
      cardId: selectedCard.id,
      createdAt: new Date().toISOString(),
      currency: form.currency,
      cycleCutDate,
      date: form.date,
      notes: form.notes.trim() || undefined
    });
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Abonar consumos</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Tarjeta
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.cardId}
                onChange={(event) => {
                  const nextCard = cards.find((card) => card.id === event.target.value);
                  setForm((current) => ({ ...current, cardId: event.target.value, currency: nextCard?.primaryCurrency ?? 'GTQ' }));
                }}
                required
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.alias}
                  </option>
                ))}
              </select>
            </label>
            {selectedCard ? <CurrencySelect currencies={selectedCard.currencies} value={form.currency} onChange={(currency) => updateField('currency', currency)} /> : null}
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Monto" type="number" value={form.amount} onChange={(value) => updateField('amount', value)} required />
              <TextField label="Fecha" type="date" value={form.date} onChange={(value) => updateField('date', value)} required />
            </div>
            <TextField label="Nota opcional" value={form.notes} onChange={(value) => updateField('notes', value)} />
            <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Se aplicara al corte del <span className="font-semibold text-slate-950">{formatShortDate(parseDateInput(cycleCutDate))}</span>. Pendiente:{' '}
              <span className="font-semibold text-slate-950">{formatCurrency(pending, form.currency)}</span>.
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar abono
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpenseCategoryForm({ onClose, onSave }: { onClose: () => void; onSave: (category: ExpenseCategory) => void }) {
  const [form, setForm] = useState<ExpenseCategoryFormState>({ colorHex: '#0f766e', name: '' });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      id: createLocalId(),
      active: true,
      colorHex: form.colorHex,
      createdAt: new Date().toISOString(),
      name: form.name.trim()
    });
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Nueva categoria</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <TextField label="Nombre" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} required />
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Color
              <input className="h-11 w-full rounded-md border border-slate-300 bg-white p-1" type="color" value={form.colorHex} onChange={(event) => setForm((current) => ({ ...current, colorHex: event.target.value }))} />
            </label>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaymentForm({
  cards,
  initialCardId,
  onClose,
  onSave
}: {
  cards: CardPriority[];
  initialCardId: string | null;
  onClose: () => void;
  onSave: (payment: PaymentRecord) => void;
}) {
  const [form, setForm] = useState<PaymentFormState>(() => ({
    amount: '',
    cardId: initialCardId ?? cards[0]?.id ?? '',
    date: getDateInputValue(new Date()),
    currency: (cards.find((card) => card.id === initialCardId) ?? cards[0])?.primaryCurrency ?? 'GTQ',
    type: 'abono'
  }));
  const selectedCard = cards.find((card) => card.id === form.cardId);

  function updateField<Key extends keyof PaymentFormState>(key: Key, value: PaymentFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCard) return;

    const payment: PaymentRecord = {
      id: createLocalId(),
      cardId: selectedCard.id,
      cardAlias: selectedCard.alias,
      currency: form.currency,
      amount: parseAmount(form.amount),
      date: form.date,
      type: form.type,
      createdAt: new Date().toISOString()
    };

    onSave(payment);
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Registrar abono</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Tarjeta
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.cardId}
                onChange={(event) => {
                  const nextCard = cards.find((card) => card.id === event.target.value);
                  setForm((current) => ({
                    ...current,
                    cardId: event.target.value,
                    currency: nextCard?.primaryCurrency ?? 'GTQ'
                  }));
                }}
                required
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.alias}
                  </option>
                ))}
              </select>
            </label>

            {selectedCard ? (
              <CurrencySelect currencies={selectedCard.currencies} value={form.currency} onChange={(currency) => updateField('currency', currency)} />
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Monto" type="number" value={form.amount} onChange={(value) => updateField('amount', value)} required />
              <TextField label="Fecha" type="date" value={form.date} onChange={(value) => updateField('date', value)} required />
            </div>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Tipo
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.type}
                onChange={(event) => updateField('type', event.target.value as PaymentType)}
              >
                <option value="abono">Abono parcial</option>
                <option value="minimo">Pago minimo</option>
                <option value="pago_total">Pago total</option>
              </select>
            </label>

            {selectedCard ? (
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
                Saldo {form.currency}:{' '}
                <span className="font-semibold text-slate-950">{formatCurrency(getCardBalance(selectedCard, form.currency), form.currency)}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BalanceUpdateForm({
  cards,
  initialCardId,
  onClose,
  onSave
}: {
  cards: CardPriority[];
  initialCardId: string | null;
  onClose: () => void;
  onSave: (snapshot: BalanceSnapshot) => void;
}) {
  const [form, setForm] = useState<BalanceUpdateFormState>(() => {
    const initialCard = cards.find((card) => card.id === initialCardId) ?? cards[0];

    return {
      amount: initialCard ? String(getCardBalance(initialCard, initialCard.primaryCurrency)) : '',
      cardId: initialCard?.id ?? '',
      currency: initialCard?.primaryCurrency ?? 'GTQ',
      notes: '',
      paymentDueDate: initialCard ? getDateInputValue(getCardPaymentDueDate(initialCard)) : getEstimatedPaymentDueDateInput('25', '15'),
      statementDate: getDateInputValue(new Date())
    };
  });
  const selectedCard = cards.find((card) => card.id === form.cardId);

  function updateField<Key extends keyof BalanceUpdateFormState>(key: Key, value: BalanceUpdateFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCard) return;

    const snapshot: BalanceSnapshot = {
      id: createLocalId(),
      cardId: selectedCard.id,
      cardAlias: selectedCard.alias,
      currency: form.currency,
      previousBalance: getCardBalance(selectedCard, form.currency),
      newBalance: parseAmount(form.amount),
      paymentDueDate: form.paymentDueDate,
      statementDate: form.statementDate,
      source: 'manual',
      notes: form.notes.trim() || undefined,
      createdAt: new Date().toISOString()
    };

    onSave(snapshot);
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Actualizar saldo</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Tarjeta
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.cardId}
                onChange={(event) => {
                  const nextCard = cards.find((card) => card.id === event.target.value);
                  const nextCurrency = nextCard?.primaryCurrency ?? 'GTQ';
                  setForm((current) => ({
                    ...current,
                    amount: nextCard ? String(getCardBalance(nextCard, nextCurrency)) : current.amount,
                    cardId: event.target.value,
                    currency: nextCurrency,
                    paymentDueDate: nextCard ? getDateInputValue(getCardPaymentDueDate(nextCard)) : current.paymentDueDate
                  }));
                }}
                required
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.alias}
                  </option>
                ))}
              </select>
            </label>

            {selectedCard ? (
              <CurrencySelect
                currencies={selectedCard.currencies}
                value={form.currency}
                onChange={(currency) => {
                  updateField('currency', currency);
                  updateField('amount', String(getCardBalance(selectedCard, currency)));
                }}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Nuevo saldo" type="number" value={form.amount} onChange={(value) => updateField('amount', value)} required />
              <TextField label="Fecha estado" type="date" value={form.statementDate} onChange={(value) => updateField('statementDate', value)} required />
            </div>

            <TextField label="Fecha de pago" type="date" value={form.paymentDueDate} onChange={(value) => updateField('paymentDueDate', value)} required />

            <TextField label="Nota opcional" value={form.notes} onChange={(value) => updateField('notes', value)} />

            {selectedCard ? (
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
                Este ajuste actualiza el saldo principal de{' '}
                <span className="font-semibold text-slate-950">{selectedCard.alias}</span> en {form.currency} de{' '}
                <span className="font-semibold text-slate-950">{formatCurrency(getCardBalance(selectedCard, form.currency), form.currency)}</span> al
                nuevo saldo indicado. No crea abono ni pago.
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar saldo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MergeCardsForm({
  cards,
  initialTargetCardId,
  onClose,
  onSave
}: {
  cards: CardPriority[];
  initialTargetCardId: string | null;
  onClose: () => void;
  onSave: (request: MergeCardsRequest) => void;
}) {
  const targetCard = cards.find((card) => card.id === initialTargetCardId) ?? cards[0];
  const sourceCards = cards.filter((card) => card.id !== targetCard?.id);
  const [sourceCardId, setSourceCardId] = useState<string>(() => sourceCards[0]?.id ?? '');
  const sourceCard = sourceCards.find((card) => card.id === sourceCardId);
  const mergedPreview = targetCard && sourceCard ? mergeCreditCards(targetCard, sourceCard) : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetCard || !sourceCard) return;

    onSave({
      sourceCardId: sourceCard.id,
      targetCardId: targetCard.id
    });
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Fusionar tarjetas</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          {targetCard && sourceCards.length > 0 ? (
            <div className="grid gap-3">
              <section className="rounded-lg bg-slate-100 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Ficha que queda</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: targetCard.colorHex }} />
                  <p className="font-semibold text-slate-950">{targetCard.alias}</p>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {targetCard.bank} · {formatCurrencyList(targetCard.currencies)}
                </p>
              </section>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Ficha a unir
                <select
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                  value={sourceCardId}
                  onChange={(event) => setSourceCardId(event.target.value)}
                  required
                >
                  {sourceCards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.alias} · {formatCurrencyList(card.currencies)}
                    </option>
                  ))}
                </select>
              </label>

              {sourceCard && mergedPreview ? (
                <section className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase text-slate-500">Resultado</p>
                  <p className="mt-2 font-semibold text-slate-950">{mergedPreview.alias}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {mergedPreview.bank} · {formatCurrencyList(mergedPreview.currencies)}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm">
                    {mergedPreview.currencies.map((currency) => (
                      <div key={currency} className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 px-3 py-2">
                        <div>
                          <p className="text-xs font-medium text-slate-500">Saldo {currency}</p>
                          <p className="font-semibold text-slate-950">{formatCurrency(getCardBalance(mergedPreview, currency), currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-500">Limite {currency}</p>
                          <p className="font-semibold text-slate-950">{formatCurrency(getCardLimit(mergedPreview, currency), currency)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Se conserva la ficha principal y se mueve el historial de pagos, ExtraFin y saldos registrados desde la ficha unida.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
              Necesitas al menos dos tarjetas activas para fusionar.
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white disabled:bg-slate-300" disabled={!sourceCard} type="submit">
              Fusionar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InstallmentForm({
  cards,
  installment,
  initialCardId,
  onClose,
  onSave
}: {
  cards: CardPriority[];
  installment: InstallmentPlan | null;
  initialCardId: string | null;
  onClose: () => void;
  onSave: (plan: InstallmentPlan) => void;
}) {
  const [form, setForm] = useState<InstallmentFormState>(() =>
    installment
      ? installmentToForm(installment)
      : {
          cardId: initialCardId ?? cards[0]?.id ?? '',
          currency: (cards.find((card) => card.id === initialCardId) ?? cards[0])?.primaryCurrency ?? 'GTQ',
          description: '',
          totalAmount: '',
          monthlyPayment: '',
          totalInstallments: '12',
          paidInstallments: '0',
          startDate: getDateInputValue(new Date())
        }
  );
  const selectedCard = cards.find((card) => card.id === form.cardId);

  function updateField<Key extends keyof InstallmentFormState>(key: Key, value: InstallmentFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCard) return;

    const totalInstallments = clampNumber(parseAmount(form.totalInstallments), 1, 120);
    const paidInstallments = clampNumber(parseAmount(form.paidInstallments), 0, totalInstallments);

    const plan: InstallmentPlan = {
      id: installment?.id ?? createLocalId(),
      cardId: selectedCard.id,
      currency: form.currency,
      description: form.description.trim(),
      totalAmount: parseAmount(form.totalAmount),
      monthlyPayment: parseAmount(form.monthlyPayment),
      totalInstallments,
      paidInstallments,
      startDate: form.startDate,
      lastAppliedCutDate: installment?.lastAppliedCutDate ?? getDateInputValue(getLastCutDate(new Date(), selectedCard.cutDay)),
      status: installment?.status ?? 'active',
      closedAt: installment?.closedAt,
      createdAt: installment?.createdAt ?? new Date().toISOString()
    };

    onSave(plan);
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">{installment ? 'Editar extrafinanciamiento' : 'Nuevo extrafinanciamiento'}</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Tarjeta
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.cardId}
                onChange={(event) => {
                  const nextCard = cards.find((card) => card.id === event.target.value);
                  setForm((current) => ({
                    ...current,
                    cardId: event.target.value,
                    currency: nextCard?.primaryCurrency ?? 'GTQ'
                  }));
                }}
                required
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.alias}
                  </option>
                ))}
              </select>
            </label>

            {selectedCard ? (
              <CurrencySelect currencies={selectedCard.currencies} value={form.currency} onChange={(currency) => updateField('currency', currency)} />
            ) : null}

            <TextField label="Descripcion" value={form.description} onChange={(value) => updateField('description', value)} required />

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Monto total" type="number" value={form.totalAmount} onChange={(value) => updateField('totalAmount', value)} required />
              <TextField label="Cuota mensual" type="number" value={form.monthlyPayment} onChange={(value) => updateField('monthlyPayment', value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Cuotas" type="number" value={form.totalInstallments} onChange={(value) => updateField('totalInstallments', value)} required />
              <TextField label="Pagadas" type="number" value={form.paidInstallments} onChange={(value) => updateField('paidInstallments', value)} required />
              <div className="col-span-2">
                <TextField label="Inicio" type="date" value={form.startDate} onChange={(value) => updateField('startDate', value)} required />
              </div>
            </div>

            {selectedCard ? (
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
                Moneda del extra: <span className="font-semibold text-slate-950">{form.currency}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayablePaymentForm({
  draft,
  onClose,
  onSave
}: {
  draft: PayablePaymentDraft;
  onClose: () => void;
  onSave: (amount: number, notes?: string) => void;
}) {
  const [form, setForm] = useState<PayablePaymentFormState>(() => ({
    amount: String(draft.payable.amount),
    notes: ''
  }));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(parseAmount(form.amount), form.notes.trim() || undefined);
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Marcar cuenta pagada</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-950">{draft.payable.name}</p>
              <p className="mt-1">
                Vence {formatShortDate(draft.dueDate)} · {draft.payable.amountType === 'variable' ? 'monto variable' : 'monto fijo'}
              </p>
            </div>

            <TextField label="Monto pagado" type="number" value={form.amount} onChange={(value) => setForm((current) => ({ ...current, amount: value }))} required />
            <TextField label="Nota opcional" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar pago
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayableForm({
  cards,
  onClose,
  onSave,
  payable
}: {
  cards: CardPriority[];
  onClose: () => void;
  onSave: (payable: PayableAccount) => void;
  payable: PayableAccount | null;
}) {
  const [form, setForm] = useState<PayableFormState>(() =>
    payable
      ? payableToForm(payable)
      : {
          amount: '',
          amountType: 'variable',
          cardId: '',
          category: 'servicios',
          currency: 'GTQ',
          dueDay: String(new Date().getDate()),
          dueDate: getDateInputValue(new Date()),
          endDate: '',
          endMode: 'never',
          frequency: 'monthly',
          name: '',
          notes: '',
          paymentMethod: 'transferencia'
        }
  );

  function updateField<Key extends keyof PayableFormState>(key: Key, value: PayableFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPayable: PayableAccount = {
      id: payable?.id ?? createLocalId(),
      name: form.name.trim(),
      category: form.category,
      currency: form.currency,
      amount: parseAmount(form.amount),
      amountType: form.amountType,
      frequency: form.frequency,
      dueDay: clampNumber(parseAmount(form.dueDay), 1, 31),
      dueDate: form.frequency === 'once' ? form.dueDate : undefined,
      endDate: form.frequency !== 'once' && form.endMode === 'date' ? form.endDate : undefined,
      endMode: form.frequency === 'once' ? 'date' : form.endMode,
      paymentMethod: form.paymentMethod,
      cardId: form.paymentMethod === 'tarjeta' && form.cardId ? form.cardId : undefined,
      notes: form.notes.trim() || undefined,
      active: true,
      createdAt: payable?.createdAt ?? new Date().toISOString()
    };

    onSave(nextPayable);
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">{payable ? 'Editar cuenta por pagar' : 'Nueva cuenta por pagar'}</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <TextField label="Nombre" value={form.name} onChange={(value) => updateField('name', value)} required />

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Categoria
                <select
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                  value={form.category}
                  onChange={(event) => updateField('category', event.target.value as PayableCategory)}
                >
                  <option value="servicios">Servicios</option>
                  <option value="educacion">Educacion</option>
                  <option value="hipoteca">Hipoteca</option>
                  <option value="seguros">Seguros</option>
                  <option value="suscripciones">Suscripciones</option>
                  <option value="otros">Otros</option>
                </select>
              </label>
              <CurrencySelect currencies={['GTQ', 'USD']} value={form.currency} onChange={(currency) => updateField('currency', currency)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Monto" type="number" value={form.amount} onChange={(value) => updateField('amount', value)} required />
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Tipo monto
                <select
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                  value={form.amountType}
                  onChange={(event) => updateField('amountType', event.target.value as PayableAmountType)}
                >
                  <option value="variable">Variable</option>
                  <option value="fixed">Fijo</option>
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Frecuencia
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.frequency}
                onChange={(event) => updateField('frequency', event.target.value as PayableFrequency)}
              >
                <option value="monthly">Mensual</option>
                <option value="quarterly">Trimestral</option>
                <option value="annual">Anual</option>
                <option value="once">Una vez</option>
              </select>
            </label>

            {form.frequency === 'once' ? (
              <TextField label="Fecha de vencimiento" type="date" value={form.dueDate} onChange={(value) => updateField('dueDate', value)} required />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Dia vence" type="number" value={form.dueDay} onChange={(value) => updateField('dueDay', value)} required />
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Termina
                  <select
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                    value={form.endMode}
                    onChange={(event) => updateField('endMode', event.target.value as PayableEndMode)}
                  >
                    <option value="never">Nunca</option>
                    <option value="date">Fecha</option>
                  </select>
                </label>
                {form.endMode === 'date' ? (
                  <div className="col-span-2">
                    <TextField label="Fecha final" type="date" value={form.endDate} onChange={(value) => updateField('endDate', value)} required />
                  </div>
                ) : null}
              </div>
            )}

            <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
              {form.amountType === 'variable'
                ? 'Usa el monto como referencia; al marcar pagado se guardara este valor y luego podra ajustarse.'
                : 'El monto se considera fijo para cada vencimiento.'}
            </div>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Metodo de pago
              <select
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                value={form.paymentMethod}
                onChange={(event) => updateField('paymentMethod', event.target.value as PayablePaymentMethod)}
              >
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="debito">Debito</option>
                <option value="efectivo">Efectivo</option>
              </select>
            </label>

            {form.paymentMethod === 'tarjeta' ? (
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Tarjeta
                <select
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
                  value={form.cardId}
                  onChange={(event) => updateField('cardId', event.target.value)}
                >
                  <option value="">Sin asociar</option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.alias}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <TextField label="Notas" value={form.notes} onChange={(value) => updateField('notes', value)} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CardForm({
  card,
  onClose,
  onSave
}: {
  card: CreditCardAccount | null;
  onClose: () => void;
  onSave: (card: CreditCardAccount) => void;
}) {
  const [form, setForm] = useState<CardFormState>(() => (card ? cardToForm(card) : emptyForm));

  function updateField<Key extends keyof CardFormState>(key: Key, value: CardFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currencies = getFormCurrencies(form);
    const primaryCurrency = currencies.includes(form.primaryCurrency) ? form.primaryCurrency : currencies[0];

    const nextCard: CreditCardAccount = {
      id: card?.id ?? createLocalId(),
      bank: form.bank.trim(),
      alias: form.alias.trim(),
      currencies,
      primaryCurrency,
      creditLimits: {
        GTQ: currencies.includes('GTQ') ? parseAmount(form.creditLimitGTQ) : 0,
        USD: currencies.includes('USD') ? parseAmount(form.creditLimitUSD) : 0
      },
      benefitsDescription: form.benefitsDescription.trim() || undefined,
      annualInterestRate: parseAmount(form.annualInterestRate),
      cutDay: clampNumber(parseAmount(form.cutDay), 1, 31),
      graceDays: clampNumber(parseAmount(form.graceDays), 0, 60),
      colorHex: form.colorHex,
      active: true,
      currentBalances: {
        GTQ: currencies.includes('GTQ') ? parseAmount(form.currentBalanceGTQ) : 0,
        USD: currencies.includes('USD') ? parseAmount(form.currentBalanceUSD) : 0
      },
      paymentDueDate: form.paymentDueDate
    };

    onSave(nextCard);
  }

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-full w-full max-w-md flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">{card ? 'Editar tarjeta' : 'Nueva tarjeta'}</h2>
          <button className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700" aria-label="Cerrar formulario" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          <div className="grid gap-3">
            <TextField label="Banco" value={form.bank} onChange={(value) => updateField('bank', value)} required />
            <TextField label="Alias" value={form.alias} onChange={(value) => updateField('alias', value)} required />
            <TextAreaField label="Beneficio" value={form.benefitsDescription} onChange={(value) => updateField('benefitsDescription', value)} />

            <section className="rounded-lg bg-slate-100 p-3">
              <p className="text-sm font-semibold text-slate-700">Monedas habilitadas</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <CurrencyToggle
                  checked={form.hasGTQ}
                  label="GTQ"
                  onChange={(checked) => setForm((current) => normalizeCardCurrencyForm({ ...current, hasGTQ: checked }))}
                />
                <CurrencyToggle
                  checked={form.hasUSD}
                  label="USD"
                  onChange={(checked) => setForm((current) => normalizeCardCurrencyForm({ ...current, hasUSD: checked }))}
                />
              </div>
              <div className="mt-3">
                <CurrencySelect
                  currencies={getFormCurrencies(form)}
                  label="Moneda principal"
                  value={form.primaryCurrency}
                  onChange={(currency) => updateField('primaryCurrency', currency)}
                />
              </div>
            </section>

            {form.hasGTQ ? (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
                <TextField label="Limite GTQ" type="number" value={form.creditLimitGTQ} onChange={(value) => updateField('creditLimitGTQ', value)} required />
                <TextField
                  label="Saldo GTQ"
                  type="number"
                  value={form.currentBalanceGTQ}
                  onChange={(value) => updateField('currentBalanceGTQ', value)}
                  required
                />
              </div>
            ) : null}

            {form.hasUSD ? (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
                <TextField label="Limite USD" type="number" value={form.creditLimitUSD} onChange={(value) => updateField('creditLimitUSD', value)} required />
                <TextField
                  label="Saldo USD"
                  type="number"
                  value={form.currentBalanceUSD}
                  onChange={(value) => updateField('currentBalanceUSD', value)}
                  required
                />
              </div>
            ) : null}

            <TextField label="Fecha de pago" type="date" value={form.paymentDueDate} onChange={(value) => updateField('paymentDueDate', value)} required />

            <div className="grid grid-cols-3 gap-3">
              <TextField label="Corte" type="number" value={form.cutDay} onChange={(value) => updateField('cutDay', value)} required />
              <TextField label="Gracia" type="number" value={form.graceDays} onChange={(value) => updateField('graceDays', value)} required />
              <TextField label="Interes %" type="number" value={form.annualInterestRate} onChange={(value) => updateField('annualInterestRate', value)} required />
            </div>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Color
              <input
                className="h-11 w-full rounded-md border border-slate-300 bg-white p-1"
                type="color"
                value={form.colorHex}
                onChange={(event) => updateField('colorHex', event.target.value)}
              />
            </label>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="h-12 rounded-md border border-slate-300 font-semibold text-slate-700" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="h-12 rounded-md bg-slate-950 font-semibold text-white" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TextField({
  label,
  onChange,
  required = false,
  type = 'text',
  value
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: 'date' | 'number' | 'text';
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <input
        className="h-11 rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none focus:border-teal-700"
        inputMode={type === 'number' ? 'decimal' : undefined}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type === 'number' ? 'text' : type}
        value={value}
      />
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <textarea
        className="min-h-20 resize-none rounded-md border border-slate-300 px-3 py-2 text-base text-slate-950 outline-none focus:border-teal-700"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ej. Puntos - 7% en comidas y 3% en gasolina"
        value={value}
      />
    </label>
  );
}

function CurrencySelect({
  currencies,
  label = 'Moneda',
  onChange,
  value
}: {
  currencies: Currency[];
  label?: string;
  onChange: (currency: Currency) => void;
  value: Currency;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <select
        className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-700"
        value={value}
        onChange={(event) => onChange(event.target.value as Currency)}
      >
        {currencies.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>
    </label>
  );
}

function CurrencyToggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: Currency;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-slate-700">
      <input className="size-4 accent-teal-700" checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function cardToForm(card: CreditCardAccount): CardFormState {
  return {
    bank: card.bank,
    alias: card.alias,
    hasGTQ: card.currencies.includes('GTQ'),
    hasUSD: card.currencies.includes('USD'),
    primaryCurrency: card.primaryCurrency,
    creditLimitGTQ: String(getCardLimit(card, 'GTQ')),
    creditLimitUSD: String(getCardLimit(card, 'USD')),
    benefitsDescription: card.benefitsDescription ?? '',
    annualInterestRate: String(card.annualInterestRate),
    cutDay: String(card.cutDay),
    graceDays: String(card.graceDays),
    currentBalanceGTQ: String(getCardBalance(card, 'GTQ')),
    currentBalanceUSD: String(getCardBalance(card, 'USD')),
    paymentDueDate: getDateInputValue(getCardPaymentDueDate(card)),
    colorHex: card.colorHex
  };
}

function installmentToForm(plan: InstallmentPlan): InstallmentFormState {
  return {
    cardId: plan.cardId,
    currency: plan.currency,
    description: plan.description,
    totalAmount: String(plan.totalAmount),
    monthlyPayment: String(plan.monthlyPayment),
    totalInstallments: String(plan.totalInstallments),
    paidInstallments: String(plan.paidInstallments),
    startDate: plan.startDate
  };
}

function payableToForm(payable: PayableAccount): PayableFormState {
  return {
    amount: String(payable.amount),
    amountType: payable.amountType ?? 'variable',
    cardId: payable.cardId ?? '',
    category: payable.category,
    currency: payable.currency,
    dueDay: String(payable.dueDay),
    dueDate: payable.dueDate ?? getDateInputValue(new Date()),
    endDate: payable.endDate ?? '',
    endMode: payable.endMode ?? 'never',
    frequency: payable.frequency ?? 'monthly',
    name: payable.name,
    notes: payable.notes ?? '',
    paymentMethod: payable.paymentMethod
  };
}

function parseAmount(value: string): number {
  const normalizedValue = value.trim().replace(',', '.');
  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function createLocalId(): string {
  const browserCrypto = globalThis.crypto;

  if (browserCrypto?.randomUUID) {
    return browserCrypto.randomUUID();
  }

  const randomValues = new Uint32Array(2);
  browserCrypto?.getRandomValues(randomValues);
  const randomPart = randomValues[0] || Math.floor(Math.random() * 1_000_000_000);
  const extraPart = randomValues[1] || Math.floor(Math.random() * 1_000_000_000);
  return `${Date.now().toString(36)}-${randomPart.toString(36)}-${extraPart.toString(36)}`;
}

function getCardBalance(card: CreditCardAccount, currency: Currency): number {
  return card.currentBalances[currency] ?? 0;
}

function getCardPaymentDueDate(card: CreditCardAccount | CardPriority): Date {
  if (card.paymentDueDate) return parseDateInput(card.paymentDueDate);
  if ('nextPaymentDate' in card) return card.nextPaymentDate;
  return parseDateInput(getEstimatedPaymentDueDateInput(String(card.cutDay), String(card.graceDays)));
}

function getEstimatedPaymentDueDateInput(cutDay: string, graceDays: string): string {
  const safeCutDay = clampNumber(parseAmount(cutDay), 1, 31);
  const safeGraceDays = clampNumber(parseAmount(graceDays), 0, 60);
  return getDateInputValue(addCalendarDays(getNextCutDate(new Date(), safeCutDay), safeGraceDays));
}

function getCardLimit(card: CreditCardAccount, currency: Currency): number {
  return card.creditLimits[currency] ?? 0;
}

function getAvailableCredit(card: CreditCardAccount, currency: Currency): number {
  return Math.max(getCardLimit(card, currency) - getCardBalance(card, currency), 0);
}

function mergeCreditCards(targetCard: CreditCardAccount, sourceCard: CreditCardAccount): CreditCardAccount {
  const currencies = Array.from(new Set([...targetCard.currencies, ...sourceCard.currencies]));

  return {
    ...targetCard,
    active: targetCard.active || sourceCard.active,
    currencies,
    primaryCurrency: currencies.includes(targetCard.primaryCurrency) ? targetCard.primaryCurrency : currencies[0],
    creditLimits: {
      GTQ: getCardLimit(targetCard, 'GTQ') + getCardLimit(sourceCard, 'GTQ'),
      USD: getCardLimit(targetCard, 'USD') + getCardLimit(sourceCard, 'USD')
    },
    currentBalances: {
      GTQ: getCardBalance(targetCard, 'GTQ') + getCardBalance(sourceCard, 'GTQ'),
      USD: getCardBalance(targetCard, 'USD') + getCardBalance(sourceCard, 'USD')
    }
  };
}

function formatCurrencyList(currencies: Currency[]): string {
  return currencies.join('/');
}

function formatCardBalances(card: CreditCardAccount): string {
  return card.currencies.map((currency) => formatCurrency(getCardBalance(card, currency), currency)).join(' · ');
}

function formatPendingCardBalances(card: CreditCardAccount): string {
  const pendingBalances = card.currencies
    .filter((currency) => getCardBalance(card, currency) > 0)
    .map((currency) => formatCurrency(getCardBalance(card, currency), currency));

  return pendingBalances.length > 0 ? pendingBalances.join(' · ') : formatCardBalances(card);
}

function sumPaymentsByCurrency(payments: PaymentRecord[], currency: Currency): number {
  return payments.filter((payment) => payment.currency === currency).reduce((total, payment) => total + payment.amount, 0);
}

function sumInstallmentsByCurrency(installments: InstallmentPlan[], currency: Currency): number {
  return installments.filter((plan) => plan.currency === currency).reduce((total, plan) => total + plan.monthlyPayment, 0);
}

function getFormCurrencies(form: CardFormState): Currency[] {
  const currencies: Currency[] = [];
  if (form.hasGTQ) currencies.push('GTQ');
  if (form.hasUSD) currencies.push('USD');
  return currencies.length > 0 ? currencies : ['GTQ'];
}

function normalizeCardCurrencyForm(form: CardFormState): CardFormState {
  const hasAnyCurrency = form.hasGTQ || form.hasUSD;
  const nextForm = hasAnyCurrency ? form : { ...form, hasGTQ: true };
  const currencies = getFormCurrencies(nextForm);

  return {
    ...nextForm,
    primaryCurrency: currencies.includes(nextForm.primaryCurrency) ? nextForm.primaryCurrency : currencies[0]
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function formatElapsedDays(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

function getDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addCalendarDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function isCurrentMonth(dateValue: string): boolean {
  const date = parseDateInput(dateValue);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
}

function summarizePayments(payments: PaymentRecord[]): Record<Currency, number> {
  return payments.reduce(
    (totals, payment) => ({
      ...totals,
      [payment.currency]: totals[payment.currency] + payment.amount
    }),
    { GTQ: 0, USD: 0 }
  );
}

function summarizeExpenses(expenses: CardExpense[]): Record<Currency, number> {
  return expenses.reduce(
    (totals, expense) => ({
      ...totals,
      [expense.currency]: totals[expense.currency] + expense.amount
    }),
    { GTQ: 0, USD: 0 }
  );
}

function summarizeExpensePayments(payments: ExpensePayment[]): Record<Currency, number> {
  return payments.reduce(
    (totals, payment) => ({
      ...totals,
      [payment.currency]: totals[payment.currency] + payment.amount
    }),
    { GTQ: 0, USD: 0 }
  );
}

function buildExpenseCardSummaryRows(
  cards: CardPriority[],
  activeCardIds: string[],
  expenses: CardExpense[],
  payments: ExpensePayment[]
): Array<{ abonos: number; compras: number; currency: Currency; saldo: number; tarjeta: string }> {
  return cards
    .filter((card) => activeCardIds.includes(card.id))
    .flatMap((card) =>
      card.currencies.map((currency) => {
        const compras = expenses
          .filter((expense) => expense.cardId === card.id && expense.currency === currency)
          .reduce((total, expense) => total + expense.amount, 0);
        const abonos = payments
          .filter((payment) => payment.cardId === card.id && payment.currency === currency)
          .reduce((total, payment) => total + payment.amount, 0);

        return {
          abonos,
          compras,
          currency,
          saldo: Math.max(compras - abonos, 0),
          tarjeta: `${card.alias} ${currency}`
        };
      })
    )
    .filter((row) => row.compras > 0 || row.abonos > 0);
}

function getPendingExpenseBalance(
  expenses: CardExpense[],
  payments: ExpensePayment[],
  cardId: string,
  currency: Currency,
  cycleCutDate: string
): number {
  const spent = expenses
    .filter((expense) => expense.cardId === cardId && expense.currency === currency && expense.cycleCutDate === cycleCutDate)
    .reduce((total, expense) => total + expense.amount, 0);
  const paid = payments
    .filter((payment) => payment.cardId === cardId && payment.currency === currency && payment.cycleCutDate === cycleCutDate)
    .reduce((total, payment) => total + payment.amount, 0);

  return Math.max(spent - paid, 0);
}

function getExpenseCycleOptions(cards: CardPriority[], expenses: CardExpense[]): string[] {
  const options = new Set<string>();
  cards.forEach((card) => {
    options.add(getDateInputValue(card.nextCutDate));
    options.add(getDateInputValue(card.lastCutDate));
  });
  expenses.forEach((expense) => options.add(expense.cycleCutDate));

  return Array.from(options).sort((first, second) => parseDateInput(second).getTime() - parseDateInput(first).getTime());
}

function getMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isSameMonthValue(dateValue: string, monthValue: string): boolean {
  return dateValue.slice(0, 7) === monthValue;
}

function formatMonthLabel(monthValue: string): string {
  const [year, month] = monthValue.split('-').map(Number);
  return new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function buildPayableAgenda(
  cards: CardPriority[],
  payables: PayableAccount[],
  payablePayments: PayableAccountPayment[],
  today: Date
): PayableAgendaItem[] {
  const horizonEnd = addCalendarDays(today, 45);
  const cardItems = cards
    .filter((card) => getTotalCardBalance(card) > 0)
    .map((card) => {
      const dueDate = getCardPaymentDueDate(card);

      return {
        amount: getCardBalance(card, card.primaryCurrency),
        amountLabel: formatPendingCardBalances(card),
        currency: card.primaryCurrency,
        dueDate,
        id: `card:${card.id}:${getDateInputValue(dueDate)}`,
        isPaid: false,
        kind: 'card' as const,
        subtitle: `${card.bank} · saldo de tarjeta`,
        title: card.alias
      };
    });

  const payableItems = payables.flatMap((payable) =>
    getPayableDueDates(payable, today, horizonEnd).map((dueDate) => {
      const dueDateValue = getDateInputValue(dueDate);
      return {
        amount: payable.amount,
        currency: payable.currency,
        dueDate,
        id: `payable:${payable.id}:${dueDateValue}`,
        isPaid: payablePayments.some((payment) => payment.payableId === payable.id && payment.dueDate === dueDateValue),
        kind: 'payable' as const,
        subtitle: `${getPayableCategoryLabel(payable.category)} · ${getPaymentMethodLabel(payable.paymentMethod)} · ${getPayableFrequencyLabel(payable.frequency)}`,
        title: payable.name
      };
    })
  );

  return [...cardItems, ...payableItems].sort((first, second) => first.dueDate.getTime() - second.dueDate.getTime());
}

function getPayableDueDates(payable: PayableAccount, fromDate: Date, horizonEnd: Date): Date[] {
  const startDate = startOfToday(fromDate);

  if (payable.frequency === 'once') {
    if (!payable.dueDate) return [];

    const dueDate = parseDateInput(payable.dueDate);
    return dueDate.getTime() >= startDate.getTime() && dueDate.getTime() <= horizonEnd.getTime() ? [dueDate] : [];
  }

  const endDate = payable.endMode === 'date' && payable.endDate ? parseDateInput(payable.endDate) : null;
  const dates: Date[] = [];
  let cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), Math.min(payable.dueDay, getDaysInMonth(fromDate.getFullYear(), fromDate.getMonth())));

  while (cursor.getTime() < startDate.getTime()) {
    cursor = addPayablePeriod(cursor, payable.frequency, payable.dueDay);
  }

  while (cursor.getTime() <= horizonEnd.getTime()) {
    if (!endDate || cursor.getTime() <= endDate.getTime()) {
      dates.push(cursor);
    }

    cursor = addPayablePeriod(cursor, payable.frequency, payable.dueDay);
  }

  return dates;
}

function addPayablePeriod(date: Date, frequency: PayableFrequency, dueDay: number): Date {
  const monthStep = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const year = date.getFullYear();
  const nextMonth = date.getMonth() + monthStep;
  return new Date(year, nextMonth, Math.min(dueDay, getDaysInMonth(year, nextMonth)));
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function startOfToday(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getAgendaDueLabel(dueDate: Date, isPaid: boolean): string {
  if (isPaid) return 'Pagado';

  const days = Math.ceil((startOfToday(dueDate).getTime() - startOfToday().getTime()) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Manana';
  if (days < 0) return 'Vencido';
  return `${days} dias`;
}

function getAgendaBadgeClass(dueDate: Date, isPaid: boolean): string {
  if (isPaid) return 'bg-emerald-100 text-emerald-800';

  const days = Math.ceil((startOfToday(dueDate).getTime() - startOfToday().getTime()) / 86_400_000);
  if (days <= 1) return 'bg-red-100 text-red-800';
  if (days <= 7) return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

function getAgendaUrgencyClass(dueDate: Date, isPaid: boolean): string {
  if (isPaid) return 'bg-emerald-500';

  const days = Math.ceil((startOfToday(dueDate).getTime() - startOfToday().getTime()) / 86_400_000);
  if (days <= 1) return 'bg-red-500';
  if (days <= 7) return 'bg-amber-500';
  return 'bg-slate-400';
}

function getTotalCardBalance(card: CreditCardAccount): number {
  return card.currencies.reduce((total, currency) => total + getCardBalance(card, currency), 0);
}

function getPayableCategoryLabel(category: PayableCategory): string {
  const labels = {
    educacion: 'Educacion',
    hipoteca: 'Hipoteca',
    otros: 'Otros',
    seguros: 'Seguros',
    servicios: 'Servicios',
    suscripciones: 'Suscripciones'
  };

  return labels[category];
}

function getPayableFrequencyLabel(frequency: PayableFrequency): string {
  const labels = {
    annual: 'Anual',
    monthly: 'Mensual',
    once: 'Una vez',
    quarterly: 'Trimestral'
  };

  return labels[frequency];
}

function getPayableScheduleLabel(payable: PayableAccount): string {
  if (payable.frequency === 'once') {
    return payable.dueDate ? `vence ${formatShortDate(parseDateInput(payable.dueDate))}` : 'vence una vez';
  }

  const endLabel = payable.endMode === 'date' && payable.endDate ? ` hasta ${formatShortDate(parseDateInput(payable.endDate))}` : ' sin fecha final';
  return `${getPayableFrequencyLabel(payable.frequency).toLowerCase()} · dia ${payable.dueDay}${endLabel}`;
}

function getPaymentMethodLabel(method: PayablePaymentMethod): string {
  const labels = {
    debito: 'Debito',
    efectivo: 'Efectivo',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia'
  };

  return labels[method];
}

function getPaymentTypeLabel(type: PaymentType): string {
  const labels = {
    abono: 'Abono parcial',
    minimo: 'Pago minimo',
    pago_total: 'Pago total'
  };

  return labels[type];
}

function hasCloudData(data: {
  balanceSnapshots: BalanceSnapshot[];
  cards: CreditCardAccount[];
  expenseCategories?: ExpenseCategory[];
  expensePayments?: ExpensePayment[];
  expenses?: CardExpense[];
  installments: InstallmentPlan[];
  payablePayments: PayableAccountPayment[];
  payables: PayableAccount[];
  payments: PaymentRecord[];
}): boolean {
  return (
    data.cards.length > 0 ||
    (data.expenseCategories?.length ?? 0) > 0 ||
    (data.expensePayments?.length ?? 0) > 0 ||
    (data.expenses?.length ?? 0) > 0 ||
    data.payments.length > 0 ||
    data.installments.length > 0 ||
    data.balanceSnapshots.length > 0 ||
    data.payables.length > 0 ||
    data.payablePayments.length > 0
  );
}

function getCloudStatusLabel(status: CloudSyncStatus): string {
  const labels = {
    disabled: 'No configurado',
    error: 'Revisar conexion',
    'signed-out': 'Sin sesion',
    synced: 'Sincronizado',
    syncing: 'Sincronizando'
  };

  return labels[status];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrio un error inesperado.';
}

export default App;
