# Launch Point Global Tour — Facility Map

A single-page interactive world map of the facilities in the Launch Point Global Tour.
Static site, no build step. Leaflet + MarkerCluster loaded from CDN.

## Run locally

From the project folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

## Add a facility

Append one object to the `FACILITIES` array at the top of `app.js`:

```javascript
{ name: "New Facility Name", city: "City, ST", lat: 00.0000, lng: -00.0000 }
```

You need four fields: `name`, `city`, `lat`, `lng`. Then commit and push:

```bash
git add app.js
git commit -m "Add New Facility Name"
git push
```

GitHub Pages redeploys automatically from `main`. The map, sidebar list, search,
and header count all pick up the new entry with no other changes.

## Files

- `index.html` — page shell, loads Leaflet + MarkerCluster from CDN
- `styles.css` — Launch Point branding (black / blue `#1179BF` / white)
- `app.js` — facility data, map, clustering, sidebar, search
- `assets/logo.png` — header logo
