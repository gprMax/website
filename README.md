# gprMax website

Source for [gprmax.org](https://gprmax.org), built with Jekyll and
published to GitHub Pages by `.github/workflows/deploy.yml`.

## Local preview

```bash
bundle install
bundle exec jekyll serve      # http://127.0.0.1:4000
```

Requires Ruby 3.x+ (macOS system Ruby 2.6 is too old).

## Layout

| Path | Purpose |
|---|---|
| `_layouts/default.html` | Page shell — head, header, nav, container, footer, and every stylesheet/script include |
| `_includes/` | `head`, `navbar`, `footer`, `sidebar` |
| `_data/announcements.yml` | Sidebar announcements; the include shows only the last 12 months |
| `_data/bib.yml` | `scopus.bib` date, written by the deploy workflow |
| `css/` | `main.css` (tokens, layout, typography, sidebar, showcase), `navbar.css`, and the page-specific `usermap.css` and `bib-publication-list.css` |
| `lib/` | Self-hosted Leaflet 1.9.4 and Leaflet.markercluster 1.5.3 |
| `*.shtml` | Pages keep their historic extensions — those URLs are cited in papers |
| `404.html` | Served by GitHub Pages for any missing path |
| `.github/workflows/stats.yml` | Daily GitHub traffic collection into `data/*.csv` |

Page behaviour is set in front matter: `body_id` (drives the active-nav
highlight via `css/navbar.css`), plus the flags `gtm`, `leaflet`, `bib` and
`markercluster`, whose defaults live in `_config.yml`. Every page includes
the sidebar itself, directly after its `<h1>`.

## Notes

- `scopus.bib` is a **published runtime asset** — `js/gprMaxBib.js` fetches it
  in the browser. Do not add it to `exclude`.
- `users/pins.geojson` is the minimised, published pin set the maps fetch;
  `tools/minimise_pins.py` regenerates it from the gitignored
  `users/pins.source.geojson`.
- Third-party libraries: Leaflet is self-hosted under `lib/`; jQuery,
  DataTables and Chart.js (publications page only) load from their CDNs,
  version-pinned with integrity hashes in `_layouts/default.html`.
- The traffic collector needs the `GH_TRAFFIC_TOKEN` secret: a fine-grained
  PAT with *Repository metrics: read*. The default `GITHUB_TOKEN` cannot read
  the traffic endpoints.
