import { getAuthenticatedUser, firestoreDb } from "../../server-firebase";

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

  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser || !authUser.email) {
      return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired session token." });
    }

    const email = authUser.email;
    let profile = await firestoreDb.getUser(email);
    
    if (!profile) {
      // Auto-create profile if authenticated but no Firestore doc exists
      profile = await firestoreDb.createUser(email, authUser.name || email.split('@')[0], 90);
    }

    return res.status(200).json({
      user: {
        username: profile.username,
        email: profile.email,
        credits: profile.credits,
        promptHistory: profile.promptHistory || []
      }
    });
  } catch (error: any) {
    console.error("Auth Me check error:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
