'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownUp, Bell, BellOff, Plus, Trash2, UserPlus, type LucideIcon } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';

/**
 * Formats a date string into a relative time string (e.g., "2m ago", "1h ago").
 */
function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Lucide icon per notification type (rendered in the secondary theme color).
 */
const NOTIFICATION_ICONS: Record<Notification['type'], LucideIcon> = {
  block_created: Plus,
  block_moved: ArrowDownUp,
  block_deleted: Trash2,
  member_joined: UserPlus,
};

function NotificationIcon({ type }: { type: Notification['type'] }) {
  const Icon = NOTIFICATION_ICONS[type] ?? Bell;
  return <Icon className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />;
}

/**
 * NotificationBell component — bell icon with unread count badge and dropdown panel.
 * Shows recent notifications, allows marking as read, and navigating to relevant trips.
 */
export function NotificationBell() {
  const { notifications, unreadCount, loading, muted, toggleMute, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleNotificationClick(notification: Notification) {
    if (!notification.isRead) {
      markAsRead(notification.id);
    }
    setOpen(false);
    router.push(`/trip/${notification.tripId}`);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition"
        aria-label="Notifications"
      >
        {muted ? (
          <BellOff className="h-5 w-5 text-secondary" aria-hidden="true" />
        ) : (
          <Bell className="h-5 w-5 text-secondary" aria-hidden="true" />
        )}

        {/* Unread count badge */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-card shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs font-medium text-primary hover:text-primary-tint-foreground"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted transition ${
                    !notification.isRead ? 'bg-primary-tint/50' : ''
                  }`}
                >
                  {/* Icon */}
                  <NotificationIcon type={notification.type} />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${
                        !notification.isRead ? 'font-medium text-foreground' : 'text-foreground'
                      }`}
                    >
                      {notification.message}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {relativeTime(notification.createdAt)}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {!notification.isRead && (
                    <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer — Mute toggle */}
          <div className="border-t border-border px-4 py-2.5">
            <button
              onClick={toggleMute}
              className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {muted ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                  Unmute notifications
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  Mute notifications
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
