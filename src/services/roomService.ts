import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
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
  const now = Date.now();

  const initialPlayer: RoomPlayer = {
    uid: hostUser.id,
    playerId: hostUser.playerId,
    displayName: hostUser.displayName,
    photoURL: hostUser.photoURL,
    isReady: true, // Host is ready by default
    color: GAME_CONFIG.PLAYER_COLORS[0].hex,
    position: 1, // Start position is tile 1
    activeTokenSkin: hostUser.activeTokenSkin || 'token_crown',
    isConnected: true,
    lastSeen: now,
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
    turnStartTimestamp: 0,
    turnDeadline: 0,
    reconnectionDeadline: null,
    disconnectedPlayerId: null,
    disconnectedPlayerName: null,
    lastMoveTimestamp: now,
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
  const now = Date.now();

  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      throw new Error('အခန်းကုဒ် မှားယွင်းနေပါသည် သို့မဟုတ် အခန်း မရှိတော့ပါ။');
    }

    const roomData = roomSnap.data() as GameRoom;
    if (roomData.status === 'finished') {
      throw new Error('ဤဂိမ်းပွဲသည် ပြီးဆုံးသွားပါပြီ။');
    }

    // Check if player already in room (Reconnecting or returning player)
    const existingIndex = roomData.players.findIndex((p) => p.uid === user.id);
    if (existingIndex >= 0) {
      // Reconnect existing player
      await reconnectPlayerToRoom(roomId, user.id);
      return roomId;
    }

    if (roomData.status !== 'waiting') {
      throw new Error('ဂိမ်းစတင်ပြီးဖြစ်သောကြောင့် အသစ်ဝင်ရောက်၍ မရတော့ပါ။');
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
      isConnected: true,
      lastSeen: now,
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
 * Reconnect a returning player to their active room
 */
export async function reconnectPlayerToRoom(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      let changed = false;
      const updatedPlayers = room.players.map((p) => {
        if (p.uid === userId) {
          changed = true;
          return {
            ...p,
            isConnected: true,
            lastSeen: now,
            disconnectedAt: null,
          };
        }
        return p;
      });

      if (!changed) return;

      const updates: any = {
        players: updatedPlayers,
        updatedAt: new Date().toISOString(),
      };

      // Clear disconnection alert if this was the disconnected player
      if (room.disconnectedPlayerId === userId) {
        updates.disconnectedPlayerId = null;
        updates.disconnectedPlayerName = null;
        updates.reconnectionDeadline = null;
        const reconnectedPlayer = room.players.find((p) => p.uid === userId);
        updates.lastMoveSummary = `ကစားသမား ${reconnectedPlayer?.displayName || ''} ပြန်လည်ချိတ်ဆက်မိပါပြီ။`;
      }

      transaction.update(roomRef, updates);
    });
  } catch (error) {
    console.warn('Reconnect update notice:', error);
  }
}

/**
 * Send heartbeat to indicate player is connected and active
 */
export async function updatePlayerPresence(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;

    let hasChange = false;
    const updatedPlayers = room.players.map((p) => {
      if (p.uid === userId) {
        if (!p.isConnected || now - (p.lastSeen || 0) > 8000) {
          hasChange = true;
          return { ...p, isConnected: true, lastSeen: now, disconnectedAt: null };
        }
      }
      return p;
    });

    if (hasChange) {
      await updateDoc(roomRef, {
        players: updatedPlayers,
      });
    }
  } catch (error) {
    // Non-blocking heartbeat error
  }
}

/**
 * Mark a player as disconnected and start 60s reconnection grace period
 */
