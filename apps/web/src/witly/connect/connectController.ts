/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Orchestration for connecting a chat platform (bridge).
 *
 * Two responsibilities live here so the React steps stay presentational:
 *  1. `ensureBridgeReady` — deploy the bridge pod (idempotent POST) and poll its
 *     status until it is deployed + registered and ready to accept a login.
 *  2. `anyPlatformConnected` — a cheap check used by the persistent "connect a
 *     platform" prompt to decide whether onboarding is still incomplete.
 *
 * The interactive login stepping (phone → pairing code → complete) is driven by
 * the wizard component directly against the ported `agchatApi` helpers, mirroring
 * the mautrix bridgev2 provisioning step machine.
 */

import {
    type BridgeService,
    type BridgeStatusResponse,
    getAllBridges,
    getBridgeStatus,
    postBridge,
} from "../services/agchatApi";
import { witlyLog } from "../logger";

const POLL_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 40; // ~2 minutes at 3s

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isReadyForLogin = (s: BridgeStatusResponse): boolean =>
    s.deploy_status === "READY" && s.registration_status === "REGISTERED";

/**
 * Ensure the bridge for `service` is deployed, registered and ready to log in.
 * Idempotent: safe to call whether or not the bridge already exists.
 *
 * @param onProgress optional callback for surfacing status detail in the UI.
 * @throws if the bridge reports ERROR or does not become ready in time, or if
 *         the caller aborts via `signal`.
 */
export async function ensureBridgeReady(
    service: BridgeService,
    onProgress?: (detail: string) => void,
    signal?: AbortSignal,
): Promise<BridgeStatusResponse> {
    onProgress?.("Setting things up…");

    // Kick off (or no-op if already present) the bridge deployment.
    let status = await postBridge(service);
    witlyLog.info(`ensureBridgeReady(${service}): deploy=${status.deploy_status} reg=${status.registration_status}`);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");

        if (status.deploy_status === "ERROR") {
            throw new Error("The connection service failed to start. Please try again.");
        }
        if (isReadyForLogin(status)) {
            onProgress?.("Ready");
            return status;
        }

        await delay(POLL_INTERVAL_MS);
        status = await getBridgeStatus(service);
    }

    throw new Error("Setting up the connection is taking longer than expected. Please try again.");
}

/**
 * True if the user has at least one bridge whose login is CONNECTED. Used by the
 * persistent "finish setup — connect a platform" prompt. Never throws — a
 * failure here should not block the inbox, so it returns false on error.
 */
export async function anyPlatformConnected(): Promise<boolean> {
    try {
        const bridges = await getAllBridges();
        return bridges.some((b) => b.login_status === "CONNECTED");
    } catch (err) {
        witlyLog.warn("anyPlatformConnected check failed; assuming none connected", err);
        return false;
    }
}

/**
 * Set of services whose bridge login is CONNECTED. Used by the platform picker
 * to reflect which platforms are already linked. Never throws — a failure here
 * should not break the picker, so it returns an empty set on error.
 */
export async function getConnectedServices(): Promise<Set<BridgeService>> {
    try {
        const bridges = await getAllBridges();
        return new Set(bridges.filter((b) => b.login_status === "CONNECTED").map((b) => b.service));
    } catch (err) {
        witlyLog.warn("getConnectedServices check failed; assuming none connected", err);
        return new Set();
    }
}
