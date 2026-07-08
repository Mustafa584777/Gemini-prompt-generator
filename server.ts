import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = 3000;

// Lazy initialization of Razorpay to avoid startup crashes if keys are missing
let razorpayInstance: any = null;
function getRazorpay() {
  if (!razorpayInstance) {
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error("Razorpay API credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are missing or incomplete in environment.");
    }
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  return razorpayInstance;
}

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
    res.json({ prompt: generatedPrompt });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

// API Route for creating Razorpay Order
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, currency, receipt } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 100) {
      return res.status(400).json({ error: "Amount must be at least 100 paise (1 INR)" });
    }

    try {
      const razorpay = getRazorpay();
      const options = {
        amount: numericAmount,
        currency: currency || "INR",
        receipt: receipt || `receipt_order_${Date.now()}`
      };

      const order = await razorpay.orders.create(options);
      return res.json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency
      });
    } catch (razorpayError: any) {
      console.error("Razorpay SDK Error:", razorpayError);
      
      // Handle auth failure explicitly
      if (razorpayError.statusCode === 401 || (razorpayError.message && razorpayError.message.toLowerCase().includes("auth"))) {
        return res.status(401).json({ error: "Razorpay authentication failed. Please check server API keys." });
      }
      
      return res.status(500).json({ error: razorpayError.message || "Failed to create Razorpay order." });
    }
  } catch (error: any) {
    console.error("Create Order Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// API Route for verifying Razorpay Payment Signature
app.post("/api/verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing required payment fields for verification" });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ error: "Razorpay KEY_SECRET is not configured on the server" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature === razorpay_signature) {
      return res.json({ success: true, message: "Payment verified successfully" });
    } else {
      return res.status(400).json({ success: false, error: "Invalid payment signature verification failed" });
    }
  } catch (error: any) {
    console.error("Payment verification error:", error);
    res.status(500).json({ error: error.message || "Internal server error during verification" });
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
