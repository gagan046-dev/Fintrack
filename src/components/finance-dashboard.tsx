"use client";

import { UserButton } from "@clerk/nextjs";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  CircleDollarSign,
  CreditCard,
  FileUp,
  Goal,
  Grid2X2,
  Landmark,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShoppingBag,
  Repeat2,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  HouseholdWorkspace,
  NotificationPanel,
  SecurityWorkspace,
  SettingsWorkspace,
  TransactionTrash,
} from "@/components/account-workspaces";
import {
  FinancialPositionWorkspace,
} from "@/components/financial-intelligence";
import { useCurrencyFormatter } from "@/components/currency-context";
import { OperationsWorkspace } from "@/components/operations-workspace";
import { TransactionEditor } from "./transaction-editor";
import { EphemeralAnalyst } from "./analyst-panel";
import { WeeklyInsightCard } from "./weekly-insight-card";

type TransactionType = "expense" | "income";

type Transaction = {
  id: number | string;
  description: string;
  merchant: string;
  category: string;
  paymentType: string;
  amount: number;
  type: TransactionType;
  date: string;
  accountId?: string | null;
};

type AccountOption = { id: string; name: string; balance: number };

type Budget = {
  id: string;
  category: string;
  amount: number;
  month: string;
  spent: number;
  remaining: number;
};

type SavingsGoal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  version: number;
};

async function getApiError(response: Response, fallback: string) {
  try {
    const result = (await response.json()) as {
      error?: string;
      issues?: Record<string, string[]>;
    };
    const issue = result.issues
      ? Object.values(result.issues).flat().find(Boolean)
      : undefined;
    return issue ?? result.error ?? fallback;
  } catch {
    return fallback;
  }
}

const initialTransactions: Transaction[] = [];
const storageKey = "fintrack-transactions-v2";
const legacyStorageKey = "northstar-transactions";
const demoMerchants = new Set([
  "Whole Foods",
  "Acme Studio",
  "Spotify",
  "Uber",
  "Nori House",
  "City Energy",
  "Pine Street Homes",
  "Target",
  "Monthly expenses",
]);
const storeListeners = new Set<() => void>();
let transactionSnapshot = initialTransactions;
let storeInitialized = false;

function getTransactionSnapshot() {
  if (!storeInitialized && typeof window !== "undefined") {
    storeInitialized = true;
    const saved =
      window.localStorage.getItem(storageKey) ??
      window.localStorage.getItem(legacyStorageKey);
    if (saved) {
      try {
        const stored = JSON.parse(saved) as Transaction[];
        transactionSnapshot = stored.filter(
          (transaction) =>
            !(
              typeof transaction.id === "number" &&
              transaction.id >= 1 &&
              transaction.id <= 18 &&
              demoMerchants.has(transaction.merchant)
            ),
        );
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(transactionSnapshot),
        );
      } catch {
        window.localStorage.removeItem(storageKey);
      }
      window.localStorage.removeItem(legacyStorageKey);
    }
  }
  return transactionSnapshot;
}

function updateTransactions(update: (current: Transaction[]) => Transaction[]) {
  transactionSnapshot = update(getTransactionSnapshot());
  window.localStorage.setItem(storageKey, JSON.stringify(transactionSnapshot));
  storeListeners.forEach((listener) => listener());
}

