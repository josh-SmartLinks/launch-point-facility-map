// FACILITIES is defined in facilities.js, loaded before this script.

// ---------- Map ----------
const map = L.map("map", {
  worldCopyJump: true,
  zoomControl: true
});

// Required OSM/CARTO credit stays, but drop the optional "Leaflet" prefix.
map.attributionControl.setPrefix(false);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20
}).addTo(map);

// ---------- Marker icons ----------
const pinIcon = L.divIcon({
  className: "",
  html: '<div class="lp-pin"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8]
});

// Phones show the whole country in a narrow viewport, so a fixed 50px radius
// swallowed most pins into clusters. Tighten the radius on small screens (and
// when zoomed out anywhere) so individual dots stay visible.
function clusterRadius(zoom) {
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  if (narrow) return zoom <= 5 ? 18 : 26;
  return zoom <= 5 ? 32 : 50;
}

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: clusterRadius,
  iconCreateFunction: function (c) {
    const count = c.getChildCount();
    const size = count < 10 ? 34 : count < 50 ? 42 : 50;
    return L.divIcon({
      html: '<div class="lp-cluster" style="width:' + size + "px;height:" + size + 'px;"><span>' + count + "</span></div>",
      className: "",
      iconSize: [size, size]
    });
  }
});

// ---------- Build markers + sidebar ----------
const entries = FACILITIES
  .map((f, i) => ({ ...f, i }))
  .sort((a, b) => a.name.localeCompare(b.name));

const markers = {};   // index -> marker
const listItems = {}; // index -> <li>
let activeIndex = null;

const PLATFORM_NAMES = { sgt: "SGT / GSPro", trackman: "Trackman" };

function platformLabel(f) {
  if (!Array.isArray(f.platforms) || !f.platforms.length) return "";
  return f.platforms.map((p) => PLATFORM_NAMES[p] || p).join(" · ");
}

function popupHtml(f) {
  const platforms = platformLabel(f);
  return (
    '<div class="popup-name">' + escapeHtml(f.name) + "</div>" +
    '<div class="popup-city">' + escapeHtml(f.city) + "</div>" +
    (platforms ? '<div class="popup-platform">' + escapeHtml(platforms) + "</div>" : "") +
    (f.sim ? '<div class="popup-sim">' + escapeHtml(f.sim) + "</div>" : "") +
    // Straight into signup with this club already chosen.
    '<a class="popup-signup display" href="/signup.html?type=player&club=' +
      encodeURIComponent(f.name) + '">SIGN UP HERE</a>'
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

FACILITIES.forEach((f, i) => {
  const m = L.marker([f.lat, f.lng], { icon: pinIcon });
  m.bindPopup(popupHtml(f));
  markers[i] = m;
});

// ---------- Sidebar list ----------
const listEl = document.getElementById("facility-list");

function setActive(i) {
  if (activeIndex !== null && listItems[activeIndex]) {
    listItems[activeIndex].classList.remove("active");
  }
  activeIndex = i;
  if (i !== null && listItems[i]) {
    listItems[i].classList.add("active");
  }
}

function flyToFacility(i) {
  const f = FACILITIES[i];
  setActive(i);
  const m = markers[i];
  map.flyTo([f.lat, f.lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
  // Open the popup once movement settles; works whether or not it's clustered.
  map.once("moveend", () => {
    cluster.zoomToShowLayer(m, () => m.openPopup());
  });
  if (window.matchMedia("(max-width: 767px)").matches) {
    closeSidebar();
  }
}

function renderList(items) {
  listEl.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No facilities match.";
    listEl.appendChild(li);
    return;
  }
  items.forEach((f) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "0");
    li.dataset.index = f.i;

    const name = document.createElement("span");
    name.className = "li-name";
    name.textContent = f.name;

    const city = document.createElement("span");
    city.className = "li-city";
    city.textContent = f.city;

    li.appendChild(name);
    li.appendChild(city);

    li.addEventListener("click", () => flyToFacility(f.i));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flyToFacility(f.i);
      }
    });

    listItems[f.i] = li;
    listEl.appendChild(li);
  });
}

// ---------- Search / filter ----------
const searchEl = document.getElementById("search");
const countEl = document.getElementById("facility-count");

function updateCount(n) {
  countEl.textContent = n + (n === 1 ? " FACILITY" : " FACILITIES");
}

// ---------- Platform filter ----------
// Only rendered once at least one club carries a `platforms` tag, so the
// controls never appear with nothing to filter.
const PLATFORM_FILTERS = [
  { key: "all", label: "ALL" },
  { key: "sgt", label: "SGT / GSPRO" },
  { key: "trackman", label: "TRACKMAN" }
];

let activePlatform = "all";

function runsPlatform(f, key) {
  return Array.isArray(f.platforms) && f.platforms.indexOf(key) !== -1;
}

function buildPlatformFilter() {
  const wrap = document.getElementById("platform-filter");
  const anyTagged = FACILITIES.some((f) => Array.isArray(f.platforms) && f.platforms.length);
  if (!wrap || !anyTagged) return;

  PLATFORM_FILTERS.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "platform-chip" + (p.key === activePlatform ? " active" : "");
    btn.textContent = p.label;
    btn.setAttribute("aria-pressed", p.key === activePlatform ? "true" : "false");

    btn.addEventListener("click", () => {
      activePlatform = p.key;
      wrap.querySelectorAll(".platform-chip").forEach((el) => {
        const on = el === btn;
        el.classList.toggle("active", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      applyFilter();
    });

    wrap.appendChild(btn);
  });

  wrap.hidden = false;
}

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  const matched = entries.filter(
    (f) =>
      (f.name.toLowerCase().includes(q) || f.city.toLowerCase().includes(q)) &&
      (activePlatform === "all" || runsPlatform(f, activePlatform))
  );

  // Rebuild sidebar
  Object.keys(listItems).forEach((k) => delete listItems[k]);
  renderList(matched);
  if (activeIndex !== null && listItems[activeIndex]) {
    listItems[activeIndex].classList.add("active");
  }

  // Sync map markers
  cluster.clearLayers();
  const matchedMarkers = matched.map((f) => markers[f.i]);
  cluster.addLayers(matchedMarkers);

  updateCount(matched.length);
}

searchEl.addEventListener("input", applyFilter);

// ---------- Mobile sidebar toggle ----------
const sidebar = document.getElementById("sidebar");
const toggle = document.getElementById("sidebar-toggle");

function openSidebar() {
  sidebar.classList.add("open");
  toggle.setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
}
toggle.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) closeSidebar();
  else openSidebar();
});

// Rotating a phone crosses the breakpoint, so rebuild the clusters to pick up
// the new radius (clustering is only recalculated when layers are re-added).
const narrowQuery = window.matchMedia("(max-width: 767px)");
let wasNarrow = narrowQuery.matches;
window.addEventListener("resize", () => {
  if (narrowQuery.matches !== wasNarrow) {
    wasNarrow = narrowQuery.matches;
    applyFilter();
  }
});

// ---------- Init ----------
map.addLayer(cluster);
buildPlatformFilter();
applyFilter();

const allBounds = L.latLngBounds(FACILITIES.map((f) => [f.lat, f.lng]));
map.fitBounds(allBounds, { padding: [60, 60] });
