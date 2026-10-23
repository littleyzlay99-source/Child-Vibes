import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { GameRoom, RoomPlayer, UserProfile } from '../types';
import { GAME_CONFIG } from '../config/gameRules';

// Generate a random 6-character room code (e.g. SG8K29)
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new Game Room
 */
export async function createGameRoom(
  hostUser: UserProfile,
  maxPlayers: number = 4,
  exactFinish: boolean = false
): Promise<string> {
  const roomCode = generateRoomCode();
  const roomId = `room_${roomCode}`;
  const roomRef = doc(db, 'rooms', roomId);

  const initialPlayer: RoomPlayer = {
    uid: hostUser.id,
    playerId: hostUser.playerId,
    displayName: hostUser.displayName,
    photoURL: hostUser.photoURL,
    isReady: true, // Host is ready by default
    color: GAME_CONFIG.PLAYER_COLORS[0].hex,
    position: 1, // Start position is tile 1
    activeTokenSkin: hostUser.activeTokenSkin || 'token_crown',
  };

  const newRoom: GameRoom = {
    id: roomId,
    roomCode,
    gameType: 'snakes_and_ladders',
    hostId: hostUser.id,
    hostName: hostUser.displayName,
    status: 'waiting',
    maxPlayers,
    players: [initialPlayer],
    currentTurnIndex: 0,
    lastDiceRoll: 1,
    lastMoveSummary: `${hostUser.displayName} မှ အခန်းဖန်တီးထားပါသည်။`,
    winnerId: null,
    winnerName: null,
    exactFinish,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await setDoc(roomRef, {
      ...newRoom,
      timestamp: serverTimestamp(),
    });
    return roomId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${roomId}`);
    throw error;
  }
}

/**
 * Join an existing Game Room by 6-letter Room Code
 */
export async function joinGameRoomByCode(
  roomCodeInput: string,
  user: UserProfile
): Promise<string> {
  const cleanedCode = roomCodeInput.trim().toUpperCase();
  const roomId = `room_${cleanedCode}`;
  const roomRef = doc(db, 'rooms', roomId);

  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      throw new Error('အခန်းကုဒ် မှားယွင်းနေပါသည် သို့မဟုတ် အခန်း မရှိတော့ပါ။');
    }

    const roomData = roomSnap.data() as GameRoom;
    if (roomData.status !== 'waiting') {
      throw new Error('ဤဂိမ်းပွဲသည် စတင်ပြီး သို့မဟုတ် ပြီးဆုံးသွားပါပြီ။');
    }

    // Check if player already in room
    const existingIndex = roomData.players.findIndex((p) => p.uid === user.id);
    if (existingIndex >= 0) {
      return roomId; // Already in room, proceed
    }

    if (roomData.players.length >= roomData.maxPlayers) {
      throw new Error('အခန်းတွင် လူပြည့်နေပါပြီ (အများဆုံး ' + roomData.maxPlayers + ' ဦး)။');
    }

    // Pick unique color for new player
    const usedColors = roomData.players.map((p) => p.color);
    const availableColor =
      GAME_CONFIG.PLAYER_COLORS.find((c) => !usedColors.includes(c.hex))?.hex ||
      GAME_CONFIG.PLAYER_COLORS[roomData.players.length % GAME_CONFIG.PLAYER_COLORS.length].hex;

    const newPlayer: RoomPlayer = {
      uid: user.id,
      playerId: user.playerId,
      displayName: user.displayName,
      photoURL: user.photoURL,
      isReady: false,
      color: availableColor,
      position: 1,
      activeTokenSkin: user.activeTokenSkin || 'token_crown',
    };

    const updatedPlayers = [...roomData.players, newPlayer];

    await updateDoc(roomRef, {
      players: updatedPlayers,
      lastMoveSummary: `${user.displayName} အခန်းသို့ ဝင်ရောက်လာခဲ့သည်။`,
      updatedAt: new Date().toISOString(),
    });

    return roomId;
  } catch (error) {
    if (error instanceof Error && error.message.includes('အခန်း')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `rooms/${roomId}`);
    throw error;
  }
}

/**
 * Toggle Ready state of current player
 */
export async function togglePlayerReady(roomId: string, userId: string, isReady: boolean) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;

    const updatedPlayers = room.players.map((p) => {
      if (p.uid === userId) {
        return { ...p, isReady };
      }
      return p;
    });

    await updateDoc(roomRef, {
      players: updatedPlayers,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

/**
 * Start Game (Host only)
 */
export async function startGame(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await updateDoc(roomRef, {
      status: 'playing',
      currentTurnIndex: 0,
      lastMoveSummary: 'ဂိမ်းစတင်ပါပြီ! ကံကောင်းပါစေ!',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

/**
 * Leave Room
 */
export async function leaveGameRoom(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;

    const remainingPlayers = room.players.filter((p) => p.uid !== userId);

    if (remainingPlayers.length === 0) {
      // Delete empty room
      await deleteDoc(roomRef);
      return;
    }

    let newHostId = room.hostId;
    let newHostName = room.hostName;

    // If host left, assign host to first remaining player
    if (room.hostId === userId) {
      newHostId = remainingPlayers[0].uid;
      newHostName = remainingPlayers[0].displayName;
      remainingPlayers[0].isReady = true;
    }

    // Ensure valid currentTurnIndex
    let nextTurn = room.currentTurnIndex;
    if (nextTurn >= remainingPlayers.length) {
      nextTurn = 0;
    }

    await updateDoc(roomRef, {
      players: remainingPlayers,
      hostId: newHostId,
      hostName: newHostName,
      currentTurnIndex: nextTurn,
      lastMoveSummary: `ကစားသမားတစ်ဦး အခန်းမှ ထွက်ခွာသွားပါသည်။`,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

/**
 * Make Turn: Roll Dice, calculate next position with snakes & ladders, check win condition
 */
export async function executeDiceRollAndMove(
  roomId: string,
  rollingPlayerUid: string,
  diceRoll: number
): Promise<{ newPos: number; eventSummary: string; won: boolean }> {
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) {
    throw new Error('အခန်း မတွေ့ပါ');
  }

  const room = roomSnap.data() as GameRoom;
  const playerIndex = room.players.findIndex((p) => p.uid === rollingPlayerUid);
  if (playerIndex < 0 || playerIndex !== room.currentTurnIndex) {
    throw new Error('သင့်အလှည့် မဟုတ်သေးပါ');
  }

  const currentPlayer = room.players[playerIndex];
  let targetPos = currentPlayer.position + diceRoll;
  let eventSummary = `${currentPlayer.displayName} မှ အံစာတုံး [${diceRoll}] ကျပါသည်`;
  let won = false;

  if (targetPos > 100) {
    if (room.exactFinish) {
      // Exact roll required: bounces back
      const overflow = targetPos - 100;
      targetPos = 100 - overflow;
      eventSummary += `။ ၁၀၀ ကျော်သွား၍ အကွက် ${targetPos} သို့ ပြန်ဆင်းပါသည်`;
    } else {
      // Reached 100
      targetPos = 100;
    }
  }

  // Check Ladders
  if (GAME_CONFIG.LADDERS[targetPos]) {
    const climbedTo = GAME_CONFIG.LADDERS[targetPos];
    eventSummary += `။ လှေကားတွေ့ရှိသဖြင့် အကွက် ${targetPos} မှ ${climbedTo} သို့ တက်လှမ်းပါသည်! 🎉`;
    targetPos = climbedTo;
  }
  // Check Snakes
  else if (GAME_CONFIG.SNAKES[targetPos]) {
    const bittenTo = GAME_CONFIG.SNAKES[targetPos];
    eventSummary += `။ မြွေကိုက်ခံရသဖြင့် အကွက် ${targetPos} မှ ${bittenTo} သို့ လျှောကျသွားပါသည်! 🐍`;
    targetPos = bittenTo;
  }

  if (targetPos >= 100) {
    targetPos = 100;
    won = true;
    eventSummary = `🏆 ${currentPlayer.displayName} သည် နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိပြီး အနိုင်ရရှိသွားပါပြီ!`;
  }

  // Next player's turn (rolling 6 gives extra turn if standard rules, or cycle turn)
  let nextTurnIndex = room.currentTurnIndex;
  if (!won) {
    if (diceRoll === 6) {
      eventSummary += ' (အံစာတုံး ၆ ကျသဖြင့် နောက်တစ်ကြိမ် ထပ်ခေါက်ခွင့်ရရှိပါသည်!)';
    } else {
      nextTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    }
  }

  const updatedPlayers = room.players.map((p, idx) => {
    if (idx === playerIndex) {
      return {
        ...p,
        position: targetPos,
        rank: won ? 1 : p.rank,
      };
    }
    return p;
  });

  await updateDoc(roomRef, {
    players: updatedPlayers,
    lastDiceRoll: diceRoll,
    lastMoveSummary: eventSummary,
    currentTurnIndex: nextTurnIndex,
    status: won ? 'finished' : 'playing',
    winnerId: won ? currentPlayer.uid : null,
    winnerName: won ? currentPlayer.displayName : null,
    updatedAt: new Date().toISOString(),
  });

  return { newPos: targetPos, eventSummary, won };
}

/**
 * Reset game to play again in same room
 */
export async function resetRoomToPlayAgain(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) return;
  const room = roomSnap.data() as GameRoom;

  const resetPlayers = room.players.map((p) => ({
    ...p,
    position: 1,
    isReady: p.uid === room.hostId, // Host is ready
    rank: undefined,
  }));

  await updateDoc(roomRef, {
    players: resetPlayers,
    status: 'waiting',
    currentTurnIndex: 0,
    lastDiceRoll: 1,
    lastMoveSummary: 'ဂိမ်းအသစ် ပြန်လည်စတင်ရန် အဆင်သင့်ဖြစ်ပါပြီ!',
    winnerId: null,
    winnerName: null,
    updatedAt: new Date().toISOString(),
  });
}
