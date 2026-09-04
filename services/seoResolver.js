import { SEO } from "../models/seoModel.js";
import { State } from "../models/statesCitiesModel.js";
import { Product } from "../models/productModel.js";

const SITE_URL = (process.env.FRONTEND_URL || "https://www.hiremyescort.com").replace(/\/$/, "");

const CATEGORY_LABELS = {
  "call-girls": "Call Girls",
  massage: "Massage",
  "couple-friendly": "Couple Friendly",
};

const VALID_CATEGORIES = Object.keys(CATEGORY_LABELS);

function slugify(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function deslugify(slug) {
  if (!slug) return "";
  return String(slug)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function xmlEscape(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeName(s) {
  return String(s || "").toLowerCase().trim();
}

/**
 * Find state name for a city slug by scanning State collection.
 * Returns { stateName, cityName, locationName } with proper casing, or nulls.
 */
async function resolveLocation(citySlug, locationSlug) {
  if (!citySlug) return { stateName: "", cityName: "", locationName: "" };
  const citySearch = normalizeName(citySlug.replace(/-/g, " "));
  const states = await State.find().select("name cities.name cities.locations.name").lean();
  for (const st of states) {
    for (const c of st.cities || []) {
      if (normalizeName(c.name) === citySearch) {
        let locName = "";
        if (locationSlug) {
          const locSearch = normalizeName(locationSlug.replace(/-/g, " "));
          const match = (c.locations || []).find((l) => normalizeName(l.name) === locSearch);
          locName = match ? match.name : deslugify(locationSlug);
        }
        return { stateName: st.name, cityName: c.name, locationName: locName };
      }
    }
  }
  return { stateName: "", cityName: deslugify(citySlug), locationName: locationSlug ? deslugify(locationSlug) : "" };
}

async function lookupSEOHierarchy(category, stateName, cityName, locationName) {
  const cat = normalizeName(category);
  const st = normalizeName(stateName);
  const ci = normalizeName(cityName);
  const lo = normalizeName(locationName);

  // Level 1: exact (category+state+city+location)
  if (lo && st && ci) {
    const exact = await SEO.findOne({ category: cat, state: st, city: ci, location: lo }).lean();
    if (exact && (exact.title || exact.description)) return { seo: exact, level: "exact" };
  }
  // Level 2: category+city
  if (st && ci) {
    const cityLevel = await SEO.findOne({ category: cat, state: st, city: ci, location: "" }).lean();
    if (cityLevel && (cityLevel.title || cityLevel.description)) return { seo: cityLevel, level: "city" };
  }
  // Level 3: category only
  const catOnly = await SEO.findOne({ category: cat, state: "", city: "", location: "" }).lean();
  if (catOnly && (catOnly.title || catOnly.description)) return { seo: catOnly, level: "category" };
  return { seo: null, level: "none" };
}

async function lookupLegacyCitySEO(stateName, cityName) {
  if (!stateName || !cityName) return null;
  try {
    const st = await State.findOne({ name: { $regex: new RegExp(`^${stateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } }).lean();
    if (!st) return null;
    const city = (st.cities || []).find((c) => normalizeName(c.name) === normalizeName(cityName));
    if (city?.seo && (city.seo.title || city.seo.description)) return city.seo;
  } catch {
    // ignore, fallback to generated
  }
  return null;
}

function generatedFallback({ category, cityName, locationName, product }) {
  const catLabel = CATEGORY_LABELS[normalizeName(category)] || (category ? deslugify(category) : "");
  if (product) {
    const city = product.city || cityName || "India";
    return {
      title: `${product.title || `${city} ${catLabel}`} - ${city} | HireMyEscort`,
      description: String(product.about || `View ${product.title || catLabel} profile in ${city}. Verified independent escort with real photos and direct contact.`).substring(0, 160),
      keywords: `${city}, ${catLabel}, escorts, call girls`,
      htmlSnippet: "",
      linkTag: "",
    };
  }
  if (category && cityName && locationName) {
    return {
      title: `${locationName} ${catLabel} - ${cityName} Escorts Service | HireMyEscort`,
      description: `Find ${catLabel} in ${locationName}, ${cityName}. Browse verified independent escorts and call girls near ${locationName}. Real profiles with genuine photos and contact numbers.`,
      keywords: `${locationName} ${catLabel}, ${cityName} escorts, call girls in ${locationName}`,
      htmlSnippet: "",
      linkTag: "",
    };
  }
  if (category && cityName) {
    return {
      title: `${cityName} ${catLabel} - HireMyEscort`,
      description: `Find best ${catLabel} services in ${cityName}. Browse verified independent escorts and call girls in ${cityName}. Real profiles with genuine photos and direct contact.`,
      keywords: `${cityName} ${catLabel}, ${cityName} escorts, call girls in ${cityName}`,
      htmlSnippet: "",
      linkTag: "",
    };
  }
  if (category) {
    return {
      title: `${catLabel} Across India - HireMyEscort`,
      description: `Browse ${catLabel} listings across all major Indian cities. Find verified independent escorts, call girls, and massage services near you. Real profiles with photos.`,
      keywords: `${catLabel}, escorts india, call girls india`,
      htmlSnippet: "",
      linkTag: "",
    };
  }
  return {
    title: "Indian Escorts Directory - HireMyEscort",
    description: "HireMyEscort #1 Adult Post Free Classified site in India. Browse our categories for finding independent escorts, call girls, and massage services across all major Indian cities.",
    keywords: "india escorts, india escort service, independent escorts in India, free classified ads in India, call girls in India",
    htmlSnippet: "",
    linkTag: "",
  };
}

/**
 * Resolve admin SEO for any frontend path.
 * Returns { title, description, keywords, canonical, ogImage, ogUrl, robots, htmlSnippet, linkTag, source }
 * Never throws — always returns at least generated fallback.
 */
export async function resolveSEOForPath(inputPath) {
  const rawPath = String(inputPath || "/").split("?")[0].split("#")[0] || "/";
  const cleanPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const segments = cleanPath.split("/").filter(Boolean);
  const canonical = `${SITE_URL}${cleanPath === "/" ? "/" : cleanPath.replace(/\/$/, "") === "/" ? "/" : cleanPath}`;
  const defaultRobots = "index, follow";

  // Static pages
  const staticMeta = {
    terms: ["Terms of Service - HireMyEscort", "Terms and conditions for using HireMyEscort adult classifieds directory."],
    "privacy-policy": ["Privacy Policy - HireMyEscort", "Privacy policy for HireMyEscort. Learn how we collect, use, and protect your personal information."],
    contact: ["Contact Us - HireMyEscort", "Contact the HireMyEscort team for support, inquiries, or advertising opportunities."],
    signup: ["Create Account - HireMyEscort", "Sign up for HireMyEscort and start posting adult classified ads."],
    login: ["Login - HireMyEscort", "Login to your HireMyEscort account. Manage your listings and connect with clients."],
    search: ["Search - HireMyEscort", "Search HireMyEscort for verified independent escorts, call girls, and massage services across India."],
  };
  if (segments.length === 0) {
    const fb = generatedFallback({});
    return { ...fb, canonical: `${SITE_URL}/`, ogUrl: `${SITE_URL}/`, ogImage: `${SITE_URL}/logo.png`, robots: defaultRobots, source: "home-fallback" };
  }
  if (segments.length === 1 && staticMeta[segments[0]]) {
    const [t, d] = staticMeta[segments[0]];
    return { title: t, description: d, keywords: "", htmlSnippet: "", linkTag: "", canonical, ogUrl: canonical, ogImage: `${SITE_URL}/logo.png`, robots: segments[0] === "signup" || segments[0] === "login" ? "noindex, follow" : defaultRobots, source: "static" };
  }

  const categorySlug = normalizeName(segments[0]);

  // Profile detail pages: /:cat/:city/details/:id  or  /:cat/:city/:loc/details/:id
  const detailsIdx = segments.indexOf("details");
  if (detailsIdx !== -1) {
    const productId = segments[detailsIdx + 1] || "";
    let product = null;
    try {
      if (productId && productId.match(/^[0-9a-fA-F]{24}$/)) {
        product = await Product.findById(productId).select("title about city state location category productImg").lean();
      }
    } catch {
      product = null;
    }
    const citySlug = segments[1] || (product ? slugify(product.city) : "");
    const locSlug = detailsIdx === 3 ? segments[2] : "";
    const { stateName, cityName } = await resolveLocation(citySlug, locSlug);
    // Prefer city/location admin SEO for description backing, but product is primary for title/image
    let backing = null;
    if (categorySlug && cityName) {
      const { seo } = await lookupSEOHierarchy(categorySlug, stateName, cityName, locSlug ? deslugify(locSlug) : "");
      backing = seo;
    }
    const fb = generatedFallback({ category: categorySlug, cityName: product?.city || cityName, locationName: product?.location || "", product });
    return {
      title: fb.title,
      description: backing?.description || fb.description,
      keywords: backing?.keywords || fb.keywords,
      htmlSnippet: backing?.htmlSnippet || "",
      linkTag: backing?.linkTag || "",
      canonical,
      ogUrl: canonical,
      ogImage: product?.productImg?.[0]?.url || `${SITE_URL}/logo.png`,
      robots: defaultRobots,
      source: product ? "product" : "product-fallback",
    };
  }

  // Listing pages: /:cat  /:cat/:city  /:cat/:city/:loc
  if (VALID_CATEGORIES.includes(categorySlug)) {
    const citySlug = segments[1] || "";
    const locSlug = segments[2] || "";
    if (!citySlug) {
      const { seo } = await lookupSEOHierarchy(categorySlug, "", "", "");
      const fb = generatedFallback({ category: categorySlug });
      return {
        title: seo?.title || fb.title,
        description: seo?.description || fb.description,
        keywords: seo?.keywords || fb.keywords,
        htmlSnippet: seo?.htmlSnippet || "",
        linkTag: seo?.linkTag || "",
        canonical,
        ogUrl: canonical,
        ogImage: `${SITE_URL}/logo.png`,
        robots: defaultRobots,
        source: seo ? "admin-category" : "category-fallback",
      };
    }
    const { stateName, cityName, locationName } = await resolveLocation(citySlug, locSlug);
    const { seo } = await lookupSEOHierarchy(categorySlug, stateName, cityName, locationName);
    if (seo) {
      return {
        title: seo.title || generatedFallback({ category: categorySlug, cityName, locationName }).title,
        description: seo.description || generatedFallback({ category: categorySlug, cityName, locationName }).description,
        keywords: seo.keywords || "",
        htmlSnippet: seo.htmlSnippet || "",
        linkTag: seo.linkTag || "",
        canonical,
        ogUrl: canonical,
        ogImage: `${SITE_URL}/logo.png`,
        robots: defaultRobots,
        source: "admin-db",
      };
    }
    // Legacy city.seo embedded in State model
    const legacy = await lookupLegacyCitySEO(stateName, cityName);
    if (legacy) {
      return {
        title: legacy.title || generatedFallback({ category: categorySlug, cityName, locationName }).title,
        description: legacy.description || generatedFallback({ category: categorySlug, cityName, locationName }).description,
        keywords: legacy.keywords || "",
        htmlSnippet: legacy.htmlSnippet || "",
        linkTag: legacy.linkTag || "",
        canonical,
        ogUrl: canonical,
        ogImage: `${SITE_URL}/logo.png`,
        robots: defaultRobots,
        source: "legacy-city-seo",
      };
    }
    const fb = generatedFallback({ category: categorySlug, cityName: cityName || deslugify(citySlug), locationName: locSlug ? locationName || deslugify(locSlug) : "" });
    return { ...fb, canonical, ogUrl: canonical, ogImage: `${SITE_URL}/logo.png`, robots: defaultRobots, source: "generated-fallback" };
  }

  // Unknown route — noindex to avoid soft-404 indexing, but keep crawlable
  const fb = generatedFallback({});
  return { ...fb, canonical, ogUrl: canonical, ogImage: `${SITE_URL}/logo.png`, robots: "noindex, follow", source: "unknown-fallback" };
}

export function buildPrerenderHtml({ title, description, keywords, canonical, ogUrl, ogImage, robots, htmlSnippet, linkTag }) {
  const t = xmlEscape(title);
  const d = xmlEscape(description);
  const k = xmlEscape(keywords);
  const c = xmlEscape(canonical || SITE_URL);
  const ou = xmlEscape(ogUrl || canonical || SITE_URL);
  const oi = xmlEscape(ogImage || `${SITE_URL}/logo.png`);
  const r = xmlEscape(robots || "index, follow");
  // linkTag comes from admin — inject as-is (admin-trusted). Strip <script> for crawler safety.
  const safeLinkTag = String(linkTag || "").replace(/<script[\s\S]*?<\/script>/gi, "");
  // htmlSnippet is admin rich content — strip scripts/iframes for crawler HTML, keep formatting.
  const safeSnippet = String(htmlSnippet || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  const snippetBlock = safeSnippet
    ? `<div class="seo-content">${safeSnippet}</div>`
    : `<p>${d}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t}</title>
  <meta name="description" content="${d}">
  ${k ? `<meta name="keywords" content="${k}">` : ""}
  <meta name="robots" content="${r}">
  <link rel="canonical" href="${c}">
  ${safeLinkTag}
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${ou}">
  <meta property="og:image" content="${oi}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${oi}">
  <meta name="rating" content="adult">
</head>
<body>
  <main>
    <h1>${t}</h1>
    ${snippetBlock}
    <p><a href="${c}">View full interactive listing on HireMyEscort</a></p>
  </main>
</body>
</html>`;
}
