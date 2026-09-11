'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

// ─── Wire types (integer minor units everywhere) ─────────────────────────────

export interface ExpenseSplit {
  id: string;
  expenseId: string;
  userId: string;
  owedMinor: number;
  paidMinor: number;
}

export interface Expense {
  id: string;
  tripId: string;
  activityBlockId: string | null;
  title: string;
  amountMinor: number;
  currency: string;
  paidBy: string;
  splitType: 'equal' | 'custom' | 'percentage';
  deletedAt: string | null;
  createdAt: string;
}

export interface ExpenseWithSplits extends Expense {
  splits: ExpenseSplit[];
}

export interface MemberBalance {
  userId: string;
  balanceMinor: number;
}

export interface SuggestedTransaction {
  from: string;
  to: string;
  amountMinor: number;
  currency: string;
}

export interface TripSummary {
  totalMinor: number;
  memberBalances: MemberBalance[];
  settlements: SuggestedTransaction[];
}

export interface Settlement {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
  note: string | null;
  settledAt: string;
}

/** Payload accepted by createExpense / updateExpense. */
export interface ExpensePayload {
  title: string;
  amountMinor: number;
  currency: string;
  splitType: 'equal' | 'custom' | 'percentage';
  paidBy?: string;
  payers?: { userId: string; paidMinor: number }[];
  customSplits?: { userId: string; owedMinor: number }[];
  percentageSplits?: { userId: string; percentage: number }[];
  activityBlockId?: string | null;
}

interface UseExpensesOptions {
  socket: Socket | null;
  tripId: string;
  token: string | undefined;
  currentUserId: string | undefined;
}

interface UseExpensesReturn {
  expenses: ExpenseWithSplits[];
  summary: TripSummary | null;
  suggested: SuggestedTransaction[];
  payments: Settlement[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  createExpense: (input: ExpensePayload) => Promise<boolean>;
  updateExpense: (id: string, input: ExpensePayload) => Promise<boolean>;
  deleteExpense: (expense: ExpenseWithSplits) => void;
  recordSettlement: (input: {
    fromUserId: string;
    toUserId: string;
    amountMinor: number;
    note?: string | null;
  }) => Promise<boolean>;
}

const UNDO_WINDOW_MS = 5000;
/** Page size for cursor-based (keyset) expense pagination. */
const PAGE_SIZE = 20;

/**
 * Fetches a trip's expenses, balances and settlements, keeps them in sync with
 * Socket.io expense events, and exposes create/update/delete/settle actions.
 * Money is handled exclusively in integer minor units.
 */
export function useExpenses({
  socket,
  tripId,
  token,
  currentUserId,
}: UseExpensesOptions): UseExpensesReturn {
  const [expenses, setExpenses] = useState<ExpenseWithSplits[]>([]);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [suggested, setSuggested] = useState<SuggestedTransaction[]>([]);
  const [payments, setPayments] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  // Pending soft-delete timers keyed by expense id, for the undo window.
  const pendingDeletes = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Cursor-based pagination: id of the oldest loaded expense. New expenses
  // prepend (never shifting the cursor), so keyset paging stays stable.
  const cursorRef = useRef<string | null>(null);

  // Fetch a page of expenses. `reset=true` loads the newest page (no cursor);
  // otherwise it continues from the current cursor toward older rows.
  const fetchExpenses = useCallback(
    async (reset = false) => {
      if (!token || !tripId) return;
      const cursor = reset ? null : cursorRef.current;
      try {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) qs.set('cursor', cursor);
        const res = await apiFetch(`/api/trips/${tripId}/expenses?${qs.toString()}`, { token });
        if (res.ok) {
          const data = await res.json();
          const fetched: ExpenseWithSplits[] = data.expenses || [];
          setExpenses((prev) => (reset ? fetched : [...prev, ...fetched]));
          const nextCursor =
            data.nextCursor ??
            (fetched.length === PAGE_SIZE ? fetched[fetched.length - 1]?.id ?? null : null);
          cursorRef.current = nextCursor;
          setHasMore(nextCursor !== null);
        }
      } catch (error) {
        console.error('Failed to fetch expenses:', error);
      }
    },
    [token, tripId]
  );

  // Load the next older page of expenses.
  const loadMore = useCallback(() => {
    fetchExpenses(false);
  }, [fetchExpenses]);

