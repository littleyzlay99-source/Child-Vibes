import React, { useMemo } from 'react';
import { RoomPlayer } from '../../types';
import { GAME_CONFIG } from '../../config/gameRules';
import { Crown, Star, Gem, ShieldAlert, Sparkles } from 'lucide-react';

interface GameBoardProps {
  players: RoomPlayer[];
  currentTurnIndex: number;
  boardSkin?: string;
  movingPlayerId?: string | null;
}

// Convert tile number (1-100) to percentage coordinates (0-100%)
export function getTileCoordinates(tileNumber: number): { x: number; y: number } {
  const safeTile = Math.max(1, Math.min(100, tileNumber));
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
}) => {
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
                    <span className="text-[8px] md:text-[10px] px-0.5 text-emerald-700 dark:text-emerald-300 font-bold">
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
              const from = getTileCoordinates(startNum);
              const to = getTileCoordinates(endNum);

              // Calculate parallel lines for the two ladder rails
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;

              const railOffset = 1.3;
              const px = (-dy / len) * railOffset;
              const py = (dx / len) * railOffset;

              const r1x1 = from.x + px;
              const r1y1 = from.y + py;
              const r1x2 = to.x + px;
              const r1y2 = to.y + py;

              const r2x1 = from.x - px;
              const r2y1 = from.y - py;
              const r2x2 = to.x - px;
              const r2y2 = to.y - py;

              // Generate rungs
              const rungCount = Math.max(3, Math.floor(len / 4.5));
              const rungs = [];
              for (let i = 1; i < rungCount; i++) {
                const t = i / rungCount;
                const rx1 = r1x1 + (r1x2 - r1x1) * t;
                const ry1 = r1y1 + (r1y2 - r1y1) * t;
                const rx2 = r2x1 + (r2x2 - r2x1) * t;
                const ry2 = r2y1 + (r2y2 - r2y1) * t;
                rungs.push({ x1: rx1, y1: ry1, x2: rx2, y2: ry2 });
              }

              return (
                <g key={`ladder-${startNum}`} filter="url(#glowFilter)" opacity="0.92">
                  {/* Rails */}
                  <line
                    x1={r1x1}
                    y1={r1y1}
                    x2={r1x2}
                    y2={r1y2}
                    stroke="#B45309"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                  />
                  <line
                    x1={r2x1}
                    y1={r2y1}
                    x2={r2x2}
                    y2={r2y2}
                    stroke="#B45309"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                  />
                  <line
                    x1={r1x1}
                    y1={r1y1}
                    x2={r1x2}
                    y2={r1y2}
                    stroke="url(#ladderGrad)"
                    strokeWidth="0.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1={r2x1}
                    y1={r2y1}
                    x2={r2x2}
                    y2={r2y2}
                    stroke="url(#ladderGrad)"
                    strokeWidth="0.5"
                    strokeLinecap="round"
                  />
                  {/* Rungs */}
                  {rungs.map((rung, idx) => (
                    <line
                      key={idx}
                      x1={rung.x1}
                      y1={rung.y1}
                      x2={rung.x2}
                      y2={rung.y2}
                      stroke="#78350F"
                      strokeWidth="0.5"
                      strokeLinecap="round"
                    />
                  ))}
                  {/* Top celebration icon */}
                  <circle cx={to.x} cy={to.y} r="1.4" fill="#10B981" stroke="#ECFDF5" strokeWidth="0.3" />
                </g>
              );
            })}

            {/* Draw Snakes */}
            {Object.entries(GAME_CONFIG.SNAKES).map(([startStr, endNum]) => {
              const startNum = parseInt(startStr);
              const head = getTileCoordinates(startNum);
              const tail = getTileCoordinates(endNum);

              const midX = (head.x + tail.x) / 2 + (startNum % 2 === 0 ? 6 : -6);
              const midY = (head.y + tail.y) / 2;

              const pathData = `M ${head.x} ${head.y} Q ${midX} ${midY} ${tail.x} ${tail.y}`;

              return (
                <g key={`snake-${startNum}`} filter="url(#glowFilter)" opacity="0.95">
                  {/* Snake body shadow */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#450A0A"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  {/* Snake body */}
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
                    strokeDasharray="1 3"
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

          {/* Player Tokens Layer */}
          <div className="absolute inset-0 pointer-events-none z-20">
            {players.map((player, pIdx) => {
              const coords = getTileCoordinates(player.position);
              const isTurn = pIdx === currentTurnIndex;
              const isMoving = movingPlayerId === player.uid;

              // If multiple players on same tile, slightly offset them
              const playersOnSameTile = players.filter((p) => p.position === player.position);
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
                  className={`absolute transition-all duration-500 ease-out flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 ${
                    isTurn ? 'z-30 scale-110' : 'z-20'
                  } ${isMoving ? 'animate-bounce' : ''}`}
                  style={{
                    left: `${coords.x + offsetX}%`,
                    top: `${coords.y + offsetY}%`,
                  }}
                >
                  {/* Turn indicator halo */}
                  {isTurn && (
                    <div className="absolute -inset-1.5 rounded-full bg-amber-400/50 animate-ping" />
                  )}

                  {/* Player Token Puck */}
                  <div
                    className="relative w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white ring-2 text-white font-bold transition-transform duration-300"
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
                  </div>

                  {/* Small Name Tag */}
                  <div className="mt-0.5 px-1 py-0.2 bg-slate-950/80 backdrop-blur-xs text-white text-[7px] md:text-[9px] font-semibold rounded truncate max-w-[50px] md:max-w-[65px] border border-white/20 text-center">
                    {player.displayName}
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
