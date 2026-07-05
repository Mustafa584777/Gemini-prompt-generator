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

    // 2. Try loading from local config file, with multiple paths to support Vercel serverless functions
    const possiblePaths = [
      path.join(process.cwd(), "firebase-applet-config.json"),
      path.join(__dirname, "../firebase-applet-config.json"),
      path.join(__dirname, "firebase-applet-config.json")
    ];

    let fileConfig: any = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          fileConfig = JSON.parse(fs.readFileSync(p, "utf8"));
          break;
        } catch (e) {
          console.warn(`Failed to parse config at ${p}:`, e);
        }
      }
    }

    if (fileConfig) {
      config.apiKey = config.apiKey || fileConfig.apiKey;
      config.authDomain = config.authDomain || fileConfig.authDomain;
      config.projectId = config.projectId || fileConfig.projectId;
      config.storageBucket = config.storageBucket || fileConfig.storageBucket;
      config.messagingSenderId = config.messagingSenderId || fileConfig.messagingSenderId;
      config.appId = config.appId || fileConfig.appId;
      config.firestoreDatabaseId = config.firestoreDatabaseId || fileConfig.firestoreDatabaseId;
    }

    // 3. Absolute robust default fallback values for this specific project
    config.apiKey = config.apiKey || "AIzaSyCFyGzp7viV1tq25DAMnpKKSJpPngtVa14";
    config.authDomain = config.authDomain || "gen-lang-client-0844549707.firebaseapp.com";
    config.projectId = config.projectId || "gen-lang-client-0844549707";
    config.storageBucket = config.storageBucket || "gen-lang-client-0844549707.firebasestorage.app";
    config.messagingSenderId = config.messagingSenderId || "845800015860";
    config.appId = config.appId || "1:845800015860:web:a6229be704605991785ba1";
    config.firestoreDatabaseId = config.firestoreDatabaseId || "ai-studio-imagetogeminipro-7991f626-f4c5-4d1c-8e24-82965df261a7";

    return res.status(200).json(config);
  } catch (err: any) {
    console.error("Error reading firebase config:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
