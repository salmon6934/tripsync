'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { io, Socket } from 'socket.io-client';

import { isNotificationsMuted, useNotificationMute } from '@/lib/notification-mute';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface Notification {
  id: string;
  tripId: string;
  userId: string;
  type: 'block_created' | 'block_moved' | 'block_deleted' | 'member_joined';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Hook for managing in-app notifications.
 * Connects to user-specific Socket.io room and listens for real-time notifications.
 * Provides unread count, notification list, mark-as-read actions, and mute toggle.
 */
export function useNotifications() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // Mute preference is shared across every hook that raises popup toasts, so
  // muting here silences all of them (see lib/notification-mute).
  const { muted, toggleMute } = useNotificationMute();
  const socketRef = useRef<Socket | null>(null);

  // Fetch unread count from API
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count);
      }
    } catch (e) {
      // Silently fail
    }
  }, [token]);

  // Fetch notifications list
  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/notifications?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
      }
    } catch (e) {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Mark a single notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!token) return;
      try {
        await fetch(`${API_URL}/api/notifications/${notificationId}/read`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
        });
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (e) {
        // Silently fail
      }
    },
    [token]
  );

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    if (!token) return;
    try {
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (e) {
      // Silently fail
    }
  }, [token]);

  // Setup Socket.io listener for real-time notifications
  useEffect(() => {
    if (!token) return;

    // Create a dedicated socket connection for notifications (user room)
    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('notification:new', (notification: Notification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);

      // Show the popup only when not muted (read the latest value at fire time).
      if (!isNotificationsMuted()) {
        toast(notification.title, {
          description: notification.message,
          duration: 5000,
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  // Fetch initial data
  useEffect(() => {
    fetchUnreadCount();
    fetchNotifications();
  }, [fetchUnreadCount, fetchNotifications]);

  return {
    notifications,
    unreadCount,
    loading,
    muted,
    toggleMute,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
