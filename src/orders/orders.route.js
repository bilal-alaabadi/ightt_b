// src/orders/orders.route.js
const express = require("express");
const cors = require("cors");
const Order = require("./orders.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();
const axios = require("axios");
require("dotenv").config();
const Product = require("../products/products.model");

const THAWANI_API_KEY = process.env.THAWANI_API_KEY; 
const THAWANI_API_URL = process.env.THAWANI_API_URL;
const publish_key = "HGvTMLDssJghr9tlN9gr4DVYt0qyBy";

// لا داعي لإنشاء app داخل ملف الراوتر عادةً، لكن إن رغبت بالإبقاء:
const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ---- Helpers ----
const updateProductQuantity = async (productId, quantity) => {
  try {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error("المنتج غير موجود");
    }
    if (product.quantity < quantity) {
      throw new Error("الكمية المطلوبة غير متوفرة");
    }
    product.quantity -= quantity;
    await product.save();
    return product;
  } catch (error) {
    console.error("Error updating product quantity:", error);
    throw error;
  }
};

// استرجاع كميات المنتجات من سجل الطلب
async function restoreQuantitiesFromOrder(order) {
  if (!order || !Array.isArray(order.products)) return 0;

  const ops = [];
  for (const item of order.products) {
    const pid =
      item?.productId?._id ||   // populated
      item?.productId ||        // ObjectId
      item?.product?._id ||     // أحيانًا محفوظ كائن product
      null;
    const qty = Number(item?.quantity ?? item?.qty ?? 0);

    if (!pid || !qty || qty <= 0) continue;

    ops.push({
      updateOne: {
        filter: { _id: pid },
        update: { $inc: { quantity: qty } }, // رجّع الكمية
      },
    });
  }

  if (ops.length > 0) {
    await Product.bulkWrite(ops);
  }
  return ops.length;
}

// ---- Routes ----

// إنشاء طلب (دفع نقدًا / من لوحة الإدارة)
router.post("/create-order", async (req, res) => {
  const { products, email, customerName, customerPhone, wilayat, notes, isAdmin } = req.body;

  // مسجّل (admin/user) => 0، غير مسجّل => 2
  const shippingFee = isAdmin ? 0 : 2;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "يجب إضافة منتجات للطلب" });
  }

  if (!isAdmin) {
    if (!customerName || !customerPhone || !wilayat || !email) {
      return res.status(400).json({ error: "جميع الحقول المطلوبة يجب إرسالها" });
    }
  } else {
    if (!wilayat) {
      return res.status(400).json({ error: "حقل الولاية مطلوب" });
    }
  }

  try {
    const snapshotProducts = [];

    // التحقق من الكميات وتجهيز Snapshot للأسعار
    for (const p of products) {
      const dbProduct = await Product.findById(p._id).lean();
      if (!dbProduct) {
        return res.status(400).json({ error: `المنتج ${p.name || ""} غير موجود` });
      }
      if (dbProduct.quantity < p.quantity) {
        return res.status(400).json({
          error: `الكمية المطلوبة غير متوفرة للمنتج ${dbProduct.name} (المتبقي: ${dbProduct.quantity})`,
        });
      }

      snapshotProducts.push({
        productId: dbProduct._id,
        name: dbProduct.name,
        image: Array.isArray(dbProduct.image) ? dbProduct.image[0] : dbProduct.image,
        price: Number(dbProduct.price) || 0,                 // تثبيت سعر البيع
        originalPrice: Number(dbProduct.originalPrice) || 0, // تثبيت السعر الأصلي
        quantity: Number(p.quantity) || 0,
        selectedSize: p.selectedSize || undefined,
        selectedColor: p.selectedColor || undefined,
      });
    }

    // الحساب من Snapshot فقط
    const subtotal = snapshotProducts.reduce((t, it) => t + it.price * it.quantity, 0);
    const totalAmount = subtotal + shippingFee;

    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const order = new Order({
      orderId,
      products: snapshotProducts,
      amount: totalAmount,
      shippingFee,
      customerName: isAdmin ? customerName || "Admin Order" : customerName,
      customerPhone: isAdmin ? customerPhone || "00000000" : customerPhone,
      wilayat,
      email,
      paymentMethod: "cash",
      notes,
      status: "pending",
    });

    await order.save();

    // خصم الكميات
    for (const p of products) {
      await updateProductQuantity(p._id, p.quantity);
    }

    res.status(201).json({ message: "تم إنشاء الطلب بنجاح", order, paymentMethod: "cash" });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "فشل إنشاء الطلب", details: error.message });
  }
});

