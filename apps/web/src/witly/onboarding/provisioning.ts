/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Homeserver provisioning → Matrix credentials.
 *
 * After Supabase auth, the AGChat control plane provisions a per-user Matrix
 * homeserver (~30–120s). This module drives that flow and returns the Matrix
 * credentials Element needs to hydrate a session, in the shape the module API
 * expects (`AccountAuthInfo`).
 *
 * The provision status response gives us the user ID, access token and
 * homeserver URL, but not the device ID — so, exactly like the old web-client,
 * we resolve it via `/_matrix/client/v3/account/whoami`.
 */

import type { AccountAuthInfo } from "@element-hq/element-web-module-api";

import { witlyLog } from "../logger";
import { getProvisionStatus, postProvision, type ProvisionStatusResponse } from "../services/agchatApi";

export type ProvisioningPhase = "starting" | "provisioning" | "ready" | "error";

export interface ProvisioningProgress {
    phase: ProvisioningPhase;
    /** Human-friendly detail, safe to surface in UI. */
    detail?: string;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 60; // ~3 minutes at 3s

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const WHOAMI_TIMEOUT_MS = 10_000;

async function fetchDeviceId(baseUrl: string, accessToken: string): Promise<string | undefined> {
    // Guard the cross-origin request with a timeout so a slow/unreachable
    // homeserver can never freeze the provisioning flow — we can proceed
    // without a deviceId (see fallback in toAccountAuthInfo).
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), WHOAMI_TIMEOUT_MS);
    try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/_matrix/client/v3/account/whoami`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
        });
        if (!res.ok) {
            witlyLog.warn(`whoami failed (${res.status}); continuing without deviceId`);
            return undefined;
        }
        const data = (await res.json()) as { user_id: string; device_id?: string };
        return data.device_id;
    } catch (err) {
        witlyLog.warn("whoami request failed; continuing without deviceId", err);
        return undefined;
    } finally {
        window.clearTimeout(timeout);
    }
}

function toAccountAuthInfo(status: ProvisionStatusResponse, deviceId: string | undefined): AccountAuthInfo {
    if (!status.matrix_user_id || !status.matrix_access_token || !status.homeserver_url) {
        throw new Error("Provisioning reported READY but Matrix credentials are missing");
    }
    return {
        userId: status.matrix_user_id,
        accessToken: status.matrix_access_token,
        homeserverUrl: status.homeserver_url,
        // Element requires a deviceId; fall back to a stable placeholder if
        // whoami couldn't resolve one (the homeserver still accepts the token).
        deviceId: deviceId ?? "WITLY_WEB",
    };
}

/**
 * Kick off provisioning (idempotent) and poll until the homeserver is READY,
 * then resolve the Matrix credentials for Element. Reports coarse progress via
 * the optional callback so the UI can show a friendly wait state.
 *
 * @throws if provisioning errors or times out.
 */
export async function provisionMatrixSession(
    onProgress?: (p: ProvisioningProgress) => void,
): Promise<AccountAuthInfo> {
    const report = (p: ProvisioningProgress): void => onProgress?.(p);

    report({ phase: "starting" });
    witlyLog.info("starting provisioning");

    // POST /provision is idempotent: returns the existing homeserver if the
    // user already has one, or starts a new one.
    let status = await postProvision();
    witlyLog.info(`provision POST returned status=${status.status}`);

    if (status.status === "READY") {
        const creds = await resolveCredentials(status, report);
        return creds;
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        report({ phase: "provisioning" });
        await delay(POLL_INTERVAL_MS);

        status = await getProvisionStatus();

        if (status.status === "READY") {
            witlyLog.info(`provisioning READY after ${attempt + 1} poll(s)`);
            return await resolveCredentials(status, report);
        }
        if (status.status === "ERROR") {
            report({ phase: "error", detail: "Provisioning failed" });
            throw new Error("Homeserver provisioning failed");
        }
    }

    report({ phase: "error", detail: "Provisioning timed out" });
    throw new Error("Homeserver provisioning timed out");
}

/** Resolve the deviceId and build the AccountAuthInfo Element needs, with logging. */
async function resolveCredentials(
    status: ProvisionStatusResponse,
    report: (p: ProvisioningProgress) => void,
): Promise<AccountAuthInfo> {
    witlyLog.info(`homeserver READY at ${status.homeserver_url}; resolving deviceId…`);
    const deviceId = await fetchDeviceId(status.homeserver_url!, status.matrix_access_token!);
    witlyLog.info(`deviceId resolved: ${deviceId ?? "(none — using fallback)"}`);
    report({ phase: "ready" });
    const creds = toAccountAuthInfo(status, deviceId);
    witlyLog.info(`handing Matrix credentials to Element for ${creds.userId}`);
    return creds;
}
