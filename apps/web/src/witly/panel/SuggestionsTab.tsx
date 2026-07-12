/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * SuggestionsTab — the panel's Suggestions surface (P5).
 *
 * Wraps the P4 overflow {@link SuggestionsPanel} (all suggestions for the round,
 * grouped by source) and adds:
 *   • a per-chat mix summary with quick remove + "use global mix" reset;
 *   • an inline "create a Wit on the fly" form (shared {@link CreateWitForm}).
 *
 * Global/library mix editing stays in the Wits tab; this tab only tweaks the
 * mix for the current chat and offers a fast custom-Wit shortcut.
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";

import { SuggestionsPanel } from "../suggestions/SuggestionsPanel";
import { CreateWitForm } from "../wits/WitLibrary";
import { getWits, type WitCatalogEntry } from "../services/agchatApi";
import { witStore, type CustomWit } from "../wits/witStore";
import { witlyLog } from "../logger";
import "./panel.pcss";

export interface SuggestionsTabProps {
    roomId: string;
    /** Called when the user wants the full Wit library (jumps to the Wits tab). */
    onGoToWits?: () => void;
    /** Called after a suggestion is inserted so the host can close the panel. */
    onInserted?: () => void;
}

export function SuggestionsTab({ roomId, onGoToWits, onInserted }: SuggestionsTabProps): JSX.Element {
    const [presets, setPresets] = useState<WitCatalogEntry[]>([]);
    const [customWits, setCustomWits] = useState<CustomWit[]>(witStore.getCustomWits());
    const [effective, setEffective] = useState<string[]>(witStore.getEffectiveMix(roomId));
    const [hasOverride, setHasOverride] = useState<boolean>(witStore.hasRoomMixOverride(roomId));
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        const sync = (): void => {
            setCustomWits(witStore.getCustomWits());
            setEffective(witStore.getEffectiveMix(roomId));
            setHasOverride(witStore.hasRoomMixOverride(roomId));
        };
        sync();
        return witStore.subscribe(sync);
    }, [roomId]);

    useEffect(() => {
        void getWits()
            .then((res) => setPresets(res.wits))
            .catch((err) => witlyLog.warn("getWits (suggestions tab) failed", err));
    }, []);

    const nameFor = useMemo(() => {
        const map = new Map<string, { name: string; emoji: string }>();
        for (const p of presets) map.set(p.wit_id, { name: p.name, emoji: p.emoji });
        for (const c of customWits) map.set(c.id, { name: c.name, emoji: c.emoji || "✨" });
        return map;
    }, [presets, customWits]);

    const removeFromChat = async (witId: string): Promise<void> => {
        try {
            await witStore.setRoomMix(roomId, effective.filter((id) => id !== witId));
        } catch (err) {
            witlyLog.warn("setRoomMix (remove) failed", err);
        }
    };

    const resetToGlobal = async (): Promise<void> => {
        try {
            await witStore.setRoomMix(roomId, null);
        } catch (err) {
            witlyLog.warn("setRoomMix(null) failed", err);
        }
    };

    return (
        <div className="witly_SgTab">
            <section className="witly_SgTab_mix">
                <div className="witly_SgTab_mixHead">
                    <span className="witly_SgTab_mixTitle">
                        {hasOverride ? "This chat's mix" : "Your mix (global)"}
                    </span>
                    <div className="witly_SgTab_mixActions">
                        {hasOverride && (
                            <button type="button" className="witly_SgTab_link" onClick={() => void resetToGlobal()}>
                                Use global mix
                            </button>
                        )}
                        {onGoToWits && (
                            <button type="button" className="witly_SgTab_link" onClick={onGoToWits}>
                                Edit in Wits
                            </button>
                        )}
                    </div>
                </div>
                {effective.length === 0 ? (
                    <p className="witly_SgTab_mixEmpty">
                        No Wits in your mix yet. Add some from the Wits tab.
                    </p>
                ) : (
                    <ul className="witly_SgTab_chips">
                        {effective.map((id) => {
                            const meta = nameFor.get(id);
                            return (
                                <li key={id} className="witly_SgTab_chip">
                                    <span aria-hidden="true">{meta?.emoji ?? "💬"}</span>
                                    <span className="witly_SgTab_chipName">{meta?.name ?? id}</span>
                                    <button
                                        type="button"
                                        className="witly_SgTab_chipX"
                                        onClick={() => void removeFromChat(id)}
                                        aria-label={`Remove ${meta?.name ?? id} from this chat`}
                                    >
                                        ×
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {creating ? (
                    <CreateWitForm compact onCancel={() => setCreating(false)} onSaved={() => setCreating(false)} />
                ) : (
                    <button type="button" className="witly_Btn witly_SgTab_newWit" onClick={() => setCreating(true)}>
                        ✨ Create a Wit on the fly
                    </button>
                )}
            </section>

            <SuggestionsPanel roomId={roomId} onInserted={onInserted} />
        </div>
    );
}
