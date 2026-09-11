'use client';

import { useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type { BlockData } from '../components/itinerary/SortableBlock';
import { useOptimisticUpdate } from './useOptimisticUpdate';

/**
 * Debounce window (ms) for coalescing rapid successive edits to the same block
 * into a single socket emit. The optimistic UI still updates instantly on every
 * keystroke/drag; only the network write is batched.
 */
const BLOCK_UPDATE_DEBOUNCE_MS = 100;

interface PendingBlockUpdate {
  updates: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
  resolvers: Array<(result: { ok: boolean; error?: string }) => void>;
}

interface DayData {
  id: string;
  tripId: string;
  date: string;
  dayNumber: number;
  blocks: BlockData[];
}

interface UseTripSyncOptions {
  socket: Socket | null;
  days: DayData[];
  setDays: React.Dispatch<React.SetStateAction<DayData[]>>;
}

/**
 * Listens to real-time block events from the server and merges them into local state.
 * Provides mutation functions that emit socket events with acknowledgement callbacks
 * and apply optimistic updates.
 */
export function useTripSync({ socket, days, setDays }: UseTripSyncOptions) {
  const { applyOptimistic } = useOptimisticUpdate(setDays);

  // Per-block debounce state for batching rapid successive `block:update` emits.
  const pendingUpdates = useRef<Map<string, PendingBlockUpdate>>(new Map());

  // Listen for server broadcast events
  useEffect(() => {
    if (!socket) return;

    function handleBlockCreated({ block, userId }: { block: BlockData; userId: string }) {
      setDays((prev) =>
        prev.map((day) => {
          if (day.id === block.dayId) {
            // Avoid duplicates
            if (day.blocks.some((b) => b.id === block.id)) return day;
            return { ...day, blocks: [...day.blocks, block] };
          }
          return day;
        }),
      );
    }

    function handleBlockUpdated({ block, userId }: { block: BlockData; userId: string }) {
      setDays((prev) =>
        prev.map((day) => ({
          ...day,
          blocks: day.blocks.map((b) => (b.id === block.id ? block : b)),
        })),
      );
    }

    function handleBlockMoved({ block, userId }: { block: BlockData; userId: string }) {
      setDays((prev) =>
        prev.map((day) => {
          if (day.id === block.dayId) {
            // Add to target day if not already there
            if (day.blocks.some((b) => b.id === block.id)) {
              return { ...day, blocks: day.blocks.map((b) => (b.id === block.id ? block : b)) };
            }
            return { ...day, blocks: [...day.blocks, block].sort((a, b) => a.position - b.position) };
          }
          // Remove from other days
          return { ...day, blocks: day.blocks.filter((b) => b.id !== block.id) };
        }),
      );
    }

    function handleBlockDeleted({ blockId, userId }: { blockId: string; userId: string }) {
      setDays((prev) =>
        prev.map((day) => ({
          ...day,
          blocks: day.blocks.filter((b) => b.id !== blockId),
        })),
      );
    }

    socket.on('block:created', handleBlockCreated);
    socket.on('block:updated', handleBlockUpdated);
    socket.on('block:moved', handleBlockMoved);
    socket.on('block:deleted', handleBlockDeleted);

    return () => {
      socket.off('block:created', handleBlockCreated);
      socket.off('block:updated', handleBlockUpdated);
      socket.off('block:moved', handleBlockMoved);
      socket.off('block:deleted', handleBlockDeleted);
    };
  }, [socket, setDays]);

  // --- Mutation functions ---

  /**
   * Emits a socket event with acknowledgement and returns a promise.
   */
  function emitWithAck(
    event: string,
    data: unknown,
  ): Promise<{ ok?: boolean; error?: string; block?: BlockData }> {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) {
        resolve({ error: 'Not connected' });
        return;
      }
      socket.emit(event, data, (response: any) => {
        resolve(response);
      });
    });
  }

  const createBlock = useCallback(
    async (input: {
      dayId: string;
      title: string;
      category: string;
      startTime?: string;
      endTime?: string;
      locationName?: string;
      latitude?: number;
      longitude?: number;
      estimatedCost?: number;
      description?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      // Generate a temporary ID for the optimistic block
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticBlock: BlockData = {
        id: tempId,
        dayId: input.dayId,
        title: input.title,
        description: input.description || null,
        category: input.category as BlockData['category'],
        startTime: input.startTime || null,
        endTime: input.endTime || null,
        locationName: input.locationName || null,
        // `?? null` rather than `|| null` so a legitimate 0 coordinate (the
        // equator / prime meridian) survives the optimistic render.
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        estimatedCost: input.estimatedCost ?? null,
        currency: 'INR',
        position: Date.now(), // Will be corrected by server
        createdBy: '',
        lastEditedBy: null,
        updatedAt: new Date().toISOString(),
      };

      return applyOptimistic(
        (prev) =>
          prev.map((day) =>
            day.id === input.dayId ? { ...day, blocks: [...day.blocks, optimisticBlock] } : day,
          ),
        async () => {
          const response = await emitWithAck('block:create', input);
          if (response.ok && response.block) {
            // Replace temp block with the real one from server
            setDays((prev) =>
              prev.map((day) => ({
                ...day,
                blocks: day.blocks.map((b) => (b.id === tempId ? response.block! : b)),
              })),
            );
          }
          return response;
        },
      );
    },
    [socket, applyOptimistic, setDays],
  );

  /**
   * Optimistically applies a block update immediately (instant UI, Req 4.6) and
   * debounces the network emit: rapid successive updates to the same block are
   * coalesced within a 100ms window and sent as a single `block:update`. All
   * callers waiting on that window resolve together with the server's result.
   */
  const updateBlock = useCallback(
    (
      blockId: string,
      updates: Partial<Omit<BlockData, 'id' | 'dayId' | 'position'>>,
    ): Promise<{ ok: boolean; error?: string }> => {
      // Apply the optimistic change right away so the UI never waits on the
      // debounce window.
      setDays((prev) =>
        prev.map((day) => ({
          ...day,
          blocks: day.blocks.map((b) => (b.id === blockId ? { ...b, ...updates } : b)),
        })),
      );

      return new Promise((resolve) => {
        const existing = pendingUpdates.current.get(blockId);
        // Merge onto any updates already queued for this block in the window.
        const mergedUpdates = { ...(existing?.updates ?? {}), ...updates };
        const resolvers = existing?.resolvers ?? [];
        resolvers.push(resolve);

        if (existing) clearTimeout(existing.timer);

        const timer = setTimeout(async () => {
          pendingUpdates.current.delete(blockId);
          const response = await emitWithAck('block:update', { blockId, ...mergedUpdates });
          const result = response.ok
            ? { ok: true }
            : { ok: false, error: response.error };
          resolvers.forEach((r) => r(result));
        }, BLOCK_UPDATE_DEBOUNCE_MS);

        pendingUpdates.current.set(blockId, { updates: mergedUpdates, timer, resolvers });
      });
    },
    [socket, setDays],
  );

  // Flush any still-pending debounced updates when the hook unmounts so a batch
  // that hasn't fired yet isn't silently dropped.
  useEffect(() => {
    const pending = pendingUpdates.current;
    return () => {
      for (const [blockId, entry] of pending.entries()) {
        clearTimeout(entry.timer);
        if (socket && socket.connected) {
          socket.emit('block:update', { blockId, ...entry.updates });
        }
        entry.resolvers.forEach((r) => r({ ok: true }));
      }
      pending.clear();
    };
  }, [socket]);

  const moveBlock = useCallback(
    async (
      blockId: string,
      targetDayId: string,
      targetPosition: number,
    ): Promise<{ ok: boolean; error?: string }> => {
      return applyOptimistic(
        (prev) => {
          let movedBlock: BlockData | undefined;
          const withoutBlock = prev.map((day) => {
            const block = day.blocks.find((b) => b.id === blockId);
            if (block) movedBlock = { ...block, dayId: targetDayId, position: targetPosition };
            return { ...day, blocks: day.blocks.filter((b) => b.id !== blockId) };
          });

          if (!movedBlock) return prev;

          return withoutBlock.map((day) => {
            if (day.id === targetDayId) {
              const newBlocks = [...day.blocks];
              newBlocks.splice(targetPosition - 1, 0, movedBlock!);
              return { ...day, blocks: newBlocks };
            }
            return day;
          });
        },
        () => emitWithAck('block:move', { blockId, targetDayId, targetPosition }),
      );
    },
    [socket, applyOptimistic],
  );

  const deleteBlock = useCallback(
    async (blockId: string): Promise<{ ok: boolean; error?: string }> => {
      return applyOptimistic(
        (prev) =>
          prev.map((day) => ({
            ...day,
            blocks: day.blocks.filter((b) => b.id !== blockId),
          })),
        () => emitWithAck('block:delete', { blockId }),
      );
    },
    [socket, applyOptimistic],
  );

  /**
   * Conflict-aware edit save. Sends the block's base updatedAt so the server can
   * apply last-write-wins. On CONFLICT the caller receives the server's current
   * version so a diff/merge dialog can be shown.
   */
  const saveEdit = useCallback(
    async (
      blockId: string,
      updates: Record<string, unknown>,
      baseUpdatedAt: string | undefined,
    ): Promise<{ ok: boolean; conflict?: boolean; theirs?: BlockData; error?: string }> => {
      const response = await emitWithAck('block:update', {
        blockId,
        updatedAt: baseUpdatedAt,
        ...updates,
      });

      if (response.ok && response.block) {
        setDays((prev) =>
          prev.map((day) => ({
            ...day,
            blocks: day.blocks.map((b) => (b.id === blockId ? (response.block as BlockData) : b)),
          })),
        );
        return { ok: true };
      }

      if ((response as any).error === 'CONFLICT') {
        return { ok: false, conflict: true, theirs: (response as any).block as BlockData };
      }

      return { ok: false, error: (response as any).error };
    },
    [socket, setDays],
  );

  /**
   * Forces an update, bypassing the last-write-wins timestamp check ("keep mine").
   */
  const forceUpdate = useCallback(
    async (blockId: string, updates: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
      const response = await emitWithAck('block:update', { blockId, ...updates });
      if (response.ok && response.block) {
        setDays((prev) =>
          prev.map((day) => ({
            ...day,
            blocks: day.blocks.map((b) => (b.id === blockId ? (response.block as BlockData) : b)),
          })),
        );
        return { ok: true };
      }
      return { ok: false, error: (response as any).error };
    },
    [socket, setDays],
  );

  /**
   * Replaces a block in local state with a server-provided version ("keep theirs").
   */
  const applyServerBlock = useCallback(
    (block: BlockData) => {
      setDays((prev) =>
        prev.map((day) => ({
          ...day,
          blocks: day.blocks.map((b) => (b.id === block.id ? block : b)),
        })),
      );
    },
    [setDays],
  );

  /**
   * Duplicates a block's content into a target day (new id + appended position).
   */
  const duplicateBlock = useCallback(
    async (source: BlockData, targetDayId: string): Promise<{ ok: boolean; error?: string }> => {
      return createBlock({
        dayId: targetDayId,
        title: source.title,
        category: source.category,
        startTime: source.startTime || undefined,
        endTime: source.endTime || undefined,
        locationName: source.locationName || undefined,
        // Coordinates travel with the copy, so a duplicated block keeps its pin.
        latitude: source.latitude ?? undefined,
        longitude: source.longitude ?? undefined,
        estimatedCost: source.estimatedCost ?? undefined,
        description: source.description || undefined,
      });
    },
    [createBlock],
  );

  return {
    createBlock,
    updateBlock,
    moveBlock,
    deleteBlock,
    saveEdit,
    forceUpdate,
    applyServerBlock,
    duplicateBlock,
  };
}
