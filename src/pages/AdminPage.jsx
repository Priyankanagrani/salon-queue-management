import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck,
  Settings,
  Scissors,
  Clock,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  Plus,
  Lock,
  LogOut,
  Database,
  RefreshCw,
  Edit3,
  KeyRound,
  Users,
  CheckCircle2,
  AlertCircle,
  X,
  IndianRupee
} from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  getStaffSession,
  clearStaffSession,
  verifyStaffPin,
  logoutStaffSession,
  fetchAdminDashboard,
  upsertServiceByAdmin,
  toggleServiceStatusByAdmin,
  updateBarberByAdmin,
  updateSalonSettingsByAdmin,
  setBarberPinByAdmin,
  isOnlineQueueOpen,
  subscribeToSalonUpdates
} from '../services/supabaseService'

function toTimeInputValue(timeStr) {
  if (!timeStr) return '09:00'
  return String(timeStr).slice(0, 5)
}

export default function AdminPage() {
  const { t } = useLanguage()

  // Admin Session & PIN Gate
  const [session, setSession] = useState(() => getStaffSession('admin'))
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [verifyingPin, setVerifyingPin] = useState(false)

  // Dashboard Data
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [isLive, setIsLive] = useState(isSupabaseConfigured())
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [stats, setStats] = useState({
    total_today: 0,
    waiting_count: 0,
    called_count: 0,
    in_chair_count: 0,
    completed_today: 0,
    cancelled_today: 0,
    no_show_today: 0,
    walk_in_today: 0,
    online_today: 0,
    estimated_revenue_today: 0,
    avg_wait_minutes_today: 0,
    salon_date_ist: ''
  })

  // Salon Settings Form
  const [settingsForm, setSettingsForm] = useState({
    salonNameEn: 'Royal Crown Salon',
    salonNameGu: 'રોયલ ક્રાઉન સલૂન',
    isOnlineQueueOpen: true,
    openingTime: '09:00',
    closingTime: '21:00',
    autoCloseBufferMinutes: 30
  })
  const [savingSettings, setSavingSettings] = useState(false)

  // Feedback Banners
  const [bannerError, setBannerError] = useState('')
  const [bannerSuccess, setBannerSuccess] = useState('')
  const [busyId, setBusyId] = useState(null)

  // Service Modal State
  const [serviceModalOpen, setServiceModalOpen] = useState(false)
  const [serviceForm, setServiceForm] = useState({
    id: null,
    nameEn: '',
    nameGu: '',
    durationMinutes: 30,
    price: 250,
    isActive: true
  })
  const [serviceFormError, setServiceFormError] = useState('')
  const [savingService, setSavingService] = useState(false)

  // Barber PIN Modal State
  const [pinModalBarber, setPinModalBarber] = useState(null)
  const [barberPinValue, setBarberPinValue] = useState('')
  const [barberPinError, setBarberPinError] = useState('')
  const [savingBarberPin, setSavingBarberPin] = useState(false)

  const handleUnauthorized = useCallback(() => {
    clearStaffSession('admin')
    setSession(null)
    setPinInput('')
    setPinError('')
  }, [])

  const applyDashboardPayload = useCallback((res) => {
    if (res.settings) {
      setSettingsForm({
        salonNameEn: res.settings.salon_name_en || '',
        salonNameGu: res.settings.salon_name_gu || '',
        isOnlineQueueOpen: Boolean(res.settings.is_online_queue_open),
        openingTime: toTimeInputValue(res.settings.opening_time || '09:00'),
        closingTime: toTimeInputValue(res.settings.closing_time || '21:00'),
        autoCloseBufferMinutes:
          typeof res.settings.auto_close_buffer_minutes === 'number'
            ? res.settings.auto_close_buffer_minutes
            : 30
      })
    }
    setServices(res.services || [])
    setBarbers(res.barbers || [])
    setStats(res.stats || {})
    setIsLive(Boolean(res.isLiveSupabase))
  }, [])

  const loadDashboard = useCallback(
    async (isBackground = false) => {
      if (!session?.sessionToken) {
        setLoading(false)
        return
      }
      if (!isBackground) setRefreshing(true)

      try {
        const res = await fetchAdminDashboard(session.sessionToken)
        if (res.unauthorized) {
          handleUnauthorized()
          return
        }
        if (!res.success) {
          if (!isBackground) setBannerError(res.error || 'Failed to load admin dashboard.')
          return
        }
        applyDashboardPayload(res)
        if (!isBackground) setBannerError('')
      } catch (err) {
        if (!isBackground) setBannerError(err.message || 'Error loading admin dashboard.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [session?.sessionToken, handleUnauthorized, applyDashboardPayload]
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

    return () => {
      unsubscribe()
    }
  }, [session?.sessionToken, loadDashboard])

  const handlePinSubmit = async (e) => {
    e.preventDefault()
    setPinError('')
    setVerifyingPin(true)
    try {
      const res = await verifyStaffPin('admin', pinInput)
      if (!res.success) {
        setPinError(res.error || 'Incorrect PIN')
        return
      }
      setSession({
        sessionToken: res.sessionToken,
        role: 'admin',
        expiresAt: res.expiresAt
      })
      setPinInput('')
    } catch (err) {
      setPinError(err.message || 'Verification failed')
    } finally {
      setVerifyingPin(false)
    }
  }

  const handleLockAdmin = async () => {
    if (!session?.sessionToken) {
      handleUnauthorized()
      return
    }
    try {
      await logoutStaffSession(session.sessionToken, 'admin')
    } finally {
      handleUnauthorized()
    }
  }

  const handleSaveSettings = async (e) => {
    e.preventDefault()
    if (!session?.sessionToken || savingSettings) return
    setBannerError('')
    setBannerSuccess('')

    if (!settingsForm.salonNameEn.trim() || !settingsForm.salonNameGu.trim()) {
      setBannerError(t('admin_err_names_required'))
      return
    }
    if (settingsForm.openingTime >= settingsForm.closingTime) {
      setBannerError(t('admin_err_hours_order'))
      return
    }

    setSavingSettings(true)
    try {
      const res = await updateSalonSettingsByAdmin(session.sessionToken, settingsForm)
      if (res.unauthorized) {
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Failed to save salon settings.')
        return
      }
      setBannerSuccess(t('admin_settings_saved'))
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error saving salon settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  const openAddServiceModal = () => {
    setServiceForm({
      id: null,
      nameEn: '',
      nameGu: '',
      durationMinutes: 30,
      price: 250,
      isActive: true
    })
    setServiceFormError('')
    setServiceModalOpen(true)
  }

  const openEditServiceModal = (svc) => {
    setServiceForm({
      id: svc.id,
      nameEn: svc.name_en,
      nameGu: svc.name_gu,
      durationMinutes: svc.duration_minutes,
      price: svc.price,
      isActive: svc.is_active
    })
    setServiceFormError('')
    setServiceModalOpen(true)
  }

  const handleSaveService = async (e) => {
    e.preventDefault()
    if (!session?.sessionToken || savingService) return
    setServiceFormError('')

    const dur = Number(serviceForm.durationMinutes)
    const pr = Number(serviceForm.price)
    if (!serviceForm.nameEn.trim() || !serviceForm.nameGu.trim()) {
      setServiceFormError(t('admin_err_service_names'))
      return
    }
    if (!Number.isInteger(dur) || dur <= 0 || dur > 480) {
      setServiceFormError(t('admin_err_service_duration'))
      return
    }
    if (Number.isNaN(pr) || pr < 0 || pr > 100000) {
      setServiceFormError(t('admin_err_service_price'))
      return
    }

    setSavingService(true)
    try {
      const res = await upsertServiceByAdmin(session.sessionToken, {
        id: serviceForm.id,
        nameEn: serviceForm.nameEn,
        nameGu: serviceForm.nameGu,
        durationMinutes: dur,
        price: pr,
        isActive: serviceForm.isActive
      })
      if (res.unauthorized) {
        setServiceModalOpen(false)
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setServiceFormError(res.error || 'Failed to save service.')
        return
      }
      setServiceModalOpen(false)
      setBannerError('')
      setBannerSuccess(t('admin_service_saved'))
      await loadDashboard(true)
    } catch (err) {
      setServiceFormError(err.message || 'Error saving service.')
    } finally {
      setSavingService(false)
    }
  }

  const handleToggleServiceActive = async (svc) => {
    if (!session?.sessionToken || busyId) return
    setBusyId(svc.id)
    setBannerError('')
    setBannerSuccess('')
    try {
      const res = await toggleServiceStatusByAdmin(session.sessionToken, svc.id, !svc.is_active)
      if (res.unauthorized) {
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Unable to update service status.')
      }
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error updating service status.')
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleBarberDuty = async (barber) => {
    if (!session?.sessionToken || busyId) return
    setBusyId(barber.id)
    setBannerError('')
    setBannerSuccess('')

    const isServing = barber.status === 'serving' || Boolean(barber.current_queue_id)
    const nextDuty = !barber.is_on_duty
    const nextStatus = isServing ? 'serving' : barber.status

    try {
      const res = await updateBarberByAdmin(session.sessionToken, barber.id, {
        isOnDuty: nextDuty,
        status: nextStatus
      })
      if (res.unauthorized) {
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Unable to update barber duty.')
      }
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error updating barber duty.')
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleBarberAvailability = async (barber) => {
    if (!session?.sessionToken || busyId) return
    const isServing = barber.status === 'serving' || Boolean(barber.current_queue_id)
    if (isServing) {
      setBannerError(t('admin_serving_availability_locked'))
      return
    }

    setBusyId(barber.id)
    setBannerError('')
    setBannerSuccess('')
    const nextStatus = barber.status === 'on_break' ? 'available' : 'on_break'

    try {
      const res = await updateBarberByAdmin(session.sessionToken, barber.id, {
        isOnDuty: barber.is_on_duty,
        status: nextStatus
      })
      if (res.unauthorized) {
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBannerError(res.error || 'Unable to update barber availability.')
      }
      await loadDashboard(true)
    } catch (err) {
      setBannerError(err.message || 'Error updating barber availability.')
    } finally {
      setBusyId(null)
    }
  }

  const handleSaveBarberPin = async (e) => {
    e.preventDefault()
    if (!session?.sessionToken || !pinModalBarber || savingBarberPin) return
    setBarberPinError('')

    const cleanPin = barberPinValue.trim()
    if (!/^[0-9]{4,6}$/.test(cleanPin)) {
      setBarberPinError(t('admin_err_barber_pin'))
      return
    }

    setSavingBarberPin(true)
    try {
      const res = await setBarberPinByAdmin(session.sessionToken, pinModalBarber.id, cleanPin)
      if (res.unauthorized) {
        setPinModalBarber(null)
        handleUnauthorized()
        return
      }
      if (!res.success) {
        setBarberPinError(res.error || 'Failed to update barber PIN.')
        return
      }
      setPinModalBarber(null)
      setBarberPinValue('')
      setBannerError('')
      setBannerSuccess(`${t('admin_pin_updated')} (${pinModalBarber.name})`)
      await loadDashboard(true)
    } catch (err) {
      setBarberPinError(err.message || 'Error updating barber PIN.')
    } finally {
      setSavingBarberPin(false)
    }
  }

  const effectiveOnlineOpen = isOnlineQueueOpen({
    is_online_queue_open: settingsForm.isOnlineQueueOpen,
    opening_time: `${settingsForm.openingTime}:00`,
    closing_time: `${settingsForm.closingTime}:00`,
    auto_close_buffer_minutes: settingsForm.autoCloseBufferMinutes
  })

  // Admin PIN Gate
  if (!session?.sessionToken) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="bg-charcoal-900 border border-gold-500/30 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-gold-500/15 border border-gold-500/30 text-gold-400 flex items-center justify-center mx-auto">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-extrabold text-white">{t('admin_pin_title')}</h1>
            <p className="text-xs text-gray-300 leading-relaxed">{t('admin_pin_desc')}</p>
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
                {t('admin_pin_label')}
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
              {verifyingPin ? t('reception_pin_verifying') : t('admin_pin_unlock')}
            </button>
          </form>

          {!isSupabaseConfigured() && (
            <p className="text-[11px] text-center text-gray-400">{t('admin_pin_hint_sandbox')}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Database Connection & Lock Controls */}
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
            onClick={handleLockAdmin}
            className="flex items-center gap-1 text-rose-300 hover:text-rose-200 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-lg transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('admin_lock')}</span>
          </button>
        </div>
      </div>

      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-charcoal-700 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-gold-500" />
            {t('screen_admin_title')}
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">{t('admin_subtitle')}</p>
        </div>
      </div>

      {/* Stage 6 Notice */}
      <div className="bg-charcoal-900 border border-gold-500/20 rounded-xl p-3 text-xs text-gray-300 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-gold-500 flex-shrink-0" />
        <span>{t('stage_notice')}</span>
      </div>

      {/* Feedback Banners */}
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

      {/* 1. Today's Dashboard Statistics (IST) */}
      <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-gold-500" />
            {t('admin_stats_title')}
          </h2>
          {stats.salon_date_ist && (
            <span className="text-[11px] font-mono text-gray-400 bg-charcoal-800 px-2.5 py-1 rounded-lg border border-charcoal-700">
              {stats.salon_date_ist}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="bg-charcoal-850 border border-charcoal-700/80 rounded-xl p-4">
            <p className="text-[11px] text-gray-400 uppercase font-semibold">{t('stat_total_today')}</p>
            <p className="text-2xl font-black text-white mt-1 font-mono">{loading ? '—' : stats.total_today ?? 0}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {t('stat_walkin_online')}: {stats.walk_in_today ?? 0} / {stats.online_today ?? 0}
            </p>
          </div>

          <div className="bg-charcoal-850 border border-charcoal-700/80 rounded-xl p-4">
            <p className="text-[11px] text-gray-400 uppercase font-semibold">{t('stat_completed_today')}</p>
            <p className="text-2xl font-black text-emerald-400 mt-1 font-mono">{loading ? '—' : stats.completed_today ?? 0}</p>
            <p className="text-[11px] text-gold-400 mt-1 flex items-center gap-0.5 font-mono">
              <IndianRupee className="w-3 h-3" />
              {stats.estimated_revenue_today ?? 0} {t('stat_revenue_today')}
            </p>
          </div>

          <div className="bg-charcoal-850 border border-charcoal-700/80 rounded-xl p-4">
            <p className="text-[11px] text-gray-400 uppercase font-semibold">{t('stat_waiting_now')}</p>
            <p className="text-2xl font-black text-gold-400 mt-1 font-mono">{loading ? '—' : stats.waiting_count ?? 0}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {t('stat_avg_wait')}: {stats.avg_wait_minutes_today ?? 0} {t('mins')}
            </p>
          </div>

          <div className="bg-charcoal-850 border border-charcoal-700/80 rounded-xl p-4">
            <p className="text-[11px] text-gray-400 uppercase font-semibold">{t('stat_cancelled_today')}</p>
            <p className="text-2xl font-black text-rose-400 mt-1 font-mono">{loading ? '—' : stats.cancelled_today ?? 0}</p>
            <p className="text-[11px] text-amber-400 mt-1">
              {t('stat_noshow_today')}: {stats.no_show_today ?? 0}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Salon & Online Queue Settings */}
      <form onSubmit={handleSaveSettings} className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 shadow-md space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
            <Settings className="w-4 h-4 text-gold-500" />
            {t('admin_salon_settings_title')}
          </h2>
          <span
            className={`text-xs font-bold px-3 py-1 rounded-full border ${
              effectiveOnlineOpen
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
          >
            {effectiveOnlineOpen ? t('status_open') : t('status_closed')}
          </span>
        </div>

        {/* Manual Online Queue Open/Closed Toggle */}
        <div className="bg-charcoal-850 border border-charcoal-700/80 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">{t('admin_online_queue_label')}</p>
            <p className="text-sm font-bold text-white">
              {settingsForm.isOnlineQueueOpen ? t('admin_online_accepting') : t('admin_online_paused')}
            </p>
            <p className="text-[11px] text-gray-400">{t('admin_walkin_preserved_note')}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettingsForm((prev) => ({ ...prev, isOnlineQueueOpen: !prev.isOnlineQueueOpen }))
            }
            className="text-gold-500 hover:text-gold-400 transition flex-shrink-0"
            aria-label={t('admin_online_queue_label')}
          >
            {settingsForm.isOnlineQueueOpen ? (
              <ToggleRight className="w-10 h-10 fill-gold-500" />
            ) : (
              <ToggleLeft className="w-10 h-10 text-gray-500" />
            )}
          </button>
        </div>

        {/* Salon Names & Operating Hours */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              {t('admin_salon_name_en')}
            </label>
            <input
              type="text"
              value={settingsForm.salonNameEn}
              onChange={(e) => setSettingsForm((p) => ({ ...p, salonNameEn: e.target.value }))}
              className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              {t('admin_salon_name_gu')}
            </label>
            <input
              type="text"
              value={settingsForm.salonNameGu}
              onChange={(e) => setSettingsForm((p) => ({ ...p, salonNameGu: e.target.value }))}
              className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-gold-500" />
              {t('admin_opening_time')}
            </label>
            <input
              type="time"
              value={settingsForm.openingTime}
              onChange={(e) => setSettingsForm((p) => ({ ...p, openingTime: e.target.value }))}
              className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-gold-500" />
              {t('admin_closing_time')}
            </label>
            <input
              type="time"
              value={settingsForm.closingTime}
              onChange={(e) => setSettingsForm((p) => ({ ...p, closingTime: e.target.value }))}
              className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              {t('admin_auto_close_buffer')}
            </label>
            <input
              type="number"
              min={0}
              max={180}
              value={settingsForm.autoCloseBufferMinutes}
              onChange={(e) =>
                setSettingsForm((p) => ({ ...p, autoCloseBufferMinutes: Number(e.target.value) }))
              }
              className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
          <p className="text-[11px] text-gray-400">{t('admin_auto_close_rule_note')}</p>
          <button
            type="submit"
            disabled={savingSettings}
            className="px-6 py-3 rounded-xl bg-gold-500 hover:bg-gold-600 disabled:bg-charcoal-700 disabled:text-gray-400 text-charcoal-950 font-black text-sm shadow-lg transition"
          >
            {savingSettings ? '...' : t('action_save')}
          </button>
        </div>
      </form>

      {/* 3. Services Management (EN / GU CRUD & Enable/Disable) */}
      <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
            <Scissors className="w-4 h-4 text-gold-500" />
            {t('admin_services_title')}
          </h2>
          <button
            type="button"
            onClick={openAddServiceModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 text-xs font-black shadow transition"
          >
            <Plus className="w-4 h-4" />
            <span>{t('admin_add_service')}</span>
          </button>
        </div>

        {services.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-4">{t('admin_no_services')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {services.map((svc) => (
              <div
                key={svc.id}
                className={`border rounded-xl p-4 flex flex-col justify-between gap-3 transition ${
                  svc.is_active
                    ? 'bg-charcoal-850 border-charcoal-700/80'
                    : 'bg-charcoal-900/60 border-charcoal-800 opacity-75'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{svc.name_en}</p>
                    <p className="text-xs text-gold-400">{svc.name_gu}</p>
                    <p className="text-xs text-gray-400 mt-1 font-mono">
                      {svc.duration_minutes} {t('mins')} &bull; ₹{svc.price}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${
                      svc.is_active
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-charcoal-800 text-gray-400 border-charcoal-700'
                    }`}
                  >
                    {svc.is_active ? t('admin_service_active') : t('admin_service_inactive')}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-charcoal-800">
                  <button
                    type="button"
                    onClick={() => openEditServiceModal(svc)}
                    className="flex-1 py-2 px-3 rounded-lg bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{t('admin_edit_service')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === svc.id}
                    onClick={() => handleToggleServiceActive(svc)}
                    className={`flex-1 py-2 px-3 rounded-lg border text-xs font-bold transition disabled:opacity-50 ${
                      svc.is_active
                        ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    {svc.is_active ? t('admin_deactivate') : t('admin_activate')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Barber Roster, Duty vs. Availability & PIN Provisioning */}
      <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 shadow-md space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
          <Users className="w-4 h-4 text-gold-500" />
          {t('admin_barbers_title')}
        </h2>

        {barbers.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-4">{t('admin_no_barbers')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {barbers.map((barber) => {
              const isServing = barber.status === 'serving' || Boolean(barber.current_queue_id)

              return (
                <div
                  key={barber.id}
                  className="bg-charcoal-850 border border-charcoal-700/80 rounded-2xl p-4 space-y-3.5 flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-bold text-white">{barber.name}</p>
                      <p className="text-[11px] mt-0.5 flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold border ${
                            barber.has_pin
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {barber.has_pin ? t('admin_pin_configured') : t('admin_pin_not_configured')}
                        </span>
                      </p>
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase ${
                        !barber.is_on_duty
                          ? 'bg-charcoal-800 text-gray-400 border-charcoal-700'
                          : isServing
                          ? 'bg-gold-500/15 text-gold-300 border-gold-500/30'
                          : barber.status === 'available'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {isServing
                        ? t('serving')
                        : !barber.is_on_duty
                        ? t('off_duty')
                        : barber.status === 'available'
                        ? t('available')
                        : t('on_break')}
                    </span>
                  </div>

                  {isServing && (
                    <p className="text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                      {!barber.is_on_duty
                        ? t('admin_serving_off_duty_note')
                        : t('admin_serving_availability_locked')}
                    </p>
                  )}

                  <div className="space-y-2 pt-1">
                    {/* Duty Toggle (Allowed even while serving — preserves serving status) */}
                    <button
                      type="button"
                      disabled={busyId === barber.id}
                      onClick={() => handleToggleBarberDuty(barber)}
                      className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold transition disabled:opacity-50 ${
                        barber.is_on_duty
                          ? 'bg-charcoal-800 hover:bg-rose-500/15 text-gray-200 border-charcoal-600'
                          : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40'
                      }`}
                    >
                      {barber.is_on_duty ? t('admin_set_off_duty') : t('admin_set_on_duty')}
                    </button>

                    {/* Availability Toggle (Disabled while serving an active customer) */}
                    <button
                      type="button"
                      disabled={busyId === barber.id || isServing}
                      onClick={() => handleToggleBarberAvailability(barber)}
                      className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        barber.status === 'on_break'
                          ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {barber.status === 'on_break' ? t('action_available') : t('action_on_break')}
                    </button>

                    {/* Secure Barber PIN Provisioning */}
                    <button
                      type="button"
                      onClick={() => {
                        setPinModalBarber(barber)
                        setBarberPinValue('')
                        setBarberPinError('')
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-gold-500/10 hover:bg-gold-500/20 text-gold-300 border border-gold-500/30 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>{t('admin_set_pin_btn')}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Service Modal */}
      {serviceModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-white">
                {serviceForm.id ? t('admin_edit_service') : t('admin_add_service')}
              </h3>
              <button
                type="button"
                onClick={() => setServiceModalOpen(false)}
                className="p-2 rounded-xl bg-charcoal-800 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {serviceFormError && (
              <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{serviceFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveService} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300 uppercase">
                  {t('admin_service_name_en')}
                </label>
                <input
                  type="text"
                  value={serviceForm.nameEn}
                  onChange={(e) => setServiceForm((p) => ({ ...p, nameEn: e.target.value }))}
                  className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300 uppercase">
                  {t('admin_service_name_gu')}
                </label>
                <input
                  type="text"
                  value={serviceForm.nameGu}
                  onChange={(e) => setServiceForm((p) => ({ ...p, nameGu: e.target.value }))}
                  className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300 uppercase">
                    {t('admin_service_duration')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={serviceForm.durationMinutes}
                    onChange={(e) =>
                      setServiceForm((p) => ({ ...p, durationMinutes: e.target.value }))
                    }
                    className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300 uppercase">
                    {t('admin_service_price')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step="1"
                    value={serviceForm.price}
                    onChange={(e) => setServiceForm((p) => ({ ...p, price: e.target.value }))}
                    className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between bg-charcoal-850 border border-charcoal-700 rounded-xl px-4 py-3 text-xs font-semibold text-gray-200 cursor-pointer">
                <span>{t('admin_service_active')}</span>
                <input
                  type="checkbox"
                  checked={serviceForm.isActive}
                  onChange={(e) => setServiceForm((p) => ({ ...p, isActive: e.target.checked }))}
                  className="w-4 h-4 accent-gold-500"
                />
              </label>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setServiceModalOpen(false)}
                  className="flex-1 py-3 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-600 text-sm font-semibold"
                >
                  {t('admin_cancel_modal')}
                </button>
                <button
                  type="submit"
                  disabled={savingService}
                  className="flex-1 py-3 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 text-sm font-black disabled:opacity-50"
                >
                  {savingService ? '...' : t('action_save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set / Change Barber PIN Modal */}
      {pinModalBarber && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-white">
                {t('admin_set_pin_title')}: <span className="text-gold-400">{pinModalBarber.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPinModalBarber(null)}
                className="p-2 rounded-xl bg-charcoal-800 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">{t('admin_set_pin_desc')}</p>

            {barberPinError && (
              <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{barberPinError}</span>
              </div>
            )}

            <form onSubmit={handleSaveBarberPin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-300 uppercase">
                  {t('admin_new_pin_label')}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={barberPinValue}
                  onChange={(e) => setBarberPinValue(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full bg-charcoal-800 border border-charcoal-700 focus:border-gold-500 rounded-xl px-4 py-3 text-center text-xl tracking-[0.4em] font-mono text-white focus:outline-none"
                  autoFocus
                />
              </div>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setPinModalBarber(null)}
                  className="flex-1 py-3 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-600 text-sm font-semibold"
                >
                  {t('admin_cancel_modal')}
                </button>
                <button
                  type="submit"
                  disabled={savingBarberPin}
                  className="flex-1 py-3 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 text-sm font-black disabled:opacity-50"
                >
                  {savingBarberPin ? '...' : t('admin_save_pin')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
