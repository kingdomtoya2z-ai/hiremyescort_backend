import express from "express";
import { sendContactEmail } from "../controllers/contactController.js";

const router = express.Router();

// Send contact form email
router.post("/send-email", sendContactEmail);

export default router;
