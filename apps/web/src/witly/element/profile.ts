/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * profile — Witly's write-capable bridge into Element's Matrix client for the
 * account-settings surface (display name + avatar), plus the Element sign-out
 * dispatch.
 *
 * ⚠️  SEAM / STABILITY BOUNDARY — read before editing.
 *
 * Like `askRoom.ts`, this module WRITES to the raw Matrix client (sets the
 * display name, uploads + sets the avatar) and fires an Element dispatcher
 * action (sign out). The module API only exposes a READ-ONLY `profile`
 * watchable and has no setter or logout hook, so this coupling is quarantined
 * here alongside `roomTimeline.ts` / `askRoom.ts`:
 *
 *   • These are the ONLY Witly files allowed to import `MatrixClientPeg` /
 *     touch the raw `matrix-js-sdk`, or to dispatch Element actions.
 *   • Sign-out uses Element's own `{ action: "logout" }` dispatch — the exact
 *     action Element's native profile sign-out button fires — so both the
 *     Matrix session and (via witlySession) the Supabase session are cleared
 *     through Element's normal logout path.
 *   • Recorded in PATCHES.md under "Direct-internal-import seams".
 */

import { MatrixClientPeg } from "../../MatrixClientPeg";
import defaultDispatcher from "../../dispatcher/dispatcher";

import { witlyLog } from "../logger";
import { witlySession } from "../services/session";
import { signOut as supabaseSignOut } from "../services/supabaseAuth";

export interface MatrixProfile {
    userId: string;
    displayName: string;
    /** HTTP URL for the avatar (already resolved from mxc://), or null. */
    avatarUrl: string | null;
}

/** Read the logged-in user's Matrix profile, or null if the client isn't ready. */
export function getMatrixProfile(): MatrixProfile | null {
    try {
        const client = MatrixClientPeg.get();
        if (!client) return null;
        const userId = client.getSafeUserId();
        const mxc = client.getUser(userId)?.avatarUrl ?? null;
        const avatarUrl = mxc ? client.mxcUrlToHttp(mxc, 96, 96, "crop") : null;
        return {
            userId,
            displayName: client.getUser(userId)?.displayName ?? userId,
            avatarUrl,
        };
    } catch (err) {
        witlyLog.warn("profile: getMatrixProfile failed", err);
        return null;
    }
}

/** Set the logged-in user's Matrix display name. */
export async function setMatrixDisplayName(name: string): Promise<void> {
    const client = MatrixClientPeg.safeGet();
    await client.setDisplayName(name);
}

/**
 * Upload an image file and set it as the user's Matrix avatar.
 * Returns the resolved HTTP URL for immediate display, or null on failure.
 */
export async function setMatrixAvatarFromFile(file: File): Promise<string | null> {
    const client = MatrixClientPeg.safeGet();
    const { content_uri: mxc } = await client.uploadContent(file, { type: file.type });
    await client.setAvatarUrl(mxc);
    return client.mxcUrlToHttp(mxc, 96, 96, "crop");
}

/**
 * Sign the user out through Element's normal logout flow. Best-effort clears
 * the Supabase session first (its tokens live in witlySession's durable store,
 * which Element's logout also wipes) then fires Element's `logout` action.
 */
export async function signOut(): Promise<void> {
    const session = witlySession.get();
    if (session) {
        try {
            await supabaseSignOut(session.supabaseToken);
        } catch (err) {
            witlyLog.warn("profile: Supabase logout failed (continuing with Element logout)", err);
        }
    }
    witlySession.clear();
    defaultDispatcher.dispatch({ action: "logout" });
}