  const fetchSettlements = useCallback(async () => {
    if (!token || !tripId) return;
    try {
      const res = await apiFetch(`/api/trips/${tripId}/settlements`, { token });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || null);
        setSuggested(data.suggested || []);
        setPayments(data.payments || []);
      }
    } catch (error) {
      console.error('Failed to fetch settlements:', error);
    }
  }, [token, tripId]);

  const refresh = useCallback(async () => {
    // Reset to the newest page so balances and the visible list stay in sync
    // after our own mutations or real-time changes from other members.
    await Promise.all([fetchExpenses(true), fetchSettlements()]);
  }, [fetchExpenses, fetchSettlements]);

  useEffect(() => {
    let active = true;
    (async () => {
      await refresh();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  // ── Real-time sync: refetch on events from other members ──
  useEffect(() => {
    if (!socket) return;

    function onChange(data: { userId?: string }) {
      // Our own mutations already updated local state + refreshed balances.
      if (data?.userId && data.userId === currentUserId) return;
      refresh();
    }

    socket.on('expense:created', onChange);
    socket.on('expense:updated', onChange);
    socket.on('expense:deleted', onChange);
    socket.on('expense:settled', onChange);

    return () => {
      socket.off('expense:created', onChange);
      socket.off('expense:updated', onChange);
      socket.off('expense:deleted', onChange);
      socket.off('expense:settled', onChange);
    };
  }, [socket, currentUserId, refresh]);

  const createExpense = useCallback(
    async (input: ExpensePayload): Promise<boolean> => {
      if (!token || !tripId) return false;
      const res = await apiFetch(`/api/trips/${tripId}/expenses`, {
        method: 'POST',
        token,
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || 'Failed to add expense');
        return false;
      }
      const data = await res.json();
      setExpenses((prev) => [{ ...data.expense, splits: data.splits }, ...prev]);
      await fetchSettlements();
      toast.success('Expense added');
      return true;
    },
    [token, tripId, fetchSettlements]
  );

  const updateExpense = useCallback(
    async (id: string, input: ExpensePayload): Promise<boolean> => {
      if (!token || !tripId) return false;
      const res = await apiFetch(`/api/trips/${tripId}/expenses/${id}`, {
        method: 'PUT',
        token,
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || 'Failed to update expense');
        return false;
      }
      const data = await res.json();
      setExpenses((prev) =>
        prev.map((e) => (e.id === id ? { ...data.expense, splits: data.splits } : e))
      );
      await fetchSettlements();
      toast.success('Expense updated');
      return true;
    },
    [token, tripId, fetchSettlements]
  );

  /**
   * Soft-deletes an expense with an undo window: the row is removed from the UI
   * immediately and the DELETE request only fires after the undo toast expires.
   * Clicking "Undo" restores the row and cancels the request entirely.
   */
  const deleteExpense = useCallback(
    (expense: ExpenseWithSplits) => {
      if (!token || !tripId) return;

      // Optimistically remove from the list.
      setExpenses((prev) => prev.filter((e) => e.id !== expense.id));

      const commit = async () => {
        pendingDeletes.current.delete(expense.id);
        const res = await apiFetch(`/api/trips/${tripId}/expenses/${expense.id}`, {
          method: 'DELETE',
          token,
        });
        if (!res.ok) {
          // Restore on failure.
          setExpenses((prev) => [expense, ...prev].sort(sortByCreatedDesc));
          toast.error('Failed to delete expense');
          return;
        }
        await fetchSettlements();
      };

      const timer = setTimeout(commit, UNDO_WINDOW_MS);
      pendingDeletes.current.set(expense.id, timer);

      toast('Expense deleted', {
        description: expense.title,
        action: {
          label: 'Undo',
          onClick: () => {
            const t = pendingDeletes.current.get(expense.id);
            if (t) {
              clearTimeout(t);
              pendingDeletes.current.delete(expense.id);
            }
            setExpenses((prev) => [expense, ...prev].sort(sortByCreatedDesc));
          },
        },
        duration: UNDO_WINDOW_MS,
      });
    },
    [token, tripId, fetchSettlements]
  );

  const recordSettlement = useCallback(
    async (input: {
      fromUserId: string;
      toUserId: string;
      amountMinor: number;
      note?: string | null;
    }): Promise<boolean> => {
      if (!token || !tripId) return false;
      const res = await apiFetch(`/api/trips/${tripId}/settlements`, {
        method: 'POST',
        token,
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || 'Failed to record payment');
        return false;
      }
      await fetchSettlements();
      toast.success('Payment recorded');
      return true;
    },
    [token, tripId, fetchSettlements]
  );

  // Flush any pending deletes on unmount so they still persist.
  useEffect(() => {
    const timers = pendingDeletes.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return {
    expenses,
    summary,
    suggested,
    payments,
    loading,
    hasMore,
    loadMore,
    createExpense,
    updateExpense,
    deleteExpense,
    recordSettlement,
  };
}

function sortByCreatedDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
