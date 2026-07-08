/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Step 1 — pick a platform to connect. WhatsApp is live; the rest are
 * "coming soon" cards (disabled) so users know more is on the way.
 *
 * Platforms whose bridge is already logged in are shown as connected. A
 * connected platform is NOT re-connectable — its only action is to disconnect
 * (with an inline confirmation), mirroring the old web-client behaviour.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";

import { type PlatformDef, PLATFORMS } from "../platforms";
import { type BridgeService, deleteBridge, deleteBridgeLogin } from "../../services/agchatApi";
import { getConnectedServices } from "../connectController";
import { witlyLog } from "../../logger";

interface PlatformPickerStepProps {
    onPick: (platform: PlatformDef) => void;
}

export function PlatformPickerStep({ onPick }: PlatformPickerStepProps): JSX.Element {
    const [connected, setConnected] = useState<Set<BridgeService>>(new Set());
    const [pendingDisconnect, setPendingDisconnect] = useState<BridgeService | null>(null);
    const [busyService, setBusyService] = useState<BridgeService | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void getConnectedServices().then((set) => {
            if (active) setConnected(set);
        });
        return () => {
            active = false;
        };
    }, []);

    const handleDisconnect = useCallback(async (service: BridgeService) => {
        setPendingDisconnect(null);
        setBusyService(service);
        setError(null);
        try {
            // Best-effort logout first; the bridge pod removal matters more.
            try {
                await deleteBridgeLogin(service);
            } catch (err) {
                witlyLog.warn(`deleteBridgeLogin(${service}) failed; continuing to delete bridge`, err);
            }
            await deleteBridge(service);
            setConnected((prev) => {
                const next = new Set(prev);
                next.delete(service);
                return next;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't disconnect. Please try again.");
        } finally {
            setBusyService(null);
        }
    }, []);

    return (
        <div className="witly_Connect_step">
            <p className="witly_Connect_subtitle">
                Bring your conversations into Witly. Pick where you chat and we'll link it up.
            </p>

            {error && <p className="witly_Connect_error">{error}</p>}

            <ul className="witly_Connect_platforms">
                {PLATFORMS.map((p) => {
                    const isConnected = p.service !== null && connected.has(p.service);
                    const isBusy = p.service !== null && busyService === p.service;
                    const isConfirming = p.service !== null && pendingDisconnect === p.service;

                    // A connected platform is not clickable-to-connect: render it as a
                    // plain container so we can nest the disconnect action inside it.
                    if (isConnected && p.service) {
                        const service = p.service;
                        return (
                            <li key={p.id}>
                                <div className="witly_Connect_platform witly_Connect_platform--connected">
                                    <div className="witly_Connect_platform_row">
                                        <span className="witly_Connect_platform_glyph" aria-hidden="true">
                                            <p.Icon />
                                        </span>
                                        <span className="witly_Connect_platform_body">
                                            <span className="witly_Connect_platform_name">{p.name}</span>
                                            <span className="witly_Connect_platform_status">
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="14"
                                                    height="14"
                                                    fill="none"
                                                    aria-hidden="true"
                                                >
                                                    <path
                                                        d="M5 12.5l4.2 4.2L19 7"
                                                        stroke="currentColor"
                                                        strokeWidth="2.4"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                                Connected
                                            </span>
                                        </span>

                                        {isBusy ? (
                                            <span className="witly_Connect_platform_disconnecting">
                                                <span
                                                    className="witly_Connect_spinner witly_Connect_spinner--sm"
                                                    aria-hidden="true"
                                                />
                                                Disconnecting…
                                            </span>
                                        ) : (
                                            !isConfirming && (
                                                <button
                                                    type="button"
                                                    className="witly_Connect_platform_disconnect"
                                                    onClick={() => setPendingDisconnect(service)}
                                                >
                                                    Disconnect
                                                </button>
                                            )
                                        )}
                                    </div>

                                    {isConfirming && (
                                        <div className="witly_Connect_platform_confirm">
                                            <p className="witly_Connect_platform_confirm_note">
                                                Disconnecting will log you out of {p.name} and remove all messages
                                                synced with Witly.
                                            </p>
                                            <div className="witly_Connect_platform_confirm_actions">
                                                <button
                                                    type="button"
                                                    className="witly_Connect_platform_confirm_cancel"
                                                    onClick={() => setPendingDisconnect(null)}
                                                >
                                                    Keep
                                                </button>
                                                <button
                                                    type="button"
                                                    className="witly_Connect_platform_confirm_yes"
                                                    onClick={() => void handleDisconnect(service)}
                                                >
                                                    Disconnect
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    }

                    return (
                        <li key={p.id}>
                            <button
                                type="button"
                                className={`witly_Connect_platform${p.enabled ? "" : " witly_Connect_platform--soon"}`}
                                disabled={!p.enabled}
                                onClick={() => p.enabled && onPick(p)}
                            >
                                <span className="witly_Connect_platform_glyph" aria-hidden="true">
                                    <p.Icon />
                                </span>
                                <span className="witly_Connect_platform_body">
                                    <span className="witly_Connect_platform_name">{p.name}</span>
                                    <span className="witly_Connect_platform_blurb">{p.blurb}</span>
                                </span>
                                {p.enabled ? (
                                    <span className="witly_Connect_platform_go">Connect</span>
                                ) : (
                                    <span className="witly_Connect_platform_badge">Soon</span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
