'use client';

import { useMemo, useState } from 'react';

import { FloatingInput } from '@/components/ui/floating-input';
import type { ExpensePayload, ExpenseWithSplits } from '@/hooks/useExpenses';
import {
  formatMoney,
  parseMoneyToMinor,
  toMajorString,
  currencyDecimals,
} from '@/lib/format';

export interface ExpenseMember {
  userId: string;
  name: string;
}

export interface LinkableBlock {
  id: string;
  title: string;
}

type SplitType = 'equal' | 'custom' | 'percentage';

interface ExpenseFormProps {
  mode?: 'create' | 'edit';
  members: ExpenseMember[];
  blocks: LinkableBlock[];
  currentUserId: string | undefined;
  /** Existing expense for edit mode (pre-fills the form). */
  initial?: ExpenseWithSplits;
  onSubmit: (payload: ExpensePayload) => Promise<boolean>;
  onClose: () => void;
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY'];

/**
 * Modal form for creating and editing expenses. Handles single/multi payer
 * selection and all three split types (equal / custom / percentage) with live
 * running-sum validation. All money is converted to integer minor units before
 * submission.
 */
export function ExpenseForm({
  mode = 'create',
  members,
  blocks,
  currentUserId,
  initial,
  onSubmit,
  onClose,
}: ExpenseFormProps) {
  const isEdit = mode === 'edit';

  // ── Derive initial values from an existing expense (edit mode) ──
  const initialPaidByAmounts = useMemo(() => {
    const map: Record<string, string> = {};
    if (initial) {
      for (const s of initial.splits) {
        if (s.paidMinor > 0) map[s.userId] = toMajorString(s.paidMinor, initial.currency);
      }
    }
    return map;
  }, [initial]);

  const initialOwedAmounts = useMemo(() => {
    const map: Record<string, string> = {};
    if (initial) {
      for (const s of initial.splits) {
        map[s.userId] = toMajorString(s.owedMinor, initial.currency);
      }
    }
    return map;
  }, [initial]);

  const initialPercentages = useMemo(() => {
    const map: Record<string, string> = {};
    if (initial && initial.amountMinor > 0) {
      for (const s of initial.splits) {
        map[s.userId] = ((s.owedMinor / initial.amountMinor) * 100).toFixed(2);
      }
    }
    return map;
  }, [initial]);

  const initialPayerCount = initial
    ? initial.splits.filter((s) => s.paidMinor > 0).length
    : 0;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'INR');
  const [amount, setAmount] = useState(
    initial ? toMajorString(initial.amountMinor, initial.currency) : ''
  );
  const [splitType, setSplitType] = useState<SplitType>(initial?.splitType ?? 'equal');
  const [linkedBlockId, setLinkedBlockId] = useState(initial?.activityBlockId ?? '');

  const [multiPayer, setMultiPayer] = useState(initialPayerCount > 1);
  const [singlePayerId, setSinglePayerId] = useState(
    initial?.paidBy ?? currentUserId ?? members[0]?.userId ?? ''
  );
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(
    initialPaidByAmounts
  );

  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(
    initialOwedAmounts
  );
  const [percentages, setPercentages] = useState<Record<string, string>>(
    initialPercentages
  );

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const amountMinor = parseMoneyToMinor(amount, currency);
  const decimals = currencyDecimals(currency);

  // ── Derived validation state ──
  const payerSumMinor = useMemo(() => {
    return members.reduce((sum, m) => {
      const v = parseMoneyToMinor(payerAmounts[m.userId] ?? '', currency);
      return sum + (v ?? 0);
    }, 0);
  }, [payerAmounts, members, currency]);

  const customSumMinor = useMemo(() => {
    return members.reduce((sum, m) => {
      const v = parseMoneyToMinor(customAmounts[m.userId] ?? '', currency);
      return sum + (v ?? 0);
    }, 0);
  }, [customAmounts, members, currency]);

