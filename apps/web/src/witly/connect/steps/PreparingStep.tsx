/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Step 2 — bridge is being deployed/registered. Playful wait screen shown while
 * `ensureBridgeReady` runs. On failure, offers a retry.
 */

import React, { type JSX } from "react";

import { StepIllustration } from "./StepIllustration";

interface PreparingStepProps {
    platformName: string;
    detail: string;
    error: string | null;
    onRetry: () => void;
}

export function PreparingStep({ platformName, detail, error, onRetry }: PreparingStepProps): JSX.Element {
    if (error) {
        return (
            <div className="witly_Connect_step witly_Connect_step--centered">
                <StepIllustration glyph="😵‍💫" alt="Something went wrong" />
                <h2 className="witly_Connect_title">That didn't work</h2>
                <p className="witly_Connect_subtitle">{error}</p>
                <button type="button" className="witly_Btn witly_Btn--primary" onClick={onRetry}>
                    Try again
                </button>
            </div>
        );
    }

    return (
        <div className="witly_Connect_step witly_Connect_step--centered">
            <StepIllustration glyph="🔧" alt={`Preparing your ${platformName} connection`} />
            <h2 className="witly_Connect_title">Warming up {platformName}…</h2>
            <p className="witly_Connect_subtitle">{detail}</p>
            <div className="witly_Connect_spinner" aria-hidden="true" />
        </div>
    );
}
