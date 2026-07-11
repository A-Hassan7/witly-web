/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * SuggestionsPanel — the overflow surface for in-room suggestions (P4 slice).
 *
 * Shows EVERY suggestion for the current round, grouped by source (Wit /
 * Wildcard), plus the credit states (90% "near limit" banner and the 402
 * "out of credits" upgrade prompt). The carousel above the composer shows only
 * each source's top pick; this panel is where the rest live.
 *
 * Opened as an Element module dialog (same mechanism as the Wit Library). The
 * full multi-tab panel (Ask AI / Wits / Settings) is a later phase (P5); this
 * is intentionally just the suggestions overflow.
 */

import React, { type JSX } from "react";

import type { DialogProps } from "@element-hq/element-web-module-api";

import { useRoomSuggestions } from "./useRoomSuggestions";
import { insertSuggestionIntoComposer } from "../element/moduleApi";
import { type SourceState } from "./types";
import "./suggestions.pcss";

export interface SuggestionsPanelProps {
    roomId: string;
    /** Called after a suggestion is inserted so the host can close the dialog. */
    onInserted?: () => void;
}

function SourceGroup({
    source,
    onInsert,
    onRegenerate,
}: {
    source: SourceState;
    onInsert: (text: string) => void;
    onRegenerate: () => void;
}): JSX.Element {
    const { source: meta, status, suggestions, error } = source;
    return (
        <section className={`witly_SgGroup witly_SgGroup--${meta.kind}`}>
            <header className="witly_SgGroup_head">
                <span className="witly_SgGroup_emoji" aria-hidden="true">
                    {meta.emoji}
                </span>
                <span className="witly_SgGroup_name">{meta.label}</span>
                <button
                    type="button"
                    className="witly_Btn witly_SgGroup_regen"
                    onClick={onRegenerate}
                    disabled={status === "loading"}
                >
                    {status === "loading" ? "…" : "Regenerate"}
                </button>
            </header>

            {status === "error" && <p className="witly_Sg_error">{error ?? "Generation failed"}</p>}
            {status === "loading" && suggestions.length === 0 && (
                <p className="witly_Sg_loading">Thinking…</p>
            )}

            <ul className="witly_SgGroup_list">
                {suggestions.map((text, i) => (
                    <li key={i}>
                        <button type="button" className="witly_SgCard" onClick={() => onInsert(text)}>
                            {text}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function SuggestionsPanel({ roomId, onInserted }: SuggestionsPanelProps): JSX.Element {
    const { state, regenerate } = useRoomSuggestions(roomId);

    const insert = (text: string): void => {
        if (insertSuggestionIntoComposer(text)) onInserted?.();
    };

    return (
        <div className="witly_Sg_panel">
            {state.creditsExhausted && (
                <div className="witly_Sg_banner witly_Sg_banner--error">
                    You're out of AI credits. Upgrade to keep getting suggestions.
                </div>
            )}
            {!state.creditsExhausted && state.nearLimit && (
                <div className="witly_Sg_banner witly_Sg_banner--warn">
                    You've used 90% of your AI credits this period.
                </div>
            )}

            {state.order.length === 0 ? (
                <p className="witly_Sg_empty">No suggestions yet. Tap the Witly button to generate some.</p>
            ) : (
                state.order.map((key) => {
                    const source = state.bySource[key];
                    if (!source) return null;
                    return (
                        <SourceGroup
                            key={key}
                            source={source}
                            onInsert={insert}
                            onRegenerate={() => regenerate(key)}
                        />
                    );
                })
            )}
        </div>
    );
}

/** Extra props injected when opening the panel via the module `openDialog`. */
export interface SuggestionsPanelDialogProps {
    roomId: string;
}

/** Dialog wrapper so the panel can be opened via the Element module `openDialog`. */
export function SuggestionsPanelDialog(
    props: SuggestionsPanelDialogProps & DialogProps<Record<string, never>>,
): JSX.Element {
    return <SuggestionsPanel roomId={props.roomId} onInserted={() => props.onCancel()} />;
}
