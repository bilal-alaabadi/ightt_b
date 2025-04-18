const express = require("express");
const Products = require("./products.model");
const Reviews = require("../reviews/reviews.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();

// post a product
const { uploadImages } = require("../utils/uploadImage");


const validMassarTypes = {
  smallPattern: ['مصار باشمينا صغيرة', 'مصار سوبر تورمة صغيرة', 'مصار نص تورمة صغيرة'],
  largePattern: ['مصار باشمينا كبيرة', 'مصار سوبر تورمة كبيرة', 'مصار نص تورمة كبيرة']
};
const validKumaTypes = ['كمه خياطة اليد', 'كمه ديواني'];
const validKumaSizes = ['9.5', '9.75', '10', '10.25', '10.5', '10.75', '11', '11.25', '11.5', '11.75'];

router.post("/uploadImages", async (req, res) => {
  try {
      const { images } = req.body;
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


// نقطة النهاية لإنشاء منتج
router.post("/create-product", async (req, res) => {
  try {
    const { name, category, subCategory, description, price, image, author } = req.body;

    // تحقق من الحقول المطلوبة
    if (!name || !category || !description || !price || !image || !author) {
      return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
    }

    // تحقق من صحة السعر
    const priceNum = parseFloat(price);
    if (isNaN(priceNum)) {
      return res.status(400).send({ message: "السعر يجب أن يكون رقماً" });
    }

    // تحقق من النوع الفرعي إذا كانت الفئة "كمه"
    if (category === "كمه") {
      if (!subCategory) {
          return res.status(400).send({ message: "نوع الكمه مطلوب" });
      }
      
      // تحقق مما إذا كان subCategory يحتوي على مقاس
      const hasSize = validKumaSizes.some(size => subCategory.includes(size));
      
      if (hasSize) {
          // إذا كان يحتوي على مقاس، نتحقق من النوع الأساسي
          const baseType = subCategory.split('-')[0];
          if (!validKumaTypes.includes(baseType)) {
              return res.status(400).send({ message: "نوع الكمه غير صالح" });
          }
      } else {
          // إذا لم يكن يحتوي على مقاس، نتحقق من النوع الأساسي فقط
          if (!validKumaTypes.includes(subCategory)) {
              return res.status(400).send({ message: "نوع الكمه غير صالح" });
          }
      }
    }
    
    // تحقق من النوع الفرعي إذا كانت الفئة "مصار"
    if (category === "مصار") {
      if (!subCategory) {
        return res.status(400).send({ message: "النوع الفرعي مطلوب لمنتجات المصار" });
      }
      
      const isValidSubCategory = Object.values(validMassarTypes)
        .flat()
        .includes(subCategory);
      
      if (!isValidSubCategory) {
        return res.status(400).send({ message: "النوع الفرعي غير صالح" });
      }
    }

    const newProduct = new Products({
      name,
      category,
      ...(subCategory && { subCategory }),
      description,
      price: priceNum,
      image,
      author
    });

    const savedProduct = await newProduct.save();
    res.status(201).send(savedProduct);
  } catch (error) {
    console.error("Error creating new product", error);
    res.status(500).send({ message: "Failed to create new product" });
  }
});

// get all products
// في نقطة النهاية /get all products
router.get("/", async (req, res) => {
  try {
    const {
      category,
      subCategory,
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {};

    if (category && category !== "all") {
      filter.category = category;
      
      if (category === "كمه" && subCategory) {
        // إذا كانت subCategory تحتوي على مقاس (مثل "كمه خياطة اليد-10.5")
        if (subCategory.includes('-')) {
          const [baseType, size] = subCategory.split('-');
          if (validKumaTypes.includes(baseType) && validKumaSizes.includes(size)) {
            filter.subCategory = { $regex: subCategory };
          }
        } else {
          // إذا كانت subCategory لا تحتوي على مقاس
          if (validKumaTypes.includes(subCategory)) {
            filter.subCategory = { $regex: `^${subCategory}` };
          }
        }
      }
      
      // تطبيق فلترة النوع الفرعي إذا كانت الفئة "مصار"
      if (category === "مصار" && subCategory) {
        // فلترة حسب النقشة العامة أو النوع الفرعي
        if (subCategory.includes('نقشة')) {
          // إذا كانت فلترة عامة (مصار بالنقشة الصغيرة/الكبيرة)
          filter.subCategory = { $regex: subCategory.includes('صغيرة') ? 'صغيرة' : 'كبيرة' };
        } else {
          // إذا كانت فلترة نوع فرعي محدد
          filter.subCategory = subCategory;
        }
      }
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
    res.status(500).send({ message: "Failed to fetch products" });
  }
});

//   get single Product
router.get("/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Products.findById(productId).populate(
      "author",
      "email username"
    );
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    const reviews = await Reviews.find({ productId }).populate(
      "userId",
      "username email"
    );
    res.status(200).send({ product, reviews });
  } catch (error) {
    console.error("Error fetching the product", error);
    res.status(500).send({ message: "Failed to fetch the product" });
  }
});

// update a product
router.patch("/update-product/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const { category, subCategory, ...rest } = req.body;

    if (category === "كمه" && subCategory) {
      if (subCategory.includes('-')) {
        const [baseType, size] = subCategory.split('-');
        if (!validKumaTypes.includes(baseType) || !validKumaSizes.includes(size)) {
          return res.status(400).send({ message: "نوع الكمه أو المقاس غير صالح" });
        }
      } else if (!validKumaTypes.includes(subCategory)) {
        return res.status(400).send({ message: "نوع الكمه غير صالح" });
      }
    }

    if (category === "مصار" && subCategory) {
      const isValidSubCategory = Object.values(validMassarTypes)
        .flat()
        .includes(subCategory);
      if (!isValidSubCategory) {
        return res.status(400).send({ message: "النوع الفرعي غير صالح" });
      }
    }

    const updateData = { 
      ...rest,
      ...(category && { category }),
      ...(subCategory && { subCategory })
    };

    const updatedProduct = await Products.findByIdAndUpdate(
      productId,
      updateData,
      { new: true }
    );

    if (!updatedProduct) {
      return res.status(404).send({ message: "المنتج غير موجود" });
    }

    res.status(200).send({
      message: "تم تحديث المنتج بنجاح",
      product: updatedProduct,
    });
  } catch (error) {
    console.error("خطأ في تحديث المنتج", error);
    res.status(500).send({ message: "فشل في تحديث المنتج" });
  }
});


// delete a product
router.delete("/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const deletedProduct = await Products.findByIdAndDelete(productId);

    if (!deletedProduct) {
      return res.status(404).send({ message: "Product not found" });
    }

    // delete reviews related to the product
    await Reviews.deleteMany({ productId: productId });

    res.status(200).send({
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting the product", error);
    res.status(500).send({ message: "Failed to delete the product" });
  }
});

// get related products
router.get("/related/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send({ message: "Product ID is required" });
    }
    const product = await Products.findById(id);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }

    const titleRegex = new RegExp(
      product.name
        .split(" ")
        .filter((word) => word.length > 1)
        .join("|"),
      "i"
    );

    const relatedProducts = await Products.find({
      _id: { $ne: id },
      $or: [
        { name: { $regex: titleRegex } },
        { category: product.category },
      ],
    });

    res.status(200).send(relatedProducts);

  } catch (error) {
    console.error("Error fetching the related products", error);
    res.status(500).send({ message: "Failed to fetch related products" });
  }
});

module.exports = router;