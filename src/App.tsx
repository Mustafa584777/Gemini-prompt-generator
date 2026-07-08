import { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  Timestamp 
} from 'firebase/firestore';
import { 
  auth, 
  googleProvider, 
  db, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { UserProfile } from './types';
import PromptGenerator from './components/PromptGenerator';
import { 
  Sparkles, LogIn, LogOut, User as UserIcon, Calendar, 
  Mail, Shield, ArrowRight, Laptop, Server 
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthActionLoading, setIsAuthActionLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Monitor Auth Status
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setIsLoading(true);
      setAuthError(null);
      if (firebaseUser) {
        setUser(firebaseUser);
        const path = `users/${firebaseUser.uid}`;
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(userDocRef);

          if (docSnap.exists()) {
            // User already registered, update last login
            const existingProfile = docSnap.data() as UserProfile;
            await updateDoc(userDocRef, {
              lastLoginAt: Timestamp.now()
            });
            setProfile({
              ...existingProfile,
              lastLoginAt: Timestamp.now()
            });
          } else {
            // New User Registration (Sign up)
            const newProfile: UserProfile = {
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || '',
              photoURL: firebaseUser.photoURL || '',
              createdAt: Timestamp.now(),
              lastLoginAt: Timestamp.now()
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          console.error('Error syncing user profile:', error);
          handleFirestoreError(error, OperationType.WRITE, path);
          setAuthError('Failed to synchronize user data with the database.');
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setIsAuthActionLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Google Sign-In Error:', error);
      // Catch pop-up blocker issues, closed windows, etc.
      if (error.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in process was canceled before completion.');
      } else if (error.code === 'auth/blocked-by-popup-requestor') {
        setAuthError('Sign-in popup was blocked by your browser. Please enable popups.');
      } else {
        setAuthError(error.message || 'An unexpected error occurred during Google Sign-In.');
      }
    } finally {
      setIsAuthActionLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsAuthActionLoading(true);
    try {
      await signOut(auth);
    } catch (error: any) {
      console.error('Logout error:', error);
    } finally {
      setIsAuthActionLoading(false);
    }
  };

  // Date formatting helper
  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Unknown';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16 bg-indigo-600/10 rounded-2xl flex items-center justify-center border border-indigo-500/20">
            <Sparkles className="w-8 h-8 text-indigo-500 animate-pulse" />
          </div>
          <p className="text-sm font-semibold tracking-widest text-zinc-400 uppercase animate-pulse">Initializing Security Protocol...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col bg-zinc-950 min-h-screen text-zinc-100 selection:bg-indigo-600/30 font-sans">
      <AnimatePresence mode="wait">
        {!user ? (
          /* LOGIN SCREEN */
          <motion.div 
            key="login"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex-grow flex flex-col items-center justify-center p-6 md:p-12 relative overflow-hidden"
          >
            {/* Background ambient blurs */}
            <div className="absolute top-1/4 left-1/4 w-[350px] h-[350px] bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-purple-600/5 rounded-full blur-[100px] pointer-events-none" />

            <div className="w-full max-w-md bg-zinc-900/40 border border-zinc-800/80 rounded-[2.5rem] p-8 md:p-10 shadow-2xl backdrop-blur-md z-10 relative">
              
              {/* Brand Header */}
              <div className="flex flex-col items-center text-center mb-8">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center font-black italic text-white text-xl shadow-lg shadow-indigo-900/30 mb-4">
                  G
                </div>
                <h1 className="text-2xl font-extrabold tracking-tighter uppercase text-zinc-100">
                  Gemini<span className="text-indigo-500">Prompt</span>
                </h1>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mt-1">Vision Transformer Console v3.5</p>
              </div>

              {/* Tagline / Pitch */}
              <div className="space-y-4 mb-8 text-center text-zinc-300">
                <p className="text-sm text-zinc-400">
                  Transform any image into highly descriptive, pixel-accurate prompts for Midjourney, Stable Diffusion, and DALL-E, powered directly by Google's Gemini LLMs.
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 bg-zinc-900/80 py-2 px-3 rounded-xl border border-zinc-850">
                  <Shield className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Secure, Single-Sign-On Google Authentication</span>
                </div>
              </div>

              {/* Login Errors */}
              {authError && (
                <div className="mb-6 bg-rose-950/30 border border-rose-900/40 p-4 rounded-xl text-xs text-rose-400 flex flex-col gap-1">
                  <span className="font-bold uppercase tracking-wider">Authentication Error</span>
                  <span>{authError}</span>
                </div>
              )}

              {/* Action Buttons */}
              <button
                type="button"
                onClick={handleLogin}
                disabled={isAuthActionLoading}
                className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 border transition-all duration-200 ${
                  isAuthActionLoading
                    ? 'bg-zinc-800/40 text-zinc-600 border-zinc-800/60 cursor-wait'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-xl shadow-indigo-950/40 hover:scale-[1.01] cursor-pointer'
                }`}
              >
                {isAuthActionLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 rounded-full bg-zinc-500 animate-spin border-2 border-white border-t-transparent mr-2"></span>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Login / Signup with Google</span>
                  </>
                )}
              </button>

              {/* Extra helper notice for Vercel/External domains */}
              <div className="mt-6 text-center text-[10px] text-zinc-600 font-medium">
                Note: Ensure your current domain is listed in the Firebase Authorized Domains console to allow Google SSO to complete.
              </div>

            </div>
          </motion.div>
        ) : (
          /* AUTHENTICATED WORKSPACE SHELL */
          <motion.div 
            key="workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-grow flex flex-col"
          >
            {/* Header / Navbar */}
            <header className="bg-zinc-950/80 border-b border-zinc-900 sticky top-0 z-40 backdrop-blur-md">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center font-black italic text-white text-lg shadow-md shadow-indigo-900/20">
                    G
                  </div>
                  <div>
                    <h1 className="text-lg font-bold tracking-tighter uppercase text-zinc-100">
                      Gemini<span className="text-indigo-500">Prompt</span>
                    </h1>
                    <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Workspace Engine</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isAuthActionLoading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 hover:text-zinc-100 text-xs font-bold uppercase tracking-wider rounded-xl transition-all"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </button>
                </div>
              </div>
            </header>

            {/* Dashboard / User Profile Summary Row */}
            <section className="bg-zinc-900/20 border-b border-zinc-900/60 py-8">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden shadow-lg backdrop-blur-sm">
                  {/* Backdrop lights */}
                  <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none" />

                  <div className="flex flex-col sm:flex-row items-center gap-5 z-10 text-center sm:text-left">
                    {profile?.photoURL ? (
                      <img 
                        src={profile.photoURL} 
                        alt={profile.displayName || 'Profile'} 
                        referrerPolicy="no-referrer"
                        className="w-16 h-16 rounded-2xl object-cover ring-2 ring-indigo-500/20 shadow-md"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center text-indigo-400 shadow-md">
                        <UserIcon className="w-8 h-8" />
                      </div>
                    )}
                    
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                        <h2 className="text-lg font-extrabold text-zinc-100">
                          {profile?.displayName || user.displayName || 'Anonymous Explorer'}
                        </h2>
                        <span className="px-2 py-0.5 bg-indigo-950 text-indigo-400 text-[9px] font-bold uppercase tracking-widest rounded-full border border-indigo-900/30">
                          Verified User
                        </span>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center justify-center sm:justify-start gap-y-1 gap-x-4 text-xs text-zinc-400">
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-zinc-600" />
                          <span className="font-mono">{profile?.email || user.email}</span>
                        </div>
                        <div className="hidden sm:inline text-zinc-700">•</div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-zinc-600" />
                          <span>Joined: <span className="font-medium text-zinc-300">{formatDate(profile?.createdAt)}</span></span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick stats panel */}
                  <div className="flex gap-4 shrink-0 font-mono z-10 w-full md:w-auto border-t border-zinc-800/60 md:border-t-0 pt-4 md:pt-0">
                    <div className="flex-1 md:flex-none bg-zinc-900/60 p-4 rounded-2xl border border-zinc-850/40 text-center md:text-left min-w-[120px]">
                      <span className="block text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Node Status</span>
                      <span className="block text-xs font-bold text-emerald-400 mt-1">● Secure</span>
                    </div>
                    <div className="flex-1 md:flex-none bg-zinc-900/60 p-4 rounded-2xl border border-zinc-850/40 text-center md:text-left min-w-[120px]">
                      <span className="block text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Auth Authority</span>
                      <span className="block text-xs font-bold text-indigo-400 mt-1">Google Identity</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Prompt Generator Core Tool Module */}
            <main className="flex-grow py-8">
              <PromptGenerator userId={user.uid} />
            </main>

            {/* Footer */}
            <footer className="bg-zinc-950 border-t border-zinc-900 py-8 mt-auto">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-[9px] text-zinc-600 font-mono uppercase tracking-widest">
                <div className="flex items-center gap-1">
                  <Laptop className="w-3.5 h-3.5" />
                  <span>Platform State: Optimal // Live Node Host</span>
                </div>
                <div className="flex items-center gap-1">
                  <Server className="w-3.5 h-3.5" />
                  <span>Engine: Gemini 3.5 Flash via Server-Side Proxy</span>
                </div>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