// إنشاء جلسة دفع Thawani
router.post("/create-checkout-session", async (req, res) => {
  const { products, email, customerName, customerPhone, wilayat } = req.body;
  const shippingFee = 2; // رسوم الشحن الثابتة

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "Invalid or empty products array" });
  }

  try {
    // التحقق من توفر الكميات أولاً
    for (const product of products) {
      const dbProduct = await Product.findById(product._id);
      if (!dbProduct) {
        return res.status(400).json({ error: `المنتج ${product.name} غير موجود` });
      }
      if (dbProduct.quantity < product.quantity) {
        return res.status(400).json({
          error: `الكمية المطلوبة غير متوفرة للمنتج ${product.name} (المتبقي: ${dbProduct.quantity})`,
        });
      }
    }

    // حساب المبلغ الإجمالي
    const subtotal = products.reduce((total, product) => total + product.price * product.quantity, 0);
    const totalAmount = subtotal + shippingFee;

    const lineItems = products.map((product) => ({
      name: product.name,
      productId: product._id,
      quantity: product.quantity,
      unit_amount: Math.round(product.price * 1000), // بيسة
    }));

    // رسوم الشحن كعنصر منفصل
    lineItems.push({
      name: "رسوم الشحن",
      quantity: 1,
      unit_amount: Math.round(shippingFee * 1000),
    });

    const client_reference_id = Date.now().toString();
    const data = {
      client_reference_id,
      mode: "payment",
      products: lineItems,
      success_url: `http://localhost:5173/success?client_reference_id=${client_reference_id}`,
      cancel_url: "http://localhost:5173/cancel",
    };

    const response = await axios.post(`${THAWANI_API_URL}/checkout/session`, data, {
      headers: {
        "Content-Type": "application/json",
        "thawani-api-key": THAWANI_API_KEY,
      },
    });

    const sessionId = response.data.data.session_id;
    const paymentLink = `https://uatcheckout.thawani.om/pay/${sessionId}?key=${publish_key}`;

    // حفظ الطلب
    const order = new Order({
      orderId: sessionId,
      products: products.map((product) => ({
        productId: product._id,
        quantity: product.quantity,
      })),
      amount: totalAmount,
      shippingFee,
      customerName,
      customerPhone,
      wilayat,
      email,
      status: "pending",
    });

    await order.save();

    // خصم الكميات
    for (const product of products) {
      await updateProductQuantity(product._id, product.quantity);
    }

    res.json({ id: sessionId, paymentLink });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error.message,
    });
  }
});

// إلغاء الطلب (استرجاع الكميات + تحديث الحالة)
router.post("/cancel-order/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: "الطلب غير موجود" });
    }

    // استعادة كميات المنتجات
    await restoreQuantitiesFromOrder(order);

    // تحديث حالة الطلب إلى "ملغى"
    order.status = "cancelled";
    await order.save();

    res.status(200).json({
      message: "تم إلغاء الطلب واستعادة الكميات بنجاح",
      order,
    });
  } catch (error) {
    console.error("Error cancelling order:", error);
    res.status(500).json({
      error: "فشل في إلغاء الطلب",
      details: error.message,
    });
  }
});

