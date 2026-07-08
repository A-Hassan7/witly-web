/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useRef, useState } from "react";
import type { AccountAuthInfo } from "@element-hq/element-web-module-api";

import { witlyLog } from "../../logger";
import { provisionMatrixSession } from "../provisioning";
import { armDeviceVerificationSkip } from "../skipDeviceVerification";
import { traceLoginProgress } from "../loginProgress";

interface Props {
    onProvisioned: (creds: AccountAuthInfo) => void;
}

// After credentials are handed to Element, the view stays on this screen until
// Element's first sync completes. If that stalls, surface an actionable error
// rather than spinning forever. Fresh homeservers sync near-instantly, so this
// is generous headroom, not a normal-path deadline.
const HANDOFF_TIMEOUT_MS = 60_000;

// Rotating, on-brand status lines shown while the homeserver spins up.
const WITTY_LINES = [
    "Warming up your wit…",
    "Teaching the AI your sense of humour…",
    "Polishing your comebacks…",
    "Finding the funny…",
    "Setting up your private inbox…",
    "Almost showtime…",
];

/**
 * Interim provisioning wait screen (P1). In the full flow this latency is
 * masked by the Wit Explorer; until that exists, we show a playful branded wait
 * with rotating witty status lines while the homeserver provisions, then hand
 * the Matrix credentials back to Element.
 */
export function ProvisioningStep({ onProvisioned }: Props): JSX.Element {
    const [lineIndex, setLineIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    // Guard against React 18 StrictMode double-invoke in dev: provisioning + the
    // Element login handoff is a one-shot global side effect and must run exactly
    // once for the component's lifetime, not once per mount.
    const startedRef = useRef(false);
    // Tracks whether the component is still on screen, so we never setState after
    // the true unmount. NOT tied to the provisioning run — StrictMode's throwaway
    // unmount must not abort the in-flight handoff (that was the "stuck on
    // provisioning" bug: the discarded mount's cleanup cancelled the real run).
    const mountedRef = useRef(true);
    // Detaches login instrumentation (device-verify skip + progress trace) from a
    // PREVIOUS run before a retry re-arms it. NOT invoked on unmount: the
    // verification screen and first sync happen AFTER this component unmounts
    // (the view leaves LOGIN), so the skip/trace must outlive it. They self-clean
    // on their own terminal conditions / safety timeouts.
    const teardownRef = useRef<(() => void) | undefined>(undefined);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Rotate the witty status lines.
    useEffect(() => {
        const id = window.setInterval(() => {
            setLineIndex((i) => (i + 1) % WITTY_LINES.length);
        }, 2800);
        return () => window.clearInterval(id);
    }, []);

    // Drive provisioning.
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        void (async () => {
            let handoffTimer: number | undefined;
            try {
                const creds = await provisionMatrixSession();
                // Tear down any instrumentation from a previous (retried) run.
                teardownRef.current?.();
                // Arm the device-verification auto-skip BEFORE the handoff so it is
                // already listening when Element's post-login crypto flow reaches
                // the "Confirm your digital identity" prompt (~a few seconds later).
                const disarmSkip = armDeviceVerificationSkip();
                // Trace each Element login milestone (client start, crypto, first
                // sync). The view stays on this screen until the first sync
                // completes, so if that stalls this pinpoints where.
                const stopTrace = traceLoginProgress();
                teardownRef.current = () => {
                    disarmSkip();
                    stopTrace();
                };
                // `onProvisioned` hands the creds to Element (Lifecycle.setLoggedIn).
                // It is typed `=> void` but resolves asynchronously; await it so a
                // failure to hydrate the session surfaces here instead of being
                // swallowed and leaving the user stuck on this screen. Race a
                // timeout so a stalled first sync doesn't spin forever.
                await Promise.race([
                    Promise.resolve(onProvisioned(creds)),
                    new Promise((_resolve, reject) => {
                        handoffTimer = window.setTimeout(
                            () => reject(new Error("Signing in took too long. Please try again.")),
                            HANDOFF_TIMEOUT_MS,
                        );
                    }),
                ]);
                witlyLog.info("Element accepted credentials; login handoff complete");
            } catch (err) {
                witlyLog.error("provisioning failed", err);
                if (mountedRef.current) {
                    setError(err instanceof Error ? err.message : "Something went wrong setting up your account.");
                }
            } finally {
                if (handoffTimer !== undefined) window.clearTimeout(handoffTimer);
            }
        })();
        // Re-runs only when the user explicitly retries (attempt changes).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]);

    const retry = (): void => {
        setError(null);
        startedRef.current = false;
        setAttempt((a) => a + 1);
    };

    if (error) {
        return (
            <div className="witly_Provisioning">
                <span className="witly_Provisioning_spark" aria-hidden="true">
                    😵‍💫
                </span>
                <div className="witly_Onboarding_error">{error}</div>
                <div className="witly_Onboarding_actions">
                    <button type="button" className="witly_Btn witly_Btn--primary" onClick={retry}>
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="witly_Provisioning">
            <span className="witly_Provisioning_spark" aria-hidden="true">
                ✨
            </span>
            <div className="witly_Provisioning_status" aria-live="polite">
                {WITTY_LINES[lineIndex]}
            </div>
            <div className="witly_Provisioning_hint">This only takes a moment.</div>
        </div>
    );
}
