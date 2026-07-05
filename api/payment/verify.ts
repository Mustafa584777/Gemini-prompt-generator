import crypto from "crypto";
import { getAuthenticatedUser, firestoreDb } from "../../server-firebase";

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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, credits, isSandbox } = body || {};

    if (!credits || Number(credits) <= 0) {
      return res.status(400).json({ error: "Invalid credits count." });
    }

    let isVerified = false;

    if (isSandbox || !process.env.RAZORPAY_KEY_SECRET) {
      // Sandbox: skip crypt signature check
      isVerified = true;
    } else {
      // Real HMAC verification
      const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
      hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
      const generatedSignature = hmac.digest("hex");
      isVerified = generatedSignature === razorpay_signature;
    }

    if (!isVerified) {
      return res.status(400).json({ error: "Payment verification failed. Invalid signature." });
    }

    // Credit user's account in Firestore
    const updatedUser = await firestoreDb.addCredits(authUser.email, Number(credits));
    if (!updatedUser) {
      return res.status(404).json({ error: "User profile not found in database." });
    }

    return res.status(200).json({
      success: true,
      credits: updatedUser.credits,
      added: Number(credits),
      promptHistory: updatedUser.promptHistory || []
    });

  } catch (error: any) {
    console.error("Razorpay verification error in API:", error);
    return res.status(500).json({ error: error.message || "Payment verification failed" });
  }
}
