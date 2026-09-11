'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
  closestCorners,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { DayColumn } from './DayColumn';
import { AddActivityModal, ActivityFormValues } from './AddActivityModal';
import { DaySelectorModal } from './DaySelectorModal';
import { ConflictDialog, ConflictData } from './ConflictDialog';
import type { BlockData, MemberInfo } from './SortableBlock';
import { useSocket } from '../../hooks/useSocket';
import { useTripSync } from '../../hooks/useTripSync';
import type { ActivityCategory } from '@tripsync/shared';
import { Bed, MapPinned, Navigation2, Utensils, type LucideIcon } from 'lucide-react';
import { timezoneAbbreviation } from '@/lib/format';

interface DayData {
  id: string;
  tripId: string;
  date: string;
  dayNumber: number;
  blocks: BlockData[];
}

const CATEGORIES: { key: ActivityCategory; label: string; icon: LucideIcon }[] = [
  { key: 'food', label: 'Food', icon: Utensils },
  { key: 'travel', label: 'Travel', icon: Navigation2 },
  { key: 'stay', label: 'Stay', icon: Bed },
  { key: 'activity', label: 'Activity', icon: MapPinned },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function ItineraryBoard() {
  const { data: session } = useSession();
  const params = useParams();
  const tripId = params.id as string;
  const token = (session as any)?.accessToken as string | undefined;
  const currentUserId = session?.user?.id as string | undefined;

  const [days, setDays] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addModalDayId, setAddModalDayId] = useState<string | null>(null);

  // Members (for attribution, role gating)
  const [members, setMembers] = useState<Map<string, MemberInfo>>(new Map());
  const [memberCount, setMemberCount] = useState(0);
  const [role, setRole] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);

  // Toolbar / view state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<ActivityCategory>>(new Set());
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [editState, setEditState] = useState<{ block: BlockData; baseUpdatedAt: string } | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<BlockData | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictData | null>(null);

  // Soft-delete + editing presence
  const [hiddenBlockIds, setHiddenBlockIds] = useState<Set<string>>(new Set());
  const [editingByUser, setEditingByUser] = useState<Map<string, string | null>>(new Map());

  const canEdit = role === 'owner' || role === 'editor';
  const tzAbbrev = useMemo(() => timezoneAbbreviation(timezone), [timezone]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // ─── Data fetching ───────────────────────────────────────────────────────

  const fetchDays = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/days`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch itinerary');
      const data = await res.json();
      setDays(data.days);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load itinerary');
    } finally {
      setLoading(false);
    }
  }, [token, tripId]);

  const fetchMembers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const map = new Map<string, MemberInfo>();
        for (const m of data.members || []) {
          map.set(m.userId, { name: m.userName, avatarId: m.userAvatarId });
          if (m.userId === currentUserId) setRole(m.role);
        }
        setMembers(map);
        setMemberCount((data.members || []).length);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId, currentUserId]);

  const fetchTrip = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTimezone(data.trip?.timezone ?? null);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId]);

  useEffect(() => {
    fetchDays();
    fetchMembers();
    fetchTrip();
  }, [fetchDays, fetchMembers, fetchTrip]);

  /**
   * Deep link support for `?block=<id>` (used by the map's "Go to Itinerary"
   * link): once the days have loaded, expand the target block and scroll it
   * into view. Runs once per block id so it doesn't fight the user afterwards.
   */
  const [deepLinkBlockId, setDeepLinkBlockId] = useState<string | null>(null);
  useEffect(() => {
    // Read from `location` rather than `useSearchParams` so this client
    // component doesn't need a Suspense boundary at build time.
    setDeepLinkBlockId(new URLSearchParams(window.location.search).get('block'));
  }, []);

  const handledDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkBlockId || loading) return;
    if (handledDeepLinkRef.current === deepLinkBlockId) return;

    const exists = days.some((day) => day.blocks.some((b) => b.id === deepLinkBlockId));
    if (!exists) return;

    handledDeepLinkRef.current = deepLinkBlockId;
    setExpandedBlockId(deepLinkBlockId);
    // Wait a frame so the expanded card is laid out before scrolling.
    requestAnimationFrame(() => {
      document
        .getElementById(`block-${deepLinkBlockId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
  }, [deepLinkBlockId, loading, days]);

  // Socket connection with auto-reconnect + resync
  const { socket, status } = useSocket({ tripId, token, onReconnect: fetchDays });

  const { createBlock, moveBlock, deleteBlock, saveEdit, forceUpdate, applyServerBlock, duplicateBlock } =
    useTripSync({ socket, days, setDays });

  // ─── Presence editing (block locks) ──────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    function handleOnlineList(list: { userId: string; editingBlockId: string | null }[]) {
      setEditingByUser(new Map(list.map((m) => [m.userId, m.editingBlockId])));
    }
    function handleEditing(data: { userId: string; blockId: string | null }) {
      setEditingByUser((prev) => {
        const next = new Map(prev);
        next.set(data.userId, data.blockId);
        return next;
      });
    }
    function handleLeave(data: { userId: string }) {
      setEditingByUser((prev) => {
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });
    }

    socket.on('presence:online-list', handleOnlineList);
    socket.on('presence:editing', handleEditing);
    socket.on('presence:leave', handleLeave);
    return () => {
      socket.off('presence:online-list', handleOnlineList);
      socket.off('presence:editing', handleEditing);
      socket.off('presence:leave', handleLeave);
    };
  }, [socket]);

  // Map of blockId -> name of *another* user editing it
  const lockedByBlock = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, blockId] of editingByUser.entries()) {
      if (!blockId || userId === currentUserId) continue;
      map.set(blockId, members.get(userId)?.name ?? 'Someone');
    }
    return map;
  }, [editingByUser, members, currentUserId]);

  const setMyEditing = useCallback(
    (blockId: string | null) => {
      socket?.emit('presence:editing', { blockId });
    },
    [socket]
  );

  // ─── Derived data ────────────────────────────────────────────────────────

  const displayDays = useMemo(
    () =>
      days.map((d) => ({
        ...d,
        blocks: d.blocks.filter((b) => !hiddenBlockIds.has(b.id)),
      })),
    [days, hiddenBlockIds]
  );

  const isMatch = useCallback(
    (block: BlockData): boolean => {
      const catOk = activeCategories.size === 0 || activeCategories.has(block.category);
      const q = searchQuery.trim().toLowerCase();
      const textOk =
        !q ||
        block.title.toLowerCase().includes(q) ||
        (block.locationName || '').toLowerCase().includes(q);
      return catOk && textOk;
    },
    [activeCategories, searchQuery]
  );

  const stats = useMemo(() => {
    const allBlocks = displayDays.flatMap((d) => d.blocks);
    const totalCost = allBlocks.reduce((sum, b) => sum + (b.estimatedCost || 0), 0);
    const perDay = displayDays.map((d) => ({ dayNumber: d.dayNumber, count: d.blocks.length }));
    const maxCount = Math.max(1, ...perDay.map((p) => p.count));
    const daysWithActivities = perDay.filter((p) => p.count > 0).length;
    const currency = allBlocks[0]?.currency || 'INR';
    return {
      totalBlocks: allBlocks.length,
      totalCost,
      currency,
      perDay,
      maxCount,
      daysWithActivities,
      density: displayDays.length > 0 ? Math.round((daysWithActivities / displayDays.length) * 100) : 0,
    };
  }, [displayDays]);

  // ─── Drag and drop ───────────────────────────────────────────────────────

  function findDayContainingBlock(blockId: string): DayData | undefined {
    return days.find((day) => day.blocks.some((b) => b.id === blockId));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !token) return;

    const activeBlockId = active.id as string;
    const overId = over.id as string;

    const sourceDay = findDayContainingBlock(activeBlockId);
    if (!sourceDay) return;
    const movedBlock = sourceDay.blocks.find((b) => b.id === activeBlockId);
    const originalPosition = movedBlock?.position ?? 1;

    const targetDay = findDayContainingBlock(overId) || days.find((d) => d.id === overId);
    if (!targetDay) return;

    if (sourceDay.id === targetDay.id) {
      const oldIndex = sourceDay.blocks.findIndex((b) => b.id === activeBlockId);
      const newIndex = sourceDay.blocks.findIndex((b) => b.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const newBlocks = arrayMove(sourceDay.blocks, oldIndex, newIndex);
      setDays((prev) => prev.map((d) => (d.id === sourceDay.id ? { ...d, blocks: newBlocks } : d)));

      const result = await moveBlock(activeBlockId, sourceDay.id, newIndex + 1);
      if (!result.ok) fetchDays();
    } else {
      const overBlockIndex = targetDay.blocks.findIndex((b) => b.id === overId);
      const targetPosition = overBlockIndex >= 0 ? overBlockIndex + 1 : targetDay.blocks.length + 1;

      const result = await moveBlock(activeBlockId, targetDay.id, targetPosition);
      if (!result.ok) {
        fetchDays();
        return;
      }

      // Undo affordance for cross-day moves
      const sourceDayId = sourceDay.id;
      toast(`Moved to Day ${targetDay.dayNumber}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const undo = await moveBlock(activeBlockId, sourceDayId, originalPosition);
            if (!undo.ok) fetchDays();
          },
        },
      });
    }
  }

  // ─── Block actions ───────────────────────────────────────────────────────

  const finalizeDelete = useCallback(
    async (blockId: string) => {
      const result = await deleteBlock(blockId);
      if (!result.ok) {
        // Restore on failure
        setHiddenBlockIds((prev) => {
          const next = new Set(prev);
          next.delete(blockId);
          return next;
        });
        toast.error(result.error || 'Failed to delete activity');
      }
    },
    [deleteBlock]
  );

  // Stable identity (useCallback) so the memoized DayColumn/SortableBlock tree
  // doesn't re-render just because this handler was recreated.
  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      // Soft delete: hide immediately, commit after the undo window
      setHiddenBlockIds((prev) => new Set(prev).add(blockId));
      let undone = false;
      let settled = false;
      const restore = () => {
        undone = true;
        setHiddenBlockIds((prev) => {
          const next = new Set(prev);
          next.delete(blockId);
          return next;
        });
      };
      const commit = () => {
        if (settled || undone) return;
        settled = true;
        finalizeDelete(blockId);
      };
      toast('Activity deleted', {
        duration: 5000,
        action: { label: 'Undo', onClick: restore },
        onAutoClose: commit,
        onDismiss: commit,
      });
    },
    [finalizeDelete]
  );

  const openEdit = useCallback(
    (block: BlockData) => {
      setEditState({ block, baseUpdatedAt: block.updatedAt });
      setMyEditing(block.id);
    },
    [setMyEditing]
  );

  function closeEdit() {
    setEditState(null);
    setMyEditing(null);
  }

  async function handleSaveEdit(updates: Partial<ActivityFormValues>) {
    if (!editState) return { ok: false as const };
    const result = await saveEdit(editState.block.id, updates as Record<string, unknown>, editState.baseUpdatedAt);
    if (result.conflict && result.theirs) {
      setConflict({
        mine: { ...(updates as ActivityFormValues) },
        theirs: result.theirs,
        theirsEditorName: result.theirs.lastEditedBy
          ? members.get(result.theirs.lastEditedBy)?.name ?? null
          : null,
      });
      setMyEditing(null);
      return { ok: false, conflict: true };
    }
    if (result.ok) {
      setMyEditing(null);
      toast.success('Activity updated');
    }
    return result;
  }

  // Conflict resolution
  async function handleKeepMine() {
    if (!conflict) return;
    const {
      title,
      category,
      startTime,
      endTime,
      locationName,
      latitude,
      longitude,
      estimatedCost,
      description,
    } = conflict.mine;
    await forceUpdate(conflict.theirs.id, {
      title,
      category,
      startTime,
      endTime,
      locationName,
      latitude,
      longitude,
      estimatedCost,
      description,
    });
    setConflict(null);
  }
  function handleKeepTheirs() {
    if (!conflict) return;
    applyServerBlock(conflict.theirs);
    setConflict(null);
  }
  async function handleMerge(merged: Partial<ActivityFormValues>) {
    if (!conflict) return;
    await forceUpdate(conflict.theirs.id, merged as Record<string, unknown>);
    setConflict(null);
  }

  // Duplicate
  async function handleDuplicateSelect(targetDayId: string) {
    if (!duplicateSource) return;
    const src = duplicateSource;
    setDuplicateSource(null);
    const result = await duplicateBlock(src, targetDayId);
    if (result.ok) toast.success('Activity copied');
    else toast.error(result.error || 'Failed to copy activity');
  }

  // ─── Selection / bulk actions ────────────────────────────────────────────

  const toggleSelect = useCallback((blockId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  // Stable handlers for the memoized columns (avoid inline arrows in JSX).
  const handleAddActivity = useCallback((dayId: string) => setAddModalDayId(dayId), []);
  const handleToggleExpand = useCallback(
    (id: string) => setExpandedBlockId((prev) => (prev === id ? null : id)),
    []
  );
  const handleDuplicateBlock = useCallback((b: BlockData) => setDuplicateSource(b), []);

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkMove(targetDayId: string) {
    setBulkMoveOpen(false);
    const targetDay = days.find((d) => d.id === targetDayId);
    const base = targetDay ? targetDay.blocks.length : 0;
    const ids = Array.from(selectedIds);
    for (let i = 0; i < ids.length; i++) {
      const result = await moveBlock(ids[i], targetDayId, base + i + 1);
      if (!result.ok) {
        fetchDays();
        break;
      }
    }
    toast.success(`Moved ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}`);
    exitSelectMode();
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected ${ids.length === 1 ? 'activity' : 'activities'}?`)) return;
    for (const id of ids) {
      await deleteBlock(id);
    }
    toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}`);
    exitSelectMode();
  }

  function toggleCategory(cat: ActivityCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function jumpToDay(dayId: string) {
    if (!dayId) return;
    document.getElementById(`day-col-${dayId}`)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-tint border-t-primary" />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-lg bg-danger-tint p-4 text-sm text-danger">{error}</div>;
  }

  if (days.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">
          No days found for this trip. Days are created automatically when you set your trip dates.
        </p>
      </div>
    );
  }

  const totalVisibleBlocks = displayDays.reduce((n, d) => n + d.blocks.length, 0);
  const showEmptyOnboarding = totalVisibleBlocks === 0;

  return (
    <>
      {/* Connection status */}
      {status === 'reconnecting' && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning-tint-foreground">
          <div className="h-2 w-2 animate-pulse rounded-full bg-warning" />
          Reconnecting...
        </div>
      )}
      {status === 'disconnected' && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">
          <div className="h-2 w-2 rounded-full bg-danger" />
          Disconnected — changes may not sync
        </div>
      )}

      {/* Trip summary / overview card */}
      <div className="mb-4 rounded-2xl border border-border bg-card">
        <button
          onClick={() => setSummaryOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          aria-expanded={summaryOpen}
        >
          <span className="text-sm font-semibold text-foreground">Trip Overview</span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{stats.totalBlocks} activities</span>
            <span>{stats.currency} {stats.totalCost.toLocaleString()}</span>
            <svg
              className={`h-4 w-4 transition-transform ${summaryOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
        {summaryOpen && (
          <div className="border-t border-border px-4 py-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Total activities" value={String(stats.totalBlocks)} />
              <Stat label="Estimated cost" value={`${stats.currency} ${stats.totalCost.toLocaleString()}`} />
              <Stat label="Members" value={String(memberCount)} />
              <Stat label="Days planned" value={`${stats.daysWithActivities}/${displayDays.length} (${stats.density}%)`} />
            </div>
            {/* Density bars */}
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Activities per day</p>
              <div className="flex items-end gap-1">
                {stats.perDay.map((p) => (
                  <div key={p.dayNumber} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${8 + (p.count / stats.maxCount) * 40}px` }}
                      title={`Day ${p.dayNumber}: ${p.count} ${p.count === 1 ? 'activity' : 'activities'}`}
                    />
                    <span className="text-[10px] text-muted-foreground">{p.dayNumber}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar: search, filters, jump-to-day, select mode */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search activities…"
            className="w-56 rounded-lg border border-border py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Category toggles */}
        <div className="flex items-center gap-1">
          {CATEGORIES.map((c) => {
            const active = activeCategories.has(c.key);
            return (
              <button
                key={c.key}
                onClick={() => toggleCategory(c.key)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-primary bg-primary-tint text-primary-tint-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
                aria-pressed={active}
              >
                <c.icon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                {c.label}
              </button>
            );
          })}
          {activeCategories.size > 0 && (
            <button
              onClick={() => setActiveCategories(new Set())}
              className="ml-1 text-xs text-muted-foreground hover:text-muted-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Jump to day */}
        <select
          onChange={(e) => {
            jumpToDay(e.target.value);
            e.target.selectedIndex = 0;
          }}
          className="rounded-lg border border-border py-2 pl-3 pr-8 text-sm text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          defaultValue=""
          aria-label="Jump to day"
        >
          <option value="" disabled>
            Jump to day…
          </option>
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              Day {d.dayNumber}
            </option>
          ))}
        </select>

        {/* Select mode toggle (editors/owners only) */}
        {canEdit && (
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`ml-auto rounded-lg border px-3 py-2 text-sm font-medium transition ${
              selectMode
                ? 'border-primary bg-primary-tint text-primary-tint-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
        )}
      </div>

      {/* Empty onboarding state */}
      {showEmptyOnboarding && (
        <div className="mb-4 rounded-2xl border-2 border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary-tint text-3xl">
            🧭
          </div>
          <p className="text-lg font-medium text-foreground">Start by adding your first activity!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan meals, stays, travel and things to do — then drag them around to build your days.
          </p>
          {canEdit && (
            <button
              onClick={() => setAddModalDayId(days[0].id)}
              className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover"
            >
              + Add Activity
            </button>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {displayDays.map((day) => (
            <DayColumn
              key={day.id}
              dayId={day.id}
              dayNumber={day.dayNumber}
              date={day.date}
              blocks={day.blocks}
              onAddActivity={handleAddActivity}
              canEdit={canEdit}
              members={members}
              tzAbbrev={tzAbbrev}
              lockedByBlock={lockedByBlock}
              expandedBlockId={expandedBlockId}
              onToggleExpand={handleToggleExpand}
              onEditBlock={openEdit}
              onDeleteBlock={handleDeleteBlock}
              onDuplicateBlock={handleDuplicateBlock}
              isMatch={isMatch}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      </DndContext>

      {/* Add / Edit modal */}
      {addModalDayId && token && (
        <AddActivityModal
          dayId={addModalDayId}
          tripId={tripId}
          token={token}
          onClose={() => setAddModalDayId(null)}
          onCreated={() => setAddModalDayId(null)}
          createBlock={createBlock}
        />
      )}
      {editState && token && (
        <AddActivityModal
          mode="edit"
          dayId={editState.block.dayId}
          tripId={tripId}
          token={token}
          initial={{
            title: editState.block.title,
            category: editState.block.category,
            startTime: editState.block.startTime ?? undefined,
            endTime: editState.block.endTime ?? undefined,
            locationName: editState.block.locationName ?? undefined,
            latitude: editState.block.latitude,
            longitude: editState.block.longitude,
            estimatedCost: editState.block.estimatedCost ?? undefined,
            description: editState.block.description ?? undefined,
          }}
          onClose={closeEdit}
          onCreated={closeEdit}
          onSave={handleSaveEdit}
        />
      )}

      {/* Duplicate: copy-to-day selector */}
      {duplicateSource && (
        <DaySelectorModal
          title="Copy to day…"
          description={`Duplicate "${duplicateSource.title}" into another day.`}
          days={days}
          onSelect={handleDuplicateSelect}
          onClose={() => setDuplicateSource(null)}
        />
      )}

      {/* Bulk move selector */}
      {bulkMoveOpen && (
        <DaySelectorModal
          title="Move selected to day…"
          description={`Move ${selectedIds.size} selected ${selectedIds.size === 1 ? 'activity' : 'activities'}.`}
          days={days}
          onSelect={handleBulkMove}
          onClose={() => setBulkMoveOpen(false)}
        />
      )}

      {/* Conflict resolution dialog */}
      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onKeepMine={handleKeepMine}
          onKeepTheirs={handleKeepTheirs}
          onMerge={handleMerge}
          onClose={() => setConflict(null)}
        />
      )}

      {/* Bulk action floating bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-4 rounded-full bg-muted px-5 py-3 text-sm text-white shadow-lg">
          <span>{selectedIds.size} selected</span>
          <button onClick={() => setBulkMoveOpen(true)} className="font-medium text-primary hover:text-primary-tint">
            Move to Day…
          </button>
          <button onClick={handleBulkDelete} className="font-medium text-danger hover:text-danger-hover">
            Delete
          </button>
          <button onClick={exitSelectMode} className="text-muted-foreground hover:text-muted-foreground">
            Clear
          </button>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="stat-number mt-0.5 text-lg text-foreground">{value}</p>
    </div>
  );
}
