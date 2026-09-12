import { env } from 'cloudflare:workers';
import { readEnv } from '../../../server/src/app-config';

function requiredSecret(name: string): string {
  const value = (env as Record<string, unknown>)[name];
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`Cloudflare requires a persistent ${name} secret of at least 32 characters`);
  }
  return value;
}

export const ENCRYPTION_KEY = requiredSecret('ENCRYPTION_KEY');
export const JWT_SECRET = requiredSecret('JWT_SECRET');

export function updateJwtSecret(): never {
  throw new Error('Rotate JWT_SECRET through Cloudflare secrets and redeploy this instance');
}

const session = readEnv().session;
export const DEFAULT_LANGUAGE = readEnv().app.defaultLanguage;
export const SESSION_DURATION = session.duration;
export const SESSION_DURATION_MS = session.durationMs;
export const SESSION_DURATION_SECONDS = session.durationSeconds;
export const SESSION_DURATION_REMEMBER = session.durationRemember;
export const SESSION_DURATION_REMEMBER_MS = session.durationRememberMs;
export const SESSION_DURATION_REMEMBER_SECONDS = session.durationRememberSeconds;
