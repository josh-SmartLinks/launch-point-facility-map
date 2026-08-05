// Single source of truth for the tour's clubs/facilities.
// Add a club here (name, city, lat, lng) and it updates the map, the sidebar
// list, the header count, AND the "N facilities" line on the proposal page.
//
// Optional `platforms` says which tour the club competes in:
//   platforms: ["sgt"]              — SGT / GSPro only
//   platforms: ["trackman"]         — Trackman only
//   platforms: ["sgt", "trackman"]  — both
// Tagging a club does two things: it turns on the platform filter on the map,
// and it sets the platform automatically when a player picks that club at
// signup. Clubs left untagged still work everywhere — they just show under
// "All" on the map and ask the player to pick a platform themselves.
//
// `sim` is the club's launch monitor, shown on the map popup. Trackman units
// play the Trackman tour; Uneekor, ProTee, Foresight, and TruGolf rigs all
// feed GSPro, which is what SGT runs on.
var FACILITIES = [
  { name: "The Proper Hack",       city: "Lewis Center, OH",              lat: 40.1965, lng: -83.0088,   sim: "In construction" },
  { name: "Chessie's Golf Club",   city: "Millersville, MD",              lat: 39.0640, lng: -76.6330,   sim: "ProTee XV",              platforms: ["sgt"] },
  { name: "Play Hoboken",          city: "Hoboken, NJ",                   lat: 40.7440, lng: -74.0324,   sim: "Uneekor EyeXO2",         platforms: ["sgt"] },
  { name: "Broligans Golf",        city: "Weatherford, TX",               lat: 32.7593, lng: -97.7972,   sim: "Trackman",               platforms: ["trackman"] },
  { name: "The Luxury Box",        city: "Queensbury, NY",                lat: 43.3251, lng: -73.6640,   sim: "Uneekor EyeXO",          platforms: ["sgt"] },
  { name: "Swingers",              city: "Gibsons, British Columbia",     lat: 49.3958, lng: -123.5044,  sim: "ProTee VX",              platforms: ["sgt"] },
  { name: "Par 72 Golf Lounge",    city: "Ontario, Canada",               lat: 42.9849, lng: -81.2453,   sim: "Trackman",               platforms: ["trackman"] },
  { name: "Black Mt Golf Lounge",  city: "New Hudson, MI",                lat: 42.5000, lng: -83.6480,   sim: "Uneekor XO",             platforms: ["sgt"] },
  { name: "Amen Korner",           city: "Quincy, IL",                    lat: 39.9356, lng: -91.4099,   sim: "TruGolf Apogee → GSPro", platforms: ["sgt"] },
  { name: "Eagle Bay Golf",        city: "Carver, MA",                    lat: 41.8834, lng: -70.7625,   sim: "Trackman",               platforms: ["trackman"] },
  { name: "Impact Golf Lounge",    city: "Charlotte, NC",                 lat: 35.2271, lng: -80.8431,   sim: "ProTee VX / Uneekor iCO2", platforms: ["sgt"] },
  { name: "1872 Golf Club",        city: "Georgetown, TX",                lat: 30.6968, lng: -97.7203,   sim: "Foresight Falcon",       platforms: ["sgt"] },
  { name: "Twisted Tee Golf",      city: "Owasso, OK",                    lat: 36.2695, lng: -95.8547,   sim: "Trackman",               platforms: ["trackman"] },
  { name: "O'Fallon Golf Studio",  city: "O'Fallon, IL",                  lat: 38.5922, lng: -89.9110,   sim: "ProTee VX",              platforms: ["sgt"] },
  { name: "Ace & Irons",           city: "Calgary, Alberta",              lat: 51.0447, lng: -114.0719,  sim: "Trackman iO",            platforms: ["trackman"] },
  { name: "Launch Point",          city: "Princeton, MN",                 lat: 45.5697, lng: -93.5808,   sim: "ProTee",                 platforms: ["sgt"] },
  { name: "North Bend Golf Club",  city: "North Bend, WA",                lat: 47.4917, lng: -121.7889,  sim: "Trackman iO",            platforms: ["trackman"] },
  { name: "The Digital Green",     city: "Roselle, IL",                   lat: 41.9847, lng: -88.0798,   sim: "Uneekor Eye XO2",        platforms: ["sgt"] },
  { name: "Birdie Central",        city: "Houston, TX",                   lat: 29.7604, lng: -95.3698,   sim: "Uneekor XO2",            platforms: ["sgt"] },
  { name: "Birdie Bar",            city: "Waltham, MA",                   lat: 42.3765, lng: -71.2356,   sim: "Trackman iO",            platforms: ["trackman"] },
  { name: "Birdie Bar",            city: "Burlington, MA",                lat: 42.5048, lng: -71.1956,   sim: "Trackman iO",            platforms: ["trackman"] },
  { name: "Upstate Tee House",     city: "Easley, SC",                    lat: 34.8298, lng: -82.6015,   sim: "Uneekor EyeXO2",         platforms: ["sgt"] },
  { name: "Indoor Golf RVA",       city: "Richmond, VA (Scott's Addition)", lat: 37.5714, lng: -77.4814, sim: "Trackman",               platforms: ["trackman"] },
  { name: "Indoor Golf RVA",       city: "Richmond, VA (Rocketts Landing)", lat: 37.5202, lng: -77.4159, sim: "Trackman",               platforms: ["trackman"] },
  { name: "Condor Club 24/7 Golf Lounge", city: "Normal, IL",             lat: 40.5093, lng: -88.9844,   sim: "Uneekor Eye XO2 → GSPro", platforms: ["sgt"] },
  { name: "Lumberjacks Indoor Golf", city: "Bellingham, WA",              lat: 48.7544, lng: -122.4788,  sim: "Uneekor → GSPro",        platforms: ["sgt"] },
  { name: "Tee 2 Green Indoor Golf", city: "Blowing Rock, NC",            lat: 36.1350, lng: -81.6778,   sim: "Uneekor",                platforms: ["sgt"] },
  { name: "Desert Links Indoor Golf", city: "Phoenix, AZ",                lat: 33.4484, lng: -112.0741,  sim: "Trackman",               platforms: ["trackman"] },
  { name: "The Birdie Collective", city: "St. Charles, IL",               lat: 41.9140, lng: -88.3128,   sim: "Uneekor Eye XO",         platforms: ["sgt"] },
  { name: "Caddies Sports Club",   city: "Jackson, TN",                   lat: 35.6144, lng: -88.8177,   sim: "Uneekor EyeXO",          platforms: ["sgt"] }
];
