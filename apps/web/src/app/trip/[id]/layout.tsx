'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { ActivityFeedButton } from '@/components/ActivityFeedButton';
import { ActivityFeedPanel } from '@/components/ActivityFeedPanel';
import { Logo } from '@/components/Logo';
import { NotificationBell } from '@/components/NotificationBell';
import { UserMenu } from '@/components/UserMenu';
import { MembersPanel, MembersButton, MemberWithStatus } from '@/components/presence/OnlineAvatars';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { usePresence } from '@/hooks/usePresence';
import { useSocket } from '@/hooks/useSocket';
import { formatDateRange } from '@/lib/format';

const tabs = [
  { name: 'Itinerary', href: '' },
  { name: 'Map', href: '/map' },
  { name: 'Votes', href: '/votes' },
  { name: 'Expenses', href: '/expenses' },
  { name: 'Settings', href: '/settings' },
];

interface TripMember {
  id: string;
  userId: string;
  role: string;
  userName: string;
  userEmail: string;
  userAvatarUrl: string | null;
}

interface TripInfo {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverImageUrl: string | null;
  timezone: string | null;
  currency?: string;
}

interface MiniBlock {
  id: string;
  title: string;
  estimatedCost: number | null;
  currency: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const params = useParams();
  const pathname = usePathname();
  const tripId = params.id as string;
  const basePath = `/trip/${tripId}`;
  const token = (session as any)?.accessToken as string | undefined;
  const currentUserId = (session as any)?.user?.id as string | undefined;

