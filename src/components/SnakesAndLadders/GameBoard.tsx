import React, { useMemo, useState, useEffect, useRef } from 'react';
import { RoomPlayer } from '../../types';
import { GAME_CONFIG } from '../../config/gameRules';
import { Crown, Star, Gem, ShieldAlert, Sparkles, WifiOff } from 'lucide-react';
import { sounds } from '../../lib/sound';

interface GameBoardProps {
  players: RoomPlayer[];
  currentTurnIndex: number;
  boardSkin?: string;
  movingPlayerId?: string | null;
  lastMovePath?: number[];
  lastMoveTimestamp?: number;
  lastMovingPlayerUid?: string | null;
}

// Convert tile number (1-100) to percentage coordinates (0-100%)
export function getTileCoordinates(tileNumber: number): { x: number; y: number } {
  const safeTile = Math.max(1, Math.min(100, Math.round(tileNumber || 1)));
  const zeroIndexed = safeTile - 1;
  const rowFromBottom = Math.floor(zeroIndexed / 10);
  const colInRow = zeroIndexed % 10;
  const col = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;
  const rowFromTop = 9 - rowFromBottom;

  return {
    x: col * 10 + 5,
    y: rowFromTop * 10 + 5,
  };
}

export const GameBoard: React.FC<GameBoardProps> = ({
  players,
  currentTurnIndex,
  boardSkin = 'board_classic',
  movingPlayerId,
  lastMovePath,
  lastMoveTimestamp,
  lastMovingPlayerUid,
}) => {
  // Local animated positions map: { [playerUid]: currentAnimatedTile }
  const [animatedPositions, setAnimatedPositions] = useState<{ [uid: string]: number }>({});
  const lastAnimatedTimestampRef = useRef<number>(0);

  // Sync positions when players update or when starting
  useEffect(() => {
    setAnimatedPositions((prev) => {
      const next: { [uid: string]: number } = { ...prev };
      players.forEach((p) => {
        if (next[p.uid] === undefined) {
          next[p.uid] = p.position || 1;
        }
      });
      return next;
    });
  }, [players]);

  // Step-by-step Tile Walking Animation
  useEffect(() => {
    if (
      lastMoveTimestamp &&
      lastMoveTimestamp !== lastAnimatedTimestampRef.current &&
      lastMovePath &&
      lastMovePath.length > 1 &&
      lastMovingPlayerUid
    ) {
      lastAnimatedTimestampRef.current = lastMoveTimestamp;
      const targetPlayerUid = lastMovingPlayerUid;
      const path = [...lastMovePath];

      let currentIndex = 0;
      // Start at initial path tile
      setAnimatedPositions((prev) => ({
        ...prev,
        [targetPlayerUid]: path[0],
      }));

      const stepInterval = setInterval(() => {
        currentIndex++;
        if (currentIndex < path.length) {
          const nextTile = path[currentIndex];
          setAnimatedPositions((prev) => ({
            ...prev,
            [targetPlayerUid]: nextTile,
          }));

          // Play sound
          if (GAME_CONFIG.LADDERS[nextTile]) {
            sounds.playLadder();
          } else if (GAME_CONFIG.SNAKES[nextTile]) {
            sounds.playSnake();
          } else {
            sounds.playStep();
          }
        } else {
          clearInterval(stepInterval);
          // Settle to final server player position
          const finalPlayer = players.find((p) => p.uid === targetPlayerUid);
          if (finalPlayer) {
            setAnimatedPositions((prev) => ({
              ...prev,
              [targetPlayerUid]: finalPlayer.position,
            }));
          }
        }
      }, 220); // 220ms per tile step for clear, satisfying motion

      return () => clearInterval(stepInterval);
    } else {
      // If no active animation, keep all positions synced
      const synced: { [uid: string]: number } = {};
      players.forEach((p) => {
        synced[p.uid] = p.position || 1;
      });
      setAnimatedPositions(synced);
    }
  }, [lastMoveTimestamp, lastMovePath, lastMovingPlayerUid]);

  // Pre-generate grid tiles 100 down to 1 (top to bottom)
  const tiles = useMemo(() => {
    const list = [];
    for (let rowFromTop = 0; rowFromTop < 10; rowFromTop++) {
      const rowFromBottom = 9 - rowFromTop;
      for (let col = 0; col < 10; col++) {
        const colInRow = rowFromBottom % 2 === 0 ? col : 9 - col;
        const tileNum = rowFromBottom * 10 + colInRow + 1;
        list.push({
          num: tileNum,
          rowFromTop,
          col,
          isLadderStart: !!GAME_CONFIG.LADDERS[tileNum],
          ladderTarget: GAME_CONFIG.LADDERS[tileNum],
          isSnakeHead: !!GAME_CONFIG.SNAKES[tileNum],
          snakeTarget: GAME_CONFIG.SNAKES[tileNum],
        });
      }
    }
    return list;
  }, []);

  // Board theme classes
  const boardThemeClass = useMemo(() => {
    if (boardSkin === 'board_neon') {
      return 'bg-slate-950 border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.25)]';
    }
    if (boardSkin === 'board_royal') {
      return 'bg-gradient-to-br from-amber-950/90 via-slate-950 to-indigo-950 border-amber-500/60 shadow-[0_0_35px_rgba(245,158,11,0.25)]';
    }
    // Classic paper/wood style
    return 'bg-amber-50/95 border-amber-300 shadow-xl shadow-amber-950/20';
  }, [boardSkin]);

  const tileBaseClass = (num: number, isSnake: boolean, isLadder: boolean) => {
    if (boardSkin === 'board_neon') {
      if (num === 100) return 'bg-cyan-500/30 border-cyan-400 text-cyan-200 font-bold';
      if (num === 1) return 'bg-emerald-500/20 border-emerald-400 text-emerald-200';
      if (isSnake) return 'bg-rose-950/40 border-rose-500/40 text-rose-300';
      if (isLadder) return 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300';
      return (num % 2 === 0 ? 'bg-slate-900/80' : 'bg-slate-800/80') + ' border-slate-700/50 text-slate-300';
    }

    if (boardSkin === 'board_royal') {
      if (num === 100) return 'bg-gradient-to-br from-amber-500/40 to-yellow-600/40 border-amber-400 text-amber-200 font-bold';
      if (num === 1) return 'bg-emerald-600/30 border-emerald-400 text-emerald-200';
      if (isSnake) return 'bg-red-950/40 border-red-500/40 text-red-300';
      if (isLadder) return 'bg-amber-950/40 border-amber-500/40 text-amber-300';
      return (num % 2 === 0 ? 'bg-slate-900/90' : 'bg-indigo-950/60') + ' border-amber-900/40 text-amber-100/90';
    }

    // Classic Paper
    if (num === 100) return 'bg-amber-400 border-amber-600 text-amber-950 font-black';
    if (num === 1) return 'bg-emerald-200 border-emerald-400 text-emerald-900 font-bold';
    if (isSnake) return 'bg-red-100 border-red-300 text-red-800';
    if (isLadder) return 'bg-emerald-100 border-emerald-300 text-emerald-800';
    return (num % 2 === 0 ? 'bg-amber-100/70' : 'bg-white/80') + ' border-amber-200/80 text-amber-950';
  };

  const renderTokenIcon = (skin?: string) => {
    switch (skin) {
      case 'token_star':
        return <Star className="w-3.5 h-3.5 fill-current" />;
      case 'token_gem':
        return <Gem className="w-3.5 h-3.5 fill-current" />;
      case 'token_crown':
      default:
        return <Crown className="w-3.5 h-3.5 fill-current" />;
    }
  };

  return (
    <div className="w-full flex justify-center items-center select-none py-2">
      {/* Aspect Ratio Box 1:1 for crisp square board */}
      <div className="w-full max-w-[620px] aspect-square relative rounded-2xl p-1.5 md:p-2 border-4 border-amber-300/80 bg-white shadow-md transition-all duration-300">
        <div className={`w-full h-full relative rounded-xl border overflow-hidden ${boardThemeClass}`}>
          {/* 10x10 Grid */}
          <div className="grid grid-cols-10 grid-rows-10 w-full h-full gap-0.5 p-0.5">
            {tiles.map((tile) => (
              <div
                key={tile.num}
                className={`relative flex flex-col justify-between p-0.5 md:p-1 rounded-sm border transition-colors ${tileBaseClass(
                  tile.num,
                  tile.isSnakeHead,
                  tile.isLadderStart
                )}`}
              >
                {/* Number Label */}
                <div className="flex justify-between items-start w-full leading-none">
                  <span className="text-[9px] md:text-xs font-bold tracking-tight">
                    {tile.num}
                  </span>
                  {tile.num === 100 && (
                    <span className="text-[8px] md:text-[10px] px-1 py-0.2 bg-amber-500 text-amber-950 rounded-full font-black">
                      WIN
                    </span>
                  )}
                  {tile.num === 1 && (
                    <span className="text-[8px] md:text-[10px] px-0.5 text-emerald-700 font-bold">
                      စ
                    </span>
                  )}
                </div>

                {/* Snake or Ladder Quick Indicator Badge */}
                <div className="flex items-center justify-center pointer-events-none">
                  {tile.isLadderStart && (
                    <div className="flex items-center gap-0.5 bg-emerald-600/90 text-white rounded px-0.5 py-0.2 text-[7px] md:text-[9px] font-bold shadow">
                      <Sparkles className="w-2.5 h-2.5" />
                      <span>+{tile.ladderTarget! - tile.num}</span>
                    </div>
                  )}
                  {tile.isSnakeHead && (
                    <div className="flex items-center gap-0.5 bg-rose-600/90 text-white rounded px-0.5 py-0.2 text-[7px] md:text-[9px] font-bold shadow">
                      <ShieldAlert className="w-2.5 h-2.5" />
                      <span>-{tile.num - tile.snakeTarget!}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* SVG Overlay for Ladders and Snakes */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="ladderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#D97706" />
              </linearGradient>
              <linearGradient id="snakeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#EF4444" />
                <stop offset="50%" stopColor="#DC2626" />
                <stop offset="100%" stopColor="#991B1B" />
              </linearGradient>
              <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="0.8" floodOpacity="0.4" />
              </filter>
            </defs>

            {/* Draw Ladders */}
            {Object.entries(GAME_CONFIG.LADDERS).map(([startStr, endNum]) => {
              const startNum = parseInt(startStr);
              const bottom = getTileCoordinates(startNum);
              const top = getTileCoordinates(endNum);

              // Ladder angle and perpendicular offset for 2 parallel rails
              const dx = top.x - bottom.x;
              const dy = top.y - bottom.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;

              const railOffset = 1.3;
              const px = (-dy / len) * railOffset;
              const py = (dx / len) * railOffset;

              // Number of rungs
              const rungCount = Math.max(3, Math.floor(len / 4.5));

              return (
                <g key={`ladder-${startNum}`} filter="url(#glowFilter)" opacity="0.95">
                  {/* Left Rail */}
                  <line
                    x1={bottom.x + px}
                    y1={bottom.y + py}
                    x2={top.x + px}
                    y2={top.y + py}
                    stroke="url(#ladderGrad)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                  {/* Right Rail */}
                  <line
                    x1={bottom.x - px}
                    y1={bottom.y - py}
                    x2={top.x - px}
                    y2={top.y - py}
                    stroke="url(#ladderGrad)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                  {/* Rungs */}
                  {Array.from({ length: rungCount }).map((_, rIdx) => {
                    const t = (rIdx + 1) / (rungCount + 1);
                    const rx = bottom.x + dx * t;
                    const ry = bottom.y + dy * t;
                    return (
                      <line
                        key={`rung-${rIdx}`}
                        x1={rx + px}
                        y1={ry + py}
                        x2={rx - px}
                        y2={ry - py}
                        stroke="#FBBF24"
                        strokeWidth="0.8"
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* Draw Snakes */}
            {Object.entries(GAME_CONFIG.SNAKES).map(([startStr, endNum]) => {
              const headNum = parseInt(startStr);
              const head = getTileCoordinates(headNum);
              const tail = getTileCoordinates(endNum);

              const dx = tail.x - head.x;
              const dy = tail.y - head.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;

              // Wavy control points
              const waveAmp = Math.min(10, len * 0.25);
              const nx = -dy / len;
              const ny = dx / len;

              const cp1x = head.x + dx * 0.33 + nx * waveAmp;
              const cp1y = head.y + dy * 0.33 + ny * waveAmp;
              const cp2x = head.x + dx * 0.66 - nx * waveAmp;
              const cp2y = head.y + dy * 0.66 - ny * waveAmp;

              const pathData = `M ${head.x} ${head.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tail.x} ${tail.y}`;

              return (
                <g key={`snake-${headNum}`} filter="url(#glowFilter)" opacity="0.95">
                  {/* Snake Body Main */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="url(#snakeGrad)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  {/* Snake body spots/pattern */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#FDE047"
                    strokeWidth="0.6"
                    strokeLinecap="round"
                  />
                  {/* Snake Head */}
                  <circle cx={head.x} cy={head.y} r="1.8" fill="#DC2626" stroke="#FEF08A" strokeWidth="0.4" />
                  {/* Snake Eyes */}
                  <circle cx={head.x - 0.5} cy={head.y - 0.4} r="0.4" fill="#000" />
                  <circle cx={head.x + 0.5} cy={head.y - 0.4} r="0.4" fill="#000" />
                  {/* Tail tip */}
                  <circle cx={tail.x} cy={tail.y} r="0.8" fill="#991B1B" />
                </g>
              );
            })}
          </svg>

          {/* Player Tokens Layer with Step-by-Step Walking Animation */}
          <div className="absolute inset-0 pointer-events-none z-20">
            {players.map((player, pIdx) => {
              // Current animated or settled tile
              const currentPos = animatedPositions[player.uid] ?? player.position ?? 1;
              const coords = getTileCoordinates(currentPos);
              const isTurn = pIdx === currentTurnIndex;
              const isMoving = movingPlayerId === player.uid;

              // If multiple players on same tile, slightly offset them
              const playersOnSameTile = players.filter(
                (p) => (animatedPositions[p.uid] ?? p.position ?? 1) === currentPos
              );
              const offsetIndex = playersOnSameTile.findIndex((p) => p.uid === player.uid);
              const totalOnTile = playersOnSameTile.length;
              let offsetX = 0;
              let offsetY = 0;
              if (totalOnTile > 1) {
                const angle = (offsetIndex / totalOnTile) * 2 * Math.PI;
                offsetX = Math.cos(angle) * 1.8;
                offsetY = Math.sin(angle) * 1.8;
              }

              return (
                <div
                  key={player.uid}
                  className={`absolute transition-all duration-300 ease-out flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 ${
                    isTurn ? 'z-30 scale-110' : 'z-20'
                  } ${isMoving ? 'scale-125' : ''}`}
                  style={{
                    left: `${coords.x + offsetX}%`,
                    top: `${coords.y + offsetY}%`,
                  }}
                >
                  {/* Turn indicator glow */}
                  {isTurn && (
                    <div className="absolute -inset-1.5 rounded-full bg-amber-400/50 animate-ping" />
                  )}

                  {/* Player Token Puck */}
                  <div
                    className="relative w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white ring-2 text-white font-bold transition-transform duration-200"
                    style={{
                      backgroundColor: player.color,
                      boxShadow: `0 4px 10px ${player.color}90`,
                    }}
                  >
                    {player.photoURL ? (
                      <img
                        src={player.photoURL}
                        alt={player.displayName}
                        className="w-full h-full object-cover rounded-full"
                      />
                    ) : (
                      renderTokenIcon(player.activeTokenSkin)
                    )}

                    {/* Small Token Skin Icon Badge on bottom-right */}
                    <div className="absolute -bottom-1 -right-1 bg-slate-900 text-amber-300 rounded-full p-0.5 border border-amber-400 text-[10px]">
                      {renderTokenIcon(player.activeTokenSkin)}
                    </div>

                    {/* Disconnected offline icon */}
                    {player.isConnected === false && (
                      <div className="absolute -top-1 -right-1 bg-rose-600 text-white rounded-full p-0.5 border border-white text-[9px] animate-pulse" title="အင်တာနက်ပြတ်တောက်နေသည်">
                        <WifiOff className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </div>

                  {/* Small Name Tag with current position */}
                  <div className="mt-0.5 px-1 py-0.2 bg-slate-950/80 backdrop-blur-xs text-white text-[7px] md:text-[9px] font-semibold rounded truncate max-w-[55px] md:max-w-[70px] border border-white/20 text-center flex items-center gap-0.5 justify-center">
                    <span>{player.displayName}</span>
                    <span className="text-amber-300 font-mono">[{currentPos}]</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
