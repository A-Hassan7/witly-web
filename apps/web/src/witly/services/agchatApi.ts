/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Typed client for the AGChat control-plane API.
 *
 * Ported from the old web-client (`services/agchatApi.ts`) — the endpoint
 * surface is unchanged (the backend is reused as-is). Adaptations for the
 * Witly/Element module:
 *   - token management goes through {@link witlySession} instead of a Zustand
 *     store
 *   - the base URL comes from Witly config (`witly.api_base`) instead of
 *     `import.meta.env`
 *
 * Token behaviour is preserved: proactive refresh near expiry, and one retry
 * on a 401 after a forced refresh.
 */

import { getApiBase } from "../config";
import { witlyLog } from "../logger";
import { witlySession } from "./session";

// ── Response types ──────────────────────────────────────────────────────────

export type ProvisionStatus = "PROVISIONING" | "READY" | "ERROR";

export interface ProvisionStatusResponse {
    homeserver_id: string;
    status: ProvisionStatus;
    doublepuppet_registered: boolean;
    server_name: string | null;
    homeserver_url: string | null;
    matrix_user_id: string | null;
    matrix_access_token: string | null;
}

export type BridgeDeployStatus = "PROVISIONING" | "READY" | "ERROR" | "DELETED";
export type BridgeRegistrationStatus = "PENDING" | "REGISTERED" | "ERROR";
export type BridgeLoginStatus = "LOGGED_OUT" | "LOGGING_IN" | "CONNECTED" | "DISCONNECTED" | "ERROR";
export type BridgeService = "whatsapp" | "telegram" | "meta";

export interface BridgeStatusResponse {
    bridge_id: string;
    service: BridgeService;
    deploy_status: BridgeDeployStatus;
    registration_status: BridgeRegistrationStatus;
    login_status: BridgeLoginStatus;
}

export interface LoginFlow {
    id: string;
    name: string;
    description: string;
}

export interface LoginStepField {
    type: string; // 'username' | 'password' | 'phone_number' | 'email' | '2fa_code' | 'token' | 'select' | ...
    id: string;
    name: string;
    description?: string;
    default_value?: string;
    options?: string[];
}

// Matches the mautrix bridgev2 provisioning API v3 response shape.
export interface LoginStep {
    login_id?: string;
    step_id: string;
    type: "user_input" | "display_and_wait" | "cookies" | "complete";
    instructions?: string;
    display_and_wait?: {
        type: "qr" | "emoji" | "code" | "nothing";
        data?: string; // raw QR string / pairing code
        image_url?: string; // rendered QR image URL
    };
    user_input?: { fields: LoginStepField[] };
    complete?: Record<string, unknown>;
}

export type LoginFlowStartResponse = LoginStep & { login_id: string };

