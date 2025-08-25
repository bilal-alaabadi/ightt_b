const express = require("express");
const Products = require("./products.model");
const Reviews = require("../reviews/reviews.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();

// رفع الصور
const { uploadImages } = require("../utils/uploadImage");


router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const products = await Products.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ]
    }).limit(20);
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'فشل البحث' });
  }
});

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
    const {
      name,
      category,
      description,
      price,
      oldPrice,
      originalPrice, // جديد
      image,
      author,
      gender,
      quantity,
    } = req.body;

    if (!name || !category || !description || price === undefined || !image || !author || quantity === undefined) {
      return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
    }

    // الفئات التي تتطلب النوع (أضيفت احذية)
    const needGender = ['نظارات', 'ساعات', 'احذية'].includes(category);
    if (needGender && !gender) {
      return res.status(400).send({ message: "حقل النوع مطلوب لهذه الفئة" });
    }

    const newProduct = new Products({
      name,
      category,
      description,
      price: Number(price),
      oldPrice: oldPrice !== undefined ? Number(oldPrice) : undefined,
      originalPrice: originalPrice !== undefined ? Number(originalPrice) : undefined,
      quantity: Number(quantity),
      image,
      author,
      gender: needGender ? gender : undefined,
    });

    const savedProduct = await newProduct.save();

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
      gender,
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {};

    if (category && category !== "الكل") {
      filter.category = category;
    }

    // إضافة فلتر النوع (gender) إذا كان موجودًا ولا يساوي "الكل"
    if (gender && gender !== "الكل") {
      filter.gender = gender;
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

router.patch(
  "/update-product/:id",
  verifyToken,
  verifyAdmin,
  upload.single('image'),
  async (req, res) => {
    try {
      const productId = req.params.id;
      const isQuantityOnly = req.headers['x-quantity-only'] === 'true';

      let updateData = {
        name: req.body.name,
        category: req.body.category,
        price: req.body.price !== undefined ? Number(req.body.price) : undefined,
        oldPrice:
          req.body.oldPrice === ''
            ? null
            : req.body.oldPrice !== undefined
            ? Number(req.body.oldPrice)
            : undefined,
        originalPrice:
          req.body.originalPrice === ''
            ? null
            : req.body.originalPrice !== undefined
            ? Number(req.body.originalPrice)
            : undefined,
        description: req.body.description,
        gender: req.body.gender || null,
        quantity:
          req.body.quantity !== undefined ? Number(req.body.quantity) : undefined,
        author: req.body.author,
      };

      if (isQuantityOnly) {
        updateData = { quantity: Number(req.body.quantity) };
      } else {
        if (!updateData.name || !updateData.category || updateData.price === undefined || !updateData.description) {
          return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
        }

        // الفئات التي تتطلب النوع (أضيفت احذية)
        const needGender = ['نظارات', 'ساعات', 'احذية'].includes(updateData.category);
        if (needGender && !updateData.gender) {
          return res.status(400).send({ message: "حقل النوع مطلوب لهذه الفئة" });
        }
      }

      if (updateData.quantity !== undefined && (isNaN(updateData.quantity) || updateData.quantity < 0)) {
        return res.status(400).send({ message: "الكمية يجب أن تكون رقمًا موجبًا" });
      }
      if (updateData.price !== undefined && (isNaN(updateData.price) || updateData.price < 0)) {
        return res.status(400).send({ message: "السعر يجب أن يكون رقمًا موجبًا" });
      }
      if (updateData.oldPrice !== undefined && updateData.oldPrice !== null && (isNaN(updateData.oldPrice) || updateData.oldPrice < 0)) {
        return res.status(400).send({ message: "السعر القديم يجب أن يكون رقمًا موجبًا" });
      }
      if (updateData.originalPrice !== undefined && updateData.originalPrice !== null && (isNaN(updateData.originalPrice) || updateData.originalPrice < 0)) {
        return res.status(400).send({ message: "السعر الأصلي يجب أن يكون رقمًا موجبًا" });
      }

      if (!isQuantityOnly && req.file) {
        updateData.image = req.file.path; // لو كان عندك مصفوفة صور غيّر هذا حسب بنية التخزين لديك
      }

      Object.keys(updateData).forEach((key) => updateData[key] === undefined && delete updateData[key]);

      const updatedProduct = await Products.findByIdAndUpdate(
        productId,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!updatedProduct) {
        return res.status(404).send({ message: "المنتج غير موجود" });
      }

      res.status(200).send({
        message: isQuantityOnly ? "تم تحديث الكمية بنجاح" : "تم تحديث المنتج بنجاح",
        product: updatedProduct,
      });
    } catch (error) {
      console.error("خطأ في تحديث المنتج", error);
      const isQuantityOnly = req?.headers?.['x-quantity-only'] === 'true';
      res.status(500).send({
        message: isQuantityOnly ? "فشل تحديث الكمية" : "فشل تحديث المنتج",
        error: error.message,
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