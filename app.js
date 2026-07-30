const FACILITIES = [
  { name: "The Proper Hack",       city: "Lewis Center, OH",              lat: 40.1965, lng: -83.0088 },
  { name: "Chessie's Golf Club",   city: "Millersville, MD",              lat: 39.0640, lng: -76.6330 },
  { name: "Play Hoboken",          city: "Hoboken, NJ",                   lat: 40.7440, lng: -74.0324 },
  { name: "Broligans Golf",        city: "Weatherford, TX",               lat: 32.7593, lng: -97.7972 },
  { name: "The Luxury Box",        city: "Queensbury, NY",                lat: 43.3251, lng: -73.6640 },
  { name: "Swingers",              city: "Gibsons, British Columbia",     lat: 49.3958, lng: -123.5044 },
  { name: "Par 72 Golf Lounge",    city: "Ontario, Canada",               lat: 42.9849, lng: -81.2453 },
  { name: "Black Mt Golf Lounge",  city: "New Hudson, MI",                lat: 42.5000, lng: -83.6480 },
  { name: "Amen Korner",           city: "Quincy, IL",                    lat: 39.9356, lng: -91.4099 },
  { name: "Eagle Bay Golf",        city: "Carver, MA",                    lat: 41.8834, lng: -70.7625 },
  { name: "Impact Golf Lounge",    city: "Charlotte, NC",                 lat: 35.2271, lng: -80.8431 },
  { name: "1872 Golf Club",        city: "Georgetown, TX",                lat: 30.6968, lng: -97.7203 }
];

// ---------- Map ----------
const map = L.map("map", {
  worldCopyJump: true,
  zoomControl: true
});

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

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 50,
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

function popupHtml(f) {
  return (
    '<div class="popup-name">' + escapeHtml(f.name) + "</div>" +
    '<div class="popup-city">' + escapeHtml(f.city) + "</div>"
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

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  const matched = entries.filter(
    (f) => f.name.toLowerCase().includes(q) || f.city.toLowerCase().includes(q)
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

// ---------- Init ----------
map.addLayer(cluster);
applyFilter();

const allBounds = L.latLngBounds(FACILITIES.map((f) => [f.lat, f.lng]));
map.fitBounds(allBounds, { padding: [60, 60] });
