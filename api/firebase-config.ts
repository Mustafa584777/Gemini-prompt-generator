import * as fs from "fs";
import * as path from "path";

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. First try to load from environment variables
    let config = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID
    };

    // 2. If any are missing, try loading from local config file
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.apiKey = config.apiKey || fileConfig.apiKey;
      config.authDomain = config.authDomain || fileConfig.authDomain;
      config.projectId = config.projectId || fileConfig.projectId;
      config.storageBucket = config.storageBucket || fileConfig.storageBucket;
      config.messagingSenderId = config.messagingSenderId || fileConfig.messagingSenderId;
      config.appId = config.appId || fileConfig.appId;
      config.firestoreDatabaseId = config.firestoreDatabaseId || fileConfig.firestoreDatabaseId;
    }

    return res.status(200).json(config);
  } catch (err: any) {
    console.error("Error reading firebase config:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
