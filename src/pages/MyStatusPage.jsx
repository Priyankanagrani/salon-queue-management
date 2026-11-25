import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Ticket,
  Clock,
  AlertTriangle,
  ArrowLeft,
  XCircle,
  CheckCircle2,
  Sparkles,
  Bell,
  Scissors,
  User,
  RefreshCw,
  Database,
  AlertCircle
} from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import {
  fetchCustomerStatus,
  cancelQueueSpot,
  fetchBarbers,
  subscribeToSalonUpdates
} from '../services/supabaseService'

const STATUS_BADGE_STYLES = {
  waiting: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  called: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  in_chair: 'bg-gold-500/15 text-gold-400 border-gold-500/40',
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  cancelled: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  no_show: 'bg-rose-500/15 text-rose-300 border-rose-500/40'
}

const STATUS_LABEL_KEYS = {
  waiting: 'status_waiting',
  called: 'status_called',
  in_chair: 'status_in_chair',
  done: 'status_done',
  cancelled: 'status_cancelled',
  no_show: 'status_noshow'
}

function getAlertConfig(ticket, t) {
  if (!ticket) return null

  if (ticket.status === 'waiting' && ticket.position === 2) {
    return {
      containerClass: 'bg-amber-500/15 border-2 border-amber-500/50 animate-pulse',
      iconClass: 'text-amber-400',
      titleClass: 'text-amber-300',
      descClass: 'text-amber-100/90',
      Icon: Bell,
      title: t('alert_start_coming_title'),
      desc: t('alert_start_coming_desc')
    }
  }

  const byStatus = {
    called: {
      containerClass: 'bg-emerald-500/15 border-2 border-emerald-500/60 animate-pulse',
      iconClass: 'text-emerald-400',
      titleClass: 'text-emerald-300',
      descClass: 'text-emerald-100/90',
      Icon: Bell,
      title: t('alert_your_turn_title'),
      desc: ticket.assigned_barber_name
        ? `${t('alert_your_turn_desc')} (${t('assigned_barber')}: ${ticket.assigned_barber_name})`
        : t('alert_your_turn_desc')
    },
    in_chair: {
      containerClass: 'bg-gold-500/15 border border-gold-500/40',
      iconClass: 'text-gold-400',
      titleClass: 'text-gold-300',
      descClass: 'text-gray-200',
      Icon: Scissors,
      title: t('alert_in_chair_title'),
      desc: t('alert_in_chair_desc')
    },
    done: {
      containerClass: 'bg-emerald-500/10 border border-emerald-500/30',
      iconClass: 'text-emerald-400',
      titleClass: 'text-emerald-300',
      descClass: 'text-gray-300',
      Icon: CheckCircle2,
      title: t('alert_done_title'),
      desc: t('alert_done_desc')
    },
    cancelled: {
      containerClass: 'bg-rose-500/10 border border-rose-500/30',
      iconClass: 'text-rose-400',
      titleClass: 'text-rose-300',
      descClass: 'text-gray-300',
      Icon: XCircle,
      title: t('alert_cancelled_title'),
      desc: t('alert_cancelled_desc')
    },
    no_show: {
      containerClass: 'bg-rose-500/15 border border-rose-500/40',
      iconClass: 'text-rose-400',
      titleClass: 'text-rose-300',
      descClass: 'text-gray-300',
      Icon: AlertTriangle,
      title: t('alert_noshow_title'),
      desc: t('alert_noshow_desc')
    }
  }

  return byStatus[ticket.status] || null
}

