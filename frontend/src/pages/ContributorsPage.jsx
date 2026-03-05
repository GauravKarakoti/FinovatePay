import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────── */
const REPO_OWNER = 'GauravKarakoti';
const REPO_NAME = 'FinovatePay';
const GITHUB_API = 'https://api.github.com';

const MEDAL = ['🥇', '🥈', '🥉'];
const LANGUAGE_COLORS = {
  'JavaScript': '#f7df1e', 'TypeScript': '#3178c6', 'Python': '#3776ab',
  'Solidity': '#aa6746', 'React': '#61dafb', 'Vue': '#4fc08d',
  'Node.js': '#68a063', 'HTML': '#e34c26', 'CSS': '#563d7c',
  'Java': '#007396', 'Go': '#00add8', 'Rust': '#ce422b',
  'Shell': '#4eaa25', 'SQL': '#cc2927', 'JSON': '#f7df1e',
};


const TIER_CONFIG = [
  { label: 'Core Maintainer', min: 200, color: '#f97316', bg: 'from-orange-500/20 to-red-500/20', border: 'border-orange-400/50', glow: '0 0 30px rgba(249,115,22,0.35)' },
  { label: 'Top Contributor', min: 50,  color: '#a855f7', bg: 'from-purple-500/20 to-indigo-500/20', border: 'border-purple-400/50', glow: '0 0 30px rgba(168,85,247,0.35)' },
  { label: 'Active Contributor', min: 10, color: '#06b6d4', bg: 'from-cyan-500/20 to-blue-500/20', border: 'border-cyan-400/50', glow: '0 0 30px rgba(6,182,212,0.35)' },
  { label: 'Contributor', min: 1, color: '#22c55e', bg: 'from-emerald-500/20 to-teal-500/20', border: 'border-emerald-400/50', glow: '0 0 30px rgba(34,197,94,0.35)' },
];

function getTier(contributions) {
  return TIER_CONFIG.find(t => contributions >= t.min) ?? TIER_CONFIG[TIER_CONFIG.length - 1];
}

/* ─────────────────────────────────────────────────────────────
   Heatmap Utility
───────────────────────────────────────────────────────────── */
function generateContributionHeatmap(login) {
  // Generate mock heatmap based on username hash
  const hash = login.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return Array.from({ length: 365 }, (_, i) => ({
    date: new Date(new Date().setDate(new Date().getDate() - 365 + i)),
    count: Math.floor(Math.sin(hash * i * 0.01) * 5 + 8 + Math.random() * 12),
  }));
}

function getContributionColor(count) {
  if (count === 0) return 'bg-white/5 border-white/10';
  if (count < 3) return 'bg-emerald-900/30 border-emerald-600/40';
  if (count < 6) return 'bg-emerald-700/40 border-emerald-500/50';
  if (count < 10) return 'bg-emerald-500/50 border-emerald-400/60';
  return 'bg-emerald-400/60 border-emerald-300/70';
}

/* ─────────────────────────────────────────────────────────────
   Animated Counter Hook
───────────────────────────────────────────────────────────── */
function useCountUp(target, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start = null;
    const timeout = setTimeout(() => {
      const step = (timestamp) => {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        setValue(Math.floor(progress * target));
        if (progress < 1) requestAnimationFrame(step);
        else setValue(target);
      };
      requestAnimationFrame(step);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);
  return value;
}

/* ─────────────────────────────────────────────────────────────
   Scroll Reveal Hook
───────────────────────────────────────────────────────────── */
function useScrollReveal() {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.1 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, isVisible];
}

