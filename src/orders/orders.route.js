// orders.routes.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const Order = require("./orders.model");
const Product = require("../products/products.model");

const router = express.Router();

const THAWANI_API_KEY = process.env.THAWANI_API_KEY;
const THAWANI_API_URL = process.env.THAWANI_API_URL;

router.use(cors({ origin: "http://localhost:5173" }));
router.use(express.json());

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getPid = (product) =>
  product?._id ||
  product?.productId ||
  product?.product?._id ||
  product?.product;

const normalizeTailoring = (tailoring) => {
  if (!tailoring) return null;

  const mode = tailoring?.mode === "detail" ? "detail" : "without";
  const fee = mode === "detail" ? toNumber(tailoring?.fee) : 0;

  const measurementsData = tailoring?.measurements;

  const measurements =
    mode === "detail" && measurementsData
      ? {
          length: toNumber(measurementsData.length),
          upperWidth: toNumber(measurementsData.upperWidth),
          lowerWidthFromTop: toNumber(
            measurementsData.lowerWidthFromTop
          ),
          neck: toNumber(measurementsData.neck),
          sleeveLength: toNumber(measurementsData.sleeveLength),
          sleeveWidth: toNumber(measurementsData.sleeveWidth),
          lastBottomWidth: toNumber(
            measurementsData.lastBottomWidth
          ),
          shoulder: toNumber(measurementsData.shoulder),
        }
      : null;

  return {
    mode,
    fee,
    measurements,
  };
};

const updateProductQuantity = async (productId, quantity) => {
  const product = await Product.findById(productId);

  if (!product) {
    throw new Error("المنتج غير موجود");
  }

  if (product.quantity < quantity) {
    throw new Error("الكمية المطلوبة غير متوفرة");
  }

  product.quantity -= quantity;
  await product.save();
};

const restoreQuantitiesFromOrder = async (order) => {
  if (!order || !Array.isArray(order.products)) return;

  for (const item of order.products) {
    if (!item.productId) continue;

    await Product.findByIdAndUpdate(item.productId, {
      $inc: {
        quantity: toNumber(item.quantity),
      },
    });
  }
};

router.post("/create-order", async (req, res) => {
  const {
    products,
    email,
    customerName,
    customerPhone,
    wilayat,
    notes,
    isAdmin,
    amount,
    shippingFee,
    discount,
  } = req.body;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      error: "يجب إضافة منتجات للطلب",
    });
  }

  if (!isAdmin) {
    if (!customerName || !customerPhone || !wilayat || !email) {
      return res.status(400).json({
        error: "جميع الحقول المطلوبة يجب إرسالها",
      });
    }
  } else if (!wilayat) {
    return res.status(400).json({
      error: "حقل الولاية مطلوب",
    });
  }

  try {
    const snapshotProducts = [];

    for (const product of products) {
      const productId = getPid(product);
      const requestedQuantity = toNumber(product.quantity);

      if (!productId) {
        return res.status(400).json({
          error: "معرّف المنتج مفقود",
        });
      }

      if (requestedQuantity <= 0) {
        return res.status(400).json({
          error: "كمية المنتج غير صحيحة",
        });
      }

      const databaseProduct = await Product.findById(productId).lean();

      if (!databaseProduct) {
        return res.status(400).json({
          error: `المنتج ${product.name || ""} غير موجود`,
        });
      }

      if (databaseProduct.quantity < requestedQuantity) {
        return res.status(400).json({
          error: `الكمية المطلوبة غير متوفرة للمنتج ${databaseProduct.name}`,
        });
      }

      snapshotProducts.push({
        productId: databaseProduct._id,
        name: databaseProduct.name,
        image: Array.isArray(databaseProduct.image)
          ? databaseProduct.image[0]
          : databaseProduct.image,
        price: toNumber(databaseProduct.price),
        originalPrice: toNumber(
          databaseProduct.originalPrice ??
            databaseProduct.oldPrice
        ),
        quantity: requestedQuantity,
        selectedSize: product.selectedSize,
        selectedColor: product.selectedColor,
        tailoring: normalizeTailoring(product.tailoring),
      });
    }

    const productsTotal = snapshotProducts.reduce(
      (total, product) =>
        total +
        toNumber(product.price) *
          toNumber(product.quantity),
      0
    );

    const safeShippingFee = Math.max(
      0,
      toNumber(shippingFee)
    );

    const maximumDiscount =
      productsTotal + safeShippingFee;

    const safeDiscount = Math.min(
      Math.max(0, toNumber(discount)),
      maximumDiscount
    );

    const calculatedAmount = Math.max(
      0,
      maximumDiscount - safeDiscount
    );

    const submittedAmount = toNumber(amount);

    const finalAmount =
      Math.abs(submittedAmount - calculatedAmount) < 0.01
        ? submittedAmount
        : calculatedAmount;

    const order = new Order({
      orderId: `ORD-${Date.now()}`,
      products: snapshotProducts,
      amount: finalAmount,
      shippingFee: safeShippingFee,
      discount: safeDiscount,
      customerName,
      customerPhone,
      wilayat,
      email,
      paymentMethod: "cash",
      notes,
      status: "pending",
    });

    await order.save();

    for (const product of snapshotProducts) {
      await updateProductQuantity(
        product.productId,
        product.quantity
      );
    }

    return res.status(201).json({
      message: "تم إنشاء الطلب بنجاح",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      error: "فشل إنشاء الطلب",
      details: error.message,
    });
  }
});

