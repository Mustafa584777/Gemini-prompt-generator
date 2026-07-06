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
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }
    
    const existing = await firestoreDb.getUser(email);
    if (existing) {
      return res.status(400).json({ error: "Email address is already registered." });
    }

    const newUser = await firestoreDb.createUserWithPassword(email, username, password, 90);
    const token = generateToken(email);

    return res.status(200).json({
      success: true,
      token,
      user: newUser
    });
  } catch (error: any) {
    console.error("Custom signup serverless failed:", error);
    return res.status(500).json({ error: error.message || "Failed to register account." });
  }
}
