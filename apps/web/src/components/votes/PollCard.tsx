'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';

export interface PollOption {
  id: string;
  voteId: string;
  title: string;
  description: string | null;
  link: string | null;
  imageUrl: string | null;
}

export interface Poll {
  id: string;
  tripId: string;
  question: string;
  createdBy: string;
  isResolved: boolean;
  winningOptionId: string | null;
  createdAt: string;
  options: PollOption[];
}

export interface Tally {
  optionId: string;
  count: number;
}

interface PollCardProps {
  poll: Poll;
  tallies: Tally[];
  currentUserId: string;
  userVoteOptionId: string | null;
  onVote: (optionId: string) => void;
  onResolve: () => void;
  onDelete?: () => void;
  canResolve: boolean;
  canDelete: boolean;
}

function PollCardComponent({
  poll,
  tallies,
  currentUserId,
  userVoteOptionId,
  onVote,
  onResolve,
  onDelete,
  canResolve,
  canDelete,
}: PollCardProps) {
  const totalVotes = tallies.reduce((sum, t) => sum + t.count, 0);
  const hasVoted = userVoteOptionId !== null;

  function getTallyCount(optionId: string): number {
    return tallies.find((t) => t.optionId === optionId)?.count ?? 0;
  }

  function getPercentage(optionId: string): number {
    if (totalVotes === 0) return 0;
    return Math.round((getTallyCount(optionId) / totalVotes) * 100);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-foreground">{poll.question}</h3>
        {poll.isResolved && (
          <span className="inline-flex items-center rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-medium text-success-tint-foreground">
            Resolved
          </span>
        )}
      </div>

      {/* Options with tally bars */}
      <div className="mt-4 space-y-3">
        {poll.options.map((option) => {
          const percentage = getPercentage(option.id);
          const isWinner = poll.winningOptionId === option.id;
          const isUserVote = userVoteOptionId === option.id;
          const canClick = !poll.isResolved && !hasVoted;

          return (
            <button
              key={option.id}
              onClick={() => canClick && onVote(option.id)}
              disabled={!canClick}
              className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition ${
                isWinner
                  ? 'border-success bg-success-tint'
                  : isUserVote
                    ? 'border-primary bg-primary-tint'
                    : canClick
                      ? 'border-border hover:border-primary hover:bg-primary-tint/50'
                      : 'border-border bg-muted'
              }`}
              aria-label={`Vote for ${option.title}`}
            >
              {/* Animated tally bar background */}
              <motion.div
                className={`absolute inset-y-0 left-0 ${
                  isWinner ? 'bg-success-tint/60' : 'bg-primary-tint/60'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />

              {/* Content */}
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {option.title}
                  </span>
                  {isUserVote && (
                    <span className="text-xs text-primary font-medium">
                      (Your vote)
                    </span>
                  )}
                  {isWinner && (
                    <span className="text-xs text-success-tint-foreground font-medium">
                      ★ Winner
                    </span>
                  )}
                </div>
                {(hasVoted || poll.isResolved) && (
                  <span className="text-sm text-muted-foreground">
                    {getTallyCount(option.id)} ({percentage}%)
                  </span>
                )}
              </div>

              {option.description && (
                <p className="relative mt-1 text-xs text-muted-foreground">
                  {option.description}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </span>

        <div className="flex items-center gap-2">
          {canDelete && (
            <button
              onClick={onDelete}
              className="rounded-md border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-tint transition"
              title="Delete poll"
            >
              Delete
            </button>
          )}
          {canResolve && !poll.isResolved && (
            <button
              onClick={onResolve}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover transition"
            >
              Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoized: on a votes page with several polls, a live tally update to one poll
// shouldn't re-render the others.
export const PollCard = memo(PollCardComponent);
