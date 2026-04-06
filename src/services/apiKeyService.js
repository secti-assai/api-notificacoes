const crypto = require("crypto");
const { getDb } = require("../db");

function hashApiKey(rawKey) {
  return crypto
    .createHash("sha256")
    .update(String(rawKey))
    .digest("hex");
}

function generateApiKey() {
  return `nfy_${crypto.randomBytes(24).toString("hex")}`;
}

async function createApiKey(label = "generated") {
  const db = await getDb();

  let apiKey;
  let keyHash;

  while (true) {
    apiKey = generateApiKey();
    keyHash = hashApiKey(apiKey);

    try {
      await db.run(
        "INSERT INTO api_keys (key_hash, label, is_active) VALUES (?, ?, 1)",
        [keyHash, label]
      );
      break;
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) {
        throw error;
      }
    }
  }

  return {
    apiKey,
    keyHash,
    label
  };
}

async function validateApiKey(rawKey) {
  const keyRecord = await findActiveApiKey(rawKey);
  return Boolean(keyRecord);
}

async function findActiveApiKey(rawKey) {
  if (!rawKey) {
    return null;
  }

  const db = await getDb();
  const keyHash = hashApiKey(rawKey);

  const row = await db.get(
    "SELECT id, label, key_hash FROM api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1",
    [keyHash]
  );

  return row || null;
}

module.exports = {
  hashApiKey,
  createApiKey,
  findActiveApiKey,
  validateApiKey
};