export default function MyStatusPage() {
  const { id } = useParams()
  const { t, language } = useLanguage()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [ticket, setTicket] = useState(null)
  const [barbers, setBarbers] = useState([])
  const [isLive, setIsLive] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [actionError, setActionError] = useState('')
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const loadStatus = useCallback(async (isBackgroundRefresh = false) => {
    if (!id) {
      setNotFound(true)
      setTicket(null)
      setLoading(false)
      return
    }

    if (!isBackgroundRefresh) {
      setRefreshing(true)
    }

    try {
      const [statusRes, barbersRes] = await Promise.all([
        fetchCustomerStatus(id),
        fetchBarbers()
      ])

      if (barbersRes.success && Array.isArray(barbersRes.data)) {
        setBarbers(barbersRes.data)
      }

      if (!statusRes.success || !statusRes.data) {
        setNotFound(true)
        setTicket(null)
      } else {
        setNotFound(false)
        setTicket(statusRes.data)
        setIsLive(Boolean(statusRes.isLiveSupabase))
      }
    } catch (err) {
      console.error('Error loading ticket status:', err)
      if (!isBackgroundRefresh) {
        setNotFound(true)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    setActionError('')
    setCancelModalOpen(false)
    loadStatus(false)

    // Subscribe to zero-payload Supabase Broadcast + 5s polling fallback
    const unsubscribe = subscribeToSalonUpdates(() => {
      loadStatus(true)
    })

    return () => {
      unsubscribe()
    }
  }, [loadStatus])

  const handleConfirmCancel = async () => {
    if (!ticket?.id || cancelling) return
    setCancelling(true)
    setActionError('')

    try {
      const result = await cancelQueueSpot(ticket.id)
      if (!result.success) {
        setActionError(result.error || 'Unable to cancel queue spot.')
        setCancelModalOpen(false)
        await loadStatus(true)
        return
      }

      setCancelModalOpen(false)
      await loadStatus(false)
    } catch (err) {
      setActionError(err.message || 'Unable to cancel queue spot.')
      setCancelModalOpen(false)
    } finally {
      setCancelling(false)
    }
  }

  const preferredBarber = ticket?.preferred_barber_id
    ? barbers.find((b) => b.id === ticket.preferred_barber_id)
    : null
  const isPreferredBarberOnBreak =
    ticket?.status === 'waiting' &&
    Boolean(ticket?.preferred_barber_id) &&
    preferredBarber?.status === 'on_break'

  const alertConfig = getAlertConfig(ticket, t)
  const servicesList = Array.isArray(ticket?.selected_services) ? ticket.selected_services : []
  const isTerminalState = ticket && ['done', 'cancelled', 'no_show'].includes(ticket.status)

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
      {/* Database Connection Status Banner */}
      <div className="flex items-center justify-between bg-charcoal-900 border border-charcoal-700/80 rounded-2xl px-4 py-2.5 text-xs text-gray-300 shadow-sm">
        <div className="flex items-center space-x-2">
          <Database className={`w-4 h-4 ${isLive ? 'text-emerald-400' : 'text-gold-400'}`} />
          <span className="font-medium">
            {isLive ? t('db_live') : t('db_sandbox')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => loadStatus(false)}
          disabled={refreshing}
          className="flex items-center space-x-1 text-gray-400 hover:text-white transition disabled:opacity-50"
          title={t('refresh_label')}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="text-[11px] hidden sm:inline">{t('refresh_label')}</span>
        </button>
      </div>

      {/* Back button & Token ID */}
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/"
          className="px-3 py-2 rounded-xl bg-charcoal-900 border border-charcoal-700 text-gray-300 hover:text-white transition flex items-center gap-2 text-xs font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('action_back_home')}</span>
        </Link>
        <span className="text-[11px] text-gray-400 font-mono truncate max-w-[180px]" title={id}>
          ID: {id || '—'}
        </span>
      </div>

      {/* Stage 3 Notice */}
      <div className="bg-charcoal-900/80 border border-gold-500/20 rounded-xl p-3 text-xs text-gray-300 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-gold-500 flex-shrink-0" />
        <span>{t('stage_notice')}</span>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl p-8 text-center space-y-4 shadow-xl animate-pulse">
          <div className="w-12 h-12 rounded-full bg-gold-500/15 border border-gold-500/30 mx-auto flex items-center justify-center">
            <Ticket className="w-6 h-6 text-gold-400" />
          </div>
          <p className="text-sm font-medium text-gray-300">{t('loading_status')}</p>
        </div>
      ) : notFound || !ticket ? (
        /* Invalid / Not Found Token Fallback */
        <div className="bg-charcoal-900 border border-rose-500/30 rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-white">{t('token_not_found_title')}</h1>
            <p className="text-sm text-gray-300 leading-relaxed">{t('token_not_found_desc')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              to="/join"
              className="flex-1 py-3.5 px-4 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 font-black text-sm text-center transition"
            >
              {t('action_rejoin')}
            </Link>
            <Link
              to="/"
              className="flex-1 py-3.5 px-4 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-600 font-semibold text-sm text-center transition"
            >
              {t('action_back_home')}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Action Error Banner */}
          {actionError && (
            <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-4 text-xs text-rose-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <p>{actionError}</p>
            </div>
          )}

          {/* Live Status Alert Banner (Start Coming at #2, It's Your Turn when Called, or Terminal Status) */}
          {alertConfig && (
            <div className={`${alertConfig.containerClass} rounded-2xl p-4 flex items-start space-x-3 shadow-lg`}>
              <alertConfig.Icon className={`w-5 h-5 ${alertConfig.iconClass} flex-shrink-0 mt-0.5`} />
              <div>
                <p className={`text-sm font-bold ${alertConfig.titleClass}`}>
                  {alertConfig.title}
                </p>
                <p className={`text-xs mt-0.5 ${alertConfig.descClass}`}>
                  {alertConfig.desc}
                </p>
              </div>
            </div>
          )}

          {/* Preferred Barber On Break Notice (Rule 6.6) */}
          {isPreferredBarberOnBreak && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200 leading-relaxed">
                {t('barber_on_break_notice')}
              </p>
            </div>
          )}

          {/* Main Token & Ticket Card */}
          <div className="bg-gradient-to-b from-charcoal-900 to-charcoal-850 border border-gold-500/40 rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-gold-500/10 border border-gold-500/30 text-gold-400 text-xs font-semibold">
              <Ticket className="w-3.5 h-3.5" />
              <span>{t('your_token')}</span>
            </div>

            <div>
              <h1 className="text-5xl sm:text-6xl font-black text-gold-400 tracking-wider font-mono">
                {ticket.token_number}
              </h1>
              <p className="text-base font-bold text-white mt-2">
                {ticket.customer_name}
              </p>
            </div>

            {/* Status Pill Badge */}
            <div className="inline-block">
              <span
                className={`inline-flex items-center px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
                  STATUS_BADGE_STYLES[ticket.status] || 'bg-charcoal-800 text-gray-300 border-charcoal-600'
                }`}
              >
                {t(STATUS_LABEL_KEYS[ticket.status] || 'status_waiting')}
              </span>
            </div>

            {/* Live Position & Approximate Wait Time (shown while waiting) */}
            {ticket.status === 'waiting' && (
              <div className="border-t border-charcoal-700/80 pt-5 space-y-3">
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="bg-charcoal-800/80 border border-charcoal-700/60 rounded-2xl p-3.5 text-center">
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                      {t('position_in_line')}
                    </p>
                    <p className="text-2xl sm:text-3xl font-black text-white mt-1 font-mono">
                      #{ticket.position}
                    </p>
                  </div>
                  <div className="bg-charcoal-800/80 border border-charcoal-700/60 rounded-2xl p-3.5 text-center">
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                      {t('estimated_wait')}
                    </p>
                    <p className="text-2xl sm:text-3xl font-black text-gold-400 mt-1 font-mono">
                      ~{ticket.estimated_wait_minutes ?? 0}
                      <span className="text-xs font-sans font-semibold text-gray-400 ml-1">
                        {t('mins')}
                      </span>
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400">
                  {t('approx_disclaimer')}
                </p>
              </div>
            )}

            {/* Barber & Selected Services Details */}
            <div className="border-t border-charcoal-700/80 pt-5 text-left space-y-4">
              {/* Barber Info */}
              <div className="flex items-center justify-between bg-charcoal-800/60 rounded-xl px-4 py-3 text-sm">
                <span className="text-gray-400 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                  <User className="w-4 h-4 text-gold-500" />
                  {ticket.assigned_barber_name ? t('assigned_barber') : t('preferred_barber')}
                </span>
                <span className="font-bold text-white">
                  {ticket.assigned_barber_name
                    ? ticket.assigned_barber_name
                    : preferredBarber
                    ? preferredBarber.name
                    : t('any_barber')}
                </span>
              </div>

              {/* Selected Services List */}
              <div className="bg-charcoal-800/60 rounded-xl p-4 space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-gold-500" />
                  {t('selected_services_label')}
                </p>

                <div className="space-y-2">
                  {servicesList.map((service, index) => {
                    const serviceName =
                      language === 'gu' && service.name_gu ? service.name_gu : service.name_en
                    return (
                      <div
                        key={service.id || index}
                        className="flex items-center justify-between text-sm border-b border-charcoal-700/50 last:border-b-0 pb-2 last:pb-0"
                      >
                        <span className="text-gray-200 font-medium">{serviceName}</span>
                        <span className="text-xs text-gray-400 font-mono flex items-center gap-2">
                          <span>{service.duration} {t('mins')}</span>
                          <span>&bull;</span>
                          <span className="text-gold-400 font-semibold">₹{service.price}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Totals Row */}
                <div className="border-t border-charcoal-700 pt-2.5 flex items-center justify-between text-xs">
                  <span className="text-gray-400 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-gold-500" />
                    {t('total_duration')}:{' '}
                    <strong className="text-white">{ticket.total_duration} {t('mins')}</strong>
                  </span>
                  <span className="text-gray-400">
                    {t('total_price')}:{' '}
                    <strong className="text-gold-400 font-mono text-sm">₹{ticket.total_price}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cancel Spot Section (Strictly available only while status is 'waiting') */}
          {ticket.status === 'waiting' && (
            <div className="bg-charcoal-900 border border-charcoal-700 rounded-2xl p-4 text-center space-y-2.5">
              <button
                type="button"
                onClick={() => setCancelModalOpen(true)}
                disabled={cancelling}
                className="w-full py-3.5 rounded-xl bg-charcoal-800 hover:bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:border-rose-500 font-bold text-sm transition flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>{cancelling ? t('action_cancelling') : t('action_cancel_spot')}</span>
              </button>
              <p className="text-[11px] text-gray-400">
                {t('cancel_waiting_only_note')}
              </p>
            </div>
          )}

          {/* Rejoin / Home Actions for Terminal States */}
          {isTerminalState && (
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to="/join"
                className="flex-1 py-3.5 px-4 rounded-xl bg-gold-500 hover:bg-gold-600 text-charcoal-950 font-black text-sm text-center transition"
              >
                {t('action_rejoin')}
              </Link>
              <Link
                to="/"
                className="flex-1 py-3.5 px-4 rounded-xl bg-charcoal-900 hover:bg-charcoal-800 text-gray-200 border border-charcoal-700 font-semibold text-sm text-center transition"
              >
                {t('action_back_home')}
              </Link>
            </div>
          )}
        </>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-modal-title"
        >
          <div className="bg-charcoal-900 border border-charcoal-700 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 id="cancel-modal-title" className="text-lg font-bold text-white">
                  {t('modal_cancel_title')}
                </h2>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {t('modal_cancel_desc')}
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                disabled={cancelling}
                className="flex-1 py-3 px-4 rounded-xl bg-charcoal-800 hover:bg-charcoal-700 text-gray-200 border border-charcoal-600 font-semibold text-sm transition disabled:opacity-50"
              >
                {t('modal_cancel_keep')}
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="flex-1 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition disabled:opacity-50"
              >
                {cancelling ? t('action_cancelling') : t('modal_cancel_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
