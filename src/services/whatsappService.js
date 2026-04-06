const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const config = require("../config");

let client;
let initializePromise;
let isReady = false;

function buildBadRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isWhatsAppEnabled() {
  return config.whatsapp.enabled;
}

function isWhatsAppReady() {
  return isReady;
}

function buildPuppeteerArgs() {
  const args = [];
  if (config.whatsapp.noSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

function uniquePush(target, value) {
  if (!value || !/^\d+$/.test(value)) {
    return;
  }

  if (value.length < 10 || value.length > 15) {
    return;
  }

  if (!target.includes(value)) {
    target.push(value);
  }
}

function uniqueSerializedPush(target, value) {
  const serialized = String(value || "").trim();
  if (!serialized) {
    return;
  }

  if (!target.includes(serialized)) {
    target.push(serialized);
  }
}

function prioritizeBrazilWithoutMobileNine(candidates) {
  const prioritized = [];

  for (const candidate of candidates) {
    if (!candidate.startsWith("55")) {
      uniquePush(prioritized, candidate);
      continue;
    }

    if (candidate.length === 13 && candidate[4] === "9") {
      uniquePush(prioritized, `${candidate.slice(0, 4)}${candidate.slice(5)}`);
      uniquePush(prioritized, candidate);
      continue;
    }

    if (candidate.length === 12) {
      uniquePush(prioritized, candidate);
      uniquePush(prioritized, `${candidate.slice(0, 4)}9${candidate.slice(4)}`);
      continue;
    }

    uniquePush(prioritized, candidate);
  }

  for (const candidate of candidates) {
    uniquePush(prioritized, candidate);
  }

  return prioritized;
}

function buildPhoneCandidates(rawDigits) {
  const digits = String(rawDigits || "").replace(/\D/g, "").replace(/^00+/, "");
  const candidates = [];

  if (!digits) {
    return candidates;
  }

  const withoutLeadingZero = digits.replace(/^0+/, "");
  const defaultCountryCode = String(config.whatsapp.defaultCountryCode || "").replace(/\D/g, "");

  uniquePush(candidates, digits);
  uniquePush(candidates, withoutLeadingZero);

  if (defaultCountryCode && !digits.startsWith(defaultCountryCode)) {
    uniquePush(candidates, `${defaultCountryCode}${withoutLeadingZero}`);
  }

  if (defaultCountryCode && digits.startsWith(defaultCountryCode)) {
    const national = digits.slice(defaultCountryCode.length);
    uniquePush(candidates, `${defaultCountryCode}${national.replace(/^0+/, "")}`);
  }

  // BR compatibility: try with/without the mobile leading 9 after DDD.
  if (digits.startsWith("55")) {
    if (digits.length === 13 && digits[4] === "9") {
      uniquePush(candidates, `${digits.slice(0, 4)}${digits.slice(5)}`);
    }
    if (digits.length === 12) {
      uniquePush(candidates, `${digits.slice(0, 4)}9${digits.slice(4)}`);
    }
  }

  return prioritizeBrazilWithoutMobileNine(candidates);
}

function isNoLidError(error) {
  return String(error?.message || error || "").toLowerCase().includes("no lid for user");
}

function pickFirstResolvedIdFromLidLookup(entries) {
  if (!Array.isArray(entries)) {
    return null;
  }

  for (const entry of entries) {
    const lid = String(entry?.lid || "").trim();
    if (lid) {
      return lid;
    }

    const phone = String(entry?.pn || "").trim();
    if (phone) {
      return phone;
    }
  }

  return null;
}

function createClient() {
  const nextClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: config.whatsapp.authPath,
      clientId: config.whatsapp.clientId
    }),
    puppeteer: {
      headless: config.whatsapp.headless,
      args: buildPuppeteerArgs()
    }
  });

  nextClient.on("qr", (qr) => {
    console.log("[whatsapp] QR recebido. Escaneie com o app para autenticar:");
    try {
      qrcode.generate(qr, { small: true });
    } catch (error) {
      console.warn("[whatsapp] Falha ao renderizar QR em ASCII. Exibindo codigo bruto.");
      console.log(qr);
    }
  });

  nextClient.on("authenticated", () => {
    console.log("[whatsapp] Sessao autenticada.");
  });

  nextClient.on("ready", () => {
    isReady = true;
    console.log("[whatsapp] Cliente pronto para envio.");
  });

  nextClient.on("auth_failure", (message) => {
    isReady = false;
    console.error("[whatsapp] Falha de autenticacao:", message);
  });

  nextClient.on("disconnected", (reason) => {
    isReady = false;
    console.warn("[whatsapp] Cliente desconectado:", reason);
  });

  return nextClient;
}

