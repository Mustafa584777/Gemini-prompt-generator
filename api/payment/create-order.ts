import Razorpay from "razorpay";
import { getAuthenticatedUser } from "../../server-firebase";

export default async function handler(req: any, res: any) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser || !authUser.email) {
      return res.status(401).json({ error: "Unauthorized. Please log in first." });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { amount, currency, credits } = body || {};

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid purchase amount." });
    }

    const finalCurrency = currency || "INR";
    const amountInPaise = Math.round(Number(amount) * 100);

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      // Sandbox Mode: Return mock order details
      const simulatedOrderId = "order_sim_" + Math.random().toString(36).substring(2, 12);
      return res.status(200).json({
        success: true,
        isSandbox: true,
        orderId: simulatedOrderId,
        amount: amountInPaise,
        currency: finalCurrency,
        credits: credits
      });
    }

    // Real Razorpay integration
    const razorpay = new (Razorpay as any)({
      key_id: keyId,
      key_secret: keySecret
    });

    const options = {
      amount: amountInPaise,
      currency: finalCurrency,
      receipt: "receipt_order_" + Date.now() + "_" + Math.floor(Math.random() * 1000)
    };

    const order = await razorpay.orders.create(options);
    return res.status(200).json({
      success: true,
      isSandbox: false,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      credits: credits
    });

  } catch (error: any) {
    console.error("Razorpay order creation error in API:", error);
    return res.status(500).json({ error: error.message || "Failed to create payment order" });
  }
}