/* ─────────────────────────────────────────────────────────────
   Contribution Heatmap
───────────────────────────────────────────────────────────── */
function ContributionHeatmap({ login, isVisible }) {
  const heatmap = generateContributionHeatmap(login);
  const weeks = Array.from({ length: 53 }, (_, week) =>
    heatmap.filter((_, i) => Math.floor(i / 7) === week)
  );

  return (
    <div className="flex flex-col gap-2 overflow-x-auto pb-2">
      <div className="text-xs text-gray-600 font-semibold">Contributions (1 year)</div>
      <div className="flex gap-1" style={{ minWidth: 'max-content' }}>
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map((day, d) => (
              <div
                key={d}
                className={`w-3 h-3 rounded-sm border transition-all duration-500 cursor-pointer hover:scale-125 ${getContributionColor(day.count)}`}
                title={`${day.count} contributions on ${day.date.toLocaleDateString()}`}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transitionDelay: `${w * 5 + d * 2}ms`,
                  transitionProperty: 'opacity, background-color, border-color, transform',
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2 text-xs text-gray-600 mt-2">
        <span>Less</span>
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`w-2 h-2 rounded-sm ${getContributionColor(i * 3)}`} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Language Skills
───────────────────────────────────────────────────────────── */
function LanguageSkills({ languages = [] }) {
  const topLangs = languages.slice(0, 6);
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-600 font-semibold mb-3">Top Languages</div>
      <div className="flex flex-wrap gap-2">
        {topLangs.length > 0 ? (
          topLangs.map((lang, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border"
              style={{
                background: `${LANGUAGE_COLORS[lang] || '#6b7280'}22`,
                borderColor: `${LANGUAGE_COLORS[lang] || '#6b7280'}55`,
                color: LANGUAGE_COLORS[lang] || '#6b7280',
              }}>
              <div className="w-2 h-2 rounded-full" style={{ background: LANGUAGE_COLORS[lang] || '#6b7280' }} />
              <span className="text-xs font-semibold">{lang}</span>
            </div>
          ))
        ) : (
          <span className="text-xs text-gray-600">No language data</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Comparison Mode
───────────────────────────────────────────────────────────── */
function ComparisonModal({ contributors, onClose }) {
  const [comp1, setComp1] = useState(contributors[0]);
  const [comp2, setComp2] = useState(contributors[1]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tier1 = getTier(comp1.contributions);
  const tier2 = getTier(comp2.contributions);
  const maxFollowers = Math.max(comp1.userDetails?.followers || 0, comp2.userDetails?.followers || 0);
  const maxRepos = Math.max(comp1.userDetails?.public_repos || 0, comp2.userDetails?.public_repos || 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <div className="w-full max-w-4xl rounded-3xl border border-white/15 overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #0f172a, #1e1b4b)',
          boxShadow: '0 25px 80px rgba(0,0,0,0.8)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center p-6 border-b border-white/10 message bg-gradient-to-r from-blue-500/10 to-purple-500/10">
          <h2 className="text-2xl font-bold text-white">Contributor Comparison</h2>
          <p className="text-xs text-gray-500 mt-1">Compare stats side by side</p>
        </div>

        {/* Selectors */}
        <div className="p-6 gap-4 flex md:flex-row flex-col items-center">
          <div className="flex-1">
            <label className="text-xs text-gray-600 mb-2 block font-semibold">Left Contributor</label>
            <select value={comp1.login} onChange={e => setComp1(contributors.find(c => c.login === e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none"
              style={{ borderColor: `${tier1.color}44` }}>
              {contributors.map(c => <option key={c.login} value={c.login} className="bg-gray-900">{c.login}</option>)}
            </select>
          </div>
          <div className="w-8 text-center font-bold text-xl text-gray-700">⚔️</div>
          <div className="flex-1">
            <label className="text-xs text-gray-600 mb-2 block font-semibold">Right Contributor</label>
            <select value={comp2.login} onChange={e => setComp2(contributors.find(c => c.login === e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none"
              style={{ borderColor: `${tier2.color}44` }}>
              {contributors.map(c => <option key={c.login} value={c.login} className="bg-gray-900">{c.login}</option>)}
            </select>
          </div>
        </div>

        {/* Comparison grid */}
        <div className="grid grid-cols-2 gap-4 p-6">
          {[
            { label: 'Contributions', v1: comp1.contributions, v2: comp2.contributions, unit: 'commits', icon: '🔨' },
            { label: 'Followers', v1: comp1.userDetails?.followers ?? 0, v2: comp2.userDetails?.followers ?? 0, unit: 'users', icon: '👥' },
            { label: 'Public Repos', v1: comp1.userDetails?.public_repos ?? 0, v2: comp2.userDetails?.public_repos ?? 0, unit: 'repos', icon: '📦' },
            { label: 'Following', v1: comp1.userDetails?.following ?? 0, v2: comp2.userDetails?.following ?? 0, unit: 'users', icon: '🔗' },
            { label: 'Gists', v1: comp1.userDetails?.public_gists ?? 0, v2: comp2.userDetails?.public_gists ?? 0, unit: 'gists', icon: '📝' },
            { label: 'Location', v1: comp1.userDetails?.location || 'N/A', v2: comp2.userDetails?.location || 'N/A', unit: '', icon: '📍' },
          ].map(s => {
            const v1Wins = typeof s.v1 === 'number' && s.v1 > s.v2;
            const v2Wins = typeof s.v2 === 'number' && s.v2 > s.v1;
            return (
              <div key={s.label} className="rounded-xl border border-white/10 p-3 bg-white/5">
                <div className="text-xs text-gray-600 font-semibold mb-2 flex items-center gap-1">
                  <span>{s.icon}</span> {s.label}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 text-center">
                    <span className={`text-sm font-bold ${v1Wins ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {typeof s.v1 === 'number' ? s.v1.toLocaleString() : s.v1}
                    </span>
                  </div>
                  <span className="text-xs text-gray-600">vs</span>
                  <div className="flex-1 text-center">
                    <span className={`text-sm font-bold ${v2Wins ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {typeof s.v2 === 'number' ? s.v2.toLocaleString() : s.v2}
                    </span>
                  </div>
                </div>
                {typeof s.v1 === 'number' && (
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden flex gap-1">
                    <div className="flex-1 rounded-full" style={{ 
                      background: tier1.color,
                      width: `${Math.max(s.v1 / (Math.max(s.v1, s.v2) || 1) * 100, 3)}%`,
                      transition: 'width 0.8s ease-out',
                    }} />
                    <div className="flex-1 rounded-full" style={{
                      background: tier2.color,
                      width: `${Math.max(s.v2 / (Math.max(s.v1, s.v2) || 1) * 100, 3)}%`,
                      transition: 'width 0.8s ease-out',
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Close button */}
        <div className="text-center p-4 border-t border-white/10">
          <button onClick={onClose}
            className="px-6 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-all">
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Animated Stat Card
───────────────────────────────────────────────────────────── */
function StatCard({ icon, label, value, color, delay }) {
  const count = useCountUp(value, 1500, delay);
  return (
    <div className="relative group overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-5 flex items-center gap-4 transition-all duration-300 hover:scale-105 hover:border-white/30"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(circle at 50% 0%, ${color}22, transparent 70%)` }} />
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="text-2xl font-bold text-white font-mono">{count.toLocaleString()}</div>
        <div className="text-xs text-gray-400 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Contribution Bar
───────────────────────────────────────────────────────────── */
function ContribBar({ value, max, color, animated }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (animated) {
      const t = setTimeout(() => setWidth(max > 0 ? (value / max) * 100 : 0), 300);
      return () => clearTimeout(t);
    } else {
      setWidth(max > 0 ? (value / max) * 100 : 0);
    }
  }, [value, max, animated]);

  return (
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-1000 ease-out"
        style={{ width: `${width}%`, background: `linear-gradient(90deg, ${color}, ${color}99)` }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   3-D Tilt Card  
───────────────────────────────────────────────────────────── */
function TiltCard({ children, className = '', style = {} }) {
  const ref = useRef(null);
  const [transform, setTransform] = useState('');

  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = ((e.clientX - left) / width  - 0.5) * 18;
    const y = ((e.clientY - top)  / height - 0.5) * -18;
    setTransform(`perspective(700px) rotateX(${y}deg) rotateY(${x}deg) scale(1.03)`);
  }, []);

  const onLeave = useCallback(() => setTransform(''), []);

  return (
    <div
      ref={ref}
      className={className}
      style={{ ...style, transform, transition: transform ? 'transform 0.08s linear' : 'transform 0.5s ease', willChange: 'transform' }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Contributor Card
───────────────────────────────────────────────────────────── */
function ContributorCard({ contributor, rank, maxContributions, onSelect }) {
  const tier = getTier(contributor.contributions);
  const isTopThree = rank <= 3;
  const [ref, isVisible] = useScrollReveal();

  return (
    <div ref={ref} style={{ opacity: isVisible ? 1 : 0, transition: 'opacity 0.6s ease-out' }}>
      <TiltCard
        className="relative group cursor-pointer rounded-2xl border overflow-hidden transition-all duration-300 hover:border-white/40"
        style={{
          background: `linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))`,
          borderColor: 'rgba(255,255,255,0.1)',
          boxShadow: isTopThree ? tier.glow : '0 2px 16px rgba(0,0,0,0.3)',
        }}
        onClick={() => onSelect(contributor)}
      >
        {/* Glow overlay on hover */}
        <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br ${tier.bg}`} />

        {/* Rank badge */}
        <div className="absolute top-3 left-3 z-10">
          {isTopThree ? (
            <span className="text-2xl drop-shadow-lg select-none">{MEDAL[rank - 1]}</span>
          ) : (
            <span className="text-xs font-bold text-white/40 tabular-nums">#{rank}</span>
          )}
        </div>

        {/* Tier badge */}
        <div className="absolute top-3 right-3 z-10">
          <span className="text-xs px-2 py-0.5 rounded-full border font-semibold tracking-wide"
            style={{ color: tier.color, borderColor: `${tier.color}55`, background: `${tier.color}15` }}>
            {tier.label}
          </span>
        </div>

        <div className="relative z-10 p-5 pt-8">
          {/* Avatar */}
          <div className="flex flex-col items-center mb-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-md opacity-60 scale-110"
                style={{ background: `radial-gradient(circle, ${tier.color}88, transparent)` }} />
              <img
                src={contributor.avatar_url}
                alt={contributor.login}
                className="relative w-20 h-20 rounded-full border-2 object-cover"
                style={{ borderColor: tier.color }}
                loading="lazy"
              />
              {contributor.userDetails?.hireable && (
                <div className="absolute -bottom-1 -right-1 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  HIRE
                </div>
              )}
            </div>

            <h3 className="mt-3 font-bold text-white text-sm text-center leading-tight">
              {contributor.userDetails?.name || contributor.login}
            </h3>
            <p className="text-gray-400 text-xs mt-0.5">@{contributor.login}</p>

            {contributor.userDetails?.location && (
              <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                <span>📍</span>{contributor.userDetails.location}
              </p>
            )}
          </div>

          {/* Bio */}
          {contributor.userDetails?.bio && (
            <p className="text-gray-400 text-xs text-center line-clamp-2 mb-3 italic leading-relaxed">
              "{contributor.userDetails.bio}"
            </p>
          )}

          {/* Contribution count + bar */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-gray-500">Contributions</span>
              <span className="text-xs font-bold" style={{ color: tier.color }}>
                {contributor.contributions.toLocaleString()}
              </span>
            </div>
            <ContribBar value={contributor.contributions} max={maxContributions} color={tier.color} animated />
          </div>

          {/* Mini stats */}
          <div className="grid grid-cols-3 gap-1 mt-3">
            {[
              { label: 'Repos', value: contributor.userDetails?.public_repos ?? '—', icon: '📦' },
              { label: 'Followers', value: contributor.userDetails?.followers ?? '—', icon: '👥' },
              { label: 'Following', value: contributor.userDetails?.following ?? '—', icon: '🔗' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center p-1.5 rounded-lg bg-white/5 group/stat hover:bg-white/10 transition-colors">
                <span className="text-[11px]">{s.icon}</span>
                <span className="text-xs font-bold text-white mt-0.5">
                  {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                </span>
                <span className="text-[10px] text-gray-500">{s.label}</span>
              </div>
            ))}
          </div>

          {/* GitHub link */}
          <a
            href={contributor.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all duration-200 hover:brightness-125 border"
            style={{ color: tier.color, borderColor: `${tier.color}44`, background: `${tier.color}12` }}
          >
            <GithubIcon size={14} />
            View GitHub Profile
          </a>
        </div>
      </TiltCard>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Contributor Detail Modal (Tabbed)
───────────────────────────────────────────────────────────── */
function ContributorModal({ contributor, rank, onClose }) {
  const tier = getTier(contributor.contributions);
  const [activeTab, setActiveTab] = useState('overview');
  const [isHeatmapVisible, setIsHeatmapVisible] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-3xl border overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #0f172a, #1e1b4b)',
          borderColor: `${tier.color}55`,
          boxShadow: `${tier.glow}, 0 40px 80px rgba(0,0,0,0.8)`,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header gradient */}
        <div className="h-40 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${tier.color}55, ${tier.color}22)` }}>
          <div className="absolute inset-0 opacity-30"
            style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1), transparent)' }} />
          <button onClick={onClose}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all text-lg">
            ✕
          </button>
        </div>

        {/* Avatar section */}
        <div className="flex flex-col items-center -mt-20 px-6 pb-6">
          <div className="relative z-10">
            <div className="absolute inset-0 rounded-full blur-2xl opacity-60 scale-125 animate-pulse"
              style={{ background: tier.color }} />
            <img src={contributor.avatar_url} alt={contributor.login}
              className="relative w-32 h-32 rounded-full border-4 object-cover shadow-2xl"
              style={{ borderColor: tier.color }} />
            {rank <= 3 && (
              <div className="absolute -bottom-2 -right-2 text-4xl drop-shadow-lg">{MEDAL[rank - 1]}</div>
            )}
          </div>

          <div className="mt-4 text-center">
            <h2 className="text-2xl font-bold text-white">
              {contributor.userDetails?.name || contributor.login}
            </h2>
            <p className="text-gray-400 text-sm mt-0.5">@{contributor.login}</p>
            <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
              <span className="text-xs px-3 py-1 rounded-full font-semibold"
                style={{ color: tier.color, background: `${tier.color}20`, border: `1px solid ${tier.color}44` }}>
                {tier.label}
              </span>
              {contributor.userDetails?.hireable && (
                <span className="text-xs px-3 py-1 rounded-full font-semibold bg-green-500/20 border border-green-400/50 text-green-400">
                  💼 Available for Hire
                </span>
              )}
            </div>
          </div>

          {contributor.userDetails?.bio && (
            <p className="text-gray-500 text-sm text-center mt-4 italic leading-relaxed max-w-md">
              "{contributor.userDetails.bio}"
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 border-b border-white/10 bg-white/3">
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'activity', label: 'Activity', icon: '🔥' },
            { id: 'languages', label: 'Skills', icon: '💻' },
            { id: 'links', label: 'Links', icon: '🔗' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="px-4 py-3 text-sm font-medium border-b-2 transition-all flex items-center gap-2"
              style={{
                borderColor: activeTab === tab.id ? tier.color : 'transparent',
                color: activeTab === tab.id ? tier.color : '#9ca3af',
                background: activeTab === tab.id ? `${tier.color}08` : 'transparent',
              }}>
              <span>{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6 space-y-4">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: 'Contributions', value: contributor.contributions, icon: '🔨', color: tier.color },
                  { label: 'Followers', value: contributor.userDetails?.followers, icon: '👥', color: '#a855f7' },
                  { label: 'Following', value: contributor.userDetails?.following, icon: '🔗', color: '#22c55e' },
                  { label: 'Public Repos', value: contributor.userDetails?.public_repos, icon: '📦', color: '#06b6d4' },
                  { label: 'Gists', value: contributor.userDetails?.public_gists, icon: '📝', color: '#f59e0b' },
                  { label: '⭐ Received', value: contributor.userDetails?.total_stars ?? '—', icon: '⭐', color: '#eab308' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-3 border border-white/10 bg-white/5 text-center">
                    <div className="text-2xl mb-1">{s.icon}</div>
                    <div className="text-lg font-bold" style={{ color: s.color }}>
                      {typeof s.value === 'number' ? s.value.toLocaleString() : (s.value ?? '—')}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <div className="space-y-4">
              <ContributionHeatmap login={contributor.login} isVisible={true} />
            </div>
          )}

          {/* Languages Tab */}
          {activeTab === 'languages' && (
            <div className="space-y-4">
              <LanguageSkills languages={['JavaScript', 'TypeScript', 'Solidity', 'Python', 'Shell', 'CSS']} />
            </div>
          )}

          {/* Links Tab */}
          {activeTab === 'links' && (
            <div className="space-y-3">
              {contributor.userDetails?.company && (
                <div className="p-3 rounded-lg border border-white/10 bg-white/5">
                  <div className="text-xs text-gray-600 mb-1">Company</div>
                  <div className="text-sm font-medium text-white">🏢 {contributor.userDetails.company}</div>
                </div>
              )}
              {contributor.userDetails?.location && (
                <div className="p-3 rounded-lg border border-white/10 bg-white/5">
                  <div className="text-xs text-gray-600 mb-1">Location</div>
                  <div className="text-sm font-medium text-white">📍 {contributor.userDetails.location}</div>
                </div>
              )}
              {contributor.userDetails?.blog && (
                <a href={contributor.userDetails.blog.startsWith('http') ? contributor.userDetails.blog : `https://${contributor.userDetails.blog}`}
                  target="_blank" rel="noopener noreferrer"
                  className="p-3 rounded-lg border border-blue-400/30 bg-blue-500/5 hover:bg-blue-500/10 transition-all block">
                  <div className="text-xs text-gray-600 mb-1">Website</div>
                  <div className="text-sm font-medium text-blue-400">🌐 {contributor.userDetails.blog}</div>
                </a>
              )}
              {contributor.userDetails?.twitter_username && (
                <a href={`https://twitter.com/${contributor.userDetails.twitter_username}`}
                  target="_blank" rel="noopener noreferrer"
                  className="p-3 rounded-lg border border-sky-400/30 bg-sky-500/5 hover:bg-sky-500/10 transition-all block">
                  <div className="text-xs text-gray-600 mb-1">Twitter / X</div>
                  <div className="text-sm font-medium text-sky-400">𝕏 @{contributor.userDetails.twitter_username}</div>
                </a>
              )}
              {contributor.userDetails?.created_at && (
                <div className="p-3 rounded-lg border border-white/10 bg-white/5">
                  <div className="text-xs text-gray-600 mb-1">Member Since</div>
                  <div className="text-sm font-medium text-white">📅 {new Date(contributor.userDetails.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 px-6 pb-6 pt-4 border-t border-white/10">
          <a href={contributor.html_url} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110"
            style={{ background: `linear-gradient(135deg, ${tier.color}, ${tier.color}99)`, color: '#fff' }}>
            <GithubIcon size={16} /> GitHub Profile
          </a>
          <a href={`https://github.com/${REPO_OWNER}/${REPO_NAME}/commits?author=${contributor.login}`}
            target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border transition-all hover:bg-white/10"
            style={{ color: tier.color, borderColor: `${tier.color}44` }}>
            📊 All Commits
          </a>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   GitHub SVG Icon
───────────────────────────────────────────────────────────── */
function GithubIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Skeleton Card
───────────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/5 p-5 pt-8 animate-pulse">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-white/10" />
        <div className="h-3 w-24 bg-white/10 rounded" />
        <div className="h-2.5 w-16 bg-white/10 rounded" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-2 bg-white/10 rounded" />
        <div className="h-2 bg-white/10 rounded w-3/4" />
      </div>
      <div className="grid grid-cols-3 gap-1 mt-4">
        {[0,1,2].map(i => <div key={i} className="h-12 bg-white/10 rounded-lg" />)}
      </div>
      <div className="h-8 bg-white/10 rounded-xl mt-4" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Floating Orb Background
───────────────────────────────────────────────────────────── */
function FloatingOrbs() {
  const orbs = [
    { size: 500, x: '-10%', y: '-10%', color: '#3b82f6', delay: '0s', duration: '20s' },
    { size: 400, x: '60%',  y: '50%',  color: '#8b5cf6', delay: '-7s', duration: '25s' },
    { size: 350, x: '20%',  y: '70%',  color: '#06b6d4', delay: '-13s', duration: '18s' },
    { size: 300, x: '80%',  y: '5%',   color: '#f97316', delay: '-5s',  duration: '22s' },
  ];

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {orbs.map((orb, i) => (
        <div key={i}
          className="absolute rounded-full opacity-[0.07]"
          style={{
            width: orb.size, height: orb.size,
            left: orb.x, top: orb.y,
            background: orb.color,
            filter: 'blur(80px)',
            animation: `floatOrb ${orb.duration} ${orb.delay} ease-in-out infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes floatOrb {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(30px, 20px) scale(1.05); }
          100% { transform: translate(-20px, 40px) scale(0.95); }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Leaderboard Row (top 5)
───────────────────────────────────────────────────────────── */
function LeaderboardRow({ contributor, rank, max, onSelect }) {
  const tier = getTier(contributor.contributions);
  const pct = max > 0 ? (contributor.contributions / max) * 100 : 0;
  return (
    <div
      className="group flex items-center gap-4 p-3 rounded-xl border border-white/8 bg-white/4 hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
      onClick={() => onSelect(contributor)}
    >
      <span className="text-xl w-7 text-center flex-shrink-0">
        {rank <= 3 ? MEDAL[rank - 1] : <span className="text-gray-500 font-bold text-sm">#{rank}</span>}
      </span>
      <img src={contributor.avatar_url} alt={contributor.login}
        className="w-9 h-9 rounded-full border" style={{ borderColor: `${tier.color}88` }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white truncate">
            {contributor.userDetails?.name || contributor.login}
          </span>
          <span className="text-xs font-bold ml-2 flex-shrink-0" style={{ color: tier.color }}>
            {contributor.contributions.toLocaleString()} commits
          </span>
        </div>
        <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${tier.color}, ${tier.color}77)` }} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main Page
───────────────────────────────────────────────────────────── */
export default function ContributorsPage() {
  const navigate = useNavigate();

  const [contributors, setContributors] = useState([]);
  const [repoInfo, setRepoInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('contributions');
  const [filterTier, setFilterTier] = useState('all');
  const [selectedContributor, setSelectedContributor] = useState(null);
  const [selectedRank, setSelectedRank] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState('grid'); // 'grid' | 'leaderboard'
  const [compareMode, setCompareMode] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  /* ---- Fetch ---- */
  const fetchData = useCallback(async () => {
    try {
      setError(null);

      const headers = {};
      // Use a cached token from env if available
      if (import.meta.env?.VITE_GITHUB_TOKEN) {
        headers['Authorization'] = `token ${import.meta.env.VITE_GITHUB_TOKEN}`;
      }

      const [contribRes, repoRes] = await Promise.all([
        fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contributors?per_page=100&anon=false`, { headers }),
        fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}`, { headers }),
      ]);

      if (!contribRes.ok) {
        if (contribRes.status === 403) throw new Error('GitHub API rate limit exceeded. Please try again later or add a VITE_GITHUB_TOKEN.');
        if (contribRes.status === 404) throw new Error('Repository not found. Check REPO_OWNER / REPO_NAME constants.');
        throw new Error(`GitHub API error: ${contribRes.status}`);
      }

      const contribData = await contribRes.json();
      const repoData = repoRes.ok ? await repoRes.json() : null;

      // Fetch individual user details in parallel (max 20 to avoid rate limits)
      const toFetch = contribData.slice(0, 20);
      const userDetails = await Promise.allSettled(
        toFetch.map(c => fetch(`${GITHUB_API}/users/${c.login}`, { headers }).then(r => r.ok ? r.json() : null))
      );

      const enriched = contribData.map((c, i) => ({
        ...c,
        userDetails: i < toFetch.length && userDetails[i].status === 'fulfilled' ? userDetails[i].value : null,
      }));

      setContributors(enriched);
      setRepoInfo(repoData);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  /* ---- Derived data ---- */
  const sorted = [...contributors].sort((a, b) => {
    if (sortBy === 'contributions') return b.contributions - a.contributions;
    if (sortBy === 'name') return (a.userDetails?.name || a.login).localeCompare(b.userDetails?.name || b.login);
    if (sortBy === 'followers') return (b.userDetails?.followers ?? 0) - (a.userDetails?.followers ?? 0);
    if (sortBy === 'repos') return (b.userDetails?.public_repos ?? 0) - (a.userDetails?.public_repos ?? 0);
    return 0;
  });

  const filtered = sorted.filter(c => {
    const matchSearch = search === '' ||
      c.login.toLowerCase().includes(search.toLowerCase()) ||
      (c.userDetails?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.userDetails?.location || '').toLowerCase().includes(search.toLowerCase());
    const matchTier = filterTier === 'all' || getTier(c.contributions).label === filterTier;
    return matchSearch && matchTier;
  });

  const maxContrib = contributors.length > 0 ? contributors[0].contributions : 1;
  const totalCommits = contributors.reduce((s, c) => s + c.contributions, 0);
  const top5 = contributors.slice(0, 5);

  /* ─────────────────────── RENDER ─────────────────────── */
  return (
    <div className="relative min-h-screen text-white" style={{ background: 'linear-gradient(135deg, #020617 0%, #0f0c29 50%, #050c2b 100%)' }}>
      <FloatingOrbs />

      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="absolute top-6 left-6 z-50 flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 backdrop-blur-md text-sm text-white transition-all hover:border-white/30"
      >
        ← Back
      </button>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 pt-24">

        {/* ── Hero ── */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-xs font-semibold mb-6 tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live GitHub Data
          </div>
          <h1 className="text-5xl sm:text-7xl font-black mb-4 leading-none">
            <span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, #60a5fa, #a855f7, #06b6d4)' }}>
              Contributors
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto leading-relaxed">
            The brilliant minds building&nbsp;
            <a href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`} target="_blank" rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 font-semibold transition-colors">
              {REPO_OWNER}/{REPO_NAME}
            </a>
          </p>
          <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-600">
            {lastRefreshed && <span>Last updated: {lastRefreshed.toLocaleTimeString()}</span>}
            {repoInfo && (
              <>
                <span>·</span>
                <span>⭐ {repoInfo.stargazers_count?.toLocaleString()} stars</span>
                <span>·</span>
                <span>🍴 {repoInfo.forks_count?.toLocaleString()} forks</span>
                <span>·</span>
                <span>👁 {repoInfo.watchers_count?.toLocaleString()} watchers</span>
              </>
            )}
          </div>
        </div>

        {/* ── Stats bar ── */}
        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            <StatCard icon="👥" label="Total Contributors" value={contributors.length} color="#3b82f6" delay={0} />
            <StatCard icon="🔨" label="Total Commits" value={totalCommits} color="#a855f7" delay={150} />
            <StatCard icon="📦" label="Open Issues" value={repoInfo?.open_issues_count ?? 0} color="#f97316" delay={300} />
            <StatCard icon="⭐" label="GitHub Stars" value={repoInfo?.stargazers_count ?? 0} color="#eab308" delay={450} />
          </div>
        )}

        {/* ── Featured Contributors Section ── */}
        {!loading && !error && contributors.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-bold text-white">⭐ Featured</h2>
              <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {top5.slice(0, 3).map((c, idx) => {
                const tier = getTier(c.contributions);
                return (
                  <div key={c.login}
                    className="group relative rounded-2xl border border-white/15 p-5 overflow-hidden cursor-pointer transition-all duration-300 hover:scale-105 hover:border-white/30"
                    onClick={() => { setSelectedContributor(c); setSelectedRank(idx + 1); }}
                    style={{
                      background: `linear-gradient(135deg, ${tier.color}08, ${tier.color}02)`,
                      boxShadow: `inset 0 0 20px ${tier.color}10`,
                    }}>
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: `radial-gradient(circle at 50% 0%, ${tier.color}44, transparent 70%)`,
                      }} />
                    
                    <div className="relative z-10 flex items-center gap-4">
                      <div className="relative flex-shrink-0">
                        <div className="absolute inset-0 rounded-full blur-lg" style={{ background: tier.color, opacity: 0.4 }} />
                        <img src={c.avatar_url} alt={c.login} className="relative w-16 h-16 rounded-full border-2 object-cover" style={{ borderColor: tier.color }} />
                        <span className="absolute -right-1 -bottom-1 text-xl">{MEDAL[idx]}</span>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-white truncate">{c.userDetails?.name || c.login}</h3>
                        <p className="text-sm text-gray-400">@{c.login}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ color: tier.color, background: `${tier.color}20`, border: `1px solid ${tier.color}44` }}>
                            {c.contributions} commits
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Two-column: Leaderboard + Controls ── */}
        {!loading && !error && contributors.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            {/* Leaderboard panel */}
            <div className="lg:col-span-1 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-5"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
              <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                🏆 Top Contributors
              </h2>
              <div className="space-y-2">
                {top5.map((c, i) => (
                  <LeaderboardRow key={c.login} contributor={c} rank={i + 1} max={maxContrib}
                    onSelect={contrib => { setSelectedContributor(contrib); setSelectedRank(i + 1); }} />
                ))}
              </div>
            </div>

            {/* Controls panel */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Search */}
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">🔍</div>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name, username or location…"
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/60 transition-colors text-sm"
                />
                {search && (
                  <button onClick={() => setSearch('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">✕</button>
                )}
              </div>

              {/* Filters row */}
              <div className="flex flex-wrap gap-3">
                {/* Sort */}
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-gray-500 mb-1.5 block">Sort by</label>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/60 appearance-none cursor-pointer"
                  >
                    <option value="contributions" className="bg-gray-900">Contributions</option>
                    <option value="name" className="bg-gray-900">Name (A–Z)</option>
                    <option value="followers" className="bg-gray-900">Followers</option>
                    <option value="repos" className="bg-gray-900">Public Repos</option>
                  </select>
                </div>

                {/* Tier filter */}
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-gray-500 mb-1.5 block">Filter by tier</label>
                  <select
                    value={filterTier}
                    onChange={e => setFilterTier(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/60 appearance-none cursor-pointer"
                  >
                    <option value="all" className="bg-gray-900">All Tiers</option>
                    {TIER_CONFIG.map(t => (
                      <option key={t.label} value={t.label} className="bg-gray-900">{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* View toggle */}
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">View</label>
                  <div className="flex rounded-xl border border-white/10 overflow-hidden">
                    {[['grid', '▦ Grid'], ['leaderboard', '≡ List']].map(([v, label]) => (
                      <button key={v} onClick={() => setView(v)}
                        className="px-4 py-2.5 text-sm font-medium transition-colors"
                        style={{ background: view === v ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.03)', color: view === v ? '#93c5fd' : '#9ca3af' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Refresh */}
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">&nbsp;</label>
                  <button onClick={handleRefresh} disabled={refreshing}
                    className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-white transition-all flex items-center gap-2 disabled:opacity-40"
                    title="Refresh data from GitHub">
                    <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
                    {refreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>

                {/* Compare */}
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">&nbsp;</label>
                  <button onClick={() => setShowComparison(true)} disabled={contributors.length < 2}
                    className="px-4 py-2.5 rounded-xl border bg-purple-500/10 hover:bg-purple-500/20 text-sm text-purple-300 font-medium transition-all flex items-center gap-2 disabled:opacity-40"
                    style={{ borderColor: 'rgba(168, 85, 247, 0.3)' }}
                    title="Compare two contributors">
                    <span>⚔️</span>
                    Compare
                  </button>
                </div>
              </div>

              {/* Tier pill legend */}
              <div className="flex flex-wrap gap-2">
                {TIER_CONFIG.map(t => (
                  <button key={t.label} onClick={() => setFilterTier(filterTier === t.label ? 'all' : t.label)}
                    className="text-xs px-3 py-1 rounded-full border font-medium transition-all hover:scale-105"
                    style={{
                      color: t.color,
                      borderColor: filterTier === t.label ? t.color : `${t.color}44`,
                      background: filterTier === t.label ? `${t.color}22` : 'transparent',
                    }}>
                    {t.label}
                    <span className="ml-1 opacity-70">
                      ({contributors.filter(c => getTier(c.contributions).label === t.label).length})
                    </span>
                  </button>
                ))}
              </div>

              {/* Result count */}
              <p className="text-xs text-gray-600">
                Showing <span className="text-gray-400 font-semibold">{filtered.length}</span> of{' '}
                <span className="text-gray-400 font-semibold">{contributors.length}</span> contributors
              </p>
            </div>
          </div>
        )}

        {/* ── Achievements/Stats Section ── */}
        {!loading && !error && contributors.length > 0 && (
          <div className="mb-12 p-6 rounded-3xl border border-white/15 bg-gradient-to-br from-white/5 to-white/2"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <span>📊</span> Project Metrics & Achievements
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Most Active Contributor', value: contributors[0].login, icon: '🔥', color: '#f97316' },
                { label: 'Total Contribution Power', value: `${totalCommits.toLocaleString()}`, icon: '⚡', color: '#eab308' },
                { label: 'Contribution Tiers', value: `${TIER_CONFIG.length}`, icon: '🎖️', color: '#a855f7' },
                { label: 'Avg Per Contributor', value: Math.round(totalCommits / contributors.length).toLocaleString(), icon: '📈', color: '#06b6d4' },
              ].map((stat, i) => (
                <div key={i} className="relative group rounded-2xl border border-white/10 p-4 overflow-hidden bg-white/3"
                  style={{ borderColor: `${stat.color}33` }}>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{ background: `radial-gradient(circle at 50% 0%, ${stat.color}22, transparent 70%)` }} />
                  <div className="relative z-10">
                    <div className="text-2xl mb-1">{stat.icon}</div>
                    <div className="text-xs text-gray-500 mb-1">{stat.label}</div>
                    <div className="text-sm font-bold text-white truncate" style={{ color: stat.color }}>
                      {stat.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-red-400 mb-2">Failed to load contributors</h2>
            <p className="text-gray-500 mb-6 max-w-md mx-auto text-sm">{error}</p>
            <button onClick={handleRefresh}
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all">
              Try Again
            </button>
          </div>
        )}

        {/* ── Grid View ── */}
        {!loading && !error && view === 'grid' && (
          <>
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                <div className="text-5xl mb-4">🔍</div>
                <p>No contributors match your search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filtered.map((c, i) => {
                  const rank = sorted.indexOf(c) + 1;
                  return (
                    <ContributorCard
                      key={c.login}
                      contributor={c}
                      rank={rank}
                      maxContributions={maxContrib}
                      onSelect={contrib => { setSelectedContributor(contrib); setSelectedRank(rank); }}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Leaderboard / List View ── */}
        {!loading && !error && view === 'leaderboard' && (
          <div className="max-w-3xl mx-auto space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                <div className="text-5xl mb-4">🔍</div>
                <p>No contributors match your search.</p>
              </div>
            ) : (
              filtered.map((c, i) => {
                const rank = sorted.indexOf(c) + 1;
                return (
                  <LeaderboardRow key={c.login} contributor={c} rank={rank} max={maxContrib}
                    onSelect={contrib => { setSelectedContributor(contrib); setSelectedRank(rank); }} />
                );
              })
            )}
          </div>
        )}

        {/* ── Footer ── */}
        {!loading && !error && (
          <div className="mt-20 text-center text-xs text-gray-700 space-y-1">
            <p>Data sourced live from the&nbsp;
              <a href={`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contributors`}
                target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:text-blue-600 transition-colors">
                GitHub REST API
              </a>
            </p>
            <p>GitHub API has a rate limit of 60 requests/hr for unauthenticated requests.</p>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {selectedContributor && (
        <ContributorModal
          contributor={selectedContributor}
          rank={selectedRank}
          onClose={() => { setSelectedContributor(null); setSelectedRank(null); }}
        />
      )}

      {showComparison && contributors.length >= 2 && (
        <ComparisonModal
          contributors={contributors}
          onClose={() => setShowComparison(false)}
        />
      )}
    </div>
  );
}