async function initializeWhatsAppClient() {
  if (!isWhatsAppEnabled()) {
    return false;
  }

  if (initializePromise) {
    return initializePromise;
  }

  if (!client) {
    client = createClient();
  }

  initializePromise = client
    .initialize()
    .then(() => true)
    .catch((error) => {
      initializePromise = undefined;
      throw error;
    });

  return initializePromise;
}

async function normalizeRecipient(to, activeClient) {
  const value = String(to || "").trim();
  if (!value) {
    throw buildBadRequest("Field 'to' is required for WhatsApp messages");
  }

  if (value.endsWith("@g.us")) {
    return {
      chatId: value,
      fallbackChatIds: [],
      lookupIds: []
    };
  }

  if (value.endsWith("@c.us")) {
    return {
      chatId: value,
      fallbackChatIds: [],
      lookupIds: [value]
    };
  }

  const candidates = buildPhoneCandidates(value);
  if (candidates.length === 0) {
    throw buildBadRequest("Invalid WhatsApp recipient format");
  }

  const lookupIds = [];
  const resolvedChatIds = [];
  const directChatIds = [];

  for (const candidate of candidates) {
    const candidateChatId = `${candidate}@c.us`;
    uniqueSerializedPush(lookupIds, candidateChatId);
    uniqueSerializedPush(directChatIds, candidateChatId);

    try {
      const resolved = await activeClient.getNumberId(candidate);
      if (resolved && resolved._serialized) {
        uniqueSerializedPush(resolvedChatIds, resolved._serialized);
      }
    } catch (_error) {
      // Keep trying with the next candidate format.
    }
  }

  const orderedChatIds = [];
  for (const chatId of resolvedChatIds) {
    uniqueSerializedPush(orderedChatIds, chatId);
  }
  for (const chatId of directChatIds) {
    uniqueSerializedPush(orderedChatIds, chatId);
  }

  if (orderedChatIds.length > 0) {
    return {
      chatId: orderedChatIds[0],
      fallbackChatIds: orderedChatIds.slice(1),
      lookupIds
    };
  }

  throw buildBadRequest(
    `Unable to resolve WhatsApp number. Tried: ${candidates.map((item) => `${item}@c.us`).join(", ")}`
  );
}

async function resolveRecipientFromLidLookup(activeClient, lookupIds) {
  if (!Array.isArray(lookupIds) || lookupIds.length === 0) {
    return null;
  }

  if (typeof activeClient.getContactLidAndPhone !== "function") {
    return null;
  }

  try {
    const entries = await activeClient.getContactLidAndPhone(lookupIds);
    return pickFirstResolvedIdFromLidLookup(entries);
  } catch (_error) {
    return null;
  }
}

async function sendWhatsAppMessage({ to, subject, body }) {
  if (!isWhatsAppEnabled()) {
    const error = new Error("WhatsApp sending is disabled. Set WHATSAPP_ENABLED=true.");
    error.statusCode = 503;
    throw error;
  }

  await initializeWhatsAppClient();

  if (!client || !isReady) {
    const error = new Error("WhatsApp client is not ready yet. Authenticate using QR code first.");
    error.statusCode = 503;
    throw error;
  }

  const recipient = await normalizeRecipient(to, client);
  const text = subject ? `${subject}\n\n${body}` : body;
  const attemptedChatIds = [];
  const deliveryTargets = [recipient.chatId, ...(recipient.fallbackChatIds || [])];
  let lastError;

  for (const chatId of deliveryTargets) {
    uniqueSerializedPush(attemptedChatIds, chatId);
    try {
      return await client.sendMessage(chatId, text);
    } catch (error) {
      lastError = error;

      if (deliveryTargets.length > 1) {
        console.warn(`[whatsapp] Tentativa de envio falhou para ${chatId}: ${String(error?.message || error)}`);
      }
    }
  }

  const lastErrorMessage = String(lastError?.message || lastError || "unknown error");
  const finalMessage =
    `Falha no envio WhatsApp apos tentar ${attemptedChatIds.join(", ")} (destino original: ${to}): ${lastErrorMessage}`;

  console.error(`[whatsapp] ${finalMessage}`);

  const finalError = new Error(finalMessage);
  finalError.statusCode = Number.isFinite(lastError?.statusCode) ? lastError.statusCode : 502;
  throw finalError;
}

async function shutdownWhatsAppClient() {
  if (!client) {
    return;
  }

  await client.destroy();
  client = undefined;
  initializePromise = undefined;
  isReady = false;
}

module.exports = {
  buildPhoneCandidates,
  pickFirstResolvedIdFromLidLookup,
  isWhatsAppEnabled,
  isWhatsAppReady,
  initializeWhatsAppClient,
  sendWhatsAppMessage,
  shutdownWhatsAppClient
};
