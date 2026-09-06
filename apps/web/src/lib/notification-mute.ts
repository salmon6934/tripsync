'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Shared "mute notifications" preference.
 *
 * Muting only suppresses the ephemeral popup toasts triggered by incoming
 * real-time events (new notifications, other people's activity, poll events).
 * It deliberately does NOT stop notifications from being recorded, nor the
 * unread badge from updating — muting just stops the popups from showing.
 *
 * The preference is persisted in localStorage and shared across every hook
 * that raises those popups, staying in sync within a tab (via a custom event)
 * and across tabs (via the native `storage` event).
 */

const STORAGE_KEY = 'notifications_muted';
const CHANGE_EVENT = 'notifications-muted-change';

/** Reads the current mute preference. Safe to call in event handlers. */
export function isNotificationsMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function setMutedPreference(next: boolean) {
  localStorage.setItem(STORAGE_KEY, String(next));
  // Notify listeners in the same tab (the `storage` event only fires in *other*
  // tabs, so we dispatch our own event for in-tab subscribers).
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Reactive accessor for the mute preference plus a toggle. Any component using
 * this stays in sync when the preference changes anywhere in the app.
 */
export function useNotificationMute() {
  const [muted, setMuted] = useState<boolean>(isNotificationsMuted);

  useEffect(() => {
    const sync = () => setMuted(isNotificationsMuted());
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMutedPreference(!isNotificationsMuted());
  }, []);

  return { muted, toggleMute };
}
