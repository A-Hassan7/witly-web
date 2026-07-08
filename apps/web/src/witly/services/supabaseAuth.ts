/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Thin wrappers around the Supabase Auth REST API (no Supabase JS SDK needed).
 *
 * Ported from the old web-client and extended with the auth methods Witly's
 * onboarding uses:
 *   - Google OAuth        (redirect)      — ported
 *   - Email magic link    (passwordless)  — NEW
 *   - Phone / SMS OTP      (send + verify) — NEW
 *
 * NOTE (copy guard, see spec §5.1): the account-level phone OTP here is a
 * DIFFERENT thing from the WhatsApp phone-login pairing flow. UI copy must not
 * conflate the two number entries.
 */

import { getSupabaseKey, getSupabaseUrl } from "../config";

export interface SupabaseSession {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: {
        id: string;
        email: string | null;
        phone?: string | null;
    };
}

export interface SupabaseUser {
    id: string;
    email: string | null;
    phone?: string | null;
}

/**
 * Error thrown by the Supabase auth wrappers, carrying the HTTP status so
 * callers can distinguish a definitive rejection (e.g. a 400/401 for an
 * invalid/already-used refresh token — the session is truly dead) from a
 * transient network/server error that should NOT destroy the session.
 */
export class SupabaseAuthError extends Error {
    public readonly status: number;

    public constructor(message: string, status: number) {
        super(message);
        this.name = "SupabaseAuthError";
        this.status = status;
    }
}

function headers(): HeadersInit {
    return {
        "Content-Type": "application/json",
        // The anon key identifies the Supabase project; it is intentionally
        // public — Row Level Security controls data access.
        apikey: getSupabaseKey(),
    };
}

function extractError(data: unknown, fallback: string): string {
    const d = data as { error_description?: string; msg?: string; error?: string; message?: string };
    return d?.error_description ?? d?.msg ?? d?.error ?? d?.message ?? fallback;
}

async function postForSession(path: string, body: Record<string, unknown>): Promise<SupabaseSession> {
    const res = await fetch(`${getSupabaseUrl()}${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new SupabaseAuthError(extractError(data, String(res.status)), res.status);
    return data as SupabaseSession;
}

async function postVoid(path: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${getSupabaseUrl()}${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        let data: unknown = undefined;
        try {
            data = await res.json();
        } catch {
            /* ignore */
        }
        throw new Error(extractError(data, String(res.status)));
    }
}

// ── Token lifecycle ─────────────────────────────────────────────────────────

export function refreshSession(refreshToken: string): Promise<SupabaseSession> {
    return postForSession("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

export async function getCurrentUser(accessToken: string): Promise<SupabaseUser> {
    const res = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
        method: "GET",
        headers: { ...headers(), Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(extractError(data, String(res.status)));
    return data as SupabaseUser;
}

// ── Google OAuth (redirect) ─────────────────────────────────────────────────

/**
 * Redirect the browser to Supabase's Google OAuth consent screen. On success
 * Supabase redirects back with the session in the URL fragment.
 */
export function signInWithGoogle(redirectTo?: string): void {
    const params = new URLSearchParams({ provider: "google" });
    if (redirectTo) params.set("redirect_to", redirectTo);
    window.location.href = `${getSupabaseUrl()}/auth/v1/authorize?${params.toString()}`;
}

// ── Email magic link (passwordless) ─────────────────────────────────────────

/**
 * Send a passwordless magic-link (OTP) email. Supabase emails a link the user
 * clicks to complete sign-in. `create_user: true` signs up new users too.
 */
export function sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    const body: Record<string, unknown> = { email, create_user: true };
    if (redirectTo) body.options = { email_redirect_to: redirectTo };
    return postVoid("/auth/v1/otp", body);
}

// ── Phone / SMS OTP ─────────────────────────────────────────────────────────
// (Account sign-in — NOT the WhatsApp pairing flow. See copy guard above.)

/** Send a one-time SMS code to the given E.164 phone number. */
export function sendPhoneOtp(phone: string): Promise<void> {
    return postVoid("/auth/v1/otp", { phone, create_user: true });
}

/** Verify an SMS OTP code and return a full session on success. */
export function verifyPhoneOtp(phone: string, token: string): Promise<SupabaseSession> {
    return postForSession("/auth/v1/verify", { type: "sms", phone, token });
}

/** Verify an email OTP code (the numeric alternative to the magic link). */
export function verifyEmailOtp(email: string, token: string): Promise<SupabaseSession> {
    return postForSession("/auth/v1/verify", { type: "email", email, token });
}

// ── Sign out ────────────────────────────────────────────────────────────────

export async function signOut(accessToken: string): Promise<void> {
    await fetch(`${getSupabaseUrl()}/auth/v1/logout`, {
        method: "POST",
        headers: { ...headers(), Authorization: `Bearer ${accessToken}` },
    });
}
