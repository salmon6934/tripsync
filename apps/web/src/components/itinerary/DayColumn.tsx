'use client';

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableBlock, BlockData, MemberInfo } from './SortableBlock';
import { formatDayLabel } from '@/lib/format';

interface DayColumnProps {
  dayId: string;
  dayNumber: number;
  date: string;
  blocks: BlockData[];
  onAddActivity: (dayId: string) => void;
  canEdit: boolean;
  members: Map<string, MemberInfo>;
  tzAbbrev: string | null;
  lockedByBlock: Map<string, string>;
  expandedBlockId: string | null;
  onToggleExpand: (blockId: string) => void;
  onEditBlock: (block: BlockData) => void;
  onDeleteBlock: (blockId: string) => void;
  onDuplicateBlock: (block: BlockData) => void;
  isMatch: (block: BlockData) => boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (blockId: string) => void;
}

function DayColumnComponent({
  dayId,
  dayNumber,
  date,
  blocks,
  onAddActivity,
  canEdit,
  members,
  tzAbbrev,
  lockedByBlock,
  expandedBlockId,
  onToggleExpand,
  onEditBlock,
  onDeleteBlock,
  onDuplicateBlock,
  isMatch,
  selectMode,
  selectedIds,
  onToggleSelect,
}: DayColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dayId });

  return (
    <div
      id={`day-col-${dayId}`}
      className="flex w-72 flex-shrink-0 scroll-mt-4 flex-col rounded-2xl border border-border bg-muted"
    >
      {/* Day header */}
      <div className="flex items-center justify-between rounded-t-2xl border-b border-border bg-card px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Day {dayNumber}</h3>
          <p className="text-xs text-muted-foreground">{formatDayLabel(date)}</p>
        </div>
        {canEdit && (
          <button
            onClick={() => onAddActivity(dayId)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
            aria-label={`Add activity to day ${dayNumber}`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {/* Droppable area with blocks */}
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 overflow-y-auto p-3 transition ${isOver ? 'bg-primary-tint' : ''}`}
        style={{ minHeight: '200px' }}
      >
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block) => (
            <SortableBlock
              key={block.id}
              block={block}
              canEdit={canEdit}
              members={members}
              tzAbbrev={tzAbbrev}
              lockedByName={lockedByBlock.get(block.id) ?? null}
              expanded={expandedBlockId === block.id}
              onToggleExpand={onToggleExpand}
              onEdit={onEditBlock}
              onDelete={onDeleteBlock}
              onDuplicate={onDuplicateBlock}
              dimmed={!isMatch(block)}
              selectMode={selectMode}
              selected={selectedIds.has(block.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </SortableContext>

        {blocks.length === 0 && !isOver && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
            <span className="text-2xl" aria-hidden="true">🗓️</span>
            <p className="text-xs text-muted-foreground">
              Nothing planned yet.
              {canEdit ? ' Tap + to add an activity.' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized: a column only re-renders when its own props change, so editing one
// day's blocks doesn't re-render every other day column on the board.
export const DayColumn = memo(DayColumnComponent);
