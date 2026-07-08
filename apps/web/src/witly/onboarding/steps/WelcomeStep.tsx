/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

interface Props {
    onGetStarted: () => void;
}

/**
 * First screen of onboarding — the Witly welcome. One-line value prop and a
 * single "Get started" call to action into the auth step.
 */
export function WelcomeStep({ onGetStarted }: Props): JSX.Element {
    return (
        <>
            <div className="witly_Onboarding_brand">
                <span className="witly_Onboarding_spark" aria-hidden="true">
                    ✨
                </span>
                <span>Witly</span>
            </div>

            <h1 className="witly_Onboarding_title">Be effortlessly witty</h1>
            <p className="witly_Onboarding_subtitle">
                One inbox for all your chats — plus an AI that hands you the perfect reply, right when you need it.
            </p>

            <div className="witly_Onboarding_actions">
                <button type="button" className="witly_Btn witly_Btn--primary" onClick={onGetStarted}>
                    Get started
                </button>
            </div>
        </>
    );
}
