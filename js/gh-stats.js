// GitHub traffic stats for the shared sidebar panel (ssi/sidebar.html).
// Two compact tiles: a 365-day headline number plus a sparkline of weekly
// totals over the last 26 weeks, drawn from the same daily CSVs GitHub's
// traffic API feeds (/data/clone_data.csv, /data/visitor_data.csv).

const DAY_MS = 24 * 60 * 60 * 1000;
const SPARK_WEEKS = 26;

// Parse a CSV of "date,count,uniques" rows into totals and weekly buckets.
//
// All dates are handled as UTC midnights, matching the UTC days GitHub's
// traffic API reports, so the arithmetic below is immune to local time
// zones and DST. Rows dated today or later are ignored: today is still in
// progress and a partial day would understate the totals, so the effective
// window ends yesterday.
function processCsvData(csvText, todayUtc) {
	const rows = csvText.trim().split('\n').slice(1);
	const yearStart = todayUtc - 365 * DAY_MS;

	// First pass: parse and total. The headline window ends yesterday; the
	// average is all-time daily uniques, and the month figure covers the
	// current UTC calendar month — the same three figures the original
	// six-box panel showed.
	const now = new Date();
	const currentMonth = now.getUTCMonth();
	const currentYear = now.getUTCFullYear();
	let yearTotal = 0;
	let monthTotal = 0;
	let totalUniques = 0;
	let dayCount = 0;
	let dataEnd = 0; // exclusive upper bound of the data actually present
	const daily = [];
	rows.forEach(row => {
		const columns = row.split(',');
		if (columns.length !== 3) { return; }
		const dateParts = columns[0].split('-'); // YYYY-MM-DD
		const uniqueCount = parseInt(columns[2], 10);
		const y = parseInt(dateParts[0], 10);
		const mo = parseInt(dateParts[1], 10) - 1;
		const rowUtc = Date.UTC(y, mo, parseInt(dateParts[2], 10));
		if (isNaN(rowUtc) || isNaN(uniqueCount) || rowUtc >= todayUtc) { return; }

		totalUniques += uniqueCount;
		dayCount++;
		if (y === currentYear && mo === currentMonth) { monthTotal += uniqueCount; }
		if (rowUtc >= yearStart) { yearTotal += uniqueCount; }
		daily.push([rowUtc, uniqueCount]);
		if (rowUtc + DAY_MS > dataEnd) { dataEnd = rowUtc + DAY_MS; }
	});
	const average = (dayCount > 0) ? totalUniques / dayCount : 0;

	// Second pass: weekly buckets counted back from the LAST DATA ROW, not
	// from today — the CSVs are refreshed periodically, and bucketing from
	// today would leave the newest bucket part-filled whenever the data is
	// a few days stale, ending every sparkline in a false cliff.
	const weeks = new Array(SPARK_WEEKS).fill(0);
	const sparkStart = dataEnd - SPARK_WEEKS * 7 * DAY_MS;
	daily.forEach(([rowUtc, uniqueCount]) => {
		if (rowUtc >= sparkStart) {
			const bucket = Math.floor((rowUtc - sparkStart) / (7 * DAY_MS));
			if (bucket >= 0 && bucket < SPARK_WEEKS) { weeks[bucket] += uniqueCount; }
		}
	});

	return { yearTotal, monthTotal, average, weeks };
}

// Draw weekly totals into a sparkline SVG: a 2px line over a soft area
// fill, both in currentColor so the CSS token carries the colour. The
// viewBox is 100x30 with preserveAspectRatio="none"; the line uses
// vector-effect="non-scaling-stroke" so the stroke stays 2px on screen.
function drawSparkline(svg, weeks) {
	if (!svg || weeks.length < 2) { return; }
	const max = Math.max.apply(null, weeks);
	if (max <= 0) { return; }
	const TOP = 2, BOTTOM = 28;
	const pts = weeks.map((v, i) => {
		const x = (i / (weeks.length - 1)) * 100;
		const y = BOTTOM - (v / max) * (BOTTOM - TOP);
		return x.toFixed(2) + ',' + y.toFixed(2);
	});
	const ns = 'http://www.w3.org/2000/svg';
	const area = document.createElementNS(ns, 'path');
	area.setAttribute('class', 'spark-area');
	area.setAttribute('d', 'M0,' + BOTTOM + ' L' + pts.join(' L') + ' L100,' + BOTTOM + ' Z');
	const line = document.createElementNS(ns, 'path');
	line.setAttribute('class', 'spark-line');
	line.setAttribute('d', 'M' + pts.join(' L'));
	line.setAttribute('vector-effect', 'non-scaling-stroke');
	svg.replaceChildren(area, line);
}

async function displayAllStats() {
	const tiles = [
		{ url: 'data/clone_data.csv', num: document.getElementById('gh-clones-num'), spark: document.getElementById('gh-clones-spark'), sub: document.getElementById('gh-clones-sub') },
		{ url: 'data/visitor_data.csv', num: document.getElementById('gh-visitors-num'), spark: document.getElementById('gh-visitors-spark'), sub: document.getElementById('gh-visitors-sub') }
	];
	if (!tiles[0].num && !tiles[1].num) { return; }

	try {
		const responses = await Promise.all(tiles.map(t => fetch(t.url)));
		if (responses.some(r => !r.ok)) { throw new Error('Could not load one or more data files.'); }
		const texts = await Promise.all(responses.map(r => r.text()));

		const now = new Date();
		const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

		tiles.forEach((t, i) => {
			const stats = processCsvData(texts[i], todayUtc);
			if (t.num) { t.num.textContent = stats.yearTotal.toLocaleString('en-GB'); }
			if (t.sub) {
				t.sub.innerHTML = '<b>' + Math.round(stats.average) + '</b> per day &middot; <b>'
					+ stats.monthTotal.toLocaleString('en-GB') + '</b> this month';
			}
			drawSparkline(t.spark, stats.weeks);
		});
	} catch (error) {
		console.error('Error fetching or processing stats:', error);
		tiles.forEach(t => { if (t.num) { t.num.textContent = 'n/a'; } });
	}
}

displayAllStats();
