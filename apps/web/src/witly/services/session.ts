/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Witly session store — the single holder of the user's Supabase auth tokens.
 *
 * The old web-client coupled its API client to a Zustand store. To keep the
 * Witly module self-contained (and avoid adding Zustand to Element), this is a
 * tiny observable singleton with the same responsibilities:
 *   - hold the current Supabase access/refresh tokens + expiry
 *   - hand out a valid access token, proactively refreshing near expiry
 *   - notify listeners when the session changes (for React surfaces later)
 *
 * It does NOT hold the Matrix session — that belongs to Element's own client,
 * which Witly hydrates via the module API's `overwriteAccountAuth` during
 * onboarding (P1).
 */

import { witlyLog } from "../logger";
import { refreshSession } from "./supabaseAuth";

export interface WitlySessionData {
    supabaseToken: string;
    supabaseRefreshToken: string;
    /** Epoch ms when the access token expires. */
    supabaseTokenExpiresAt: number;
    userId: string;
    email: string | null;
}

type Listener = (session: WitlySessionData | null) => void;

const REFRESH_THRESHOLD_MS = 60_000; // refresh when < 60s remain

class WitlySession {
    private data: WitlySessionData | null = null;
    private listeners = new Set<Listener>();
    private refreshInFlight: Promise<string> | null = null;

    public get(): WitlySessionData | null {
        return this.data;
    }

    public isAuthenticated(): boolean {
        return this.data !== null;
    }

    public set(session: WitlySessionData): void {
        this.data = session;
        this.emit();
    }

    public clear(): void {
        this.data = null;
        this.emit();
    }

    /** Subscribe to session changes. Returns an unsubscribe function. */
    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const l of this.listeners) l(this.data);
    }

    /**
     * Return a valid Supabase access token, proactively refreshing if it is
     * within {@link REFRESH_THRESHOLD_MS} of expiry. Concurrent callers share a
     * single in-flight refresh. Throws if not authenticated.
     */
    public async getValidToken(): Promise<string> {
        const session = this.data;
        if (!session) throw new Error("Not authenticated");

        const msRemaining = session.supabaseTokenExpiresAt - Date.now();
        if (msRemaining >= REFRESH_THRESHOLD_MS) {
            return session.supabaseToken;
        }

        if (!this.refreshInFlight) {
            this.refreshInFlight = this.doRefresh(session).finally(() => {
                this.refreshInFlight = null;
            });
        }
        return this.refreshInFlight;
    }

    private async doRefresh(session: WitlySessionData): Promise<string> {
        witlyLog.info("Supabase token near expiry — refreshing");
        try {
            const next = await refreshSession(session.supabaseRefreshToken);
            this.set({
                supabaseToken: next.access_token,
                supabaseRefreshToken: next.refresh_token,
                supabaseTokenExpiresAt: Date.now() + next.expires_in * 1000,
                userId: session.userId,
                email: session.email,
            });
            return next.access_token;
        } catch (err) {
            witlyLog.warn("token refresh failed — using existing token", err);
            return session.supabaseToken;
        }
    }

    /**
     * Force a refresh (used by the API client after a 401). Returns the new
     * access token, or throws and clears the session if refresh fails.
     */
    public async forceRefresh(): Promise<string> {
        const session = this.data;
        if (!session) throw new Error("Not authenticated");
        try {
            const next = await refreshSession(session.supabaseRefreshToken);
            this.set({
                supabaseToken: next.access_token,
                supabaseRefreshToken: next.refresh_token,
                supabaseTokenExpiresAt: Date.now() + next.expires_in * 1000,
                userId: session.userId,
                email: session.email,
            });
            return next.access_token;
        } catch (err) {
            witlyLog.error("forced token refresh failed — clearing session", err);
            this.clear();
            throw new Error("Session expired — please sign in again");
        }
    }
}

/** Singleton Witly session. */
export const witlySession = new WitlySession();
