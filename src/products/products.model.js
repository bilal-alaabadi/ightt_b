const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    gender: { type: String },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    oldPrice: { type: Number },
    quantity: { type: Number, required: true, default: 0 }, // أضف هذا الحقل
    image: { type: [String], required: true },
    rating: { type: Number, default: 0 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

const Products = mongoose.model("Product", ProductSchema);

module.exports = Products;