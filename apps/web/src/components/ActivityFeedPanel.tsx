'use client';

import { ActivityEntry } from '@/hooks/useActivityFeed';
import { Avatar } from '@/components/ui/avatar';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Warm avatar palette drawn from the semantic tokens (globals.css @theme).
const avatarColors = [
  'bg-primary',
  'bg-secondary',
  'bg-cat-travel',
  'bg-cat-stay',
  'bg-success',
  'bg-warning',
  'bg-primary-hover',
  'bg-secondary-hover',
];

function getAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

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

// ─── Props ───────────────────────────────────────────────────────────────────

interface ActivityFeedPanelProps {
  activities: ActivityEntry[];
  isOpen: boolean;
  loading: boolean;
  hasMore: boolean;
  onClose: () => void;
  onLoadMore: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Slide-in panel from the right showing the trip activity feed.
 * Displays recent actions with avatar, description, and relative timestamp.
 */
export function ActivityFeedPanel({
  activities,
  isOpen,
  loading,
  hasMore,
  onClose,
  onLoadMore,
}: ActivityFeedPanelProps) {
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-80 transform bg-card shadow-xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 className="text-lg font-semibold text-foreground">Activity</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
            aria-label="Close activity feed"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Activity list */}
        <div className="overflow-y-auto p-4" style={{ height: 'calc(100% - 65px)' }}>
          {activities.length === 0 && !loading ? (
            <p className="text-center text-sm text-muted-foreground">No activity yet</p>
          ) : (
            <div className="space-y-4">
              {activities.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white ${getAvatarColor(entry.userId)}`}
                  >
                    <Avatar avatarId={entry.avatarId} name={entry.userName} />
                  </div>

                  {/* Description + timestamp */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{entry.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {relativeTime(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load more button */}
          {hasMore && activities.length > 0 && (
            <div className="mt-4 text-center">
              <button
                onClick={onLoadMore}
                disabled={loading}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition"
              >
                {loading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}

          {/* Initial loading state */}
          {loading && activities.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">Loading...</div>
          )}
        </div>
      </div>
    </>
  );
}
