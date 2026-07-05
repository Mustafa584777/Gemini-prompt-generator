import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { getAuthenticatedUser as verifyFirebaseToken, firestoreDb } from "./server-firebase";
import Razorpay from "razorpay";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = 3000;

// Enable CORS middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Increase payloads limit to handle base64 image uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Helper to authenticate user and auto-create Firestore profile if they are new
async function getAuthenticatedUser(req: any) {
  const authUser = await verifyFirebaseToken(req);
  if (!authUser || !authUser.email) {
    return null;
  }
  const email = authUser.email;
  let profile = await firestoreDb.getUser(email);
  if (!profile) {
    profile = await firestoreDb.createUser(email, authUser.name || email.split('@')[0], 90);
  }
  return profile;
}

// Auth API - Get Current Profile (Me)
app.get("/api/auth/me", async (req, res) => {
  try {
    const profile = await getAuthenticatedUser(req);
    if (!profile) {
      return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired session token." });
    }
    res.json({
      success: true,
      user: {
        username: profile.username,
        email: profile.email,
        credits: profile.credits,
        promptHistory: profile.promptHistory || []
      }
    });
  } catch (error: any) {
    console.error("Auth Me check failed in Express:", error);
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// Auth API - Log Out placeholder
app.post("/api/auth/logout", (req, res) => {
  res.json({ success: true });
});

// Firebase Config API - Expose public configuration keys safely
app.get("/api/firebase-config", (req, res) => {
  try {
    let config: any = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID
    };

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

    // Absolute robust default fallback values for this specific project
    config.apiKey = config.apiKey || "AIzaSyCFyGzp7viV1tq25DAMnpKKSJpPngtVa14";
    config.authDomain = config.authDomain || "gen-lang-client-0844549707.firebaseapp.com";
    config.projectId = config.projectId || "gen-lang-client-0844549707";
    config.storageBucket = config.storageBucket || "gen-lang-client-0844549707.firebasestorage.app";
    config.messagingSenderId = config.messagingSenderId || "845800015860";
    config.appId = config.appId || "1:845800015860:web:a6229be704605991785ba1";
    config.firestoreDatabaseId = config.firestoreDatabaseId || "ai-studio-imagetogeminipro-7991f626-f4c5-4d1c-8e24-82965df261a7";

    res.json(config);
  } catch (err: any) {
    console.error("Error fetching firebase config in Express:", err);
    res.status(500).json({ error: "Failed to load firebase config" });
  }
});

// Razorpay API - Get Config
app.get("/api/payment/razorpay-config", (req, res) => {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    res.json({
      keyId: keyId || "rzp_test_placeholder_key",
      isSandbox: !keyId
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load payment configuration" });
  }
});

// Razorpay API - Create Payment Order
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const profile = await getAuthenticatedUser(req);
    if (!profile) {
      return res.status(401).json({ error: "Unauthorized. Please log in first." });
    }

    const { amount, currency, credits } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid purchase amount." });
    }

    const finalCurrency = currency || "INR";
    const amountInPaise = Math.round(Number(amount) * 100);

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      // Sandbox Mode: Return mock order details
      const simulatedOrderId = "order_sim_" + Math.random().toString(36).substring(2, 12);
      return res.json({
        success: true,
        isSandbox: true,
        orderId: simulatedOrderId,
        amount: amountInPaise,
        currency: finalCurrency,
        credits: credits
      });
    }

    // Real Razorpay integration
    const razorpay = new (Razorpay as any)({
      key_id: keyId,
      key_secret: keySecret
    });

    const options = {
      amount: amountInPaise,
      currency: finalCurrency,
      receipt: "receipt_order_" + Date.now() + "_" + Math.floor(Math.random() * 1000)
    };

    const order = await razorpay.orders.create(options);
    res.json({
      success: true,
      isSandbox: false,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      credits: credits
    });

  } catch (error: any) {
    console.error("Razorpay order creation error:", error);
    res.status(500).json({ error: error.message || "Failed to create payment order" });
  }
});

