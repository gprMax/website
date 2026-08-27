/* ============================================================
   Light/dark switch.

   Three states, cycling Auto -> Light -> Dark -> Auto. "Auto"
   removes the attribute entirely so prefers-color-scheme governs,
   which is the default for anyone who never touches this.

   main.css already carries html[data-theme='light'|'dark'] blocks,
   so the switch only has to set one attribute; every colour on the
   site follows from the tokens.

   The button starts hidden and is revealed here, so it never appears
   as a dead control when JavaScript is unavailable.
   ============================================================ */
(function () {
	'use strict';

	var KEY = 'gprmax-theme';
	var btn = document.getElementById('theme-toggle');
	if (!btn) { return; }

	var icons = {
		auto: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5V13.5a5.5 5.5 0 010-11z"/></svg>',
		light: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 .8v2.1M8 13.1v2.1M.8 8h2.1M13.1 8h2.1M2.9 2.9l1.5 1.5M11.6 11.6l1.5 1.5M13.1 2.9l-1.5 1.5M4.4 11.6l-1.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
		dark: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M13.2 10.4A5.6 5.6 0 016.1 3.2a5.8 5.8 0 102.4 11 5.8 5.8 0 004.7-3.8z"/></svg>'
	};
	var labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
	var order = ['auto', 'light', 'dark'];

	function stored() {
		try {
			var v = localStorage.getItem(KEY);
			return (v === 'light' || v === 'dark') ? v : 'auto';
		} catch (e) { return 'auto'; }
	}

	function apply(mode) {
		if (mode === 'auto') { delete document.documentElement.dataset.theme; }
		else { document.documentElement.dataset.theme = mode; }
		try {
			if (mode === 'auto') { localStorage.removeItem(KEY); }
			else { localStorage.setItem(KEY, mode); }
		} catch (e) { /* private mode: the choice just will not persist */ }

		btn.querySelector('.theme-toggle-icon').innerHTML = icons[mode];
		btn.querySelector('.theme-toggle-label').textContent = labels[mode];
		btn.setAttribute('aria-label', 'Colour theme: ' + labels[mode] + '. Activate to change.');
		btn.setAttribute('title', 'Colour theme: ' + labels[mode]);

		// The map basemap and the publication charts pick their colours in
		// JavaScript at load, so CSS alone cannot restyle them. Tell them.
		document.dispatchEvent(new CustomEvent('gprmax:themechange', {
			detail: { mode: mode, dark: isDark() }
		}));
	}

	function isDark() {
		var attr = document.documentElement.dataset.theme;
		if (attr === 'dark') { return true; }
		if (attr === 'light') { return false; }
		return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
	}

	btn.hidden = false;
	apply(stored());

	btn.addEventListener('click', function () {
		apply(order[(order.indexOf(stored()) + 1) % order.length]);
	});

	// While in Auto, follow the OS if it changes underneath us.
	if (window.matchMedia) {
		var mq = window.matchMedia('(prefers-color-scheme: dark)');
		var onChange = function () { if (stored() === 'auto') { apply('auto'); } };
		if (mq.addEventListener) { mq.addEventListener('change', onChange); }
		else if (mq.addListener) { mq.addListener(onChange); }
	}
})();
