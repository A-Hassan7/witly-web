/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Bridges a completed Supabase authentication into the Witly session.
 *
 * Both the OTP flows (which return a full `SupabaseSession`) and the OAuth /
 * magic-link redirect (which returns only raw tokens) funnel through here so
 * the {@link witlySession} is populated consistently before provisioning.
 */

import { getCurrentUser, type SupabaseSession } from "../services/supabaseAuth";
import { witlySession } from "../services/session";

interface Tokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    userId?: string;
    email?: string | null;
}

async function establish(tokens: Tokens): Promise<void> {
    let { userId, email } = tokens;

    // The redirect path gives us tokens but no user; resolve via Supabase.
    if (!userId) {
        const user = await getCurrentUser(tokens.accessToken);
        userId = user.id;
        email = user.email;
    }

    witlySession.set({
        supabaseToken: tokens.accessToken,
        supabaseRefreshToken: tokens.refreshToken,
        supabaseTokenExpiresAt: Date.now() + tokens.expiresIn * 1000,
        userId: userId!,
        email: email ?? null,
    });
}

export function establishFromSupabaseSession(session: SupabaseSession): Promise<void> {
    return establish({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresIn: session.expires_in,
        userId: session.user.id,
        email: session.user.email,
    });
}

export function establishFromTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    return establish({ accessToken, refreshToken, expiresIn });
}
