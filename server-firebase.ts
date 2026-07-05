import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

// Load configuration
let projectId = process.env.FIREBASE_PROJECT_ID;
let databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID;

try {
  const possiblePaths = [
    path.join(process.cwd(), "firebase-applet-config.json"),
    path.join(__dirname, "../firebase-applet-config.json"),
    path.join(__dirname, "firebase-applet-config.json")
  ];

  let config: any = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        config = JSON.parse(fs.readFileSync(p, "utf8"));
        break;
      } catch (e) {
        console.warn(`Failed to parse config at ${p}:`, e);
      }
    }
  }

  if (config) {
    if (!projectId) projectId = config.projectId;
    if (!databaseId) databaseId = config.firestoreDatabaseId;
  }
} catch (err) {
  console.warn("Could not read firebase-applet-config.json:", err);
}

// Default fallbacks for AI Studio environment
if (!projectId) {
  projectId = "gen-lang-client-0844549707";
}
if (!databaseId) {
  databaseId = "ai-studio-imagetogeminipro-7991f626-f4c5-4d1c-8e24-82965df261a7";
}

// Initialize Admin SDK
let app;
if (getApps().length === 0) {
  // Check if we have Google Application Credentials, otherwise use basic initialization
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = initializeApp();
  } else {
    app = initializeApp({
      projectId: projectId,
    });
  }
} else {
  app = getApp();
}

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app, databaseId);

// Verification helper for secure requests using Bearer Firebase ID Tokens
export async function getAuthenticatedUser(req: any): Promise<DecodedIdToken | null> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const idToken = authHeader.substring(7);
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("Firebase ID token verification failed:", error);
    return null;
  }
}

export interface UserProfile {
  username: string;
  email: string;
  credits: number;
  promptHistory: {
    promptType: string;
    customInstructions: string;
    generatedPrompt: string;
    timestamp: string;
  }[];
}

// Helper methods to mimic server-db on Firestore
export const firestoreDb = {
  async getUser(email: string): Promise<UserProfile | null> {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const doc = await adminDb.collection("users").doc(cleanEmail).get();
      if (!doc.exists) return null;
      return doc.data() as UserProfile;
    } catch (err) {
      console.error("Firestore getUser error:", err);
      return null;
    }
  },

  async createUser(email: string, username: string, initialCredits: number = 90): Promise<UserProfile> {
    const cleanEmail = email.trim().toLowerCase();
    const newUser: UserProfile = {
      username: username.trim(),
      email: cleanEmail,
      credits: initialCredits,
      promptHistory: []
    };
    await adminDb.collection("users").doc(cleanEmail).set(newUser);
    return newUser;
  },

  async addCredits(email: string, amount: number): Promise<UserProfile | null> {
    const cleanEmail = email.trim().toLowerCase();
    const docRef = adminDb.collection("users").doc(cleanEmail);
    
    return await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return null;
      
      const currentCredits = doc.data()?.credits ?? 0;
      const nextCredits = currentCredits + amount;
      
      transaction.update(docRef, { credits: nextCredits });
      return { ...doc.data(), credits: nextCredits } as UserProfile;
    });
  },

  async deductCredit(email: string, amount: number = 30): Promise<boolean> {
    const cleanEmail = email.trim().toLowerCase();
    const docRef = adminDb.collection("users").doc(cleanEmail);

    try {
      const success = await adminDb.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) return false;

        const currentCredits = doc.data()?.credits ?? 0;
        if (currentCredits < amount) return false;

        transaction.update(docRef, { credits: currentCredits - amount });
        return true;
      });
      return success;
    } catch (err) {
      console.error("Error deducting credits in Firestore transaction:", err);
      return false;
    }
  },

  async addPromptToHistory(
    email: string,
    promptType: string,
    customInstructions: string,
    generatedPrompt: string
  ): Promise<UserProfile | null> {
    const cleanEmail = email.trim().toLowerCase();
    const docRef = adminDb.collection("users").doc(cleanEmail);

    return await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return null;

      const history = doc.data()?.promptHistory || [];
      const newPrompt = {
        promptType,
        customInstructions: customInstructions || "",
        generatedPrompt,
        timestamp: new Date().toISOString()
      };

      const updatedHistory = [newPrompt, ...history];
      transaction.update(docRef, { promptHistory: updatedHistory });
      
      return { ...doc.data(), promptHistory: updatedHistory } as UserProfile;
    });
  }
};
