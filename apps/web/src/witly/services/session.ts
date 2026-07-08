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
import { refreshSession, SupabaseAuthError } from "./supabaseAuth";

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

/**
 * localStorage key under which the Witly session is persisted so it survives a
 * page reload. This is the FAST primary store used during normal operation.
 *
 * ⚠️ Element wipes ALL of localStorage on any hard logout
 * (`Lifecycle.clearStorage` → `window.localStorage.clear()`), and a Matrix
 * access token dying (homeserver pod restart / expiry → `401 M_UNKNOWN_TOKEN`
 * without `soft_logout`) triggers exactly such a hard logout. That would take
 * our Supabase tokens down with it and dump the user at the sign-in screen.
 *
 * To survive that wipe we ALSO mirror the session into a dedicated IndexedDB
 * database ({@link IDB_NAME}) that Element never touches — see {@link idbWrite}.
 * On hydrate we fall back to IndexedDB when localStorage has been cleared and
 * re-seed localStorage from it, so an involuntary Matrix logout no longer costs
 * the user their Witly (backend) session — we can silently re-provision Matrix.
 */
const STORAGE_KEY = "witly.session";

// ── Durable IndexedDB backup ─────────────────────────────────────────────────
// A private DB, separate from every store Element manages ("account", crypto,
// sync, EventIndex). Element's logout only clears those + localStorage/session
// storage, so this backup outlives a hard logout.
const IDB_NAME = "witly";
const IDB_STORE = "kv";
const IDB_KEY = "session";
const IDB_VERSION = 1;

function openWitlyDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        try {
            if (typeof indexedDB === "undefined") return resolve(null);
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function idbWrite(value: WitlySessionData): Promise<void> {
    const db = await openWitlyDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
    });
    db.close();
}

async function idbRead(): Promise<unknown> {
    const db = await openWitlyDb();
    if (!db) return null;
    const result = await new Promise<unknown>((resolve) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
    });
    db.close();
    return result;
}

async function idbDelete(): Promise<void> {
    const db = await openWitlyDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
    });
    db.close();
}

/** Parse + validate an arbitrary persisted value into a session. Returns null if invalid. */
function validateSession(value: unknown): WitlySessionData | null {
    if (!value || typeof value !== "object") return null;
    const parsed = value as Partial<WitlySessionData>;
    if (
        typeof parsed.supabaseToken === "string" &&
        typeof parsed.supabaseRefreshToken === "string" &&
        typeof parsed.supabaseTokenExpiresAt === "number" &&
        typeof parsed.userId === "string"
    ) {
        return {
            supabaseToken: parsed.supabaseToken,
            supabaseRefreshToken: parsed.supabaseRefreshToken,
            supabaseTokenExpiresAt: parsed.supabaseTokenExpiresAt,
            userId: parsed.userId,
            email: parsed.email ?? null,
        };
    }
    return null;
}

class WitlySession {
    private data: WitlySessionData | null = null;
    private listeners = new Set<Listener>();
    private refreshInFlight: Promise<string> | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    public get(): WitlySessionData | null {
        return this.data;
    }

    public isAuthenticated(): boolean {
        return this.data !== null;
    }

    public set(session: WitlySessionData): void {
        this.data = session;
        this.persist();
        this.scheduleRefresh();
        this.emit();
    }

    public clear(): void {
        this.data = null;
        this.cancelScheduledRefresh();
        this.persist();
        this.emit();
    }

