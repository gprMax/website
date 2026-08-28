/* ============================================================
   gprMax user map endpoint.

   Replaces users/submit_pin.php, which cannot run on GitHub Pages.
   Same three actions, same security properties:

     geocode  q=<place>            -> resolved place + a signed token
     reverse  lat=<n> lon=<n>      -> resolved place + a signed token
     add      token=<t> note=<s>   -> opens a moderation issue

   The token is the load-bearing part. Coordinates are never taken from
   the client: they are resolved here, signed with an HMAC, handed back,
   and must be presented unmodified to `add`. Without it the endpoint
   would happily plant a pin at any coordinate a caller invented.

   One deliberate difference from the PHP: `add` does not write the map.
   It opens an issue for a human to approve, and an Action appends the
   pin. A compromised Worker therefore cannot touch the site -- its
   GitHub token can only open issues.
   ============================================================ */

/* ------------------------------------------------------------ config --- */

// OpenStreetMap's usage policy requires a User-Agent that identifies the
// application and offers a way to reach us. A URL rather than an address:
// the address it used to carry is being retired, and a dead contact is
// worse than none.
const NOMINATIM_UA = 'gprMax-community-map/2.0 (+https://github.com/gprMax/gprMax/discussions)';

const REPO = 'gprMax/website';
const ISSUE_LABEL = 'map-pin';

// Two budgets, as in the PHP. Publishing is rare and strictly capped.
// Looking a place up is a normal part of filling the form -- search, then
// drag the marker a few times -- so it gets a looser budget of its own.
// The lookup budget is what protects OpenStreetMap: every lookup costs a
// Nominatim request, and uncounted this would be an open proxy to a
// service run on donated hardware.
const LIMITS = {
	pin:    { perIpHour: 3,  perIpDay: 6,  totalHour: 40 },
	lookup: { perIpHour: 20, perIpDay: 60, totalHour: 300 },
};

const TOKEN_TTL_SECONDS = 900;      // 15 minutes to confirm a geocode
const MAX_LOCATION_CHARS = 120;
const MAX_NOTE_CHARS = 200;
const GEOCODE_CACHE_TTL = 60 * 60 * 24 * 30;   // Nominatim asks that we cache

// gprmax.org is becoming the canonical home; .com stays listed because it
// will forward for the foreseeable future and a forwarded request can still
// arrive with a .com Origin. Listed before the move rather than after, so
// the form never has a window where it is refused.
const ALLOWED_ORIGINS = [
	'https://gprmax.org',
	'https://www.gprmax.org',
	'https://www.gprmax.com',
	'https://gprmax.com',
	'https://gprmax.github.io',
	'http://127.0.0.1:4011',
	'http://localhost:4011',
];

/* ------------------------------------------------------------- utils --- */

function cors(origin) {
	const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
	return {
		'Access-Control-Allow-Origin': allow,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Vary': 'Origin',
	};
}

const json = (body, status, headers) =>
	Response.json(body, { status: status || 200, headers });

const fail = (message, headers, status) =>
	json({ ok: false, error: message }, status || 400, headers);

