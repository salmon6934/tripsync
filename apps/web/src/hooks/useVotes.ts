'use client';

import { useEffect, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { Poll, Tally } from '@/components/votes/PollCard';
import { isNotificationsMuted } from '@/lib/notification-mute';

interface UseVotesOptions {
  socket: Socket | null;
  tripId: string;
  token: string | undefined;
  currentUserId: string | undefined;
}

interface UseVotesReturn {
  polls: Poll[];
  tallies: Record<string, Tally[]>;
  userVotes: Record<string, string>; // voteId -> optionId
  loading: boolean;
  createPoll: (question: string, options: { title: string; description?: string }[]) => Promise<void>;
  castVote: (voteId: string, optionId: string) => Promise<void>;
  resolvePoll: (voteId: string, winningOptionId: string) => Promise<void>;
  deletePoll: (voteId: string) => Promise<void>;
}

/**
 * Hook that fetches polls, listens to Socket.io vote events,
 * and manages state with real-time updates.
 */
export function useVotes({ socket, tripId, token, currentUserId }: UseVotesOptions): UseVotesReturn {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [tallies, setTallies] = useState<Record<string, Tally[]>>({});
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Fetch all polls and their tallies on mount
  const fetchPolls = useCallback(async () => {
    if (!token || !tripId) return;

    try {
      const res = await apiFetch(`/api/trips/${tripId}/votes`, { token });
      if (!res.ok) return;

      const data = await res.json();
      const fetchedPolls: Poll[] = data.votes || [];
      setPolls(fetchedPolls);

      // Fetch tallies for each poll
      const talliesMap: Record<string, Tally[]> = {};
      for (const poll of fetchedPolls) {
        try {
          const tallyRes = await apiFetch(`/api/votes/${poll.id}/tallies`, { token });
          if (tallyRes.ok) {
            const tallyData = await tallyRes.json();
            talliesMap[poll.id] = tallyData.tallies || [];
          }
        } catch {
          talliesMap[poll.id] = [];
        }
      }
      setTallies(talliesMap);

      // Determine which polls current user has voted on
      if (currentUserId && fetchedPolls.length > 0) {
        const votesMap: Record<string, string> = {};
        // We check tallies + responses on server side; for now we'll track locally
        setUserVotes(votesMap);
      }
    } catch (error) {
      console.error('Failed to fetch polls:', error);
    } finally {
      setLoading(false);
    }
  }, [token, tripId, currentUserId]);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls]);

  // Listen to real-time vote events
  useEffect(() => {
    if (!socket) return;

    function handleVoteCreated(data: { vote: Poll; options: any[]; userId: string }) {
      const newPoll: Poll = { ...data.vote, options: data.options };
      // Skip if already in state (e.g., creator added it optimistically)
      setPolls((prev) => {
        if (prev.some((p) => p.id === newPoll.id)) return prev;
        return [newPoll, ...prev];
      });
      setTallies((prev) => ({ ...prev, [newPoll.id]: [] }));
      if (data.userId !== currentUserId && !isNotificationsMuted()) {
        toast.info('New poll created', { description: newPoll.question });
      }
    }

    function handleVoteCast(data: { voteId: string; optionId: string; userId: string; tallies: Tally[] }) {
      setTallies((prev) => ({ ...prev, [data.voteId]: data.tallies }));
    }

    function handleVoteResolved(data: { voteId: string; winningOptionId: string; vote: any; userId: string }) {
      setPolls((prev) =>
        prev.map((p) =>
          p.id === data.voteId
            ? { ...p, isResolved: true, winningOptionId: data.winningOptionId }
            : p
        )
      );
      if (!isNotificationsMuted()) {
        toast.info('A poll has been resolved');
      }
    }

    socket.on('vote:created', handleVoteCreated);
    socket.on('vote:cast', handleVoteCast);
    socket.on('vote:resolved', handleVoteResolved);

    return () => {
      socket.off('vote:created', handleVoteCreated);
      socket.off('vote:cast', handleVoteCast);
      socket.off('vote:resolved', handleVoteResolved);
    };
  }, [socket]);

  // Create a new poll
  const createPoll = useCallback(
    async (question: string, options: { title: string; description?: string }[]) => {
      if (!token || !tripId) return;

      const res = await apiFetch(`/api/trips/${tripId}/votes`, {
        method: 'POST',
        token,
        body: JSON.stringify({ question, options }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.message || 'Failed to create poll');
        return;
      }

      const data = await res.json();
      const newPoll: Poll = { ...data.vote, options: data.options };
      setPolls((prev) => [newPoll, ...prev]);
      setTallies((prev) => ({ ...prev, [newPoll.id]: [] }));

      // Broadcast via socket
      socket?.emit('vote:create', { question, options });

      toast.success('Poll created');
    },
    [token, tripId, socket]
  );

  // Cast a vote
  const castVote = useCallback(
    async (voteId: string, optionId: string) => {
      if (!token) return;

      const res = await apiFetch(`/api/votes/${voteId}/respond`, {
        method: 'POST',
        token,
        body: JSON.stringify({ optionId }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.message || 'Failed to cast vote');
        return;
      }

      // Track user's vote locally
      setUserVotes((prev) => ({ ...prev, [voteId]: optionId }));

      // Fetch updated tallies
      const tallyRes = await apiFetch(`/api/votes/${voteId}/tallies`, { token });
      if (tallyRes.ok) {
        const tallyData = await tallyRes.json();
        const newTallies = tallyData.tallies || [];
        setTallies((prev) => ({ ...prev, [voteId]: newTallies }));

        // Broadcast via socket so other users get tallies
        socket?.emit('vote:cast', { voteId, optionId });
      }

      toast.success('Vote cast!');
    },
    [token, socket]
  );

  // Resolve a poll
  const resolvePoll = useCallback(
    async (voteId: string, winningOptionId: string) => {
      if (!token) return;

      const res = await apiFetch(`/api/votes/${voteId}/resolve`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ winningOptionId }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.message || 'Failed to resolve poll');
        return;
      }

      // Update local state
      setPolls((prev) =>
        prev.map((p) =>
          p.id === voteId ? { ...p, isResolved: true, winningOptionId } : p
        )
      );

      // Broadcast via socket
      socket?.emit('vote:resolve', { voteId, winningOptionId });

      toast.success('Poll resolved');
    },
    [token, socket]
  );

  // Delete a poll (owner only)
  const deletePoll = useCallback(
    async (voteId: string) => {
      if (!token || !tripId) return;

      const res = await apiFetch(`/api/trips/${tripId}/votes/${voteId}`, {
        method: 'DELETE',
        token,
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.message || 'Failed to delete poll');
        return;
      }

      // Remove from local state
      setPolls((prev) => prev.filter((p) => p.id !== voteId));
      setTallies((prev) => {
        const next = { ...prev };
        delete next[voteId];
        return next;
      });

      toast.success('Poll deleted');
    },
    [token, tripId]
  );

  return {
    polls,
    tallies,
    userVotes,
    loading,
    createPoll,
    castVote,
    resolvePoll,
    deletePoll,
  };
}
