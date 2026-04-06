const crypto = require("crypto");
const config = require("../config");

function safeCompare(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected || ""));
  const actualBuffer = Buffer.from(String(actual || ""));

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function adminAuth(req, res, next) {
  const configuredToken = config.auth.adminToken;
  if (!configuredToken) {
    return res.status(503).json({
      error: "ADMIN_TOKEN is not configured"
    });
  }

  const receivedToken = (req.header(config.auth.adminHeader) || "").trim();
  if (!receivedToken || !safeCompare(configuredToken, receivedToken)) {
    return res.status(401).json({
      error: "Unauthorized admin request"
    });
  }

  return next();
}

module.exports = {
  adminAuth
};