/** Control characters out, whitespace collapsed, trimmed, length capped. */
function cleanText(value, maxChars) {
	if (typeof value !== 'string') { return ''; }
	const out = value
		.replace(/[\x00-\x1F\x7F]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
	return Array.from(out).slice(0, maxChars).join('');
}

const stripMarkup = (text) => text.replace(/<\/?[a-zA-Z][^>]*>/gu, '');

// A free-text note on a public map: the only thing a spammer wants from it
// is a link.
const looksLikeSpam = (note) => /(https?:\/\/|www\.|\[url|<a\s)/i.test(note);

/**
 * Strip noise from a Nominatim display name.
 *
 * Mirrors tidy_place_name() in the PHP, which in turn mirrors the one-off
 * clean applied to the Padlet import. All three must stay in step or new
 * pins slowly reintroduce the postcodes and house numbers that were
 * cleaned out.
 *
 * Conservative by design: it removes codes and numbers, never a component
 * that carries a name. "University of X, <street>, <town>" is the most
 * informative kind of entry on the map and survives intact.
 */
function tidyPlaceName(name) {
	const seen = new Map();

	for (let part of String(name).split(',')) {
		part = part.split('|')[0].trim();
		if (!part) { continue; }
		if (/^\d+[A-Za-z]?$/u.test(part)) { continue; }                     // bare house number
		if (/^[A-Za-z]{0,2}\d[\dA-Za-z-]{1,8}$/u.test(part)) { continue; }  // bare code

		part = part
			.replace(/\b[A-Z]{1,2}\d{1,4}[A-Z]?\s+\d[A-Z]{2}\b/gu, '')  // "Edinburgh EH9 3DW"
			.replace(/^[A-Za-z]{0,2}\d{3,6}\s+(?=\S)/u, '')             // "1190 Wien" -> "Wien"
			.replace(/\b\d{5,6}\b/gu, '')
			.replace(/[\s,]*邮政编码[:：]?\s*$/u, '')
			.replace(/^[\s\t\-,:;]+|[\s\t\-,:;]+$/gu, '');

		if (!part) { continue; }
		const key = part.toLowerCase();
		if (!seen.has(key)) { seen.set(key, part); }              // "Paris, Paris, France"
	}

	const joined = Array.from(seen.values()).join(', ');
	return joined || String(name);
}

/* ------------------------------------------------------------ tokens --- */

const b64url = (bytes) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s) =>
	Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(secret) {
	return crypto.subtle.importKey(
		'raw', new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
	);
}

async function signLocation(env, lat, lon, name) {
	const payload = JSON.stringify({
		lat: Math.round(lat * 1e5) / 1e5,
		lon: Math.round(lon * 1e5) / 1e5,
		name,
		exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
	});
	const body = b64url(new TextEncoder().encode(payload));
	const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env.HMAC_SECRET),
		new TextEncoder().encode(body)));
	return body + '.' + sig;
}

async function verifyLocation(env, token) {
	if (typeof token !== 'string' || token.split('.').length !== 2) { return null; }
	const [body, sig] = token.split('.');

	let expected;
	try {
		expected = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env.HMAC_SECRET),
			new TextEncoder().encode(body)));
	} catch { return null; }

	// Constant-time compare: an early-exit compare on an HMAC is how
	// signature forgery oracles start.
	if (sig.length !== expected.length) { return null; }
	let diff = 0;
	for (let i = 0; i < sig.length; i++) { diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i); }
	if (diff !== 0) { return null; }

	try {
		const claim = JSON.parse(new TextDecoder().decode(unb64url(body)));
		if (!claim || (claim.exp || 0) < Math.floor(Date.now() / 1000)) { return null; }
		return claim;
	} catch { return null; }
}

/* -------------------------------------------------------- rate limits --- */

async function hashedIp(env, ip) {
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.HMAC_SECRET),
		new TextEncoder().encode(ip));
	return b64url(sig).slice(0, 16);      // never store a raw address
}

/**
 * Returns null when allowed, or a message when the caller has had enough.
 *
 * Fails CLOSED. KV writes are capped on the free plan, so the moment this
 * cannot record a request is the moment a flood is underway -- exactly
 * when letting traffic through would hand Nominatim the bill.
 */
async function enforceRateLimit(env, bucket, ip) {
	const limit = LIMITS[bucket];
	const now = new Date();
	const hour = now.toISOString().slice(0, 13);      // 2026-08-28T21
	const day = now.toISOString().slice(0, 10);
	const who = await hashedIp(env, ip);

	const counters = [
		{ key: 'rl:' + bucket + ':' + who + ':h:' + hour, max: limit.perIpHour, ttl: 7200 },
		{ key: 'rl:' + bucket + ':' + who + ':d:' + day, max: limit.perIpDay, ttl: 172800 },
		{ key: 'rl:' + bucket + ':all:h:' + hour, max: limit.totalHour, ttl: 7200 },
	];

	try {
		const counts = await Promise.all(counters.map((c) => env.MAP_STATE.get(c.key)));
		for (let i = 0; i < counters.length; i++) {
			if (parseInt(counts[i] || '0', 10) >= counters[i].max) {
				return bucket === 'pin'
					? 'That is a lot of pins from one place. Please try again later.'
					: 'Too many lookups from this connection. Please try again shortly.';
			}
		}
		await Promise.all(counters.map((c, i) =>
			env.MAP_STATE.put(c.key, String(parseInt(counts[i] || '0', 10) + 1),
				{ expirationTtl: c.ttl })));
		return null;
	} catch (e) {
		console.error('rate limiter unavailable', e);
		return 'The map is busy at the moment. Please try again shortly.';
	}
}

