const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const app = express();
const path = require("path");
require("dotenv").config();
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const port = process.env.PORT || 5000;

// Middleware setup
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// تكوين CORS محسن
app.use(
  cors({
    origin: [
      "https://genuine-front-rho.vercel.app",
      "http://localhost:3000" // للتطوير المحلي
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
  })
);

// معالجة طلبات OPTIONS (Preflight)
app.options('*', cors());
// const express = require("express");
// const cors = require("cors");

// تكوين CORS شامل
app.use(cors({
  origin: [
    "https://genuine-front-rho.vercel.app",
    "https://genuine-backend.vercel.app",
    "http://localhost:3000"
  ],
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization,X-Requested-With",
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// معالجة طلبات OPTIONS يدوياً
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "https://genuine-front-rho.vercel.app");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.status(204).send();
});

// باقي إعدادات الخادم...
// middleware لتسجيل الطلبات
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// رفع الصور
const uploadImage = require("./src/utils/uploadImage");

// جميع الروابط
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

// الاتصال بقاعدة البيانات مع تحسينات
async function main() {
  try {
    await mongoose.connect(process.env.DB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    console.log("MongoDB is successfully connected.");

    app.get("/", (req, res) => {
      res.send("Server is running successfully");
    });
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

// رفع صورة واحدة
app.post("/uploadImage", (req, res) => {
  uploadImage(req.body.image)
    .then((url) => res.send(url))
    .catch((err) => {
      console.error("Image upload error:", err);
      res.status(500).send(err);
    });
});

// رفع عدة صور
app.post("/uploadImages", async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images)) {
      return res.status(400).send("Invalid request: images array is required.");
    }

    const uploadPromises = images.map((image) => uploadImage(image));
    const urls = await Promise.all(uploadPromises);

    res.send(urls);
  } catch (error) {
    console.error("Error uploading images:", error);
    res.status(500).send("Internal Server Error");
  }
});

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message
  });
});

// تشغيل الخادم مع زيادة المهلة
const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// زيادة مهلة الاستجابة إلى 30 ثانية
server.timeout = 30000;