// ── Fetch helper ────────────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}, _retried = false): Promise<T> {
    const token = await witlySession.getValidToken();
    const method = init.method ?? "GET";

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");

    const res = await fetch(`${getApiBase()}${path}`, { ...init, headers });

    // On 401: force a refresh and retry once (server-side invalidation / skew).
    if (res.status === 401 && !_retried) {
        witlyLog.warn(`401 on ${path} — refreshing token and retrying`);
        try {
            await witlySession.forceRefresh();
        } catch (err) {
            // forceRefresh clears the session only on a definitive rejection; if
            // it's still authenticated the failure was transient — surface that
            // rather than telling the user their session expired.
            if (witlySession.isAuthenticated()) {
                throw err instanceof Error ? err : new Error("Couldn't reach the server. Please try again.");
            }
            throw new Error("401: Session expired — please sign in again");
        }
        return request<T>(path, init, true);
    }

    if (!res.ok) {
        let detail = String(res.status);
        try {
            const body = await res.json();
            detail = (body as { detail?: string }).detail ?? detail;
        } catch {
            /* ignore */
        }
        witlyLog.error(`request failed: ${method} ${path} → ${res.status}: ${detail}`);
        throw new Error(`${res.status}: ${detail}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const getMe = (): Promise<{ user_id: string }> => request<{ user_id: string }>("/auth/me");

// ── Provision ───────────────────────────────────────────────────────────────

export const postProvision = (): Promise<ProvisionStatusResponse> =>
    request<ProvisionStatusResponse>("/provision", { method: "POST" });

export const getProvisionStatus = (): Promise<ProvisionStatusResponse> =>
    request<ProvisionStatusResponse>("/provision/status");

export const deleteProvision = (): Promise<void> => request<void>("/provision", { method: "DELETE" });

// ── Account ─────────────────────────────────────────────────────────────────

export const deleteAccount = (confirm: string): Promise<void> =>
    request<void>("/account", { method: "DELETE", body: JSON.stringify({ confirm }) });

// ── Bridges ─────────────────────────────────────────────────────────────────

export const postBridge = (service: BridgeService): Promise<BridgeStatusResponse> =>
    request<BridgeStatusResponse>(`/bridges/${service}`, { method: "POST" });

export const getBridgeStatus = (service: BridgeService): Promise<BridgeStatusResponse> =>
    request<BridgeStatusResponse>(`/bridges/${service}/status`);

export const getAllBridges = (): Promise<BridgeStatusResponse[]> =>
    request<BridgeStatusResponse[]>("/bridges");

export const deleteBridge = (service: BridgeService): Promise<void> =>
    request<void>(`/bridges/${service}`, { method: "DELETE" });

// ── Bridge login flow ───────────────────────────────────────────────────────

export const getBridgeLoginFlows = (service: BridgeService): Promise<{ flows: LoginFlow[] }> =>
    request<{ flows: LoginFlow[] }>(`/bridges/${service}/login/flows`);

export const startBridgeLogin = (service: BridgeService, flowId: string): Promise<LoginFlowStartResponse> =>
    request<LoginFlowStartResponse>(`/bridges/${service}/login/start`, {
        method: "POST",
        body: JSON.stringify({ flow_id: flowId }),
    });

export const submitBridgeLoginStep = (
    service: BridgeService,
    loginId: string,
    stepId: string,
    stepType: string,
    data: Record<string, unknown>,
): Promise<LoginFlowStartResponse> =>
    request<LoginFlowStartResponse>(`/bridges/${service}/login/${loginId}/step`, {
        method: "POST",
        body: JSON.stringify({ step_id: stepId, step_type: stepType, data }),
    });

export const getBridgeLogin = (
    service: BridgeService,
): Promise<{ logins: Array<{ id: string; remote_profile: Record<string, unknown> }> }> =>
    request<{ logins: Array<{ id: string; remote_profile: Record<string, unknown> }> }>(
        `/bridges/${service}/login`,
    );

export const deleteBridgeLogin = (service: BridgeService): Promise<void> =>
    request<void>(`/bridges/${service}/login`, { method: "DELETE" });

// ── AI ──────────────────────────────────────────────────────────────────────

export interface SuggestionsResponse {
    task_id: string;
    stream_key: string;
    request_id: string;
}

export interface AiCatalogEntry {
    id: string;
    feature: string;
    version: string;
    description: string | null;
    is_default: boolean;
    variables_schema: Record<string, unknown> | null;
    model_provider: string | null;
    model_name: string | null;
}

export interface AiCreditsResponse {
    tokens_allocated: number;
    tokens_used: number;
    tokens_remaining: number;
    reset_period: string;
    last_reset_at: string | null;
}

export interface QaMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

export interface SuggestionEvent {
    index: number;
    text: string;
    tone?: string;
}

export interface DoneEvent {
    total: number;
    tokens_used: number;
    request_id: string;
}

export interface ErrorEvent {
    code: string;
    message: string;
    request_id: string;
}

export const postSuggestions = (
    feature: string,
    variables: Record<string, unknown>,
    version?: string,
    roomId?: string,
): Promise<SuggestionsResponse> =>
    request<SuggestionsResponse>("/suggestions", {
        method: "POST",
        body: JSON.stringify({ feature, variables, version: version ?? null, room_id: roomId ?? null }),
    });

/**
 * Ask AI: send a free-form question grounded in recent room messages.
 *
 * Thin wrapper over {@link postSuggestions} for the `qa` handler. `messages`
 * is the flattened room context ({ sender_id, is_own, body }[]); the caller
 * trims it to the admin-configured `ask_context_depth`. Stream the answer with
 * {@link openSuggestionsStream} using the returned `stream_key`.
 */
export const postAsk = (
    question: string,
    messages: Array<{ sender_id: string; is_own: boolean; body: string }>,
    roomId?: string,
    roomContext?: string,
): Promise<SuggestionsResponse> =>
    postSuggestions(
        "qa",
        { question, messages, room_context: roomContext ?? "" },
        undefined,
        roomId,
    );

/**
 * Open an SSE connection for an AI stream. Returns a cleanup function that
 * closes the EventSource.
 *
 * EventSource cannot send Authorization headers — the `stream_key` UUID acts as
 * a capability token (only the client who received it from POST /suggestions
 * knows it).
 */
export function openSuggestionsStream(
    streamKey: string,
    handlers: {
        onSuggestion: (event: SuggestionEvent) => void;
        onDone: (event: DoneEvent) => void;
        onError: (event: ErrorEvent) => void;
        onOpen?: () => void;
    },
): () => void {
    const url = `${getApiBase()}/ai/stream/${encodeURIComponent(streamKey)}`;
    const es = new EventSource(url);

    if (handlers.onOpen) es.addEventListener("open", handlers.onOpen);

    es.addEventListener("suggestion", (e: MessageEvent) => {
        try {
            handlers.onSuggestion(JSON.parse(e.data) as SuggestionEvent);
        } catch {
            /* skip malformed */
        }
    });
    es.addEventListener("done", (e: MessageEvent) => {
        try {
            handlers.onDone(JSON.parse(e.data) as DoneEvent);
        } catch {
            /* skip malformed */
        }
        es.close();
    });
    es.addEventListener("error", (e: MessageEvent) => {
        try {
            handlers.onError(JSON.parse((e as MessageEvent).data ?? "{}") as ErrorEvent);
        } catch {
            /* skip malformed */
        }
        es.close();
    });

    return () => es.close();
}

export const getAiCatalog = (): Promise<{
    prompts: AiCatalogEntry[];
    features: string[];
    media_caption_limit: number;
    max_wit_mix_size: number;
    ask_context_depth: number;
}> =>
    request<{
        prompts: AiCatalogEntry[];
        features: string[];
        media_caption_limit: number;
        max_wit_mix_size: number;
        ask_context_depth: number;
    }>("/ai/catalog");

export const getAiCredits = (): Promise<AiCreditsResponse> => request<AiCreditsResponse>("/ai/credits");

// ── Wit Library ─────────────────────────────────────────────────────────────

/** A canned example reply shown in a Wit card so users hear the persona instantly. */
export interface WitExample {
    incoming: string;
    reply: string;
}

/** A preset Wit (persona) as returned by GET /wits. */
export interface WitCatalogEntry {
    wit_id: string;
    /** Backing prompt feature, "wits/<wit_id>". Used as the generation feature. */
    feature: string;
    name: string;
    emoji: string;
    blurb: string;
    examples: WitExample[];
    category: string;
    sort_order: number;
}

/** Fetch the browseable catalogue of preset Wits for the library. */
export const getWits = (): Promise<{ wits: WitCatalogEntry[] }> =>
    request<{ wits: WitCatalogEntry[] }>("/wits");
/**
 * Send a raw image blob to the backend for AI captioning via the vision model.
 * Returns null on a non-2xx response so callers can fall back gracefully.
 */
export async function captionImage(blob: Blob, mimeType: string): Promise<string | null> {
    const token = await witlySession.getValidToken();
    const form = new FormData();
    form.append("file", blob, `image.${mimeType.split("/")[1] ?? "jpg"}`);

    try {
        const res = await fetch(`${getApiBase()}/ai/caption-image`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { caption?: string };
        return data.caption?.trim() || null;
    } catch {
        return null;
    }
}
