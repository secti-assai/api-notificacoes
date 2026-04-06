const config = require("../config");
const { findActiveApiKey } = require("../services/apiKeyService");

async function apiKeyAuth(req, res, next) {
  try {
    const apiKey = (req.header(config.auth.apiKeyHeader) || "").trim();

    if (!apiKey) {
      return res.status(401).json({
        error: "Missing x-api-key header"
      });
    }

    const keyRecord = await findActiveApiKey(apiKey);
    if (!keyRecord) {
      return res.status(403).json({
        error: "Invalid API key"
      });
    }

    req.auth = {
      apiKeyId: keyRecord.id,
      apiKeyLabel: keyRecord.label || null,
      apiKeyHash: keyRecord.key_hash
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  apiKeyAuth
};
