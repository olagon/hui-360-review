import { readLink, sessionCookie } from '../lib/auth.js';

export async function onRequestGet({ params, env, request }) {
  const origin = new URL(request.url).origin;
  const data = await readLink(env, params.token);
  const staff = data && (await env.DB.prepare('SELECT id FROM staff WHERE id = ? AND active = 1').bind(data.staff_id).first());
  if (!staff) return Response.redirect(`${origin}/?expired=1`, 302);
  return new Response(null, {
    status: 302,
    headers: { location: `${origin}/`, 'set-cookie': await sessionCookie(env, staff.id), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}
