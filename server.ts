import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { db } from "./server-db";
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

// Helper to authenticate user from headers
function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7);
  return { user: db.getUserByToken(token), token };
}

// Auth API - Sign Up
app.post("/api/auth/signup", (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existingUser = db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: "Email is already registered" });
    }

    // Simple hash representation for plaintext passwords
    const passwordHash = Buffer.from(password).toString("base64");
    const user = db.createUser(username, email, passwordHash);
    const token = db.generateToken(email);

    res.json({
      success: true,
      token,
      user: {
        username: user.username,
        email: user.email,
        credits: user.credits,
        promptHistory: user.promptHistory
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Signup failed" });
  }
});

// Auth API - Log In
app.post("/api/auth/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const user = db.getUserByEmail(email);
    const passwordHash = Buffer.from(password).toString("base64");

    if (!user || user.passwordHash !== passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = db.generateToken(email);

    res.json({
      success: true,
      token,
      user: {
        username: user.username,
        email: user.email,
        credits: user.credits,
        promptHistory: user.promptHistory
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Login failed" });
  }
});

// Auth API - Get Current Profile (Me)
app.get("/api/auth/me", (req, res) => {
  try {
    const auth = getAuthenticatedUser(req);
    if (!auth || !auth.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.json({
      success: true,
      user: {
        username: auth.user.username,
        email: auth.user.email,
        credits: auth.user.credits,
        promptHistory: auth.user.promptHistory
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// Auth API - Log Out
app.post("/api/auth/logout", (req, res) => {
  try {
    const auth = getAuthenticatedUser(req);
    if (auth && auth.token) {
      db.logoutToken(auth.token);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Logout failed" });
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
    const auth = getAuthenticatedUser(req);
    if (!auth || !auth.user) {
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
    const auth = getAuthenticatedUser(req);
    if (!auth || !auth.user) {
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

    // Credit user's account
    const updatedUser = db.addCredits(auth.user.email, Number(credits));
    if (!updatedUser) {
      return res.status(404).json({ error: "User profile not found." });
    }

    res.json({
      success: true,
      credits: updatedUser.credits,
      added: Number(credits),
      promptHistory: updatedUser.promptHistory
    });

  } catch (error: any) {
    console.error("Razorpay verification error:", error);
    res.status(500).json({ error: error.message || "Payment verification failed" });
  }
});

// User API - Add Credits (Checkout Sim)
app.post("/api/user/add-credits", (req, res) => {
  try {
    const auth = getAuthenticatedUser(req);
    if (!auth || !auth.user) {
      return res.status(401).json({ error: "Unauthorized. Please log in first." });
    }

    const { amount } = req.body;
    if (!amount || Number(amount) < 5) {
      return res.status(400).json({ error: "Minimum purchase amount is $5." });
    }

    // Give 50 credits on $5, and proportional credits for larger amounts
    const creditsToAdd = Math.floor((Number(amount) / 5) * 50);
    const updatedUser = db.addCredits(auth.user.email, creditsToAdd);

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      credits: updatedUser.credits,
      added: creditsToAdd,
      promptHistory: updatedUser.promptHistory
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
    const auth = getAuthenticatedUser(req);
    let userEmail = "";
    
    if (auth && auth.user) {
      userEmail = auth.user.email;
      // Enforce credits check
      if (auth.user.credits < 30) {
        return res.status(403).json({
          error: "credits_exhausted",
          message: "You have used all your free uses. Please upgrade starting from $5 to get 50 credits."
        });
      }
    } else {
      // Anonymous request - we can allow or suggest log in. Let's let client enforce,
      // but if server wants to allow, we just process. Let's print warning or proceed.
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
      db.deductCredit(userEmail, 30);
      const updatedUser = db.addPromptToHistory(userEmail, promptType, customInstructions, generatedPrompt);
      if (updatedUser) {
        remainingCredits = updatedUser.credits;
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
