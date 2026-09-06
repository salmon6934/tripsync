'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { toast } from 'sonner';

import { isNotificationsMuted } from '@/lib/notification-mute';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PAGE_SIZE = 20;

export interface ActivityEntry {
  id: string;
  tripId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  userName: string;
  avatarId: number | null;
  description: string;
}

interface UseActivityFeedOptions {
  tripId: string;
  token: string | undefined;
  socket: Socket | null;
  currentUserId: string | undefined;
}

/**
 * Custom hook for the activity feed.
 * Fetches paginated activity entries, listens to socket events for real-time updates,
 * shows toasts for other users' actions, and tracks unread count via localStorage.
 */
export function useActivityFeed({ tripId, token, socket, currentUserId }: UseActivityFeedOptions) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const offsetRef = useRef(0);

  const lastSeenKey = `activity_feed_last_seen:${tripId}`;

  // Get last seen timestamp from localStorage
  const getLastSeen = useCallback((): number => {
    if (typeof window === 'undefined') return 0;
    const stored = localStorage.getItem(lastSeenKey);
    return stored ? parseInt(stored, 10) : 0;
  }, [lastSeenKey]);

  // Compute unread count based on last seen timestamp
  const computeUnread = useCallback(
    (entries: ActivityEntry[]) => {
      const lastSeen = getLastSeen();
      if (!lastSeen) {
        setUnreadCount(0);
        return;
      }
      const count = entries.filter(
        (e) => new Date(e.createdAt).getTime() > lastSeen
      ).length;
      setUnreadCount(count);
    },
    [getLastSeen]
  );

  // Mark activity feed as seen (updates localStorage + resets unread)
  const markAsSeen = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(lastSeenKey, String(Date.now()));
    setUnreadCount(0);
  }, [lastSeenKey]);

  // Fetch activity feed from API
  const fetchActivities = useCallback(
    async (offset = 0) => {
      if (!token || !tripId) return;
      setLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/trips/${tripId}/activity?limit=${PAGE_SIZE}&offset=${offset}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          const data = await res.json();
          const fetched: ActivityEntry[] = data.activities || [];
          if (offset === 0) {
            setActivities(fetched);
            computeUnread(fetched);
          } else {
            setActivities((prev) => {
              const merged = [...prev, ...fetched];
              computeUnread(merged);
              return merged;
            });
          }
          setHasMore(fetched.length === PAGE_SIZE);
          offsetRef.current = offset + fetched.length;
        }
      } catch {
        // Silently fail — activity feed is non-critical
      } finally {
        setLoading(false);
      }
    },
    [token, tripId, computeUnread]
  );

  // Load more (pagination)
  const loadMore = useCallback(() => {
    fetchActivities(offsetRef.current);
  }, [fetchActivities]);

  // Initial fetch
  useEffect(() => {
    offsetRef.current = 0;
    fetchActivities(0);
  }, [fetchActivities]);

  // Listen to the server-authoritative `activity:new` event for real-time
  // updates. The server sends a fully-formed entry (with userName + formatted
  // description) identical in shape to the REST feed, so it can be rendered
  // directly without reconstructing text from raw payloads.
  useEffect(() => {
    if (!socket) return;

    function handleActivity(entry: ActivityEntry) {
      if (!entry || !entry.id) return;

      // Prepend, de-duping by entry id (the actor also receives their own
      // broadcast, and reconnects can replay events).
      setActivities((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev;
        return [entry, ...prev];
      });

      // Count unread for other users' actions; only pop a toast when the user
      // hasn't muted notifications (muting suppresses the popup, not the count).
      if (entry.userId !== currentUserId) {
        if (!isNotificationsMuted()) {
          toast(entry.description, { duration: 4000 });
        }
        setUnreadCount((prev) => prev + 1);
      }
    }

    socket.on('activity:new', handleActivity);

    return () => {
      socket.off('activity:new', handleActivity);
    };
  }, [socket, currentUserId]);

  return {
    activities,
    unreadCount,
    loading,
    loadMore,
    hasMore,
    markAsSeen,
  };
}
