import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import type { SnowRushItemId } from '../types';

export interface TouchControlsOverlayProps {
  disabled?: boolean;
  heldItem: SnowRushItemId | null;
  heldItemIcon: string | null;
  heldItemName: string | null;
  itemArmingSec: number;
  isItemReady: boolean;
  onSteerLeftChange: (pressed: boolean) => void;
  onSteerRightChange: (pressed: boolean) => void;
  onJumpChange: (pressed: boolean) => void;
  onUseItemTrigger: () => void;
}

/**
 * Thumb-friendly multi-touch & pointer controls for Snow Rush (Step 4.4).
 * Uses independent per-button `pointerId` sets + `touch-none` so holding Left/Right
 * while simultaneously tapping Jump AND/OR the bottom-right `ITEM` button works cleanly
 * without page scroll or touch capture conflicts.
 */
export const TouchControlsOverlay: React.FC<TouchControlsOverlayProps> = ({
  disabled = false,
  heldItem,
  heldItemIcon,
  heldItemName,
  itemArmingSec,
  isItemReady,
  onSteerLeftChange,
  onSteerRightChange,
  onJumpChange,
  onUseItemTrigger,
}) => {
  const leftPointersRef = useRef<Set<number>>(new Set());
  const rightPointersRef = useRef<Set<number>>(new Set());
  const jumpPointersRef = useRef<Set<number>>(new Set());
  const itemPointersRef = useRef<Set<number>>(new Set());

  const [leftActive, setLeftActive] = useState(false);
  const [rightActive, setRightActive] = useState(false);
  const [jumpActive, setJumpActive] = useState(false);
  const [itemActive, setItemActive] = useState(false);

  const releaseAllPointers = useCallback(() => {
    if (leftPointersRef.current.size > 0) {
      leftPointersRef.current.clear();
      setLeftActive(false);
      onSteerLeftChange(false);
    }
    if (rightPointersRef.current.size > 0) {
      rightPointersRef.current.clear();
      setRightActive(false);
      onSteerRightChange(false);
    }
    if (jumpPointersRef.current.size > 0) {
      jumpPointersRef.current.clear();
      setJumpActive(false);
      onJumpChange(false);
    }
    if (itemPointersRef.current.size > 0) {
      itemPointersRef.current.clear();
      setItemActive(false);
    }
  }, [onSteerLeftChange, onSteerRightChange, onJumpChange]);

  useEffect(() => {
    if (disabled) {
      releaseAllPointers();
    }
  }, [disabled, releaseAllPointers]);

  useEffect(() => {
    if (heldItem === null && itemPointersRef.current.size > 0) {
      itemPointersRef.current.clear();
      setItemActive(false);
    }
  }, [heldItem]);

  useEffect(() => {
    const handleGlobalReset = () => {
      releaseAllPointers();
    };
    window.addEventListener('blur', handleGlobalReset);
    document.addEventListener('visibilitychange', handleGlobalReset);
    return () => {
      window.removeEventListener('blur', handleGlobalReset);
      document.removeEventListener('visibilitychange', handleGlobalReset);
      releaseAllPointers();
    };
  }, [releaseAllPointers]);

  const bindHoldButton = (
    pointerSetRef: React.MutableRefObject<Set<number>>,
    setActive: React.Dispatch<React.SetStateAction<boolean>>,
    onChange: (pressed: boolean) => void
  ) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or older browser pointer events may not support capture
      }
      pointerSetRef.current.add(e.pointerId);
      setActive(true);
      onChange(true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      pointerSetRef.current.delete(e.pointerId);
      const stillPressed = pointerSetRef.current.size > 0;
      setActive(stillPressed);
      onChange(stillPressed);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      pointerSetRef.current.delete(e.pointerId);
      const stillPressed = pointerSetRef.current.size > 0;
      setActive(stillPressed);
      onChange(stillPressed);
    },
    onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => {
      pointerSetRef.current.delete(e.pointerId);
      const stillPressed = pointerSetRef.current.size > 0;
      setActive(stillPressed);
      onChange(stillPressed);
    },
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
    },
  });

  const itemButtonDisabled = disabled || heldItem === null || !isItemReady;

  const itemHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (itemButtonDisabled) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if synthetic event
      }
      itemPointersRef.current.add(e.pointerId);
      setItemActive(true);
      onUseItemTrigger();
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      itemPointersRef.current.delete(e.pointerId);
      setItemActive(itemPointersRef.current.size > 0);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      itemPointersRef.current.delete(e.pointerId);
      setItemActive(itemPointersRef.current.size > 0);
    },
    onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => {
      itemPointersRef.current.delete(e.pointerId);
      setItemActive(itemPointersRef.current.size > 0);
    },
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
    },
  };

  const leftHandlers = bindHoldButton(leftPointersRef, setLeftActive, onSteerLeftChange);
  const rightHandlers = bindHoldButton(rightPointersRef, setRightActive, onSteerRightChange);
  const jumpHandlers = bindHoldButton(jumpPointersRef, setJumpActive, onJumpChange);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 sm:px-6 pb-safe-game pt-2">
      <div className="max-w-5xl mx-auto flex items-end justify-between gap-2.5">
        {/* Left Thumb: Left / Right Carve Cluster */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            aria-label="ဘယ်ဘက်သို့ ကွေ့မည် (Steer Left)"
            {...leftHandlers}
            className={`min-w-[64px] sm:min-w-[76px] min-h-[60px] sm:min-h-[64px] rounded-2xl border-2 flex flex-col items-center justify-center select-none touch-none shadow-lg transition-transform ${
              leftActive
                ? 'bg-sky-500 border-sky-200 text-white scale-95'
                : 'bg-slate-900/85 hover:bg-slate-900 border-white/30 text-white backdrop-blur-xs'
            } disabled:opacity-40`}
          >
            <ChevronLeft className="w-7 h-7 stroke-[2.75]" />
            <span className="text-[10px] font-bold tracking-tight leading-none pb-0.5">
              ဘယ်
            </span>
          </button>

          <button
            type="button"
            disabled={disabled}
            aria-label="ညာဘက်သို့ ကွေ့မည် (Steer Right)"
            {...rightHandlers}
            className={`min-w-[64px] sm:min-w-[76px] min-h-[60px] sm:min-h-[64px] rounded-2xl border-2 flex flex-col items-center justify-center select-none touch-none shadow-lg transition-transform ${
              rightActive
                ? 'bg-sky-500 border-sky-200 text-white scale-95'
                : 'bg-slate-900/85 hover:bg-slate-900 border-white/30 text-white backdrop-blur-xs'
            } disabled:opacity-40`}
          >
            <ChevronRight className="w-7 h-7 stroke-[2.75]" />
            <span className="text-[10px] font-bold tracking-tight leading-none pb-0.5">
              ညာ
            </span>
          </button>
        </div>

        {/* Right Thumb: Jump + Dedicated ITEM Button Cluster */}
        <div className="pointer-events-auto flex items-end gap-2">
          <button
            type="button"
            disabled={disabled}
            aria-label="ခုန်မည် (Jump)"
            {...jumpHandlers}
            className={`min-w-[78px] sm:min-w-[98px] min-h-[60px] sm:min-h-[64px] px-3 rounded-2xl border-2 flex flex-col items-center justify-center select-none touch-none shadow-lg transition-transform ${
              jumpActive
                ? 'bg-amber-400 border-amber-100 text-slate-950 scale-95'
                : 'bg-amber-400/95 hover:bg-amber-400 border-slate-900/20 text-slate-950 backdrop-blur-xs'
            } disabled:opacity-40`}
          >
            <ArrowUp className="w-6 h-6 stroke-[2.75]" />
            <span className="text-xs font-black tracking-tight leading-none mt-0.5">
              ခုန်မည်
            </span>
          </button>

          {/* Dedicated Bottom-Right ITEM Button (Step 4.4 Spec) */}
          <button
            type="button"
            disabled={itemButtonDisabled}
            aria-label={
              heldItemName
                ? `ITEM သုံးမည် (${heldItemName})`
                : 'ITEM ခလုတ် (Item မရှိသေးပါ)'
            }
            {...itemHandlers}
            className={`min-w-[82px] sm:min-w-[104px] min-h-[60px] sm:min-h-[64px] px-2.5 rounded-2xl border-2 flex flex-col items-center justify-center select-none touch-none shadow-lg transition-transform ${
              heldItem !== null
                ? isItemReady
                  ? itemActive
                    ? 'bg-emerald-400 border-white text-slate-950 scale-95'
                    : 'bg-sky-500 hover:bg-sky-400 border-amber-300 text-white'
                  : 'bg-slate-800/90 border-amber-300/60 text-amber-200'
                : 'bg-slate-900/65 border-dashed border-white/25 text-slate-300'
            } disabled:opacity-45 disabled:cursor-not-allowed`}
          >
            {heldItemIcon ? (
              <span className="text-xl leading-none">{heldItemIcon}</span>
            ) : (
              <Package className="w-5 h-5 stroke-[2.4] opacity-75" />
            )}
            <span className="text-[10px] font-black tracking-tight leading-none mt-1 font-mono tabular-nums">
              {heldItem === null
                ? 'ITEM'
                : isItemReady
                ? 'ITEM သုံး'
                : `${itemArmingSec.toFixed(1)}s`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
