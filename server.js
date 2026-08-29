import express, { urlencoded } from "express";
import "dotenv/config";
import connectDB from "./database/db.js";
import userRoute from "./routes/userRoute.js";
import productRoute from "./routes/productRoute.js";
import statesCitiesRoute from "./routes/statesCitiesRoute.js";
import paymentRoute from "./routes/paymentRoute.js";
import contactRoute from "./routes/contactRoute.js";
import seoRoute from "./routes/seoRoute.js";
import sitemapRoute from "./routes/sitemapRoute.js";
import cors from "cors";
import startTokenCleanupJob, {
  startAdExpiryJob,
} from "./utils/tokenScheduler.js";
import { prerenderMiddleware } from "./middleware/prerenderMiddleware.js";

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

// Sitemap routes (served at root level for crawler access)
app.use("/", sitemapRoute);

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
