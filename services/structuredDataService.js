const SITE_URL = process.env.FRONTEND_URL || "https://www.hiremyescort.com";
const SITE_NAME = "HireMyEscort";

export function getOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    description: "Indian Escorts Directory - Find verified call girls and escorts across India.",
    foundingDate: "2024",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@hiremyescort.com",
    },
    sameAs: [],
  };
}

export function getWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search/location?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function getBreadcrumbSchema(items) {
  if (!items || items.length === 0) return null;

  const itemListElement = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.text,
    ...(item.url ? { item: item.url } : {}),
  }));

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}

export function getCollectionPageSchema(name, description, url, numberOfItems = 0) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems,
    },
  };
}

export function getProductSchema(product) {
  if (!product) return null;

  const url = `${SITE_URL}/${(product.category || "").toLowerCase().replace(/\s+/g, "-")}/${(product.city || "").toLowerCase().replace(/\s+/g, "-")}/${product.location ? product.location.toLowerCase().replace(/\s+/g, "-") + "/" : ""}details/${product._id}`;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: product.title,
    description: product.about?.substring(0, 200),
    provider: {
      "@type": "Person",
      name: product.title,
    },
    areaServed: {
      "@type": "City",
      name: product.city,
    },
    url,
  };

  if (product.productImg && product.productImg.length > 0) {
    schema.image = product.productImg[0].url;
  }

  return schema;
}

export function getFAQSchema(faqs) {
  if (!faqs || faqs.length === 0) return null;

  const mainEntity = faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}

export function generateStructuredDataHtml(...schemas) {
  const validSchemas = schemas.filter(Boolean);
  if (validSchemas.length === 0) return "";

  return validSchemas
    .map(
      (schema) =>
        `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`
    )
    .join("\n");
}
