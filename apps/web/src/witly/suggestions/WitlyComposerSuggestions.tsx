/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * WitlyComposerSuggestions — the above-composer suggestion surface (P4).
 *
 * This is the single Witly component mounted by the one composer seam in
 * Element's `MessageComposer.tsx` (see PATCHES.md seam #3). It renders:
 *   • the ✨ Witly button (Manual trigger + panel opener), always visible;
 *   • the horizontal carousel of top-pick cards (one per source, Wildcard
 *     distinct), each of which INSERTS an editable draft on tap;
 *   • inline credit banners (near-limit / exhausted).
 *
 * All logic lives in the engine + hook; this component is presentational. It
 * self-hides its carousel when there is nothing to show, and degrades to a
 * "build your mix" affordance when the mix is empty — so the seam is always
 * safe to render.
 */

import React, { type JSX } from "react";

import { useRoomSuggestions } from "./useRoomSuggestions";
import { insertSuggestionIntoComposer } from "../element/moduleApi";
import { openWitlyPanel } from "../element/registerPanel";
import { openWitLibraryDialog } from "../element/registerWits";
import "./suggestions.pcss";

export interface WitlyComposerSuggestionsProps {
    roomId: string;
}

export function WitlyComposerSuggestions({ roomId }: WitlyComposerSuggestionsProps): JSX.Element | null {
    const { state, picks, mixCount, generate, regenerate } = useRoomSuggestions(roomId);

    const generating = state.status === "generating";
    const hasCards = picks.length > 0;

    const onButtonClick = (): void => {
        if (mixCount === 0) {
            openWitLibraryDialog();
            return;
        }
        generate();
    };

    const insert = (text: string): void => {
        insertSuggestionIntoComposer(text);
    };

    return (
        <div className="witly_ComposerSuggestions">
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

            {hasCards && (
                <div className="witly_ComposerSuggestions_carousel" role="list">
                    {picks.map(({ source, text }) => (
                        <div
                            key={source.key}
                            className={`witly_SgCard witly_SgCard--carousel witly_SgCard--${source.kind}`}
                            role="listitem"
                        >
                            <button
                                type="button"
                                className="witly_SgCard_body"
                                onClick={() => insert(text)}
                                title="Insert as an editable draft"
                            >
                                <span className="witly_SgCard_tag" aria-hidden="true">
                                    {source.emoji}
                                </span>
                                <span className="witly_SgCard_text">{text}</span>
                            </button>
                            <button
                                type="button"
                                className="witly_SgCard_regen"
                                onClick={() => regenerate(source.key)}
                                title={`Regenerate ${source.label}`}
                                aria-label={`Regenerate ${source.label}`}
                            >
                                ↻
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="witly_ComposerSuggestions_bar">
                <button
                    type="button"
                    className="witly_Btn witly_Btn--primary witly_ComposerSuggestions_go"
                    onClick={onButtonClick}
                    disabled={generating}
                >
                    {generating ? "Thinking…" : mixCount === 0 ? "✨ Build your Wit mix" : "✨ Suggest replies"}
                </button>
                {(hasCards || state.order.length > 0) && (
                    <button
                        type="button"
                        className="witly_Btn witly_ComposerSuggestions_more"
                        onClick={() => openWitlyPanel(roomId, "suggestions")}
                    >
                        More
                    </button>
                )}
            </div>
        </div>
    );
}
