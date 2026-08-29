import { Product } from "../models/productModel.js";
import { State } from "../models/statesCitiesModel.js";
import { SEO } from "../models/seoModel.js";

const SITE_URL = process.env.FRONTEND_URL || "https://www.hiremyescort.com";
const SITEMAP_BASE_URL = process.env.SITEMAP_BASE_URL || SITE_URL;
const MAX_URLS_PER_SITEMAP = 50000;

const categorySlugMap = {
  "Call Girls": "call-girls",
  Massage: "massage",
  "Couple Friendly": "couple-friendly",
};

const reverseCategoryMap = {
  "call-girls": "Call Girls",
  massage: "Massage",
  "couple-friendly": "Couple Friendly",
};

function formatDate(date) {
  if (!date) return new Date().toISOString().split("T")[0];
  const d = new Date(date);
  return d.toISOString().split("T")[0];
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

function urlElement(loc, lastmod, changefreq, priority, images = []) {
  let xml = `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n`;
  for (const img of images) {
    xml += `    <image:image>\n      <image:loc>${xmlEscape(img)}</image:loc>\n    </image:image>\n`;
  }
  xml += `  </url>`;
  return xml;
}

function generateSitemapIndex(sitemapFiles) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  const today = new Date().toISOString();
  for (const file of sitemapFiles) {
    xml += `  <sitemap>\n    <loc>${SITEMAP_BASE_URL}/${file}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>\n`;
  }
  xml += `</sitemapindex>`;
  return xml;
}

function generateXMLHeader() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`;
}

function generateXMLFooter() {
  return `</urlset>`;
}

export async function getAllSitemapData() {
  const [products, states, seoEntries] = await Promise.all([
    Product.find({
      status: "approved",
      isExpired: false,
      approvalDate: { $ne: null, $exists: true },
    })
      .select("title city state category location productImg updatedAt createdAt")
      .lean()
      .exec(),
    State.find().lean().exec(),
    SEO.find().lean().exec(),
  ]);

  const flatCities = [];
  const flatLocations = [];
  const stateCityMap = {};

  for (const state of states) {
    stateCityMap[state.name] = {};
    for (const city of state.cities) {
      const cityKey = city.name.toLowerCase().replace(/\s+/g, "-");
      stateCityMap[state.name][cityKey] = city.name;
      flatCities.push({ name: city.name, state: state.name });
      for (const loc of city.locations || []) {
        flatLocations.push({
          name: loc.name,
          city: city.name,
          state: state.name,
        });
      }
    }
  }

  return { products, states, seoEntries, flatCities, flatLocations, stateCityMap };
}

export async function generateCitiesSitemap(page = 0) {
  const { flatCities, products } = await getAllSitemapData();
  const categories = Object.keys(reverseCategoryMap);

  const urls = [];
  const seen = new Set();

  for (const city of flatCities) {
    const citySlug = city.name.toLowerCase().replace(/\s+/g, "-");
    for (const category of categories) {
      const key = `${category}/${citySlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push({
        loc: `${SITE_URL}/${category}/${citySlug}`,
        lastmod: formatDate(new Date()),
        changefreq: "daily",
        priority: "0.8",
      });
    }
  }

  const start = page * MAX_URLS_PER_SITEMAP;
  const end = start + MAX_URLS_PER_SITEMAP;
  const pageUrls = urls.slice(start, end);

  let xml = generateXMLHeader() + "\n";
  for (const u of pageUrls) {
    xml += urlElement(u.loc, u.lastmod, u.changefreq, u.priority) + "\n";
  }
  xml += generateXMLFooter();
  return { xml, total: urls.length, pages: Math.ceil(urls.length / MAX_URLS_PER_SITEMAP) };
}

export async function generateCategoriesSitemap() {
  const categories = Object.keys(reverseCategoryMap);
  let xml = generateXMLHeader() + "\n";

  for (const cat of categories) {
    xml += urlElement(`${SITE_URL}/${cat}`, formatDate(new Date()), "daily", "0.9") + "\n";
  }

  xml += generateXMLFooter();
  return xml;
}

