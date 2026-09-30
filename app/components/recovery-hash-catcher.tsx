"use client";

import { useEffect, useRef } from "react";
import { establishRecoverySession } from "@/app/auth/actions";
import { parseRecoveryFragment } from "@/lib/auth";

/**
 * Dashboard "Send password recovery" redirects to the Site URL with tokens in
 * the hash. The server never receives that fragment.
 */
export function RecoveryHashCatcher() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const parsed = parseRecoveryFragment(window.location.hash);
    if (!parsed) return;
    started.current = true;
    const data = new FormData();
    data.set("access_token", parsed.accessToken);
    data.set("refresh_token", parsed.refreshToken);
    void establishRecoverySession(data);
  }, []);

  return null;
}
