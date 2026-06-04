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
import { es } from './es';
import { fr } from './fr';
import { zh } from './zh';

export const messages: Record<Locale, Messages> = { de, en, es, fr, zh };

export type { MessageKey, Messages };