  const [membersOpen, setMembersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [tripMembers, setTripMembers] = useState<TripMember[]>([]);
  const [trip, setTrip] = useState<TripInfo | null>(null);
  const [blocks, setBlocks] = useState<MiniBlock[]>([]);
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string>>({});

  const membersPanelKey = `members_panel_open:${tripId}`;
  const lastSeenKey = `member_last_seen:${tripId}`;

  // Restore members panel open state from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMembersOpen(localStorage.getItem(membersPanelKey) === '1');
    try {
      const stored = localStorage.getItem(lastSeenKey);
      if (stored) setLastSeenMap(JSON.parse(stored));
    } catch {
      /* ignore malformed */
    }
  }, [membersPanelKey, lastSeenKey]);

  const toggleMembers = useCallback(() => {
    setMembersOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(membersPanelKey, next ? '1' : '0');
      }
      return next;
    });
  }, [membersPanelKey]);

  // Socket connection for presence (shared across all tabs)
  const { socket } = useSocket({ tripId, token });

  // Online presence tracking
  const { onlineMembers } = usePresence({ socket, tripId, currentUserId });

  // Activity feed
  const { activities, unreadCount: activityUnread, loading: activityLoading, loadMore, hasMore, markAsSeen } =
    useActivityFeed({ tripId, token, socket, currentUserId });

  // Fetch all trip members from REST API
  const fetchMembers = useCallback(async () => {
    if (!token || !tripId) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTripMembers(data.members || []);
      }
    } catch {
      // Silently fail — members panel is non-critical
    }
  }, [token, tripId]);

  // Fetch trip details for the header info bar / cover banner
  const fetchTrip = useCallback(async () => {
    if (!token || !tripId) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTrip(data.trip);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId]);

  // Fetch blocks (flattened) for total-cost summary + editing-block title lookup
  const fetchBlocks = useCallback(async () => {
    if (!token || !tripId) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/days`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const flat: MiniBlock[] = (data.days || []).flatMap((d: any) =>
          (d.blocks || []).map((b: any) => ({
            id: b.id,
            title: b.title,
            estimatedCost: b.estimatedCost,
            currency: b.currency,
          }))
        );
        setBlocks(flat);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId]);

  useEffect(() => {
    fetchMembers();
    fetchTrip();
    fetchBlocks();
  }, [fetchMembers, fetchTrip, fetchBlocks]);

  // Keep header cost + editing titles roughly in sync with real-time block changes
  useEffect(() => {
    if (!socket) return;
    const refetch = () => fetchBlocks();
    const events = ['block:created', 'block:updated', 'block:moved', 'block:deleted'];
    events.forEach((e) => socket.on(e, refetch));
    return () => events.forEach((e) => socket.off(e, refetch));
  }, [socket, fetchBlocks]);

  // Track last-seen timestamps for members as they appear online
  const onlineMembersRef = useRef(onlineMembers);
  onlineMembersRef.current = onlineMembers;
  useEffect(() => {
    if (onlineMembers.length === 0) return;
    setLastSeenMap((prev) => {
      const next = { ...prev };
      const now = new Date().toISOString();
      for (const m of onlineMembers) next[m.userId] = now;
      if (typeof window !== 'undefined') {
        localStorage.setItem(lastSeenKey, JSON.stringify(next));
      }
      return next;
    });
  }, [onlineMembers, lastSeenKey]);

  // Lookups for merging presence + block titles
  const blockTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of blocks) map.set(b.id, b.title);
    return map;
  }, [blocks]);

  const totalCost = useMemo(
    () => blocks.reduce((sum, b) => sum + (b.estimatedCost || 0), 0),
    [blocks]
  );
  const tripCurrency = trip?.currency || blocks[0]?.currency || 'INR';

  // Merge trip members with online status + editing titles + last seen
  const onlineByUser = new Map(onlineMembers.map((m) => [m.userId, m]));
  const membersWithStatus: MemberWithStatus[] = tripMembers.map((m) => {
    const presence = onlineByUser.get(m.userId);
    const editingBlockTitle = presence?.editingBlockId
      ? blockTitleById.get(presence.editingBlockId) ?? null
      : null;
    return {
      userId: m.userId,
      userName: m.userName,
      avatarUrl: m.userAvatarUrl,
      role: m.role,
      isOnline: !!presence,
      isEditing: !!presence?.editingBlockId,
      editingBlockTitle,
      lastSeen: lastSeenMap[m.userId] ?? null,
    };
  });

  // Sort: online first, then alphabetical
  membersWithStatus.sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.userName.localeCompare(b.userName);
  });

  const onlineCount = membersWithStatus.filter((m) => m.isOnline).length;

  // Active section label, surfaced as the Logo subtitle (Wayfarer pattern).
  const activeTab = tabs.find((tab) =>
    tab.href === ''
      ? pathname === basePath || pathname === `${basePath}/itinerary`
      : pathname.startsWith(`${basePath}${tab.href}`)
  );
  const sectionLabel = activeTab?.name ?? 'Trip';

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition"
              title="Back to dashboard"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <Logo href="/dashboard" size={32} subtitle={sectionLabel} />
          </div>
          <div className="flex items-center gap-3">
            <ActivityFeedButton
              unreadCount={activityUnread}
              onClick={() => {
                setActivityOpen((prev) => {
                  if (!prev) markAsSeen();
                  return !prev;
                });
              }}
            />
            <MembersButton onlineCount={onlineCount} onClick={toggleMembers} />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Trip Info Bar (with optional cover image hero) */}
      {trip && (
        <div className="border-b border-border bg-card">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {trip.coverImageUrl && (
              <div
                className="relative -mx-4 mb-4 h-40 overflow-hidden sm:-mx-6 sm:h-48 lg:-mx-8"
                aria-hidden="true"
              >
                <img
                  src={trip.coverImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-foreground/10" />
                <div className="absolute bottom-4 left-4 sm:left-6 lg:left-8">
                  <h1 className="text-2xl font-bold text-white drop-shadow">{trip.title}</h1>
                  <p className="text-sm text-white/90 drop-shadow">{trip.destination}</p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
              {!trip.coverImageUrl && (
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <span aria-hidden="true">📍</span>
                  {trip.destination}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatDateRange(trip.startDate, trip.endDate)}
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {tripMembers.length} {tripMembers.length === 1 ? 'member' : 'members'}
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Est. total {tripCurrency} {totalCost.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page content — extra bottom padding leaves room for the fixed bottom nav. */}
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-8 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Bottom Tab Navigation — pinned to the viewport bottom inside the trip. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-[0_-2px_10px_-4px_rgb(64_45_30_/_0.15)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="-mt-px flex justify-center gap-4 overflow-x-auto sm:gap-10">
            {tabs.map((tab) => {
              const tabHref = `${basePath}${tab.href}`;
              const isActive =
                tab.href === ''
                  ? pathname === basePath || pathname === `${basePath}/itinerary`
                  : pathname.startsWith(tabHref);

              return (
                <Link
                  key={tab.name}
                  href={tab.href === '' ? basePath : tabHref}
                  className={`whitespace-nowrap border-t-2 px-2 py-4 text-sm font-medium transition ${
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {tab.name}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Members slide-in panel (visible across all tabs) */}
      <MembersPanel
        members={membersWithStatus}
        isOpen={membersOpen}
        onClose={toggleMembers}
      />

      {/* Activity feed slide-in panel (visible across all tabs) */}
      <ActivityFeedPanel
        activities={activities}
        isOpen={activityOpen}
        loading={activityLoading}
        hasMore={hasMore}
        onClose={() => setActivityOpen(false)}
        onLoadMore={loadMore}
      />
    </div>
  );
}
