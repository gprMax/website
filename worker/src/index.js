/* ============================================================
   gprMax user map endpoint.

   Replaces users/submit_pin.php, which cannot run on GitHub Pages.
   Same three actions the PHP served:

     geocode  q=<place>            -> resolved place + a signed token
     reverse  lat=<n> lon=<n>      -> resolved place + a signed token
     add      token=<t> note=<s>   -> opens a moderation issue

   This file is currently a health-check stub: enough to prove the
   account, the KV binding and the secrets are wired up before any of
   the real logic is written.
   ============================================================ */

const ALLOWED_ORIGINS = [
	'https://www.gprmax.com',
	'https://gprmax.com',
	'https://gprmax.github.io',
	'http://127.0.0.1:4011',
];

function cors(origin) {
	const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
	return {
		'Access-Control-Allow-Origin': allow,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Vary': 'Origin',
	};
}

export default {
	async fetch(request, env) {
		const origin = request.headers.get('Origin') || '';
		const headers = cors(origin);

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers });
		}

		const url = new URL(request.url);

		if (url.pathname === '/health') {
			// Prove each piece of setup independently, without ever echoing
			// a secret back: presence only.
			let kv = 'unavailable';
			try {
				await env.MAP_STATE.put('health', new Date().toISOString(), { expirationTtl: 60 });
				kv = (await env.MAP_STATE.get('health')) ? 'ok' : 'wrote but could not read';
			} catch (e) {
				kv = 'error: ' + e.message;
			}

			return Response.json({
				worker: 'ok',
				kv,
				secrets: {
					HMAC_SECRET: env.HMAC_SECRET ? 'set' : 'MISSING',
					GITHUB_TOKEN: env.GITHUB_TOKEN ? 'set' : 'MISSING',
				},
			}, { headers });
		}

		return new Response('Not found', { status: 404, headers });
	},
};
