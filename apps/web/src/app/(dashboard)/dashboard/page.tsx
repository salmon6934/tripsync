'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { fetchTrips, createTripApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LocationSearchInput, type LocationValue } from '@/components/itinerary/LocationSearchInput';
import { ChronoSelect } from '@/components/ui/chrono-select';
import { FloatingInput } from '@/components/ui/floating-input';

/**
 * Trip dates travel over the wire as `YYYY-MM-DD` strings (the server coerces
 * them with `z.coerce.date()`). ChronoSelect works in `Date` objects, so these
 * helpers bridge the two — using *local* date parts to avoid the UTC-midnight
 * off-by-one that `new Date('YYYY-MM-DD')` introduces in negative timezones.
 */
function ymdToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function dateToYmd(date: Date | undefined): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const TRIP_YEAR_RANGE: [number, number] = [
  new Date().getFullYear() - 1,
  new Date().getFullYear() + 6,
];

interface Trip {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  role: string;
  coverImageUrl: string | null;
  createdAt: string;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  const loadTrips = useCallback(async () => {
    if (!session?.accessToken) return;
    try {
      const data = await fetchTrips(session.accessToken);
      setTrips(data);
    } catch (err) {
      console.error('Failed to fetch trips:', err);
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Trips</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan and manage your collaborative trips
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowJoinModal(true)}
            className="rounded-lg border border-primary px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary-tint focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Join Trip
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            + Create Trip
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading trips">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="h-28 w-full animate-pulse bg-muted" />
              <div className="space-y-3 p-6">
                <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="mt-4 h-4 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center">
          <p className="text-lg font-medium text-foreground">No trips yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your first trip to get started planning.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Create a Trip
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <Link
              key={trip.id}
              href={`/trip/${trip.id}`}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:border-primary hover:shadow-md"
            >
              {trip.coverImageUrl ? (
                <div className="h-28 w-full overflow-hidden bg-muted">
                  <img
                    src={trip.coverImageUrl}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
              ) : (
                <div className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-primary to-secondary text-3xl">
                  🗺️
                </div>
              )}
              <div className="p-6">
                <h3 className="font-semibold text-foreground group-hover:text-primary">
                  {trip.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{trip.destination}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {new Date(trip.startDate).toLocaleDateString()} —{' '}
                    {new Date(trip.endDate).toLocaleDateString()}
                  </span>
                  <span className="inline-flex rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary-tint-foreground">
                    {trip.role}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Trip Modal */}
      {showModal && (
        <CreateTripModal
          token={session?.accessToken || ''}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            loadTrips();
          }}
        />
      )}

      {/* Join Trip Modal */}
      {showJoinModal && (
        <JoinTripModal
          token={session?.accessToken || ''}
          onClose={() => setShowJoinModal(false)}
          onJoined={() => {
            setShowJoinModal(false);
            loadTrips();
          }}
        />
      )}
    </div>
  );
}

function CreateTripModal({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState<LocationValue>({
    locationName: '',
    latitude: null,
    longitude: null,
  });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!destination.locationName.trim()) {
      setError('Destination is required');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please pick both a start and end date');
      return;
    }

    if (endDate < startDate) {
      setError('End date must be on or after the start date');
      return;
    }

    setLoading(true);

    try {
      await createTripApi(token, {
        title,
        destination: destination.locationName.trim(),
        // Coordinates are set only when the user picks a geocoding suggestion.
        // A hand-typed destination sends nulls, and search bias falls back to
        // resolving the string server-side.
        destinationLat: destination.latitude,
        destinationLng: destination.longitude,
        startDate,
        endDate,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trip');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Create a Trip</h2>

        {error && (
          <div className="mb-4 rounded-lg bg-danger-tint p-3 text-sm text-danger">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FloatingInput
            id="title"
            label="Trip Name"
            size="sm"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Summer Vacation"
          />

          <LocationSearchInput
            label="Destination"
            token={token}
            value={destination}
            onChange={setDestination}
            id="destination"
            placeholder="Search a city, e.g. Paris, France"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="mb-1 block text-sm font-medium text-foreground">
                Start Date
              </label>
              <ChronoSelect
                id="startDate"
                value={ymdToDate(startDate)}
                onChange={(date) => {
                  const next = dateToYmd(date);
                  setStartDate(next);
                  // Keep the range valid: clear an end date that now precedes the start.
                  if (endDate && next && endDate < next) setEndDate('');
                }}
                placeholder="Start date"
                yearRange={TRIP_YEAR_RANGE}
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="mb-1 block text-sm font-medium text-foreground">
                End Date
              </label>
              <ChronoSelect
                id="endDate"
                value={ymdToDate(endDate)}
                onChange={(date) => setEndDate(dateToYmd(date))}
                placeholder="End date"
                yearRange={TRIP_YEAR_RANGE}
                // End must be on or after the start (mirrors server validation).
                disabled={startDate ? { before: ymdToDate(startDate) as Date } : undefined}
                className="w-full"
              />
            </div>
          </div>

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
              {loading ? 'Creating...' : 'Create Trip'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function JoinTripModal({
  token,
  onClose,
  onJoined,
}: {
  token: string;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_URL}/api/trips/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          // Already a member — navigate to the trip
          throw new Error('You are already a member of this trip');
        }
        throw new Error(data.message || 'Invalid invite code');
      }

      // Navigate to the joined trip
      if (data.trip?.id) {
        router.push(`/trip/${data.trip.id}`);
      }
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join trip');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Join a Trip</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Enter the invite code shared by the trip owner to join their trip.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-danger-tint p-3 text-sm text-danger">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FloatingInput
            id="inviteCode"
            label="Invite Code"
            size="sm"
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            className="font-mono"
            placeholder="abc123xyz0"
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
              disabled={loading || !inviteCode.trim()}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-50"
            >
              {loading ? 'Joining...' : 'Join Trip'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
