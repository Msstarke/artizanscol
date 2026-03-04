import { initSharedPage } from "./shared-nav.js";
import { byId, showToast } from "./utils.js";

initSharedPage();

const contactForm = byId("contact-form");
const nameInput = byId("contact-name");
const emailInput = byId("contact-email");
const messageInput = byId("contact-message");

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = (nameInput?.value || "").trim();
  const email = (emailInput?.value || "").trim();
  const message = (messageInput?.value || "").trim();

  if (!name || !email || !message) {
    showToast("Name, email, and message are required.", "warning");
    return;
  }

  if (!isValidEmail(email)) {
    showToast("Enter a valid email address.", "warning");
    return;
  }

  if (message.length > 2000) {
    showToast("Message is too long.", "warning");
    return;
  }

  const subject = encodeURIComponent(`Support request from ${name}`);
  const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
  window.location.href = `mailto:support@artizanscollective.com?subject=${subject}&body=${body}`;
  showToast("Opening your email client.", "success");
});
