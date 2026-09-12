'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useSocket } from '@/hooks/useSocket';
import { useVotes } from '@/hooks/useVotes';
import { PollCard, Poll } from '@/components/votes/PollCard';
import { CreatePollForm } from '@/components/votes/CreatePollForm';
import { ResolvePollModal } from '@/components/votes/ResolvePollModal';

export default function TripVotesPage() {
  const { data: session } = useSession();
  const params = useParams();
  const tripId = params.id as string;
  const token = (session as any)?.accessToken as string | undefined;
  const currentUserId = (session as any)?.user?.id as string | undefined;

  const { socket } = useSocket({ tripId, token });
  const {
    polls,
    tallies,
    userVotes,
    loading,
    createPoll,
    castVote,
    resolvePoll,
    deletePoll,
  } = useVotes({ socket, tripId, token, currentUserId });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [resolvingPoll, setResolvingPoll] = useState<Poll | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Fetch current user's trip role
  const fetchUserRole = useCallback(async () => {
    if (!token || !tripId || !currentUserId) return;
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_URL}/api/trips/${tripId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const me = (data.members || []).find((m: any) => m.userId === currentUserId);
        if (me) setUserRole(me.role);
      }
    } catch {
      // Silently fail
    }
  }, [token, tripId, currentUserId]);

  useEffect(() => {
    fetchUserRole();
  }, [fetchUserRole]);

  const isOwner = userRole === 'owner';

  const activePolls = polls.filter((p) => !p.isResolved);
  const resolvedPolls = polls.filter((p) => p.isResolved);

  async function handleCreatePoll(question: string, options: { title: string; description?: string }[]) {
    setIsCreating(true);
    await createPoll(question, options);
    setIsCreating(false);
    setShowCreateForm(false);
  }

  async function handleResolvePoll(winningOptionId: string) {
    if (!resolvingPoll) return;
    setIsResolving(true);
    await resolvePoll(resolvingPoll.id, winningOptionId);
    setIsResolving(false);
    setResolvingPoll(null);
  }

  function canResolvePoll(poll: Poll): boolean {
    if (!currentUserId) return false;
    // Owner or poll creator can resolve
    return poll.createdBy === currentUserId;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Votes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create polls and vote on activities with your group.
          </p>
        </div>
        {!loading && !showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Poll
          </button>
        )}
      </div>

      {/* Create Poll Form */}
      {showCreateForm && (
        <div className="mt-6">
          <CreatePollForm
            onSubmit={handleCreatePoll}
            onCancel={() => setShowCreateForm(false)}
            isSubmitting={isCreating}
          />
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="mt-8 space-y-4" aria-busy="true" aria-label="Loading polls">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-2xl border border-border bg-card p-5"
            >
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="mt-4 space-y-2">
                <div className="h-8 w-full rounded bg-muted" />
                <div className="h-8 w-full rounded bg-muted" />
                <div className="h-8 w-2/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Polls */}
      {!loading && activePolls.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Active Polls ({activePolls.length})
          </h3>
          <div className="mt-3 space-y-4">
            {activePolls.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                tallies={tallies[poll.id] || []}
                currentUserId={currentUserId || ''}
                userVoteOptionId={userVotes[poll.id] || null}
                onVote={(optionId) => castVote(poll.id, optionId)}
                onResolve={() => setResolvingPoll(poll)}
                onDelete={() => deletePoll(poll.id)}
                canResolve={canResolvePoll(poll)}
                canDelete={isOwner}
              />
            ))}
          </div>
        </section>
      )}

      {/* Resolved Polls */}
      {!loading && resolvedPolls.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Resolved Polls ({resolvedPolls.length})
          </h3>
          <div className="mt-3 space-y-4">
            {resolvedPolls.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                tallies={tallies[poll.id] || []}
                currentUserId={currentUserId || ''}
                userVoteOptionId={userVotes[poll.id] || null}
                onVote={() => {}}
                onResolve={() => {}}
                onDelete={() => deletePoll(poll.id)}
                canResolve={false}
                canDelete={isOwner}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {!loading && polls.length === 0 && !showCreateForm && (
        <div className="mt-8 rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center">
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
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <h3 className="mt-4 text-sm font-medium text-foreground">No polls yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a poll to let your group vote on activities, restaurants, or anything else.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition"
          >
            Create your first poll
          </button>
        </div>
      )}

      {/* Resolve Modal */}
      {resolvingPoll && (
        <ResolvePollModal
          poll={resolvingPoll}
          onResolve={handleResolvePoll}
          onClose={() => setResolvingPoll(null)}
          isSubmitting={isResolving}
        />
      )}
    </div>
  );
}