function subscribeToTransactions(listener: () => void) {
  storeListeners.add(listener);
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey || !event.newValue) return;
    try {
      transactionSnapshot = JSON.parse(event.newValue) as Transaction[];
      storeListeners.forEach((storeListener) => storeListener());
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }
  window.addEventListener("storage", handleStorage);
  return () => {
    storeListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function getServerTransactionSnapshot() {
  return initialTransactions;
}

async function fetchBudgets(month: string) {
  const response = await fetch(`/api/budgets?month=${month}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Budget load failed");
  const result = (await response.json()) as { data: Budget[] };
  return result.data;
}

async function fetchGoals() {
  const response = await fetch("/api/goals", { cache: "no-store" });
  if (!response.ok) throw new Error("Goal load failed");
  const result = (await response.json()) as { data: SavingsGoal[] };
  return result.data;
}

function suggestCategory(text: string) {
  const value = text.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["Food", ["grocery", "market", "whole foods", "cafe"]],
    ["Dining", ["restaurant", "dinner", "pizza", "doordash"]],
    ["Transport", ["uber", "lyft", "fuel", "shell", "metro"]],
    ["Utilities", ["electric", "internet", "water", "energy"]],
    ["Subscriptions", ["spotify", "netflix", "subscription", "renewal"]],
    ["Housing", ["rent", "mortgage", "landlord"]],
  ];
  return (
    rules.find(([, keywords]) =>
      keywords.some((keyword) => value.includes(keyword)),
    )?.[0] ?? "Uncategorized"
  );
}

function formatTransactionDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const workspaceNavItems = [
  { label: "Overview", target: "Overview", icon: Grid2X2 },
  { label: "Transactions", target: "Transactions", icon: ReceiptText },
  { label: "Financial position", target: "Position", icon: Landmark },
  { label: "Operations", target: "Operations", icon: SlidersHorizontal },
];

const planningNavItems = [
  { label: "Budgets", target: "Budgets", icon: Target },
  { label: "Goals", target: "Goals", icon: Goal },
  { label: "EMI", target: "EMI", icon: CreditCard },
  { label: "Household", target: "Household", icon: Users },
];

const mobileNavItems = [
  workspaceNavItems[0],
  workspaceNavItems[1],
  planningNavItems[0],
  planningNavItems[1],
];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  const { currency } = useCurrencyFormatter();
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.name} style={{ color: item.color }}>
          {item.name}: {currency.format(item.value)}
        </span>
      ))}
    </div>
  );
}

function TransactionCategoryIcon({ transaction }: { transaction: Transaction }) {
  const category = transaction.category.toLowerCase();
  if (transaction.type === "income") return <BriefcaseBusiness size={17} />;
  if (category.includes("food") || category.includes("dining")) return <Utensils size={17} />;
  if (category.includes("utilit")) return <Zap size={17} />;
  return <ShoppingBag size={17} />;
}

function TransactionWorkspace({
  transactions,
  searchQuery,
  onSearch,
  onDelete,
  onShowTrash,
  onEdit,
}: {
  transactions: Transaction[];
  searchQuery: string;
  onSearch: (value: string) => void;
  onDelete: (id: number | string) => void;
  onShowTrash: () => void;
  onEdit: (transaction: Transaction) => void;
}) {
  const { currency } = useCurrencyFormatter();
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [pendingDelete, setPendingDelete] = useState<number | string | null>(
    null,
  );
  const categories = [
    ...new Set(transactions.map((item) => item.category)),
  ].sort();
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredTransactions = transactions.filter((item) => {
    const matchesSearch =
      !normalizedSearch ||
      [item.merchant, item.description, item.category, item.paymentType].some(
        (value) => value.toLowerCase().includes(normalizedSearch),
      );
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    const matchesCategory =
      categoryFilter === "all" || item.category === categoryFilter;
    return matchesSearch && matchesType && matchesCategory;
  });
  const filteredIncome = filteredTransactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const filteredSpending = filteredTransactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);

  return (
    <section
      className="transactions-workspace"
      aria-label="Transaction management"
    >
      <div className="transaction-controls">
        <label className="workspace-search">
          <Search size={17} />
          <input
            value={searchQuery}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search merchant, description, or payment"
            aria-label="Search all transactions"
          />
        </label>
        <div className="filter-group">
          <SlidersHorizontal size={16} />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Filter by transaction type"
          >
            <option value="all">All types</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option value={category} key={category}>
                {category}
              </option>
            ))}
          </select>
          <button
            className="secondary-button trash-button"
            onClick={onShowTrash}
          >
            <Trash2 size={15} /> Recently deleted
          </button>
        </div>
      </div>
      <div className="transaction-summary">
        <div>
          <span>Results</span>
          <strong>{filteredTransactions.length}</strong>
        </div>
        <div>
          <span>Money in</span>
          <strong className="income">+{currency.format(filteredIncome)}</strong>
        </div>
        <div>
          <span>Money out</span>
          <strong className="expense">
            -{currency.format(filteredSpending)}
          </strong>
        </div>
        <div>
          <span>Net</span>
          <strong>{currency.format(filteredIncome - filteredSpending)}</strong>
        </div>
      </div>
      <div className="ledger-table">
        <div className="ledger-head">
          <span>Transaction</span>
          <span>Category</span>
          <span>Payment</span>
          <span>Date</span>
          <span>Amount</span>
          <span />
        </div>
        {filteredTransactions.length ? (
          filteredTransactions.map((transaction) => (
            <article className="ledger-row" key={transaction.id}>
              <div className={`transaction-icon ${transaction.type}`}>
                {transaction.type === "income" ? (
                  <ArrowDownLeft size={19} />
                ) : (
                  <CreditCard size={19} />
                )}
              </div>
              <div className="transaction-main">
                <strong>{transaction.merchant}</strong>
                <span>{transaction.description}</span>
              </div>
              <span className="transaction-category">
                {transaction.category}
              </span>
              <span className="transaction-payment">
                {transaction.paymentType}
              </span>
              <span className="ledger-date">
                {formatTransactionDate(transaction.date)}
              </span>
              <strong className={`ledger-amount ${transaction.type}`}>
                {transaction.type === "income" ? "+" : "-"}
                {currency.format(transaction.amount)}
              </strong>
              <div className="ledger-actions">
                <button
                  className="delete-transaction"
                  onClick={() => onEdit(transaction)}
                  aria-label={`Edit ${transaction.merchant} transaction`}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className={
                    pendingDelete === transaction.id
                      ? "delete-transaction confirm"
                      : "delete-transaction"
                  }
                  onClick={() => {
                    if (pendingDelete === transaction.id) {
                      onDelete(transaction.id);
                      setPendingDelete(null);
                    } else {
                      setPendingDelete(transaction.id);
                    }
                  }}
                  aria-label={
                    pendingDelete === transaction.id
                      ? `Confirm delete ${transaction.merchant} transaction`
                      : `Delete ${transaction.merchant} transaction`
                  }
                  title={
                    pendingDelete === transaction.id
                      ? "Confirm delete"
                      : "Delete transaction"
                  }
                >
                  {pendingDelete === transaction.id ? (
                    <Check size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-ledger">
            <ReceiptText size={24} />
            <strong>No matching transactions</strong>
            <span>Adjust the search or filters to see more results.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function BudgetWorkspace({
  budgets,
  loading,
  month,
  availableCategories,
  onMonthChange,
  onSave,
  onDelete,
}: {
  budgets: Budget[];
  loading: boolean;
  month: string;
  availableCategories: string[];
  onMonthChange: (month: string) => void;
  onSave: (budget: {
    category: string;
    amount: number;
    month: string;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { currency, currencySymbol } = useCurrencyFormatter();
  const [category, setCategory] = useState("Food");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [rollover, setRollover] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const totalLimit = budgets.reduce((sum, budget) => sum + budget.amount, 0);
  const totalSpent = budgets.reduce((sum, budget) => sum + budget.spent, 0);
  const existing = budgets.find((budget) => budget.category === category);
  const categories = [
    ...new Set([
      "Food",
      "Dining",
      "Housing",
      "Transport",
      "Utilities",
      "Subscriptions",
      "Shopping",
      "Lifestyle",
      "Other",
      ...availableCategories,
      ...budgets.map((budget) => budget.category),
    ]),
  ].sort();

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ category, amount: Number(amount), month });
      if (recurring)
        await fetch("/api/budget-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            amount: Number(amount),
            startMonth: month,
            recurrence: "monthly",
            rollover,
          }),
        });
      setAmount("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="budget-workspace"
      aria-label="Monthly budget management"
    >
      <div className="budget-toolbar">
        <div>
          <span className="workspace-label">Budget month</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            aria-label="Budget month"
          />
        </div>
        <form className="budget-form" onSubmit={submitBudget}>
          <label>
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                const budget = budgets.find(
                  (item) => item.category === event.target.value,
                );
                setAmount(budget ? String(budget.amount) : "");
              }}
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Monthly limit</span>
            <div className="compact-money">
              <b>{currencySymbol}</b>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </label>
          <label className="budget-check">
            <span>Repeat</span>
            <input
              type="checkbox"
              checked={recurring}
              onChange={(event) => setRecurring(event.target.checked)}
            />
          </label>
          <label className="budget-check">
            <span>Rollover</span>
            <input
              type="checkbox"
              checked={rollover}
              onChange={(event) => setRollover(event.target.checked)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={saving}>
            {existing ? <Pencil size={16} /> : <Plus size={16} />}
            <span>
              {saving ? "Saving" : existing ? "Update budget" : "Add budget"}
            </span>
          </button>
        </form>
      </div>
      <div className="budget-command">
        <button
          className="secondary-button"
          onClick={async () => {
            const next = new Date(`${month}-01T12:00:00Z`);
            next.setUTCMonth(next.getUTCMonth() + 1);
            await fetch("/api/budgets/rollover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fromMonth: month,
                toMonth: next.toISOString().slice(0, 7),
              }),
            });
          }}
        >
          Rollover to next month
        </button>
      </div>
      <div className="transaction-summary budget-summary">
        <div>
          <span>Total limit</span>
          <strong>{currency.format(totalLimit)}</strong>
        </div>
        <div>
          <span>Tracked spending</span>
          <strong className="expense">{currency.format(totalSpent)}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong
            className={totalLimit - totalSpent < 0 ? "expense" : "income"}
          >
            {currency.format(totalLimit - totalSpent)}
          </strong>
        </div>
        <div>
          <span>Categories</span>
          <strong>{budgets.length}</strong>
        </div>
      </div>
      <div className="budget-list">
        {loading ? (
          <div className="empty-ledger">
            <strong>Loading budgets</strong>
          </div>
        ) : budgets.length ? (
          budgets.map((budget) => {
            const percentage = budget.amount
              ? Math.round((budget.spent / budget.amount) * 100)
              : 0;
            const overBudget = budget.remaining < 0;
            return (
              <article className="budget-row" key={budget.id}>
                <div className="budget-row-heading">
                  <div>
                    <strong>{budget.category}</strong>
                    <span>
                      {currency.format(budget.spent)} of{" "}
                      {currency.format(budget.amount)}
                    </span>
                  </div>
                  <strong
                    className={
                      overBudget ? "budget-balance over" : "budget-balance"
                    }
                  >
                    {overBudget
                      ? `${currency.format(Math.abs(budget.remaining))} over`
                      : `${currency.format(budget.remaining)} left`}
                  </strong>
                </div>
                <div
                  className={
                    overBudget ? "budget-progress over" : "budget-progress"
                  }
                >
                  <span style={{ width: `${Math.min(percentage, 100)}%` }} />
                </div>
                <div className="budget-row-foot">
                  <span>{percentage}% used</span>
                  <div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setCategory(budget.category);
                        setAmount(String(budget.amount));
                      }}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      className={
                        pendingDelete === budget.id
                          ? "delete-transaction confirm"
                          : "delete-transaction"
                      }
                      onClick={() => {
                        if (pendingDelete === budget.id) {
                          void onDelete(budget.id);
                          setPendingDelete(null);
                        } else {
                          setPendingDelete(budget.id);
                        }
                      }}
                      aria-label={
                        pendingDelete === budget.id
                          ? `Confirm delete ${budget.category} budget`
                          : `Delete ${budget.category} budget`
                      }
                    >
                      {pendingDelete === budget.id ? (
                        <Check size={16} />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-ledger">
            <Target size={24} />
            <strong>No budgets for this month</strong>
            <span>Add a category limit to start tracking your plan.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function GoalWorkspace({
  goals,
  loading,
  onSave,
  onUpdate,
  onDelete,
}: {
  goals: SavingsGoal[];
  loading: boolean;
  onSave: (goal: {
    id?: string;
    expectedVersion?: number;
    name: string;
    targetAmount: number;
    currentAmount: number;
    targetDate: string | null;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    update: { contribution: number; expectedVersion: number },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { currency, currencySymbol } = useCurrencyFormatter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("0");
  const [targetDate, setTargetDate] = useState("");
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const [contributions, setContributions] = useState<
    Array<{ id: string; amount: number; source: string; contributedAt: string }>
  >([]);
  const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
  const totalSaved = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);

  function resetForm() {
    setEditingId(null);
    setName("");
    setTargetAmount("");
    setCurrentAmount("0");
    setTargetDate("");
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        id: editingId ?? undefined,
        expectedVersion: editingId
          ? goals.find((goal) => goal.id === editingId)?.version
          : undefined,
        name,
        targetAmount: Number(targetAmount),
        currentAmount: Number(currentAmount),
        targetDate: targetDate || null,
      });
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  function editGoal(goal: SavingsGoal) {
    setEditingId(goal.id);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setCurrentAmount(String(goal.currentAmount));
    setTargetDate(goal.targetDate ?? "");
  }

  async function addFunds(goal: SavingsGoal) {
    const amount = Number(fundAmount);
    if (!amount || amount < 0) return;
    setSaving(true);
    try {
      await onUpdate(goal.id, {
        contribution: Math.min(amount, goal.targetAmount - goal.currentAmount),
        expectedVersion: goal.version,
      });
      setFundingId(null);
      setFundAmount("");
    } finally {
      setSaving(false);
    }
  }

  async function showHistory(goalId: string) {
    if (historyGoalId === goalId) {
      setHistoryGoalId(null);
      return;
    }
    const response = await fetch(`/api/goals/${goalId}/contributions`);
    if (response.ok) {
      setContributions((await response.json()).data);
      setHistoryGoalId(goalId);
    }
  }

  return (
    <section className="goal-workspace" aria-label="Savings goal management">
      <form className="goal-form" onSubmit={submitGoal}>
        <div className="goal-form-heading">
          <div aria-live="polite">
            <span className="workspace-label">
              {editingId ? "Edit goal" : "New savings goal"}
            </span>
            <strong>
              {editingId
                ? "Adjust your plan"
                : "Give your savings a destination"}
            </strong>
          </div>
          {editingId && (
            <button className="text-button" type="button" onClick={resetForm}>
              <X size={14} /> Cancel edit
            </button>
          )}
        </div>
        <div className="goal-form-grid">
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Emergency fund"
              minLength={2}
              required
            />
          </label>
          <label>
            <span>Target</span>
            <div className="compact-money">
              <b>{currencySymbol}</b>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
                placeholder="5,000"
                required
              />
            </div>
          </label>
          <label>
            <span>Already saved</span>
            <div className="compact-money">
              <b>{currencySymbol}</b>
              <input
                type="number"
                min="0"
                step="0.01"
                max={targetAmount || undefined}
                value={currentAmount}
                onChange={(event) => setCurrentAmount(event.target.value)}
                required
              />
            </div>
          </label>
          <label>
            <span>Target date</span>
            <input
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={saving}>
            {editingId ? <Pencil size={16} /> : <Plus size={16} />}
            <span>
              {saving ? "Saving" : editingId ? "Save changes" : "Create goal"}
            </span>
          </button>
        </div>
      </form>
      <div className="transaction-summary goal-summary">
        <div>
          <span>Total target</span>
          <strong>{currency.format(totalTarget)}</strong>
        </div>
        <div>
          <span>Saved so far</span>
          <strong className="income">{currency.format(totalSaved)}</strong>
        </div>
        <div>
          <span>Still needed</span>
          <strong>
            {currency.format(Math.max(totalTarget - totalSaved, 0))}
          </strong>
        </div>
        <div>
          <span>Active goals</span>
          <strong>{goals.length}</strong>
        </div>
      </div>
      <div className="goal-list">
        {loading ? (
          <div className="empty-ledger">
            <strong>Loading goals</strong>
          </div>
        ) : goals.length ? (
          goals.map((goal) => {
            const percentage = goal.targetAmount
              ? Math.round((goal.currentAmount / goal.targetAmount) * 100)
              : 0;
            const complete = goal.currentAmount >= goal.targetAmount;
            return (
              <article className="goal-card" key={goal.id}>
                <div className={complete ? "goal-icon complete" : "goal-icon"}>
                  <Goal size={20} />
                </div>
                <div className="goal-card-main">
                  <div className="goal-card-heading">
                    <div>
                      <strong>{goal.name}</strong>
                      <span>
                        {goal.targetDate
                          ? `Target ${new Date(`${goal.targetDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : "No deadline"}
                      </span>
                    </div>
                    <strong>{percentage}%</strong>
                  </div>
                  <div className="budget-progress">
                    <span style={{ width: `${Math.min(percentage, 100)}%` }} />
                  </div>
                  <div className="goal-amounts">
                    <strong>{currency.format(goal.currentAmount)} saved</strong>
                    <span>
                      {currency.format(goal.targetAmount - goal.currentAmount)}{" "}
                      to go
                    </span>
                  </div>
                </div>
                <div className="goal-actions">
                  <button
                    className="text-button"
                    onClick={() => void showHistory(goal.id)}
                  >
                    History
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setFundingId(fundingId === goal.id ? null : goal.id);
                      setFundAmount("");
                    }}
                    disabled={complete}
                  >
                    <Plus size={15} />
                    <span>{complete ? "Complete" : "Add funds"}</span>
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => editGoal(goal)}
                    aria-label={`Edit ${goal.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className={
                      pendingDelete === goal.id
                        ? "delete-transaction confirm"
                        : "delete-transaction"
                    }
                    onClick={() => {
                      if (pendingDelete === goal.id) {
                        void onDelete(goal.id);
                        setPendingDelete(null);
                      } else {
                        setPendingDelete(goal.id);
                      }
                    }}
                    aria-label={
                      pendingDelete === goal.id
                        ? `Confirm delete ${goal.name}`
                        : `Delete ${goal.name}`
                    }
                  >
                    {pendingDelete === goal.id ? (
                      <Check size={16} />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>
                {fundingId === goal.id && (
                  <div className="fund-goal">
                    <div className="compact-money">
                      <b>{currencySymbol}</b>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={goal.targetAmount - goal.currentAmount}
                        value={fundAmount}
                        onChange={(event) => setFundAmount(event.target.value)}
                        placeholder="Amount"
                        autoFocus
                      />
                    </div>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void addFunds(goal)}
                      disabled={saving || !Number(fundAmount)}
                    >
                      Add
                    </button>
                  </div>
                )}
                {historyGoalId === goal.id && (
                  <div className="goal-history">
                    {contributions.length ? (
                      contributions.map((item) => (
                        <div key={item.id}>
                          <span>
                            {new Date(item.contributedAt).toLocaleDateString()}{" "}
                            · {item.source}
                          </span>
                          <strong>{currency.format(item.amount)}</strong>
                        </div>
                      ))
                    ) : (
                      <span>No contributions recorded yet.</span>
                    )}
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <div className="empty-ledger">
            <Goal size={24} />
            <strong>No savings goals yet</strong>
            <span>Create a goal to turn plans into measurable progress.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function FinanceDashboard({
  authenticationEnabled = false,
  userName = "Alex Rivera",
  todayIso,
}: {
  authenticationEnabled?: boolean;
  userName?: string;
  todayIso: string;
}) {
  const { currency } = useCurrencyFormatter();
  const today = new Date(todayIso);
  const todayLabel = today.toLocaleDateString("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const [activeNav, setActiveNav] = useState("Overview");
  const transactions = useSyncExternalStore(
    subscribeToTransactions,
    getTransactionSnapshot,
    getServerTransactionSnapshot,
  );
  const setTransactions = updateTransactions;
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);
  const [transactionEditorOpen, setTransactionEditorOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "connected" | "local"
  >("checking");
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetMonth, setBudgetMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const selectedMonthDate = new Date(`${budgetMonth}-15T12:00:00`);
  const currentMonthLabel = selectedMonthDate.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [goalLoading, setGoalLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userInitials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  useEffect(() => {
    let active = true;

    async function connectBackend() {
      try {
        const response = await fetch("/api/transactions", {
          cache: "no-store",
        });
        if (response.status === 401) {
          window.location.replace("/sign-in");
          return;
        }
        if (!response.ok) throw new Error("Database unavailable");
        const result = (await response.json()) as { data: Transaction[] };
        let synced = result.data;
        const pendingLocal = getTransactionSnapshot().filter(
          (transaction) => typeof transaction.id === "number",
        );

        if (pendingLocal.length) {
          const migration = await fetch("/api/transactions/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transactions: pendingLocal.map(({ id, ...transaction }) => ({
                ...transaction,
                source: "manual",
                externalId: `local:${id}`,
              })),
            }),
          });
          if (!migration.ok) throw new Error("Migration failed");
          const migrated = (await migration.json()) as { data: Transaction[] };
          const submittedIds = new Set(
            pendingLocal.map((transaction) => transaction.id),
          );
          const addedDuringSync = getTransactionSnapshot().filter(
            (transaction) =>
              typeof transaction.id === "number" &&
              !submittedIds.has(transaction.id),
          );
          const byId = new Map(
            [...result.data, ...migrated.data].map((transaction) => [
              transaction.id,
              transaction,
            ]),
          );
          synced = [...addedDuringSync, ...byId.values()];
        }

        if (active) {
          setTransactions(() => synced);
          setBackendStatus("connected");
        }
      } catch {
        if (active) setBackendStatus("local");
      }
    }

    void connectBackend();
    return () => {
      active = false;
    };
  }, [setTransactions]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invitation");
    if (!token) return;
    void fetch("/api/households/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await getApiError(response, "Invitation could not be accepted."),
          );
        window.history.replaceState({}, "", window.location.pathname);
        window.location.reload();
      })
      .catch((error: Error) => setImportNotice(error.message));
  }, []);

  async function loadBudgets(month: string) {
    setBudgetLoading(true);
    try {
      setBudgets(await fetchBudgets(month));
    } catch {
      setImportNotice("Budgets could not be loaded.");
    } finally {
      setBudgetLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchBudgets(budgetMonth)
      .then((data) => {
        if (active) setBudgets(data);
      })
      .catch(() => {
        if (active) setImportNotice("Budgets could not be loaded.");
      })
      .finally(() => {
        if (active) setBudgetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [budgetMonth]);

  useEffect(() => {
    let active = true;
    void fetch("/api/financial-position", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { data?: { accounts: AccountOption[] } } | null) => {
        if (active && result?.data) setAccounts(result.data.accounts);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchGoals()
      .then((data) => {
        if (active) setGoals(data);
      })
      .catch(() => {
        if (active) setImportNotice("Goals could not be loaded.");
      })
      .finally(() => {
        if (active) setGoalLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(selectedMonthDate);
    date.setMonth(selectedMonthDate.getMonth() - (5 - index));
    return date.toISOString().slice(0, 7);
  });
  const cashFlowData = monthKeys.map((key) => {
    const monthly = transactions.filter((item) => item.date.startsWith(key));
    return {
      month: new Date(`${key}-15T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
      }),
      income: monthly
        .filter((item) => item.type === "income")
        .reduce((sum, item) => sum + item.amount, 0),
      spending: monthly
        .filter((item) => item.type === "expense")
        .reduce((sum, item) => sum + item.amount, 0),
    };
  });
  const currentMonth = cashFlowData.at(-1) ?? { income: 0, spending: 0 };
  const previousMonth = cashFlowData.at(-2) ?? { income: 0, spending: 0 };
  const spending = currentMonth.spending;
  const income = currentMonth.income;
  const netCashFlow = income - spending;
  const previousNetCashFlow = previousMonth.income - previousMonth.spending;
  const changePercent = (current: number, previous: number) =>
    previous === 0 ? 0 : Math.round(((current - previous) / Math.abs(previous)) * 100);
  const incomeChange = changePercent(income, previousMonth.income);
  const netCashFlowChange = changePercent(netCashFlow, previousNetCashFlow);
  const previousSaved = Math.max(previousNetCashFlow, 0);
  const savedThisMonth = Math.max(netCashFlow, 0);
  const savedChange = changePercent(savedThisMonth, previousSaved);
  const daysInMonth = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0).getDate();
  const currentMonthKey = today.toISOString().slice(0, 7);
  const daysElapsed = budgetMonth === currentMonthKey ? Math.max(today.getDate(), 1) : daysInMonth;
  const projectedMonthEnd = income - (spending / daysElapsed) * daysInMonth;
  const monthlyBudget = budgets.reduce((sum, budget) => sum + budget.amount, 0);
  const budgetUsed =
    monthlyBudget > 0
      ? Math.min(100, Math.round((spending / monthlyBudget) * 100))
      : 0;
  const spendingChange = previousMonth.spending
    ? Math.round(
        ((spending - previousMonth.spending) / previousMonth.spending) * 100,
      )
    : 0;
  const categoryColors = [
    "#17223b",
    "#129b91",
    "#f26b5e",
    "#e3a62f",
    "#3976d7",
  ];
  const categoryTotals = transactions
    .filter(
      (item) =>
        item.type === "expense" && item.date.startsWith(monthKeys.at(-1) ?? ""),
    )
    .reduce<
      Record<string, number>
    >((totals, item) => ({ ...totals, [item.category]: (totals[item.category] ?? 0) + item.amount }), {});
  const categoryData = Object.entries(categoryTotals)
    .filter(([, value]) => value > 0)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 5)
    .map(([name, value], index) => ({
      name,
      value,
      color: categoryColors[index],
    }));

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/transactions/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok)
      return setImportNotice(
        await getApiError(response, "Transfer could not be created."),
      );
    setTransferOpen(false);
    await refreshTransactions();
    const position = await fetch("/api/financial-position", {
      cache: "no-store",
    });
    if (position.ok) setAccounts((await position.json()).data.accounts);
  }

  async function importTransactions(file: File) {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet)
        throw new Error("The workbook does not contain a readable sheet.");
      const rows =
        XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet);
      let adjustedDates = 0;
      const imported = rows
        .map((row, index): Transaction | null => {
          const normalized = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key.toLowerCase().trim(),
              value,
            ]),
          );
          const amount = Number(normalized.amount ?? normalized.value ?? 0);
          if (!Number.isFinite(amount) || amount === 0) return null;
          const rawType = String(normalized.type ?? "expense").toLowerCase();
          const description = String(
            normalized.description ?? normalized.memo ?? "Imported transaction",
          );
          const merchant = String(
            normalized.merchant ?? normalized.payee ?? "Imported",
          );
          const rawDate = normalized.date;
          let date = new Date().toISOString().slice(0, 10);
          if (typeof rawDate === "number") {
            const parsed = XLSX.SSF.parse_date_code(rawDate);
            if (parsed)
              date = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
            else adjustedDates += 1;
          } else if (typeof rawDate === "string") {
            const isoMatch = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            const usMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (isoMatch)
              date = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
            else if (usMatch)
              date = `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
            else adjustedDates += 1;
          } else adjustedDates += 1;
          return {
            id: Date.now() + index,
            description,
            merchant,
            category: String(
              normalized.category ??
                suggestCategory(`${merchant} ${description}`),
            ),
            paymentType: String(
              normalized["payment type"] ??
                normalized.payment ??
                "Imported account",
            ),
            amount: Math.abs(amount),
            type: rawType === "income" || amount < 0 ? "income" : "expense",
            date,
          };
        })
        .filter((item): item is Transaction => item !== null);
      const skipped = rows.length - imported.length;
      setTransactions((current) => [...imported, ...current]);
      if (backendStatus === "connected" && imported.length) {
        const response = await fetch("/api/transactions/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: imported.map(({ id, ...transaction }) => ({
              ...transaction,
              source: file.name.toLowerCase().endsWith(".csv")
                ? "csv_import"
                : "xlsx_import",
              externalId: `file:${file.name}:${id}`,
            })),
          }),
        });
        if (!response.ok) throw new Error("Database import failed");
        const result = (await response.json()) as { data: Transaction[] };
        const localIds = new Set(imported.map((item) => item.id));
        setTransactions((current) => [
          ...result.data,
          ...current.filter((item) => !localIds.has(item.id)),
        ]);
      }
      setImportNotice(
        `${imported.length} imported${skipped ? `, ${skipped} invalid row${skipped === 1 ? "" : "s"} skipped` : ""}${adjustedDates ? `, ${adjustedDates} date${adjustedDates === 1 ? "" : "s"} set to today` : ""}.`,
      );
    } catch {
      setImportNotice(
        "Import failed: use a readable CSV or Excel file with an Amount column.",
      );
    }
    window.setTimeout(() => setImportNotice(""), 6000);
  }

  async function deleteTransaction(id: number | string) {
    const deleted = transactions.find((transaction) => transaction.id === id);
    setTransactions((current) => current.filter((item) => item.id !== id));
    if (backendStatus !== "connected" || typeof id !== "string") return;

    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete failed");
    } catch {
      if (deleted) setTransactions((current) => [deleted, ...current]);
      setBackendStatus("local");
      setImportNotice(
        "Database delete failed. The transaction was restored locally.",
      );
      window.setTimeout(() => setImportNotice(""), 6000);
    }
  }

  async function refreshTransactions() {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as { data: Transaction[] };
    setTransactions((current) => [
      ...current.filter((transaction) => typeof transaction.id === "number"),
      ...result.data,
    ]);
  }

  async function saveBudget(input: {
    category: string;
    amount: number;
    month: string;
  }) {
    const response = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const message = await getApiError(response, "Budget could not be saved.");
      setImportNotice(message);
      throw new Error(message);
    }
    await loadBudgets(input.month);
    setImportNotice("Budget saved.");
    window.setTimeout(() => setImportNotice(""), 4000);
  }

  async function deleteBudget(id: string) {
    const response = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setImportNotice("Budget could not be deleted.");
      return;
    }
    await loadBudgets(budgetMonth);
    setImportNotice("Budget deleted.");
    window.setTimeout(() => setImportNotice(""), 4000);
  }

  async function refreshGoals() {
    setGoals(await fetchGoals());
  }

  async function saveGoal(input: {
    id?: string;
    expectedVersion?: number;
    name: string;
    targetAmount: number;
    currentAmount: number;
    targetDate: string | null;
  }) {
    const { id, ...body } = input;
    const response = await fetch(id ? `/api/goals/${id}` : "/api/goals", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const message = await getApiError(response, "Goal could not be saved.");
      if (response.status === 409) await refreshGoals();
      setImportNotice(message);
      throw new Error(message);
    }
    await refreshGoals();
    setImportNotice(id ? "Goal updated." : "Goal created.");
    window.setTimeout(() => setImportNotice(""), 4000);
  }

  async function updateGoal(
    id: string,
    update: { contribution: number; expectedVersion: number },
  ) {
    const response = await fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!response.ok) {
      const message = await getApiError(
        response,
        "Goal progress could not be updated.",
      );
      if (response.status === 409) await refreshGoals();
      setImportNotice(message);
      throw new Error(message);
    }
    await refreshGoals();
    setImportNotice("Goal progress updated.");
    window.setTimeout(() => setImportNotice(""), 4000);
  }

  async function deleteGoal(id: string) {
    const response = await fetch(`/api/goals/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setImportNotice("Goal could not be deleted.");
      return;
    }
    await refreshGoals();
    setImportNotice("Goal deleted.");
    window.setTimeout(() => setImportNotice(""), 4000);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${isMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <TrendingUp size={20} strokeWidth={2.5} />
          </div>
          <span>FinTrack</span>
          <button
            className="icon-button sidebar-close"
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <span className="nav-label">Workspace</span>
          {workspaceNavItems.map((item) => (
            <button
              className={
                activeNav === item.target ? "nav-item active" : "nav-item"
              }
              key={item.label}
              onClick={() => {
                setActiveNav(item.target);
                setIsMenuOpen(false);
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.label === "Transactions" && (
                <span className="nav-count">{transactions.length}</span>
              )}
            </button>
          ))}
          <span className="nav-label planning-label">Planning</span>
          {planningNavItems.map((item) => (
            <button
              className={
                activeNav === item.target ? "nav-item active" : "nav-item"
              }
              key={item.label}
              onClick={() => {
                setActiveNav(item.target);
                setIsMenuOpen(false);
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => {
              setAgentOpen(true);
              setIsMenuOpen(false);
            }}
          >
            <CircleHelp size={18} />
            <span>Help &amp; Support</span>
          </button>
          <button
            className={
              activeNav === "Settings" ? "nav-item active" : "nav-item"
            }
            onClick={() => {
              setActiveNav("Settings");
              setIsMenuOpen(false);
            }}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button
            className={
              activeNav === "Security" ? "nav-item active" : "nav-item"
            }
            onClick={() => {
              setActiveNav("Security");
              setIsMenuOpen(false);
            }}
          >
            <UserRound size={18} />
            <span>Profile &amp; security</span>
          </button>
          <div className="profile-block">
            <div className="profile-avatar"><span>{userInitials}</span>{authenticationEnabled && <UserButton />}</div>
            <div>
              <strong>{userName}</strong>
              <span>Personal plan</span>
            </div>
            {!authenticationEnabled && <MoreHorizontal size={18} />}
          </div>
        </div>
      </aside>
      {isMenuOpen && (
        <button
          className="menu-backdrop"
          onClick={() => setIsMenuOpen(false)}
          aria-label="Close menu"
        />
      )}

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setIsMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={21} />
          </button>
          <div className="mobile-brand">
            <div className="brand-mark">
              <TrendingUp size={18} />
            </div>
            <span>FinTrack</span>
          </div>
          <label className="search-box">
            <Search size={18} />
            <input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setActiveNav("Transactions");
              }}
              placeholder="Search transactions"
              aria-label="Search transactions"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <span className={`sync-status ${backendStatus}`}>
              <i />
              {backendStatus === "connected"
                ? "Database synced"
                : backendStatus === "local"
                  ? "Local mode"
                  : "Connecting"}
            </span>
            <button
              className="icon-button notification-button"
              onClick={() => setNotificationsOpen((open) => !open)}
              aria-label="Notifications"
            >
              <Bell size={19} />
              <span />
            </button>
            <button
              className="icon-button"
              onClick={() => setActiveNav("Settings")}
              aria-label="Open settings"
            >
              <Settings size={18} />
            </button>
            <div className="topbar-profile" aria-label={`Signed in as ${userName}`}>
              <span>{userInitials}</span>
              {authenticationEnabled && <UserButton />}
            </div>
          </div>
          {notificationsOpen && (
            <NotificationPanel onClose={() => setNotificationsOpen(false)} />
          )}
        </header>
        <div className="dashboard-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">{todayLabel}</p>
              <h1>
                {activeNav === "Overview"
                  ? `Good morning, ${userName.split(" ")[0]}.`
                  : activeNav === "Position"
                    ? "Financial position"
                    : activeNav}
              </h1>
              <p>
                {activeNav === "Overview"
                  ? "Here’s your financial snapshot for today."
                  : activeNav === "Position"
                    ? "Manage your assets, debts, and recurring bills."
                  : `Review and manage your ${activeNav.toLowerCase()}.`}
              </p>
            </div>
            {activeNav === "Overview" ? (
              <div className="heading-actions overview-actions">
                <label className="period-button overview-period">
                  <CalendarDays size={17} />
                  <input
                    type="month"
                    value={budgetMonth}
                    onChange={(event) => {
                      setBudgetLoading(true);
                      setBudgetMonth(event.target.value);
                    }}
                    aria-label={`Selected period: ${currentMonthLabel}`}
                  />
                </label>
                <button
                  className="primary-button"
                  onClick={() => {
                    setEditingTransaction(null);
                    setTransactionEditorOpen(true);
                  }}
                >
                  <Plus size={17} />
                  <span>Add transaction</span>
                </button>
              </div>
            ) : ![
              "Budgets",
              "Goals",
              "Position",
              "EMI",
              "Operations",
              "Household",
              "Settings",
              "Security",
              "Recently Deleted",
            ].includes(activeNav) ? (
              <div className="heading-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importTransactions(file);
                    event.target.value = "";
                  }}
                />
                <button
                  className="secondary-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp size={17} />
                  <span>Import</span>
                </button>
                <button
                  className="primary-button"
                  onClick={() => {
                    setEditingTransaction(null);
                    setTransactionEditorOpen(true);
                  }}
                >
                  <Plus size={17} />
                  <span>Add transaction</span>
                </button>
              </div>
            ) : null}
          </section>
          {importNotice && (
            <div
              className={
                importNotice.startsWith("Import failed")
                  ? "toast error"
                  : "toast"
              }
            >
              {importNotice.startsWith("Import failed") ? (
                <X size={17} />
              ) : (
                <Check size={17} />
              )}
              {importNotice}
            </div>
          )}
          {activeNav === "Transactions" ? (
            <>
              <div className="workspace-command-row">
                <button
                  className="secondary-button"
                  onClick={() => setTransferOpen(true)}
                >
                  <Repeat2 size={16} /> Transfer funds
                </button>
              </div>
              <TransactionWorkspace
                transactions={transactions}
                searchQuery={searchQuery}
                onSearch={setSearchQuery}
                onDelete={(id) => void deleteTransaction(id)}
                onEdit={(transaction) => {
                  setEditingTransaction(transaction);
                  setTransactionEditorOpen(true);
                }}
                onShowTrash={() => setActiveNav("Recently Deleted")}
              />
            </>
          ) : activeNav === "Recently Deleted" ? (
            <TransactionTrash onRestored={() => void refreshTransactions()} />
          ) : activeNav === "Budgets" ? (
            <BudgetWorkspace
              budgets={budgets}
              loading={budgetLoading}
              month={budgetMonth}
              availableCategories={[
                ...new Set(
                  transactions.map((transaction) => transaction.category),
                ),
              ]}
              onMonthChange={(month) => {
                setBudgetLoading(true);
                setBudgetMonth(month);
              }}
              onSave={saveBudget}
              onDelete={deleteBudget}
            />
          ) : activeNav === "Goals" ? (
            <GoalWorkspace
              goals={goals}
              loading={goalLoading}
              onSave={saveGoal}
              onUpdate={updateGoal}
              onDelete={deleteGoal}
            />
          ) : activeNav === "Position" ? (
            <FinancialPositionWorkspace />
          ) : activeNav === "EMI" ? (
            <FinancialPositionWorkspace view="emi" />
          ) : activeNav === "Operations" ? (
            <OperationsWorkspace />
          ) : activeNav === "Household" ? (
            <HouseholdWorkspace />
          ) : activeNav === "Settings" ? (
            <SettingsWorkspace />
          ) : activeNav === "Security" ? (
            <SecurityWorkspace authenticationEnabled={authenticationEnabled} />
          ) : (
            <>
              <section className="overview-hero-grid" aria-label="Financial summary">
                <article className="balance-hero">
                  <div className="plan-chip"><i />Monthly plan</div>
                  <span className="balance-label">Available balance</span>
                  <strong>{currency.format(netCashFlow)}</strong>
                  <div className="balance-comparison">
                    <span className={netCashFlowChange >= 0 ? "trend-badge positive" : "trend-badge negative"}>
                      {netCashFlowChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {Math.abs(netCashFlowChange)}%
                    </span>
                    <span>compared with last month</span>
                  </div>
                  <div className="budget-progress-row">
                    <div><span>Monthly budget used</span><strong>{budgetUsed}%</strong></div>
                    <div className="budget-track"><span style={{ width: `${budgetUsed}%` }} /></div>
                  </div>
                  <div className="balance-projection">
                    <div><span>Projected month-end</span><strong>{currency.format(projectedMonthEnd)}</strong></div>
                    <span>At current pace</span>
                  </div>
                </article>
                <div className="kpi-stack">
                  {[
                    { label: "Income", value: income, change: incomeChange, tone: "teal", path: "M2 31 C18 26 24 30 38 20 S64 13 78 17 S99 5 126 8" },
                    { label: "Spending", value: spending, change: spendingChange, tone: "coral", path: "M2 11 C20 15 27 7 43 18 S68 31 82 21 S104 27 126 29" },
                    { label: "Saved", value: savedThisMonth, change: savedChange, tone: "blue", path: "M2 30 C22 32 29 20 47 23 S71 12 88 15 S106 5 126 7" },
                  ].map((item) => (
                    <article className={`kpi-card ${item.tone}`} key={item.label}>
                      <div>
                        <span>{item.label}</span>
                        <strong>{currency.format(item.value)}</strong>
                        <small className={item.change >= 0 ? "positive" : "negative"}>
                          {item.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                          {Math.abs(item.change)}% vs last month
                        </small>
                      </div>
                      <svg className="kpi-spark" viewBox="0 0 128 38" aria-hidden="true">
                        <path d={item.path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </article>
                  ))}
                </div>
              </section>
              <WeeklyInsightCard />
              <div className="analytics-grid">
                <section className="chart-panel cashflow-panel">
                  <div className="section-header">
                    <div>
                      <h2>Cash flow</h2>
                      <p>Income and spending over time</p>
                    </div>
                    <button className="filter-button">
                      6 months <ChevronDown size={15} />
                    </button>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="income-dot" />
                      Income
                    </span>
                    <span>
                      <i className="spending-dot" />
                      Spending
                    </span>
                  </div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={cashFlowData}
                        margin={{ top: 10, right: 4, left: -24, bottom: 0 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="#e7e9ed"
                          strokeDasharray="3 3"
                        />
                        <XAxis
                          dataKey="month"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#667085" }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#667085" }}
                          tickFormatter={(value) =>
                            currency.format(Number(value))
                          }
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="income"
                          stroke="#129b91"
                          strokeWidth={2.5}
                          fill="transparent"
                          dot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="spending"
                          stroke="#f26b5e"
                          strokeWidth={2.5}
                          fill="transparent"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <section className="chart-panel category-panel">
                  <div className="section-header">
                    <div>
                      <h2>Spending by category</h2>
                      <p>Where your money went</p>
                    </div>
                  </div>
                  <div className="category-content">
                    {categoryData.length > 0 ? (
                      <>
                        <div className="donut-wrap">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={categoryData}
                                dataKey="value"
                                innerRadius={58}
                                outerRadius={78}
                                paddingAngle={2}
                                stroke="none"
                              >
                                {categoryData.map((entry) => (
                                  <Cell key={entry.name} fill={entry.color} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="donut-label">
                            <strong>{currency.format(spending)}</strong>
                            <span>total</span>
                          </div>
                        </div>
                        <div className="category-list">
                          {categoryData.slice(0, 4).map((category) => (
                            <div className="category-row" key={category.name}>
                              <div className="category-row-head">
                                <span>
                                  <i style={{ background: category.color }} />
                                  {category.name}
                                </span>
                                <strong>{currency.format(category.value)}</strong>
                              </div>
                              <div className="category-share">
                                <span style={{ width: `${spending ? Math.round((category.value / spending) * 100) : 0}%`, background: category.color }} />
                              </div>
                              <small>{spending ? Math.round((category.value / spending) * 100) : 0}% of spending</small>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="category-empty">
                        <span className="category-empty-icon">
                          <CircleDollarSign size={22} />
                        </span>
                        <strong>No spending categories yet</strong>
                        <p>
                          Add an expense to see your category breakdown.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
              <div className="dashboard-transactions">
                <section className="transactions-panel overview-transactions">
                  <div className="section-header">
                    <div>
                      <h2>Recent transactions</h2>
                      <p>Your latest account activity</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setActiveNav("Transactions")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="transaction-table" role="table" aria-label="Recent transactions">
                    <div className="transaction-table-head" role="row">
                      <span>Account</span><span>Type</span><span>Date</span><span>Amount</span>
                    </div>
                    {transactions.length ? transactions.slice(0, 5).map((transaction) => (
                      <article className="transaction-table-row" role="row" key={transaction.id}>
                        <div className={`transaction-icon ${transaction.type}`}>
                          <TransactionCategoryIcon transaction={transaction} />
                        </div>
                        <div className="transaction-main">
                          <strong>{transaction.merchant}</strong>
                          <span>{transaction.description}</span>
                        </div>
                        <div className="transaction-type-cell"><strong>{transaction.category}</strong><span>{transaction.paymentType}</span></div>
                        <span className="transaction-date-cell">{formatTransactionDate(transaction.date)}</span>
                        <div className="transaction-amount">
                          <strong className={transaction.type}>
                            {transaction.type === "income" ? "+" : "-"}
                            {currency.format(transaction.amount)}
                          </strong>
                        </div>
                      </article>
                    )) : <div className="transaction-table-empty"><ReceiptText size={22} /><strong>No transactions yet</strong><span>Add a transaction to start your ledger.</span></div>}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileNavItems.map((item) => (
          <button
            className={activeNav === item.target ? "active" : ""}
            key={item.label}
            onClick={() => setActiveNav(item.target)}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        ))}
        <button onClick={() => setAgentOpen(true)}>
          <Bot size={20} />
          <span>Analyst</span>
        </button>
      </nav>
      <button className="agent-launcher" onClick={() => setAgentOpen(true)}>
        <Sparkles size={17} />
        <span>Ask FinTrack</span>
      </button>
      <EphemeralAnalyst open={agentOpen} onClose={() => setAgentOpen(false)} />
      {transactionEditorOpen && (
        <TransactionEditor
          transaction={editingTransaction}
          accounts={accounts}
          onClose={() => {
            setTransactionEditorOpen(false);
            setEditingTransaction(null);
          }}
          onSaved={(saved) => {
            setTransactions((current) =>
              current.some((item) => item.id === saved.id)
                ? current.map((item) => (item.id === saved.id ? saved : item))
                : [saved, ...current],
            );
            window.dispatchEvent(new Event("fintrack:data-changed"));
          }}
        />
      )}
      {transferOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setTransferOpen(false)}
        >
          <section
            className="transaction-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Move money</span>
                <h2>Account transfer</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setTransferOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={createTransfer}>
              <div className="form-grid">
                <label className="form-field">
                  <span>From account</span>
                  <select name="fromAccountId" required>
                    {accounts.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>To account</span>
                  <select name="toAccountId" required>
                    {accounts.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="form-field">
                <span>Amount</span>
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <label className="form-field">
                <span>Date</span>
                <input
                  name="date"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                />
              </label>
              <label className="form-field">
                <span>Description</span>
                <input name="description" placeholder="Savings transfer" />
              </label>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setTransferOpen(false)}
                >
                  Cancel
                </button>
                <button className="primary-button">Create transfer</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
