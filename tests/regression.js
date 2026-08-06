// Regression suite for the Launch Point site.
//
//   node tests/regression.js          unit and handler tests, no network
//   node tests/regression.js --live   also hits production
//
// Handlers are driven with fake request and response objects, and calls to
// Stripe and Resend are intercepted, so the money and mail paths are exercised
// without sending anything or charging anyone.

const path = require("path");
const assert = require("assert");
const Stripe = require("stripe");

const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out.then(
        () => { passed++; console.log("  ok   " + name); },
        (err) => { failed++; failures.push([name, err]); console.log("  FAIL " + name + "\n       " + err.message); }
      );
    }
    passed++;
    console.log("  ok   " + name);
  } catch (err) {
    failed++;
    failures.push([name, err]);
    console.log("  FAIL " + name + "\n       " + err.message);
  }
  return Promise.resolve();
}

function section(title) {
  console.log("\n" + title);
}

// ---------- fakes ----------

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function makeReq(options) {
  return Object.assign({ method: "POST", headers: {}, body: {} }, options || {});
}

// A request whose body arrives as a stream, which is what the webhook reads.
function makeRawReq(raw, headers) {
  return {
    method: "POST",
    headers: headers || {},
    on(event, cb) {
      if (event === "data") setImmediate(() => cb(Buffer.from(raw)));
      if (event === "end") setImmediate(cb);
      return this;
    }
  };
}

// Captures outbound HTTP so nothing real is called.
function interceptFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    return handler(String(url), opts || {});
  };
  return {
    calls,
    restore() { global.fetch = original; }
  };
}

