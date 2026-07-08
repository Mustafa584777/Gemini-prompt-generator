import Razorpay from "razorpay";

let razorpayInstance: any = null;
function getRazorpay() {
  if (!razorpayInstance) {
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error("Razorpay API credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are missing or incomplete in environment.");
    }
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  return razorpayInstance;
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { amount, currency, receipt } = body || {};

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 100) {
      return res.status(400).json({ error: "Amount must be at least 100 paise (1 INR)" });
    }

    try {
      const razorpay = getRazorpay();
      const options = {
        amount: numericAmount,
        currency: currency || "INR",
        receipt: receipt || `receipt_order_${Date.now()}`
      };

      const order = await razorpay.orders.create(options);
      return res.status(200).json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency
      });
    } catch (razorpayError: any) {
      console.error("Razorpay SDK Error in serverless function:", razorpayError);
      if (razorpayError.statusCode === 401 || (razorpayError.message && razorpayError.message.toLowerCase().includes("auth"))) {
        return res.status(401).json({ error: "Razorpay authentication failed. Please check server API keys." });
      }
      return res.status(500).json({ error: razorpayError.message || "Failed to create Razorpay order." });
    }
  } catch (error: any) {
    console.error("Create Order Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
