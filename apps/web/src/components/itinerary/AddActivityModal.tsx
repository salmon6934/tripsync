'use client';

import { useState } from 'react';
import type { ActivityCategory } from '@tripsync/shared';
import { FloatingInput } from '@/components/ui/floating-input';
import { LocationSearchInput, type LocationValue } from './LocationSearchInput';

export interface ActivityFormValues {
  title: string;
  category: ActivityCategory;
  startTime?: string;
  endTime?: string;
  locationName?: string;
  /**
   * Set by picking a geocoding suggestion in `LocationSearchInput`. These are
   * what put the activity on the map, so they must be threaded all the way
   * through to the socket payload — `null` clears an existing pin.
   */
  latitude?: number | null;
  longitude?: number | null;
  estimatedCost?: number;
  description?: string;
}

interface AddActivityModalProps {
  mode?: 'create' | 'edit';
  dayId: string;
  tripId: string;
  token: string;
  /** Pre-fill values (edit mode). */
  initial?: Partial<ActivityFormValues>;
  onClose: () => void;
  onCreated: () => void;
  createBlock?: (input: {
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
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Edit-mode save handler. Returns conflict:true to signal the board's conflict dialog took over. */
  onSave?: (updates: Partial<ActivityFormValues>) => Promise<{ ok: boolean; error?: string; conflict?: boolean }>;
}

export function AddActivityModal({
  mode = 'create',
  dayId,
  tripId,
  token,
  initial,
  onClose,
  onCreated,
  createBlock,
  onSave,
}: AddActivityModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState<ActivityCategory>(initial?.category ?? 'activity');
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  // Name + coordinates move together, so they live in one piece of state.
  const [location, setLocation] = useState<LocationValue>({
    locationName: initial?.locationName ?? '',
    latitude: initial?.latitude ?? null,
    longitude: initial?.longitude ?? null,
  });
  const [estimatedCost, setEstimatedCost] = useState(
    initial?.estimatedCost != null ? String(initial.estimatedCost) : ''
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isEdit = mode === 'edit';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isEdit && onSave) {
        const updates: Partial<ActivityFormValues> = {
          title,
          category,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          locationName: location.locationName || undefined,
          // Sent as explicit null (not undefined) so removing a pin actually
          // clears the stored coordinates instead of leaving them untouched.
          latitude: location.latitude,
          longitude: location.longitude,
          estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
          description: description || undefined,
        };
        const result = await onSave(updates);
        if (result.conflict) {
          // Conflict dialog takes over — just close the edit modal.
          onClose();
          return;
        }
        if (!result.ok) throw new Error(result.error || 'Failed to save changes');
        onCreated();
        return;
      }

      const input: Record<string, unknown> = { dayId, title, category };
      if (startTime) input.startTime = startTime;
      if (endTime) input.endTime = endTime;
      if (location.locationName) input.locationName = location.locationName;
      // Null-checked rather than truthy-checked: 0 is a valid coordinate.
      if (location.latitude != null && location.longitude != null) {
        input.latitude = location.latitude;
        input.longitude = location.longitude;
      }
      if (estimatedCost) input.estimatedCost = parseFloat(estimatedCost);
      if (description) input.description = description;

      if (createBlock) {
        const result = await createBlock(input as any);
        if (!result.ok) throw new Error(result.error || 'Failed to create activity');
        onCreated();
      } else {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        const res = await fetch(`${API_URL}/api/trips/${tripId}/blocks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'Failed to create activity');
        }
        onCreated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save activity');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          {isEdit ? 'Edit Activity' : 'Add Activity'}
        </h2>

        {error && <div className="mb-4 rounded-lg bg-danger-tint p-3 text-sm text-danger">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FloatingInput
            id="activity-title"
            label="Title *"
            size="sm"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Visit Eiffel Tower"
          />

          <div>
            <label htmlFor="activity-category" className="block text-sm font-medium text-foreground">
              Category
            </label>
            <select
              id="activity-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ActivityCategory)}
              className="mt-1 block w-full rounded-lg border border-border px-3 py-2 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="activity">🎯 Activity</option>
              <option value="food">🍽️ Food</option>
              <option value="travel">✈️ Travel</option>
              <option value="stay">🏨 Stay</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-time" className="block text-sm font-medium text-foreground">
                Start Time
              </label>
              <input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="end-time" className="block text-sm font-medium text-foreground">
                End Time
              </label>
              <input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <LocationSearchInput
            id="location-name"
            value={location}
            onChange={setLocation}
            token={token}
            tripId={tripId}
          />

          <FloatingInput
            id="estimated-cost"
            label="Estimated Cost"
            size="sm"
            type="number"
            step="0.01"
            min="0"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder="25.00"
          />

          <FloatingInput
            id="description"
            label="Notes"
            size="sm"
            multiline
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Any details, booking references, reminders…"
          />

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-50"
            >
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
