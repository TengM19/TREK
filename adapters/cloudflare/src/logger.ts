import { readEnv } from '../../../server/src/app-config';
/** Cloudflare captures console output; rotating local log files are not durable. */
export const LOG_LEVEL = (readEnv().app.logLevel || 'info').toLowerCase();
const rank = {error:0,warn:1,info:2,debug:3};
const threshold = rank[LOG_LEVEL as keyof typeof rank] ?? 2;
export function logError(message: string) { console.error(message); }
export function logWarn(message: string) { if (threshold >= 1) console.warn(message); }
export function logInfo(message: string) { if (threshold >= 2) console.log(message); }
export function logDebug(message: string) { if (threshold >= 3) console.debug(message); }