  const percentageSum = useMemo(() => {
    return members.reduce((sum, m) => {
      const v = Number(percentages[m.userId] ?? '');
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  }, [percentages, members]);

  const equalPerPersonMinor =
    amountMinor != null && members.length > 0
      ? Math.floor(amountMinor / members.length)
      : 0;

  const payersBalanced = amountMinor != null && payerSumMinor === amountMinor;
  const customBalanced = amountMinor != null && customSumMinor === amountMinor;
  const percentageBalanced = Math.abs(percentageSum - 100) < 0.01;

  function updateMap(
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    userId: string,
    value: string
  ) {
    setter((prev) => ({ ...prev, [userId]: value }));
  }

  function validate(): string | null {
    if (!title.trim()) return 'Title is required';
    if (amountMinor == null || amountMinor <= 0) return 'Enter a valid amount';

    if (multiPayer) {
      if (!payersBalanced) return 'Payer amounts must sum to the total';
    } else if (!singlePayerId) {
      return 'Select who paid';
    }

    if (splitType === 'custom' && !customBalanced) {
      return 'Custom split must sum to the total';
    }
    if (splitType === 'percentage' && !percentageBalanced) {
      return 'Percentages must sum to 100';
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (amountMinor == null) return;

    const payload: ExpensePayload = {
      title: title.trim(),
      amountMinor,
      currency,
      splitType,
      activityBlockId: linkedBlockId || null,
    };

    // Payer(s)
    if (multiPayer) {
      payload.payers = members
        .map((m) => ({
          userId: m.userId,
          paidMinor: parseMoneyToMinor(payerAmounts[m.userId] ?? '', currency) ?? 0,
        }))
        .filter((p) => p.paidMinor > 0);
    } else {
      payload.paidBy = singlePayerId;
    }

    // Split shares
    if (splitType === 'custom') {
      payload.customSplits = members.map((m) => ({
        userId: m.userId,
        owedMinor: parseMoneyToMinor(customAmounts[m.userId] ?? '', currency) ?? 0,
      }));
    } else if (splitType === 'percentage') {
      payload.percentageSplits = members.map((m) => ({
        userId: m.userId,
        percentage: Number(percentages[m.userId] ?? '') || 0,
      }));
    }

    setError('');
    setSubmitting(true);
    const ok = await onSubmit(payload);
    setSubmitting(false);
    if (ok) onClose();
  }

  function splitButtonClass(active: boolean): string {
    return `flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
      active
        ? 'bg-primary text-white'
        : 'bg-muted text-foreground hover:bg-muted'
    }`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          {isEdit ? 'Edit Expense' : 'Add Expense'}
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-danger-tint p-3 text-sm text-danger">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <FloatingInput
            id="expense-title"
            label="Title *"
            size="sm"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Dinner at the beach shack"
            maxLength={200}
          />

          {/* Amount + currency */}
          <div className="grid grid-cols-3 items-end gap-3">
            <div className="col-span-2">
              <FloatingInput
                id="expense-amount"
                label="Amount *"
                size="sm"
                type="number"
                step={decimals > 0 ? '0.01' : '1'}
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="expense-currency" className="block text-sm font-medium text-foreground">
                Currency
              </label>
              <select
                id="expense-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Linked block */}
          <div>
            <label htmlFor="expense-block" className="block text-sm font-medium text-foreground">
              Link to activity (optional)
            </label>
            <select
              id="expense-block"
              value={linkedBlockId}
              onChange={(e) => setLinkedBlockId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">— None —</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>

          {/* Payer selection */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">Paid by</label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={multiPayer}
                  onChange={(e) => setMultiPayer(e.target.checked)}
                  className="h-3.5 w-3.5 rounded text-primary focus:ring-primary"
                />
                Multiple payers
              </label>
            </div>

            {!multiPayer ? (
              <select
                value={singlePayerId}
                onChange={(e) => setSinglePayerId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                    {m.userId === currentUserId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 space-y-2">
                {members.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm text-foreground">
                      {m.name}
                      {m.userId === currentUserId ? ' (you)' : ''}
                    </span>
                    <input
                      type="number"
                      step={decimals > 0 ? '0.01' : '1'}
                      min="0"
                      value={payerAmounts[m.userId] ?? ''}
                      onChange={(e) => updateMap(setPayerAmounts, m.userId, e.target.value)}
                      placeholder="0"
                      className="w-28 rounded-md border border-border px-2 py-1.5 text-right text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
                <p
                  className={`text-xs ${
                    payersBalanced ? 'text-success' : 'text-warning'
                  }`}
                >
                  Paid so far: {formatMoney(payerSumMinor, currency)}
                  {amountMinor != null && ` of ${formatMoney(amountMinor, currency)}`}
                  {amountMinor != null &&
                    !payersBalanced &&
                    ` (${formatMoney(amountMinor - payerSumMinor, currency)} left)`}
                </p>
              </div>
            )}
          </div>

          {/* Split type toggle */}
          <div>
            <label className="block text-sm font-medium text-foreground">Split</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setSplitType('equal')}
                className={splitButtonClass(splitType === 'equal')}
              >
                Equal
              </button>
              <button
                type="button"
                onClick={() => setSplitType('custom')}
                className={splitButtonClass(splitType === 'custom')}
              >
                Custom
              </button>
              <button
                type="button"
                onClick={() => setSplitType('percentage')}
                className={splitButtonClass(splitType === 'percentage')}
              >
                Percentage
              </button>
            </div>
          </div>

          {/* Split details */}
          {splitType === 'equal' && (
            <div className="rounded-lg bg-muted p-3 text-sm text-foreground">
              Split equally among <span className="font-medium">{members.length}</span>{' '}
              {members.length === 1 ? 'member' : 'members'}
              {amountMinor != null && members.length > 0 && (
                <>
                  {' · ~'}
                  <span className="font-medium">
                    {formatMoney(equalPerPersonMinor, currency)}
                  </span>{' '}
                  each
                </>
              )}
            </div>
          )}

          {splitType === 'custom' && (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm text-foreground">
                    {m.name}
                    {m.userId === currentUserId ? ' (you)' : ''}
                  </span>
                  <input
                    type="number"
                    step={decimals > 0 ? '0.01' : '1'}
                    min="0"
                    value={customAmounts[m.userId] ?? ''}
                    onChange={(e) => updateMap(setCustomAmounts, m.userId, e.target.value)}
                    placeholder="0"
                    className="w-28 rounded-md border border-border px-2 py-1.5 text-right text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              ))}
              <p className={`text-xs ${customBalanced ? 'text-success' : 'text-warning'}`}>
                Assigned: {formatMoney(customSumMinor, currency)}
                {amountMinor != null && ` of ${formatMoney(amountMinor, currency)}`}
                {amountMinor != null &&
                  !customBalanced &&
                  ` (${formatMoney(amountMinor - customSumMinor, currency)} left)`}
              </p>
            </div>
          )}

          {splitType === 'percentage' && (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm text-foreground">
                    {m.name}
                    {m.userId === currentUserId ? ' (you)' : ''}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={percentages[m.userId] ?? ''}
                      onChange={(e) => updateMap(setPercentages, m.userId, e.target.value)}
                      placeholder="0"
                      className="w-20 rounded-md border border-border px-2 py-1.5 text-right text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
              <p
                className={`text-xs ${
                  percentageBalanced ? 'text-success' : 'text-warning'
                }`}
              >
                Total: {percentageSum.toFixed(2)}% of 100%
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
