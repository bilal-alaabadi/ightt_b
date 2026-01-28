// orders.model.js
const mongoose = require('mongoose');

const TailoringMeasurementsSchema = new mongoose.Schema(
  {
    length: { type: Number, default: 0 },
    upperWidth: { type: Number, default: 0 },
    lowerWidthFromTop: { type: Number, default: 0 },
    neck: { type: Number, default: 0 },
    sleeveLength: { type: Number, default: 0 },
    sleeveWidth: { type: Number, default: 0 },
    lastBottomWidth: { type: Number, default: 0 },
    shoulder: { type: Number, default: 0 },
  },
  { _id: false }
);

const TailoringSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['detail', 'without'], default: 'without' },
    fee: { type: Number, default: 0 },
    measurements: { type: TailoringMeasurementsSchema, default: null },
  },
  { _id: false }
);

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

    // ✅ حفظ بيانات التفصيل/القياسات إن وُجدت
    tailoring: { type: TailoringSchema, default: null },
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
