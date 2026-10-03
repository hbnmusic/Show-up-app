import { useCallback, useEffect, useState } from 'react';

import { acceptTerms, fetchTermsAccepted } from './community/api';
import { TERMS_VERSION } from './legal';

/** Whether the signed-in person has accepted the current Terms of Use (null while checking). */
export function useTerms(userId: string | null) {
  const [state, setState] = useState<{ user: string | null; accepted: boolean | null }>({ user: null, accepted: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetchTermsAccepted(userId, TERMS_VERSION).then((r) => {
      if (live) setState({ user: userId, accepted: r.ok ? r.data : false });
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const accept = useCallback(async () => {
    setError(null);
    const r = await acceptTerms(TERMS_VERSION);
    if (r.ok) setState({ user: userId, accepted: true });
    else setError(r.error);
    return r.ok;
  }, [userId]);

  const accepted = userId && state.user === userId ? state.accepted : null;
  return { accepted, accept, error };
}
