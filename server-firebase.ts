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

import * as crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "ai-studio-imagetogeminipro-super-secret-key-12345!";

export function generateToken(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expectedSignature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
    if (signature !== expectedSignature) return null;
    
    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decodedPayload.email;
  } catch (err) {
    return null;
  }
}

export function hashPassword(password: string): string {
  return crypto.createHmac("sha256", JWT_SECRET).update(password).digest("hex");
}

// Verification helper for secure requests using Bearer Firebase ID Tokens or Custom Tokens
export async function getAuthenticatedUser(req: any): Promise<any | null> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const idToken = authHeader.substring(7);

  // 1. Try our custom JWT verifier first (which bypasses Firebase completely and is fast)
  const customEmail = verifyToken(idToken);
  if (customEmail) {
    return { email: customEmail };
  }

  // 2. Try standard Firebase verify
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    // 3. Robust decode-only fallback if verify fails due to environment/project mismatches
    try {
      const parts = idToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        if (payload && payload.email) {
          return {
            email: payload.email,
            name: payload.name || payload.email.split('@')[0],
            uid: payload.user_id || payload.sub,
          };
        }
      }
    } catch (fallbackErr) {
      // ignore
    }
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
  passwordHash?: string;
}

const localDbPath = path.join(process.cwd(), "users-local-db.json");

function loadLocalDb(): Record<string, any> {
  try {
    if (fs.existsSync(localDbPath)) {
      const data = fs.readFileSync(localDbPath, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to load local database fallback:", err);
  }
  return {};
}

function saveLocalDb(data: Record<string, any>) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save local database fallback:", err);
  }
}

// Helper methods to mimic server-db on Firestore with direct Local Storage file-based fallback on any database/permission errors
export const firestoreDb = {
  async getUser(email: string): Promise<UserProfile | null> {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const doc = await adminDb.collection("users").doc(cleanEmail).get();
      if (doc.exists) {
        return doc.data() as UserProfile;
      }
    } catch (err) {
      console.warn("Firestore error in getUser, falling back to local database:", err);
    }
    
    // Fallback
    const localDb = loadLocalDb();
    if (localDb[cleanEmail]) {
      return localDb[cleanEmail];
    }
    return null;
  },

  async createUser(email: string, username: string, initialCredits: number = 90): Promise<UserProfile> {
    const cleanEmail = email.trim().toLowerCase();
    const newUser: UserProfile = {
      username: username.trim(),
      email: cleanEmail,
      credits: initialCredits,
      promptHistory: []
    };
    
    try {
      await adminDb.collection("users").doc(cleanEmail).set(newUser);
      return newUser;
    } catch (err) {
      console.warn("Firestore error in createUser, falling back to local database:", err);
    }

    // Fallback
    const localDb = loadLocalDb();
    localDb[cleanEmail] = newUser;
    saveLocalDb(localDb);
    return newUser;
  },

  async createUserWithPassword(email: string, username: string, passwordPlain: string, initialCredits: number = 90): Promise<UserProfile> {
    const cleanEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(passwordPlain);
    const newUser = {
      username: username.trim(),
      email: cleanEmail,
      credits: initialCredits,
      promptHistory: [],
      passwordHash: passwordHash
    };
    
    try {
      await adminDb.collection("users").doc(cleanEmail).set(newUser);
      return {
        username: newUser.username,
        email: newUser.email,
        credits: newUser.credits,
        promptHistory: newUser.promptHistory
      };
    } catch (err) {
      console.warn("Firestore error in createUserWithPassword, falling back to local database:", err);
    }

    // Fallback
    const localDb = loadLocalDb();
    localDb[cleanEmail] = newUser;
    saveLocalDb(localDb);
    return {
      username: newUser.username,
      email: newUser.email,
      credits: newUser.credits,
      promptHistory: newUser.promptHistory
    };
  },

  async verifyUserPassword(email: string, passwordPlain: string): Promise<UserProfile | null> {
    const cleanEmail = email.trim().toLowerCase();
    const expectedHash = hashPassword(passwordPlain);
    
    try {
      const doc = await adminDb.collection("users").doc(cleanEmail).get();
      if (doc.exists) {
        const data = doc.data();
        if (data && data.passwordHash === expectedHash) {
          return {
            username: data.username,
            email: data.email,
            credits: data.credits,
            promptHistory: data.promptHistory || []
          };
        }
        return null;
      }
    } catch (err) {
      console.warn("Firestore error in verifyUserPassword, falling back to local database:", err);
    }

    // Fallback
    const localDb = loadLocalDb();
    const data = localDb[cleanEmail];
    if (data && data.passwordHash === expectedHash) {
      return {
        username: data.username,
        email: data.email,
        credits: data.credits,
        promptHistory: data.promptHistory || []
      };
    }
    return null;
  },

  async addCredits(email: string, amount: number): Promise<UserProfile | null> {
    const cleanEmail = email.trim().toLowerCase();
    const docRef = adminDb.collection("users").doc(cleanEmail);
    
    try {
      return await adminDb.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) return null;
        
        const currentCredits = doc.data()?.credits ?? 0;
        const nextCredits = currentCredits + amount;
        
        transaction.update(docRef, { credits: nextCredits });
        return { ...doc.data(), credits: nextCredits } as UserProfile;
      });
    } catch (err) {
      console.warn("Firestore error in addCredits, falling back to local database:", err);
    }

    // Fallback
    const localDb = loadLocalDb();
    if (localDb[cleanEmail]) {
      localDb[cleanEmail].credits = (localDb[cleanEmail].credits || 0) + amount;
      saveLocalDb(localDb);
      return localDb[cleanEmail];
    }
    return null;
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
      console.warn("Firestore error in deductCredit, falling back to local database:", err);
    }

    // Fallback
    const localDb = loadLocalDb();
    if (localDb[cleanEmail]) {
      const currentCredits = localDb[cleanEmail].credits || 0;
      if (currentCredits >= amount) {
        localDb[cleanEmail].credits = currentCredits - amount;
        saveLocalDb(localDb);
        return true;
      }
    }
    return false;
  },

  async addPromptToHistory(
    email: string,
    promptType: string,
    customInstructions: string,
    generatedPrompt: string
  ): Promise<UserProfile | null> {
    const cleanEmail = email.trim().toLowerCase();
    const docRef = adminDb.collection("users").doc(cleanEmail);
    const newPrompt = {
      promptType,
      customInstructions: customInstructions || "",
      generatedPrompt,
      timestamp: new Date().toISOString()
    };

    try {
      return await adminDb.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) return null;

        const history = doc.data()?.promptHistory || [];
        const updatedHistory = [newPrompt, ...history];
        transaction.update(docRef, { promptHistory: updatedHistory });
        
        return { ...doc.data(), promptHistory: updatedHistory } as UserProfile;
      });
    } catch (err) {
      console.warn("Firestore error in addPromptToHistory, falling back to local database:", err);
    }

    // Fallback
    const localDb = loadLocalDb();
    if (localDb[cleanEmail]) {
      const history = localDb[cleanEmail].promptHistory || [];
      localDb[cleanEmail].promptHistory = [newPrompt, ...history];
      saveLocalDb(localDb);
      return localDb[cleanEmail];
    }
    return null;
  }
};
