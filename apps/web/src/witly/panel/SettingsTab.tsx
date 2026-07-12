/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * SettingsTab — per-chat Witly settings (P5).
 *
 * Currently just the suggestion-timing mode (Manual / Smart) for this chat,
 * with a "use global default" reset. Per-chat mix editing lives in the
 * Suggestions tab. Global preferences are a later phase — a link out is stubbed
 * here so the seam exists.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";

import { witStore, type TimingMode } from "../wits/witStore";
import { witlyLog } from "../logger";
import "./panel.pcss";

export interface SettingsTabProps {
    roomId: string;
}

export function SettingsTab({ roomId }: SettingsTabProps): JSX.Element {
    const [timing, setTiming] = useState<TimingMode>(witStore.getTimingMode(roomId));
    const [hasOverride, setHasOverride] = useState<boolean>(false);

    useEffect(() => {
        const sync = (): void => {
            setTiming(witStore.getTimingMode(roomId));
            // A room "override" exists when its effective timing differs from global,
            // or when it was explicitly set. We approximate via getTimingMode vs global.
            setHasOverride(witStore.getTimingMode(roomId) !== witStore.getTimingMode());
        };
        sync();
        return witStore.subscribe(sync);
    }, [roomId]);

    const choose = useCallback(
        async (mode: TimingMode) => {
            try {
                await witStore.setRoomTiming(roomId, mode);
            } catch (err) {
                witlyLog.warn("setRoomTiming failed", err);
            }
        },
        [roomId],
    );

    const resetToGlobal = useCallback(async () => {
        try {
            await witStore.setRoomTiming(roomId, null);
        } catch (err) {
            witlyLog.warn("setRoomTiming(null) failed", err);
        }
    }, [roomId]);

    return (
        <div className="witly_Settings">
            <section className="witly_Settings_section">
                <h3 className="witly_Settings_title">Suggestion timing</h3>
                <p className="witly_Settings_hint">
                    Choose how Witly offers reply suggestions in this chat.
                </p>
                <div className="witly_Settings_choices" role="radiogroup" aria-label="Suggestion timing">
                    <button
                        type="button"
                        role="radio"
                        aria-checked={timing === "manual"}
                        className={`witly_Btn witly_Settings_choice${timing === "manual" ? " witly_Settings_choice--on" : ""}`}
                        onClick={() => void choose("manual")}
                    >
                        <span className="witly_Settings_choiceName">Manual</span>
                        <span className="witly_Settings_choiceDesc">Only when you tap the Witly button.</span>
                    </button>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={timing === "smart"}
                        className={`witly_Btn witly_Settings_choice${timing === "smart" ? " witly_Settings_choice--on" : ""}`}
                        onClick={() => void choose("smart")}
                    >
                        <span className="witly_Settings_choiceName">Smart</span>
                        <span className="witly_Settings_choiceDesc">Automatically after a new incoming message.</span>
                    </button>
                </div>
                {hasOverride && (
                    <button type="button" className="witly_Settings_reset" onClick={() => void resetToGlobal()}>
                        Use global default
                    </button>
                )}
            </section>

            <section className="witly_Settings_section">
                <h3 className="witly_Settings_title">Global preferences</h3>
                <p className="witly_Settings_hint">
                    Account-wide Witly settings live in your global preferences (coming soon).
                </p>
            </section>
        </div>
    );
}
