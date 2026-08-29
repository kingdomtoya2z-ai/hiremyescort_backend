import { Router } from "express";
import {
  generateSitemapIndexXml,
  generateCitiesSitemap,
  generateCategoriesSitemap,
  generateLocationsSitemap,
  generateProfilesSitemap,
  generatePagesSitemap,
} from "../services/sitemapGenerator.js";

const router = Router();

router.get("/sitemap.xml", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("X-Robots-Tag", "index, follow");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const xml = await generateSitemapIndexXml();
    res.send(xml);
  } catch (error) {
    console.error("Sitemap index generation error:", error);
    res.status(500).send("Sitemap generation failed");
  }
});

router.get("/sitemap-categories.xml", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const xml = await generateCategoriesSitemap();
    res.send(xml);
  } catch (error) {
    console.error("Categories sitemap error:", error);
    res.status(500).send("Sitemap generation failed");
  }
});

router.get("/sitemap-cities-:page.xml", async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const { xml, total, pages } = await generateCitiesSitemap(page - 1);
    if (page > pages) {
      return res.status(404).send("Sitemap page not found");
    }
    res.send(xml);
  } catch (error) {
    console.error("Cities sitemap error:", error);
    res.status(500).send("Sitemap generation failed");
  }
});

router.get("/sitemap-locations-:page.xml", async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const { xml, total, pages } = await generateLocationsSitemap(page - 1);
    if (page > pages) {
      return res.status(404).send("Sitemap page not found");
    }
    res.send(xml);
  } catch (error) {
    console.error("Locations sitemap error:", error);
    res.status(500).send("Sitemap generation failed");
  }
});

router.get("/sitemap-profiles-:page.xml", async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const { xml, total, pages } = await generateProfilesSitemap(page - 1);
    if (page > pages) {
      return res.status(404).send("Sitemap page not found");
    }
    res.send(xml);
  } catch (error) {
    console.error("Profiles sitemap error:", error);
    res.status(500).send("Sitemap generation failed");
  }
});

router.get("/sitemap-pages.xml", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const xml = await generatePagesSitemap();
    res.send(xml);
  } catch (error) {
    console.error("Pages sitemap error:", error);
    res.status(500).send("Sitemap generation failed");
  }
});

export default router;
