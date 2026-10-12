// Keys pasted in Settings (Anthropic, Resend) are sealed with AES-GCM under a key derived from
// SESSION_SECRET before they are stored, so the database, a backup, or an export never holds them
// in the clear. If SESSION_SECRET changes, a sealed key no longer opens and has to be pasted again.
const sealer = async (env, purpose) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SESSION_SECRET}:${purpose}`)), 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(env, plain, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealer(env, purpose), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function unseal(env, sealed, purpose) {
  try {
    const [iv, ct] = sealed.split('.').map(unb64);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await sealer(env, purpose), ct));
  } catch {
    return '';
  }
}
