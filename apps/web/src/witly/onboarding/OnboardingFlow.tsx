/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import type { AccountAuthInfo } from "@element-hq/element-web-module-api";

import "./onboarding.pcss";
import { witlyLog } from "../logger";
import { establishFromSupabaseSession, establishFromTokens } from "./authController";
import { hasStashedAuthRedirect, takeAuthRedirectError, takeAuthRedirectSession } from "./authRedirect";
import type { SupabaseSession } from "../services/supabaseAuth";
import { witlySession } from "../services/session";
import { WelcomeStep } from "./steps/WelcomeStep";
import { AuthStep } from "./steps/AuthStep";
import { ProvisioningStep } from "./steps/ProvisioningStep";

interface Props {
    /** Hands the resolved Matrix credentials to Element to complete login. */
    onLoggedIn: (creds: AccountAuthInfo) => void;
}

type Stage = "resuming" | "welcome" | "auth" | "provisioning";

// The onboarding journey stages, shown as step dots. P1 implements "account"
// (auth + provisioning); "wits" and "connect" are placeholders in the shell,
// activated in later phases.
const JOURNEY = ["account", "wits", "connect"] as const;

function StepDots({ currentIndex }: { currentIndex: number }): JSX.Element {
    return (
        <div className="witly_Onboarding_dots" role="progressbar" aria-valuenow={currentIndex + 1} aria-valuemax={JOURNEY.length}>
            {JOURNEY.map((stage, i) => (
                <span
                    key={stage}
                    className={
                        "witly_Onboarding_dot" +
                        (i === currentIndex ? " witly_Onboarding_dot--active" : "") +
                        (i < currentIndex ? " witly_Onboarding_dot--done" : "")
                    }
                />
            ))}
        </div>
    );
}

/**
 * The Witly onboarding wizard. Rendered in place of Element's login form via
 * the module API's `registerLoginComponent` (see `element/registerOnboarding`).
 *
 * P1 stages: welcome → auth → provisioning → hand Matrix creds to Element.
 * Later phases insert the Wit Explorer and platform-connect steps.
 */
export function OnboardingFlow({ onLoggedIn }: Props): JSX.Element {
    const [stage, setStage] = useState<Stage>(() => {
        // An OAuth / magic-link redirect always takes priority — finish that first.
        if (hasStashedAuthRedirect()) return "resuming";
        // Silent recovery: if the Supabase session survived (restored from the
        // durable IndexedDB backup after Element wiped localStorage on an
        // involuntary hard logout), skip the welcome/auth screens and go straight
        // to provisioning — it's idempotent and re-fetches fresh Matrix creds, so
        // a dying Matrix token no longer forces the user to sign in again.
        if (witlySession.isAuthenticated()) return "provisioning";
        return "welcome";
    });
    const [error, setError] = useState<string | null>(null);

    // Safety net for silent recovery: if the Supabase session is definitively
    // rejected while we're provisioning (its refresh token is truly dead, so
    // `witlySession` cleared itself), fall back to the welcome screen instead of
    // looping on "Try again" against an unrecoverable session.
    useEffect(() => {
        if (stage !== "provisioning") return;
        return witlySession.subscribe((s) => {
            if (!s) {
                setError("Your session expired. Please sign in again.");
                setStage("welcome");
            }
        });
    }, [stage]);

    // Handle an OAuth / magic-link redirect: establish the session, then jump
    // straight to provisioning. Runs once on mount.
    useEffect(() => {
        if (stage !== "resuming") return;

        const redirectError = takeAuthRedirectError();
        if (redirectError) {
            setError(redirectError.description ?? "Sign-in was cancelled or failed. Please try again.");
            setStage("welcome");
            return;
        }

        const session = takeAuthRedirectSession();
        if (!session) {
            setStage("welcome");
            return;
        }

        void (async () => {
            try {
                await establishFromTokens(session.accessToken, session.refreshToken, session.expiresIn);
                setStage("provisioning");
            } catch (err) {
                witlyLog.error("resuming session failed", err);
                setError("We couldn't sign you in. Please try again.");
                setStage("welcome");
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onAuthenticated = async (session: SupabaseSession): Promise<void> => {
        try {
            await establishFromSupabaseSession(session);
            setStage("provisioning");
        } catch (err) {
            witlyLog.error("establishing session failed", err);
            setError("We couldn't sign you in. Please try again.");
        }
    };

    let body: JSX.Element;
    let dotIndex = 0;
    switch (stage) {
        case "resuming":
            body = (
                <div className="witly_Provisioning">
                    <span className="witly_Provisioning_spark" aria-hidden="true">
                        ✨
                    </span>
                    <div className="witly_Provisioning_status">Signing you in…</div>
                </div>
            );
            break;
        case "welcome":
            body = <WelcomeStep onGetStarted={() => setStage("auth")} />;
            break;
        case "auth":
            body = <AuthStep onAuthenticated={onAuthenticated} />;
            dotIndex = 0;
            break;
        case "provisioning":
            body = <ProvisioningStep onProvisioned={onLoggedIn} />;
            dotIndex = 0;
            break;
    }

    const showDots = stage === "auth" || stage === "provisioning";

    return (
        <div className="witly_Onboarding">
            <div className="witly_Onboarding_card">
                {showDots && <StepDots currentIndex={dotIndex} />}
                {error && stage === "welcome" && <div className="witly_Onboarding_error">{error}</div>}
                {body}
            </div>
        </div>
    );
}