router.post("/cancel-order/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        error: "الطلب غير موجود",
      });
    }

    if (order.status !== "cancelled") {
      await restoreQuantitiesFromOrder(order);
    }

    order.status = "cancelled";
    await order.save();

    return res.status(200).json({
      message:
        "تم إلغاء الطلب واستعادة الكميات بنجاح",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      error: "فشل في إلغاء الطلب",
      details: error.message,
    });
  }
});

router.post("/confirm-payment", async (req, res) => {
  const { client_reference_id } = req.body;

  if (!client_reference_id) {
    return res.status(400).json({
      error: "Session ID is required",
    });
  }

  try {
    const sessionsResponse = await axios.get(
      `${THAWANI_API_URL}/checkout/session/?limit=10&skip=0`,
      {
        headers: {
          "Content-Type": "application/json",
          "thawani-api-key": THAWANI_API_KEY,
        },
      }
    );

    const sessions = sessionsResponse.data.data || [];

    const foundSession = sessions.find(
      (session) =>
        session.client_reference_id ===
        client_reference_id
    );

    if (!foundSession) {
      return res.status(404).json({
        error: "Session not found",
      });
    }

    const response = await axios.get(
      `${THAWANI_API_URL}/checkout/session/${foundSession.session_id}?limit=1&skip=0`,
      {
        headers: {
          "Content-Type": "application/json",
          "thawani-api-key": THAWANI_API_KEY,
        },
      }
    );

    const session = response.data.data;

    if (
      !session ||
      session.payment_status !== "paid"
    ) {
      return res.status(400).json({
        error:
          "Payment not successful or session not found",
      });
    }

    let order = await Order.findOne({
      orderId: foundSession.session_id,
    });

    if (!order) {
      order = new Order({
        orderId: foundSession.session_id,
        products: session.products.map((item) => ({
          productId: item.productId,
          name: item.name,
          image: item.image,
          price: toNumber(item.price),
          originalPrice: toNumber(
            item.originalPrice
          ),
          quantity: toNumber(item.quantity),
        })),
        amount: toNumber(session.total_amount) / 1000,
        shippingFee: 0,
        discount: 0,
        status:
          session.payment_status === "paid"
            ? "completed"
            : "pending",
      });
    } else {
      order.status =
        session.payment_status === "paid"
          ? "completed"
          : "pending";
    }

    await order.save();

    return res.json({ order });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to confirm payment",
      details: error.message,
    });
  }
});

router.get("/order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).send({
        message: "Order not found",
      });
    }

    return res.status(200).send(order);
  } catch (error) {
    return res.status(500).send({
      message: "Failed to fetch order",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .populate({
        path: "products.productId",
        select: "name price originalPrice image",
        model: "Product",
      });

    const formattedOrders = orders.map((order) => ({
      ...order.toObject(),
      products: order.products.map((item) => {
        const product = item.toObject();

        return {
          ...product,
          name:
            product.name ||
            product.productId?.name ||
            "منتج غير محدد",
          price:
            product.price ??
            product.productId?.price ??
            0,
          originalPrice:
            product.originalPrice ??
            product.productId?.originalPrice ??
            0,
          image:
            product.image ||
            product.productId?.image ||
            "https://via.placeholder.com/150",
          selectedSize: product.selectedSize,
          selectedColor: product.selectedColor,
          tailoring: product.tailoring || null,
        };
      }),
    }));

    return res.status(200).send(formattedOrders);
  } catch (error) {
    return res.status(500).send({
      message: "Failed to fetch all orders",
    });
  }
});

router.get("/:email", async (req, res) => {
  const email = req.params.email;

  if (!email) {
    return res.status(400).send({
      message: "Email is required",
    });
  }

  try {
    const orders = await Order.find({ email }).sort({
      createdAt: -1,
    });

    return res.status(200).send({ orders });
  } catch (error) {
    return res.status(500).send({
      message: "Failed to fetch orders by email",
    });
  }
});

router.patch(
  "/update-order-status/:id",
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).send({
        message: "Status is required",
      });
    }

    try {
      const updatedOrder =
        await Order.findByIdAndUpdate(
          id,
          {
            status,
            updatedAt: new Date(),
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (!updatedOrder) {
        return res.status(404).send({
          message: "Order not found",
        });
      }

      return res.status(200).json({
        message:
          "Order status updated successfully",
        order: updatedOrder,
      });
    } catch (error) {
      return res.status(500).send({
        message:
          "Failed to update order status",
      });
    }
  }
);

router.delete("/delete-order/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (order.status !== "cancelled") {
      await restoreQuantitiesFromOrder(order);
    }

    await Order.findByIdAndDelete(id);

    return res.status(200).json({
      message:
        "تم حذف الطلب وإرجاع الكمية بنجاح",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete order",
      error: error.message,
    });
  }
});

module.exports = router;
