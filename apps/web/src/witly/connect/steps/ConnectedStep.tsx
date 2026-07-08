/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Step 5 — success. The bridge reported the login as CONNECTED; conversations
 * will begin syncing into the inbox shortly.
 */

import React, { type JSX } from "react";

import { StepIllustration } from "./StepIllustration";

interface ConnectedStepProps {
    platformName: string;
    onDone: () => void;
}

export function ConnectedStep({ platformName, onDone }: ConnectedStepProps): JSX.Element {
    return (
        <div className="witly_Connect_step witly_Connect_step--centered">
            <StepIllustration glyph="🎉" alt={`${platformName} connected`} />
            <h2 className="witly_Connect_title">{platformName} is connected!</h2>
            <p className="witly_Connect_subtitle">
                Your chats are on their way in. It can take a moment for everything to show up.
            </p>
            <button type="button" className="witly_Btn witly_Btn--primary" onClick={onDone}>
                Take me to my chats
            </button>
        </div>
    );
}
