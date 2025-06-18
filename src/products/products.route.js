const express = require("express");
const Products = require("./products.model");
const Reviews = require("../reviews/reviews.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();

// رفع الصور
const { uploadImages } = require("../utils/uploadImage");

router.post("/uploadImages", async (req, res) => {
    try {
        const { images } = req.body; // images هي مصفوفة من base64
        if (!images || !Array.isArray(images)) {
            return res.status(400).send({ message: "يجب إرسال مصفوفة من الصور" });
        }

        const uploadedUrls = await uploadImages(images);
        res.status(200).send(uploadedUrls);
    } catch (error) {
        console.error("Error uploading images:", error);
        res.status(500).send({ message: "حدث خطأ أثناء تحميل الصور" });
    }
});

// إنشاء منتج جديد
router.post("/create-product", async (req, res) => {
  try {
    const { name, category, description, price, image, author } = req.body;

    // التحقق من الحقول المطلوبة
    if (!name || !category || !description || !price || !image || !author) {
      return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
    }

    const newProduct = new Products({
      name,
      category,
      description,
      price,
      image, // يجب أن تكون مصفوفة من روابط الصور
      author,
    });

    const savedProduct = await newProduct.save();

    // حساب التقييمات إذا وجدت
    const reviews = await Reviews.find({ productId: savedProduct._id });
    if (reviews.length > 0) {
      const totalRating = reviews.reduce((acc, review) => acc + review.rating, 0);
      const averageRating = totalRating / reviews.length;
      savedProduct.rating = averageRating;
      await savedProduct.save();
    }

    res.status(201).send(savedProduct);
  } catch (error) {
    console.error("Error creating new product", error);
    res.status(500).send({ message: "فشل إنشاء المنتج" });
  }
});

// الحصول على جميع المنتجات
router.get("/", async (req, res) => {
  try {
    const {
      category,
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {};

    if (category && category !== "all") {
      filter.category = category;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalProducts = await Products.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / parseInt(limit));

    const products = await Products.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("author", "email")
      .sort({ createdAt: -1 });

    res.status(200).send({ products, totalPages, totalProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).send({ message: "فشل جلب المنتجات" });
  }
});

// الحصول على منتج واحد
router.get("/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Products.findById(productId).populate(
      "author",
      "email username"
    );
    if (!product) {
      return res.status(404).send({ message: "المنتج غير موجود" });
    }
    const reviews = await Reviews.find({ productId }).populate(
      "userId",
      "username email"
    );
    res.status(200).send({ product, reviews });
  } catch (error) {
    console.error("Error fetching the product", error);
    res.status(500).send({ message: "فشل جلب المنتج" });
  }
});

// تحديث المنتج
const multer = require('multer');
const upload = multer();
router.patch("/update-product/:id", 
  verifyToken, 
  verifyAdmin, 
  upload.single('image'), // معالجة تحميل الصورة
  async (req, res) => {
    try {
      const productId = req.params.id;
      const updateData = {
        ...req.body,
        author: req.body.author
      };

      if (req.file) {
        updateData.image = [req.file.path]; // أو أي طريقة تخزين تستخدمها للصور
      }

      const updatedProduct = await Products.findByIdAndUpdate(
        productId,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!updatedProduct) {
        return res.status(404).send({ message: "المنتج غير موجود" });
      }

      res.status(200).send({
        message: "تم تحديث المنتج بنجاح",
        product: updatedProduct,
      });
    } catch (error) {
      console.error("Error updating the product", error);
      res.status(500).send({ 
        message: "فشل تحديث المنتج",
        error: error.message
      });
    }
  }
);

// حذف المنتج
router.delete("/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const deletedProduct = await Products.findByIdAndDelete(productId);

    if (!deletedProduct) {
      return res.status(404).send({ message: "المنتج غير موجود" });
    }

    // حذف التقييمات المرتبطة بالمنتج
    await Reviews.deleteMany({ productId: productId });

    res.status(200).send({
      message: "تم حذف المنتج بنجاح",
    });
  } catch (error) {
    console.error("Error deleting the product", error);
    res.status(500).send({ message: "فشل حذف المنتج" });
  }
});

// الحصول على منتجات ذات صلة
router.get("/related/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send({ message: "معرف المنتج مطلوب" });
    }
    const product = await Products.findById(id);
    if (!product) {
      return res.status(404).send({ message: "المنتج غير موجود" });
    }

    const titleRegex = new RegExp(
      product.name
        .split(" ")
        .filter((word) => word.length > 1)
        .join("|"),
      "i"
    );

    const relatedProducts = await Products.find({
      _id: { $ne: id }, // استبعاد المنتج الحالي
      $or: [
        { name: { $regex: titleRegex } }, // مطابقة الأسماء المتشابهة
        { category: product.category }, // مطابقة نفس الفئة
      ],
    });

    res.status(200).send(relatedProducts);

  } catch (error) {
    console.error("Error fetching the related products", error);
    res.status(500).send({ message: "فشل جلب المنتجات ذات الصلة" });
  }
});

module.exports = router;