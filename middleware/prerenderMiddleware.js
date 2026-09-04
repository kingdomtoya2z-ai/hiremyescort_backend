import https from "https";
import http from "http";
import { resolveSEOForPath, buildPrerenderHtml } from "../services/seoResolver.js";

const PRERENDER_TOKEN = process.env.PRERENDER_TOKEN || "";
const PRERENDER_SERVICE_URL = process.env.PRERENDER_SERVICE_URL || "https://service.prerender.io";
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.hiremyescort.com").replace(/\/$/, "");

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
  "php-curl",
  "xenu link sleuth",
  "crawler",
  "spider",
  "xmlsitemap",
];

// Crawlable frontend routes (prefix match). Dynamic city/location/profile
// pages start with these prefixes so they are covered.
const CRAWLABLE_ROUTES = [
  "/",
  "/call-girls",
  "/massage",
  "/couple-friendly",
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
  if (path === "/") return true;
  return CRAWLABLE_ROUTES.filter((r) => r !== "/").some(
    (route) => path === route || path.startsWith(route.endsWith("/") ? route : `${route}/`)
  );
}

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 10000, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.on("error", reject);
    req.on("timeout", function () {
      this.destroy();
      reject(new Error("Timeout"));
    });
  });
}

const SKIP_ROUTES = ["/sitemap.xml", "/sitemap-categories.xml", "/sitemap-pages.xml", "/robots.txt", "/cron-job", "/api"];
const SKIP_PREFIXES = ["/sitemap-cities-", "/sitemap-profiles-", "/sitemap-locations-", "/assets/", "/api/", "/prerender"];

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

  // Optional external prerender.io (only if token configured)
  if (PRERENDER_TOKEN) {
    try {
      const fullUrl = `${FRONTEND_URL}${req.originalUrl}`;
      const encodedUrl = encodeURIComponent(fullUrl);
      const response = await fetchUrl(`${PRERENDER_SERVICE_URL}/${encodedUrl}`, {
        "X-Prerender-Token": PRERENDER_TOKEN,
        "User-Agent": userAgent,
      });

      if (response.status === 200 && response.data) {
        res.setHeader("X-Prerendered", "external");
        return res.send(response.data);
      }
    } catch (error) {
      console.warn("Prerender service error, falling back to DB SEO:", error.message);
    }
  }

  // Primary path: real admin SEO from Mongo (same source as React UI)
  try {
    const seo = await resolveSEOForPath(req.originalUrl || path);
    const html = buildPrerenderHtml(seo);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Prerendered", "db-seo");
    res.setHeader("X-SEO-Source", seo.source || "unknown");
    return res.send(html);
  } catch (err) {
    console.warn("DB prerender failed, falling back to SPA:", err.message);
  }

  next();
}
