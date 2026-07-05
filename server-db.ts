import fs from "fs";
import path from "path";

export interface PromptHistoryItem {
  id: string;
  timestamp: string;
  style: string;
  instructions: string;
  prompt: string;
}

export interface User {
  username: string;
  email: string;
  passwordHash: string;
  credits: number;
  promptHistory: PromptHistoryItem[];
}

export interface DBStructure {
  users: Record<string, User>; // key is email lowercase
  tokens: Record<string, string>; // token -> email
}

const DB_FILE = path.join(process.cwd(), "db.json");

function readDB(): DBStructure {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialDB: DBStructure = { users: {}, tokens: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2), "utf-8");
      return initialDB;
    }
    const content = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("Error reading database file, returning empty state:", err);
    return { users: {}, tokens: {} };
  }
}

function writeDB(data: DBStructure): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing to database file:", err);
  }
}

// Thread-safe / simple synchronous database functions
export const db = {
  // User Authentication
  getUserByEmail(email: string): User | null {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    return data.users[cleanEmail] || null;
  },

  createUser(username: string, email: string, passwordHash: string): User {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    
    // Create new user with 90 free credits
    const newUser: User = {
      username: username.trim(),
      email: cleanEmail,
      passwordHash,
      credits: 90,
      promptHistory: []
    };
    
    data.users[cleanEmail] = newUser;
    writeDB(data);
    return newUser;
  },

  generateToken(email: string): string {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    const token = "tok_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    
    data.tokens[token] = cleanEmail;
    writeDB(data);
    return token;
  },

  getUserByToken(token: string): User | null {
    const data = readDB();
    const email = data.tokens[token];
    if (!email) return null;
    return data.users[email] || null;
  },

  logoutToken(token: string): void {
    const data = readDB();
    delete data.tokens[token];
    writeDB(data);
  },

  // Credits Management
  updateUserCredits(email: string, credits: number): User | null {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    const user = data.users[cleanEmail];
    if (!user) return null;
    
    user.credits = credits;
    writeDB(data);
    return user;
  },

  addCredits(email: string, amount: number): User | null {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    const user = data.users[cleanEmail];
    if (!user) return null;
    
    user.credits += amount;
    writeDB(data);
    return user;
  },

  deductCredit(email: string, amount: number = 30): boolean {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    const user = data.users[cleanEmail];
    if (!user || user.credits < amount) return false;
    
    user.credits -= amount;
    writeDB(data);
    return true;
  },

  // Prompt History Management
  addPromptToHistory(email: string, style: string, instructions: string, prompt: string): User | null {
    const data = readDB();
    const cleanEmail = email.trim().toLowerCase();
    const user = data.users[cleanEmail];
    if (!user) return null;
    
    const newItem: PromptHistoryItem = {
      id: "prt_" + Date.now().toString() + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      style,
      instructions: instructions || "None",
      prompt
    };
    
    // Add to top of history
    user.promptHistory.unshift(newItem);
    writeDB(data);
    return user;
  }
};
