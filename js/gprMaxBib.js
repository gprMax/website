$(document).ready(function() {
    /**
     * A custom, tolerant BibTeX parser designed for the Scopus file format.
     */
    const _parseBibtex = function(bibtexString) {
        const entries = [];
        const lines = bibtexString.replace(/\r\n/g, '\n').split('\n');
        let inEntry = false, currentEntry = null, currentField = null, braceCount = 0, valueBuffer = '';

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!inEntry) {
                if (trimmedLine.startsWith('@')) {
                    inEntry = true;
                    const firstBrace = trimmedLine.indexOf('{');
                    const firstComma = trimmedLine.indexOf(',');
                    currentEntry = {
                        entryType: trimmedLine.substring(1, firstBrace).trim().toLowerCase(),
                        cite: trimmedLine.substring(firstBrace + 1, firstComma).trim()
                    };
                }
                continue;
            }

            if (trimmedLine === '}' || trimmedLine === '},') {
                if (currentEntry) entries.push(currentEntry);
                inEntry = false;
                currentEntry = null;
                continue;
            }

            if (currentField) {
                valueBuffer += ' ' + trimmedLine;
                for (const char of trimmedLine) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
                if (braceCount <= 0) {
                    let finalValue = valueBuffer;
                    if (finalValue.endsWith('},')) finalValue = finalValue.slice(0, -2);
                    else if (finalValue.endsWith('}')) finalValue = finalValue.slice(0, -1);
                    currentEntry[currentField] = finalValue.trim();
                    currentField = null;
                }
            } else if (trimmedLine.includes('=')) {
                const eqIndex = trimmedLine.indexOf('=');
                const key = trimmedLine.substring(0, eqIndex).trim().toLowerCase();
                let value = trimmedLine.substring(eqIndex + 1).trim();
                if (value.startsWith(',')) value = value.substring(1).trim();
                if (value.startsWith('{')) {
                    valueBuffer = value.substring(1);
                    braceCount = (value.match(/{/g) || []).length - (value.match(/}/g) || []).length;
                    if (braceCount > 0) {
                        currentField = key;
                    } else {
                        let finalValue = valueBuffer;
                        if (finalValue.endsWith('},')) finalValue = finalValue.slice(0, -2);
                        else if (finalValue.endsWith('}')) finalValue = finalValue.slice(0, -1);
                        currentEntry[key] = finalValue.trim();
                    }
                }
            }
        }
        if (currentEntry) entries.push(currentEntry);
        return entries;
    };

    const bibtexify = function(bibSrc, tableId) {
        const cacheBustUrl = bibSrc + '?t=' + new Date().getTime();

        $.get(cacheBustUrl, function(bibtexData) {
            try {
                const entries = _parseBibtex(bibtexData);
                if (!entries || entries.length === 0) throw new Error("Parser returned no entries.");
                
                const stats = {};
                const allTypes = new Set();
                entries.forEach(entry => {
                    const year = entry.year || 'N/A';
                    const type = entry.type ? entry.type.charAt(0).toUpperCase() + entry.type.slice(1).toLowerCase() : 'Misc';
                    allTypes.add(type);
                    if (!stats[year]) stats[year] = {};
                    if (!stats[year][type]) stats[year][type] = 0;
                    stats[year][type]++;
                });
                
                const sortedYears = Object.keys(stats).sort();
                const sortedTypes = Array.from(allTypes).sort();
                
                // Categorical palette derived from the site's brand family
                // (violet on Article and blue on Conference paper, the two
                // dominant series), extended with complementary hues so all
                // eight adjacent stacked pairs stay distinguishable. Both
                // mode palettes are validated: lightness band, chroma floor,
                // adjacent-pair colour-vision-deficiency separation, and
                // contrast against the page surface (#ffffff / #111827).
                // Colours are keyed by type so identity is stable: a type
                // absent from a year's data never repaints the others.
                const darkMode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
                    && document.documentElement.dataset.theme !== 'light')
                    || document.documentElement.dataset.theme === 'dark';
                const typeColors = darkMode ? {
                    'Article': '#9085e9',
                    'Book': '#d95926',
                    'Book chapter': '#199e70',
                    'Conference paper': '#3987e5',
                    'Data paper': '#d55181',
                    'Letter': '#008300',
                    'Note': '#c98500',
                    'Review': '#d64545',
                    'Misc': '#8b93a5' // "Other" — neutral, outside the series palette
                } : {
                    'Article': '#4a3aa7',
                    'Book': '#eb6834',
                    'Book chapter': '#1baf7a',
                    'Conference paper': '#2a78d6',
                    'Data paper': '#e87ba4',
                    'Letter': '#008300',
                    'Note': '#eda100',
                    'Review': '#e34948',
                    'Misc': '#6B7A8F'
                };

                // Read the page so chart chrome follows the theme.
                const bodyStyle = getComputedStyle(document.body);
                const surface = bodyStyle.backgroundColor;

                const datasets = sortedTypes.map(type => {
                    const color = typeColors[type] || typeColors['Misc'];
                    return {
                        label: type,
                        data: sortedYears.map(year => stats[year][type] || 0),
                        backgroundColor: color,
                        // Surface-coloured border = a visible gap between
                        // stacked segments (1px, not 2, so one-publication
                        // slivers survive).
                        borderColor: surface,
                        borderWidth: 1
                    };
                });
                
                // Chart.js draws to canvas with its own font defaults, not the
                // page's CSS — read the site stack off <body> so the chart
                // always matches the site typography. The face must be loaded
                // before the chart renders, or canvas silently falls back, so
                // creation waits on document.fonts (the catch covers browsers
                // without the Font Loading API — worst case: fallback font).
                Chart.defaults.font.family = bodyStyle.fontFamily;
                // Labels, title and grid follow the theme tokens rather than
                // Chart.js's fixed greys (which are dim on the dark surface).
                Chart.defaults.color = bodyStyle.getPropertyValue('--text-secondary').trim() || Chart.defaults.color;
                Chart.defaults.borderColor = bodyStyle.getPropertyValue('--border').trim() || Chart.defaults.borderColor;
                Promise.all([
                    document.fonts.load('400 12px "IBM Plex Sans"'),
                    document.fonts.load('700 12px "IBM Plex Sans"')
                ]).catch(function () { }).then(function () {
                    new Chart(document.getElementById('pubChart'), {
                        type: 'bar',
                        data: { labels: sortedYears, datasets: datasets },
                        options: { responsive: true, maintainAspectRatio: true, plugins: { title: { display: true, text: 'Publications per Year by Type' }, legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Number of Publications' } } } }
                    });

                    // ---- Subject and journal breakdowns ----
                    // Subjects are approximate: keyword rules over title +
                    // journal, first match wins, ordered specific -> generic.
                    const subjectRules = [
                        ['Planetary', /mars|martian|lunar|moon|planetary|asteroid|comet|rover|regolith/i],
                        ['Cryosphere', /glaci|\bice\b|\bsnow\b|firn|permafrost|antarct|arctic|cryosph/i],
                        ['Bio-EM & medical', /breast|brain|stroke|tumou?r|medical|biomedical|tissue|in vivo|\bbone\b|cardio/i],
                        ['Landmines & UXO', /landmine|\bmine\b|demining|unexploded|uxo|\bied\b/i],
                        ['Archaeology & forensics', /archaeo|heritage|tomb|\bgrave\b|cemetery|forensic|masonry/i],
                        ['Vegetation & agriculture', /\broot\b|roots|tree|trunk|forest|crop|agricult|vegetat|orchard/i],
                        ['Infrastructure & NDT', /concrete|rebar|bridge|pavement|asphalt|tunnel|railway|ballast|road|corrosion|structural|building|pipe|utilit|culvert|dam\b/i],
                        ['Antennas & hardware', /antenna|dipole|bowtie|horn|transduc|radar system|hardware/i],
                        ['Soils & hydrology', /\bsoil|moisture|hydrol|groundwater|vadose|aquifer|infiltrat|water content/i],
                        ['Methods & machine learning', /neural|deep learning|machine learning|inversion|full.?waveform|migration|clutter|imaging|processing|attribute|simulation/i],
                    ];
                    const classify = (e) => {
                        const hay = ((e.title || '') + ' ' + (e.journal || e.booktitle || ''));
                        for (const [label, rx] of subjectRules) { if (rx.test(hay)) { return label; } }
                        return 'Other GPR applications';
                    };
                    const subjCounts = {};
                    const jrnCounts = {};
                    entries.forEach(e => {
                        subjCounts[classify(e)] = (subjCounts[classify(e)] || 0) + 1;
                        let j = (e.journal || e.booktitle || '').replace(/\s+/g, ' ').trim();
                        j = j.replace(/^Proceedings of SPIE.*/, 'Proceedings of SPIE');
                        if (j) { jrnCounts[j] = (jrnCounts[j] || 0) + 1; }
                    });
                    const barColor = bodyStyle.getPropertyValue('--link').trim() || '#1656b8';
                    const wrapLabel = (text, width, maxLines) => {
                        const words = text.split(' ');
                        const lines = [];
                        let line = '';
                        words.forEach(w => {
                            if (!line.length) { line = w; }
                            else if ((line + ' ' + w).length <= width) { line += ' ' + w; }
                            else { lines.push(line); line = w; }
                        });
                        if (line.length) { lines.push(line); }
                        if (lines.length > maxLines) {
                            const kept = lines.slice(0, maxLines);
                            kept[maxLines - 1] = kept[maxLines - 1].slice(0, width - 1) + '\u2026';
                            return kept;
                        }
                        return lines;
                    };
                    const hBar = (id, title, pairs) => {
                        const el = document.getElementById(id);
                        if (!el) { return; }
                        new Chart(el, {
                            type: 'bar',
                            data: {
                                // Chart.js renders an array label as stacked lines, so long
                                // journal names wrap rather than being cut off.
                                labels: pairs.map(p => wrapLabel(p[0], 24, 3)),
                                datasets: [{ data: pairs.map(p => p[1]), backgroundColor: barColor, borderRadius: 3 }]
                            },
                            options: {
                                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                                plugins: { title: { display: true, text: title }, legend: { display: false } },
                                scales: {
                                    x: { beginAtZero: true },
                                    // wrapped labels are taller, so Chart.js starts skipping
                                    // every other one unless told otherwise
                                    y: { ticks: { autoSkip: false } }
                                }
                            }
                        });
                        const rows = pairs.reduce((n, p) => n + Math.max(1, wrapLabel(p[0], 24, 3).length), 0);
                        el.parentElement.style.height = (rows * 20 + 90) + 'px';
                    };
                    const OTHER = 'Other GPR applications';
                    const subjPairs = Object.entries(subjCounts)
                        .sort((a, b) => (a[0] === OTHER) - (b[0] === OTHER) || b[1] - a[1]);
                    hBar('subjectChart', 'Publications by subject', subjPairs);
                    hBar('journalChart', 'Most frequent journals',
                        Object.entries(jrnCounts).sort((a, b) => b[1] - a[1]).slice(0, 10));
                });
                
                const dataSet = entries.map(entry => {
                    const authors = entry.author ? entry.author.replace(/ and /gi, '; ') : '';
                    let pubHtml = `<div class="publication-details"><span class="authors">${authors}</span> (${entry.year || ''}). `;
                    pubHtml += `<span class="title">${entry.title || ''}</span>. `;
                    pubHtml += `<span class="journal">${entry.journal || entry.booktitle || ''}</span>`;
                    if (entry.volume) pubHtml += `, <em>${entry.volume}</em>`;
                    if (entry.number) pubHtml += `(${entry.number})`;
                    if (entry.pages) pubHtml += `, pp. ${entry.pages.replace(/--/g, '–')}`;
                    pubHtml += '. ';
                    if (entry.doi) pubHtml += `<a href="https://doi.org/${entry.doi}" target="_blank">${entry.doi}</a>`;
                    pubHtml += '</div>';
                    const entryType = entry.type ? entry.type.charAt(0).toUpperCase() + entry.type.slice(1).toLowerCase() : 'Misc';
                    return [entry.year || 'N/A', entryType, pubHtml];
                });

                new DataTable('#' + tableId, {
                    data: dataSet,
                    columns: [{ title: 'Year' }, { title: 'Type' }, { title: 'Publication Details', orderable: false }],
                    order: [[0, 'desc']],
                    pageLength: 25
                });

            } catch (error) {
                console.error("An error occurred while processing the BibTeX data:", error);
                $('#' + tableId).html('<tr><td>An error occurred processing the BibTeX file.</td></tr>');
            }
        }).fail(function() {
            $('#' + tableId).html(`<tr><td><strong>Error:</strong> Could not load the BibTeX file.</td></tr>`);
        });
    };

    // Initialize the function on the 'pubTable' element, loading from 'scopus.bib'
    bibtexify("scopus.bib", "pubTable");
});