// تأكيد الدفع مع Thawani
router.post("/confirm-payment", async (req, res) => {
  const { client_reference_id } = req.body;

  if (!client_reference_id) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  try {
    // sessions list
    const sessionsResponse = await axios.get(`${THAWANI_API_URL}/checkout/session/?limit=10&skip=0`, {
      headers: {
        "Content-Type": "application/json",
        "thawani-api-key": THAWANI_API_KEY,
      },
    });

    const sessions = sessionsResponse.data.data || [];
    const session_ = sessions.find((s) => s.client_reference_id === client_reference_id);

    if (!session_) {
      return res.status(404).json({ error: "Session not found" });
    }

    const session_id = session_.session_id;

    const response = await axios.get(`${THAWANI_API_URL}/checkout/session/${session_id}?limit=1&skip=0`, {
      headers: {
        "Content-Type": "application/json",
        "thawani-api-key": THAWANI_API_KEY,
      },
    });

    const session = response.data.data;
    if (!session || session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment not successful or session not found" });
    }

    let order = await Order.findOne({ orderId: session_id });

    if (!order) {
      order = new Order({
        orderId: session_id,
        products: session.products.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        amount: session.total_amount / 1000, // من بيسة إلى ر.ع
        status: session.payment_status === "paid" ? "completed" : "failed",
      });
    } else {
      order.status = session.payment_status === "paid" ? "completed" : "failed";
    }

    await order.save();

    res.json({ order });
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({ error: "Failed to confirm payment", details: error.message });
  }
});

// جلب الطلبات بالبريد
router.get("/:email", async (req, res) => {
  const email = req.params.email;

  if (!email) {
    return res.status(400).send({ message: "Email is required" });
  }

  try {
    const orders = await Order.find({ email });
    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found for this email" });
    }
    res.status(200).send({ orders });
  } catch (error) {
    console.error("Error fetching orders by email:", error);
    res.status(500).send({ message: "Failed to fetch orders by email" });
  }
});

// جلب طلب واحد بالمعرّف
router.get("/order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }
    res.status(200).send(order);
  } catch (error) {
    console.error("Error fetching orders by user id", error);
    res.status(500).send({ message: "Failed to fetch orders by user id" });
  }
});

// جلب كل الطلبات (مع populate)
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).populate({
      path: "products.productId",
      select: "name price image",
      model: "Product",
    });

    const formattedOrders = orders.map((order) => ({
      ...order._doc,
      products: order.products.map((item) => ({
        ...item._doc,
        name: item.productId?.name || item.name || "منتج غير محدد",
        price: item.productId?.price || item.price || 0,
        image: item.productId?.image || item.image || "https://via.placeholder.com/150",
        selectedSize: item.selectedSize,
      })),
    }));

    if (formattedOrders.length === 0) {
      return res.status(404).send({ message: "No orders found", orders: [] });
    }

    res.status(200).send(formattedOrders);
  } catch (error) {
    console.error("Error fetching all orders", error);
    res.status(500).send({ message: "Failed to fetch all orders" });
  }
});

// تحديث حالة الطلب
router.patch("/update-order-status/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).send({ message: "Status is required" });
  }

  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).send({ message: "Order not found" });
    }

    res.status(200).json({
      message: "Order status updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order status", error);
    res.status(500).send({ message: "Failed to update order status" });
  }
});

// 🔁 حذف طلب + إعادة الكميات للمخزون (مع منع الازدواجية إذا كان الطلب مُلغى مسبقًا)
router.delete("/delete-order/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1) احضر الطلب
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }

    // 2) إذا لم يكن "ملغى" مسبقًا، ارجع الكميات
    if (order.status !== "cancelled") {
      await restoreQuantitiesFromOrder(order);
    }

    // 3) احذف الطلب
    await Order.findByIdAndDelete(id);

    return res.status(200).json({
      message:
        order.status === "cancelled"
          ? "تم حذف الطلب (الكميات كانت مُستعادة مسبقًا)"
          : "تم حذف الطلب وإرجاع الكميات للمخزون",
    });
  } catch (error) {
    console.error("Error deleting order", error);
    res.status(500).send({ message: "Failed to delete order", error: error.message });
  }
});

module.exports = router;
