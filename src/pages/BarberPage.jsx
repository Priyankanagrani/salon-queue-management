import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Scissors,
  Play,
  CheckCircle2,
  Coffee,
  Clock,
  Sparkles,
  Lock,
  LogOut,
  Database,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  UserCheck
} from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  fetchAllBarbers,
  getBarberSession,
  clearBarberSession,
  verifyBarberPin,
  logoutBarberSession,
  fetchBarberView,
  startBarberService,
  completeBarberService,
  setBarberAvailability,
  subscribeToSalonUpdates
} from '../services/supabaseService'

function formatElapsedMmSs(startedAt, nowMs) {
  if (!startedAt) return '00:00'
  const diffSeconds = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000))
  const mins = Math.floor(diffSeconds / 60)
  const secs = diffSeconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function BarberPage() {
  const { name } = useParams()
  const { t, language } = useLanguage()

  const [barberList, setBarberList] = useState([])
  const [resolvedName, setResolvedName] = useState(name || '')
  const [session, setSession] = useState(() => (name ? getBarberSession(name) : null))

  // PIN Login states
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [verifyingPin, setVerifyingPin] = useState(false)

  // Station data states
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stationBarber, setStationBarber] = useState(null)
  const [currentCustomer, setCurrentCustomer] = useState(null)
  const [nextCustomer, setNextCustomer] = useState(null)
  const [isLive, setIsLive] = useState(isSupabaseConfigured())
  const [actionError, setActionError] = useState('')
  const [busyAction, setBusyAction] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Load list of barber stations and resolve default station name when /barber has no :name
  useEffect(() => {
    let active = true
    async function loadStations() {
      const res = await fetchAllBarbers()
      if (!active) return
      if (res.success && Array.isArray(res.data)) {
        setBarberList(res.data)
        const target = name || res.data[0]?.name || ''
        setResolvedName(target)
        setSession(target ? getBarberSession(target) : null)
      } else {
        const target = name || ''
        setResolvedName(target)
        setSession(target ? getBarberSession(target) : null)
      }
    }
    setPinInput('')
    setPinError('')
    setActionError('')
    loadStations()
    return () => {
      active = false
    }
  }, [name])

  const handleSessionInvalidated = useCallback(() => {
    if (resolvedName) {
      clearBarberSession(resolvedName)
    }
    setSession(null)
    setStationBarber(null)
    setCurrentCustomer(null)
    setNextCustomer(null)
    setPinInput('')
  }, [resolvedName])

  const loadStationView = useCallback(
    async (isBackground = false) => {
      if (!session?.sessionToken || !resolvedName) {
        setLoading(false)
        return
      }
      if (!isBackground) {
        setRefreshing(true)
      }

      try {
        const res = await fetchBarberView(session.sessionToken, resolvedName)
        if (res.unauthorized) {
          handleSessionInvalidated()
          return
        }
        if (!res.success) {
          if (!isBackground) {
            setActionError(res.error || t('barber_not_found'))
          }
          return
        }

        setStationBarber(res.barber)
        setCurrentCustomer(res.currentCustomer)
        setNextCustomer(res.nextCustomer)
        setIsLive(Boolean(res.isLiveSupabase))
        setActionError('')
      } catch (err) {
        if (!isBackground) {
          setActionError(err.message || 'Error loading barber station.')
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [session?.sessionToken, resolvedName, handleSessionInvalidated, t]
  )

  useEffect(() => {
    if (!session?.sessionToken || !resolvedName) {
      setLoading(false)
      return
    }
    setLoading(true)
    loadStationView(false)

    const unsubscribe = subscribeToSalonUpdates(() => {
      loadStationView(true)
    })

    const timerTick = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      unsubscribe()
      clearInterval(timerTick)
    }
  }, [session?.sessionToken, resolvedName, loadStationView])

  const handlePinSubmit = async (e) => {
    e.preventDefault()
    if (!resolvedName || verifyingPin) return
    setPinError('')
    setVerifyingPin(true)

    try {
      const res = await verifyBarberPin(resolvedName, pinInput)
      if (!res.success) {
        setPinError(res.error || 'Incorrect PIN')
        return
      }
      setSession({
        sessionToken: res.sessionToken,
        role: 'barber',
        barberId: res.barberId,
        barberName: res.barberName,
        expiresAt: res.expiresAt
      })
      setPinInput('')
    } catch (err) {
      setPinError(err.message || 'Verification failed')
    } finally {
      setVerifyingPin(false)
    }
  }

  const handleLockStation = async () => {
    if (busyAction) return
    setBusyAction(true)
    try {
      await logoutBarberSession(
        session?.sessionToken,
        session?.barberId || stationBarber?.id,
        resolvedName
      )
    } finally {
      setBusyAction(false)
      handleSessionInvalidated()
    }
  }

  const handleStartService = async () => {
    if (!session?.sessionToken || !stationBarber?.id || !currentCustomer?.id || busyAction) return
    setBusyAction(true)
    setActionError('')
    try {
      const res = await startBarberService(session.sessionToken, stationBarber.id, currentCustomer.id)
      if (res.unauthorized) {
        handleSessionInvalidated()
        return
      }
      if (!res.success) {
        setActionError(res.error || 'Unable to start service.')
      }
      await loadStationView(true)
    } catch (err) {
      setActionError(err.message || 'Error starting service.')
    } finally {
      setBusyAction(false)
    }
  }

  const handleCompleteService = async () => {
    if (!session?.sessionToken || !stationBarber?.id || !currentCustomer?.id || busyAction) return
    setBusyAction(true)
    setActionError('')
    try {
      const res = await completeBarberService(session.sessionToken, stationBarber.id, currentCustomer.id)
      if (res.unauthorized) {
        handleSessionInvalidated()
        return
      }
      if (!res.success) {
        setActionError(res.error || 'Unable to complete service.')
      }
      await loadStationView(true)
    } catch (err) {
      setActionError(err.message || 'Error completing service.')
    } finally {
      setBusyAction(false)
    }
  }

  const handleToggleAvailability = async () => {
    if (!session?.sessionToken || !stationBarber?.id || busyAction) return
    const nextStatus = stationBarber.status === 'on_break' ? 'available' : 'on_break'
    setBusyAction(true)
    setActionError('')
    try {
      const res = await setBarberAvailability(session.sessionToken, stationBarber.id, nextStatus)
      if (res.unauthorized) {
        handleSessionInvalidated()
        return
      }
      if (!res.success) {
        setActionError(res.error || 'Unable to update availability.')
      }
      await loadStationView(true)
    } catch (err) {
      setActionError(err.message || 'Error updating availability.')
    } finally {
      setBusyAction(false)
    }
  }

  const formatServicesText = (items) => {
    if (!Array.isArray(items) || items.length === 0) return '—'
    return items
      .map((s) => (language === 'gu' && s.name_gu ? s.name_gu : s.name_en))
      .join(', ')
  }

  const knownStation = barberList.some(
    (b) => b.name.trim().toLowerCase() === (resolvedName || '').trim().toLowerCase()
  )

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      {/* Barber Station Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-charcoal-900 border border-charcoal-700 rounded-2xl p-3 text-xs">
        <span className="text-gray-400 font-semibold uppercase">{t('barber_switch_station')}:</span>
        <div className="flex flex-wrap gap-1.5">
          {barberList.map((b) => {
            const isCurrent = b.name.trim().toLowerCase() === (resolvedName || '').trim().toLowerCase()
            return (
              <Link
                key={b.id}
                to={`/barber/${b.name}`}
                className={`px-3 py-1.5 rounded-lg font-bold transition ${
                  isCurrent
                    ? 'bg-gold-500 text-charcoal-950'
                    : 'bg-charcoal-800 text-gray-300 hover:text-white'
                }`}
              >
                {b.name}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Station Unknown Fallback */}
      {barberList.length > 0 && resolvedName && !knownStation ? (
        <div className="bg-charcoal-900 border border-rose-500/30 rounded-3xl p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
          <p className="text-sm font-bold text-white">{t('barber_not_found')}</p>
          <Link
            to={`/barber/${barberList[0].name}`}
            className="inline-block px-5 py-2.5 rounded-xl bg-gold-500 text-charcoal-950 font-black text-xs"
          >
            {barberList[0].name}
          </Link>
        </div>
      ) : !session?.sessionToken ? (
        /* Per-Station Barber PIN Login */
        <div className="bg-charcoal-900 border border-gold-500/30 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-gold-500/15 border border-gold-500/30 text-gold-400 flex items-center justify-center mx-auto">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-extrabold text-white">
              {t('barber_pin_title')}: <span className="text-gold-400">{resolvedName}</span>
            </h1>
            <p className="text-xs text-gray-300 leading-relaxed">{t('barber_pin_desc')}</p>
          </div>

          {pinError && (
            <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{pinError}</span>
            </div>
          )}

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider">
                {t('barber_pin_label')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder={t('reception_pin_placeholder')}
                className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-3.5 text-center text-xl tracking-[0.4em] font-mono text-white placeholder-gray-500 focus:outline-none transition"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={verifyingPin || !pinInput.trim()}
              className="w-full py-3.5 rounded-xl bg-gold-500 hover:bg-gold-600 disabled:bg-charcoal-700 disabled:text-gray-400 text-charcoal-950 font-black text-sm shadow-lg transition"
            >
              {verifyingPin ? t('reception_pin_verifying') : t('barber_pin_unlock')}
            </button>
          </form>

          {!isSupabaseConfigured() && (
            <p className="text-[11px] text-center text-gray-400">{t('barber_pin_hint_sandbox')}</p>
          )}
        </div>
      ) : (
        /* Unlocked Authorized Barber Console */
        <>
          {/* Connection Status & Lock Station Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-charcoal-900 border border-charcoal-700/80 rounded-2xl px-4 py-2.5 text-xs text-gray-300 shadow-sm">
            <div className="flex items-center space-x-2">
              <Database className={`w-4 h-4 ${isLive ? 'text-emerald-400' : 'text-gold-400'}`} />
              <span className="font-medium">{isLive ? t('db_live') : t('db_sandbox')}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => loadStationView(false)}
                disabled={refreshing}
                className="flex items-center gap-1 text-gray-300 hover:text-white transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>{t('refresh_label')}</span>
              </button>
              <button
                type="button"
                onClick={handleLockStation}
                disabled={busyAction}
                className="flex items-center gap-1 text-rose-300 hover:text-rose-200 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-lg transition disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t('barber_lock_station')}</span>
              </button>
            </div>
          </div>

          {/* Stage 5 Notice */}
          <div className="bg-charcoal-900/80 border border-gold-500/20 rounded-xl p-3 text-xs text-gray-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold-500 flex-shrink-0" />
            <span>{t('stage_notice')}</span>
          </div>

          {actionError && (
            <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-3.5 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {loading || !stationBarber ? (
            <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl p-8 text-center animate-pulse text-xs text-gray-400">
              {t('loading_status')}
            </div>
          ) : (
            <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl p-6 space-y-5 shadow-xl">
              {/* Barber Profile & On Break / Available Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-black text-white flex items-center gap-2">
                    <Scissors className="w-5 h-5 text-gold-500" />
                    {t('barber_station_title')}: {stationBarber.name}
                  </h1>
                  <p className="text-xs text-gray-400 mt-0.5">{t('barber_console_subtitle')}</p>
                </div>

                {!stationBarber.is_on_duty ? (
                  <span className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-charcoal-800 text-gray-400 border border-charcoal-700">
                    {t('off_duty')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleToggleAvailability}
                    disabled={
                      busyAction ||
                      stationBarber.status === 'serving' ||
                      Boolean(currentCustomer)
                    }
                    title={
                      stationBarber.status === 'serving' || currentCustomer
                        ? t('barber_break_locked_hint')
                        : ''
                    }
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                      stationBarber.status === 'on_break'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                    }`}
                  >
                    {stationBarber.status === 'on_break' ? (
                      <>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>{t('action_available')}</span>
                      </>
                    ) : (
                      <>
                        <Coffee className="w-3.5 h-3.5" />
                        <span>{t('action_on_break')}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {!stationBarber.is_on_duty && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>{t('barber_off_duty_notice')}</span>
                </div>
              )}

              {/* Currently Assigned Customer Card */}
              <div className="bg-charcoal-850 border border-charcoal-700/80 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {t('active_assigned_customer')}
                  </p>
                  {currentCustomer && (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                        currentCustomer.status === 'in_chair'
                          ? 'bg-gold-500/15 text-gold-300 border-gold-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {currentCustomer.status === 'in_chair' ? t('status_in_chair') : t('status_called')}
                    </span>
                  )}
                </div>

                {!currentCustomer ? (
                  <div className="py-6 text-center space-y-2">
                    <p className="text-sm font-semibold text-gray-400 italic">
                      {t('no_active_customer')}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <span className="text-3xl sm:text-4xl font-black text-gold-400 font-mono">
                        {currentCustomer.token_number}
                      </span>
                      <p className="text-base font-bold text-white">{currentCustomer.customer_name}</p>
                      <p className="text-xs text-gray-300">
                        {formatServicesText(currentCustomer.selected_services)}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {t('expected_duration')}: {currentCustomer.total_duration} {t('mins')}
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-[11px] text-gray-400 uppercase block">
                        {t('service_timer')}
                      </span>
                      <span className="text-2xl font-mono font-bold text-white flex items-center justify-end gap-1.5 mt-1">
                        <Clock className="w-4 h-4 text-gold-500" />
                        {currentCustomer.status === 'in_chair'
                          ? formatElapsedMmSs(currentCustomer.service_started_at, nowMs)
                          : '00:00'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Action Buttons: Start Service (called -> in_chair) & Done (in_chair -> done) */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleStartService}
                    disabled={
                      busyAction ||
                      !stationBarber.is_on_duty ||
                      !currentCustomer ||
                      currentCustomer.status !== 'called'
                    }
                    className={`py-3.5 rounded-xl font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-1.5 ${
                      !busyAction &&
                      stationBarber.is_on_duty &&
                      currentCustomer?.status === 'called'
                        ? 'bg-gold-500 hover:bg-gold-600 text-charcoal-950 shadow-lg'
                        : 'bg-charcoal-800 text-gray-500 border border-charcoal-700 cursor-not-allowed'
                    }`}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{t('action_start_service')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCompleteService}
                    disabled={
                      busyAction ||
                      !currentCustomer ||
                      currentCustomer.status !== 'in_chair'
                    }
                    className={`py-3.5 rounded-xl font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-1.5 ${
                      !busyAction && currentCustomer?.status === 'in_chair'
                        ? 'bg-emerald-500 hover:bg-emerald-600 text-charcoal-950 shadow-lg'
                        : 'bg-charcoal-800 text-gray-500 border border-charcoal-700 cursor-not-allowed'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('action_done_service')}</span>
                  </button>
                </div>
              </div>

              {/* Next Eligible Customer Preview */}
              <div className="bg-charcoal-800/60 border border-charcoal-700/60 rounded-xl p-3.5 text-xs flex items-center justify-between gap-2 text-gray-400">
                <span>{t('up_next_in_line')}:</span>
                {nextCustomer ? (
                  <span className="font-bold text-white font-mono">
                    {nextCustomer.token_number} ({nextCustomer.customer_name})
                  </span>
                ) : (
                  <span className="italic text-gray-400">{t('no_eligible_next')}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
