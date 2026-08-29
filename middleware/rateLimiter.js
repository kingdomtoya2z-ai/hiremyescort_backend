import rateLimit from "express-rate-limit";

// General API rate limiter - 100 requests per 15 minutes
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for cron jobs
    if (req.path === "/cron-job") return true;
    return false;
  },
});

// Stricter rate limiter for auth endpoints - 5 requests per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message:
    "Too many authentication attempts, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for coin operations - 20 requests per 5 minutes
export const coinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: "Too many coin operations, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for ad operations - 30 requests per 5 minutes
export const adLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: "Too many ad operations, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});
