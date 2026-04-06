const { createApiKey } = require("../src/services/apiKeyService");
const { closeDb } = require("../src/db");

async function main() {
  const labelArg = process.argv.slice(2).join(" ").trim();
  const label = labelArg || `cli-${new Date().toISOString()}`;

  const created = await createApiKey(label);

  console.log("API key created successfully.");
  console.log("Label:", created.label);
  console.log("x-api-key:", created.apiKey);
}

main()
  .catch((error) => {
    console.error("Failed to create API key:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
