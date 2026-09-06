'use client';

import { useEffect, useState, useRef } from 'react';
import { Socket } from 'socket.io-client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PresenceInfo {
  userId: string;
  userName: string;
  avatarId: number | null;
  editingBlockId: string | null;
  lastHeartbeat: string;
}

interface UsePresenceOptions {
  socket: Socket | null;
  tripId: string;
  currentUserId?: string;
}

interface UsePresenceReturn {
  onlineMembers: PresenceInfo[];
}

/**
 * Manages real-time presence state for a trip.
 * Listens for presence events and maintains the online member list.
 * Emits heartbeat every 25s to keep presence alive.
 */
export function usePresence({ socket, tripId, currentUserId }: UsePresenceOptions): UsePresenceReturn {
  const [onlineMembers, setOnlineMembers] = useState<PresenceInfo[]>([]);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen to presence events
  useEffect(() => {
    if (!socket) return;

    function handleOnlineList(members: PresenceInfo[]) {
      setOnlineMembers(members);
    }

    function handleJoin(data: { userId: string; userName: string; avatarId: number | null }) {
      setOnlineMembers((prev) => {
        if (prev.some((m) => m.userId === data.userId)) return prev;
        return [
          ...prev,
          {
            userId: data.userId,
            userName: data.userName,
            avatarId: data.avatarId,
            editingBlockId: null,
            lastHeartbeat: new Date().toISOString(),
          },
        ];
      });
    }

    function handleLeave(data: { userId: string }) {
      setOnlineMembers((prev) => prev.filter((m) => m.userId !== data.userId));
    }

    function handleEditing(data: { userId: string; blockId: string | null }) {
      setOnlineMembers((prev) =>
        prev.map((m) =>
          m.userId === data.userId ? { ...m, editingBlockId: data.blockId } : m
        )
      );
    }

    socket.on('presence:online-list', handleOnlineList);
    socket.on('presence:join', handleJoin);
    socket.on('presence:leave', handleLeave);
    socket.on('presence:editing', handleEditing);

    return () => {
      socket.off('presence:online-list', handleOnlineList);
      socket.off('presence:join', handleJoin);
      socket.off('presence:leave', handleLeave);
      socket.off('presence:editing', handleEditing);
    };
  }, [socket, currentUserId]);

  // Heartbeat — emit every 25s to keep presence alive
  useEffect(() => {
    if (!socket || !tripId) return;

    heartbeatRef.current = setInterval(() => {
      socket.emit('presence:heartbeat');
    }, 25000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [socket, tripId]);

  // Re-join presence when tab becomes visible again (browsers throttle timers in background tabs)
  useEffect(() => {
    if (!socket || !tripId) return;

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // Immediately refresh heartbeat (if key still exists in Redis)
        socket!.emit('presence:heartbeat');
        // Re-join in case the key expired while tab was in background
        socket!.emit('join:trip', tripId);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [socket, tripId]);

  return { onlineMembers };
}
