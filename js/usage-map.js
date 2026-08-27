/* ============================================================
   Mini community map for the shared "Usage" sidebar panel
   (ssi/sidebar.html). Non-interactive: the whole strip is a
   link through to usermap.shtml, where the full map lives.
   Reads the same users/pins.geojson the full map uses.
   ============================================================ */

(function () {
	'use strict';

	if (!document.getElementById('gprmax-usermap-canvas') || !window.L) { return; }

	var map = L.map('gprmax-usermap-canvas', {
		center: [22, 8],
		zoom: 1,
		zoomSnap: 0,          // fit the pins exactly rather than to whole zoom levels
		zoomControl: false,
		attributionControl: true,
		dragging: false,
		scrollWheelZoom: false,
		doubleClickZoom: false,
		boxZoom: false,
		keyboard: false,
		touchZoom: false
	});

	// Basemap and pins follow the site theme: CARTO dark_all tiles and
	// the dark heading token (brand pink) on the dark page; light_all
	// and brand purple otherwise.
	var gmDark = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
		&& document.documentElement.dataset.theme !== 'light')
		|| document.documentElement.dataset.theme === 'dark';
	var gmPin = (getComputedStyle(document.body).getPropertyValue('--heading') || '#55037F').trim() || '#55037F';
	L.tileLayer('https://{s}.basemaps.cartocdn.com/' + (gmDark ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}{r}.png', {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> '
			+ 'contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
		subdomains: 'abcd',
		maxZoom: 19,
		noWrap: true          // one world only; a repeated copy with no pins reads as a bug
	}).addTo(map);

	var halo = L.canvas({ padding: 0.5 });
	var core = L.canvas({ padding: 0.5 });

	var pinBounds = null;

	// Show every pin, with a hair of margin so none sits on an edge.
	// An earlier version fitted the longitude span to the width and
	// let the top and bottom crop, which cut off the New Zealand and
	// west-coast pins; fitting the bounds themselves keeps the lot.
	function showAllPins() {
		if (!pinBounds || !pinBounds.isValid()) { return; }

		map.fitBounds(pinBounds, { padding: [4, 4], animate: false });

		// The pins straddle the Pacific, so fitBounds centres the view
		// far enough east that the strip runs past the antimeridian —
		// and with noWrap there is nothing to draw out there, leaving a
		// blank band. Slide the centre back until the world covers the
		// full width; the pins stay inside because the strip is wider
		// than their longitude span at this zoom.
		var size = map.getSize();
		var worldPx = 256 * Math.pow(2, map.getZoom());
		if (worldPx > size.x) {
			var halfSpan = (size.x / 2) / (worldPx / 360);
			var c = map.getCenter();
			var lng = Math.min(180 - halfSpan, Math.max(-180 + halfSpan, c.lng));
			if (lng !== c.lng) {
				map.setView([c.lat, lng], map.getZoom(), { animate: false });
			}
		}
	}

	// Leaflet resizes the canvas with the frame but keeps the centre and
	// zoom it was given, so without this the view stays at whatever the
	// window was on load: pins drop off the edges as it narrows, and the
	// sides go grey as it widens. Fires after Leaflet's own rAF-debounced
	// invalidateSize, so it costs one fitBounds per settled resize.
	map.on('resize', showAllPins);

	fetch('users/pins.geojson', { cache: 'no-cache' })
		.then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.json();
		})
		.then(function (data) {
			var features = data.features || [];
			var bounds = L.latLngBounds([]);

			features.forEach(function (f) {
				var c = f.geometry && f.geometry.coordinates;
				if (!c || c.length < 2) return;
				bounds.extend([c[1], c[0]]);
				// Radii scaled down from the old homepage teaser for the
				// panel-sized strip.
				L.circleMarker([c[1], c[0]], {
					renderer: halo, radius: 5, stroke: false,
					fillColor: gmPin, fillOpacity: 0.15, interactive: false
				}).addTo(map);
				L.circleMarker([c[1], c[0]], {
					renderer: core, radius: 1.8, stroke: false,
					fillColor: gmPin, fillOpacity: 0.95, interactive: false
				}).addTo(map);
			});

			pinBounds = bounds;
			showAllPins();

			document.getElementById('gprmax-usermap-text').innerHTML =
				'<b>' + features.length + '</b> users worldwide';
		})
		.catch(function () {
			document.getElementById('gprmax-usermap-text').textContent =
				'Users worldwide';
		});
})();