// Razorpay API - Verify Payment Signature & Credit User
app.post("/api/payment/verify", async (req, res) => {
  try {
    const profile = await getAuthenticatedUser(req);
    if (!profile) {
      return res.status(401).json({ error: "Unauthorized. Please log in first." });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, credits, isSandbox } = req.body;

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
    const updatedUser = await firestoreDb.addCredits(profile.email, Number(credits));
    if (!updatedUser) {
      return res.status(404).json({ error: "User profile not found." });
    }

    res.json({
      success: true,
      credits: updatedUser.credits,
      added: Number(credits),
      promptHistory: updatedUser.promptHistory || []
    });

  } catch (error: any) {
    console.error("Razorpay verification error:", error);
    res.status(500).json({ error: error.message || "Payment verification failed" });
  }
});

// User API - Add Credits (Checkout Sim)
app.post("/api/user/add-credits", async (req, res) => {
  try {
    const profile = await getAuthenticatedUser(req);
    if (!profile) {
      return res.status(401).json({ error: "Unauthorized. Please log in first." });
    }

    const { amount } = req.body;
    if (!amount || Number(amount) < 5) {
      return res.status(400).json({ error: "Minimum purchase amount is $5." });
    }

    // Give 50 credits on $5, and proportional credits for larger amounts
    const creditsToAdd = Math.floor((Number(amount) / 5) * 50);
    const updatedUser = await firestoreDb.addCredits(profile.email, creditsToAdd);

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      credits: updatedUser.credits,
      added: creditsToAdd,
      promptHistory: updatedUser.promptHistory || []
    });
  } catch (error: any) {
    res.status(500).json({ error: "Payment checkout simulation failed" });
  }
});

// Initialize Gemini client with standard user agent
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API Route for prompt generation
app.post("/api/generate-prompt", async (req, res) => {
  try {
    const { image, mimeType, promptType, customInstructions } = req.body;

    if (!image) {
      return res.status(400).json({ error: "Missing image data" });
    }

    // Check Authentication
    const profile = await getAuthenticatedUser(req);
    let userEmail = profile ? profile.email : null;
    
    if (userEmail && profile) {
      // Enforce credits check
      if (profile.credits < 30) {
        return res.status(403).json({
          error: "credits_exhausted",
          message: "You have used all your free uses. Please upgrade starting from $5 to get 50 credits."
        });
      }
    }

    // Clean base64 string
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Determine target system instruction / prompt style based on options
    let promptText = "";
    if (promptType === "recreation") {
      promptText = "Create a detailed text-to-image prompt (for Midjourney/Stable Diffusion/Gemini) that captures every detail of this image so a model can recreate it perfectly. Analyze style, subject, composition, background, camera angle, lens, lighting (direction, intensity), colors, textures, and atmosphere. Output ONLY the raw final prompt in a concise, copyable format. Do not write 'Here is your prompt' or put it in quotes.";
    } else if (promptType === "artistic") {
      promptText = "Analyze this image and generate an artistic, poetic, and atmospheric text prompt. Focus on the emotional vibe, art style (e.g. oil painting, synthwave, watercolor, minimalist), lighting style, color palette, and visual metaphors. Output ONLY the raw final prompt. No introductory or concluding text.";
    } else if (promptType === "minimalist") {
      promptText = "Create a short, punchy, minimalist prompt capturing the core essence of this image. Keep it under 20-30 words, focusing only on the absolute key elements. Output ONLY the raw final prompt. No commentary.";
    } else {
      // Default: descriptive
      promptText = "Write a comprehensive descriptive prompt based on this image. Detail the main subject, background elements, lighting style, color scheme, and mood. Output ONLY the raw prompt. No extra text.";
    }

    if (customInstructions && customInstructions.trim() !== "") {
      promptText += ` Additional instructions/guidelines: ${customInstructions}`;
    }

    const imagePart = {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: base64Data,
      },
    };

    const textPart = {
      text: promptText,
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: { parts: [imagePart, textPart] },
    });

    const generatedPrompt = response.text || "Could not generate a prompt.";

    // If authenticated user, deduct 30 credits and record in prompt history
    let remainingCredits = null;
    if (userEmail) {
      const success = await firestoreDb.deductCredit(userEmail, 30);
      if (success) {
        const updatedUser = await firestoreDb.addPromptToHistory(userEmail, promptType, customInstructions, generatedPrompt);
        if (updatedUser) {
          remainingCredits = updatedUser.credits;
        }
      }
    }

    res.json({ 
      prompt: generatedPrompt, 
      credits: remainingCredits 
    });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

// Setup dev server or static distribution
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev server middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static build from /dist.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
