const express = require("express");
const Order = require("./orders.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// const nodemailer = require("nodemailer");
const axios = require('axios');

// // إعداد nodemailer
// const transporter = nodemailer.createTransport({
//     service: 'gmail', // يمكنك استخدام أي خدمة أخرى مثل Outlook أو Yahoo
//     auth: {
//         user: process.env.EMAIL_USER, // البريد الإلكتروني الخاص بك
//         pass: process.env.EMAIL_PASS, // كلمة المرور الخاصة بالبريد الإلكتروني
//     },
// });


// create checkout session

// ثوابت API ثواني
const THAWANI_API_URL = 'https://uatcheckout.thawani.om/api/v1';
const THAWANI_API_KEY = 'rRQ26GcsZzoEhbrP2HZvLYDbn9C9et'; // استبدل بالمفتاح الخاص بك

// إنشاء جلسة دفع
router.post("/create-checkout-session", async (req, res) => {
    const { products, province, wilayat, streetAddress, phone, email, orderNotes } = req.body;

    console.log("Products received in server:", JSON.stringify(products, null, 2));

    if (!products || products.length === 0) {
        return res.status(400).json({ error: "No products found in the request" });
    }

    try {
        // تحضير البيانات لإرسالها إلى ثواني
        const lineItems = products.map((product) => ({
            name: product.name,
            quantity: product.quantity,
            unit_amount: Math.round(product.price * 1000), // السعر بالبيسة (1000 بيسة = 1 ريال عماني)
        }));

        const data = {
            client_reference_id: Date.now().toString(), // معرف فريد للطلب
            mode: 'payment',
            products: lineItems,
            success_url: "http://localhost:5173/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "http://localhost:5173/cancel",
        };

        // إنشاء جلسة دفع عبر ثواني
        const response = await axios.post(`${THAWANI_API_URL}/checkout/session`, data, {
            headers: {
                'Content-Type': 'application/json',
                'thawani-api-key': THAWANI_API_KEY,
            },
        });

        const sessionId = response.data.data.session_id;
        const paymentLink = `https://uatcheckout.thawani.om/pay/${sessionId}?key=${THAWANI_API_KEY}`;

        console.log("Thawani session created:", sessionId);

        // إنشاء الطلب وحفظه في قاعدة البيانات
        const order = new Order({
            orderId: sessionId, // استخدام معرف الجلسة كمعرف للطلب
            products: products.map((product) => ({
                productId: product._id, // استخدام _id بدلاً من id
                quantity: product.quantity,
            })),
            amount: products.reduce((total, product) => total + product.price * product.quantity, 0), // حساب المبلغ الإجمالي
            status: "pending", // الحالة الافتراضية
        });

        await order.save(); // حفظ الطلب في قاعدة البيانات
        console.log("Order saved to database:", order);

        res.json({ id: sessionId, paymentLink });
    } catch (error) {
        console.error("Error creating checkout session or saving order:", error);
        res.status(500).json({ error: "Failed to create checkout session or save order", details: error.message });
    }
});

// تأكيد الدفع
router.post("/confirm-payment", async (req, res) => {
    const { session_id } = req.body;

    if (!session_id) {
        console.error("Session ID is required");
        return res.status(400).json({ error: "Session ID is required" });
    }

    try {
        // استرجاع بيانات الجلسة من ثواني
        const response = await axios.get(`${THAWANI_API_URL}/checkout/session/${session_id}`, {
            headers: {
                'Content-Type': 'application/json',
                'thawani-api-key': THAWANI_API_KEY,
            },
        });

        const session = response.data.data;

        if (!session || session.status !== 'paid') {
            console.error("Payment not successful or session not found");
            return res.status(400).json({ error: "Payment not successful or session not found" });
        }

        // البحث عن الطلب في قاعدة البيانات
        let order = await Order.findOne({ orderId: session_id });

        if (!order) {
            // إنشاء طلب جديد إذا لم يتم العثور عليه
            const lineItems = session.products.map((item) => ({
                productId: item.product_id, // استخدام معرف المنتج من ثواني
                quantity: item.quantity,
            }));

            const amount = session.amount_total / 1000; // تحويل المبلغ من البيسة إلى الريال العماني

            order = new Order({
                orderId: session_id,
                products: lineItems,
                amount: amount,
                status: session.status === 'paid' ? 'completed' : 'failed',
            });
        } else {
            // تحديث حالة الطلب إذا تم العثور عليه
            order.status = session.status === 'paid' ? 'completed' : 'failed';
        }

        await order.save(); // حفظ الطلب في قاعدة البيانات
        console.log("Order saved to database:", order);

        res.json({ order });
    } catch (error) {
        console.error("Error confirming payment:", error);
        res.status(500).json({ error: "Failed to confirm payment", details: error.message });
    }
});




// get order by email address
router.get("/:email", async (req, res) => {
    const email = req.params.email;
    if (!email) {
        return res.status(400).send({ message: "Email is required" });
    }

    try {
        const orders = await Order.find({ email: email });

        if (orders.length === 0 || !orders) {
            return res.status(400).send({ orders: 0, message: "No orders found for this email" });
        }
        res.status(200).send({ orders });
    } catch (error) {
        console.error("Error fetching orders by email", error);
        res.status(500).send({ message: "Failed to fetch orders by email" });
    }
});

// get order by id
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

// get all orders
router.get("/", async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        if (orders.length === 0) {
            return res.status(404).send({ message: "No orders found", orders: [] });
        }

        res.status(200).send(orders);
    } catch (error) {
        console.error("Error fetching all orders", error);
        res.status(500).send({ message: "Failed to fetch all orders" });
    }
});

// update order status
router.patch("/update-order-status/:id", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
        return res.status(400).send({ message: "Status is required" });
    }

    try {
        const updatedOrder = await Order.findByIdAndUpdate(
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
            return res.status(404).send({ message: "Order not found" });
        }

        res.status(200).json({
            message: "Order status updated successfully",
            order: updatedOrder
        });

    } catch (error) {
        console.error("Error updating order status", error);
        res.status(500).send({ message: "Failed to update order status" });
    }
});

// delete order
router.delete('/delete-order/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deletedOrder = await Order.findByIdAndDelete(id);
        if (!deletedOrder) {
            return res.status(404).send({ message: "Order not found" });
        }
        res.status(200).json({
            message: "Order deleted successfully",
            order: deletedOrder
        });

    } catch (error) {
        console.error("Error deleting order", error);
        res.status(500).send({ message: "Failed to delete order" });
    }
});

module.exports = router;