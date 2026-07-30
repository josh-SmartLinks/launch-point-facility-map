// Single source of truth for the tour's clubs/facilities.
// Add a club here (name, city, lat, lng) and it updates the map, the sidebar
// list, the header count, AND the "N clubs" line on the proposal page.
var FACILITIES = [
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
  { name: "1872 Golf Club",        city: "Georgetown, TX",                lat: 30.6968, lng: -97.7203 },
  { name: "Twisted Tee Golf",      city: "Owasso, OK",                    lat: 36.2695, lng: -95.8547 },
  { name: "O'Fallon Golf Studio",  city: "O'Fallon, IL",                  lat: 38.5922, lng: -89.9110 },
  { name: "Ace & Irons",           city: "Calgary, Alberta",              lat: 51.0447, lng: -114.0719 },
  { name: "Launch Point",          city: "Princeton, MN",                 lat: 45.5697, lng: -93.5808 },
  { name: "North Bend Golf Club",  city: "North Bend, WA",                lat: 47.4917, lng: -121.7889 }
];
