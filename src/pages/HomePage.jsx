import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Users, Scissors, ChevronRight, Sparkles, Database, AlertCircle, RefreshCw } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import {
  fetchSalonSettings,
  fetchBarbers,
  fetchQueueStats,
  isOnlineQueueOpen,
  subscribeToSalonUpdates
} from '../services/supabaseService'
import DevTestingControl from '../components/common/DevTestingControl'

export default function HomePage() {
  const { t, language } = useLanguage()

  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [barbers, setBarbers] = useState([])
  const [queueStats, setQueueStats] = useState({
    waitingCount: 0,
    estimatedWaitMinutes: 0,
    workingBarbersCount: 0,
    isLiveSupabase: false
  })
  const [isLive, setIsLive] = useState(false)

  const loadData = async () => {
    try {
      const [settingsRes, barbersRes, statsRes] = await Promise.all([
        fetchSalonSettings(),
        fetchBarbers(),
        fetchQueueStats()
      ])

      if (settingsRes.success) setSettings(settingsRes.data)
      if (barbersRes.success) setBarbers(barbersRes.data)
      setQueueStats(statsRes)
      setIsLive(statsRes.isLiveSupabase || settingsRes.isLiveSupabase)
    } catch (err) {
      console.error('Error loading salon home data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    // Subscribe to live database updates across all devices
    const unsubscribe = subscribeToSalonUpdates(() => {
      loadData()
    })

    // Listen for dev testing mode changes
    const handleDevToggle = () => loadData()
    window.addEventListener('salon_dev_testing_mode_change', handleDevToggle)

    return () => {
      unsubscribe()
      window.removeEventListener('salon_dev_testing_mode_change', handleDevToggle)
    }
  }, [])

  const onlineOpen = isOnlineQueueOpen(settings)
  const salonName = language === 'gu' && settings?.salon_name_gu ? settings.salon_name_gu : (settings?.salon_name_en || t('salon_title'))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 space-y-8">
      
      {/* Database Connection Status Banner */}
      <div className="flex items-center justify-between bg-charcoal-900 border border-charcoal-700/80 rounded-2xl px-4 py-2.5 text-xs text-gray-300 shadow-sm">
        <div className="flex items-center space-x-2">
          <Database className={`w-4 h-4 ${isLive ? 'text-emerald-400' : 'text-gold-400'}`} />
          <span className="font-medium">
            {isLive ? t('db_live') : t('db_sandbox')}
          </span>
        </div>
        <button
          onClick={loadData}
          className="flex items-center space-x-1 text-gray-400 hover:text-white transition"
          title={t('refresh_label')}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="text-[11px] hidden sm:inline">{t('refresh_label')}</span>
        </button>
      </div>

      {/* Dev Testing Mode Control (Only rendered in development) */}
      <DevTestingControl onToggle={loadData} />

      {/* Hero Salon Branding & Live Status Card */}
      <div className="bg-gradient-to-b from-charcoal-900 to-charcoal-850 border border-charcoal-700 rounded-3xl p-6 sm:p-10 text-center space-y-5 shadow-2xl relative overflow-hidden">
        
        {/* Salon Open/Closed Badge */}
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border shadow-sm">
          {onlineOpen ? (
            <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {t('status_open')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-rose-400 bg-rose-500/10 border-rose-500/30">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              {t('status_closed')}
            </span>
          )}
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
          {salonName}
        </h1>
        <p className="text-sm sm:text-base text-gray-300 max-w-lg mx-auto font-medium">
          {t('tagline')} — {t('home_hero_subtitle')}
        </p>

        {/* Join Queue Call to Action */}
        <div className="pt-2">
          {onlineOpen ? (
            <Link
              to="/join"
              className="inline-flex items-center justify-center space-x-2 w-full sm:w-auto px-10 py-4 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 font-black text-base shadow-xl shadow-gold-500/25 transition-all transform hover:-translate-y-0.5 active:scale-95"
            >
              <span>{t('action_join')}</span>
              <ChevronRight className="w-5 h-5 stroke-[2.5]" />
            </Link>
          ) : (
            <div className="max-w-md mx-auto bg-charcoal-800/80 border border-rose-500/30 rounded-2xl p-4 text-xs text-rose-300 text-left flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white mb-0.5">{t('status_closed')}</p>
                <p>{t('status_closed_notice')}</p>
                <p className="text-gray-400 mt-1">{t('status_auto_close_notice')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Salon Queue Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        
        {/* Waiting Count Card */}
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 flex items-center space-x-4 shadow-md">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/15 border border-gold-500/30 flex items-center justify-center text-gold-500 flex-shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              {t('customers_waiting')}
            </p>
            <p className="text-3xl sm:text-4xl font-extrabold text-white mt-0.5">
              {loading ? '...' : queueStats.waitingCount}{' '}
              <span className="text-xs text-gray-400 font-normal">{t('in_line')}</span>
            </p>
            <p className="text-xs text-emerald-400 mt-1 font-medium">
              {queueStats.waitingCount === 0 ? t('no_customers_waiting') : `${queueStats.waitingCount} ${t('in_line')}`}
            </p>
          </div>
        </div>

        {/* Estimated Wait Time Card */}
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 flex items-center space-x-4 shadow-md">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/15 border border-gold-500/30 flex items-center justify-center text-gold-500 flex-shrink-0">
            <Clock className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              {t('estimated_wait_time')}
            </p>
            <p className="text-3xl sm:text-4xl font-extrabold text-gold-400 mt-0.5 font-mono">
              {loading ? '...' : `~${queueStats.estimatedWaitMinutes}`}{' '}
              <span className="text-xs text-gray-400 font-normal font-sans">{t('mins')}</span>
            </p>
            <p className="text-xs text-gray-400 mt-1 font-medium">
              {queueStats.estimatedWaitMinutes === 0 ? t('immediate_service') : `${queueStats.workingBarbersCount} ${t('barbers_on_duty')}`}
            </p>
          </div>
        </div>

      </div>

      {/* Available Barbers List */}
      <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-6 space-y-4 shadow-md">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <Scissors className="w-4 h-4 text-gold-500" />
            {t('barbers_on_duty')}
          </h2>
          <span className="text-xs text-gold-400 font-semibold bg-gold-500/10 border border-gold-500/30 px-3 py-1 rounded-full">
            {barbers.length} {t('active_count')}
          </span>
        </div>

        {barbers.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-2">{t('home_no_barbers_on_duty')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {barbers.map((barber) => {
              const isAvailable = barber.status === 'available'
              const isServing = barber.status === 'serving'
              const isOnBreak = barber.status === 'on_break'

              return (
                <div
                  key={barber.id}
                  className="bg-charcoal-850 border border-charcoal-700/80 rounded-xl p-4 flex items-center justify-between hover:border-charcoal-600 transition"
                >
                  <div>
                    <p className="text-sm font-bold text-white">{barber.name}</p>
                    <p className="text-xs flex items-center gap-1.5 mt-1">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isAvailable
                            ? 'bg-emerald-400'
                            : isServing
                            ? 'bg-gold-400'
                            : 'bg-gray-500'
                        }`}
                      ></span>
                      <span
                        className={
                          isAvailable
                            ? 'text-emerald-400 font-medium'
                            : isServing
                            ? 'text-gold-400 font-medium'
                            : 'text-gray-400'
                        }
                      >
                        {isAvailable ? t('available') : isServing ? t('serving') : t('on_break')}
                      </span>
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-gray-400 bg-charcoal-800 px-2 py-1 rounded-lg">
                    {t('chair_label')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
