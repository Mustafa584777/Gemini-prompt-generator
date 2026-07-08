export interface UserProfile {
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: any; // Firestore Timestamp
  lastLoginAt: any; // Firestore Timestamp
}

export interface PromptItem {
  id?: string;
  userId: string;
  prompt: string;
  promptType: string;
  customInstructions: string;
  createdAt: any; // Firestore Timestamp
}
