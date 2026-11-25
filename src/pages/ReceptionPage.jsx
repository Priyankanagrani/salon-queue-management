import React, { useState, useEffect, useCallback } from 'react'
import {
  Users,
  Clock,
  Scissors,
  UserPlus,
  Phone,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Shield,
  Lock,
  LogOut,
  Database,
  RefreshCw,
  X,
  Check,
  User,
  AlertCircle,
  XCircle
} from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  getStaffSession,
  clearStaffSession,
  verifyStaffPin,
  fetchReceptionDashboard,
  fetchServices,
  fetchSalonSettings,
  isOnlineQueueOpen,
  callNextCustomer,
  addWalkInCustomer,
  cancelQueueEntryByReception,
  markCustomerNoShow,
  subscribeToSalonUpdates,
  logoutStaffSession
} from '../services/supabaseService'

const TEN_MINUTES_MS = 10 * 60 * 1000

function formatMmSs(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

function getBarberBadge(barber, t) {
  if (!barber.is_on_duty) {
    return {
      label: t('off_duty'),
      classes: 'bg-charcoal-800 text-gray-400 border border-charcoal-700'
    }
  }
  const map = {
    available: {
      label: t('available'),
      classes: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
    },
    serving: {
      label: t('serving'),
      classes: 'bg-gold-500/10 text-gold-400 border border-gold-500/30'
    },
    on_break: {
      label: t('on_break'),
      classes: 'bg-charcoal-700 text-gray-300 border border-charcoal-600'
    }
  }
  return map[barber.status] || map.on_break
}

export default function ReceptionPage() {
  const { t, language } = useLanguage()

  // Staff Session & PIN Gate
  const [session, setSession] = useState(() => getStaffSession('reception'))
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [verifyingPin, setVerifyingPin] = useState(false)

  // Dashboard Data
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [barbers, setBarbers] = useState([])
  const [waitingQueue, setWaitingQueue] = useState([])
  const [services, setServices] = useState([])
  const [settings, setSettings] = useState(null)
  const [isLive, setIsLive] = useState(isSupabaseConfigured())
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Feedback & Busy States
  const [bannerError, setBannerError] = useState('')
  const [bannerSuccess, setBannerSuccess] = useState('')
  const [callingBarberId, setCallingBarberId] = useState(null)

  // Walk-in Modal State
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [walkInName, setWalkInName] = useState('')
  const [walkInPhone, setWalkInPhone] = useState('')
  const [walkInServices, setWalkInServices] = useState([])
  const [walkInBarberId, setWalkInBarberId] = useState(null)
  const [walkInErrors, setWalkInErrors] = useState({})
  const [walkInSubmitError, setWalkInSubmitError] = useState('')
  const [submittingWalkIn, setSubmittingWalkIn] = useState(false)

  // Confirmation Modals
  const [cancelTarget, setCancelTarget] = useState(null)
  const [noShowTarget, setNoShowTarget] = useState(null)
  const [processingAction, setProcessingAction] = useState(false)

  const handleUnauthorized = useCallback(() => {
    clearStaffSession('reception')
    setSession(null)
    setPinInput('')
    setPinError('')
  }, [])

  const handleLockDashboard = async () => {
    if (!session?.sessionToken) {
      handleUnauthorized()
      return
    }
    try {
      await logoutStaffSession(session.sessionToken, 'reception')
    } finally {
      handleUnauthorized()
    }
  }

  const loadDashboard = useCallback(
    async (isBackground = false) => {
      if (!session?.sessionToken) {
        setLoading(false)
        return
      }
      if (!isBackground) {
        setRefreshing(true)
      }

      try {
        const [dashRes, servicesRes, settingsRes] = await Promise.all([
          fetchReceptionDashboard(session.sessionToken),
          fetchServices(),
          fetchSalonSettings()
        ])

        if (dashRes.unauthorized) {
          handleUnauthorized()
          return
        }

        if (dashRes.success) {
          setBarbers(dashRes.barbers || [])
          setWaitingQueue(dashRes.waitingQueue || [])
          setIsLive(Boolean(dashRes.isLiveSupabase))
          setBannerError('')
        } else if (!isBackground) {
          setBannerError(dashRes.error || 'Failed to load reception dashboard.')
        }

        if (servicesRes.success && Array.isArray(servicesRes.data)) {
          setServices(servicesRes.data)
          setWalkInServices((prev) =>
            prev.length === 0 && servicesRes.data.length > 0 ? [servicesRes.data[0].id] : prev
          )
        }

        if (settingsRes.success) {
          setSettings(settingsRes.data)
        }
      } catch (err) {
        if (!isBackground) {
          setBannerError(err.message || 'Error loading reception dashboard.')
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [session?.sessionToken, handleUnauthorized]
  )

  useEffect(() => {
    if (!session?.sessionToken) {
      setLoading(false)
      return
    }

    setLoading(true)
    loadDashboard(false)

    const unsubscribe = subscribeToSalonUpdates(() => {
      loadDashboard(true)
    })

    const clockTick = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      unsubscribe()
      clearInterval(clockTick)
    }
  }, [session?.sessionToken, loadDashboard])

  const handlePinSubmit = async (e) => {
    e.preventDefault()
    setPinError('')
    setVerifyingPin(true)
    try {
      const res = await verifyStaffPin('reception', pinInput)
      if (!res.success) {
        setPinError(res.error || 'Incorrect PIN')
        return
      }
      setSession({
        sessionToken: res.sessionToken,
        role: res.role,
        expiresAt: res.expiresAt
      })
      setPinInput('')
    } catch (err) {
      setPinError(err.message || 'Verification failed')
    } finally {
      setVerifyingPin(false)
    }
  }

  const handleCallNext = async (barberId) => {
    if (!session?.sessionToken || callingBarberId) return
    setCallingBarberId(barberId)
    setBannerError('')
    setBannerSuccess('')

    try {
      const res = await callNextCustomer(session.sessionToken, barberId)
      if (res.unauthorized) {
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Unable to call next customer.')
      } else {
        setBannerSuccess(`${t('called_toast')}: ${res.tokenNumber} — ${res.customerName} (${res.barberName})`)
      }
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error calling next customer.')
    } finally {
      setCallingBarberId(null)
    }
  }

  const toggleWalkInService = (serviceId) => {
    setWalkInSubmitError('')
    setWalkInErrors((prev) => ({ ...prev, services: null }))
    if (walkInServices.includes(serviceId)) {
      if (walkInServices.length > 1) {
        setWalkInServices(walkInServices.filter((id) => id !== serviceId))
      } else {
        setWalkInErrors((prev) => ({ ...prev, services: t('error_services_empty') }))
      }
    } else if (walkInServices.length < 3) {
      setWalkInServices([...walkInServices, serviceId])
    } else {
      setWalkInErrors((prev) => ({ ...prev, services: t('error_services_max') }))
    }
  }

  const openWalkInModal = () => {
    setWalkInName('')
    setWalkInPhone('')
    setWalkInServices(services.length > 0 ? [services[0].id] : [])
    setWalkInBarberId(null)
    setWalkInErrors({})
    setWalkInSubmitError('')
    setWalkInOpen(true)
  }

  const handleWalkInSubmit = async (e) => {
    e.preventDefault()
    if (!session?.sessionToken || submittingWalkIn) return

    const errors = {}
    const trimmedName = walkInName.trim()
    if (!trimmedName) errors.name = t('error_name_required')

    const cleanPhone = walkInPhone.trim()
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) errors.phone = t('error_mobile_invalid')

    if (walkInServices.length === 0) errors.services = t('error_services_empty')
    else if (walkInServices.length > 3) errors.services = t('error_services_max')

    if (walkInBarberId) {
      const chosen = barbers.find((b) => b.id === walkInBarberId)
      if (chosen && (!chosen.is_on_duty || chosen.status === 'on_break')) {
        errors.barber = t('error_barber_unavailable')
      }
    }

    if (Object.keys(errors).length > 0) {
      setWalkInErrors(errors)
      return
    }

    setSubmittingWalkIn(true)
    setWalkInSubmitError('')

    try {
      const res = await addWalkInCustomer(session.sessionToken, {
        customerName: trimmedName,
        phoneNumber: cleanPhone,
        serviceIds: walkInServices,
        preferredBarberId: walkInBarberId || null
      })

      if (res.unauthorized) {
        setWalkInOpen(false)
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setWalkInSubmitError(res.error || 'Failed to add walk-in customer.')
        return
      }

      setWalkInOpen(false)
      setBannerError('')
      setBannerSuccess(`${t('walkin_added_toast')}: ${res.tokenNumber}`)
      await loadDashboard(true)
    } catch (err) {
      setWalkInSubmitError(err.message || 'Error adding walk-in customer.')
    } finally {
      setSubmittingWalkIn(false)
    }
  }

  const handleConfirmCancel = async () => {
    if (!session?.sessionToken || !cancelTarget || processingAction) return
    setProcessingAction(true)
    setBannerError('')
    setBannerSuccess('')

    try {
      const res = await cancelQueueEntryByReception(session.sessionToken, cancelTarget.id)
      if (res.unauthorized) {
        setCancelTarget(null)
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Unable to cancel queue entry.')
      }
      setCancelTarget(null)
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error cancelling queue entry.')
      setCancelTarget(null)
    } finally {
      setProcessingAction(false)
    }
  }

  const handleConfirmNoShow = async () => {
    if (!session?.sessionToken || !noShowTarget || processingAction) return
    setProcessingAction(true)
    setBannerError('')
    setBannerSuccess('')

    try {
      const res = await markCustomerNoShow(session.sessionToken, noShowTarget.id)
      if (res.unauthorized) {
        setNoShowTarget(null)
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Unable to mark customer as no-show.')
      }
      setNoShowTarget(null)
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error marking no-show.')
      setNoShowTarget(null)
    } finally {
      setProcessingAction(false)
    }
  }

  const getBarberName = (barberId) => {
    if (!barberId) return t('any_barber')
    const found = barbers.find((b) => b.id === barberId)
    return found ? found.name : t('any_barber')
  }

  const formatServicesText = (items) => {
    if (!Array.isArray(items) || items.length === 0) return '—'
    return items
      .map((s) => (language === 'gu' && s.name_gu ? s.name_gu : s.name_en))
      .join(', ')
  }

  const selectedWalkInItems = services.filter((s) => walkInServices.includes(s.id))
  const walkInTotalDuration = selectedWalkInItems.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
  const walkInTotalPrice = selectedWalkInItems.reduce((sum, s) => sum + (Number(s.price) || 0), 0)

  const onlineOpen = settings ? isOnlineQueueOpen(settings) : true

  // PIN Lock Screen
  if (!session?.sessionToken) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="bg-charcoal-900 border border-gold-500/30 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-gold-500/15 border border-gold-500/30 text-gold-400 flex items-center justify-center mx-auto">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-extrabold text-white">{t('reception_pin_title')}</h1>
            <p className="text-xs text-gray-300 leading-relaxed">{t('reception_pin_desc')}</p>
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
                {t('reception_pin_label')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
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
              {verifyingPin ? t('reception_pin_verifying') : t('reception_pin_unlock')}
            </button>
          </form>

          {!isSupabaseConfigured() && (
            <p className="text-[11px] text-center text-gray-400">{t('reception_pin_hint_sandbox')}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Database Connection & Session Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-charcoal-900 border border-charcoal-700/80 rounded-2xl px-4 py-2.5 text-xs text-gray-300 shadow-sm">
        <div className="flex items-center space-x-2">
          <Database className={`w-4 h-4 ${isLive ? 'text-emerald-400' : 'text-gold-400'}`} />
          <span className="font-medium">{isLive ? t('db_live') : t('db_sandbox')}</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadDashboard(false)}
            disabled={refreshing}
            className="flex items-center gap-1 text-gray-300 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t('refresh_label')}</span>
          </button>
          <button
            type="button"
            onClick={handleLockDashboard}
            className="flex items-center gap-1 text-rose-300 hover:text-rose-200 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-lg transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('reception_pin_lock')}</span>
          </button>
        </div>
      </div>

      {/* Header and Add Walk-in Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-charcoal-700 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-gold-500" />
            {t('screen_reception_title')}
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">{t('reception_subtitle')}</p>
        </div>

        <button
          type="button"
          onClick={openWalkInModal}
          className="inline-flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 font-black text-sm shadow-lg transition active:scale-[0.99]"
        >
          <UserPlus className="w-4 h-4" />
          <span>{t('action_add_walkin')}</span>
        </button>
      </div>

      {/* Stage 4 Notice & Online-Closed Walk-in Notice */}
      <div className="space-y-2.5">
        <div className="bg-charcoal-900 border border-gold-500/20 rounded-xl p-3 text-xs text-gray-300 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold-500 flex-shrink-0" />
          <span>{t('stage_notice')}</span>
        </div>

        {!onlineOpen && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{t('online_closed_walkin_ok')}</span>
          </div>
        )}
      </div>

      {/* Action Feedback Banners */}
      {bannerError && (
        <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-4 text-xs text-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{bannerError}</span>
          </div>
          <button type="button" onClick={() => setBannerError('')} className="text-rose-300 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {bannerSuccess && (
        <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-xl p-4 text-xs text-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="font-semibold">{bannerSuccess}</span>
          </div>
          <button type="button" onClick={() => setBannerSuccess('')} className="text-emerald-300 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Barber Stations Grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
          <Scissors className="w-4 h-4 text-gold-500" />
          {t('barber_stations_title')}
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 h-52 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {barbers.map((barber, index) => {
              const badge = getBarberBadge(barber, t)
              const current = barber.current_customer
              const hasEligibleWaiting = waitingQueue.some(
                (q) => q.preferred_barber_id === barber.id || !q.preferred_barber_id
              )
              const canCallNext =
                barber.is_on_duty &&
                barber.status === 'available' &&
                !current &&
                hasEligibleWaiting &&
                callingBarberId !== barber.id

              // Timing metrics for called / in_chair customer
              let calledElapsedMs = 0
              let noShowRemainingMs = TEN_MINUTES_MS
              let canMarkNoShow = false
              let progressPct = 0
              let remainingMinutes = 0

              if (current?.status === 'called' && current.called_at) {
                calledElapsedMs = Math.max(0, nowMs - new Date(current.called_at).getTime())
                noShowRemainingMs = Math.max(0, TEN_MINUTES_MS - calledElapsedMs)
                canMarkNoShow = noShowRemainingMs === 0
              } else if (current?.status === 'in_chair') {
                const startedAt = current.service_started_at
                  ? new Date(current.service_started_at).getTime()
                  : nowMs
                const elapsedMins = Math.max(0, (nowMs - startedAt) / 60000)
                const totalMins = current.total_duration || 1
                progressPct = Math.min(100, Math.round((elapsedMins / totalMins) * 100))
                remainingMinutes = Math.max(0, Math.ceil(totalMins - elapsedMins))
              }

              return (
                <div
                  key={barber.id}
                  className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 space-y-4 shadow-md flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-white">{barber.name}</h3>
                      <p className="text-xs text-gray-400">
                        {t('chair_label')} #{index + 1}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Current Customer Card */}
                  <div className="bg-charcoal-850 border border-charcoal-800 rounded-xl p-3.5 text-xs space-y-2.5">
                    {current ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-black text-gold-400 text-base">
                            {current.token_number}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              current.status === 'in_chair'
                                ? 'bg-gold-500/15 text-gold-300 border border-gold-500/30'
                                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {current.status === 'in_chair' ? t('status_in_chair') : t('called_waiting_arrival')}
                          </span>
                        </div>

                        <div>
                          <p className="font-bold text-white text-sm">{current.customer_name}</p>
                          <p className="text-gray-400 mt-0.5">{formatServicesText(current.selected_services)}</p>
                        </div>

                        {current.status === 'in_chair' ? (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-[11px] text-gray-300">
                              <span>{t('service_progress')}</span>
                              <span className="font-mono text-gold-400 font-semibold">
                                {t('remaining_time')}: ~{remainingMinutes} {t('mins')}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-charcoal-700 overflow-hidden">
                              <div
                                className="h-full bg-gold-500 transition-all duration-500"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="pt-1 flex items-center justify-between gap-2 border-t border-charcoal-800">
                            <span className="text-[11px] text-gray-400 font-mono flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-400" />
                              {t('called_ago')}: {formatMmSs(calledElapsedMs)}
                            </span>
                            <button
                              type="button"
                              disabled={!canMarkNoShow}
                              onClick={() => setNoShowTarget(current)}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                                canMarkNoShow
                                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                                  : 'bg-charcoal-800 text-gray-400 border border-charcoal-700 cursor-not-allowed'
                              }`}
                            >
                              {canMarkNoShow
                                ? t('mark_noshow')
                                : `${t('noshow_wait_remaining')} ${formatMmSs(noShowRemainingMs)}`}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-400 italic py-2">{t('no_active_customer')}</p>
                    )}
                  </div>

                  {/* Call Next Button */}
                  <button
                    type="button"
                    disabled={!canCallNext}
                    onClick={() => handleCallNext(barber.id)}
                    className={`w-full py-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 ${
                      canCallNext
                        ? 'bg-gold-500 hover:bg-gold-600 text-charcoal-950 shadow-md active:scale-[0.99]'
                        : 'bg-charcoal-800 text-gray-400 border border-charcoal-700 cursor-not-allowed'
                    }`}
                  >
                    <span>
                      {callingBarberId === barber.id
                        ? t('calling_next')
                        : barber.is_on_duty && barber.status === 'available' && !hasEligibleWaiting
                        ? t('no_eligible_waiting')
                        : t('action_call_next')}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Ordered Waiting Queue Section */}
      <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 space-y-4 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-gold-500" />
            {t('live_waiting_queue')} ({waitingQueue.length})
          </h2>
          <span className="text-xs text-gray-400">{t('ordered_by_arrival')}</span>
        </div>

        {waitingQueue.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 italic">
            {t('no_customers_waiting')}
          </div>
        ) : (
          <>
            {/* Tablet / Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-charcoal-700 text-gray-400 uppercase tracking-wider font-semibold">
                    <th className="pb-3 pl-2">{t('col_token')}</th>
                    <th className="pb-3">{t('col_customer')}</th>
                    <th className="pb-3">{t('col_mobile')}</th>
                    <th className="pb-3">{t('col_services')}</th>
                    <th className="pb-3">{t('col_preferred_barber')}</th>
                    <th className="pb-3">{t('col_wait_time')}</th>
                    <th className="pb-3 pr-2 text-right">{t('col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-800">
                  {waitingQueue.map((entry) => {
                    const waitMinutes = Math.max(
                      0,
                      Math.floor((nowMs - new Date(entry.created_at).getTime()) / 60000)
                    )
                    const isOver60 = waitMinutes > 60

                    return (
                      <tr
                        key={entry.id}
                        className={`transition ${
                          isOver60 ? 'bg-rose-500/10 hover:bg-rose-500/15' : 'hover:bg-charcoal-850/60'
                        }`}
                      >
                        <td className="py-3.5 pl-2 font-mono font-bold text-gold-400 text-sm">
                          {entry.token_number}
                        </td>
                        <td className="py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{entry.customer_name}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                                entry.is_walk_in
                                  ? 'bg-gold-500/15 text-gold-300 border border-gold-500/30'
                                  : 'bg-charcoal-800 text-gray-300 border border-charcoal-700'
                              }`}
                            >
                              {entry.is_walk_in ? t('walkin_badge') : t('online_badge')}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 font-mono text-gray-300">{entry.phone_number}</td>
                        <td className="py-3.5 text-gray-300">{formatServicesText(entry.selected_services)}</td>
                        <td className="py-3.5 text-gray-300">{getBarberName(entry.preferred_barber_id)}</td>
                        <td className="py-3.5">
                          {isOver60 ? (
                            <span className="inline-flex items-center gap-1 text-rose-300 font-bold bg-rose-500/15 border border-rose-500/40 px-2 py-0.5 rounded-md">
                              <AlertTriangle className="w-3 h-3 text-rose-400" />
                              {waitMinutes}m ({t('over_60_alert')})
                            </span>
                          ) : (
                            <span className="text-gray-300 font-mono">{waitMinutes}m</span>
                          )}
                        </td>
                        <td className="py-3.5 pr-2 text-right">
                          <button
                            type="button"
                            onClick={() => setCancelTarget(entry)}
                            className="px-3 py-1.5 rounded-lg bg-charcoal-800 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold transition"
                          >
                            {t('action_cancel')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {waitingQueue.map((entry) => {
                const waitMinutes = Math.max(
                  0,
                  Math.floor((nowMs - new Date(entry.created_at).getTime()) / 60000)
                )
                const isOver60 = waitMinutes > 60

                return (
                  <div
                    key={entry.id}
                    className={`rounded-2xl p-4 border space-y-2.5 ${
                      isOver60
                        ? 'bg-rose-500/10 border-rose-500/40'
                        : 'bg-charcoal-850 border-charcoal-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-gold-400 text-base">
                          {entry.token_number}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            entry.is_walk_in
                              ? 'bg-gold-500/15 text-gold-300 border border-gold-500/30'
                              : 'bg-charcoal-800 text-gray-300 border border-charcoal-700'
                          }`}
                        >
                          {entry.is_walk_in ? t('walkin_badge') : t('online_badge')}
                        </span>
                      </div>
                      {isOver60 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-300 font-bold bg-rose-500/15 border border-rose-500/40 px-2 py-0.5 rounded-md">
                          <AlertTriangle className="w-3 h-3" />
                          {waitMinutes}m ({t('over_60_alert')})
                        </span>
                      ) : (
                        <span className="text-xs font-mono text-gray-300">{waitMinutes}m</span>
                      )}
                    </div>

                    <div>
                      <p className="text-sm font-bold text-white">{entry.customer_name}</p>
                      <p className="text-xs font-mono text-gray-400">{entry.phone_number}</p>
                      <p className="text-xs text-gray-300 mt-1">{formatServicesText(entry.selected_services)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t('preferred_barber')}: <span className="text-gray-200">{getBarberName(entry.preferred_barber_id)}</span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setCancelTarget(entry)}
                      className="w-full py-2.5 rounded-xl bg-charcoal-800 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold transition"
                    >
                      {t('action_cancel')}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Add Walk-in Modal */}
      {walkInOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl my-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-white">{t('walkin_modal_title')}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{t('walkin_modal_desc')}</p>
              </div>
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                className="p-2 rounded-xl bg-charcoal-800 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {walkInSubmitError && (
              <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{walkInSubmitError}</span>
              </div>
            )}

            <form onSubmit={handleWalkInSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-gold-500" />
                  {t('field_name')}
                </label>
                <input
                  type="text"
                  value={walkInName}
                  onChange={(e) => {
                    setWalkInName(e.target.value)
                    if (walkInErrors.name) setWalkInErrors((p) => ({ ...p, name: null }))
                  }}
                  placeholder={t('field_name_placeholder')}
                  className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
                />
                {walkInErrors.name && <p className="text-xs text-rose-400">{walkInErrors.name}</p>}
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-gold-500" />
                  {t('field_mobile')}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-xs text-gray-400 font-bold font-mono">+91</span>
                  <input
                    type="tel"
                    maxLength={10}
                    value={walkInPhone}
                    onChange={(e) => {
                      setWalkInPhone(e.target.value.replace(/\D/g, ''))
                      if (walkInErrors.phone) setWalkInErrors((p) => ({ ...p, phone: null }))
                    }}
                    placeholder={t('field_mobile_placeholder')}
                    className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl pl-12 pr-4 py-3 text-sm font-mono text-white focus:outline-none"
                  />
                </div>
                {walkInErrors.phone && <p className="text-xs text-rose-400">{walkInErrors.phone}</p>}
              </div>

              {/* Services */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5 text-gold-500" />
                    {t('field_services')}
                  </label>
                  <span className="text-xs text-gold-400 font-medium">
                    {walkInServices.length}/3 {t('selected_count')}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                  {services.map((service) => {
                    const selected = walkInServices.includes(service.id)
                    const label = language === 'gu' && service.name_gu ? service.name_gu : service.name_en
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => toggleWalkInService(service.id)}
                        className={`text-left rounded-xl p-3 border transition flex items-start justify-between gap-2 ${
                          selected
                            ? 'bg-gold-500/15 border-gold-500 text-white'
                            : 'bg-charcoal-850 border-charcoal-700 text-gray-300'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-semibold">{label}</p>
                          <p className="text-[11px] text-gray-400">
                            {service.duration_minutes} {t('mins')} &bull; ₹{service.price}
                          </p>
                        </div>
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 mt-0.5 ${
                            selected ? 'bg-gold-500 border-gold-500 text-charcoal-950' : 'border-charcoal-600'
                          }`}
                        >
                          {selected && <Check className="w-3 h-3 stroke-[3]" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {walkInErrors.services && <p className="text-xs text-rose-400">{walkInErrors.services}</p>}
              </div>

              {/* Preferred Barber */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  {t('field_barber')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWalkInBarberId(null)}
                    className={`rounded-xl p-2.5 border text-left text-xs font-semibold transition ${
                      walkInBarberId === null
                        ? 'bg-gold-500/15 border-gold-500 text-gold-300'
                        : 'bg-charcoal-850 border-charcoal-700 text-gray-300'
                    }`}
                  >
                    {t('any_barber')}
                  </button>
                  {barbers.map((barber) => {
                    const unavailable = !barber.is_on_duty || barber.status === 'on_break'
                    const selected = walkInBarberId === barber.id
                    return (
                      <button
                        key={barber.id}
                        type="button"
                        disabled={unavailable}
                        onClick={() => setWalkInBarberId(barber.id)}
                        className={`rounded-xl p-2.5 border text-left text-xs font-semibold transition ${
                          unavailable
                            ? 'bg-charcoal-800/40 border-charcoal-800 text-gray-500 cursor-not-allowed'
                            : selected
                            ? 'bg-gold-500/15 border-gold-500 text-white'
                            : 'bg-charcoal-850 border-charcoal-700 text-gray-300'
                        }`}
                      >
                        {barber.name} {unavailable ? `(${t('on_break')})` : ''}
                      </button>
                    )
                  })}
                </div>
                {walkInErrors.barber && <p className="text-xs text-rose-400">{walkInErrors.barber}</p>}
              </div>

              {/* Summary */}
              <div className="bg-charcoal-850 border border-charcoal-700 rounded-xl p-3 flex items-center justify-between text-xs">
                <span className="text-gray-300">
                  {t('total_duration')}: <strong className="text-white">{walkInTotalDuration} {t('mins')}</strong>
                </span>
                <span className="text-gray-300">
                  {t('total_price')}: <strong className="text-gold-400 font-mono text-sm">₹{walkInTotalPrice}</strong>
                </span>
              </div>

              <button
                type="submit"
                disabled={submittingWalkIn}
                className="w-full py-3.5 rounded-xl bg-gold-500 hover:bg-gold-600 disabled:bg-charcoal-700 disabled:text-gray-400 text-charcoal-950 font-black text-sm transition"
              >
                {submittingWalkIn ? t('walkin_adding') : t('walkin_submit')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Waiting Entry Confirmation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">{t('modal_reception_cancel_title')}</h3>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {t('modal_reception_cancel_desc')} ({cancelTarget.token_number} — {cancelTarget.customer_name})
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2.5">
              <button
                type="button"
                disabled={processingAction}
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-3 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-600 text-sm font-semibold"
              >
                {t('modal_keep_entry')}
              </button>
              <button
                type="button"
                disabled={processingAction}
                onClick={handleConfirmCancel}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold"
              >
                {t('modal_reception_cancel_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm No-Show Modal */}
      {noShowTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">{t('modal_noshow_title')}</h3>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {t('modal_noshow_desc')} ({noShowTarget.token_number} — {noShowTarget.customer_name})
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2.5">
              <button
                type="button"
                disabled={processingAction}
                onClick={() => setNoShowTarget(null)}
                className="flex-1 py-3 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-600 text-sm font-semibold"
              >
                {t('modal_keep_entry')}
              </button>
              <button
                type="button"
                disabled={processingAction}
                onClick={handleConfirmNoShow}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-charcoal-950 text-sm font-black"
              >
                {t('modal_noshow_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
