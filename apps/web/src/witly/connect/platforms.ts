/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Platform catalogue for the "Connect a platform" flow.
 *
 * WhatsApp is the only enabled platform for now (phone/pairing-code login).
 * Instagram, Messenger and Discord are shown as "coming soon" cards to set the
 * multi-platform expectation. The underlying bridge services (mautrix-meta for
 * IG/Messenger, mautrix-discord for Discord) are backend work tracked
 * separately; do not enable a card here until its bridge is live.
 */

import type { ComponentType } from "react";

import type { BridgeService } from "../services/agchatApi";
import { DiscordIcon, InstagramIcon, MessengerIcon, WhatsAppIcon } from "./brandIcons";

export interface PlatformDef {
    /** Stable id used in UI keys. */
    id: string;
    /** Display name. */
    name: string;
    /** Brand mark component rendered in the picker. */
    Icon: ComponentType;
    /** Whether the user can connect this platform today. */
    enabled: boolean;
    /**
     * The backend bridge service this maps to. `null` for platforms whose
     * bridge does not exist yet (kept explicit so we don't accidentally call
     * the API for a coming-soon card).
     */
    service: BridgeService | null;
    /** Short reassuring blurb shown under the name. */
    blurb: string;
}

export const PLATFORMS: PlatformDef[] = [
    {
        id: "whatsapp",
        name: "WhatsApp",
        Icon: WhatsAppIcon,
        enabled: true,
        service: "whatsapp",
        blurb: "Link with your phone number",
    },
    {
        id: "instagram",
        name: "Instagram",
        Icon: InstagramIcon,
        enabled: false,
        service: null,
        blurb: "Coming soon",
    },
    {
        id: "messenger",
        name: "Messenger",
        Icon: MessengerIcon,
        enabled: false,
        service: null,
        blurb: "Coming soon",
    },
    {
        id: "discord",
        name: "Discord",
        Icon: DiscordIcon,
        enabled: false,
        service: null,
        blurb: "Coming soon",
    },
];
