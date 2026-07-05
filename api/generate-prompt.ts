import { GoogleGenAI } from "@google/genai";
import { getAuthenticatedUser, firestoreDb } from "../server-firebase";

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

  // Check if method is POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. Authenticate user if they provided an ID Token
    const authUser = await getAuthenticatedUser(req);
    let userEmail = authUser ? authUser.email : null;
    
    if (userEmail) {
      // Fetch user profile from Firestore
      let profile = await firestoreDb.getUser(userEmail);
      if (!profile) {
        // Auto-create profile if user is authenticated in Auth but doesn't exist in Firestore
        profile = await firestoreDb.createUser(userEmail, authUser.name || userEmail.split('@')[0], 90);
      }
      
      if (profile.credits < 30) {
        return res.status(403).json({
          error: "credits_exhausted",
          message: "You have used all your free uses. Please upgrade starting from $5 to get 50 credits."
        });
      }
    }

    // Defensive body parsing
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { image, mimeType, promptType, customInstructions } = body || {};

    if (!image) {
      return res.status(400).json({ error: "Missing image data" });
    }

    // Clean base64 string
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Initialize Gemini client with standard user agent
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not defined in environment variables." });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

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

    // 2. If authenticated, deduct 30 credits and record in prompt history
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

    return res.status(200).json({
      prompt: generatedPrompt,
      ...(remainingCredits !== null ? { credits: remainingCredits } : {})
    });
  } catch (error: any) {
    console.error("Gemini API Error in Vercel Function:", error);
    return res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
}
