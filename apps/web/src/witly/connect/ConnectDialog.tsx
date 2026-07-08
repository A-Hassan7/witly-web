/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * ConnectDialog — the guided "connect a platform" wizard rendered inside an
 * Element module dialog (see `element/registerConnect.tsx`). It owns the whole
 * flow state machine:
 *
 *   picker → preparing → phone → pairing → connected
 *
 * The bridge deploy/ready wait lives in `connectController.ensureBridgeReady`.
 * The interactive login stepping (phone → pairing code → complete) is driven
 * here against the ported `agchatApi` provisioning helpers, mirroring the
 * mautrix bridgev2 step machine used by the reference web-client.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";

import type { DialogProps } from "@element-hq/element-web-module-api";

import { witlyLog } from "../logger";
import { type LoginStep, startBridgeLogin, submitBridgeLoginStep } from "../services/agchatApi";
import { ensureBridgeReady } from "./connectController";
import type { PlatformDef } from "./platforms";
import { PlatformPickerStep } from "./steps/PlatformPickerStep";
import { PreparingStep } from "./steps/PreparingStep";
import { PhoneEntryStep } from "./steps/PhoneEntryStep";
import { PairingCodeStep } from "./steps/PairingCodeStep";
import { ConnectedStep } from "./steps/ConnectedStep";
import "./connect.pcss";

/** Result model handed back to the dialog opener when it closes. */
export interface ConnectResult {
    connected: boolean;
}

type Phase = "picker" | "preparing" | "phone" | "pairing" | "connected";

const PHONE_FLOW_ID = "phone";

/**
 * Turn a raw thrown error into friendly UI copy. Network failures and the
 * bridge's long-poll timing out both surface as a bare "Failed to fetch"
 * TypeError — which is meaningless to a user — so we map those to a clear
 * "try again" message instead.
 */
function humanizeLoginError(err: unknown, fallback: string): string {
    const message = err instanceof Error ? err.message : String(err);
    if (!message || /failed to fetch|networkerror|load failed|timed? ?out|timeout/i.test(message)) {
        return "We didn't hear back from WhatsApp in time. Please try again.";
    }
    return message;
}

