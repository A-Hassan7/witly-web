/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Placeholder illustration slot for a wizard step.
 *
 * Real how-to artwork (static gif or short muted looping video showing the
 * WhatsApp "Linked devices" flow) drops in later — for now this renders a
 * branded gradient tile with an emoji so the layout is final. Pass `src` once
 * the asset exists and it will render the media instead of the placeholder.
 */

import React, { type JSX } from "react";

interface StepIllustrationProps {
    /** Big emoji/glyph shown in the placeholder tile. */
    glyph: string;
    /** Optional media source (image or video). When set, replaces the placeholder. */
    src?: string;
    /** Accessible description of what the illustration shows. */
    alt: string;
}

export function StepIllustration({ glyph, src, alt }: StepIllustrationProps): JSX.Element {
    if (src) {
        const isVideo = /\.(mp4|webm)$/i.test(src);
        return (
            <div className="witly_Connect_illo">
                {isVideo ? (
                    <video className="witly_Connect_illo_media" src={src} autoPlay muted loop playsInline aria-label={alt} />
                ) : (
                    <img className="witly_Connect_illo_media" src={src} alt={alt} />
                )}
            </div>
        );
    }
    return (
        <div className="witly_Connect_illo witly_Connect_illo--placeholder" role="img" aria-label={alt}>
            <span className="witly_Connect_illo_glyph" aria-hidden="true">
                {glyph}
            </span>
        </div>
    );
}
