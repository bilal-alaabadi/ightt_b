const mongoose = require('mongoose');

const OrderProductSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    image: String,
    price: { type: Number, required: true },          // سعر البيع وقت إنشاء الطلب (Snapshot)
    originalPrice: { type: Number, default: 0 },      // السعر الأصلي وقت إنشاء الطلب (Snapshot)
    quantity: { type: Number, required: true },
    selectedSize: String,
    selectedColor: String,
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, unique: true, index: true },
    products: { type: [OrderProductSchema], required: true },
    amount: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    customerName: String,
    customerPhone: String,
    wilayat: String,
    email: String,
    paymentMethod: { type: String, default: 'cash' },
    notes: String,
    status: {
      type: String,
      enum: ['pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', OrderSchema);
