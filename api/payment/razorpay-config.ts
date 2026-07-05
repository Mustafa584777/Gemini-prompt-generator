export default async function handler(req: any, res: any) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    return res.status(200).json({
      keyId: keyId || "rzp_test_placeholder_key",
      isSandbox: !keyId
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to load payment configuration" });
  }
}
