/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Step 3 — WhatsApp phone-number entry. Uses the dependency-free
 * {@link PhoneInput}. The parent submits the E.164 value to the bridge.
 */

import React, { type JSX } from "react";

import { PhoneInput } from "../PhoneInput";
import { StepIllustration } from "./StepIllustration";

interface PhoneEntryStepProps {
    phone: string;
    onPhoneChange: (value: string) => void;
    onSubmit: () => void;
    loading: boolean;
    error: string | null;
}

export function PhoneEntryStep({ phone, onPhoneChange, onSubmit, loading, error }: PhoneEntryStepProps): JSX.Element {
    // A bare "+<dial>" (no national digits) means nothing entered yet.
    const hasNumber = /\+\d+/.test(phone) && phone.replace(/\D/g, "").length > 4;

    return (
        <div className="witly_Connect_step">
            <StepIllustration glyph="📱" alt="Enter your WhatsApp phone number" />
            <h2 className="witly_Connect_title">What's your WhatsApp number?</h2>
            <p className="witly_Connect_subtitle">
                Pick your country and enter the number linked to your WhatsApp account. You'll get a code
                to confirm it's you.
            </p>

            <PhoneInput
                value={phone}
                onChange={onPhoneChange}
                disabled={loading}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && hasNumber && !loading) onSubmit();
                }}
            />

            {error && <p className="witly_Connect_error">{error}</p>}

            <button
                type="button"
                className="witly_Btn witly_Btn--primary"
                disabled={loading || !hasNumber}
                onClick={onSubmit}
            >
                {loading ? "Just a sec…" : "Continue"}
            </button>
        </div>
    );
}