export async function generateLocationsSitemap(page = 0) {
  const { flatLocations } = await getAllSitemapData();
  const categories = Object.keys(reverseCategoryMap);

  const urls = [];
  const seen = new Set();

  for (const loc of flatLocations) {
    const citySlug = loc.city.toLowerCase().replace(/\s+/g, "-");
    const locationSlug = loc.name.toLowerCase().replace(/\s+/g, "-");
    for (const category of categories) {
      const key = `${category}/${citySlug}/${locationSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push({
        loc: `${SITE_URL}/${category}/${citySlug}/${locationSlug}`,
        lastmod: formatDate(new Date()),
        changefreq: "daily",
        priority: "0.7",
      });
    }
  }

  const start = page * MAX_URLS_PER_SITEMAP;
  const end = start + MAX_URLS_PER_SITEMAP;
  const pageUrls = urls.slice(start, end);

  let xml = generateXMLHeader() + "\n";
  for (const u of pageUrls) {
    xml += urlElement(u.loc, u.lastmod, u.changefreq, u.priority) + "\n";
  }
  xml += generateXMLFooter();
  return { xml, total: urls.length, pages: Math.ceil(urls.length / MAX_URLS_PER_SITEMAP) };
}

export async function generateProfilesSitemap(page = 0) {
  const { products } = await getAllSitemapData();
  const urls = [];

  for (const product of products) {
    if (!product.city) continue;
    const categorySlug = categorySlugMap[product.category] || product.category?.toLowerCase().replace(/\s+/g, "-");
    const citySlug = product.city.toLowerCase().replace(/\s+/g, "-");
    const locationSlug = product.location ? product.location.toLowerCase().replace(/\s+/g, "-") : "";
    const lastmod = formatDate(product.updatedAt || product.createdAt);
    const images = (product.productImg || []).map((img) => img.url).filter(Boolean);

    let loc;
    if (locationSlug) {
      loc = `${SITE_URL}/${categorySlug}/${citySlug}/${locationSlug}/details/${product._id}`;
    } else {
      loc = `${SITE_URL}/${categorySlug}/${citySlug}/details/${product._id}`;
    }

    urls.push({
      loc,
      lastmod,
      changefreq: "weekly",
      priority: "0.6",
      images,
    });
  }

  const start = page * MAX_URLS_PER_SITEMAP;
  const end = start + MAX_URLS_PER_SITEMAP;
  const pageUrls = urls.slice(start, end);

  let xml = generateXMLHeader() + "\n";
  for (const u of pageUrls) {
    xml += urlElement(u.loc, u.lastmod, u.changefreq, u.priority, u.images) + "\n";
  }
  xml += generateXMLFooter();
  return { xml, total: urls.length, pages: Math.ceil(urls.length / MAX_URLS_PER_SITEMAP) };
}

export async function generatePagesSitemap() {
  const staticPages = [
    { loc: `${SITE_URL}/`, priority: "1.0", changefreq: "daily" },
    { loc: `${SITE_URL}/signup`, priority: "0.5", changefreq: "monthly" },
    { loc: `${SITE_URL}/login`, priority: "0.4", changefreq: "monthly" },
    { loc: `${SITE_URL}/terms`, priority: "0.3", changefreq: "monthly" },
    { loc: `${SITE_URL}/privacy-policy`, priority: "0.3", changefreq: "monthly" },
    { loc: `${SITE_URL}/contact`, priority: "0.5", changefreq: "monthly" },
    { loc: `${SITE_URL}/search/location`, priority: "0.6", changefreq: "daily" },
  ];

  let xml = generateXMLHeader() + "\n";
  for (const page of staticPages) {
    xml += urlElement(page.loc, formatDate(new Date()), page.changefreq, page.priority) + "\n";
  }
  xml += generateXMLFooter();
  return xml;
}

function countSitemapUrls(data) {
  const { flatCities, flatLocations, products } = data;
  const categories = Object.keys(reverseCategoryMap);

  const cityCount = flatCities.length * categories.length;
  const locationCount = flatLocations.length * categories.length;
  const profileCount = products.filter((p) => p.city).length;

  return {
    citiesPages: Math.ceil(cityCount / MAX_URLS_PER_SITEMAP),
    locationsPages: Math.ceil(locationCount / MAX_URLS_PER_SITEMAP),
    profilesPages: Math.ceil(profileCount / MAX_URLS_PER_SITEMAP),
  };
}

export async function generateSitemapIndexXml() {
  const data = await getAllSitemapData();
  const { citiesPages, locationsPages, profilesPages } = countSitemapUrls(data);

  const files = [];

  files.push("sitemap-categories.xml");

  for (let i = 0; i < citiesPages; i++) {
    files.push(`sitemap-cities-${i + 1}.xml`);
  }

  for (let i = 0; i < locationsPages; i++) {
    files.push(`sitemap-locations-${i + 1}.xml`);
  }

  for (let i = 0; i < profilesPages; i++) {
    files.push(`sitemap-profiles-${i + 1}.xml`);
  }

  files.push("sitemap-pages.xml");

  return generateSitemapIndex(files);
}

export async function generatePaginatableSitemap(type, page = 1) {
  switch (type) {
    case "cities":
      return generateCitiesSitemap(page - 1);
    case "profiles":
      return generateProfilesSitemap(page - 1);
    case "locations":
      return generateLocationsSitemap(page - 1);
    default:
      throw new Error("Unknown sitemap type");
  }
}
