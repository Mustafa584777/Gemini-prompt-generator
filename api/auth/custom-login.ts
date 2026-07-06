import { firestoreDb, generateToken } from "../../server-firebase";

export default async function handler(req: any, res: any) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  // Handle OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await firestoreDb.verifyUserPassword(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid email address or password. Please check your credentials or register a new account." });
    }

    const token = generateToken(email);

    return res.status(200).json({
      success: true,
      token,
      user
    });
  } catch (error: any) {
    console.error("Custom login serverless failed:", error);
    return res.status(500).json({ error: error.message || "Failed to log in." });
  }
}
