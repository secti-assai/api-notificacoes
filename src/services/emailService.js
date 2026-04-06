const nodemailer = require("nodemailer");
const config = require("../config");

let transporter;

function isEmailConfigured() {
  return Boolean(
    (config.smtp.service || config.smtp.host) &&
    config.smtp.user &&
    config.smtp.pass
  );
}

function buildSmtpOptions() {
  const options = {
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass
    }
  };

  if (config.smtp.service) {
    options.service = config.smtp.service;
  } else {
    options.host = config.smtp.host;
    options.port = config.smtp.port;
    options.secure = config.smtp.secure;
  }

  return options;
}

function getTransporter() {
  if (!isEmailConfigured()) {
    const error = new Error("SMTP is not configured. Check .env settings.");
    error.statusCode = 500;
    throw error;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport(buildSmtpOptions());
  }

  return transporter;
}

async function verifyEmailTransport() {
  if (!isEmailConfigured()) {
    return false;
  }

  await getTransporter().verify();
  return true;
}

async function sendEmail({ to, subject, body }) {
  const mailTransporter = getTransporter();

  return mailTransporter.sendMail({
    from: config.smtp.from || config.smtp.user,
    to,
    subject,
    text: body
  });
}

module.exports = {
  isEmailConfigured,
  verifyEmailTransport,
  sendEmail
};
