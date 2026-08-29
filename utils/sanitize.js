export const escapeRegex = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const ensureString = (value) => {
  if (typeof value !== "string") return "";
  return value;
};

export const ensureNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const escapeHtml = (str) => {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};
