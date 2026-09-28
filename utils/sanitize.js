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

/**
 * Parse a boolean that may arrive as a real boolean (JSON body) or as a string.
 *
 * Multipart requests are the trap: every field in a FormData body is a string,
 * so `isTopCity: "false"` reaches the server as the four-character string
 * "false", and `Boolean("false")` is `true` because the string is non-empty.
 * Any endpoint that mixes a file upload with a boolean therefore needs this
 * instead of a bare `Boolean(...)`.
 *
 * Unrecognised input is false, so a malformed value never flips a flag on.
 */
export const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "on";
  }
  return false;
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
