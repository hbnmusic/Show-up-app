import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Current time, refreshed every minute and whenever the app returns to the front. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

/** True while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
