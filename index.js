const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const app = express();
const path = require("path");
require("dotenv").config();
const cookieParser = require("cookie-parser");
const port = 5003;

// Middleware لمعالجة البيانات
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(cookieParser());

// Enhanced CORS configuration
const allowedOrigins = [
  "https://www.lightoman.shop",
  "https://lightoman.shop",
  "http://localhost:3000" // لأغراض التطوير
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  exposedHeaders: ["Content-Range", "X-Total-Count"]
};

app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options("*", cors(corsOptions));

// Routes
const authRoutes = require("./src/users/user.route");
const productRoutes = require("./src/products/products.route");
const reviewRoutes = require("./src/reviews/reviews.router");
const orderRoutes = require("./src/orders/orders.route");
const statsRoutes = require("./src/stats/stats.rout");

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/stats", statsRoutes);

// Database connection
async function main() {
  try {
    await mongoose.connect(process.env.DB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

main();

// Basic route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Image upload endpoints
const uploadImage = require("./src/utils/uploadImage");

app.post("/uploadImage", (req, res) => {
  uploadImage(req.body.image)
    .then((url) => res.send(url))
    .catch((err) => res.status(500).send(err));
});

app.post("/uploadImages", async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images)) {
      return res.status(400).send("Invalid request: images array is required");
    }

    const uploadPromises = images.map((image) => uploadImage(image));
    const urls = await Promise.all(uploadPromises);
    res.send(urls);
  } catch (error) {
    console.error("Error uploading images:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});