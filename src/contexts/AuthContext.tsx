import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider, signInWithPopup, signOut, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserProfile, ShopItem, PointTransaction } from '../types';
import { GAME_CONFIG } from '../config/gameRules';
import { sounds } from '../lib/sound';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
  updateProfileAvatar: (url: string) => Promise<void>;
  purchaseItem: (item: ShopItem) => Promise<{ success: boolean; message: string }>;
  equipItem: (category: 'frame' | 'board' | 'dice' | 'token', itemId: string) => Promise<void>;
  recordGameOutcome: (won: boolean) => Promise<{ pointsEarned: number; xpEarned: number; leveledUp: boolean; newLevel: number }>;
  claimDailyReward: () => Promise<{ success: boolean; points: number; message: string }>;
  userTransactions: PointTransaction[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [userTransactions, setUserTransactions] = useState<PointTransaction[]>([]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeTx: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (!userDocSnap.exists()) {
            // New user registration
            const randomCode = Math.floor(100000 + Math.random() * 900000);
            const generatedPlayerId = `SG-${randomCode}`;
            const initialProfile: UserProfile = {
              id: user.uid,
              playerId: generatedPlayerId,
              displayName: user.displayName || `ကစားသမား_${randomCode}`,
              email: user.email || '',
              photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
              level: 1,
              xp: GAME_CONFIG.INITIAL_WELCOME_XP,
              points: GAME_CONFIG.INITIAL_WELCOME_POINTS,
              totalWins: 0,
              totalGames: 0,
              activeFrame: 'frame_gold',
              activeBoardSkin: 'board_classic',
              activeDiceSkin: 'dice_classic',
              activeTokenSkin: 'token_crown',
              inventory: ['frame_gold', 'board_classic', 'dice_classic', 'token_crown'],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            await setDoc(userDocRef, initialProfile);

            // Record initial welcome bonus transaction
            await addDoc(collection(db, 'transactions'), {
              userId: user.uid,
              type: 'welcome_bonus',
              amount: GAME_CONFIG.INITIAL_WELCOME_POINTS,
              description: 'ပလက်ဖောင်းသို့ ပထမဆုံးဝင်ရောက်မှုအတွက် ကြိုဆိုဆုလက်ဆောင် ရွှေဒင်္ဂါး',
              createdAt: new Date().toISOString(),
              timestamp: serverTimestamp(),
            });
          }

          // Real-time listener for current user's profile
          unsubscribeProfile = onSnapshot(
            userDocRef,
            (snapshot) => {
              if (snapshot.exists()) {
                const rawProfile = snapshot.data() as UserProfile;
                setUserProfile({
                  ...rawProfile,
                  id: rawProfile.id || snapshot.id || user.uid,
                });
              }
            },
            (error) => {
              handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
            }
          );

          // Real-time listener for transactions
          const txCollection = collection(db, 'transactions');
          unsubscribeTx = onSnapshot(
            txCollection,
            (snapshot) => {
              const allTx: PointTransaction[] = [];
              snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.userId === user.uid) {
                  allTx.push({
                    id: docSnap.id,
                    userId: data.userId,
                    type: data.type,
                    amount: data.amount,
                    description: data.description,
                    createdAt: data.createdAt,
                  });
                }
              });
              allTx.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
              setUserTransactions(allTx);
            },
            (error) => {
              console.warn('Transactions listener non-blocking error:', error);
            }
          );
        } catch (error) {
          console.error('Error fetching/creating user profile:', error);
        }
      } else {
        setUserProfile(null);
        setUserTransactions([]);
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeTx) unsubscribeTx();
    };
  }, []);

  const loginWithGoogle = async () => {
    sounds.playClick();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const logout = async () => {
    sounds.playClick();
    try {
      await signOut(auth);
      setUserProfile(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const updateProfileName = async (name: string) => {
    if (!currentUser || !userProfile) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const userDocRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDocRef, {
        displayName: trimmed,
        updatedAt: new Date().toISOString(),
      });
      sounds.playClick();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const updateProfileAvatar = async (url: string) => {
    if (!currentUser || !userProfile) return;
    const userDocRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDocRef, {
        photoURL: url,
        updatedAt: new Date().toISOString(),
      });
      sounds.playClick();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const purchaseItem = async (item: ShopItem): Promise<{ success: boolean; message: string }> => {
    if (!currentUser || !userProfile) {
      return { success: false, message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။' };
    }

    if (userProfile.inventory.includes(item.id)) {
      return { success: false, message: 'ဤပစ္စည်းကို ပိုင်ဆိုင်ပြီးဖြစ်ပါသည်။' };
    }

    if (userProfile.points < item.price) {
      return { success: false, message: 'လက်ကျန် ရွှေဒင်္ဂါး မလုံလောက်ပါ။ ဂိမ်းကစားပြီး အမှတ်ရှာနိုင်ပါသည်။' };
    }

    const updatedPoints = userProfile.points - item.price;
    const updatedInventory = [...userProfile.inventory, item.id];
    const userDocRef = doc(db, 'users', currentUser.uid);

    try {
      await updateDoc(userDocRef, {
        points: updatedPoints,
        inventory: updatedInventory,
        updatedAt: new Date().toISOString(),
      });

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.uid,
        type: 'shop_purchase',
        amount: -item.price,
        description: `ဆိုင်မှ "${item.name}" ကို ဝယ်ယူခဲ့သည်`,
        createdAt: new Date().toISOString(),
      });

      sounds.playPurchase();
      return { success: true, message: `"${item.name}" ကို အောင်မြင်စွာ ဝယ်ယူပြီးပါပြီ!` };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
      return { success: false, message: 'ဝယ်ယူမှု မအောင်မြင်ပါ။ ပြန်လည်ကြိုးစားကြည့်ပါ။' };
    }
  };

  const equipItem = async (category: 'frame' | 'board' | 'dice' | 'token', itemId: string) => {
    if (!currentUser || !userProfile) return;
    if (!userProfile.inventory.includes(itemId)) return;

    const userDocRef = doc(db, 'users', currentUser.uid);
    const updates: Partial<UserProfile> = {
      updatedAt: new Date().toISOString(),
    };

    if (category === 'frame') updates.activeFrame = itemId;
    if (category === 'board') updates.activeBoardSkin = itemId;
    if (category === 'dice') updates.activeDiceSkin = itemId;
    if (category === 'token') updates.activeTokenSkin = itemId;

    try {
      await updateDoc(userDocRef, updates);
      sounds.playClick();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const recordGameOutcome = async (won: boolean) => {
    if (!currentUser || !userProfile) {
      return { pointsEarned: 0, xpEarned: 0, leveledUp: false, newLevel: 1 };
    }

    const pointsEarned = won ? GAME_CONFIG.WIN_REWARD_POINTS : GAME_CONFIG.PARTICIPATION_POINTS;
    const xpEarned = won ? GAME_CONFIG.WIN_REWARD_XP : GAME_CONFIG.PARTICIPATION_XP;

    let currentLvl = userProfile.level;
    let newXp = userProfile.xp + xpEarned;
    let leveledUp = false;

    // Check level up condition
    let requiredXp = GAME_CONFIG.getXpForLevel(currentLvl);
    while (newXp >= requiredXp) {
      newXp -= requiredXp;
      currentLvl += 1;
      leveledUp = true;
      requiredXp = GAME_CONFIG.getXpForLevel(currentLvl);
    }

    const newWins = won ? userProfile.totalWins + 1 : userProfile.totalWins;
    const newTotalGames = userProfile.totalGames + 1;
    const newPoints = userProfile.points + pointsEarned;

    const userDocRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDocRef, {
        points: newPoints,
        xp: newXp,
        level: currentLvl,
        totalWins: newWins,
        totalGames: newTotalGames,
        updatedAt: new Date().toISOString(),
      });

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.uid,
        type: won ? 'win_reward' : 'play_reward',
        amount: pointsEarned,
        description: won ? 'မြွေနှင့်လှေကားဂိမ်း အနိုင်ရရှိမှုဆု' : 'မြွေနှင့်လှေကားဂိမ်း ပါဝင်ကစားမှုဆု',
        createdAt: new Date().toISOString(),
      });

      return { pointsEarned, xpEarned, leveledUp, newLevel: currentLvl };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
      return { pointsEarned, xpEarned, leveledUp, newLevel: currentLvl };
    }
  };

  const claimDailyReward = async () => {
    if (!currentUser || !userProfile) {
      return { success: false, points: 0, message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။' };
    }

    // Check last daily reward from transactions
    const lastDaily = userTransactions.find((tx) => tx.type === 'daily_reward');
    if (lastDaily) {
      const lastDate = new Date(lastDaily.createdAt);
      const now = new Date();
      if (
        lastDate.getDate() === now.getDate() &&
        lastDate.getMonth() === now.getMonth() &&
        lastDate.getFullYear() === now.getFullYear()
      ) {
        return { success: false, points: 0, message: 'ယနေ့အတွက် နေ့စဉ်ဆုလက်ဆောင် ထုတ်ယူပြီးဖြစ်ပါသည်။ မနက်ဖြန်တွင် ပြန်လာခဲ့ပါ။' };
      }
    }

    const points = GAME_CONFIG.DAILY_REWARD_POINTS;
    const xp = GAME_CONFIG.DAILY_REWARD_XP;
    const userDocRef = doc(db, 'users', currentUser.uid);

    let currentLvl = userProfile.level;
    let newXp = userProfile.xp + xp;
    let requiredXp = GAME_CONFIG.getXpForLevel(currentLvl);
    while (newXp >= requiredXp) {
      newXp -= requiredXp;
      currentLvl += 1;
      requiredXp = GAME_CONFIG.getXpForLevel(currentLvl);
    }

    try {
      await updateDoc(userDocRef, {
        points: userProfile.points + points,
        xp: newXp,
        level: currentLvl,
        updatedAt: new Date().toISOString(),
      });

      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.uid,
        type: 'daily_reward',
        amount: points,
        description: 'နေ့စဉ် Login ဝင်ရောက်မှုအတွက် ဆုလက်ဆောင်',
        createdAt: new Date().toISOString(),
      });

      sounds.playVictory();
      return { success: true, points, message: `ယနေ့အတွက် နေ့စဉ်ဆုလက်ဆောင် ${points} ရွှေဒင်္ဂါး ရရှိပါသည်!` };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
      return { success: false, points: 0, message: 'ဆုလက်ဆောင် ထုတ်ယူမှု မအောင်မြင်ပါ။' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        loginWithGoogle,
        logout,
        updateProfileName,
        updateProfileAvatar,
        purchaseItem,
        equipItem,
        recordGameOutcome,
        claimDailyReward,
        userTransactions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
