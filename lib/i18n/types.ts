import type { TranslationVars } from "./config";
import type { MessageKey } from "./messages/en";

export type Translate = (key: MessageKey, vars?: TranslationVars) => string;