/* --------------------------------------------------------- nominatim --- */

/**
 * The distinction matters: an empty result means "no such place" and is the
 * visitor's problem to fix, while a 403 or 429 means OpenStreetMap has
 * throttled us and is emphatically not. Telling someone their town does
 * not exist because we got rate limited is the wrong answer.
 */
async function nominatim(env, path, params, cacheKey) {
	if (cacheKey) {
		try {
			const hit = await env.MAP_STATE.get(cacheKey, 'json');
			if (hit) { return { ok: true, data: hit, cached: true }; }
		} catch { /* a cold cache is not an error */ }
	}

	const url = 'https://nominatim.openstreetmap.org/' + path + '?' + new URLSearchParams(params);
	let res;
	try {
		res = await fetch(url, {
			headers: { 'User-Agent': NOMINATIM_UA, 'Accept': 'application/json' },
		});
	} catch (e) {
		console.error('nominatim unreachable', e);
		return { ok: false };
	}

	if (res.status === 403 || res.status === 429) {
		// Worth watching: a Worker egresses from Cloudflare's shared address
		// space, which Nominatim is likelier to have throttled than the
		// single host this used to run on.
		console.error('nominatim throttled us:', res.status);
		return { ok: false };
	}
	if (!res.ok) { return { ok: false }; }

	let data;
	try { data = await res.json(); } catch { return { ok: false }; }

	if (cacheKey) {
		try {
			await env.MAP_STATE.put(cacheKey, JSON.stringify(data), { expirationTtl: GEOCODE_CACHE_TTL });
		} catch { /* an unwritten cache entry is not worth failing the request */ }
	}
	return { ok: true, data };
}

/**
 * Bring a place name under the length cap without cutting a word in half.
 *
 * A Nominatim name reads specific to general -- "Northumbria University,
 * Sandyford Road, ..., England, United Kingdom" -- so when it is too long
 * the tail is what to drop. A hard character cut produced "... United
 * Kingd", which is what a broken page looks like.
 */
function capPlaceName(name, maxChars) {
	if (Array.from(name).length <= maxChars) { return name; }

	const parts = name.split(', ');
	while (parts.length > 1) {
		parts.pop();
		const joined = parts.join(', ');
		if (Array.from(joined).length <= maxChars) { return joined; }
	}
	// One component longer than the whole cap: a hard cut is all that is left.
	return Array.from(name).slice(0, maxChars).join('');
}

async function resolved(env, lat, lon, rawName) {
	// Clean generously, then trim on component boundaries.
	const name = capPlaceName(cleanText(tidyPlaceName(rawName), 400), MAX_LOCATION_CHARS);
	return {
		ok: true,
		lat: lat,
		lon: lon,
		location_name: name,
		token: await signLocation(env, lat, lon, name),
	};
}

/* ---------------------------------------------------------- handlers --- */

const UNAVAILABLE_MSG = 'The place lookup service is unavailable right now. Please try again later.';

async function handleGeocode(env, form, ip, headers) {
	const q = cleanText(form.get('q'), MAX_LOCATION_CHARS);
	if (!q) { return fail('Please enter a place name.', headers); }

	const limited = await enforceRateLimit(env, 'lookup', ip);
	if (limited) { return fail(limited, headers, 429); }

	const r = await nominatim(env, 'search',
		{ q: q, format: 'jsonv2', limit: '1', addressdetails: '0' },
		'geo:s:' + q.toLowerCase());

	if (!r.ok) { return fail(UNAVAILABLE_MSG, headers, 503); }
	if (!Array.isArray(r.data) || r.data.length === 0) {
		return fail('We could not find that place. Try a town or city name.', headers, 404);
	}

	const hit = r.data[0];
	return json(await resolved(env, parseFloat(hit.lat), parseFloat(hit.lon), hit.display_name),
		200, headers);
}

