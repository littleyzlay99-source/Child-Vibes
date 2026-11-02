import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  limit,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { UserProfile, ShopItem, PointTransaction, MatchRewardResult } from '../types';
import { REWARD_CONFIG } from '../config/rewardConfig';
import { deriveLevelProgress, normalizeUserProfile } from '../services/progressionService';
import {
  claimAchievementRewardTransaction,
  claimDailyLoginRewardTransaction,
  claimMatchReward,
  invalidateLeaderboardCache,
  purchaseShopItemTransaction,
} from '../services/rewardService';
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
  claimRoomMatchReward: (roomId: string, gameRound?: number) => Promise<MatchRewardResult>;
  claimDailyReward: () => Promise<{ success: boolean; points: number; xp?: number; message: string }>;
  claimAchievementReward: (
    achievementId: string
  ) => Promise<{ success: boolean; points: number; xp: number; message: string }>;
  userTransactions: PointTransaction[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [userTransactions, setUserTransactions] = useState<PointTransaction[]>([]);
  const loginInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeTx: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      if (unsubscribeTx) {
        unsubscribeTx();
        unsubscribeTx = null;
      }

      setCurrentUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (!userDocSnap.exists()) {
            // New user registration using centralized REWARD_CONFIG
            const randomCode = Math.floor(100000 + Math.random() * 900000);
            const generatedPlayerId = `SG-${randomCode}`;
            const nowIso = new Date().toISOString();
            const initialWelcomeXp = REWARD_CONFIG.WELCOME_BONUS.xp;
            const initialWelcomePoints = REWARD_CONFIG.WELCOME_BONUS.points;
            const initialProgress = deriveLevelProgress(initialWelcomeXp);

            const initialProfile: UserProfile = {
              id: user.uid,
              playerId: generatedPlayerId,
              displayName: (user.displayName || `ကစားသမား_${randomCode}`).slice(0, 60),
              email: (user.email || '').slice(0, 120),
              photoURL: (
                user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`
              ).slice(0, 1000),
              level: initialProgress.level,
              xp: initialProgress.currentLevelXp,
              totalXp: initialProgress.totalXp,
              points: initialWelcomePoints,
              currentPoints: initialWelcomePoints,
              totalPointsEarned: initialWelcomePoints,
              totalWins: 0,
              totalGames: 0,
              activeFrame: 'frame_gold',
              activeBoardSkin: 'board_classic',
              activeDiceSkin: 'dice_classic',
              activeTokenSkin: 'token_crown',
              inventory: ['frame_gold', 'board_classic', 'dice_classic', 'token_crown'],
              claimedAchievements: [],
              lastClaimId: null,
              lastDailyClaimId: null,
              lastAchievementClaimId: null,
              activeRoomId: null,
              activeRoomCode: null,
              activeGameType: null,
              createdAt: nowIso,
              updatedAt: nowIso,
            };

            await setDoc(userDocRef, initialProfile);

            // Record initial welcome bonus transaction with deterministic ID
            const welcomeTxId = `tx_welcome_${user.uid}`;
            await setDoc(doc(db, 'transactions', welcomeTxId), {
              id: welcomeTxId,
              userId: user.uid,
              type: 'welcome_bonus',
              amount: initialWelcomePoints,
              xpAmount: initialWelcomeXp,
              description: REWARD_CONFIG.WELCOME_BONUS.descriptionMm,
              createdAt: nowIso,
            });
            invalidateLeaderboardCache();
          } else {
            // Backward-compatible one-time normalization for pre-upgrade user profiles
            const rawData = userDocSnap.data() as Partial<UserProfile>;
            const needsMigration =
              typeof rawData.totalXp !== 'number' ||
              typeof rawData.currentPoints !== 'number' ||
              typeof rawData.totalPointsEarned !== 'number';

            if (needsMigration) {
              const normalized = normalizeUserProfile(rawData, user.uid);
              try {
                await updateDoc(userDocRef, {
                  totalXp: normalized.totalXp,
                  level: normalized.level,
                  xp: normalized.xp,
                  points: normalized.points,
                  currentPoints: normalized.currentPoints,
                  totalPointsEarned: normalized.totalPointsEarned,
                  updatedAt: new Date().toISOString(),
                });
                invalidateLeaderboardCache();
              } catch (migErr) {
                console.warn('Legacy profile normalization skipped:', migErr);
              }
            }
          }

          // Real-time listener for current user's profile
          unsubscribeProfile = onSnapshot(
            userDocRef,
            (snapshot) => {
              if (snapshot.exists()) {
                const rawProfile = snapshot.data() as UserProfile;
                setUserProfile(
                  normalizeUserProfile(rawProfile, rawProfile.id || snapshot.id || user.uid)
                );
              }
            },
            (error) => {
              handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
            }
          );

          // Scoped query for current user's transactions ONLY (Spark Free Plan frugal + secure rule compliant)
          const txQuery = query(
            collection(db, 'transactions'),
            where('userId', '==', user.uid),
            limit(30)
          );
          unsubscribeTx = onSnapshot(
            txQuery,
            (snapshot) => {
              const allTx: PointTransaction[] = [];
              snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                allTx.push({
                  id: docSnap.id,
                  userId: data.userId,
                  type: data.type,
                  amount: data.amount,
                  xpAmount: data.xpAmount,
                  description: data.description,
                  createdAt: data.createdAt,
                });
              });
              allTx.sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              );
              setUserTransactions(allTx);
            },
            (error) => {
              console.warn('Transactions listener non-blocking notice:', error);
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
    if (loginInFlightRef.current) {
      return loginInFlightRef.current;
    }

    // Call signInWithPopup synchronously first to preserve browser user-gesture activation
    const popupPromise = signInWithPopup(auth, googleProvider);
    sounds.playClick();

    const task = (async () => {
      try {
        await popupPromise;
      } finally {
        loginInFlightRef.current = null;
      }
    })();

    loginInFlightRef.current = task;
    return task;
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
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const userDocRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDocRef, {
        displayName: trimmed,
        updatedAt: new Date().toISOString(),
      });
      invalidateLeaderboardCache();
      sounds.playClick();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const updateProfileAvatar = async (url: string) => {
    if (!currentUser || !userProfile) return;
    const safeUrl = url.trim().slice(0, 1000);
    if (!safeUrl) return;
    const userDocRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDocRef, {
        photoURL: safeUrl,
        updatedAt: new Date().toISOString(),
      });
      invalidateLeaderboardCache();
      sounds.playClick();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const purchaseItem = async (
    item: ShopItem
  ): Promise<{ success: boolean; message: string }> => {
    if (!currentUser || !userProfile) {
      return { success: false, message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။' };
    }

    const result = await purchaseShopItemTransaction(currentUser.uid, item.id);
    if (result.success) {
      sounds.playPurchase();
    }
    return result;
  };

  const equipItem = async (
    category: 'frame' | 'board' | 'dice' | 'token',
    itemId: string
  ) => {
    if (!currentUser || !userProfile) return;
    if (!userProfile.inventory.includes(itemId)) return;

    const userDocRef = doc(db, 'users', currentUser.uid);
    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (category === 'frame') updates.activeFrame = itemId;
    if (category === 'board') updates.activeBoardSkin = itemId;
    if (category === 'dice') updates.activeDiceSkin = itemId;
    if (category === 'token') updates.activeTokenSkin = itemId;

    try {
      await updateDoc(userDocRef, updates);
      if (category === 'frame') {
        invalidateLeaderboardCache();
      }
      sounds.playClick();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const claimRoomMatchReward = async (
    roomId: string,
    gameRound?: number
  ): Promise<MatchRewardResult> => {
    if (!currentUser) {
      throw new Error('ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။');
    }
    return claimMatchReward(roomId, gameRound, currentUser.uid);
  };

  const claimDailyReward = async () => {
    if (!currentUser || !userProfile) {
      return { success: false, points: 0, message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။' };
    }

    const res = await claimDailyLoginRewardTransaction(currentUser.uid);
    if (res.success) {
      sounds.playVictory();
    }
    return res;
  };

  const claimAchievementReward = async (achievementId: string) => {
    if (!currentUser || !userProfile) {
      return {
        success: false,
        points: 0,
        xp: 0,
        message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။',
      };
    }

    const res = await claimAchievementRewardTransaction(currentUser.uid, achievementId);
    if (res.success) {
      sounds.playVictory();
    }
    return res;
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
        claimRoomMatchReward,
        claimDailyReward,
        claimAchievementReward,
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
