import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, User, Phone, Scissors, Check, Clock, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import {
  fetchServices,
  fetchBarbers,
  fetchSalonSettings,
  isOnlineQueueOpen,
  joinQueue,
  subscribeToSalonUpdates
} from '../services/supabaseService'
import DevTestingControl from '../components/common/DevTestingControl'

export default function JoinQueuePage() {
  const { t, language } = useLanguage()
  const navigate = useNavigate()

  // Data states
  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [settings, setSettings] = useState(null)

  // Form states (preserved across live background refreshes)
  const [customerName, setCustomerName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [selectedServices, setSelectedServices] = useState([])
  const [selectedBarberId, setSelectedBarberId] = useState(null) // null = Any Barber

  // Submission & Validation states
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [successData, setSuccessData] = useState(null)
  const hasInitializedRef = useRef(false)

  const loadCatalog = useCallback(async () => {
    try {
      const [servicesRes, barbersRes, settingsRes] = await Promise.all([
        fetchServices(),
        fetchBarbers(),
        fetchSalonSettings()
      ])

      if (servicesRes.success) {
        const nextServices = servicesRes.data || []
        const activeIds = new Set(nextServices.map((s) => s.id))
        setServices(nextServices)
        setSelectedServices((prev) => {
          const preserved = prev.filter((id) => activeIds.has(id))
          if (preserved.length > 0) return preserved
          if (!hasInitializedRef.current && nextServices.length > 0) {
            return [nextServices[0].id]
          }
          return []
        })
        hasInitializedRef.current = true
      }

      if (barbersRes.success) {
        const nextBarbers = barbersRes.data || []
        setBarbers(nextBarbers)
        setSelectedBarberId((prev) => {
          if (!prev) return null
          const stillAvailable = nextBarbers.some((b) => b.id === prev && b.status !== 'on_break')
          return stillAvailable ? prev : null
        })
      }

      if (settingsRes.success) {
        setSettings(settingsRes.data)
      }
    } catch (err) {
      console.error('Error initializing join form:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCatalog()

    const unsubscribe = subscribeToSalonUpdates(() => {
      loadCatalog()
    })

    const handleDevToggle = () => loadCatalog()
    window.addEventListener('salon_dev_testing_mode_change', handleDevToggle)

    return () => {
      unsubscribe()
      window.removeEventListener('salon_dev_testing_mode_change', handleDevToggle)
    }
  }, [loadCatalog])

  // Check if online queue is open
  const onlineOpen = isOnlineQueueOpen(settings)

  // Toggle service selection (min 1, max 3)
  const toggleService = (id) => {
    setErrorMessage('')
    setFieldErrors((prev) => ({ ...prev, services: null }))

    if (selectedServices.includes(id)) {
      if (selectedServices.length > 1) {
        setSelectedServices(selectedServices.filter((sId) => sId !== id))
      } else {
        setFieldErrors((prev) => ({ ...prev, services: t('error_services_empty') }))
      }
    } else {
      if (selectedServices.length < 3) {
        setSelectedServices([...selectedServices, id])
      } else {
        setFieldErrors((prev) => ({ ...prev, services: t('error_services_max') }))
      }
    }
  }

  // Calculate live booking totals
  const selectedItems = services.filter((s) => selectedServices.includes(s.id))
  const totalDuration = selectedItems.reduce((acc, curr) => acc + (curr.duration_minutes || 0), 0)
  const totalPrice = selectedItems.reduce((acc, curr) => acc + (Number(curr.price) || 0), 0)

  // Handle Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMessage('')
    setFieldErrors({})

    // 1. Client-side Validations
    const errors = {}

    const trimmedName = customerName.trim()
    if (!trimmedName) {
      errors.name = t('error_name_required')
    }

    const cleanPhone = phoneNumber.trim()
    if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
      errors.phone = t('error_mobile_invalid')
    }

    if (selectedServices.length === 0) {
      errors.services = t('error_services_empty')
    } else if (selectedServices.length > 3) {
      errors.services = t('error_services_max')
    }

    if (selectedBarberId) {
      const barber = barbers.find((b) => b.id === selectedBarberId)
      if (barber && (barber.status === 'on_break' || !barber.is_on_duty)) {
        errors.barber = t('error_barber_unavailable')
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    // Check queue hours
    if (!onlineOpen) {
      setErrorMessage(t('error_queue_closed'))
      return
    }

    // 2. Submit to Supabase / Service
    setSubmitting(true)

    try {
      const result = await joinQueue({
        customerName: trimmedName,
        phoneNumber: cleanPhone,
        serviceIds: selectedServices,
        preferredBarberId: selectedBarberId || null
      })

      if (!result.success) {
        setErrorMessage(result.error || 'Failed to join queue')
        setSubmitting(false)
        return
      }

      // Success: display token and redirect to /status/:id
      setSuccessData(result)

      setTimeout(() => {
        navigate(`/status/${result.queueId || 'demo'}`)
      }, 1500)
    } catch (err) {
      setErrorMessage(err.message || 'An unexpected error occurred')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      
      {/* Back button & Title */}
      <div className="flex items-center space-x-3">
        <Link
          to="/"
          className="p-2.5 rounded-xl bg-charcoal-900 border border-charcoal-700 text-gray-300 hover:text-white hover:bg-charcoal-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            {t('screen_join_title')}
          </h1>
          <p className="text-xs sm:text-sm text-gray-400">
            {t('join_subtitle')}
          </p>
        </div>
      </div>

      {/* Dev Testing Mode Control (Only rendered in development) */}
      <DevTestingControl onToggle={loadCatalog} />

      {/* Online Queue Closed Warning */}
      {!loading && !onlineOpen && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-xs text-rose-300 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-white mb-0.5">{t('status_closed')}</p>
            <p>{t('status_closed_notice')}</p>
          </div>
        </div>
      )}

      {/* Success Modal / Banner */}
      {successData && (
        <div className="bg-emerald-500/15 border-2 border-emerald-500/50 rounded-2xl p-6 text-center space-y-3 shadow-2xl animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-white">
            {t('success_joined')}
          </h3>
          <p className="text-4xl font-black font-mono text-gold-400 tracking-wider">
            {successData.tokenNumber}
          </p>
          <p className="text-xs text-gray-300">
            {t('join_redirecting')}
          </p>
        </div>
      )}

      {/* General Error Banner */}
      {errorMessage && (
        <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-4 text-xs text-rose-300 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-rose-200">{t('error_heading')}</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Join Queue Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Customer Name Field */}
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 space-y-2 shadow-md">
          <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-4 h-4 text-gold-500" />
            {t('field_name')} <span className="text-gold-500">*</span>
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value)
              if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: null }))
            }}
            placeholder={t('field_name_placeholder')}
            className={`w-full bg-charcoal-800 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none transition ${
              fieldErrors.name
                ? 'border-rose-500 focus:border-rose-400'
                : 'border-charcoal-700 focus:border-gold-500'
            }`}
          />
          {fieldErrors.name && (
            <p className="text-xs text-rose-400 font-medium">{fieldErrors.name}</p>
          )}
        </div>

        {/* 10-Digit Mobile Number Field */}
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 space-y-2 shadow-md">
          <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <Phone className="w-4 h-4 text-gold-500" />
            {t('field_mobile')} <span className="text-gold-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-3 text-sm text-gray-400 font-bold font-mono">+91</span>
            <input
              type="tel"
              maxLength={10}
              value={phoneNumber}
              onChange={(e) => {
                const numericOnly = e.target.value.replace(/\D/g, '')
                setPhoneNumber(numericOnly)
                if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: null }))
              }}
              placeholder={t('field_mobile_placeholder')}
              className={`w-full bg-charcoal-800 border rounded-xl pl-14 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none transition font-mono ${
                fieldErrors.phone
                  ? 'border-rose-500 focus:border-rose-400'
                  : 'border-charcoal-700 focus:border-gold-500'
              }`}
            />
          </div>
          {fieldErrors.phone ? (
            <p className="text-xs text-rose-400 font-medium">{fieldErrors.phone}</p>
          ) : (
            <p className="text-[11px] text-gray-400">{t('field_mobile_help')}</p>
          )}
        </div>

        {/* Service Multi-Selection (Max 3) */}
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 space-y-3 shadow-md">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <Scissors className="w-4 h-4 text-gold-500" />
              {t('field_services')}
            </label>
            <span className="text-xs text-gold-400 font-medium bg-gold-500/10 border border-gold-500/30 px-2.5 py-0.5 rounded-full">
              {selectedServices.length}/3 {t('selected_count')}
            </span>
          </div>

          {loading ? (
            <div className="py-6 text-center text-xs text-gray-400 animate-pulse">
              {t('loading_services')}
            </div>
          ) : services.length === 0 ? (
            <div className="py-5 px-4 text-center text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              {t('no_services_available')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {services.map((service) => {
                const isSelected = selectedServices.includes(service.id)
                const serviceName = language === 'gu' && service.name_gu ? service.name_gu : service.name_en

                return (
                  <div
                    key={service.id}
                    onClick={() => toggleService(service.id)}
                    className={`cursor-pointer rounded-xl p-3.5 border transition-all flex items-start justify-between ${
                      isSelected
                        ? 'bg-gold-500/15 border-gold-500 text-white shadow-sm'
                        : 'bg-charcoal-850 border-charcoal-700 text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">{serviceName}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gold-500" />
                        {service.duration_minutes} {t('mins')} &bull; ₹{service.price}
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center border transition ${
                        isSelected
                          ? 'bg-gold-500 border-gold-500 text-charcoal-950'
                          : 'border-charcoal-600 bg-charcoal-800'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {fieldErrors.services && (
            <p className="text-xs text-rose-400 font-medium pt-1">{fieldErrors.services}</p>
          )}
        </div>

        {/* Preferred Barber Selection */}
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-5 space-y-3 shadow-md">
          <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-4 h-4 text-gold-500" />
            {t('field_barber')}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            
            {/* Any Available Barber Option */}
            <div
              onClick={() => setSelectedBarberId(null)}
              className={`cursor-pointer rounded-xl p-3.5 border flex items-center justify-between transition ${
                selectedBarberId === null
                  ? 'bg-gold-500/15 border-gold-500 text-white'
                  : 'bg-charcoal-850 border-charcoal-700 text-gray-300 hover:border-gray-500'
              }`}
            >
              <div>
                <p className="text-sm font-bold text-gold-400">{t('any_barber')}</p>
                <p className="text-xs text-gray-400">{t('any_barber_desc')}</p>
              </div>
              <input
                type="radio"
                name="preferred_barber"
                checked={selectedBarberId === null}
                onChange={() => setSelectedBarberId(null)}
                className="text-gold-500 focus:ring-gold-500 w-4 h-4"
              />
            </div>

            {/* Individual Barbers */}
            {barbers.map((barber) => {
              const isOnBreak = barber.status === 'on_break'
              const isSelected = selectedBarberId === barber.id

              return (
                <div
                  key={barber.id}
                  onClick={() => {
                    if (!isOnBreak) setSelectedBarberId(barber.id)
                  }}
                  className={`rounded-xl p-3.5 border flex items-center justify-between transition ${
                    isOnBreak
                      ? 'bg-charcoal-800/40 border-charcoal-800 opacity-60 cursor-not-allowed'
                      : isSelected
                      ? 'bg-gold-500/15 border-gold-500 text-white cursor-pointer'
                      : 'bg-charcoal-850 border-charcoal-700 text-gray-300 hover:border-gray-500 cursor-pointer'
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold">{barber.name}</p>
                    <p className="text-xs text-gray-400">
                      {isOnBreak ? (
                        <span className="text-amber-400 font-medium">{t('currently_on_break')}</span>
                      ) : (
                        <span className="text-emerald-400">{t('available')}</span>
                      )}
                    </p>
                  </div>
                  <input
                    type="radio"
                    name="preferred_barber"
                    disabled={isOnBreak}
                    checked={isSelected}
                    onChange={() => {
                      if (!isOnBreak) setSelectedBarberId(barber.id)
                    }}
                    className="text-gold-500 focus:ring-gold-500 w-4 h-4"
                  />
                </div>
              )
            })}
          </div>

          {fieldErrors.barber && (
            <p className="text-xs text-rose-400 font-medium pt-1">{fieldErrors.barber}</p>
          )}
        </div>

        {/* Booking Summary Card */}
        <div className="bg-charcoal-850 border border-charcoal-700 rounded-2xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {t('booking_summary')}
          </h3>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">{t('total_duration')}:</span>
            <span className="font-bold text-white flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-gold-500" />
              {totalDuration} {t('mins')}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">{t('total_price')}:</span>
            <span className="font-black text-gold-400 text-xl font-mono">
              ₹{totalPrice}
            </span>
          </div>
        </div>

        {/* Confirm & Join Button */}
        <button
          type="submit"
          disabled={submitting || !onlineOpen || services.length === 0}
          className={`w-full py-4 rounded-xl font-black text-center text-charcoal-950 text-base shadow-xl transition-all transform flex items-center justify-center space-x-2 ${
            submitting || !onlineOpen || services.length === 0
              ? 'bg-charcoal-700 text-gray-400 cursor-not-allowed opacity-80'
              : 'bg-gold-500 hover:bg-gold-600 shadow-gold-500/25 active:scale-[0.99]'
          }`}
        >
          {submitting ? (
            <span>{t('action_joining')}</span>
          ) : (
            <span>{t('action_confirm')}</span>
          )}
        </button>
      </form>

    </div>
  )
}
