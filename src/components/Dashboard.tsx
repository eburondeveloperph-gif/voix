import { useEffect, useRef, useState, type FC } from "react";
import "./dashboard.css";

export const Dashboard: FC = () => {
  const [meterValues, setMeterValues] = useState({ input: 0, output: 0 });
  const animFrameRef = useRef<number>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [phase, setPhase] = useState(0);

  const metersRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  /**
   * Pattern 1: Basic height/layout computation for resize-aware containers
   * We use Pretext's layout() to compute heights based on available width.
   */
  const updateMeters = () => {
    if (!metersRef.current) return;
    const parentWidth = metersRef.current.clientWidth;
    // Pretext-like layout logic approximated here for static sizing
    const newH = Math.floor(parentWidth * 0.35);
    metersRef.current.style.height = `${newH}px`;
  };

  /**
   * Pattern 2: Dynamic visualizer bars (Tight-fit container, animation loop)
   * Simulates audio-reactive bars using requestAnimationFrame.
   */
  const animateBars = () => {
    if (!barsRef.current || !isPlaying) return;

    const bars = barsRef.current.children;
    const phaseVal = phase;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i] as HTMLElement;
      const baseHeight = 30 + Math.sin(phaseVal + i * 0.5) * 40;
      const jitter = Math.random() * 10;
      const h = Math.max(5, baseHeight + jitter);
      bar.style.height = `${h}px`;
      bar.className = "bar-anim";
    }
    animFrameRef.current = requestAnimationFrame(animateBars);
    setPhase((p) => p + 0.05);
  };

  useEffect(() => {
    updateMeters();
    window.addEventListener("resize", updateMeters);
    return () => window.removeEventListener("resize", updateMeters);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      animateBars();
    } else if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (meterValues.input === 0) {
      setMeterValues({ input: 100, output: 92 });
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  return (
    <div className="dashboard-container">
      {/* Left column: Main Dashboard Area */}
      <main className="main-dashboard">
        {/* Live Transcription Bar */}
        <div className="live-bar bg-[#11131A] border border-white/5 rounded-2xl p-4 flex items-center gap-4 mb-6">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <p className="text-sm text-gray-400 font-medium">Press play to start live transcription.</p>
        </div>

        {/* Audio Dashboard Panel */}
        <div className="audio-dashboard bg-[#11131A] border border-white/5 rounded-3xl p-8 flex items-center justify-between gap-8 mb-6">
          {/* Play Button */}
          <button
            onClick={togglePlay}
            className="w-20 h-20 bg-[#25324D] rounded-full flex items-center justify-center shrink-0 border border-[#3B82F6]/30 hover:bg-[#2C3B5A] transition shadow-[0_0_20px_rgba(59,130,246,0.15)]"
            aria-label="Play/Pause"
          >
            <svg className="w-8 h-8 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          {/* Visualizer Bars */}
          <div ref={barsRef} className="flex-1 flex items-center gap-1.5 h-12 px-6">
            {Array.from({ length: 32 }).map((_, i) => (
              <div
                key={i}
                className="w-1.5 bg-gray-500 rounded-full bar-anim"
                style={{
                  height: `${Math.random() * 80 + 20}%`,
                  animationDelay: `${Math.random() * -1.5}s`,
                }}
              />
            ))}
          </div>

          {/* Stat Cards */}
          <div className="flex gap-4 shrink-0">
            <div className="bg-[#181A24] border border-white/5 rounded-xl p-4 w-28">
              <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-1">Mic Input</p>
              <p className="text-2xl font-bold">{meterValues.input}%</p>
            </div>
            <div className="bg-[#181A24] border border-white/5 rounded-xl p-4 w-28">
              <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-1">Voice Output</p>
              <p className="text-2xl font-bold">{meterValues.output}%</p>
            </div>
            <div className="bg-[#181A24] border border-white/5 rounded-xl p-4 w-28">
              <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-1">Session</p>
              <p className="text-lg font-bold mt-1 text-gray-300">{isPlaying ? "Active" : "Standby"}</p>
            </div>
          </div>
        </div>

        {/* Listening Status Area */}
        <div className="bg-[#11131A] border border-white/5 rounded-3xl flex-1 relative flex flex-col items-center justify-center overflow-hidden">
          {/* Glowing Orb */}
          <div className="absolute w-[400px] h-[400px] glow-orb z-0" />

          <div className="z-10 text-center">
            <h1 className="text-4xl font-semibold mb-3 tracking-tight">
              {isPlaying ? "Beatrice is listening" : "Beatrice is standby"}
            </h1>
            <p className="text-gray-400">
              {isPlaying
                ? "Speak naturally. Beatrice is ready."
                : "Press play to activate the session."}
            </p>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="bg-[#11131A] border border-white/5 rounded-full p-2 flex items-center justify-between">
          <div className="flex items-center gap-2 pl-2">
            <button className="p-3.5 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v-4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
            <button className="p-3.5 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            </button>
            <button className="p-3.5 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button className="p-3.5 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>

          <button
            onClick={togglePlay}
            className="flex items-center gap-2 bg-[#1A1C24] hover:bg-[#222530] border border-white/5 px-8 py-3 rounded-full text-sm font-medium transition"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {isPlaying ? "Stop Session" : "Awaken Beatrice"}
          </button>
        </div>
      </main>

      {/* Right Column: Sidebar Settings */}
      <aside className="w-[380px] bg-[#0E1015] border-l border-white/5 flex flex-col h-full overflow-y-auto">
        <div className="px-6 py-6 border-b border-white/5 flex items-center justify-between sticky top-0 bg-[#0E1015] z-20">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <h2 className="font-medium text-lg text-white">Beatrice Hub</h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 border border-white/10 rounded-full hover:bg-white/5 text-gray-400 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7" />
              </svg>
            </button>
            <button className="p-2 border border-white/10 rounded-full hover:bg-white/5 text-gray-400 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-8">
          {/* Persona Template */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-gray-400 tracking-wide">Persona Template</label>
            <input type="text" defaultValue="Beatrice" className="w-full bg-[#181A24] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition" />
          </div>

          {/* Active Instruction Overlay */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-gray-400 tracking-wide">Active Instruction Overlay</label>
            <textarea defaultValue="You are Beatrice, made by Eburon AI. Speak naturally, briefly, and directly." className="w-full bg-[#181A24] border border-white/10 rounded-lg px-4 py-3 text-sm text-gray-300 h-40 resize-none font-mono focus:outline-none focus:border-blue-500/50 transition leading-relaxed" />
          </div>

          {/* Presets */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-gray-400 tracking-wide">Presets</label>
            <div className="flex flex-wrap gap-2">
              <button className="px-4 py-2 rounded-full border border-white/10 text-xs text-gray-300 hover:bg-white/5 transition">Professional Aide</button>
            </div>
          </div>

          {/* Voice Persona */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-gray-400 tracking-wide">Voice Persona</label>
            <select defaultValue="Aoede" className="w-full bg-[#181A24] border border-white/10 rounded-lg px-4 py-3 text-sm text-white appearance-none focus:outline-none focus:border-blue-500/50 transition cursor-pointer">
              <option>Aoede</option>
              <option>Calliope</option>
              <option>Clio</option>
            </select>
          </div>

          {/* Integrated Services */}
          <div className="flex flex-col gap-3 mt-4">
            <label className="text-xs font-medium text-gray-400 tracking-wide">Integrated Services</label>
            <div className="flex items-center justify-between bg-[#181A24] border border-white/10 rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="w-4 h-4 rounded bg-[#2C3B5A] border-none text-blue-500 focus:ring-0 cursor-pointer" />
                <span className="text-sm text-gray-200">Gmail Send</span>
              </div>
              <div className="flex items-center gap-3 text-gray-500">
                <button className="hover:text-white transition"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                <button className="hover:text-red-400 transition"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
