const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    subCategory: { type: String }, // سيحتوي على "نوع-مقاس" للكمة مثل "كمه خياطة اليد-10.5"
    description: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: [String], required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

const Products = mongoose.model("Product", ProductSchema);

module.exports = Products;