async function handleReverse(env, form, ip, headers) {
	const lat = parseFloat(form.get('lat'));
	const lon = parseFloat(form.get('lon'));
	if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
		return fail('That point is not on the map.', headers);
	}

	const limited = await enforceRateLimit(env, 'lookup', ip);
	if (limited) { return fail(limited, headers, 429); }

	// Cached to ~100 m, so nudging the marker a little reuses the answer.
	const r = await nominatim(env, 'reverse',
		{ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '10' },
		'geo:r:' + lat.toFixed(3) + ',' + lon.toFixed(3));

	if (!r.ok) { return fail(UNAVAILABLE_MSG, headers, 503); }
	const name = r.data && r.data.display_name;
	if (!name) { return fail('We could not name that spot. Try dragging the marker onto land.', headers, 404); }

	return json(await resolved(env, lat, lon, name), 200, headers);
}

async function handleAdd(env, form, ip, headers) {
	// Honeypot: a real person never fills a field they cannot see. Answer as
	// if it worked, so a bot has nothing to tune against.
	if (cleanText(form.get('website'), 50) !== '') {
		return json({ ok: true, queued: true }, 200, headers);
	}

	const claim = await verifyLocation(env, form.get('token'));
	if (!claim) {
		return fail('That confirmation expired. Please search for your location again.', headers);
	}
	if (form.get('consent') !== 'yes') {
		return fail('Please tick the box to confirm your location can be shown publicly.', headers);
	}

	const note = stripMarkup(cleanText(form.get('note'), MAX_NOTE_CHARS));
	if (note && looksLikeSpam(note)) {
		return fail('Links are not allowed in the note. Please remove it and try again.', headers);
	}

	const limited = await enforceRateLimit(env, 'pin', ip);
	if (limited) { return fail(limited, headers, 429); }

	const feature = {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [claim.lon, claim.lat] },
		properties: {
			location_name: claim.name,
			body: note,
			created_at: new Date().toISOString().slice(0, 10),
		},
	};

	const issueBody = [
		'A new pin was submitted for **' + claim.name + '**.',
		note ? '\n> ' + note + '\n' : '\nNo note was left.\n',
		'Approve by adding the `approved` label; the pin is appended and the site redeploys.',
		'',
		'```json',
		JSON.stringify(feature, null, 2),
		'```',
	].join('\n');

	const res = await fetch('https://api.github.com/repos/' + REPO + '/issues', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'gprMax-usermap-worker',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			title: 'Map pin: ' + claim.name,
			labels: [ISSUE_LABEL],
			body: issueBody,
		}),
	});

	if (!res.ok) {
		console.error('github issue failed', res.status, await res.text());
		return fail('We could not record that just now. Please try again later.', headers, 503);
	}

	return json({
		ok: true,
		queued: true,
		lat: claim.lat,
		lon: claim.lon,
		location_name: claim.name,
		note: note,
	}, 200, headers);
}

/* ------------------------------------------------------------- entry --- */

export default {
	async fetch(request, env) {
		const headers = cors(request.headers.get('Origin') || '');

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers });
		}

		const url = new URL(request.url);

		if (url.pathname === '/health') {
			let kv = 'unavailable';
			try {
				await env.MAP_STATE.put('health', new Date().toISOString(), { expirationTtl: 60 });
				kv = (await env.MAP_STATE.get('health')) ? 'ok' : 'wrote but could not read';
			} catch (e) { kv = 'error: ' + e.message; }

			return json({
				worker: 'ok',
				kv: kv,
				secrets: {
					HMAC_SECRET: env.HMAC_SECRET ? 'set' : 'MISSING',
					GITHUB_TOKEN: env.GITHUB_TOKEN ? 'set' : 'MISSING',
				},
			}, 200, headers);
		}

		if (request.method !== 'POST') { return fail('Send a POST.', headers, 405); }

		let form;
		try { form = new URLSearchParams(await request.text()); }
		catch { return fail('Malformed request.', headers); }

		const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

		switch (form.get('action')) {
			case 'geocode': return handleGeocode(env, form, ip, headers);
			case 'reverse': return handleReverse(env, form, ip, headers);
			case 'add':     return handleAdd(env, form, ip, headers);
			default:        return fail('Unknown action.', headers);
		}
	},
};
