/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useUI, useProcessingStore } from '@/lib/state';
import AudioVisualizer from './demo/streaming-console/AudioVisualizer';
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import c from 'classnames';

interface HeaderProps {
  mode?: 'menu' | 'back';
  onBack?: () => void;
}

export default function Header({ mode = 'menu', onBack }: HeaderProps) {
  const { isGeneratingTask, toggleSidebar } = useUI();
  const micLevel = useUI(state => state.micLevel);
  const { connected, volume } = useLiveAPIContext();
  const { isProcessingTask } = useProcessingStore();
  const isBackMode = mode === 'back';
  const handlePrimaryAction = isBackMode
    ? onBack || (() => window.history.back())
    : toggleSidebar;

  // Show orb in header only during processing
  const showHeaderOrb = isGeneratingTask || isProcessingTask;
  const orbEnergy = connected ? Math.max(0.08, micLevel, volume * 0.9) : 0.06;
  const orbScale = 1 + orbEnergy * 0.18;

  return (
    <header>
      <div className="header-left">
        <button
          onClick={handlePrimaryAction}
          title={isBackMode ? 'Back' : 'Open sidebar'}
          aria-label={isBackMode ? 'Back' : 'Open sidebar'}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.03)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#9ca3af',
            transition: 'all 0.2s ease',
          }}
        >
          <i className={isBackMode ? 'ph ph-caret-left' : 'ph ph-list'} style={{ fontSize: '20px' }}></i>
        </button>
      </div>
      <div className="header-right">
        {/* Mini Orb with Audio Visualizer - only shown during processing */}
        {showHeaderOrb && (
          <div className="header-orb-wrapper">
            <div
              className={c('header-orb', {
                'animate-pulse-glow': connected,
              })}
              style={{
                transform: `scale(${orbScale.toFixed(3)})`,
                boxShadow: `inset 0 0 10px rgba(255, 255, 255, 0.5), 0 0 ${22 + orbEnergy * 42}px rgba(217, 70, 239, 0.65), 0 0 ${44 + orbEnergy * 60}px rgba(126, 34, 206, 0.38)`,
              }}
            />
            <div className="header-orb-visualizer">
              <AudioVisualizer />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
