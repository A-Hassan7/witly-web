/*
Copyright 2026 Witly
SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * Brand marks for the connectable platforms.
 *
 * These are the *real* platform logos downloaded into `./assets/` (see that
 * folder for provenance). Webpack's `@svgr/webpack` loader exposes each SVG as
 * a React component via the `Icon` named export, so we simply re-export them at
 * a consistent size. Kept here so `platforms.ts` stays a plain data module and
 * the icons are swappable in one place.
 */

import React, { type JSX } from "react";

import { Icon as WhatsAppMark } from "./assets/whatsapp.svg";
import { Icon as InstagramMark } from "./assets/instagram.svg";
import { Icon as MessengerMark } from "./assets/messenger.svg";
import { Icon as DiscordMark } from "./assets/discord.svg";

const SIZE = 26;

export function WhatsAppIcon(): JSX.Element {
    return <WhatsAppMark width={SIZE} height={SIZE} role="img" aria-label="WhatsApp" />;
}

export function InstagramIcon(): JSX.Element {
    return <InstagramMark width={SIZE} height={SIZE} role="img" aria-label="Instagram" />;
}

export function MessengerIcon(): JSX.Element {
    return <MessengerMark width={SIZE} height={SIZE} role="img" aria-label="Messenger" />;
}

export function DiscordIcon(): JSX.Element {
    return <DiscordMark width={SIZE} height={SIZE} role="img" aria-label="Discord" />;
}
