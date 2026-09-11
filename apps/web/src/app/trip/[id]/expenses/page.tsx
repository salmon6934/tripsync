'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, useMemo } from 'react';

import { ExpenseCard } from '@/components/expenses/ExpenseCard';
import { ExpenseForm, type ExpenseMember, type LinkableBlock } from '@/components/expenses/ExpenseForm';
import { RecordPaymentModal, type PaymentDraft } from '@/components/expenses/RecordPaymentModal';
import { SettleUp } from '@/components/expenses/SettleUp';
import { useExpenses, type ExpenseWithSplits } from '@/hooks/useExpenses';
import { useSocket } from '@/hooks/useSocket';
import { formatMoney, formatSignedMoney } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Member {
  userId: string;
  role: string;
  userName: string;
}

export default function TripExpensesPage() {
  const { data: session } = useSession();
  const params = useParams();
  const tripId = params.id as string;
  const token = (session as any)?.accessToken as string | undefined;
  const currentUserId = (session as any)?.user?.id as string | undefined;

  const { socket } = useSocket({ tripId, token });
  const {
    expenses,
    summary,
    suggested,
    loading,
    hasMore,
    loadMore,
    createExpense,
    updateExpense,
    deleteExpense,
    recordSettlement,
  } = useExpenses({ socket, tripId, token, currentUserId });

  const [members, setMembers] = useState<Member[]>([]);
  const [blocks, setBlocks] = useState<LinkableBlock[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [view, setView] = useState<'expenses' | 'settle'>('expenses');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseWithSplits | null>(null);
  const [payment, setPayment] = useState<PaymentDraft | null>(null);

  // Fetch trip members (needed for split targets + payer names + role gating).
  const fetchMembers = useCallback(async () => {
    if (!token || !tripId) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list: Member[] = data.members || [];
        setMembers(list);
        const me = list.find((m) => m.userId === currentUserId);
        if (me) setUserRole(me.role);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId, currentUserId]);

  // Fetch blocks (flattened) for the "link to activity" selector + card labels.
  const fetchBlocks = useCallback(async () => {
    if (!token || !tripId) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/days`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const flat: LinkableBlock[] = (data.days || []).flatMap((d: any) =>
          (d.blocks || []).map((b: any) => ({ id: b.id, title: b.title }))
        );
        setBlocks(flat);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId]);

  useEffect(() => {
    fetchMembers();
    fetchBlocks();
  }, [fetchMembers, fetchBlocks]);

  const canManage = userRole === 'owner' || userRole === 'editor';

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.userId, m.userName);
    return map;
  }, [members]);

  const blockNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of blocks) map.set(b.id, b.title);
    return map;
  }, [blocks]);

  const formMembers: ExpenseMember[] = useMemo(
    () => members.map((m) => ({ userId: m.userId, name: m.userName })),
    [members]
  );

  // Trip currency: prefer the most recent expense's currency, default INR.
  const tripCurrency = useMemo(() => expenses[0]?.currency || 'INR', [expenses]);

  // The current user's net balance, derived from the summary. Memoized so it's
  // only recomputed when the balances (or the viewer) actually change.
  const myNet = useMemo(
    () => summary?.memberBalances.find((b) => b.userId === currentUserId)?.balanceMinor ?? 0,
    [summary, currentUserId]
  );

  const nameFor = (userId: string) =>
    userId === currentUserId ? 'You' : memberNames.get(userId) ?? 'Someone';

  async function handleSubmit(payload: Parameters<typeof createExpense>[0]): Promise<boolean> {
    if (editing) {
      return updateExpense(editing.id, payload);
    }
    return createExpense(payload);
  }

  function openCreate() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(expense: ExpenseWithSplits) {
    setEditing(expense);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-tint border-t-primary" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Expenses</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Track expenses and split costs with your trip members.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Expense
          </button>
        )}
      </div>

      {/* Running total banner */}
      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl bg-gradient-to-r from-primary to-primary-hover p-5 text-white shadow-sm">
        <div>
          <p className="eyebrow text-primary-tint">Trip total</p>
          <p className="stat-number text-2xl">
            {formatMoney(summary?.totalMinor ?? 0, tripCurrency)}
          </p>
        </div>
        <div>
          <p className="eyebrow text-primary-tint">Your net</p>
          <p className="stat-number text-2xl">{formatSignedMoney(myNet, tripCurrency)}</p>
          <p className="text-xs text-primary-tint">
            {myNet > 0 ? "you're owed" : myNet < 0 ? 'you owe' : 'all settled'}
          </p>
        </div>
      </div>

      {/* Segmented control */}
      <div className="mt-6 inline-flex rounded-lg border border-border bg-card p-1">
        <button
          onClick={() => setView('expenses')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            view === 'expenses' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Expenses ({expenses.length})
        </button>
        <button
          onClick={() => setView('settle')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            view === 'settle' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Settle Up ({suggested.length})
        </button>
      </div>

      {/* Expenses list */}
      {view === 'expenses' && (
        <div className="mt-4">
          {expenses.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center">
              <svg
                className="mx-auto h-12 w-12 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m3 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H10a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <h3 className="mt-4 text-sm font-medium text-foreground">No expenses yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your first expense to start splitting costs with the group.
              </p>
              {canManage && (
                <button
                  onClick={openCreate}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition"
                >
                  Add your first expense
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((expense) => (
                <ExpenseCard
                  key={expense.id}
                  expense={expense}
                  memberNames={memberNames}
                  blockNames={blockNames}
                  currentUserId={currentUserId}
                  canManage={canManage}
                  onEdit={() => openEdit(expense)}
                  onDelete={() => deleteExpense(expense)}
                />
              ))}

              {hasMore && (
                <div className="pt-2 text-center">
                  <button
                    onClick={loadMore}
                    className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
                  >
                    Load more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Settle up */}
      {view === 'settle' && (
        <div className="mt-4">
          <SettleUp
            summary={summary}
            suggested={suggested}
            currency={tripCurrency}
            currentUserId={currentUserId}
            memberNames={memberNames}
            canManage={canManage}
            onRecordPayment={(draft) => setPayment(draft)}
          />
        </div>
      )}

      {/* Create / edit form */}
      {showForm && (
        <ExpenseForm
          mode={editing ? 'edit' : 'create'}
          members={formMembers}
          blocks={blocks}
          currentUserId={currentUserId}
          initial={editing ?? undefined}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
      )}

      {/* Record payment */}
      {payment && (
        <RecordPaymentModal
          draft={payment}
          fromName={nameFor(payment.fromUserId)}
          toName={nameFor(payment.toUserId)}
          onRecord={recordSettlement}
          onClose={() => setPayment(null)}
        />
      )}
    </div>
  );
}