    /**
     * Restore a persisted session into memory. Called once on module load so a
     * reloaded — or involuntarily logged-out — but still signed-in user keeps
     * their Witly session.
     *
     * Reads the fast localStorage copy first; if that's gone (Element wiped it
     * during a hard logout) it falls back to the durable IndexedDB backup and
     * re-seeds localStorage from it. Safe to call when nothing is stored.
     */
    public async hydrate(): Promise<void> {
        if (this.data) return;

        const fromLocal = validateSession(this.readLocalStorage());
        if (fromLocal) {
            this.data = fromLocal;
            // Ensure the durable backup exists (e.g. first run after this change).
            void idbWrite(fromLocal);
            this.scheduleRefresh();
            this.emit();
            return;
        }

        // localStorage was empty/cleared — try the backup Element can't touch.
        const fromIdb = validateSession(await idbRead());
        if (fromIdb) {
            witlyLog.info("restored Witly session from IndexedDB backup after storage wipe");
            this.data = fromIdb;
            this.writeLocalStorage(fromIdb); // re-seed the fast primary
            this.scheduleRefresh();
            this.emit();
        }
    }

    private readLocalStorage(): unknown {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            witlyLog.warn("failed to read persisted session", err);
            return null;
        }
    }

    private writeLocalStorage(data: WitlySessionData): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (err) {
            witlyLog.warn("failed to persist session", err);
        }
    }

    private persist(): void {
        if (this.data) {
            this.writeLocalStorage(this.data);
            void idbWrite(this.data);
        } else {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch (err) {
                witlyLog.warn("failed to clear persisted session", err);
            }
            void idbDelete();
        }
    }

    /** Subscribe to session changes. Returns an unsubscribe function. */
    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const l of this.listeners) l(this.data);
    }

    // ── Token refresh ────────────────────────────────────────────────────────

    /**
     * Return a valid Supabase access token, proactively refreshing if it is
     * within {@link REFRESH_THRESHOLD_MS} of expiry. Throws if not authenticated.
     */
    public async getValidToken(): Promise<string> {
        const session = this.data;
        if (!session) throw new Error("Not authenticated");

        const msRemaining = session.supabaseTokenExpiresAt - Date.now();
        if (msRemaining >= REFRESH_THRESHOLD_MS) {
            return session.supabaseToken;
        }
        return this.refresh();
    }

    /** Force a refresh regardless of expiry (used by the API client after a 401). */
    public forceRefresh(): Promise<string> {
        return this.refresh();
    }

    /**
     * Single-flight refresh. EVERY caller — proactive expiry, the 401 retry, and
     * the background timer — shares one in-flight request so the rotating
     * Supabase refresh token is never spent twice within this tab. Spending it
     * twice trips Supabase's refresh-token reuse detection, which revokes the
     * entire token family and forces a full re-login.
     */
    private refresh(): Promise<string> {
        if (this.refreshInFlight) return this.refreshInFlight;
        this.refreshInFlight = this.doRefresh().finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }

    private async doRefresh(): Promise<string> {
        const session = this.data;
        if (!session) throw new Error("Not authenticated");

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
            // Only a definitive auth rejection (400/401 = the refresh token is
            // invalid or already used) means the session is truly dead — clear
            // it so the user re-signs in. Transient network/server errors keep
            // the session intact so a blip doesn't force a logout; the next call
            // will retry.
            if (err instanceof SupabaseAuthError && (err.status === 400 || err.status === 401)) {
                witlyLog.error("refresh token rejected — clearing session", err);
                this.clear();
                throw new Error("Session expired — please sign in again");
            }
            witlyLog.warn("token refresh failed transiently — keeping session", err);
            throw err;
        }
    }

    /**
     * Schedule a proactive refresh shortly before the access token expires, so a
     * long-idle tab (no API activity) keeps its session alive instead of only
     * refreshing reactively on the next 401.
     */
    private scheduleRefresh(): void {
        this.cancelScheduledRefresh();
        if (!this.data || typeof window === "undefined") return;
        const delay = Math.max(0, this.data.supabaseTokenExpiresAt - Date.now() - REFRESH_THRESHOLD_MS);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.refresh().catch((err) => witlyLog.warn("scheduled refresh failed", err));
        }, delay);
    }

    private cancelScheduledRefresh(): void {
        if (this.refreshTimer !== null) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}

/** Singleton Witly session. */
export const witlySession = new WitlySession();
