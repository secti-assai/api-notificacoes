const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.WHATSAPP_DEFAULT_COUNTRY_CODE = "55";

const {
  buildPhoneCandidates,
  pickFirstResolvedIdFromLidLookup
} = require("../src/services/whatsappService");

test("buildPhoneCandidates should normalize brazilian number with symbols", () => {
  const candidates = buildPhoneCandidates("+55 (43) 99116-9431");

  assert.ok(candidates.includes("5543991169431"));
});

test("buildPhoneCandidates should prepend default country code when missing", () => {
  const candidates = buildPhoneCandidates("43 99116-9431");

  assert.ok(candidates.includes("5543991169431"));
});

test("buildPhoneCandidates should generate brazilian with and without leading mobile 9", () => {
  const fromEightDigitPattern = buildPhoneCandidates("554399999999");
  const fromNineDigitPattern = buildPhoneCandidates("5543999999999");

  assert.ok(fromEightDigitPattern.includes("5543999999999"));
  assert.ok(fromNineDigitPattern.includes("554399999999"));
});

test("buildPhoneCandidates should prioritize brazilian number without mobile 9 first", () => {
  const candidates = buildPhoneCandidates("+55 (43) 99116-9431");

  assert.equal(candidates[0], "554391169431");
  assert.equal(candidates[1], "5543991169431");
});

test("buildPhoneCandidates should keep without-9 first when input already has no 9", () => {
  const candidates = buildPhoneCandidates("+55 (43) 9116-9431");

  assert.equal(candidates[0], "554391169431");
  assert.equal(candidates[1], "5543991169431");
});

test("pickFirstResolvedIdFromLidLookup should prioritize lid", () => {
  const selected = pickFirstResolvedIdFromLidLookup([
    { lid: "12345@lid", pn: "5543991169431@c.us" },
    { pn: "000@c.us" }
  ]);

  assert.equal(selected, "12345@lid");
});

test("pickFirstResolvedIdFromLidLookup should fallback to phone", () => {
  const selected = pickFirstResolvedIdFromLidLookup([
    { pn: "5543991169431@c.us" }
  ]);

  assert.equal(selected, "5543991169431@c.us");
});
