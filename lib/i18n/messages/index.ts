/*
================================================================================
MESSAGES REGISTRY
================================================================================
Maps each supported locale code to its dictionary. Register new languages here
(and in lib/i18n/locales.ts).
================================================================================
*/

import type { Locale } from '../locales';
import { de } from './de';
import { en, MessageKey, Messages } from './en';

export const messages: Record<Locale, Messages> = { de, en };

export type { MessageKey, Messages };
