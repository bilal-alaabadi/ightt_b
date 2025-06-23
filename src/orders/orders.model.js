const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    products: [
      {
        productId: { type: String, required: true },
        quantity: { type: Number, required: true },
        selectedSize: { type: String } // إضافة الحجم المحدد إذا كان منتج حناء بودر
      },
    ],
    amount: { type: Number, required: true },
    shippingFee: { type: Number, required: true, default: 2 },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    wilayat: { type: String, required: true },
    email: { type: String, required: true },
    paymentMethod: { 
      type: String, 
      enum: ["cash", "online"], 
      default: "cash" 
    },
    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "completed", "cancelled"],
      default: "pending",
    },
    notes: { type: String } // ملاحظات إضافية
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", OrderSchema);
module.exports = Order;