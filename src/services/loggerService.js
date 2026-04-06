const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const util = require("util");
const config = require("../config");

const PATCHED_METHODS = ["log", "info", "warn", "error", "debug"];

let loggerInitialized = false;
let fileStream;
const originalConsole = {};

function serializeArgument(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return util.inspect(value, {
    depth: 5,
    colors: false,
    breakLength: 120
  });
}

function formatLogLine(level, args) {
  const message = args.map(serializeArgument).join(" ");
  return `${new Date().toISOString()} [${String(level || "log").toUpperCase()}] ${message}`;
}

function writeLineToFile(line) {
  if (!fileStream) {
    return;
  }

  fileStream.write(`${line}\n`);
}

async function initializeFileLogger() {
  if (loggerInitialized) {
    return config.logging.filePath;
  }

  const filePath = config.logging.filePath;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  fileStream = fs.createWriteStream(filePath, {
    flags: "a",
    encoding: "utf8"
  });

  for (const methodName of PATCHED_METHODS) {
    const originalMethod = typeof console[methodName] === "function"
      ? console[methodName].bind(console)
      : console.log.bind(console);

    originalConsole[methodName] = originalMethod;

    console[methodName] = (...args) => {
      originalMethod(...args);
      writeLineToFile(formatLogLine(methodName, args));
    };
  }

  fileStream.on("error", (error) => {
    const fallbackErrorLogger = originalConsole.error || console.error.bind(console);
    fallbackErrorLogger("[logger] Failed to write log file:", error.message);
  });

  loggerInitialized = true;
  console.log(`[logger] File logging enabled at '${filePath}'`);

  return filePath;
}

async function shutdownFileLogger() {
  if (!loggerInitialized) {
    return;
  }

  const stream = fileStream;

  for (const methodName of PATCHED_METHODS) {
    if (originalConsole[methodName]) {
      console[methodName] = originalConsole[methodName];
    }
  }

  fileStream = undefined;
  loggerInitialized = false;

  if (!stream) {
    return;
  }

  await new Promise((resolve) => {
    stream.end(resolve);
  });
}

module.exports = {
  initializeFileLogger,
  shutdownFileLogger
};