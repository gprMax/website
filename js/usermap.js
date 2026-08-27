/* ============================================================
   gprMax community map. Save as js/usermap.js.

   Reads users/pins.geojson and posts new pins to users/submit_pin.php.
   No build step, no framework, no keys.
   ============================================================ */

(function () {
	'use strict';

	var PINS_URL = 'users/pins.geojson';
	var SUBMIT_URL = 'users/submit_pin.php';

	/* Pins wear the site heading token from main.css — brand purple in light
	   mode, brand pink in dark — read live so the map can never drift from
	   the palette. Full strength for the dot, low alpha for the halo, so
	   where pins overlap the halos stack toward the same colour and dense
	   regions read stronger. Nothing on the basemap is this colour. */
	var PURPLE = (getComputedStyle(document.body).getPropertyValue('--heading') || '#55037F').trim() || '#55037F';
	var PURPLE_RGB = (function (hex) {
		var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
		return m ? parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) : '85, 3, 127';
	})(PURPLE);
	var DARK_MODE = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
		&& document.documentElement.dataset.theme !== 'light')
		|| document.documentElement.dataset.theme === 'dark';

	var $ = function (id) { return document.getElementById(id); };
	var wrap = $('usermap-wrap');
	if (!wrap) { return; }

	var map = L.map('usermap', {
		center: [26, 12],
		zoom: 2,
		minZoom: 1,
		maxZoom: 16,
		zoomSnap: 0.25,
		/* One world, not a repeating strip: a second copy carrying no pins
		   looks like a loading fault rather than a design choice. */
		maxBounds: [[-85, -180], [85, 180]],
		maxBoundsViscosity: 0.75,
		zoomControl: false,
		/* The map now sits in the middle of the homepage: leave the wheel to
		   the page until the visitor clicks the map, then hand it over, and
		   give it back when the pointer leaves. Zoom stays available via the
		   +/- control and pinch throughout. */
		scrollWheelZoom: false
	});
	L.control.zoom({ position: 'bottomright' }).addTo(map);
	map.on('click', function () { map.scrollWheelZoom.enable(); });
	wrap.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });

	/* CARTO Positron / Dark Matter: near-monochrome, so neither carries any
	   colour that competes with the pins, and each sits quietly inside its
	   page — light tiles on the light page, dark tiles on the dark one. */
	L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_'
		+ (DARK_MODE ? 'Dark' : 'Light') + '_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
		attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ',
		maxZoom: 16,
		noWrap: true
	}).addTo(map);

	var haloCanvas = L.canvas({ padding: 0.5 });
	var coreCanvas = L.canvas({ padding: 0.5 });

	var haloLayer = L.layerGroup();
	var coreLayer = L.layerGroup();
	var everyPin = L.layerGroup([haloLayer, coreLayer]);

	var grouped = L.markerClusterGroup({
		maxClusterRadius: 48,
		showCoverageOnHover: false,
		iconCreateFunction: function (cluster) {
			var n = cluster.getChildCount();
			var size = n < 10 ? 32 : n < 50 ? 40 : n < 150 ? 50 : 60;
			var alpha = n < 10 ? 0.72 : n < 50 ? 0.82 : 0.92;
			return L.divIcon({
				className: '',
				html: '<div class="ump-cluster" style="width:' + size + 'px;height:' + size + 'px;'
					+ 'background:rgba(' + PURPLE_RGB + ',' + alpha + ');'
					+ 'font-size:' + (size < 40 ? 12 : 14) + 'px;">' + n + '</div>',
				iconSize: [size, size]
			});
		}
	});

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	function popupHtml(p) {
		var html = '<span class="ump-pop-where">' + escapeHtml(p.location_name || 'Unknown location') + '</span>';
		if (p.body) { html += '<span class="ump-pop-note">' + escapeHtml(p.body) + '</span>'; }
		if (p.created_at) {
			html += '<span class="ump-pop-when">' + escapeHtml(String(p.created_at).slice(0, 10)) + '</span>';
		}
		return html;
	}

	/* Two people in one town are two pins. They are never merged or rejected:
	   overlapping halos simply darken, which is the honest picture. */
	function addPin(lat, lon, props) {
		haloLayer.addLayer(L.circleMarker([lat, lon], {
			renderer: haloCanvas, radius: 12, stroke: false,
			fillColor: PURPLE, fillOpacity: 0.13, interactive: false
		}));
		coreLayer.addLayer(L.circleMarker([lat, lon], {
			renderer: coreCanvas, radius: 3.6, weight: 1.1,
			color: '#FFFFFF', fillColor: PURPLE, fillOpacity: 0.95
		}).bindPopup(popupHtml(props)));

		grouped.addLayer(L.circleMarker([lat, lon], {
			radius: 5, weight: 1.4, color: '#FFFFFF',
			fillColor: PURPLE, fillOpacity: 0.92
		}).bindPopup(popupHtml(props)));
	}

	/* --------------------------------------------------------- views --- */

	var current = everyPin;
	map.addLayer(everyPin);

	function setView(which) {
		var next = which === 'grouped' ? grouped : everyPin;
		if (next === current) { return; }
		map.removeLayer(current);
		map.addLayer(next);
		current = next;
		$('v-all').setAttribute('aria-pressed', String(which !== 'grouped'));
		$('v-grouped').setAttribute('aria-pressed', String(which === 'grouped'));
	}
	$('v-all').addEventListener('click', function () { setView('all'); });
	$('v-grouped').addEventListener('click', function () { setView('grouped'); });

	function setClean(on) {
		wrap.classList.toggle('clean', on);
		if (on) { $('ump-restore').focus(); } else { $('go-clean').focus(); }
	}
	$('go-clean').addEventListener('click', function () { setClean(true); });
	$('ump-restore').addEventListener('click', function () { setClean(false); });

	/* ---------------------------------------------------------- load --- */

	fetch(PINS_URL, { cache: 'no-cache' })
		.then(function (r) {
			if (!r.ok) { throw new Error('HTTP ' + r.status); }
			return r.json();
		})
		.then(function (data) {
			var features = data.features || [];
			var places = {};
			var earliest = null;
			var bounds = L.latLngBounds([]);

			features.forEach(function (f) {
				var c = f.geometry && f.geometry.coordinates;
				if (!c || c.length < 2) { return; }
				var props = f.properties || {};
				addPin(c[1], c[0], props);
				bounds.extend([c[1], c[0]]);
				places[c[0].toFixed(2) + ',' + c[1].toFixed(2)] = 1;
				if (props.created_at && (earliest === null || props.created_at < earliest)) {
					earliest = props.created_at;
				}
			});

			/* Frame the pins rather than the globe, so the map opens filled
			   edge to edge instead of padded with empty ocean. */
			if (bounds.isValid()) {
				map.fitBounds(bounds, { padding: [24, 24], animate: false });
			}

			$('n-pins').textContent = features.length;
			$('n-places').textContent = Object.keys(places).length;
			$('n-since').textContent = earliest ? earliest.slice(0, 4) : '—';
		})
		.catch(function (err) {
			$('n-pins').textContent = '!';
			say('The map data could not be loaded (' + err.message + ').', 'err');
		});

	/* -------------------------------------------------------- submit --- */

	var form = $('ump-add');
	var msg = $('msg');
	var pending = null;
	var preview = null;

	function say(text, kind) {
		msg.textContent = text || '';
		msg.className = 'ump-msg' + (kind ? ' ' + kind : '');
	}

	function post(fields) {
		var payload = new URLSearchParams();
		Object.keys(fields).forEach(function (k) { payload.append(k, fields[k]); });
		payload.append('website', $('website').value);
		return fetch(SUBMIT_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: payload.toString()
		}).then(function (r) {
			return r.json().catch(function () {
				throw new Error('The server sent an unexpected response.');
			});
		});
	}

	function openForm(open) {
		form.classList.toggle('open', open);
		$('open-add').disabled = open;
		if (open) { $('q').focus(); }
	}

	function clearPreview() {
		if (preview) { map.removeLayer(preview); preview = null; }
	}

	function showPreview(lat, lon) {
		clearPreview();
		preview = L.marker([lat, lon], {
			draggable: true,
			icon: L.divIcon({
				className: '',
				html: '<div class="ump-fresh" style="width:16px;height:16px;"></div>',
				iconSize: [16, 16]
			})
		}).addTo(map);
		preview.on('dragend', function () {
			var p = preview.getLatLng();
			lookupPoint(p.lat, p.lng);
		});
	}

	function toConfirm(res) {
		pending = res;
		$('where').textContent = res.location_name;
		$('step-choose').hidden = true;
		$('step-confirm').hidden = false;
		openForm(true);
		showPreview(res.lat, res.lon);
		say('');
	}

	function toChoose() {
		$('step-confirm').hidden = true;
		$('step-choose').hidden = false;
		clearPreview();
		pending = null;
		say('');
	}

	$('open-add').addEventListener('click', function () { openForm(true); });
	$('cancel').addEventListener('click', function () { openForm(false); toChoose(); });
	$('back').addEventListener('click', function () { toChoose(); $('q').focus(); });

	form.addEventListener('submit', function (e) {
		e.preventDefault();
		var q = $('q').value.trim();
		if (q.length < 2) {
			say('Please enter a town or city, or place your pin on the map.', 'err');
			return;
		}

		$('find').disabled = true;
		say('Looking that up…');

		post({ action: 'geocode', q: q })
			.then(function (res) {
				$('find').disabled = false;
				if (!res.ok) { say(res.error, 'err'); return; }
				toConfirm(res);
				map.flyTo([res.lat, res.lon], 7, { duration: 1.1 });
			})
			.catch(function (err) { $('find').disabled = false; say(err.message, 'err'); });
	});

	function lookupPoint(lat, lon) {
		say('Working out where that is…');
		post({ action: 'reverse', lat: lat, lon: lon })
			.then(function (res) {
				if (!res.ok) { say(res.error, 'err'); return; }
				toConfirm(res);
			})
			.catch(function (err) { say(err.message, 'err'); });
	}

	function onPickClick(e) {
		setPicking(false);
		openForm(true);
		showPreview(e.latlng.lat, e.latlng.lng);
		lookupPoint(e.latlng.lat, e.latlng.lng);
	}

	/* on/off rather than once(): Leaflet's once() leaves an internal wrapper
	   registered that a plain off() would not remove when picking is
	   cancelled, and the next map click would be swallowed. */
	function setPicking(on) {
		wrap.classList.toggle('picking', on);
		if (on) { map.on('click', onPickClick); } else { map.off('click', onPickClick); }
	}

	$('pick').addEventListener('click', function () { setPicking(true); });
	$('pick-cancel').addEventListener('click', function () { setPicking(false); openForm(true); });

	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Escape') { return; }
		if (wrap.classList.contains('picking')) { setPicking(false); openForm(true); }
		else if (wrap.classList.contains('clean')) { setClean(false); }
	});

	$('confirm').addEventListener('click', function () {
		if (!pending) { return; }
		if (!$('consent').checked) {
			say('Please tick the box so we can show your pin.', 'err');
			return;
		}

		$('confirm').disabled = true;
		say('Adding your pin…');

		post({ action: 'add', token: pending.token, note: $('note').value, consent: 'yes' })
			.then(function (res) {
				$('confirm').disabled = false;
				if (!res.ok) { say(res.error, 'err'); return; }

				addPin(res.lat, res.lon, {
					location_name: res.location_name,
					body: res.note,
					created_at: new Date().toISOString()
				});
				$('n-pins').textContent = Number($('n-pins').textContent || 0) + 1;
				say('Added. Thanks for putting yourself on the map!', 'ok');
				clearPreview();

				window.setTimeout(function () {
					openForm(false);
					toChoose();
					form.reset();
				}, 2600);
			})
			.catch(function (err) { $('confirm').disabled = false; say(err.message, 'err'); });
	});
})();
