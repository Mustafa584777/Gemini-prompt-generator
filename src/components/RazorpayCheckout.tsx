import React, { useState } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { 
  CreditCard, CheckCircle2, ShieldCheck, AlertCircle, Sparkles, 
  ArrowRight, Coins, Zap, Trophy, Heart 
} from 'lucide-react';

interface RazorpayCheckoutProps {
  userId: string;
  userEmail: string;
  userDisplayName: string;
  isPremium: boolean;
  onPremiumActivated: () => void;
}

export default function RazorpayCheckout({ 
  userId, 
  userEmail, 
  userDisplayName, 
  isPremium, 
  onPremiumActivated 
}: RazorpayCheckoutProps) {
  const [selectedPlan, setSelectedPlan] = useState<string>('pro'); // starter, pro, ultimate, custom
  const [customAmount, setCustomAmount] = useState<string>('150');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<any | null>(null);

  const plans = [
    {
      id: 'starter',
      name: 'Starter Console',
      price: 10, // INR
      features: ['20 High-Res Prompt Generations', 'Standard Style Modifiers', 'No Watermark'],
      icon: Coins,
      badge: null,
      color: 'border-zinc-800 bg-zinc-900/30'
    },
    {
      id: 'pro',
      name: 'Pro Transformer',
      price: 49, // INR
      features: ['Unlimited Generations', 'All 8+ Cinematic Modifiers', 'Priority GPU Speeds', 'Custom Prompter Console'],
      icon: Zap,
      badge: 'Most Popular',
      color: 'border-indigo-500/50 bg-indigo-950/10'
    },
    {
      id: 'ultimate',
      name: 'Cosmic Master',
      price: 99, // INR
      features: ['Everything in Pro', 'Beta Access to future Gemini LLMs', 'VIP Priority Support', 'Interactive Canvas Editor'],
      icon: Trophy,
      badge: 'Ultimate',
      color: 'border-purple-500/30 bg-purple-950/10'
    }
  ];

  const getAmountInPaise = () => {
    if (selectedPlan === 'custom') {
      const amt = parseFloat(customAmount);
      return isNaN(amt) ? 0 : Math.round(amt * 100);
    }
    const plan = plans.find(p => p.id === selectedPlan);
    return plan ? plan.price * 100 : 0;
  };

  const handlePayment = async () => {
    setIsProcessing(true);
    setPaymentError(null);
    setPaymentSuccess(null);

    const amountInPaise = getAmountInPaise();
    if (amountInPaise < 100) {
      setPaymentError('The minimum checkout amount is ₹1 (100 paise).');
      setIsProcessing(false);
      return;
    }

    try {
      // Step 1: Create order on backend
      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `rcpt_${userId.substring(0, 5)}_${Date.now()}`
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('Razorpay authentication is currently misconfigured on the server. Please check the API keys.');
        }
        throw new Error(errData.error || `Server failed with status ${response.status}`);
      }

      const orderData = await response.json();
      const { order_id, amount, currency } = orderData;

      // Ensure the Razorpay script is loaded
      if (!(window as any).Razorpay) {
        throw new Error('Razorpay standard checkout SDK failed to load. Please check your internet connection.');
      }

      // Step 2: Open Razorpay modal
      const razorpayKey = (import.meta as any).env?.VITE_RAZORPAY_KEY_ID || 'rzp_live_T9oCFNHFLfTJwA';

      const options = {
        key: razorpayKey,
        amount: amount,
        currency: currency,
        name: 'GeminiPrompt Premium',
        description: selectedPlan === 'custom' ? 'Custom Support Tier Upgrade' : `Upgrade to ${plans.find(p => p.id === selectedPlan)?.name}`,
        image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
        order_id: order_id,
        handler: async function (razorpayResponse: any) {
          try {
            setIsProcessing(true);
            
            // Step 3: Verify signature on backend
            const verifyResponse = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                razorpay_order_id: razorpayResponse.razorpay_order_id,
                razorpay_payment_id: razorpayResponse.razorpay_payment_id,
                razorpay_signature: razorpayResponse.razorpay_signature
              })
            });

            if (!verifyResponse.ok) {
              const verifyErr = await verifyResponse.json().catch(() => ({}));
              throw new Error(verifyErr.error || 'Signature verification failed.');
            }

            const verifyResult = await verifyResponse.json();

            if (verifyResult.success) {
              // Persist Premium State in Firestore
              const userRef = doc(db, 'users', userId);
              await updateDoc(userRef, {
                isPremium: true,
                premiumPaymentId: razorpayResponse.razorpay_payment_id,
                premiumOrderId: razorpayResponse.razorpay_order_id,
                premiumActivatedAt: new Date().toISOString()
              });

              setPaymentSuccess({
                paymentId: razorpayResponse.razorpay_payment_id,
                orderId: razorpayResponse.razorpay_order_id,
                amount: amount / 100
              });

              onPremiumActivated();
            } else {
              throw new Error('Payment was completed, but verification failed.');
            }
          } catch (verificationErr: any) {
            console.error('Verification error:', verificationErr);
            setPaymentError(verificationErr.message || 'Verification failed. Please contact support with your Payment ID.');
          } finally {
            setIsProcessing(false);
          }
        },
        prefill: {
          name: userDisplayName,
          email: userEmail
        },
        theme: {
          color: '#4f46e5'
        },
        modal: {
          ondismiss: function () {
            setIsProcessing(false);
            setPaymentError('The payment window was closed before completion.');
          }
        }
      };

      const rzpInstance = new (window as any).Razorpay(options);
      
      rzpInstance.on('payment.failed', function (resp: any) {
        console.error('Payment failed event:', resp.error);
        setPaymentError(resp.error.description || 'The transaction failed. Please try another card or account.');
        setIsProcessing(false);
      });

      rzpInstance.open();
    } catch (err: any) {
      console.error('Razorpay initialization failed:', err);
      setPaymentError(err.message || 'Could not initiate Razorpay payment checkout.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-0">
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-[2.5rem] p-6 sm:p-8 md:p-10 shadow-2xl relative overflow-hidden backdrop-blur-md">
        
        {/* Glow Effects */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-500/5 rounded-full blur-[100px] pointer-events-none" />

        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-zinc-800/60 z-10 relative">
          <div className="space-y-1.5 text-left">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-zinc-800 rounded-lg text-indigo-400 flex items-center justify-center">
                <CreditCard className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Premium Upgrade Console</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-zinc-100 uppercase tracking-tight">
              Unlock GeminiPrompt Premium
            </h2>
            <p className="text-xs text-zinc-400">
              Accelerate prompt engineering. Experience zero generation limits, premium aesthetic models, and priority queue routing.
            </p>
          </div>

          <div>
            {isPremium ? (
              <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold uppercase tracking-widest shadow-lg shadow-emerald-950/20">
                <ShieldCheck className="w-4 h-4 animate-pulse" />
                <span>Premium Active</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest border border-zinc-750">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Standard Account</span>
              </span>
            )}
          </div>
        </div>

        {/* Success State */}
        {paymentSuccess && (
          <div className="mt-8 bg-emerald-950/20 border border-emerald-500/30 p-6 sm:p-8 rounded-2xl flex flex-col items-center text-center gap-4 z-10 relative">
            <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-950/20">
              <CheckCircle2 className="w-6 h-6 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-extrabold text-zinc-100">Upgrade Complete!</h3>
              <p className="text-sm text-emerald-400/80 font-medium">Your account has been promoted to Premium successfully.</p>
            </div>
            <div className="w-full max-w-md bg-zinc-950/80 p-4 rounded-xl border border-zinc-900/80 text-left space-y-2 text-xs font-mono text-zinc-500">
              <div className="flex justify-between">
                <span>Payment ID:</span>
                <span className="text-zinc-300 font-semibold">{paymentSuccess.paymentId}</span>
              </div>
              <div className="flex justify-between">
                <span>Order ID:</span>
                <span className="text-zinc-300 font-semibold">{paymentSuccess.orderId}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount Paid:</span>
                <span className="text-indigo-400 font-bold">₹{paymentSuccess.amount}.00 INR</span>
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Thank you for supporting GeminiPrompt!</p>
          </div>
        )}

        {/* Error Notification */}
        {paymentError && (
          <div className="mt-8 bg-rose-950/30 border border-rose-900/40 p-4 rounded-xl text-xs text-rose-400 flex flex-col gap-1 text-left z-10 relative">
            <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Checkout Operation Failed</span>
            </div>
            <p className="text-zinc-300 pl-6 mt-0.5">{paymentError}</p>
          </div>
        )}

        {/* Main Plans Selection or Status Card */}
        {!paymentSuccess && !isPremium && (
          <div className="mt-8 flex flex-col gap-8 z-10 relative">
            
            {/* Grid Layout of Plans */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((plan) => {
                const isSelected = selectedPlan === plan.id;
                const IconComponent = plan.icon;
                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`border rounded-2xl p-6 flex flex-col justify-between cursor-pointer transition-all duration-200 relative group overflow-hidden ${plan.color} ${
                      isSelected 
                        ? 'ring-2 ring-indigo-500 border-transparent scale-[1.01] shadow-xl' 
                        : 'hover:border-zinc-700/80 hover:bg-zinc-900/20'
                    }`}
                  >
                    {plan.badge && (
                      <span className="absolute top-3 right-3 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500 text-white shadow-lg">
                        {plan.badge}
                      </span>
                    )}

                    <div className="space-y-4 text-left">
                      <div className="flex items-center gap-2.5">
                        <span className={`p-2 rounded-xl flex items-center justify-center border ${
                          isSelected ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800 border-zinc-750 text-zinc-400'
                        }`}>
                          <IconComponent className="w-4 h-4" />
                        </span>
                        <h3 className="font-extrabold text-zinc-200 text-sm">{plan.name}</h3>
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-black text-zinc-100">₹{plan.price}</span>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">one-time</span>
                      </div>

                      <ul className="space-y-2 text-xs text-zinc-400 border-t border-zinc-800/40 pt-4">
                        {plan.features.map((feat, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-indigo-400 shrink-0 font-bold">✓</span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-6 pt-3">
                      <div className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-center border transition-all ${
                        isSelected 
                          ? 'bg-indigo-600 text-white border-indigo-500' 
                          : 'bg-zinc-900/60 text-zinc-400 border-zinc-850 group-hover:bg-zinc-800/50'
                      }`}>
                        {isSelected ? 'Selected Plan' : 'Select Plan'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Amount Tier Selection */}
            <div className="bg-zinc-900/20 border border-zinc-850/60 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-500 animate-pulse" />
                  <h4 className="text-sm font-bold text-zinc-200">Support the Developers (Custom Donation)</h4>
                </div>
                <p className="text-xs text-zinc-500">Love GeminiPrompt? Fund our token usage costs by checking out with any amount you select.</p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedPlan('custom')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition-colors ${
                    selectedPlan === 'custom' 
                      ? 'bg-indigo-600 text-white border-indigo-500' 
                      : 'bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border-zinc-750'
                  }`}
                >
                  Custom Support
                </button>

                {selectedPlan === 'custom' && (
                  <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 focus-within:border-indigo-500 max-w-[140px] transition-colors">
                    <span className="text-sm font-bold text-zinc-500 mr-1.5">₹</span>
                    <input
                      type="number"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      min="1"
                      className="w-full bg-transparent border-none text-sm text-zinc-100 font-extrabold outline-none"
                      placeholder="150"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Pay Button Action */}
            <div className="border-t border-zinc-800/40 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-left">
                <p className="text-xs text-zinc-500 uppercase tracking-widest font-black">Checkout Target Amount</p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-3xl font-black text-zinc-100">
                    ₹{selectedPlan === 'custom' ? (parseFloat(customAmount) || 0).toLocaleString() : plans.find(p => p.id === selectedPlan)?.price}
                  </span>
                  <span className="text-xs font-mono text-zinc-500">INR</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handlePayment}
                disabled={isProcessing}
                className={`py-4 px-10 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2.5 border transition-all duration-200 w-full sm:w-auto ${
                  isProcessing
                    ? 'bg-indigo-850 text-indigo-300 border-indigo-750 cursor-wait animate-pulse'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-xl shadow-indigo-950/40 hover:scale-[1.01] cursor-pointer'
                }`}
              >
                {isProcessing ? (
                  <>
                    <span className="inline-block w-4 h-4 rounded-full bg-zinc-300 animate-spin border-2 border-indigo-950 border-t-transparent"></span>
                    <span>Opening Checkout Gateway...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    <span>Initiate Razorpay Checkout</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

          </div>
        )}

        {/* Informational State if Already Premium */}
        {isPremium && !paymentSuccess && (
          <div className="mt-8 bg-zinc-900/20 border border-zinc-800/40 p-8 rounded-2xl text-center space-y-4">
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-950/10">
              <Trophy className="w-6 h-6 text-indigo-400 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-black text-zinc-100 uppercase tracking-tight">You're a Premium Master</h3>
              <p className="text-xs text-zinc-400 max-w-lg mx-auto">
                Thank you for supporting GeminiPrompt! Your premium status is currently active, granting you absolute priority queue access and unlimited generation resources.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-emerald-400 bg-emerald-950/30 border border-emerald-900/30 px-4 py-2 rounded-full">
              <span>Verified VIP Authorization Status</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
