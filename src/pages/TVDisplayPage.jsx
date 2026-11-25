import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Volume2, VolumeX, Sparkles, Scissors, Clock, AlertTriangle } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { fetchTVDisplay, subscribeToSalonUpdates } from '../services/supabaseService'

function playCalledChime(audioCtx) {
  if (!audioCtx) return
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    const now = audioCtx.currentTime
    const notes = [587.33, 880.0] // D5 -> A5 gentle salon chime
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.16)
      gain.gain.setValueAtTime(0.001, now + idx * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.16 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.45)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(now + idx * 0.16)
      osc.stop(now + idx * 0.16 + 0.5)
    })
  } catch {
    // Ignore Web Audio errors if blocked by browser policy
  }
}

export default function TVDisplayPage() {
  const { t, language } = useLanguage()

  const [audioEnabled, setAudioEnabled] = useState(false)
  const audioCtxRef = useRef(null)
  const knownCalledTokensRef = useRef(new Set())
  const initializedRef = useRef(false)

  const [displayData, setDisplayData] = useState({
    salonNameEn: 'Royal Crown Salon',
    salonNameGu: 'રોયલ ક્રાઉન સલૂન',
    chairs: [],
    nextTokens: [],
    waitingCount: 0,
    isLiveSupabase: false
  })
  const [connectionWarning, setConnectionWarning] = useState(false)
  const [nowClock, setNowClock] = useState(() => new Date())

  const handleToggleChime = () => {
    if (!audioEnabled) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (AudioCtx && !audioCtxRef.current) {
          audioCtxRef.current = new AudioCtx()
        }
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume()
        }
        playCalledChime(audioCtxRef.current)
      } catch {}
      setAudioEnabled(true)
    } else {
      setAudioEnabled(false)
    }
  }

  const loadDisplay = useCallback(async () => {
    try {
      const res = await fetchTVDisplay()
      if (!res.success) {
        setConnectionWarning(true)
        return
      }

      setConnectionWarning(false)
      setDisplayData(res)

      const currentCalled = new Set(
        (res.chairs || [])
          .filter((c) => c.token_status === 'called' && c.current_token)
          .map((c) => c.current_token)
      )

      if (initializedRef.current && audioEnabled) {
        for (const token of currentCalled) {
          if (!knownCalledTokensRef.current.has(token)) {
            playCalledChime(audioCtxRef.current)
            break
          }
        }
      }

      knownCalledTokensRef.current = currentCalled
      initializedRef.current = true
    } catch {
      setConnectionWarning(true)
    }
  }, [audioEnabled])

  useEffect(() => {
    loadDisplay()

    const unsubscribe = subscribeToSalonUpdates(
      () => {
        loadDisplay()
      },
      (channelStatus) => {
        if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setConnectionWarning(true)
        } else if (channelStatus === 'SUBSCRIBED' || channelStatus === 'LOCAL') {
          setConnectionWarning(false)
        }
      }
    )

    const clockInterval = setInterval(() => {
      setNowClock(new Date())
    }, 1000)

    return () => {
      unsubscribe()
      clearInterval(clockInterval)
    }
  }, [loadDisplay])

  const salonTitle =
    language === 'gu' && displayData.salonNameGu
      ? displayData.salonNameGu
      : displayData.salonNameEn || t('salon_title')

  return (
    <div className="min-h-screen bg-charcoal-950 text-white p-6 sm:p-10 flex flex-col justify-between space-y-8 select-none">
      {/* Top TV Bar: Salon Branding, Live Time & Chime Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-charcoal-700/80 pb-6">
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/20 border-2 border-gold-500 flex items-center justify-center text-gold-400 shadow-lg">
            <Scissors className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white flex items-center gap-2">
              {salonTitle}
              <Sparkles className="w-5 h-5 text-gold-400" />
            </h1>
            <p className="text-xs sm:text-sm text-gray-400 uppercase tracking-widest font-semibold mt-0.5">
              {t('tv_subtitle')} &bull; {t('tagline')}
            </p>
          </div>
        </div>

        {/* Live Clock, Chime Toggle & Sync Indicator */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3.5 py-2 rounded-xl bg-charcoal-900 border border-charcoal-700 text-gray-200 text-xs font-mono font-bold flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold-400" />
            <span>{nowClock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <button
            type="button"
            onClick={handleToggleChime}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-2 ${
              audioEnabled
                ? 'bg-gold-500/15 border-gold-500 text-gold-300'
                : 'bg-charcoal-800 border-charcoal-700 text-gray-300 hover:text-white'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span>{audioEnabled ? t('tv_chime_active') : t('tv_enable_chime')}</span>
          </button>

          <div
            className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 ${
              connectionWarning
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                connectionWarning ? 'bg-rose-400' : 'bg-emerald-400 animate-ping'
              }`}
            />
            <span>{t('tv_live_sync')}</span>
          </div>
        </div>
      </div>

      {/* Connection Warning Banner */}
      {connectionWarning && (
        <div className="bg-rose-500/15 border border-rose-500/40 rounded-2xl p-4 text-sm text-rose-200 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span className="font-semibold">{t('tv_connection_warning')}</span>
        </div>
      )}

      {/* Main TV Grid: Active Barber Chairs (Minimum Data Only: Barber Name, Token, Status) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(displayData.chairs || []).map((chair, index) => {
          const isCalled = chair.token_status === 'called' && Boolean(chair.current_token)
          const isInChair = chair.token_status === 'in_chair' && Boolean(chair.current_token)
          const isOnBreak = chair.barber_status === 'on_break'

          return (
            <div
              key={`${chair.barber_name}-${index}`}
              className={`rounded-3xl p-6 sm:p-8 border transition-all relative overflow-hidden flex flex-col justify-between min-h-[220px] shadow-2xl ${
                isCalled
                  ? 'bg-gradient-to-b from-gold-500/25 to-charcoal-900 border-2 border-gold-400 shadow-gold-500/20 scale-[1.02]'
                  : 'bg-charcoal-900 border-charcoal-700'
              }`}
            >
              {isCalled && (
                <div className="absolute top-0 right-0 bg-gold-500 text-charcoal-950 font-black text-xs px-3.5 py-1.5 rounded-bl-xl uppercase tracking-wider animate-pulse">
                  {t('tv_calling_now')}
                </div>
              )}

              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {t('chair_label')} #{index + 1} &bull; {chair.barber_name}
                </span>

                {chair.current_token ? (
                  <p className="text-6xl sm:text-7xl font-black font-mono text-gold-400 tracking-wider">
                    {chair.current_token}
                  </p>
                ) : (
                  <p className="text-3xl font-extrabold text-gray-500 tracking-wide pt-3">
                    {isOnBreak ? t('on_break') : t('available')}
                  </p>
                )}
              </div>

              <div className="pt-6 border-t border-charcoal-800 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-200">
                  {isCalled
                    ? t('tv_calling_now')
                    : isInChair
                    ? t('tv_in_chair')
                    : isOnBreak
                    ? t('on_break')
                    : t('tv_ready_for_next')}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom TV Bar: Next 5 Waiting Tokens (Tokens Only) */}
      <div className="bg-charcoal-900/90 border border-charcoal-700 rounded-3xl p-6 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
            {t('tv_next_five_tokens')}:
          </p>
          <span className="text-xs font-semibold text-gold-400">
            {t('customers_waiting')}: {displayData.waitingCount}
          </span>
        </div>

        {(displayData.nextTokens || []).length === 0 ? (
          <p className="text-base sm:text-lg font-semibold text-emerald-300 py-2">
            {t('tv_welcome_empty')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            {displayData.nextTokens.map((token, index) => (
              <div
                key={`${token}-${index}`}
                className="px-6 py-3.5 rounded-2xl bg-charcoal-800 border border-charcoal-700 text-center font-mono font-black text-2xl text-white shadow-md flex items-center gap-2.5"
              >
                <span className="text-xs text-gold-500">#{index + 1}</span>
                <span>{token}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
