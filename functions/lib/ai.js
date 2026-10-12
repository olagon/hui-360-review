import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, LLAMA_MODEL, WHISPER_MODEL } from './config.js';
import { HttpError } from './http.js';

// Settings, AI. When it is off, nothing about anyone is sent to any model.
export async function aiOn(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ai'").first();
  return row?.value !== 'off';
}
export const AI_OFF = 'AI is turned off in Settings, so start from the answers and write it yourself.';

// Every model call goes through here, so the AI switch in Settings holds everywhere.
export function completer(env) {
  return async (system, user) => {
    if (!(await aiOn(env))) throw new HttpError(409, AI_OFF);
    return model(env, await anthropicKey(env))(system, user);
  };
}

// ---------- the Anthropic key ----------
// Either a Cloudflare secret (ANTHROPIC_API_KEY, set during setup) or pasted in Settings, AI.
// A pasted key is sealed with AES-GCM under a key derived from SESSION_SECRET before it is stored,
// so the database, a backup, or an export never holds it in the clear.
const sealer = async (env) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SESSION_SECRET}:anthropic-key`)), 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sealKey(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealer(env), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function openKey(env, sealed) {
  try {
    const [iv, ct] = sealed.split('.').map(unb64);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await sealer(env), ct));
  } catch {
    return ''; // SESSION_SECRET changed: the key has to be pasted again
  }
}
export async function anthropicKey(env) {
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'anthropic_key'").first();
  return row?.value ? openKey(env, row.value) : '';
}
const gateway = (env) =>
  env.AI_GATEWAY_ID && env.CF_ACCOUNT_ID ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic` : undefined;

// Checks a key before it is saved. Listing models costs nothing.
export async function checkKey(env, key) {
  await new Anthropic({ apiKey: key }).models.list({ limit: 1 }); // straight to Anthropic, not through the gateway
}

// The model switch: Claude with an Anthropic key, Llama on Workers AI otherwise.
function model(env, key) {
  if (key) {
    const client = new Anthropic({ apiKey: key, baseURL: gateway(env) });
    // Server side fallback (if a safety classifier declines) exists for Sonnet and Opus, not Haiku.
    const fallback = /sonnet|opus/.test(CLAUDE_MODEL) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
    return async (system, user) => {
      const msg = await client.beta.messages
        .stream({ model: CLAUDE_MODEL, max_tokens: 16000, system, messages: [{ role: 'user', content: user }], ...fallback })
        .finalMessage();
      if (msg.stop_reason === 'refusal') throw new HttpError(502, 'The model declined to write this draft. Try again or write it by hand.');
      return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    };
  }
  return async (system, user) => {
    const out = await env.AI.run(LLAMA_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 3000,
    }, env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined);
    // Workers AI hands back JSON replies already parsed. Callers always get text.
    return typeof out.response === 'string' ? out.response : JSON.stringify(out.response ?? '');
  };
}

export async function transcribe(env, bytes, hint) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const out = await env.AI.run(WHISPER_MODEL, { audio: btoa(bin), initial_prompt: hint });
  return { text: (out.text || '').trim(), language: out.transcription_info?.language || null };
}
