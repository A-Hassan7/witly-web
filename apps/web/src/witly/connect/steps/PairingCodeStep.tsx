/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Step 4 — show the WhatsApp pairing code and wait for the user to enter it on
 * their phone. The parent long-polls the bridge; this step is presentational.
 */

import React, { type JSX } from "react";

import { StepIllustration } from "./StepIllustration";

interface PairingCodeStepProps {
    code: string | null;
    copied: boolean;
    onCopy: () => void;
    error: string | null;
    onStartOver: () => void;
}

export function PairingCodeStep({ code, copied, onCopy, error, onStartOver }: PairingCodeStepProps): JSX.Element {
    // On failure (including the long-poll timing out) replace the code and all
    // the waiting UI with a single clear recovery path back to number entry.
    if (error) {
        return (
            <div className="witly_Connect_step witly_Connect_step--centered">
                <StepIllustration glyph="😵‍💫" alt="Something went wrong linking WhatsApp" />
                <h2 className="witly_Connect_title">That didn't work</h2>
                <p className="witly_Connect_subtitle">{error}</p>
                <button type="button" className="witly_Btn witly_Btn--primary" onClick={onStartOver}>
                    Try again
                </button>
            </div>
        );
    }

    return (
        <div className="witly_Connect_step witly_Connect_step--centered">
            <StepIllustration
                glyph="🔔"
                alt="WhatsApp sends a notification asking to link a device — tap it and enter this code"
            />
            <h2 className="witly_Connect_title">Check your phone for a WhatsApp alert</h2>
            <p className="witly_Connect_subtitle">
                WhatsApp should send you a notification asking to link a new device. Open it and enter the
                code below to finish connecting.
            </p>

            {code ? (
                <button
                    type="button"
                    className="witly_Connect_code"
                    onClick={onCopy}
                    title="Copy to clipboard"
                >
                    <span className="witly_Connect_code_value">{code}</span>
                    <span className="witly_Connect_code_hint">{copied ? "Copied!" : "Tap to copy"}</span>
                </button>
            ) : (
                <div className="witly_Connect_waiting">
                    <div className="witly_Connect_spinner" aria-hidden="true" />
                    <span>Getting your code…</span>
                </div>
            )}

            {code && (
                <div className="witly_Connect_waiting witly_Connect_waiting--subtle">
                    <div className="witly_Connect_spinner witly_Connect_spinner--sm" aria-hidden="true" />
                    <span>Waiting for you to confirm on WhatsApp…</span>
                </div>
            )}

            <details className="witly_Connect_help">
                <summary className="witly_Connect_help_summary">Didn't get a notification?</summary>
                <div className="witly_Connect_help_body">
                    <p>Link it manually from WhatsApp on your phone:</p>
                    <ol className="witly_Connect_help_steps">
                        <li>
                            Open <strong>WhatsApp</strong> and go to{" "}
                            <strong>Settings → Linked devices</strong>.
                        </li>
                        <li>
                            Tap <strong>Link a device</strong>, then choose{" "}
                            <strong>Link with phone number instead</strong>.
                        </li>
                        <li>Enter the code shown above.</li>
                    </ol>
                </div>
            </details>

            <button type="button" className="witly_Connect_link witly_Connect_link--lg" onClick={onStartOver}>
                Use a different number
            </button>
        </div>
    );
}
