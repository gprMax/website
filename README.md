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
| `_layouts/default.html` | Page shell — head, header, nav, container, footer |
| `_includes/` | `head`, `navbar`, `footer`, `sidebar` |
| `_data/announcements.yml` | Sidebar announcements; the include shows only the last 12 months |
| `_data/bib.yml` | `scopus.bib` date, written by the deploy workflow |
| `*.shtml` | Pages keep their historic extensions — those URLs are cited in papers |
| `.github/workflows/stats.yml` | Daily GitHub traffic collection into `data/*.csv` |

Page behaviour is set in front matter: `body_id` (drives the active-nav
highlight via `css/navbar.css`), `sidebar`, `gtm`, `mathjax`, `leaflet`,
`bib`, `markercluster`.

## Notes

- `scopus.bib` is a **published runtime asset** — `js/gprMaxBib.js` fetches it
  in the browser. Do not add it to `exclude`.
- `users/pins.geojson` (community map data) is currently **not committed** —
  see BUILD-SPEC §5. The map renders empty without it.
- The traffic collector needs the `GH_TRAFFIC_TOKEN` secret: a fine-grained
  PAT with *Repository metrics: read*. The default `GITHUB_TOKEN` cannot read
  the traffic endpoints.
