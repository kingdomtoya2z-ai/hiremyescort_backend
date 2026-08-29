import https from "https";
import http from "http";

const PRERENDER_TOKEN = process.env.PRERENDER_TOKEN || "";
const PRERENDER_SERVICE_URL = process.env.PRERENDER_SERVICE_URL || "https://service.prerender.io";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.hiremyescort.com";

const BOT_USER_AGENTS = [
  "googlebot",
  "bingbot",
  "yandexbot",
  "twitterbot",
  "facebookexternalhit",
  "linkedinbot",
  "slackbot",
  "whatsapp",
  "telegrambot",
  "applebot",
  "baiduspider",
  "semrushbot",
  "ahrefsbot",
  "dotbot",
  "rogerbot",
  "mj12bot",
  "screaming frog",
  "curl",
  "wget",
  "python-requests",
  "xenu link sleuth",
];

const CRAWLABLE_ROUTES = [
  "/",
  "/call-girls",
  "/massage",
  "/couple-friendly",
  "/call-girls/",
  "/massage/",
  "/couple-friendly/",
  "/search/",
  "/terms",
  "/privacy-policy",
  "/contact",
  "/signup",
  "/login",
];

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
}

function isCrawlableRoute(path) {
  return CRAWLABLE_ROUTES.some((route) => path.startsWith(route));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data }));
    }).on("error", reject).on("timeout", function () {
      this.destroy();
      reject(new Error("Timeout"));
    });
  });
}

const SKIP_ROUTES = ["/sitemap.xml", "/sitemap-categories.xml", "/sitemap-pages.xml", "/robots.txt", "/cron-job"];
const SKIP_PREFIXES = ["/sitemap-cities-", "/sitemap-profiles-", "/sitemap-locations-"];

export async function prerenderMiddleware(req, res, next) {
  const userAgent = req.headers["user-agent"] || "";
  const path = req.path;

  if (SKIP_ROUTES.includes(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
    return next();
  }

  const shouldPrerender = isBot(userAgent) && isCrawlableRoute(path);

  if (!shouldPrerender) {
    return next();
  }

  if (PRERENDER_TOKEN) {
    try {
      const fullUrl = `${FRONTEND_URL}${req.originalUrl}`;
      const encodedUrl = encodeURIComponent(fullUrl);
      const response = await fetchUrl(`${PRERENDER_SERVICE_URL}/${encodedUrl}`);

      if (response.status === 200 && response.data) {
        return res.send(response.data);
      }
    } catch (error) {
      console.warn("Prerender service error, falling back to SPA:", error.message);
    }
  }

  const seoHtml = await generateSEOHtml(path);

  if (seoHtml) {
    return res.send(seoHtml);
  }

  next();
}

async function generateSEOHtml(path) {
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return getBasicHTML("Home - HireMyEscort", "Indian Escorts Directory - Find verified call girls and escorts across India.");
  }

  if (segments.length >= 2) {
    const category = segments[0];
    const city = segments[1];
    const title = `${city.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} ${category.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} - HireMyEscort`;
    const description = `Find best ${category.replace(/-/g, " ")} in ${city.replace(/-/g, " ")}. Verified independent escorts, call girls, and massage services. Real profiles with photos.`;
    return getBasicHTML(title, description);
  }

  if (segments.length === 1 && !["signup", "login", "terms", "privacy-policy", "contact"].includes(segments[0])) {
    const category = segments[0];
    const title = `${category.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} - HireMyEscort`;
    const description = `Browse all ${category.replace(/-/g, " ")} listings across India. Find verified independent escorts and call girls.`;
    return getBasicHTML(title, description);
  }

  return null;
}

function getBasicHTML(title, description) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${xmlEscape(title)}</title>
  <meta name="description" content="${xmlEscape(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${FRONTEND_URL}">
  <meta property="og:title" content="${xmlEscape(title)}">
  <meta property="og:description" content="${xmlEscape(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${FRONTEND_URL}">
  <script>window.location.replace("${FRONTEND_URL}");</script>
</head>
<body>
  <h1>${xmlEscape(title)}</h1>
  <p>${xmlEscape(description)}</p>
  <script src="/assets/index.js"></script>
</body>
</html>`;
}

function xmlEscape(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
