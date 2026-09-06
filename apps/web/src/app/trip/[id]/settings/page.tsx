'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { COMMON_TIMEZONES, suggestTimezoneFromDestination, timezoneAbbreviation } from '@/lib/format';
import { FloatingInput } from '@/components/ui/floating-input';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Member {
  id: string;
  userId: string;
  role: string;
  userName: string;
  userEmail: string;
  userAvatarUrl: string | null;
}

interface TripDetails {
  id: string;
  title: string;
  destination: string;
  createdBy: string;
  inviteCode: string;
  coverImageUrl: string | null;
  timezone: string | null;
}

// Warm avatar palette drawn from the semantic tokens (globals.css @theme).
const avatarColors = [
  'bg-primary', 'bg-secondary', 'bg-cat-travel', 'bg-cat-stay',
  'bg-success', 'bg-warning', 'bg-primary-hover', 'bg-secondary-hover',
];
function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

// ─── Confirmation dialog ──────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50 ${
              danger ? 'bg-danger hover:bg-danger-hover' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

export default function TripSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const tripId = params.id as string;
  const token = (session as any)?.accessToken as string | undefined;
  const userId = session?.user?.id as string | undefined;

  const [trip, setTrip] = useState<TripDetails | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [isOwner, setIsOwner] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Pending confirmation for member actions
  const [pendingAction, setPendingAction] = useState<
    | { kind: 'role'; member: Member; newRole: 'editor' | 'viewer' }
    | { kind: 'remove'; member: Member }
    | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Cover image + timezone form state
  const [coverUrl, setCoverUrl] = useState('');
  const [timezone, setTimezone] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const fetchTrip = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const t: TripDetails = data.trip;
        setTrip(t);
        setIsOwner(t.createdBy === userId);
        setCoverUrl(t.coverImageUrl || '');
        setTimezone(t.timezone || '');
      }
    } catch {
      /* invite code / settings just won't show */
    } finally {
      setLoadingTrip(false);
    }
  }, [token, tripId, userId]);

  const fetchMembers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch {
      /* non-critical */
    }
  }, [token, tripId]);

  useEffect(() => {
    fetchTrip();
    fetchMembers();
  }, [fetchTrip, fetchMembers]);

  const inviteCode = trip?.inviteCode || '';

  async function handleCopyInviteLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  async function handleCopyCode() {
    await navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ─── Member management ───────────────────────────────────────────────────────

  async function confirmMemberAction() {
    if (!pendingAction || !token) return;
    setActionBusy(true);
    setError('');
    try {
      if (pendingAction.kind === 'role') {
        const res = await fetch(
          `${API_URL}/api/trips/${tripId}/members/${pendingAction.member.userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ role: pendingAction.newRole }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to update role');
        }
      } else {
        const res = await fetch(
          `${API_URL}/api/trips/${tripId}/members/${pendingAction.member.userId}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to remove member');
        }
      }
      setPendingAction(null);
      await fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setPendingAction(null);
    } finally {
      setActionBusy(false);
    }
  }

  // ─── Cover image + timezone ──────────────────────────────────────────────────

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSavingSettings(true);
    setSettingsSaved(false);
    setError('');
    try {
      const body: Record<string, unknown> = {
        coverImageUrl: coverUrl.trim() ? coverUrl.trim() : null,
        timezone: timezone.trim() ? timezone.trim() : null,
      };
      const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to save trip settings');
      }
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
      await fetchTrip();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  }

  const suggestedTz = suggestTimezoneFromDestination(trip?.destination);

  // ─── Danger zone ─────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!token) return;
    if (!window.confirm('Delete this trip permanently? All days, activities, votes, and expenses will be removed.')) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to delete trip');
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete trip');
      setDeleting(false);
    }
  }

  async function handleLeave() {
    if (!token || !userId) return;
    if (!window.confirm('Leave this trip? You will lose access to the itinerary, votes, and expenses.')) return;
    setLeaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to leave trip');
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave trip');
      setLeaving(false);
    }
  }

  const roleBadgeClass: Record<string, string> = {
    owner: 'bg-primary-tint text-primary-tint-foreground',
    editor: 'bg-success-tint text-success-tint-foreground',
    viewer: 'bg-muted text-muted-foreground',
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground">Settings</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage trip details, members, and invite links.
      </p>

      {error && (
        <div className="mt-4 rounded-lg bg-danger-tint p-3 text-sm text-danger-tint-foreground">{error}</div>
      )}

      {/* ─── Members ─────────────────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground">Members</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {isOwner
            ? 'Change roles or remove members. Editors can modify the itinerary; Viewers have read-only access.'
            : 'Everyone collaborating on this trip.'}
        </p>

        <div className="mt-4 divide-y divide-border">
          {members.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">Loading members…</p>
          )}
          {members.map((m) => {
            const isSelf = m.userId === userId;
            const isMemberOwner = m.role === 'owner';
            const canManage = isOwner && !isMemberOwner && !isSelf;
            return (
              <div key={m.id} className="flex items-center gap-3 py-3">
                <div
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(m.userId)}`}
                >
                  {m.userAvatarUrl ? (
                    <img src={m.userAvatarUrl} alt={m.userName} className="h-full w-full rounded-full object-cover" />
                  ) : (
                    m.userName.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {m.userName} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.userEmail}</p>
                </div>

                {canManage ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) =>
                        setPendingAction({
                          kind: 'role',
                          member: m,
                          newRole: e.target.value as 'editor' | 'viewer',
                        })
                      }
                      className="rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      aria-label={`Change role for ${m.userName}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      onClick={() => setPendingAction({ kind: 'remove', member: m })}
                      className="rounded-lg border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-tint"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${roleBadgeClass[m.role] || 'bg-muted text-muted-foreground'}`}
                  >
                    {m.role}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Cover image + timezone ──────────────────────────────────────── */}
      {isOwner && (
        <form onSubmit={handleSaveSettings} className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground">Trip Appearance</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a cover photo and the destination timezone.
          </p>

          <div className="mt-4">
            <FloatingInput
              id="cover-url"
              label="Cover Image URL"
              size="sm"
              type="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://images.example.com/paris.jpg"
            />
            {coverUrl.trim() && (
              <div className="mt-3 h-32 w-full overflow-hidden rounded-lg border border-border">
                <img src={coverUrl} alt="Cover preview" className="h-full w-full object-cover" />
              </div>
            )}
          </div>

          <div className="mt-4">
            <label htmlFor="timezone" className="block text-sm font-medium text-foreground">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border px-3 py-2 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">No timezone</option>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz} ({timezoneAbbreviation(tz)})
                </option>
              ))}
            </select>
            {suggestedTz && suggestedTz !== timezone && (
              <button
                type="button"
                onClick={() => setTimezone(suggestedTz)}
                className="mt-2 text-xs font-medium text-primary hover:text-primary-tint-foreground"
              >
                Suggested for {trip?.destination}: {suggestedTz} — use this
              </button>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={savingSettings}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-50"
            >
              {savingSettings ? 'Saving…' : 'Save Appearance'}
            </button>
            {settingsSaved && <span className="text-sm text-success">✓ Saved</span>}
          </div>
        </form>
      )}

      {/* ─── Invite ──────────────────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground">Invite Members</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Share the invite code or link below. Anyone with this code can join as an Editor.
        </p>

        {loadingTrip ? (
          <div className="mt-4 h-10 w-48 animate-pulse rounded-lg bg-muted" />
        ) : inviteCode ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-border bg-muted px-4 py-2.5 font-mono text-sm font-medium text-foreground select-all">
                {inviteCode}
              </div>
              <button
                onClick={handleCopyCode}
                className="rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                {copied ? '✓ Copied' : 'Copy Code'}
              </button>
            </div>
            <button
              onClick={handleCopyInviteLink}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              {copied ? 'Copied!' : 'Copy Invite Link'}
            </button>
            <p className="text-xs text-muted-foreground">
              Link format: {typeof window !== 'undefined' ? window.location.origin : ''}/join/{inviteCode}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Unable to load invite code.</p>
        )}
      </div>

      {/* ─── Danger Zone ─────────────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border border-danger/40 bg-danger-tint p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-danger-tint-foreground">Danger Zone</h3>
        {isOwner ? (
          <>
            <p className="mt-1 text-sm text-danger-tint-foreground">
              Deleting a trip is permanent. All days, activities, votes, and expenses will be removed.
            </p>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="mt-4 rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-danger-hover disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete This Trip'}
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-danger-tint-foreground">
              Leaving a trip will remove your access to the itinerary, votes, and expenses.
            </p>
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="mt-4 rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-danger-hover disabled:opacity-50"
            >
              {leaving ? 'Leaving...' : 'Leave This Trip'}
            </button>
          </>
        )}
      </div>

      {/* Confirmation dialog for role change / removal */}
      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.kind === 'role' ? 'Change member role?' : 'Remove member?'}
          message={
            pendingAction.kind === 'role'
              ? `Change ${pendingAction.member.userName}'s role to ${pendingAction.newRole}? ${
                  pendingAction.newRole === 'viewer'
                    ? 'They will lose the ability to edit the itinerary.'
                    : 'They will be able to edit the itinerary.'
                }`
              : `Remove ${pendingAction.member.userName} from this trip? They will lose access immediately.`
          }
          confirmLabel={pendingAction.kind === 'role' ? 'Change Role' : 'Remove'}
          danger={pendingAction.kind === 'remove'}
          busy={actionBusy}
          onConfirm={confirmMemberAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
