import React, { useState, useEffect } from 'react'
import { FlaskConical, Clock, Check, X } from 'lucide-react'
import { isDevTestingMode, setDevTestingMode } from '../../services/supabaseService'

/**
 * Development Testing Control
 * Only rendered in development (import.meta.env.DEV === true).
 * Excluded/tree-shaken in production builds.
 */
export default function DevTestingControl({ onToggle }) {
  // Condition 6: Never expose in production
  if (!import.meta.env.DEV) {
    return null
  }

  const [active, setActive] = useState(false)

  useEffect(() => {
    setActive(isDevTestingMode())
  }, [])

  const handleToggle = () => {
    const nextState = !active
    setDevTestingMode(nextState)
    setActive(nextState)
    if (onToggle) onToggle(nextState)
  }

  return (
    <div className="bg-charcoal-900/90 border border-gold-500/30 rounded-2xl p-3 sm:p-4 text-xs shadow-lg transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start sm:items-center space-x-2.5">
        <div className={`p-1.5 rounded-lg ${active ? 'bg-amber-500/20 text-amber-400' : 'bg-charcoal-800 text-gray-400'}`}>
          <FlaskConical className="w-4 h-4" />
        </div>
        <div>
          <span className="font-bold text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            Dev Testing Mode:
            <span className={active ? 'text-amber-400 font-extrabold' : 'text-gray-400'}>
              {active ? 'ACTIVE (Operating Hours Bypassed)' : 'OFF (Operating Hours Enforced: 09:00–21:00)'}
            </span>
          </span>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {active
              ? '24/7 testing enabled. Manual Open/Closed setting is still strictly respected.'
              : 'Enforcing 9:00 AM – 9:00 PM hours and 30-min auto-close rule.'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleToggle}
        className={`px-3.5 py-2 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 flex-shrink-0 ${
          active
            ? 'bg-charcoal-800 hover:bg-charcoal-700 text-gray-300 border border-charcoal-600'
            : 'bg-gold-500 hover:bg-gold-600 text-charcoal-950 shadow-md font-black'
        }`}
      >
        {active ? (
          <>
            <X className="w-3.5 h-3.5" />
            <span>Enforce Salon Hours</span>
          </>
        ) : (
          <>
            <Check className="w-3.5 h-3.5" />
            <span>Enable 24/7 Testing Mode</span>
          </>
        )}
      </button>
    </div>
  )
}
