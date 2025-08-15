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
const publish_key="HGvTMLDssJghr9tlN9gr4DVYt0qyBy";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Create checkout session



const updateProductQuantity = async (productId, quantity) => {
    try {
        const product = await Product.findById(productId);
        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        if (product.quantity < quantity) {
            throw new Error('الكمية المطلوبة غير متوفرة');
        }

        product.quantity -= quantity;
        await product.save();
        return product;
    } catch (error) {
        console.error('Error updating product quantity:', error);
        throw error;
    }
};


router.post("/create-order", async (req, res) => {
    const { products, email, customerName, customerPhone, wilayat, notes, isAdmin } = req.body;
    const shippingFee = 2; // رسوم الشحن الثابتة

    if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: "يجب إضافة منتجات للطلب" });
    }

    // التحقق من البيانات المطلوبة (تختلف حسب صلاحية المستخدم)
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
        // بقية الكود يبقى كما هو...
        // التحقق من توفر الكميات أولاً
        for (const product of products) {
            const dbProduct = await Product.findById(product._id);
            if (!dbProduct) {
                return res.status(400).json({ error: `المنتج ${product.name} غير موجود` });
            }
            if (dbProduct.quantity < product.quantity) {
                return res.status(400).json({ 
                    error: `الكمية المطلوبة غير متوفرة للمنتج ${product.name} (المتبقي: ${dbProduct.quantity})`
                });
            }
        }

        // حساب المبلغ الإجمالي مع رسوم الشحن
        const subtotal = products.reduce((total, product) => {
            return total + (product.price * product.quantity);
        }, 0);
        const totalAmount = subtotal + shippingFee;

        // إنشاء رقم طلب فريد
        const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // حفظ الطلب في قاعدة البيانات
        const order = new Order({
            orderId,
            products: products.map(product => ({
                productId: product._id,
                quantity: product.quantity,
                selectedSize: product.selectedSize // حفظ الحجم المحدد إن وجد
            })),
            amount: totalAmount,
            shippingFee,
            customerName: isAdmin ? (customerName || "Admin Order") : customerName,
            customerPhone: isAdmin ? (customerPhone || "00000000") : customerPhone,
            wilayat,
            email,
            paymentMethod: "cash", // الدفع عند الاستلام
            notes,
            status: "pending"
        });

        await order.save();

        // تحديث كميات المنتجات بعد حفظ الطلب بنجاح
        for (const product of products) {
            await updateProductQuantity(product._id, product.quantity);
        }

        res.status(201).json({ 
            message: "تم إنشاء الطلب بنجاح",
            order,
            paymentMethod: "cash" 
        });
    } catch (error) {
        console.error("Error creating order:", error);
        res.status(500).json({ 
            error: "فشل إنشاء الطلب", 
            details: error.message 
        });
    }
});

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
                    error: `الكمية المطلوبة غير متوفرة للمنتج ${product.name} (المتبقي: ${dbProduct.quantity})`
                });
            }
        }

        // حساب المبلغ الإجمالي مع رسوم الشحن
        const subtotal = products.reduce((total, product) => total + (product.price * product.quantity), 0);
        const totalAmount = subtotal + shippingFee;

        const lineItems = products.map((product) => ({
            name: product.name,
            productId: product._id,
            quantity: product.quantity,
            unit_amount: Math.round(product.price * 1000), // Convert to baisa
        }));

        // إضافة رسوم الشحن كعنصر منفصل
        lineItems.push({
            name: "رسوم الشحن",
            quantity: 1,
            unit_amount: Math.round(shippingFee * 1000), // Convert to baisa
        });

        const data = {
            client_reference_id: Date.now().toString(),
            mode: "payment",
            products: lineItems,
            success_url: "http://localhost:5173/success?client_reference_id="+Date.now().toString(),
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

        // حفظ الطلب في قاعدة البيانات مع رسوم الشحن
        const order = new Order({
            orderId: sessionId,
            products: products.map((product) => ({
                productId: product._id,
                quantity: product.quantity,
            })),
            amount: totalAmount,
            shippingFee: shippingFee,
            customerName,
            customerPhone,
            wilayat,
            email,
            status: "pending",
        });

        await order.save();

        // تحديث كميات المنتجات بعد حفظ الطلب بنجاح
        for (const product of products) {
            await updateProductQuantity(product._id, product.quantity);
        }

        res.json({ id: sessionId, paymentLink });
    } catch (error) {
        console.error("Error creating checkout session:", error);
        res.status(500).json({ 
            error: "Failed to create checkout session", 
            details: error.message 
        });
    }
});
router.post("/cancel-order/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: "الطلب غير موجود" });
        }

        // استعادة كميات المنتجات
        for (const item of order.products) {
            const product = await Product.findById(item.productId);
            if (product) {
                product.quantity += item.quantity;
                await product.save();
            }
        }

        // تحديث حالة الطلب إلى ملغى
        order.status = "cancelled";
        await order.save();

        res.status(200).json({ 
            message: "تم إلغاء الطلب واستعادة الكميات بنجاح",
            order 
        });
    } catch (error) {
        console.error("Error cancelling order:", error);
        res.status(500).json({ 
            error: "فشل في إلغاء الطلب", 
            details: error.message 
        });
    }
});
// Confirm payment
router.post("/confirm-payment", async (req, res) => {
    const { client_reference_id } = req.body;
 
    if (!client_reference_id) {
        return res.status(400).json({ error: "Session ID is required" });
    }
   
    try {
            // Step 1: Get sessions from Thawani
            const sessionsResponse = await axios.get(`${THAWANI_API_URL}/checkout/session/?limit=10&skip=0`, {
                headers: {
                    'Content-Type': 'application/json',
                    'thawani-api-key': THAWANI_API_KEY,
                },
            });

            const sessions = sessionsResponse.data.data; // Extract sessions list
         
            // Step 2: Find the session matching client_reference_id
            const session_ = sessions.find(s => s.client_reference_id === client_reference_id);

            if (!session_) {
                return res.status(404).json({ error: "Session not found" });
            }

            const session_id = session_.session_id; // Extract session_id


        const response = await axios.get(`${THAWANI_API_URL}/checkout/session/${session_id}?limit=1&skip=0`, {
            headers: {
                'Content-Type': 'application/json',
                'thawani-api-key': THAWANI_API_KEY,
            },
        });

        const session = response.data.data;
        console.log(session);
        if (!session || session.payment_status !== 'paid') {
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
                amount: session.total_amount / 1000, // Convert to Omani Rial
                status: session.payment_status === 'paid' ? 'completed' : 'failed',
            });
        } else {
            order.status = session.payment_status === 'paid' ? 'completed' : 'failed';
        }

        await order.save();

        res.json({ order });
    } catch (error) {
        console.error("Error confirming payment:", error);
        res.status(500).json({ error: "Failed to confirm payment", details: error.message });
    }
});

// Get order by email
router.get("/:email", async (req, res) => {
    const email = req.params.email;

    if (!email) {
        return res.status(400).send({ message: "Email is required" });
    }

    try {
        const orders = await Order.find({ email: email });

        if (orders.length === 0) {
            return res.status(404).send({ message: "No orders found for this email" });
        }

        res.status(200).send({ orders });
    } catch (error) {
        console.error("Error fetching orders by email:", error);
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
    const orders = await Order.find().sort({ createdAt: -1 }).populate({
        path: 'products.productId',
        select: 'name price image',
        model: 'Product'
    });

    const formattedOrders = orders.map(order => ({
        ...order._doc,
        products: order.products.map(item => ({
            ...item._doc,
            name: item.productId?.name || item.name || 'منتج غير محدد',
            price: item.productId?.price || item.price || 0,
            image: item.productId?.image || item.image || 'https://via.placeholder.com/150',
            selectedSize: item.selectedSize
        }))
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