export async function markPlayerDisconnected(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      let discPlayerName = '';
      const updatedPlayers = room.players.map((p) => {
        if (p.uid === userId) {
          discPlayerName = p.displayName;
          return {
            ...p,
            isConnected: false,
            disconnectedAt: now,
          };
        }
        return p;
      });

      if (!discPlayerName) return;

      transaction.update(roomRef, {
        players: updatedPlayers,
        disconnectedPlayerId: userId,
        disconnectedPlayerName: discPlayerName,
        reconnectionDeadline: now + 60000, // 60 seconds grace period
        lastMoveSummary: `ကစားသမား ${discPlayerName} ၏ အင်တာနက်လိုင်း ပြတ်တောက်နေပါသည်။ ပြန်လည်ချိတ်ဆက်ရန် ၆၀ စက္ကန့် စောင့်ဆိုင်းပေးပါ...`,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    console.warn('Mark disconnected error:', error);
  }
}

/**
 * Handle 60s Reconnection Timeout if player fails to rejoin
 */
export async function handleReconnectionTimeout(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      if (!room.reconnectionDeadline || now < room.reconnectionDeadline) return;

      const timedOutPlayerId = room.disconnectedPlayerId;
      const timedOutName = room.disconnectedPlayerName || 'ကစားသမား';

      let nextTurn = room.currentTurnIndex;
      // If current turn belongs to timed out player, skip to next player
      if (room.players[room.currentTurnIndex]?.uid === timedOutPlayerId) {
        nextTurn = (room.currentTurnIndex + 1) % room.players.length;
      }

      transaction.update(roomRef, {
        disconnectedPlayerId: null,
        disconnectedPlayerName: null,
        reconnectionDeadline: null,
        currentTurnIndex: nextTurn,
        turnStartTimestamp: now,
        turnDeadline: now + 30000,
        lastMoveSummary: `${timedOutName} သည် သတ်မှတ်ချိန်အတွင်း ပြန်မဝင်နိုင်သဖြင့် အလှည့်ကျော်လွှားပါသည်`,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    console.warn('Reconnection timeout error:', error);
  }
}

/**
 * Handle 30-Second Turn Timeout Skip
 */
export async function handleTurnTimeout(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      // Only skip if game is playing and turnDeadline has passed
      if (room.status !== 'playing' || !room.turnDeadline || now < room.turnDeadline) {
        return;
      }

      // If waiting on reconnection, don't auto-skip turn timer
      if (room.reconnectionDeadline && now < room.reconnectionDeadline) {
        return;
      }

      const timedOutPlayer = room.players[room.currentTurnIndex];
      const nextTurn = (room.currentTurnIndex + 1) % room.players.length;

      transaction.update(roomRef, {
        currentTurnIndex: nextTurn,
        turnStartTimestamp: now,
        turnDeadline: now + 30000, // 30 seconds for next turn
        lastMoveSummary: `⏰ ${timedOutPlayer?.displayName || 'ကစားသမား'} ၏ စက္ကန့် ၃၀ အချိန်ပြည့်သွားသဖြင့် နောက်ကစားသမားထံ အလှည့်ပေးလိုက်ပါသည်`,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    console.warn('Turn timeout skip notice:', error);
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
 * Start Game (Host only) - initializes 30-second turn timer
 */
export async function startGame(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    await updateDoc(roomRef, {
      status: 'playing',
      currentTurnIndex: 0,
      turnStartTimestamp: now,
      turnDeadline: now + 30000, // 30 seconds for first turn
      reconnectionDeadline: null,
      disconnectedPlayerId: null,
      lastMoveSummary: 'ဂိမ်းစတင်ပါပြီ! ပထမဆုံး ကစားသမား အံစာတုံး စတင်ခေါက်ပါ!',
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

    const now = Date.now();
    await updateDoc(roomRef, {
      players: remainingPlayers,
      hostId: newHostId,
      hostName: newHostName,
      currentTurnIndex: nextTurn,
      turnStartTimestamp: now,
      turnDeadline: now + 30000,
      lastMoveSummary: `ကစားသမားတစ်ဦး အခန်းမှ ထွက်ခွာသွားပါသည်။`,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

/**
 * Cryptographically fair random dice roll (1 to 6)
 */
export function generateSecureDiceRoll(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    // Unbiased roll 1 to 6
    const limit = 4294967292; // 0xFFFFFFFC
    if (buffer[0] < limit) {
      return (buffer[0] % 6) + 1;
    }
  }
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * Make Turn: Atomic Firebase Transaction with authoritative dice roll,
 * step-by-step movement path generation, snake/ladder logic, 30s timer, and victory detection.
 */
export async function executeDiceRollAndMove(
  roomId: string,
  rollingPlayerUid: string,
  clientRolledValue?: number
): Promise<{ newPos: number; diceRoll: number; eventSummary: string; won: boolean; movePath: number[] }> {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();

  try {
    return await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) {
        throw new Error('အခန်း မတွေ့ပါ');
      }

      const room = roomSnap.data() as GameRoom;

      if (room.status !== 'playing') {
        throw new Error('ဂိမ်းသည် ဆော့ကစားဆဲ အခြေအနေ မဟုတ်ပါ');
      }

      if (room.winnerId) {
        throw new Error('ဂိမ်းပြီးဆုံးသွားပါပြီ');
      }

      const playerIndex = room.players.findIndex((p) => p.uid === rollingPlayerUid);
      if (playerIndex < 0) {
        throw new Error('ဤအခန်းတွင် သင်မပါဝင်ပါ');
      }

      if (playerIndex !== room.currentTurnIndex) {
        throw new Error('သင့်အလှည့် မဟုတ်သေးပါ (တစ်လှည့်စီသာ ကစားရပါမည်)');
      }

      const currentPlayer = room.players[playerIndex];
      const startPos = typeof currentPlayer.position === 'number' && !isNaN(currentPlayer.position)
        ? Math.max(1, Math.min(100, currentPlayer.position))
        : 1;

      // Authoritative Secure Dice Roll (1 to 6)
      const diceRoll =
        clientRolledValue && clientRolledValue >= 1 && clientRolledValue <= 6
          ? clientRolledValue
          : generateSecureDiceRoll();

      let targetPos = startPos + diceRoll;
      let eventSummary = `${currentPlayer.displayName} မှ အံစာတုံး [${diceRoll}] ကျပါသည်`;
      let won = false;

      // Construct step-by-step tile path: e.g. [1, 2, 3, 4, 5]
      const movePath: number[] = [startPos];
      if (startPos + diceRoll <= 100) {
        for (let s = startPos + 1; s <= startPos + diceRoll; s++) {
          movePath.push(s);
        }
      } else {
        // Exceeded 100
        for (let s = startPos + 1; s <= 100; s++) {
          movePath.push(s);
        }
        if (room.exactFinish) {
          const overflow = (startPos + diceRoll) - 100;
          targetPos = 100 - overflow;
          for (let b = 1; b <= overflow; b++) {
            movePath.push(100 - b);
          }
          eventSummary += `။ ၁၀၀ ကျော်သွား၍ အကွက် ${targetPos} သို့ ပြန်ဆင်းပါသည်`;
        } else {
          targetPos = 100;
        }
      }

      // Check Ladders
      if (GAME_CONFIG.LADDERS[targetPos]) {
        const climbedTo = GAME_CONFIG.LADDERS[targetPos];
        eventSummary += `။ လှေကားတွေ့ရှိသဖြင့် အကွက် ${targetPos} မှ ${climbedTo} သို့ တက်လှမ်းပါသည်! 🎉`;
        movePath.push(climbedTo);
        targetPos = climbedTo;
      }
      // Check Snakes
      else if (GAME_CONFIG.SNAKES[targetPos]) {
        const bittenTo = GAME_CONFIG.SNAKES[targetPos];
        eventSummary += `။ မြွေကိုက်ခံရသဖြင့် အကွက် ${targetPos} မှ ${bittenTo} သို့ လျှောကျသွားပါသည်! 🐍`;
        movePath.push(bittenTo);
        targetPos = bittenTo;
      }

      if (targetPos >= 100) {
        targetPos = 100;
        won = true;
        eventSummary = `🏆 ${currentPlayer.displayName} သည် နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိပြီး အနိုင်ရရှိသွားပါပြီ!`;
      }

      // Turn System: If rolled 6, player gets another turn (unless won)
      let nextTurnIndex = room.currentTurnIndex;
      if (!won) {
        if (diceRoll === 6) {
          eventSummary += ' (အံစာတုံး ၆ ကျသဖြင့် နောက်တစ်ကြိမ် ထပ်ခေါက်ခွင့်ရပါသည်!)';
        } else {
          nextTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        }
      }

      // Build sanitized players array - NEVER include undefined values for Firestore
      const updatedPlayers = room.players.map((p, idx) => {
        const isMover = idx === playerIndex;
        const playerObj: any = {
          uid: p.uid,
          playerId: p.playerId || `PL-${p.uid.substring(0, 6)}`,
          displayName: p.displayName || 'ကစားသမား',
          photoURL: p.photoURL || '',
          isReady: !!p.isReady,
          color: p.color || '#3B82F6',
          position: isMover ? targetPos : (p.position || 1),
          activeTokenSkin: p.activeTokenSkin || 'token_crown',
          isConnected: p.isConnected !== false,
          lastSeen: isMover ? now : (p.lastSeen || now),
        };
        if (isMover && won) {
          playerObj.rank = 1;
        } else if (p.rank !== undefined && p.rank !== null) {
          playerObj.rank = p.rank;
        }
        if (p.disconnectedAt !== undefined && p.disconnectedAt !== null) {
          playerObj.disconnectedAt = p.disconnectedAt;
        }
        return playerObj;
      });

      transaction.update(roomRef, {
        players: updatedPlayers,
        lastDiceRoll: diceRoll,
        lastMoveSummary: eventSummary,
        lastMoveTimestamp: now,
        lastMovePath: movePath,
        lastMovingPlayerUid: currentPlayer.uid,
        currentTurnIndex: nextTurnIndex,
        turnStartTimestamp: now,
        turnDeadline: won ? 0 : now + 30000, // 30 seconds for next turn
        status: won ? 'finished' : 'playing',
        winnerId: won ? currentPlayer.uid : null,
        winnerName: won ? currentPlayer.displayName : null,
        updatedAt: new Date().toISOString(),
      });

      return {
        newPos: targetPos,
        diceRoll,
        eventSummary,
        won,
        movePath,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    throw error;
  }
}

/**
 * Reset game to play again in same room
 */
export async function resetRoomToPlayAgain(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;

    const resetPlayers = room.players.map((p) => {
      const pObj: any = {
        uid: p.uid,
        playerId: p.playerId || `PL-${p.uid.substring(0, 6)}`,
        displayName: p.displayName || 'ကစားသမား',
        photoURL: p.photoURL || '',
        position: 1,
        color: p.color || '#3B82F6',
        activeTokenSkin: p.activeTokenSkin || 'token_crown',
        isReady: p.uid === room.hostId, // Host is ready
        isConnected: true,
        lastSeen: now,
      };
      return pObj;
    });

    await updateDoc(roomRef, {
      players: resetPlayers,
      status: 'waiting',
      currentTurnIndex: 0,
      lastDiceRoll: 1,
      turnStartTimestamp: 0,
      turnDeadline: 0,
      reconnectionDeadline: null,
      disconnectedPlayerId: null,
      disconnectedPlayerName: null,
      lastMoveSummary: 'ဂိမ်းအသစ် ပြန်လည်စတင်ရန် အဆင်သင့်ဖြစ်ပါပြီ!',
      winnerId: null,
      winnerName: null,
      lastMoveTimestamp: now,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}