function jsonResponse(body, ok, status) {
  return {
    ok: ok !== false,
    status: status || 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// Loads a module fresh so environment changes take effect.
function reload(rel) {
  const full = require.resolve(path.join(ROOT, rel));
  delete require.cache[full];
  return require(full);
}

async function run() {
  // ---------------------------------------------------------------- pricing
  section("Pricing and card fee");
  const pricing = require(path.join(ROOT, "lib/pricing"));

  ["fall", "winter", "spring", "bundle"].forEach((tour) => {
    test(tour + ": payer covers Stripe's cut, pot receives the full buy-in", () => {
      const q = pricing.quote(tour);
      const stripeTakes = Math.round(q.total * 0.029) + 30;
      const net = q.total - stripeTakes;
      assert.ok(net >= q.buyIn, tour + " nets " + net + " but buy-in is " + q.buyIn);
      assert.ok(net - q.buyIn <= 2, "overcharging by more than 2 cents on " + tour);
    });
  });

  test("every single tour costs the same, bundle is their sum", () => {
    assert.strictEqual(pricing.quote("fall").buyIn, 6000);
    assert.strictEqual(pricing.quote("winter").buyIn, 6000);
    assert.strictEqual(pricing.quote("spring").buyIn, 6000);
    assert.strictEqual(pricing.quote("bundle").buyIn, 18000);
  });

  test("unknown tour is refused", () => {
    assert.strictEqual(pricing.quote("summer"), null);
    assert.strictEqual(pricing.quote(""), null);
  });

  test("unassigned is a valid platform, so an unknown club is not a guess", () => {
    assert.ok(pricing.PLATFORM_LABELS.unassigned);
  });

  // ------------------------------------------------------------------ teams
  section("Partner pairing");
  const teams = require(path.join(ROOT, "lib/teams"));

  test("phone numbers compare on their last ten digits", () => {
    const forms = ["7818599522", "781-859-9522", "(781) 859-9522", "+1 781 859 9522", "1-781-859-9522"];
    forms.forEach((f) => assert.strictEqual(teams.normalisePhone(f), "7818599522", f));
  });

  const roster = [
    { id: "a", tour: "fall", phone: "(781) 859-9522", partnerPhone: "6147848500", playerName: "Ann" },
    { id: "b", tour: "fall", phone: "614-784-8500", partnerPhone: "7818599522", playerName: "Bob" },
    { id: "c", tour: "fall", phone: "5551112222", partnerPhone: "9998887777", playerName: "Cal" },
    { id: "d", tour: "fall", phone: "9998887777", partnerPhone: "3334445555", playerName: "Dee" },
    { id: "e", tour: "fall", phone: "1112223333", partnerPhone: "", playerName: "Eve" },
    { id: "f", tour: "spring", phone: "7818599522", partnerPhone: "6147848500", playerName: "Ann spring" },
    { id: "g", tour: "fall", phone: "4445556666", partnerPhone: null, partnerSignupId: "e", playerName: "Gil" },
    { id: "h", tour: "fall", phone: "7776665555", partnerPhone: "1112223333", playerName: "Hal", archived: true }
  ];
  const resolved = teams.resolveTeams(roster);

  test("naming each other pairs them", () => {
    assert.strictEqual(resolved.a.status, "matched");
    assert.strictEqual(resolved.a.partner.id, "b");
    assert.strictEqual(resolved.b.partner.id, "a");
  });

  test("naming someone who named someone else is not mutual", () => {
    assert.strictEqual(resolved.c.status, "one_sided");
  });

  test("naming nobody leaves the club to pair them", () => {
    assert.strictEqual(resolved.e.status, "none");
  });

  test("a pairing does not cross tours", () => {
    // Ann's Spring entry names Bob, who only signed up for Fall.
    assert.strictEqual(resolved.f.status, "waiting");
    assert.strictEqual(resolved.f.partner, null);
  });

  test("an admin override beats the phone numbers", () => {
    assert.strictEqual(resolved.g.status, "overridden");
    assert.strictEqual(resolved.g.partner.id, "e");
  });

  test("archived players are never paired", () => {
    assert.strictEqual(resolved.h.status, "none");
  });

  // ------------------------------------------------------------------- auth
  section("Admin authentication");
  process.env.ADMIN_PASSWORD = "correct-horse-battery";
  process.env.SESSION_SECRET = "unit-test-session-secret";
  const auth = reload("lib/auth");

  test("the right password is accepted, wrong and empty are not", () => {
    assert.strictEqual(auth.checkPassword("correct-horse-battery"), true);
    assert.strictEqual(auth.checkPassword("correct-horse-batter"), false);
    assert.strictEqual(auth.checkPassword(""), false);
    assert.strictEqual(auth.checkPassword(undefined), false);
  });

  let issuedCookie = null;
  test("a signed cookie is accepted", () => {
    const res = makeRes();
    auth.setSessionCookie(res);
    issuedCookie = res.headers["Set-Cookie"][0].split("=")[1].split(";")[0];
    assert.ok(issuedCookie.indexOf(".") !== -1);
    assert.strictEqual(auth.requireAdmin(makeReq({ headers: { cookie: "lp_admin=" + issuedCookie } }), makeRes()), true);
  });

  test("cookie flags keep it out of scripts and off plain HTTP", () => {
    const res = makeRes();
    auth.setSessionCookie(res);
    const cookie = res.headers["Set-Cookie"][0];
    assert.ok(/HttpOnly/.test(cookie), "not HttpOnly");
    assert.ok(/Secure/.test(cookie), "not Secure");
    assert.ok(/SameSite=Lax/.test(cookie), "no SameSite");
  });

  test("a forged signature is rejected", () => {
    const res = makeRes();
    const forged = Date.now() + 999999 + ".deadbeefdeadbeef";
    assert.strictEqual(auth.requireAdmin(makeReq({ headers: { cookie: "lp_admin=" + forged } }), res), false);
    assert.strictEqual(res.statusCode, 401);
  });

  test("an expired but correctly signed cookie is rejected", () => {
    const crypto = require("crypto");
    const past = String(Date.now() - 1000);
    const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(past).digest("hex");
    const res = makeRes();
    assert.strictEqual(auth.requireAdmin(makeReq({ headers: { cookie: "lp_admin=" + past + "." + sig } }), res), false);
    assert.strictEqual(res.statusCode, 401);
  });

  test("with no password configured, admin refuses rather than opening", () => {
    const saved = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    const fresh = reload("lib/auth");
    const res = makeRes();
    assert.strictEqual(fresh.requireAdmin(makeReq({ headers: { cookie: "lp_admin=" + issuedCookie } }), res), false);
    assert.strictEqual(res.statusCode, 503);
    process.env.ADMIN_PASSWORD = saved;
    reload("lib/auth");
  });

  // ------------------------------------------------------------------ email
  section("Email templates and sending");
  process.env.ADMIN_EMAIL = "josh@launchpointsim.com";
  delete process.env.EMAIL_FROM;
  let email = reload("lib/email");

  test("sender falls back from EMAIL_FROM to the admin address", () => {
    assert.ok(email.fromAddress().indexOf("josh@launchpointsim.com") !== -1);
    process.env.EMAIL_FROM = "Someone <a@b.com>";
    assert.strictEqual(reload("lib/email").fromAddress(), "Someone <a@b.com>");
    delete process.env.EMAIL_FROM;
    email = reload("lib/email");
  });

  test("every template carries the sign-off and a clickable logo", () => {
    const samples = [
      email.playerConfirmation({ playerName: "Ann", buyInCents: 6000, feeCents: 211, totalCents: 6211 }).html,
      email.partnerPaired({ tourLabel: "Fall" }, { playerName: "Bob", phone: "555", email: "b@x.com" }).html,
      email.clubConfirmation({ facility: "Birdie Bar", contactName: "Joe", city: "Waltham", launchMonitor: "Trackman", interestLabel: "Yes" }).html,
      email.adminNotification({ playerName: "Ann", club: "X", buyInCents: 6000, feeCents: 211, totalCents: 6211 }).html
    ];
    samples.forEach((html, i) => {
      assert.ok(html.indexOf("Thanks!<br />- Josh") !== -1, "template " + i + " missing sign-off");
      assert.ok(/<a href="https:\/\/www\.launchpointglobaltour\.com"[^>]*>\s*<img/.test(html), "template " + i + " logo not linked");
      assert.ok(html.indexOf('src="https://www.launchpointglobaltour.com/assets/logo.png"') !== -1, "template " + i + " logo not absolute");
    });
  });

  test("the confirmation reports the pairing state it was given", () => {
    const paired = email.playerConfirmation({ playerName: "Ann", partnerName: "Bob", buyInCents: 1, feeCents: 1, totalCents: 2 }).html;
    assert.ok(paired.indexOf("paired with <strong>Bob</strong>") !== -1);

    const waiting = email.playerConfirmation({ playerName: "Ann", partnerPhone: "555-9999", buyInCents: 1, feeCents: 1, totalCents: 2 }).html;
    assert.ok(waiting.indexOf("once they sign up") !== -1);

    const none = email.playerConfirmation({ playerName: "Ann", buyInCents: 1, feeCents: 1, totalCents: 2 }).html;
    assert.ok(none.indexOf("Your club pairs you") !== -1);
  });

  test("player-supplied text is escaped, not injected", () => {
    const html = email.playerConfirmation({
      playerName: '<script>alert(1)</script>',
      buyInCents: 1, feeCents: 1, totalCents: 2
    }).html;
    assert.ok(html.indexOf("<script>alert(1)</script>") === -1, "script tag survived");
    assert.ok(html.indexOf("&lt;script&gt;") !== -1, "not escaped");
  });

  await test("send posts to Resend with the given recipient", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fresh = reload("lib/email");
    const net = interceptFetch(() => jsonResponse({ id: "abc" }));
    try {
      const out = await fresh.send({ to: "player@example.com", subject: "s", html: "<p>h</p>" });
      assert.strictEqual(out.sent, true);
      assert.strictEqual(net.calls.length, 1);
      const payload = JSON.parse(net.calls[0].opts.body);
      assert.deepStrictEqual(payload.to, ["player@example.com"]);
      assert.ok(payload.from.indexOf("josh@launchpointsim.com") !== -1);
    } finally {
      net.restore();
    }
  });

  await test("a missing recipient is reported, not silently dropped", async () => {
    const fresh = reload("lib/email");
    const out = await fresh.send({ to: "", subject: "s", html: "h" });
    assert.strictEqual(out.sent, false);
    assert.strictEqual(out.reason, "no_recipient");
  });

  await test("a Resend rejection returns the provider's own reason", async () => {
    const fresh = reload("lib/email");
    const net = interceptFetch(() => jsonResponse({ message: "domain not verified" }, false, 403));
    try {
      const out = await fresh.send({ to: "a@b.com", subject: "s", html: "h" });
      assert.strictEqual(out.sent, false);
      assert.strictEqual(out.status, 403);
      assert.ok(out.detail.indexOf("domain not verified") !== -1);
    } finally {
      net.restore();
    }
  });

  // ------------------------------------------------------- import: parsing
  section("Form export import");
  const importer = require(path.join(ROOT, "api/admin/import-contacts"))._internals;

  const EXPORT = [
    "Id\tStart time\tEmail\tName\tFacility name\tPhone number\tCity / State / Country\tWhich launch monitor do you use?\tAre you interested in joining the global tournament series this Fall-Spring?\tAnything you’d like us to know, or any questions?",
    "2\t7/29/2026 13:55\tanonymous\t\tThe Proper Hack\t6147848500\tLewis Center / OH / USA\tStill in construction phase\tMaybe, tell me more\t",
    "7\t7/29/2026 14:50\tanonymous\t\tSwingers\t604 741 7331\t\"Gibsons, British Columbia \nCanada \"\tPro tee vx\tYes\t",
    "13\t7/29/2026 16:10\tanonymous\t\t1872 Golf aclu\t910-988-8621\tGeorgetown, TX\tForesight Falcons\tYes\t"
  ].join("\n");

  const table = importer.parseTable(EXPORT);
  const header = importer.mapHeader(table[0]);

  test("columns are found by header name, not by position", () => {
    assert.strictEqual(typeof header.facility, "number");
    assert.strictEqual(typeof header.phone, "number");
    assert.strictEqual(typeof header.launchMonitor, "number");
    assert.strictEqual(typeof header.interest, "number");
    assert.strictEqual(typeof header.notes, "number");
  });

  test("a quoted cell spanning two lines stays one row", () => {
    assert.strictEqual(table.length, 4, "expected header plus three rows, got " + table.length);
    assert.ok(table[2][header.city].indexOf("Gibsons") !== -1);
    assert.ok(table[2][header.city].indexOf("Canada") !== -1);
  });

  test("interest answers map to stored values", () => {
    assert.strictEqual(importer.normaliseInterest("Maybe, tell me more"), "maybe");
    assert.strictEqual(importer.normaliseInterest("Yes"), "yes");
    assert.strictEqual(importer.normaliseInterest("Not right now"), "not_now");
  });

  const CLUBS = [
    { facility: "The Proper Hack", city: "Lewis Center, OH" },
    { facility: "Swingers", city: "Gibsons, British Columbia" },
    { facility: "1872 Golf Club", city: "Georgetown, TX" },
    { facility: "Birdie Bar", city: "Waltham, MA" },
    { facility: "Birdie Bar", city: "Burlington, MA" },
    { facility: "Indoor Golf RVA", city: "Richmond, VA (Scott's Addition)" },
    { facility: "Indoor Golf RVA", city: "Richmond, VA (Rocketts Landing)" }
  ];

  test("a club with two venues matches both rows", () => {
    assert.strictEqual(importer.findClubs(CLUBS, "Birdie Bar").length, 2);
    assert.strictEqual(importer.findClubs(CLUBS, "Indoor Golf RVA (currently two facilities)").length, 2);
  });

  test("case and curly apostrophes do not break matching", () => {
    assert.strictEqual(importer.findClubs(CLUBS, "the proper hack").length, 1);
    assert.strictEqual(importer.findClubs([{ facility: "Chessie's Golf Club" }], "Chessie’s Golf Club").length, 1);
  });

  test("a misspelt name still finds its club", () => {
    const hits = importer.findClubs(CLUBS, "1872 Golf aclu");
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].facility, "1872 Golf Club");
  });

  test("an unrelated name matches nothing", () => {
    assert.strictEqual(importer.findClubs(CLUBS, "Some Random Driving Range").length, 0);
    assert.strictEqual(importer.suggest(CLUBS, "Some Random Driving Range"), null);
  });

  // ------------------------------------------------------ facility dataset
  section("Facility data");
  const FACILITIES = require(path.join(ROOT, "facilities"));

  test("every facility has a name, city, and usable coordinates", () => {
    FACILITIES.forEach((f) => {
      assert.ok(f.name && f.city, "missing name or city");
      assert.ok(Number.isFinite(f.lat) && Number.isFinite(f.lng), f.name + " has no coordinates");
      assert.ok(Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180, f.name + " coordinates out of range");
      assert.ok(f.lat !== 0 || f.lng !== 0, f.name + " sits at null island");
    });
  });

  test("platform tags are values the rest of the code understands", () => {
    FACILITIES.forEach((f) => {
      (f.platforms || []).forEach((p) => {
        assert.ok(["sgt", "trackman"].indexOf(p) !== -1, f.name + " has platform " + p);
      });
    });
  });

  test("the file works as both a browser global and a module", () => {
    assert.ok(Array.isArray(FACILITIES));
    const fs = require("fs");
    const vm = require("vm");
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "facilities.js"), "utf8"), ctx);
    assert.strictEqual(ctx.FACILITIES.length, FACILITIES.length);
  });

  // ------------------------------------------------------ club interest API
  section("Club interest endpoint");
  delete process.env.DATABASE_URL;
  delete process.env.RESEND_API_KEY;
  const clubInterest = reload("api/club-interest");

  const goodClub = {
    facility: "Test Facility",
    contactName: "Tester",
    email: "tester@example.com",
    phone: "555-555-5555",
    city: "Testville, IL, USA",
    launchMonitor: "Uneekor EyeXO",
    interest: "yes"
  };

  await test("GET is refused", async () => {
    const res = makeRes();
    await clubInterest(makeReq({ method: "GET" }), res);
    assert.strictEqual(res.statusCode, 405);
  });

  await test("each missing field is named", async () => {
    const cases = [
      [{}, /facility/i],
      [{ facility: "x" }, /your name/i],
      [{ facility: "x", contactName: "y" }, /valid email/i],
      [{ facility: "x", contactName: "y", email: "a@b.com" }, /phone/i],
      [{ facility: "x", contactName: "y", email: "a@b.com", phone: "5555555555" }, /city/i]
    ];
    for (const [body, pattern] of cases) {
      const res = makeRes();
      await clubInterest(makeReq({ body }), res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(pattern.test(res.body.error), "wrong message: " + res.body.error);
    }
  });

  await test("a bot filling the honeypot gets success and stores nothing", async () => {
    const res = makeRes();
    await clubInterest(makeReq({ body: Object.assign({ website: "spam" }, goodClub) }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
  });

  await test("a valid submission succeeds without a database or mailer", async () => {
    const res = makeRes();
    await clubInterest(makeReq({ body: goodClub }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
  });

  // --------------------------------------------------------- checkout API
  section("Checkout endpoint");
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  const checkout = reload("api/create-checkout-session");

  const goodPlayer = {
    club: "Launch Point",
    platform: "sgt",
    tour: "fall",
    email: "player@example.com",
    phone: "555-555-5555",
    playerName: "Test Player"
  };

  await test("a club that is not on the list is refused", async () => {
    const res = makeRes();
    await checkout(makeReq({ body: Object.assign({}, goodPlayer, { club: "<script>alert(1)</script>" }) }), res);
    assert.strictEqual(res.statusCode, 400);
  });

  await test("bad email, short phone, and unknown tour are each refused", async () => {
    for (const bad of [{ email: "nope" }, { phone: "123" }, { tour: "summer" }, { platform: "wii" }]) {
      const res = makeRes();
      await checkout(makeReq({ body: Object.assign({}, goodPlayer, bad) }), res);
      assert.strictEqual(res.statusCode, 400, JSON.stringify(bad) + " was accepted");
    }
  });

  await test("a spoofed Origin cannot redirect the payer elsewhere", async () => {
    const net = interceptFetch(() => jsonResponse({ id: "cs_test_1", url: "https://checkout.stripe.com/x" }));
    try {
      const res = makeRes();
      await checkout(makeReq({ body: goodPlayer, headers: { origin: "https://evil.example.com" } }), res);
      assert.strictEqual(res.statusCode, 200);
      const sent = decodeURIComponent(net.calls[0].opts.body);
      assert.ok(sent.indexOf("success_url=https://www.launchpointglobaltour.com") !== -1, "success_url not pinned");
      assert.ok(sent.indexOf("evil.example.com") === -1, "attacker origin reached Stripe");
    } finally {
      net.restore();
    }
  });

  await test("the charge is priced server-side and carries the details forward", async () => {
    const net = interceptFetch(() => jsonResponse({ id: "cs_test_2", url: "https://checkout.stripe.com/y" }));
    try {
      const res = makeRes();
      await checkout(makeReq({ body: Object.assign({}, goodPlayer, { partnerPhone: "781-859-9522" }) }), res);
      const sent = decodeURIComponent(net.calls[0].opts.body);
      assert.ok(sent.indexOf("[unit_amount]=6000") !== -1, "buy-in not 6000");
      assert.ok(sent.indexOf("[unit_amount]=211") !== -1, "fee not 211");
      assert.ok(sent.indexOf("metadata[email]=player@example.com") !== -1, "email not carried");
      assert.ok(sent.indexOf("metadata[partner_phone]=781-859-9522") !== -1, "partner not carried");
    } finally {
      net.restore();
    }
  });

  await test("a client cannot dictate the price", async () => {
    const net = interceptFetch(() => jsonResponse({ id: "cs_test_3", url: "https://checkout.stripe.com/z" }));
    try {
      const res = makeRes();
      await checkout(makeReq({ body: Object.assign({}, goodPlayer, { buyIn: 1, total: 1, amount: 1 }) }), res);
      const sent = decodeURIComponent(net.calls[0].opts.body);
      assert.ok(sent.indexOf("[unit_amount]=6000") !== -1, "server price was overridden");
    } finally {
      net.restore();
    }
  });

  // ---------------------------------------------------------- webhook API
  section("Stripe webhook");
  const WEBHOOK_SECRET = "whsec_unit_test_secret";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.DATABASE_URL;
  const webhook = reload("api/stripe-webhook");

  function signedEvent(sessionOverrides) {
    const payload = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: Object.assign(
          {
            id: "cs_test_hook",
            payment_intent: "pi_1",
            amount_total: 6211,
            customer_email: null,
            customer_details: { email: "player@example.com" },
            metadata: {
              club: "Launch Point",
              platform: "sgt",
              tour: "fall",
              player: "Test Player",
              phone: "555-555-5555",
              email: "player@example.com",
              buy_in_cents: "6000",
              fee_cents: "211"
            }
          },
          sessionOverrides || {}
        )
      }
    });

    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return { payload, header };
  }

  await test("an unsigned request is rejected", async () => {
    const res = makeRes();
    await webhook(makeRawReq('{"type":"checkout.session.completed"}', { "stripe-signature": "t=1,v1=bogus" }), res);
    assert.strictEqual(res.statusCode, 400);
  });

  await test("a payload tampered with after signing is rejected", async () => {
    const { header } = signedEvent();
    const res = makeRes();
    await webhook(makeRawReq('{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"amount_total":1}}}', { "stripe-signature": header }), res);
    assert.strictEqual(res.statusCode, 400);
  });

  await test("the confirmation goes to customer_details.email when customer_email is null", async () => {
    const { payload, header } = signedEvent();
    const net = interceptFetch(() => jsonResponse({ id: "sent" }));
    try {
      const res = makeRes();
      await webhook(makeRawReq(payload, { "stripe-signature": header }), res);
      assert.strictEqual(res.statusCode, 200);

      const recipients = net.calls
        .filter((c) => c.url.indexOf("resend.com") !== -1)
        .map((c) => JSON.parse(c.opts.body).to[0]);

      assert.ok(recipients.indexOf("player@example.com") !== -1,
        "player never emailed, got: " + JSON.stringify(recipients));
    } finally {
      net.restore();
    }
  });

  await test("the admin copy goes out alongside the player's", async () => {
    process.env.ADMIN_EMAIL = "josh@launchpointsim.com";
    const fresh = reload("api/stripe-webhook");
    const { payload, header } = signedEvent();
    const net = interceptFetch(() => jsonResponse({ id: "sent" }));
    try {
      const res = makeRes();
      await fresh(makeRawReq(payload, { "stripe-signature": header }), res);
      const recipients = net.calls
        .filter((c) => c.url.indexOf("resend.com") !== -1)
        .map((c) => JSON.parse(c.opts.body).to[0]);
      assert.ok(recipients.indexOf("player@example.com") !== -1, "player missing");
      assert.ok(recipients.indexOf("josh@launchpointsim.com") !== -1, "admin missing");
    } finally {
      net.restore();
    }
  });

  await test("a database failure does not swallow the confirmation", async () => {
    // Force getDb to hand back a client whose write throws, the way a missing
    // column after a schema change would.
    const dbPath = require.resolve(path.join(ROOT, "lib/db"));
    delete require.cache[dbPath];
    const db = require(dbPath);
    db.getDb = () => ({
      signup: {
        upsert: async () => { throw new Error("column \"partnerPhone\" does not exist"); },
        findMany: async () => { throw new Error("column \"partnerPhone\" does not exist"); }
      }
    });

    const hookPath = require.resolve(path.join(ROOT, "api/stripe-webhook"));
    delete require.cache[hookPath];
    const hook = require(hookPath);

    const { payload, header } = signedEvent();
    const net = interceptFetch(() => jsonResponse({ id: "sent" }));
    try {
      const res = makeRes();
      await hook(makeRawReq(payload, { "stripe-signature": header }), res);

      const recipients = net.calls
        .filter((c) => c.url.indexOf("resend.com") !== -1)
        .map((c) => JSON.parse(c.opts.body).to[0]);

      assert.ok(recipients.indexOf("player@example.com") !== -1,
        "the database error killed the email again");
    } finally {
      net.restore();
      delete require.cache[dbPath];
      delete require.cache[hookPath];
    }
  });

  test("the webhook keeps the raw body, without which no signature can verify", () => {
    const hook = require(path.join(ROOT, "api/stripe-webhook"));
    assert.ok(hook.config && hook.config.api && hook.config.api.bodyParser === false);
  });

  // ------------------------------------------------------------------ live
  if (process.argv.indexOf("--live") !== -1) {
    section("Production");
    const BASE = "https://www.launchpointglobaltour.com";
    const UA = { "User-Agent": "launchpoint-regression/1.0" };

    for (const p of ["/", "/proposal", "/signup", "/admin", "/404.html"]) {
      await test("GET " + p + " serves", async () => {
        const r = await fetch(BASE + p, { headers: UA });
        assert.strictEqual(r.status, 200);
      });
    }

    for (const p of ["/proposal.html", "/signup.html"]) {
      await test(p + " redirects to its clean URL", async () => {
        const r = await fetch(BASE + p, { headers: UA, redirect: "manual" });
        assert.ok([301, 308].indexOf(r.status) !== -1, "status " + r.status);
      });
    }

    await test("config reports a working Stripe key", async () => {
      const r = await fetch(BASE + "/api/config", { headers: UA });
      const body = await r.json();
      assert.strictEqual(body.enabled, true);
      assert.ok(["live", "test"].indexOf(body.mode) !== -1);
      assert.strictEqual(body.pricing.tours.length, 4);
    });

    await test("the map's facility list is served", async () => {
      const r = await fetch(BASE + "/api/facilities", { headers: UA });
      const body = await r.json();
      assert.ok(body.facilities.length >= 30, "only " + body.facilities.length + " facilities");
    });

    for (const p of [
      "/api/admin/submissions",
      "/api/admin/diagnostics",
      "/api/admin/archive",
      "/api/admin/delete",
      "/api/admin/set-partner",
      "/api/admin/import-facilities",
      "/api/admin/import-contacts",
      "/api/admin/resend-domains"
    ]) {
      await test("admin route " + p + " refuses a stranger", async () => {
        const r = await fetch(BASE + p, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, UA),
          body: "{}"
        });
        assert.ok([401, 405].indexOf(r.status) !== -1, "status " + r.status);
        if (r.status === 401) {
          const body = await r.json();
          assert.ok(/signed in/i.test(body.error));
        }
      });
    }

    await test("the live webhook rejects an unsigned event", async () => {
      const r = await fetch(BASE + "/api/stripe-webhook", {
        method: "POST",
        headers: Object.assign({ "stripe-signature": "t=1,v1=bogus" }, UA),
        body: "{}"
      });
      assert.strictEqual(r.status, 400);
    });

    await test("the live checkout refuses an unknown club", async () => {
      const r = await fetch(BASE + "/api/create-checkout-session", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, UA),
        body: JSON.stringify({ club: "Nowhere GC", platform: "sgt", tour: "fall", email: "a@b.com", phone: "5555555555", playerName: "X" })
      });
      assert.strictEqual(r.status, 400);
    });

    await test("no secret is exposed by the static site", async () => {
      for (const p of ["/lib/db.js", "/prisma/schema.prisma", "/package.json"]) {
        const r = await fetch(BASE + p, { headers: UA });
        if (r.ok) {
          const text = await r.text();
          assert.ok(!/sk_live_|sk_test_|whsec_|re_[A-Za-z0-9]{10}|postgres:\/\//.test(text),
            p + " exposes a credential");
        }
      }
    });
  }

  // --------------------------------------------------------------- summary
  console.log("\n" + "-".repeat(56));
  console.log(passed + " passed, " + failed + " failed");
  if (failed) {
    console.log("\nFailures:");
    failures.forEach(([name, err]) => console.log("  " + name + "\n    " + err.message));
    process.exitCode = 1;
  }
}

run();
