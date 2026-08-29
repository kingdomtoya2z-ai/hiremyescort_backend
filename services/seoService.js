import { Product } from "../models/productModel.js";
import { State } from "../models/statesCitiesModel.js";
import { SEO } from "../models/seoModel.js";

const SITE_URL = process.env.FRONTEND_URL || "https://www.hiremyescort.com";

const categorySlugMap = {
  "Call Girls": "call-girls",
  Massage: "massage",
  "Couple Friendly": "couple-friendly",
  "call-girls": "call-girls",
  massage: "massage",
  "couple-friendly": "couple-friendly",
};

function slugify(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateProductUrl(product) {
  if (!product || !product.city) return SITE_URL;
  const categorySlug = categorySlugMap[product.category] || slugify(product.category);
  const citySlug = slugify(product.city);
  const locationSlug = product.location ? slugify(product.location) : "";

  if (locationSlug) {
    return `${SITE_URL}/${categorySlug}/${citySlug}/${locationSlug}/details/${product._id}`;
  }
  return `${SITE_URL}/${categorySlug}/${citySlug}/details/${product._id}`;
}

export function generateCityUrl(categorySlug, cityName) {
  return `${SITE_URL}/${categorySlug}/${slugify(cityName)}`;
}

export function generateCategoryUrl(categorySlug) {
  return `${SITE_URL}/${categorySlug}`;
}

export async function getInternalLinksForCity(category, cityName, stateName, limit = 10) {
  const categorySlug = categorySlugMap[category] || slugify(category);

  const otherCitiesPromise = State.findOne({ name: stateName })
    .select("cities")
    .lean()
    .then((state) => {
      if (!state) return [];
      return (state.cities || [])
        .filter((c) => c.name.toLowerCase() !== cityName.toLowerCase())
        .slice(0, limit)
        .map((c) => ({
          text: `${c.name} ${category}`,
          url: generateCityUrl(categorySlug, c.name),
          type: "city",
        }));
    });

  const relatedProfilesPromise = Product.find({
    category,
    city: { $regex: new RegExp(cityName, "i") },
    status: "approved",
    isExpired: false,
  })
    .select("title city")
    .limit(limit)
    .lean()
    .then((products) =>
      products.map((p) => ({
        text: p.title,
        url: generateProductUrl(p),
        type: "profile",
      }))
    );

  const categoryPages = Object.values(categorySlugMap)
    .filter((s) => s !== categorySlug)
    .map((slug) => ({
      text: `${slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}`,
      url: generateCityUrl(slug, cityName),
      type: "category",
    }));

  const [otherCities, relatedProfiles] = await Promise.all([otherCitiesPromise, relatedProfilesPromise]);

  return {
    otherCities,
    relatedProfiles,
    categoryPages,
  };
}

export async function getInternalLinksForProfile(product) {
  if (!product || !product.city) return { sameCity: [], sameCategory: [] };

  const categorySlug = categorySlugMap[product.category] || slugify(product.category);
  const citySlug = slugify(product.city);

  const sameCityProfilesPromise = Product.find({
    _id: { $ne: product._id },
    city: { $regex: new RegExp(product.city, "i") },
    status: "approved",
    isExpired: false,
  })
    .select("title city location")
    .limit(12)
    .lean()
    .then((products) =>
      products.map((p) => ({
        text: p.title,
        url: generateProductUrl(p),
        type: "related_profile",
      }))
    );

  const categoryCityLink = {
    text: `All ${product.category} in ${product.city}`,
    url: generateCityUrl(categorySlug, product.city),
    type: "city_page",
  };

  const [sameCityProfiles] = await Promise.all([sameCityProfilesPromise]);

  return {
    sameCityProfiles,
    categoryCityLink,
    citySlug,
    categorySlug,
  };
}

export async function getSEOBreadcrumbs(path) {
  const segments = path.split("/").filter(Boolean);
  const breadcrumbs = [{ text: "Home", url: SITE_URL }];

  if (segments.length === 0) return breadcrumbs;

  const categoryLabels = {
    "call-girls": "Call Girls",
    massage: "Massage",
    "couple-friendly": "Couple Friendly",
  };

  let currentPath = "";

  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    let label = segments[i]
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    if (categoryLabels[segments[i]]) {
      label = categoryLabels[segments[i]];
    }

    if (segments[i] === "details" || segments[i] === "profile") continue;

    if (i < segments.length - 1 && (segments[i + 1] === "details" || segments[i + 1] === "profile")) {
      continue;
    }

    if (i === segments.length - 1) {
      breadcrumbs.push({ text: label, url: null });
    } else {
      breadcrumbs.push({ text: label, url: `${SITE_URL}${currentPath}` });
    }
  }

  return breadcrumbs;
}

export async function getSEORecommendations(category, city) {
  const recommendations = [];

  const catSlug = categorySlugMap[category] || slugify(category);

  if (city) {
    const cityTitle = city.replace(/\b\w/g, (l) => l.toUpperCase());
    recommendations.push({
      type: "title",
      value: `${cityTitle} ${category} - HireMyEscort`,
    });
    recommendations.push({
      type: "description",
      value: `Find the best ${category.toLowerCase()} in ${cityTitle}. Verified independent profiles with real photos. Book now!`,
    });
    recommendations.push({
      type: "h1",
      value: `${cityTitle} ${category} Service`,
    });
  } else {
    recommendations.push({
      type: "title",
      value: `${category} - HireMyEscort`,
    });
    recommendations.push({
      type: "description",
      value: `Browse all ${category.toLowerCase()} listings across India. Verified independent escorts and call girls.`,
    });
    recommendations.push({
      type: "h1",
      value: `${category} in India`,
    });
  }

  return recommendations;
}