export function ConnectDialog({ onSubmit }: DialogProps<ConnectResult>): JSX.Element {
    const [phase, setPhase] = useState<Phase>("picker");
    const [platform, setPlatform] = useState<PlatformDef | null>(null);

    // Prepare (bridge deploy) state.
    const [prepareDetail, setPrepareDetail] = useState("Setting things up…");
    const [prepareError, setPrepareError] = useState<string | null>(null);
    const [prepareAttempt, setPrepareAttempt] = useState(0);

    // Login state.
    const [phone, setPhone] = useState("+44");
    const [loginId, setLoginId] = useState<string | null>(null);
    const [step, setStep] = useState<LoginStep | null>(null);
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const mountedRef = useRef(true);
    const waitCalledRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    // ── Prepare: deploy + register the bridge when we enter "preparing" ──────
    useEffect(() => {
        if (phase !== "preparing" || !platform?.service) return;
        const service = platform.service;
        const controller = new AbortController();
        abortRef.current = controller;
        setPrepareError(null);

        void (async () => {
            try {
                await ensureBridgeReady(
                    service,
                    (detail) => mountedRef.current && setPrepareDetail(detail),
                    controller.signal,
                );
                if (!mountedRef.current || controller.signal.aborted) return;
                setPhase("phone");
            } catch (err) {
                if (!mountedRef.current || controller.signal.aborted) return;
                if (err instanceof DOMException && err.name === "AbortError") return;
                setPrepareError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
            }
        })();

        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, platform, prepareAttempt]);

    // ── Login: advance to the next step, handling terminal states ────────────
    const applyStep = useCallback(
        (res: LoginStep & { login_id?: string }, currentId: string | null) => {
            const id = res.login_id ?? currentId;
            if (id) setLoginId(id);
            waitCalledRef.current = false; // let a fresh display_and_wait auto-poll
            setStep(res);
            if (res.type === "complete") {
                setPhase("connected");
            } else if (res.type === "display_and_wait") {
                setPhase("pairing");
            }
        },
        [],
    );

    const handleStartLogin = useCallback(async () => {
        if (!platform?.service) return;
        const service = platform.service;
        const trimmed = phone.trim();
        setLoginLoading(true);
        setLoginError(null);
        try {
            const res = await startBridgeLogin(service, PHONE_FLOW_ID);
            const id = res.login_id;
            if (res.type === "user_input") {
                const next = await submitBridgeLoginStep(service, id, res.step_id, res.type, {
                    phone_number: trimmed,
                });
                if (!mountedRef.current) return;
                applyStep(next, id);
            } else {
                if (!mountedRef.current) return;
                applyStep(res, id);
            }
        } catch (err) {
            if (!mountedRef.current) return;
            setLoginError(humanizeLoginError(err, "Couldn't start the connection. Please try again."));
        } finally {
            if (mountedRef.current) setLoginLoading(false);
        }
    }, [applyStep, phone, platform]);

    // Long-poll for the display_and_wait step until the bridge reports complete.
    const handleWait = useCallback(async () => {
        if (!platform?.service || !step || !loginId) return;
        const service = platform.service;
        try {
            const res = await submitBridgeLoginStep(service, loginId, step.step_id, "display_and_wait", {});
            if (!mountedRef.current) return;
            applyStep(res, loginId);
        } catch (err) {
            if (!mountedRef.current) return;
            setLoginError(humanizeLoginError(err, "Lost the connection. Please try again."));
        }
    }, [applyStep, loginId, platform, step]);

    // Auto-trigger the long-poll whenever a display_and_wait step is showing.
    useEffect(() => {
        if (phase === "pairing" && step?.type === "display_and_wait" && loginId && !waitCalledRef.current) {
            waitCalledRef.current = true;
            void handleWait();
        }
    }, [phase, step, loginId, handleWait]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const onPick = useCallback((p: PlatformDef) => {
        witlyLog.info(`connect: platform picked = ${p.id}`);
        setPlatform(p);
        setPhase("preparing");
    }, []);

    const onRetryPrepare = useCallback(() => {
        setPrepareError(null);
        setPrepareDetail("Setting things up…");
        setPrepareAttempt((a) => a + 1);
    }, []);

    const onStartOver = useCallback(() => {
        setStep(null);
        setLoginId(null);
        setLoginError(null);
        waitCalledRef.current = false;
        setPhase("phone");
    }, []);

    const onCopyCode = useCallback(async () => {
        const code = step?.display_and_wait?.data;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            if (!mountedRef.current) return;
            setCopied(true);
            setTimeout(() => mountedRef.current && setCopied(false), 2000);
        } catch (err) {
            witlyLog.warn("clipboard write failed", err);
        }
    }, [step]);

    const onDone = useCallback(() => onSubmit({ connected: true }), [onSubmit]);

    // ── Render current phase ─────────────────────────────────────────────────
    const platformName = platform?.name ?? "WhatsApp";

    return (
        <div className="witly_Connect">
            {phase === "picker" && <PlatformPickerStep onPick={onPick} />}
            {phase === "preparing" && (
                <PreparingStep
                    platformName={platformName}
                    detail={prepareDetail}
                    error={prepareError}
                    onRetry={onRetryPrepare}
                />
            )}
            {phase === "phone" && (
                <PhoneEntryStep
                    phone={phone}
                    onPhoneChange={setPhone}
                    onSubmit={() => void handleStartLogin()}
                    loading={loginLoading}
                    error={loginError}
                />
            )}
            {phase === "pairing" && (
                <PairingCodeStep
                    code={step?.display_and_wait?.data ?? null}
                    copied={copied}
                    onCopy={() => void onCopyCode()}
                    error={loginError}
                    onStartOver={onStartOver}
                />
            )}
            {phase === "connected" && <ConnectedStep platformName={platformName} onDone={onDone} />}
        </div>
    );
}
