import React from 'react';
import { ArrowLeft, Wrench } from 'lucide-react';
import { getGameById } from '../registry';
import { snowRushModule } from './SnowRushModule';
import { SnowRushPrototypeView } from './SnowRushGame';

export interface SnowRushDevPreviewProps {
  onExitPreview?: () => void;
}

/**
 * Development-only Local Preview host for Snow Rush: Avalanche Escape (Step 4.2).
 * Guarded by `import.meta.env.DEV` in `src/App.tsx` — never bundled or reachable in production.
 */
export const SnowRushDevPreview: React.FC<SnowRushDevPreviewProps> = ({
  onExitPreview,
}) => {
  const registryEntry = getGameById(snowRushModule.id);

  const handleExit = () => {
    if (onExitPreview) {
      onExitPreview();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(window.location.pathname || '/');
    }
  };

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-slate-950 text-white">
      {/* Compact Dev-Only Diagnostic Banner */}
      <div className="bg-slate-950 border-b border-slate-800 px-3 sm:px-5 py-2 flex items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider shrink-0">
            <Wrench className="w-3 h-3" />
            <span>DEV PREVIEW</span>
          </span>
          <span className="text-xs font-bold text-slate-100 truncate">
            {registryEntry?.title || 'Snow Rush: Avalanche Escape'}
          </span>
          <span className="hidden md:inline-block text-[11px] text-slate-400 truncate">
            · Registry: {registryEntry?.status || 'coming_soon'} · Local Offline Only
          </span>
        </div>

        <button
          type="button"
          onClick={handleExit}
          className="min-h-[34px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Platform သို့ ပြန်သွားမည်</span>
        </button>
      </div>

      {/* Playable 2D Local Prototype */}
      <SnowRushPrototypeView
        playerDisplayName="သင် (Local Dev)"
        instructionsMm={snowRushModule.instructionsMm}
      />
    </div>
  );
};

export default SnowRushDevPreview;
