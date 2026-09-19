import express, { urlencoded } from "express";
import "dotenv/config";
import connectDB from "./database/db.js";
import userRoute from "./routes/userRoute.js";
import productRoute from "./routes/productRoute.js";
import statesCitiesRoute from "./routes/statesCitiesRoute.js";
import paymentRoute from "./routes/paymentRoute.js";
import contactRoute from "./routes/contactRoute.js";
import seoRoute from "./routes/seoRoute.js";
import bannerRoute from "./routes/bannerRoute.js";
import sitemapRoute from "./routes/sitemapRoute.js";
import cors from "cors";
import startTokenCleanupJob, {
  startAdExpiryJob,
} from "./utils/tokenScheduler.js";
import { prerenderMiddleware } from "./middleware/prerenderMiddleware.js";
import { getPrerenderHtml } from "./controllers/seoController.js";

const app = express();
const PORT = process.env.PORT || 3000;


//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

// Prerender middleware for bot traffic
app.use(prerenderMiddleware);

app.use("/api/v1/user", userRoute);
app.use("/api/v1/product", productRoute);
app.use("/api/v1/location", statesCitiesRoute);
app.use("/api/v1/payment", paymentRoute);
app.use("/api/v1/contact", contactRoute);
app.use("/api/v1/seo", seoRoute);
app.use("/api/v1/banner", bannerRoute);

// Sitemap routes (served at root level for crawler access)
app.use("/", sitemapRoute);

// Direct prerender endpoint for Hostinger php proxy + Vercel rewrites.
// Supports: /prerender/*  and  /prerender?path=/call-girls/delhi
app.get(/^\/prerender(\/.*)?$/, getPrerenderHtml);

app.get("/cron-job", (req, res) => {
  console.log("✅ Cron job hit at:", new Date().toLocaleString());
  res.status(200).send("Cron job executed");
});

// http://localhost:8000/api/v1/user/register

app.listen(PORT, () => {
  connectDB();
  startTokenCleanupJob(); // Start token cleanup job
  startAdExpiryJob(); // Start ad expiry job
  console.log(`Server is listening at port:${PORT}`);
});

// Optional memory monitor for diagnosing leaks (MEMORY_MONITOR=true)
if (process.env.MEMORY_MONITOR === "true") {
  console.log("🧠 Memory monitor enabled (MEMORY_MONITOR=true)...");
  setInterval(() => {
    const m = process.memoryUsage();
    console.log("MEMORY:", JSON.stringify({
      rss: `${Math.round(m.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(m.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(m.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(m.external / 1024 / 1024)} MB`,
    }));
  }, 30 * 1000);
}
