/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * OAuth / magic-link redirect handling.
 *
 * Google OAuth and email magic-link sign-in both return to the app with the
 * Supabase session encoded in the URL fragment, e.g.
 *   http://localhost:8080/#access_token=…&refresh_token=…&expires_in=3600
 *
 * Element uses hash-based routing (`/#/login`), so we must (a) detect the auth
 * fragment, (b) strip it from the URL before Element's router reacts to it, and
 * (c) hand the tokens to the onboarding flow.
 *
 * We capture at module load (while the fragment is still intact) and stash the
 * result; the onboarding flow consumes it on mount.
 */

import { witlyLog } from "../logger";

export interface ParsedAuthRedirect {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export interface AuthRedirectError {
    error: string;
    description?: string;
}

let stashedSession: ParsedAuthRedirect | null = null;
let stashedError: AuthRedirectError | null = null;

function parseFragment(): { session?: ParsedAuthRedirect; error?: AuthRedirectError } {
    const hash = window.location.hash ?? "";
    if (!hash.includes("access_token=") && !hash.includes("error=")) return {};

    // The fragment may be "#access_token=…" or, if a router prefix slipped in,
    // "#/access_token=…" — strip a leading "#" and optional "/".
    const query = hash.replace(/^#\/?/, "");
    const params = new URLSearchParams(query);

    // Clean the fragment immediately so tokens don't linger in history / the URL
    // bar and Element's router resumes normally.
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", clean);

    const error = params.get("error");
    if (error) {
        return { error: { error, description: params.get("error_description") ?? undefined } };
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return {};

    return {
        session: {
            accessToken,
            refreshToken,
            expiresIn: Number(params.get("expires_in") ?? 3600),
        },
    };
}

/** Called once at module load, while the URL fragment is still intact. */
export function captureAuthRedirect(): void {
    const { session, error } = parseFragment();
    if (session) {
        witlyLog.info("captured auth redirect session from URL");
        stashedSession = session;
    }
    if (error) {
        witlyLog.warn("auth redirect returned an error", error);
        stashedError = error;
    }
}

/** Consume the stashed redirect session (one-shot). */
export function takeAuthRedirectSession(): ParsedAuthRedirect | null {
    const v = stashedSession;
    stashedSession = null;
    return v;
}

/** Consume the stashed redirect error (one-shot). */
export function takeAuthRedirectError(): AuthRedirectError | null {
    const v = stashedError;
    stashedError = null;
    return v;
}

/** Peek whether a redirect (session or error) is pending, without consuming it. */
export function hasStashedAuthRedirect(): boolean {
    return stashedSession !== null || stashedError !== null;
}
