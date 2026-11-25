import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'

// Initial fallback seeds for local sandbox mode (when Supabase .env is not yet configured)
const INITIAL_SALON_SETTINGS = {
  id: 1,
  salon_name_en: 'Royal Crown Salon',
  salon_name_gu: 'રોયલ ક્રાઉન સલૂન',
  is_online_queue_open: true,
  opening_time: '09:00:00',
  closing_time: '21:00:00',
  auto_close_buffer_minutes: 30,
}

const INITIAL_BARBERS = [
  { id: 'b1111111-1111-1111-1111-111111111111', name: 'Amit', is_on_duty: true, status: 'available', current_queue_id: null },
  { id: 'b2222222-2222-2222-2222-222222222222', name: 'Rahul', is_on_duty: true, status: 'available', current_queue_id: null },
  { id: 'b3333333-3333-3333-3333-333333333333', name: 'Priya', is_on_duty: true, status: 'available', current_queue_id: null },
]

const INITIAL_SERVICES = [
  { id: 's1111111-1111-1111-1111-111111111111', name_en: 'Haircut & Styling', name_gu: 'હેરકટ અને સ્ટાઇલ', duration_minutes: 30, price: 250, is_active: true, display_order: 1 },
  { id: 's2222222-2222-2222-2222-222222222222', name_en: 'Beard Trim & Shape', name_gu: 'દાઢી ટ્રીમ અને શેપ', duration_minutes: 20, price: 150, is_active: true, display_order: 2 },
  { id: 's3333333-3333-3333-3333-333333333333', name_en: 'Head Massage', name_gu: 'હેડ મસાજ', duration_minutes: 25, price: 200, is_active: true, display_order: 3 },
  { id: 's4444444-4444-4444-4444-444444444444', name_en: 'Facial & Cleansing', name_gu: 'ફેશિયલ અને ક્લીન્સિંગ', duration_minutes: 45, price: 500, is_active: true, display_order: 4 },
  { id: 's5555555-5555-5555-5555-555555555555', name_en: 'Hair Color / Dye', name_gu: 'હેર કલર / ડાઇ', duration_minutes: 40, price: 400, is_active: true, display_order: 5 },
]

// Local Sandbox storage helpers
function getLocalStore(key, initial) {
  const cloneInitial = () => JSON.parse(JSON.stringify(initial))
  try {
    const val = localStorage.getItem(`salon_${key}`)
    if (!val) {
      const fresh = cloneInitial()
      localStorage.setItem(`salon_${key}`, JSON.stringify(fresh))
      return fresh
    }
    return JSON.parse(val)
  } catch {
    return cloneInitial()
  }
}

function setLocalStore(key, data) {
  try {
    localStorage.setItem(`salon_${key}`, JSON.stringify(data))
  } catch (err) {
    console.error('LocalStorage write error', err)
  }
}

/**
 * Local Sandbox Mode only: reconcile stale orphaned 'serving' / current_queue_id states
 * against active ('called' or 'in_chair') entries in local queue_entries.
 * Never resets a barber with a genuinely matching active customer.
 */
function getReconciledLocalBarbers(queueOverride = null) {
  const barbers = getLocalStore('barbers', INITIAL_BARBERS)
  const queue = queueOverride || getLocalStore('queue_entries', [])
  let changed = false

  const reconciled = barbers.map((barber) => {
    const missingQueueField = barber.current_queue_id === undefined
    const activeMatch = barber.current_queue_id
      ? queue.find(
          (q) =>
            q.id === barber.current_queue_id &&
            q.assigned_barber_id === barber.id &&
            ['called', 'in_chair'].includes(q.status)
        )
      : null

    if (activeMatch) {
      return barber
    }

    if (barber.status === 'serving' || barber.current_queue_id) {
      changed = true
      return {
        ...barber,
        status: barber.is_on_duty ? 'available' : 'on_break',
        current_queue_id: null,
        updated_at: new Date().toISOString()
      }
    }

    if (missingQueueField) {
      changed = true
      return {
        ...barber,
        current_queue_id: null
      }
    }

    return barber
  })

  if (changed) {
    setLocalStore('barbers', reconciled)
  }

  return reconciled
}

/**
 * Fetch salon settings
 */
export async function fetchSalonSettings() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('salon_settings')
        .select('*')
        .eq('id', 1)
        .single()
      if (error) throw error
      return { success: true, data, isLiveSupabase: true }
    } catch (err) {
      console.warn('Supabase query failed, falling back to local sandbox:', err.message)
    }
  }

  // Local Sandbox fallback
  const settings = getLocalStore('settings', INITIAL_SALON_SETTINGS)
  return { success: true, data: settings, isLiveSupabase: false }
}

/**
 * Fetch active services
 */
export async function fetchServices() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
      if (error) throw error
      return { success: true, data, isLiveSupabase: true }
    } catch (err) {
      console.warn('Supabase services query failed, falling back to local sandbox:', err.message)
    }
  }

  const services = getLocalStore('services', INITIAL_SERVICES)
  return { success: true, data: services.filter((s) => s.is_active), isLiveSupabase: false }
}

/**
 * Fetch barbers on duty
 */
export async function fetchBarbers() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('barbers')
        .select('*')
        .eq('is_on_duty', true)
        .order('name', { ascending: true })
      if (error) throw error
      return { success: true, data, isLiveSupabase: true }
    } catch (err) {
      console.warn('Supabase barbers query failed, falling back to local sandbox:', err.message)
    }
  }

  const barbers = getReconciledLocalBarbers()
  return { success: true, data: barbers.filter((b) => b.is_on_duty), isLiveSupabase: false }
}

/**
 * Shared Wait-Time Calculation Engine for Home and My Status
 * Implements Rule 7.1: Total eligible duration / working barbers.
 * Uses Math.ceil() for wait-time estimates as required.
 *
 * @param {boolean} isForNewCustomer - true for Home (prospective customer), false for My Status (ticket holder)
 * @param {number|null} customerPosition - Position for My Status (1, 2...; null for Home)
 * @param {string|null} preferredBarberId - null for Any Barber, or specific barber UUID
 * @param {Array} waitingEntriesAhead - Waiting customers ahead (for Home: all waiting entries; for My Status: entries ahead)
 * @param {Array} workingBarbers - On-duty barbers with status, service_started_at, and active_service_duration
 * @returns {number} Estimated wait time in approximate minutes
 */
export function calculateEstimatedWaitTime({
  isForNewCustomer,
  customerPosition,
  preferredBarberId = null,
  waitingEntriesAhead = [],
  workingBarbers = [],
}) {
  const activeWorkingBarbers = workingBarbers.filter(
    (b) => b.is_on_duty && b.status !== 'on_break'
  );
  const numWorkingBarbers = activeWorkingBarbers.length;

  if (numWorkingBarbers === 0) {
    return 0; // Queue paused - no barbers working
  }

  // Helper: compute actual elapsed-based remaining chair time for a serving barber
  // Strictly uses database timestamps and durations; returns 0 if data is not present
  const getBarberRemainingTime = (barber) => {
    if (!barber || barber.status !== 'serving') return 0;
    if (!barber.service_started_at || typeof barber.active_service_duration !== 'number') return 0;

    const startedAt = new Date(barber.service_started_at).getTime();
    const now = Date.now();
    const elapsedMinutes = Math.floor((now - startedAt) / 60000);
    return Math.max(0, barber.active_service_duration - elapsedMinutes);
  };

  // Helper: validate entry duration explicitly without arbitrary fallbacks
  const getEntryDuration = (entry) => {
    return typeof entry?.total_duration === 'number' && !isNaN(entry.total_duration)
      ? entry.total_duration
      : 0;
  };

  // 1. My Status Check: Customer holds Position #1 and an eligible barber is free
  if (!isForNewCustomer && customerPosition === 1) {
    if (!preferredBarberId) {
      const hasAvailableBarber = activeWorkingBarbers.some((b) => b.status === 'available');
      if (hasAvailableBarber) return 0; // Immediate turn for existing #1 customer
    } else {
      const preferredBarber = activeWorkingBarbers.find((b) => b.id === preferredBarberId);
      if (preferredBarber && preferredBarber.status === 'available') return 0; // Immediate turn with preferred barber
    }
  }

  // 2. Home Screen Check: Immediate turn for prospective customer ONLY when queue is completely empty
  if (isForNewCustomer && waitingEntriesAhead.length === 0) {
    const hasAvailableBarber = activeWorkingBarbers.some((b) => b.status === 'available');
    if (hasAvailableBarber) return 0; // Immediate turn because no one is waiting ahead
  }

  // 3. Specific Barber Workload Calculation (includes preferred barber's active chair time)
  if (preferredBarberId) {
    const preferredBarber = activeWorkingBarbers.find((b) => b.id === preferredBarberId);

    // (a) Preferred barber's remaining chair time (0 if barber is available)
    const preferredBarberRemainingChairTime = getBarberRemainingTime(preferredBarber);

    // (b) Waiting entries ahead who specifically chose this barber
    const specificAheadWork = waitingEntriesAhead
      .filter((q) => q.preferred_barber_id === preferredBarberId)
      .reduce((sum, q) => sum + getEntryDuration(q), 0);

    // (c) Shared Any-Barber workload distributed across all active barbers
    const anyAheadWork = waitingEntriesAhead
      .filter((q) => !q.preferred_barber_id)
      .reduce((sum, q) => sum + getEntryDuration(q), 0);
    const anyWorkShare = Math.ceil(anyAheadWork / numWorkingBarbers);

    return preferredBarberRemainingChairTime + specificAheadWork + anyWorkShare;
  }

  // 4. Any Available Barber Workload Calculation (Home screen and Any-Barber My Status)
  // (a) Sum of remaining chair times of all serving barbers
  const totalChairRemainingWork = activeWorkingBarbers.reduce(
    (sum, b) => sum + getBarberRemainingTime(b),
    0
  );

  // (b) Total duration of all waiting customers ahead
  const totalQueueWorkAhead = waitingEntriesAhead.reduce(
    (sum, q) => sum + getEntryDuration(q),
    0
  );

  // Rule 7.1: Total duration divided by number of working barbers using Math.ceil()
  const totalWorkload = totalChairRemainingWork + totalQueueWorkAhead;
  return Math.ceil(totalWorkload / numWorkingBarbers);
}

function compareQueueEntriesFcfs(a, b) {
  const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  if (timeDiff !== 0) return timeDiff
  return String(a.id || '').localeCompare(String(b.id || ''))
}

function isEntryAheadFcfs(candidate, target) {
  const cTime = new Date(candidate.created_at).getTime()
  const tTime = new Date(target.created_at).getTime()
  if (cTime < tTime) return true
  if (cTime === tTime) {
    return String(candidate.id || '').localeCompare(String(target.id || '')) < 0
  }
  return false
}

/**
 * Fetch waiting queue statistics
 * Returns: waiting count and estimated waiting time for Home screen
 */
export async function fetchQueueStats() {
  let waitingEntries = []
  let workingBarbers = []
  let isLiveSupabase = false

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_home_queue_stats')
      if (!error && data && data.success !== false) {
        waitingEntries = data.waiting_entries || []
        workingBarbers = data.working_barbers || []
        isLiveSupabase = true
      }
    } catch (err) {
      console.warn('Supabase queue stats RPC failed:', err.message)
    }
  }

  if (!isLiveSupabase) {
    const queue = getLocalStore('queue_entries', [])
    waitingEntries = queue
      .filter((item) => item.status === 'waiting')
      .sort(compareQueueEntriesFcfs)
    const barbers = getReconciledLocalBarbers(queue)
    workingBarbers = barbers
      .filter((b) => b.is_on_duty && b.status !== 'on_break')
      .map((b) => {
        if (b.status === 'serving' && b.current_queue_id) {
          const activeEntry = queue.find((item) => item.id === b.current_queue_id)
          if (activeEntry) {
            return {
              ...b,
              service_started_at: activeEntry.service_started_at,
              active_service_duration: activeEntry.total_duration
            }
          }
        }
        return b
      })
  }

  const waitingCount = waitingEntries.length
  const workingBarbersCount = workingBarbers.length

  // Calculate estimated wait for an incoming prospective customer joining now
  const estimatedWaitMinutes = calculateEstimatedWaitTime({
    isForNewCustomer: true,
    customerPosition: null,
    preferredBarberId: null,
    waitingEntriesAhead: waitingEntries,
    workingBarbers: workingBarbers
  })

  return {
    waitingCount,
    estimatedWaitMinutes,
    workingBarbersCount,
    isLiveSupabase
  }
}

/**
 * Dev Testing Mode Helpers
 * Only active when import.meta.env.DEV is true.
 */
export function isDevTestingMode() {
  const isDev = Boolean(
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production')
  )
  const isStorage = typeof localStorage !== 'undefined'
  return isDev && isStorage && localStorage.getItem('salon_dev_bypass_hours') === 'true'
}

export function setDevTestingMode(enabled) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('salon_dev_bypass_hours', enabled ? 'true' : 'false')
    // Dispatch event so all components react immediately
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('salon_dev_testing_mode_change'))
    }
  }
}

/**
 * Check if the online queue is open based on salon settings and 30-min auto-close rule
 */
export function isOnlineQueueOpen(settings) {
  if (!settings) return false

  // Condition 4: Manual online queue setting must always be respected
  if (!settings.is_online_queue_open) return false

  // Condition 1 & 3: Development Testing Mode override (DEV only)
  // Bypasses operating hours & midnight restriction, but manual setting above was already enforced
  if (isDevTestingMode()) {
    return true
  }

  const now = new Date()
  const istParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now)
  const istHour = Number(istParts.find((p) => p.type === 'hour')?.value ?? 0)
  const istMinute = Number(istParts.find((p) => p.type === 'minute')?.value ?? 0)
  const currentTotalMinutes = istHour * 60 + istMinute

  // Check opening time (e.g. 09:00:00)
  if (settings.opening_time) {
    const [openH, openM] = settings.opening_time.split(':').map(Number)
    const openTotalMinutes = openH * 60 + (openM || 0)
    if (currentTotalMinutes < openTotalMinutes) {
      return false // Salon hasn't opened yet
    }
  }

  // Check 30 minutes before closing time (e.g. 21:00:00 - 30m = 20:30)
  if (settings.closing_time) {
    const [closeH, closeM] = settings.closing_time.split(':').map(Number)
    const closeTotalMinutes = closeH * 60 + (closeM || 0)
    const buffer = settings.auto_close_buffer_minutes ?? 30

    if (currentTotalMinutes >= (closeTotalMinutes - buffer)) {
      return false // Auto-closed for the day
    }
  }

  return true
}

/**
 * Join Queue using the approved database function
 */
export async function joinQueue({ customerName, phoneNumber, serviceIds, preferredBarberId }) {
  // 1. Validation checks
  const trimmedName = (customerName || '').trim()
  if (!trimmedName) {
    return { success: false, error: 'Please enter your name.' }
  }

  const cleanPhone = (phoneNumber || '').trim()
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    return { success: false, error: 'Please enter a valid 10-digit Indian mobile number.' }
  }

  const rawServiceIds = Array.isArray(serviceIds) ? serviceIds : []
  const uniqueServiceIds = [...new Set(rawServiceIds)]
  if (uniqueServiceIds.length !== rawServiceIds.length) {
    return { success: false, error: 'Duplicate services are not allowed.' }
  }
  if (uniqueServiceIds.length === 0) {
    return { success: false, error: 'Please select at least 1 service.' }
  }

  if (uniqueServiceIds.length > 3) {
    return { success: false, error: 'Maximum 3 services can be selected at a time.' }
  }

  // If Supabase is configured, invoke the database RPC function
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('join_queue', {
        p_customer_name: trimmedName,
        p_phone_number: cleanPhone,
        p_service_ids: uniqueServiceIds,
        p_preferred_barber_id: preferredBarberId || null,
      })

      if (error) {
        return { success: false, error: error.message || 'Database error joining queue.' }
      }

      if (data && data.success === false) {
        return { success: false, error: data.error || 'Failed to join queue.' }
      }

      try {
        localStorage.setItem('salon_active_token_id', data.queue_id)
        localStorage.setItem('salon_active_token_number', data.token_number)
        window.dispatchEvent(new Event('salon_local_queue_change'))
      } catch {}

      return {
        success: true,
        queueId: data.queue_id,
        tokenNumber: data.token_number,
        position: data.position,
        totalDuration: data.total_duration,
        totalPrice: data.total_price,
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error joining queue.' }
    }
  }

  // Local Sandbox Implementation (mirrors database safeguards exactly)
  const settings = getLocalStore('settings', INITIAL_SALON_SETTINGS)
  if (!isOnlineQueueOpen(settings)) {
    return { success: false, error: 'Online queue is currently closed.' }
  }

  const queue = getLocalStore('queue_entries', [])

  // Check duplicate active phone
  const activeEntry = queue.find(
    (item) => item.phone_number === cleanPhone && ['waiting', 'called', 'in_chair'].includes(item.status)
  )
  if (activeEntry) {
    return {
      success: false,
      error: 'An active queue entry already exists for this mobile number (Token: ' + activeEntry.token_number + ').'
    }
  }

  // Calculate snapshot of active services
  const allServices = getLocalStore('services', INITIAL_SERVICES)
  const selectedServices = allServices.filter((s) => s.is_active && uniqueServiceIds.includes(s.id))
  if (selectedServices.length !== uniqueServiceIds.length) {
    return { success: false, error: 'One or more selected services are unavailable.' }
  }

  // Validate preferred barber availability when specified
  if (preferredBarberId) {
    const barbers = getReconciledLocalBarbers(queue)
    const prefBarber = barbers.find(
      (b) => b.id === preferredBarberId && b.is_on_duty && b.status !== 'on_break'
    )
    if (!prefBarber) {
      return { success: false, error: 'Selected barber is currently unavailable.' }
    }
  }

  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration_minutes, 0)
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0)

  // Generate sequence token
  let tokenCounter = parseInt(localStorage.getItem('salon_token_counter') || '101', 10)
  const tokenNumber = `T-${tokenCounter}`
  localStorage.setItem('salon_token_counter', (tokenCounter + 1).toString())

  const newId = 'local-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now()

  const newEntry = {
    id: newId,
    token_number: tokenNumber,
    customer_name: trimmedName,
    phone_number: cleanPhone,
    selected_services: selectedServices.map((s) => ({
      id: s.id,
      name_en: s.name_en,
      name_gu: s.name_gu,
      duration: s.duration_minutes,
      price: s.price
    })),
    total_duration: totalDuration,
    total_price: totalPrice,
    preferred_barber_id: preferredBarberId || null,
    assigned_barber_id: null,
    status: 'waiting',
    is_walk_in: false,
    called_at: null,
    service_started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  queue.push(newEntry)
  setLocalStore('queue_entries', queue)

  // Save active token reference in localStorage for convenience
  try {
    localStorage.setItem('salon_active_token_id', newId)
    localStorage.setItem('salon_active_token_number', tokenNumber)
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  const aheadCount = queue.filter(
    (item) =>
      item.status === 'waiting' &&
      isEntryAheadFcfs(item, newEntry) &&
      (!preferredBarberId ||
        item.preferred_barber_id === preferredBarberId ||
        !item.preferred_barber_id)
  ).length

  return {
    success: true,
    queueId: newId,
    tokenNumber: tokenNumber,
    position: aheadCount + 1,
    totalDuration,
    totalPrice,
    isLiveSupabase: false
  }
}

/**
 * Fetch customer's own queue status
 * Privacy-safe: returns only own data via get_my_queue_status RPC.
 * Does not expose other customer records or phone numbers.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchCustomerStatus(queueId) {
  if (!queueId) {
    return { success: false, error: 'Queue ID is required', notFound: true }
  }

  if (isSupabaseConfigured()) {
    if (!UUID_REGEX.test(queueId)) {
      return { success: false, error: 'Token not found', notFound: true }
    }

    try {
      const { data, error } = await supabase.rpc('get_my_queue_status', {
        p_queue_id: queueId
      })

      if (error) {
        return { success: false, error: error.message || 'Token not found', notFound: true }
      }
      if (!data || data.success === false) {
        return { success: false, error: data?.error || 'Token not found', notFound: true }
      }

      // Calculate estimated wait time using shared engine
      const estimatedWaitMinutes = calculateEstimatedWaitTime({
        isForNewCustomer: false,
        customerPosition: data.position,
        preferredBarberId: data.preferred_barber_id,
        waitingEntriesAhead: data.waiting_entries_ahead || [],
        workingBarbers: data.working_barbers || []
      })

      return {
        success: true,
        data: {
          ...data,
          estimated_wait_minutes: estimatedWaitMinutes
        },
        isLiveSupabase: true
      }
    } catch (err) {
      console.warn('Supabase fetchCustomerStatus error:', err)
      return { success: false, error: err.message || 'Token not found' }
    }
  }

  // Local Sandbox implementation
  const queue = getLocalStore('queue_entries', [])
  const entry = queue.find((item) => item.id === queueId || item.token_number === queueId)

  if (!entry) {
    return { success: false, error: 'Token not found' }
  }

  // Barber eligibility position calculation with deterministic (created_at, id) tie-breaking
  let waitingEntriesAhead = []
  if (entry.preferred_barber_id) {
    waitingEntriesAhead = queue
      .filter(
        (item) =>
          item.status === 'waiting' &&
          isEntryAheadFcfs(item, entry) &&
          (item.preferred_barber_id === entry.preferred_barber_id || !item.preferred_barber_id)
      )
      .sort(compareQueueEntriesFcfs)
  } else {
    waitingEntriesAhead = queue
      .filter((item) => item.status === 'waiting' && isEntryAheadFcfs(item, entry))
      .sort(compareQueueEntriesFcfs)
  }

  const position = waitingEntriesAhead.length + 1
  const barbers = getReconciledLocalBarbers(queue)
  const workingBarbers = barbers
    .filter((b) => b.is_on_duty && b.status !== 'on_break')
    .map((b) => {
      if (b.status === 'serving' && b.current_queue_id) {
        const activeEntry = queue.find((item) => item.id === b.current_queue_id)
        if (activeEntry) {
          return {
            ...b,
            service_started_at: activeEntry.service_started_at,
            active_service_duration: activeEntry.total_duration
          }
        }
      }
      return b
    })

  let assignedBarberName = null
  if (entry.assigned_barber_id) {
    const b = barbers.find((b) => b.id === entry.assigned_barber_id)
    if (b) assignedBarberName = b.name
  }

  const estimatedWaitMinutes = calculateEstimatedWaitTime({
    isForNewCustomer: false,
    customerPosition: position,
    preferredBarberId: entry.preferred_barber_id,
    waitingEntriesAhead: waitingEntriesAhead,
    workingBarbers: workingBarbers
  })

  return {
    success: true,
    data: {
      id: entry.id,
      token_number: entry.token_number,
      customer_name: entry.customer_name,
      status: entry.status,
      selected_services: entry.selected_services,
      total_duration: entry.total_duration,
      total_price: entry.total_price,
      position: position,
      preferred_barber_id: entry.preferred_barber_id,
      assigned_barber_id: entry.assigned_barber_id,
      assigned_barber_name: assignedBarberName,
      called_at: entry.called_at,
      created_at: entry.created_at,
      estimated_wait_minutes: estimatedWaitMinutes
    },
    isLiveSupabase: false
  }
}

/**
 * Cancel customer queue spot
 * Enforces Rule 8.1 & 8.2: Can only cancel while status is strictly 'waiting'.
 */
export async function cancelQueueSpot(queueId) {
  if (!queueId) {
    return { success: false, error: 'Queue ID is required' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('cancel_my_queue_spot', {
        p_queue_id: queueId
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to cancel spot' }
      }
      if (data && data.success === false) {
        return { success: false, error: data.error || 'Failed to cancel spot' }
      }

      // Clear local reference
      try {
        localStorage.removeItem('salon_active_token_id')
        localStorage.removeItem('salon_active_token_number')
        window.dispatchEvent(new Event('salon_local_queue_change'))
      } catch {}

      return { success: true, message: data.message || 'Cancelled successfully' }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error cancelling spot' }
    }
  }

  // Local Sandbox implementation
  const queue = getLocalStore('queue_entries', [])
  const entry = queue.find((item) => item.id === queueId || item.token_number === queueId)

  if (!entry) {
    return { success: false, error: 'Queue entry not found' }
  }

  if (entry.status === 'called') {
    return { success: false, error: 'Cannot cancel spot: your turn has already been called.' }
  }
  if (entry.status === 'in_chair') {
    return { success: false, error: 'Cannot cancel spot: service is currently in progress.' }
  }
  if (entry.status === 'done') {
    return { success: false, error: 'Cannot cancel spot: service is already completed.' }
  }
  if (entry.status === 'cancelled') {
    return { success: false, error: 'This queue spot has already been cancelled.' }
  }
  if (entry.status === 'no_show') {
    return { success: false, error: 'Cannot cancel spot: entry was marked as no-show.' }
  }
  if (entry.status !== 'waiting') {
    return { success: false, error: 'Cannot cancel spot: entry is not in waiting status.' }
  }

  entry.status = 'cancelled'
  entry.updated_at = new Date().toISOString()
  setLocalStore('queue_entries', queue)

  try {
    localStorage.removeItem('salon_active_token_id')
    localStorage.removeItem('salon_active_token_number')
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, message: 'Your queue spot has been cancelled successfully.' }
}

/**
 * Subscribe to real-time database changes
 * Uses zero-payload Realtime Broadcast channel (No PII) with heartbeat polling fallback.
 */
export function subscribeToSalonUpdates(onUpdate, onStatusChange) {
  if (isSupabaseConfigured()) {
    // 1. Zero-data Realtime Broadcast channel
    const channel = supabase
      .channel('salon-public-updates')
      .on('broadcast', { event: 'salon_changed' }, () => onUpdate())
      .subscribe((status) => {
        if (onStatusChange) onStatusChange(status)
      })

    // 2. 5-second polling interval as heartbeat fallback
    const interval = setInterval(onUpdate, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }

  if (onStatusChange) {
    onStatusChange('LOCAL')
  }

  // Local storage event listener for cross-tab sync in sandbox
  const handleStorage = (e) => {
    if (e.key && e.key.startsWith('salon_')) {
      onUpdate()
    }
  }
  window.addEventListener('storage', handleStorage)
  window.addEventListener('salon_dev_testing_mode_change', onUpdate)
  window.addEventListener('salon_local_queue_change', onUpdate)

  const interval = setInterval(onUpdate, 5000)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener('salon_dev_testing_mode_change', onUpdate)
    window.removeEventListener('salon_local_queue_change', onUpdate)
    clearInterval(interval)
  }
}

// ==============================================================================
// STAGE 4: RECEPTION DASHBOARD & STAFF SESSION SERVICES
// ==============================================================================

const STAFF_SESSION_KEY_PREFIX = 'salon_staff_session_'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOCAL_DEFAULT_PINS = {
  reception: '1234',
  admin: '9999'
}

function saveStaffSession(role, sessionToken, expiresAt) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      `${STAFF_SESSION_KEY_PREFIX}${role}`,
      JSON.stringify({ sessionToken, role, expiresAt })
    )
  } catch {}
}

export function getStaffSession(role) {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`${STAFF_SESSION_KEY_PREFIX}${role}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.sessionToken || !parsed?.expiresAt || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(`${STAFF_SESSION_KEY_PREFIX}${role}`)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearStaffSession(role) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(`${STAFF_SESSION_KEY_PREFIX}${role}`)
  } catch {}
}

function validateLocalStaffSession(sessionToken, allowedRoles = ['reception', 'admin']) {
  if (!sessionToken) {
    return { valid: false, error: 'Unauthorized: Invalid or expired staff session' }
  }
  const sessions = getLocalStore('staff_sessions', [])
  const match = sessions.find((s) => s.session_token === sessionToken)
  if (!match || !allowedRoles.includes(match.role) || new Date(match.expires_at).getTime() <= Date.now()) {
    return { valid: false, error: 'Unauthorized: Invalid or expired staff session' }
  }
  return { valid: true, session: match }
}

/**
 * Verify Staff PIN (reception or admin)
 * Issues a 12-hour session token with 5-attempt / 15-minute lockout.
 */
export async function verifyStaffPin(role, pin) {
  if (!['reception', 'admin'].includes(role)) {
    return { success: false, error: 'Invalid role requested' }
  }
  const cleanPin = (pin || '').trim()
  if (!cleanPin) {
    return { success: false, error: 'Please enter your PIN.' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('verify_staff_pin', {
        p_role: role,
        p_pin: cleanPin
      })

      if (error) {
        return { success: false, error: error.message || 'PIN verification failed.' }
      }
      if (!data || data.success === false) {
        return { success: false, error: data?.error || 'Incorrect PIN.' }
      }

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
      saveStaffSession(role, data.session_token, expiresAt)
      return {
        success: true,
        sessionToken: data.session_token,
        role: data.role,
        expiresAt,
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error verifying PIN.' }
    }
  }

  // Local Sandbox PIN verification + lockout mirror
  const now = Date.now()
  const fifteenMinsAgo = now - 15 * 60 * 1000
  const attempts = getLocalStore('pin_attempt_log', [])
  const recentFailures = attempts.filter(
    (a) => a.role === role && !a.success && new Date(a.attempted_at).getTime() > fifteenMinsAgo
  )

  if (recentFailures.length >= 5) {
    return { success: false, error: 'Too many failed attempts. Locked out for 15 minutes.' }
  }

  const security = getLocalStore('security', {
    reception_pin: LOCAL_DEFAULT_PINS.reception,
    admin_pin: LOCAL_DEFAULT_PINS.admin
  })
  const expectedPin = role === 'reception' ? security.reception_pin : security.admin_pin
  const isValid = cleanPin === expectedPin

  attempts.push({ role, success: isValid, attempted_at: new Date(now).toISOString() })
  setLocalStore('pin_attempt_log', attempts)

  if (!isValid) {
    return { success: false, error: 'Incorrect PIN' }
  }

  const sessionToken =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-sess-${Math.random().toString(36).substring(2, 12)}-${now}`
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString()

  const sessions = getLocalStore('staff_sessions', [])
  sessions.push({ session_token: sessionToken, role, expires_at: expiresAt })
  setLocalStore('staff_sessions', sessions)
  saveStaffSession(role, sessionToken, expiresAt)

  return {
    success: true,
    sessionToken,
    role,
    expiresAt,
    isLiveSupabase: false
  }
}

/**
 * Fetch full Reception Dashboard state (barber stations + ordered waiting queue)
 * Strictly protected by staff session token.
 */
export async function fetchReceptionDashboard(sessionToken) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_reception_dashboard', {
        p_session_token: sessionToken
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to load reception dashboard.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to load reception dashboard.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }

      return {
        success: true,
        barbers: data.barbers || [],
        waitingQueue: data.waiting_queue || [],
        serverNow: data.server_now || new Date().toISOString(),
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error loading dashboard.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['reception', 'admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const queue = getLocalStore('queue_entries', [])
  const barbersRaw = getReconciledLocalBarbers(queue)

  const barbers = barbersRaw.map((b) => {
    const currentCustomer = b.current_queue_id
      ? queue.find((q) => q.id === b.current_queue_id) || null
      : null
    return {
      ...b,
      current_customer: currentCustomer
    }
  })

  const waitingQueue = queue
    .filter((q) => q.status === 'waiting')
    .sort(compareQueueEntriesFcfs)

  return {
    success: true,
    barbers,
    waitingQueue,
    serverNow: new Date().toISOString(),
    isLiveSupabase: false
  }
}

/**
 * Atomically call next eligible waiting customer for a barber
 */
export async function callNextCustomer(sessionToken, barberId) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }
  if (!barberId) {
    return { success: false, error: 'Barber ID is required' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('call_next_customer', {
        p_session_token: sessionToken,
        p_barber_id: barberId
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to call next customer.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to call next customer.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }

      return {
        success: true,
        customerId: data.customer_id,
        tokenNumber: data.token_number,
        customerName: data.customer_name,
        barberName: data.barber_name
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error calling next customer.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['reception', 'admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const barbers = getReconciledLocalBarbers()
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) {
    return { success: false, error: 'Barber not found' }
  }
  if (!barber.is_on_duty) {
    return { success: false, error: 'Barber is off duty' }
  }
  if (barber.status !== 'available') {
    return { success: false, error: `Barber is currently ${barber.status}` }
  }

  const queue = getLocalStore('queue_entries', [])
  const alreadyAssigned = queue.find(
    (q) => q.assigned_barber_id === barberId && ['called', 'in_chair'].includes(q.status)
  )
  if (alreadyAssigned || barber.current_queue_id) {
    return { success: false, error: 'Barber already has an active customer' }
  }

  const eligibleWaiting = queue
    .filter(
      (q) =>
        q.status === 'waiting' &&
        (q.preferred_barber_id === barberId || !q.preferred_barber_id)
    )
    .sort(compareQueueEntriesFcfs)

  if (eligibleWaiting.length === 0) {
    return { success: false, error: 'No eligible customers waiting' }
  }

  const nextCustomer = eligibleWaiting[0]
  const nowIso = new Date().toISOString()

  nextCustomer.status = 'called'
  nextCustomer.assigned_barber_id = barberId
  nextCustomer.called_at = nowIso
  nextCustomer.updated_at = nowIso

  barber.status = 'serving'
  barber.current_queue_id = nextCustomer.id
  barber.updated_at = nowIso

  setLocalStore('queue_entries', queue)
  setLocalStore('barbers', barbers)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return {
    success: true,
    customerId: nextCustomer.id,
    tokenNumber: nextCustomer.token_number,
    customerName: nextCustomer.customer_name,
    barberName: barber.name
  }
}

/**
 * Add Walk-in Customer (Receptionist only)
 * Remains available even when online joining is closed (Rule 9.3).
 * Never sends prices or durations to the database; DB calculates from services table.
 */
export async function addWalkInCustomer(sessionToken, { customerName, phoneNumber, serviceIds, preferredBarberId }) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }

  const trimmedName = (customerName || '').trim()
  if (!trimmedName) {
    return { success: false, error: 'Please enter customer name.' }
  }

  const cleanPhone = (phoneNumber || '').trim()
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    return { success: false, error: 'Please enter a valid 10-digit Indian mobile number.' }
  }

  const rawServiceIds = Array.isArray(serviceIds) ? serviceIds : []
  const uniqueServiceIds = [...new Set(rawServiceIds)]
  if (uniqueServiceIds.length !== rawServiceIds.length) {
    return { success: false, error: 'Duplicate services are not allowed.' }
  }
  if (uniqueServiceIds.length === 0 || uniqueServiceIds.length > 3) {
    return { success: false, error: 'You must select between 1 and 3 services.' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('add_walkin_customer', {
        p_session_token: sessionToken,
        p_customer_name: trimmedName,
        p_phone_number: cleanPhone,
        p_service_ids: uniqueServiceIds,
        p_preferred_barber_id: preferredBarberId || null
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to add walk-in customer.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to add walk-in customer.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }

      return {
        success: true,
        queueId: data.queue_id,
        tokenNumber: data.token_number,
        position: data.position,
        totalDuration: data.total_duration,
        totalPrice: data.total_price,
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error adding walk-in.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['reception', 'admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const queue = getLocalStore('queue_entries', [])
  const activeEntry = queue.find(
    (item) => item.phone_number === cleanPhone && ['waiting', 'called', 'in_chair'].includes(item.status)
  )
  if (activeEntry) {
    return {
      success: false,
      error: `An active queue entry already exists for this mobile number (Token: ${activeEntry.token_number}).`
    }
  }

  const allServices = getLocalStore('services', INITIAL_SERVICES)
  const selectedServices = allServices.filter((s) => s.is_active && uniqueServiceIds.includes(s.id))
  if (selectedServices.length !== uniqueServiceIds.length) {
    return { success: false, error: 'One or more selected services are unavailable.' }
  }

  if (preferredBarberId) {
    const barbers = getReconciledLocalBarbers(queue)
    const prefBarber = barbers.find(
      (b) => b.id === preferredBarberId && b.is_on_duty && b.status !== 'on_break'
    )
    if (!prefBarber) {
      return { success: false, error: 'Selected barber is currently unavailable.' }
    }
  }

  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration_minutes, 0)
  const totalPrice = selectedServices.reduce((sum, s) => sum + Number(s.price), 0)

  let tokenCounter = parseInt(localStorage.getItem('salon_token_counter') || '101', 10)
  const tokenNumber = `T-${tokenCounter}`
  localStorage.setItem('salon_token_counter', (tokenCounter + 1).toString())

  const newId = `local-${Math.random().toString(36).substring(2, 11)}-${Date.now()}`
  const nowIso = new Date().toISOString()

  const newEntry = {
    id: newId,
    token_number: tokenNumber,
    customer_name: trimmedName,
    phone_number: cleanPhone,
    selected_services: selectedServices.map((s) => ({
      id: s.id,
      name_en: s.name_en,
      name_gu: s.name_gu,
      duration: s.duration_minutes,
      price: s.price
    })),
    total_duration: totalDuration,
    total_price: totalPrice,
    preferred_barber_id: preferredBarberId || null,
    assigned_barber_id: null,
    status: 'waiting',
    is_walk_in: true,
    called_at: null,
    service_started_at: null,
    completed_at: null,
    created_at: nowIso,
    updated_at: nowIso
  }

  queue.push(newEntry)
  setLocalStore('queue_entries', queue)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  const waitingCount = queue.filter((q) => q.status === 'waiting').length
  return {
    success: true,
    queueId: newId,
    tokenNumber,
    position: waitingCount,
    totalDuration,
    totalPrice,
    isLiveSupabase: false
  }
}

/**
 * Receptionist cancels a waiting queue entry
 */
export async function cancelQueueEntryByReception(sessionToken, queueId) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }
  if (!queueId) {
    return { success: false, error: 'Queue ID is required' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('reception_cancel_entry', {
        p_session_token: sessionToken,
        p_queue_id: queueId
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to cancel queue entry.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to cancel queue entry.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }

      return { success: true, message: data.message }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error cancelling entry.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['reception', 'admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const queue = getLocalStore('queue_entries', [])
  const entry = queue.find((item) => item.id === queueId)
  if (!entry) {
    return { success: false, error: 'Queue entry not found' }
  }
  if (entry.status !== 'waiting') {
    return { success: false, error: 'Only waiting queue entries can be cancelled.' }
  }

  entry.status = 'cancelled'
  entry.updated_at = new Date().toISOString()
  setLocalStore('queue_entries', queue)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, message: 'Queue entry cancelled successfully.' }
}

/**
 * Receptionist marks a Called customer as No-Show after 10 minutes (Rule 8.3)
 * Only frees the barber if current_queue_id still matches this customer.
 */
export async function markCustomerNoShow(sessionToken, queueId) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }
  if (!queueId) {
    return { success: false, error: 'Queue ID is required' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('reception_mark_noshow', {
        p_session_token: sessionToken,
        p_queue_id: queueId
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to mark as no-show.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to mark as no-show.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }

      return { success: true, message: data.message }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error marking no-show.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['reception', 'admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const queue = getLocalStore('queue_entries', [])
  const entry = queue.find((item) => item.id === queueId)
  if (!entry) {
    return { success: false, error: 'Queue entry not found' }
  }
  if (entry.status !== 'called') {
    return { success: false, error: 'Only called customers can be marked as no-show.' }
  }

  const tenMinutesMs = 10 * 60 * 1000
  if (!entry.called_at || Date.now() - new Date(entry.called_at).getTime() < tenMinutesMs) {
    return {
      success: false,
      error: 'Customer can only be marked as no-show after 10 minutes of being called.'
    }
  }

  const nowIso = new Date().toISOString()
  entry.status = 'no_show'
  entry.updated_at = nowIso
  setLocalStore('queue_entries', queue)

  if (entry.assigned_barber_id) {
    const barbers = getReconciledLocalBarbers(queue)
    const barber = barbers.find(
      (b) => b.id === entry.assigned_barber_id && b.current_queue_id === queueId
    )
    if (barber) {
      barber.status = 'available'
      barber.current_queue_id = null
      barber.updated_at = nowIso
      setLocalStore('barbers', barbers)
    }
  }

  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, message: 'Customer marked as no-show and barber freed.' }
}

// ==============================================================================
// STAGE 5: BARBER VIEW, ADMIN BARBER PIN PROVISIONING & WAITING AREA TV DISPLAY
// ==============================================================================

// Local-sandbox-only testing PINs (never seeded into live Supabase)
const LOCAL_SANDBOX_BARBER_PINS = {
  amit: '1111',
  rahul: '2222',
  priya: '3333'
}

function hashLocalPin(pin, salt) {
  const input = `${salt}:${pin}`
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0
  }
  return `sb$${salt}$${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

function verifyLocalPinHash(pin, storedHash) {
  if (!storedHash || !storedHash.startsWith('sb$')) return false
  const parts = storedHash.split('$')
  if (parts.length !== 3) return false
  return hashLocalPin(pin, parts[1]) === storedHash
}

function getBarberSessionKey(barberName) {
  return `${STAFF_SESSION_KEY_PREFIX}barber_${(barberName || '').trim().toLowerCase()}`
}

export function getBarberSession(barberName) {
  if (typeof sessionStorage === 'undefined' || !barberName) return null
  try {
    const raw = sessionStorage.getItem(getBarberSessionKey(barberName))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      !parsed?.sessionToken ||
      parsed.role !== 'barber' ||
      !parsed.barberId ||
      !parsed.expiresAt ||
      new Date(parsed.expiresAt).getTime() <= Date.now()
    ) {
      sessionStorage.removeItem(getBarberSessionKey(barberName))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearBarberSession(barberName) {
  if (typeof sessionStorage === 'undefined' || !barberName) return
  try {
    sessionStorage.removeItem(getBarberSessionKey(barberName))
  } catch {}
}

function saveBarberSession(barberName, { sessionToken, barberId, expiresAt }) {
  if (typeof sessionStorage === 'undefined' || !barberName) return
  try {
    sessionStorage.setItem(
      getBarberSessionKey(barberName),
      JSON.stringify({ sessionToken, role: 'barber', barberId, barberName, expiresAt })
    )
  } catch {}
}

function validateLocalBarberSession(sessionToken, targetBarberId) {
  if (!sessionToken || !targetBarberId) {
    return { valid: false, error: 'Unauthorized: Invalid or expired barber session' }
  }
  const sessions = getLocalStore('staff_sessions', [])
  const match = sessions.find(
    (s) =>
      s.session_token === sessionToken &&
      s.role === 'barber' &&
      s.barber_id === targetBarberId &&
      new Date(s.expires_at).getTime() > Date.now()
  )
  if (!match) {
    return { valid: false, error: 'Unauthorized: Invalid or expired barber session' }
  }
  return { valid: true, session: match }
}

/**
 * Fetch all barber station names/statuses for station switcher
 */
export async function fetchAllBarbers() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('barbers')
        .select('id, name, is_on_duty, status')
        .order('created_at', { ascending: true })
        .order('name', { ascending: true })
      if (error) throw error
      return { success: true, data: data || [], isLiveSupabase: true }
    } catch (err) {
      console.warn('Supabase all barbers query failed:', err.message)
    }
  }
  const barbers = getReconciledLocalBarbers()
  return {
    success: true,
    data: barbers.map(({ id, name, is_on_duty, status }) => ({ id, name, is_on_duty, status })),
    isLiveSupabase: false
  }
}

/**
 * Owner/Admin Barber PIN Provisioning
 * Requires valid, unexpired 'admin' session. Never stores or returns plain-text PIN/hash.
 */
export async function setBarberPinByAdmin(sessionToken, barberId, pin) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }
  if (!barberId) {
    return { success: false, error: 'Barber ID is required' }
  }
  const cleanPin = (pin || '').trim()
  if (!/^[0-9]{4,6}$/.test(cleanPin)) {
    return { success: false, error: 'Barber PIN must be 4 to 6 numeric digits' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('admin_set_barber_pin', {
        p_session_token: sessionToken,
        p_barber_id: barberId,
        p_pin: cleanPin
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to update barber PIN.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to update barber PIN.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, barberId: data.barber_id, message: data.message }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error updating barber PIN.' }
    }
  }

  // Local Sandbox admin session check (strictly role === 'admin')
  const auth = validateLocalStaffSession(sessionToken, ['admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const barbers = getReconciledLocalBarbers()
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) {
    return { success: false, error: 'Barber not found' }
  }

  const salt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const pinHash = hashLocalPin(cleanPin, salt)
  const securityRows = getLocalStore('barber_security', [])
  const existingIdx = securityRows.findIndex((r) => r.barber_id === barberId)
  const record = { barber_id: barberId, pin_hash: pinHash, updated_at: new Date().toISOString() }
  if (existingIdx >= 0) {
    securityRows[existingIdx] = record
  } else {
    securityRows.push(record)
  }
  setLocalStore('barber_security', securityRows)

  // Invalidate any existing barber sessions for this barber after PIN rotation
  const sessions = getLocalStore('staff_sessions', [])
  const remaining = sessions.filter((s) => !(s.role === 'barber' && s.barber_id === barberId))
  setLocalStore('staff_sessions', remaining)
  clearBarberSession(barber.name)

  return {
    success: true,
    barberId,
    message: 'Barber PIN updated successfully.'
  }
}

/**
 * Verify Barber PIN (issues 12-hour session bound to that barber_id)
 */
export async function verifyBarberPin(barberName, pin) {
  const cleanName = (barberName || '').trim()
  const cleanPin = (pin || '').trim()
  if (!cleanName) {
    return { success: false, error: 'Barber name is required' }
  }
  if (!cleanPin) {
    return { success: false, error: 'Please enter your PIN.' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('verify_barber_pin', {
        p_barber_name: cleanName,
        p_pin: cleanPin
      })
      if (error) {
        return { success: false, error: error.message || 'PIN verification failed.' }
      }
      if (!data || data.success === false) {
        return { success: false, error: data?.error || 'Incorrect PIN' }
      }

      const expiresAt = data.expires_at || new Date(Date.now() + SESSION_TTL_MS).toISOString()
      saveBarberSession(data.barber_name || cleanName, {
        sessionToken: data.session_token,
        barberId: data.barber_id,
        expiresAt
      })

      return {
        success: true,
        sessionToken: data.session_token,
        role: 'barber',
        barberId: data.barber_id,
        barberName: data.barber_name || cleanName,
        expiresAt,
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error verifying PIN.' }
    }
  }

  // Local Sandbox Barber PIN verification
  const barbers = getReconciledLocalBarbers()
  const barber = barbers.find((b) => b.name.trim().toLowerCase() === cleanName.toLowerCase())
  if (!barber) {
    return { success: false, error: 'Barber not found' }
  }

  const now = Date.now()
  const fifteenMinsAgo = now - 15 * 60 * 1000
  const rateKey = `barber:${barber.id}`
  const attempts = getLocalStore('pin_attempt_log', [])
  const recentFailures = attempts.filter(
    (a) => a.role === rateKey && !a.success && new Date(a.attempted_at).getTime() > fifteenMinsAgo
  )
  if (recentFailures.length >= 5) {
    return { success: false, error: 'Too many failed attempts. Locked out for 15 minutes.' }
  }

  const securityRows = getLocalStore('barber_security', [])
  const secRow = securityRows.find((r) => r.barber_id === barber.id)
  let isValid = false
  if (secRow) {
    isValid = verifyLocalPinHash(cleanPin, secRow.pin_hash)
  } else {
    const sandboxDefault = LOCAL_SANDBOX_BARBER_PINS[barber.name.trim().toLowerCase()]
    isValid = Boolean(sandboxDefault && cleanPin === sandboxDefault)
  }

  attempts.push({ role: rateKey, success: isValid, attempted_at: new Date(now).toISOString() })
  setLocalStore('pin_attempt_log', attempts)

  if (!isValid) {
    return { success: false, error: 'Incorrect PIN' }
  }

  const sessionToken =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-barber-sess-${Math.random().toString(36).substring(2, 12)}-${now}`
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString()

  const sessions = getLocalStore('staff_sessions', [])
  sessions.push({ session_token: sessionToken, role: 'barber', barber_id: barber.id, expires_at: expiresAt })
  setLocalStore('staff_sessions', sessions)

  saveBarberSession(barber.name, { sessionToken, barberId: barber.id, expiresAt })

  return {
    success: true,
    sessionToken,
    role: 'barber',
    barberId: barber.id,
    barberName: barber.name,
    expiresAt,
    isLiveSupabase: false
  }
}

/**
 * Lock Barber Station: invalidates server/sandbox staff_sessions row AND clears sessionStorage
 */
export async function logoutBarberSession(sessionToken, barberId, barberName) {
  if (!sessionToken || !barberId) {
    clearBarberSession(barberName)
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired barber session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('logout_barber_session', {
        p_session_token: sessionToken,
        p_barber_id: barberId
      })
      clearBarberSession(barberName)
      if (error) {
        return { success: false, error: error.message || 'Logout failed.' }
      }
      if (!data || data.success === false) {
        return { success: false, unauthorized: true, error: data?.error || 'Unauthorized: Invalid or expired barber session' }
      }
      return { success: true, message: data.message }
    } catch (err) {
      clearBarberSession(barberName)
      return { success: false, error: err.message || 'Connection error locking station.' }
    }
  }

  const sessions = getLocalStore('staff_sessions', [])
  const idx = sessions.findIndex(
    (s) =>
      s.session_token === sessionToken &&
      s.role === 'barber' &&
      s.barber_id === barberId &&
      new Date(s.expires_at).getTime() > Date.now()
  )
  clearBarberSession(barberName)
  if (idx === -1) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired barber session' }
  }
  sessions.splice(idx, 1)
  setLocalStore('staff_sessions', sessions)
  return { success: true, message: 'Barber station locked successfully.' }
}

/**
 * Fetch Barber View (Strictly requires valid 'barber' session authorized for that barber)
 */
export async function fetchBarberView(sessionToken, barberName) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired barber session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_barber_view', {
        p_session_token: sessionToken,
        p_barber_name: barberName || null
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to load barber view.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to load barber view.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return {
        success: true,
        barber: data.barber,
        currentCustomer: data.current_customer || null,
        nextCustomer: data.next_customer || null,
        serverNow: data.server_now || new Date().toISOString(),
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error loading barber view.' }
    }
  }

  const queue = getLocalStore('queue_entries', [])
  const barbers = getReconciledLocalBarbers(queue)
  const barber = barberName
    ? barbers.find((b) => b.name.trim().toLowerCase() === barberName.trim().toLowerCase())
    : barbers[0]

  if (!barber) {
    return { success: false, error: 'Barber not found' }
  }

  const auth = validateLocalBarberSession(sessionToken, barber.id)
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  let currentCustomer = null
  if (barber.current_queue_id) {
    const match = queue.find(
      (q) =>
        q.id === barber.current_queue_id &&
        q.assigned_barber_id === barber.id &&
        ['called', 'in_chair'].includes(q.status)
    )
    if (match) {
      currentCustomer = {
        id: match.id,
        token_number: match.token_number,
        customer_name: match.customer_name,
        selected_services: match.selected_services,
        total_duration: match.total_duration,
        status: match.status,
        called_at: match.called_at,
        service_started_at: match.service_started_at,
        created_at: match.created_at
      }
    }
  }

  const nextMatch = queue
    .filter(
      (q) =>
        q.status === 'waiting' &&
        (q.preferred_barber_id === barber.id || !q.preferred_barber_id)
    )
    .sort(compareQueueEntriesFcfs)[0]

  const nextCustomer = nextMatch
    ? {
        token_number: nextMatch.token_number,
        customer_name: nextMatch.customer_name,
        total_duration: nextMatch.total_duration
      }
    : null

  return {
    success: true,
    barber: {
      id: barber.id,
      name: barber.name,
      is_on_duty: barber.is_on_duty,
      status: barber.status,
      current_queue_id: barber.current_queue_id || null
    },
    currentCustomer,
    nextCustomer,
    serverNow: new Date().toISOString(),
    isLiveSupabase: false
  }
}

/**
 * Barber Start Service (called -> in_chair)
 */
export async function startBarberService(sessionToken, barberId, queueId) {
  if (!sessionToken || !barberId || !queueId) {
    return { success: false, unauthorized: !sessionToken, error: 'Unauthorized: Invalid or expired barber session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('barber_start_service', {
        p_session_token: sessionToken,
        p_barber_id: barberId,
        p_queue_id: queueId
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to start service.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to start service.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, status: data.status, serviceStartedAt: data.service_started_at }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error starting service.' }
    }
  }

  const auth = validateLocalBarberSession(sessionToken, barberId)
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const queue = getLocalStore('queue_entries', [])
  const barbers = getReconciledLocalBarbers(queue)
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) return { success: false, error: 'Barber not found' }
  if (!barber.is_on_duty) return { success: false, error: 'Barber is currently off duty' }
  if (barber.current_queue_id !== queueId) {
    return { success: false, error: 'This customer is not currently assigned to the barber' }
  }

  const entry = queue.find((q) => q.id === queueId)
  if (!entry) return { success: false, error: 'Queue entry not found' }
  if (entry.assigned_barber_id !== barberId) {
    return { success: false, error: 'Customer is assigned to a different barber' }
  }
  if (entry.status !== 'called') {
    return { success: false, error: 'Only a called customer can be started in chair' }
  }
  const alreadyServing = queue.some(
    (q) => q.assigned_barber_id === barberId && q.status === 'in_chair' && q.id !== queueId
  )
  if (alreadyServing) {
    return { success: false, error: 'Barber is already serving another customer' }
  }

  const nowIso = new Date().toISOString()
  entry.status = 'in_chair'
  entry.service_started_at = nowIso
  entry.updated_at = nowIso

  barber.status = 'serving'
  barber.updated_at = nowIso

  setLocalStore('queue_entries', queue)
  setLocalStore('barbers', barbers)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, status: 'in_chair', serviceStartedAt: nowIso }
}

/**
 * Barber Complete Service (in_chair -> done)
 * Preserves off-duty state if is_on_duty === false; guards current_queue_id release.
 */
export async function completeBarberService(sessionToken, barberId, queueId) {
  if (!sessionToken || !barberId || !queueId) {
    return { success: false, unauthorized: !sessionToken, error: 'Unauthorized: Invalid or expired barber session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('barber_complete_service', {
        p_session_token: sessionToken,
        p_barber_id: barberId,
        p_queue_id: queueId
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to complete service.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to complete service.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, status: data.status, completedAt: data.completed_at }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error completing service.' }
    }
  }

  const auth = validateLocalBarberSession(sessionToken, barberId)
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const queue = getLocalStore('queue_entries', [])
  const barbers = getReconciledLocalBarbers(queue)
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) return { success: false, error: 'Barber not found' }
  if (barber.current_queue_id !== queueId) {
    return { success: false, error: 'This customer is not currently assigned to the barber' }
  }

  const entry = queue.find((q) => q.id === queueId)
  if (!entry) return { success: false, error: 'Queue entry not found' }
  if (entry.assigned_barber_id !== barberId) {
    return { success: false, error: 'Customer is assigned to a different barber' }
  }
  if (entry.status !== 'in_chair') {
    return { success: false, error: 'Only a customer currently in chair can be marked as done' }
  }

  const nowIso = new Date().toISOString()
  entry.status = 'done'
  entry.completed_at = nowIso
  entry.updated_at = nowIso

  if (barber.current_queue_id === queueId) {
    barber.status = barber.is_on_duty ? 'available' : 'on_break'
    barber.current_queue_id = null
    barber.updated_at = nowIso
  }

  setLocalStore('queue_entries', queue)
  setLocalStore('barbers', barbers)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, status: 'done', completedAt: nowIso }
}

/**
 * Barber Availability Toggle (available <-> on_break)
 */
export async function setBarberAvailability(sessionToken, barberId, newStatus) {
  if (!sessionToken || !barberId) {
    return { success: false, unauthorized: !sessionToken, error: 'Unauthorized: Invalid or expired barber session' }
  }
  if (!['available', 'on_break'].includes(newStatus)) {
    return { success: false, error: 'Invalid availability status requested' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('barber_set_availability', {
        p_session_token: sessionToken,
        p_barber_id: barberId,
        p_new_status: newStatus
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to update availability.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to update availability.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, status: data.status }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error updating availability.' }
    }
  }

  const auth = validateLocalBarberSession(sessionToken, barberId)
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: auth.error }
  }

  const barbers = getReconciledLocalBarbers()
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) return { success: false, error: 'Barber not found' }
  if (!barber.is_on_duty) return { success: false, error: 'Barber is currently off duty' }
  if (barber.status === 'serving' || barber.current_queue_id) {
    return { success: false, error: 'Cannot change break status while an active customer is assigned' }
  }

  barber.status = newStatus
  barber.updated_at = new Date().toISOString()
  setLocalStore('barbers', barbers)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, status: newStatus }
}

/**
 * Fetch Privacy-Safe Waiting Area TV Display Feed
 * Minimum display data only: never includes customer names, phone numbers, or IDs.
 */
export async function fetchTVDisplay() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_tv_display')
      if (error) {
        return { success: false, error: error.message || 'Failed to load TV display.' }
      }
      if (!data || data.success === false) {
        return { success: false, error: data?.error || 'Failed to load TV display.' }
      }
      return {
        success: true,
        salonNameEn: data.salon_name_en || 'Royal Crown Salon',
        salonNameGu: data.salon_name_gu || 'રોયલ ક્રાઉન સલૂન',
        chairs: data.chairs || [],
        nextTokens: data.next_tokens || [],
        waitingCount: data.waiting_count || 0,
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error loading TV display.' }
    }
  }

  const settings = getLocalStore('settings', INITIAL_SALON_SETTINGS)
  const queue = getLocalStore('queue_entries', [])
  const barbers = getReconciledLocalBarbers(queue)

  const chairs = barbers
    .filter((b) => b.is_on_duty)
    .map((b) => {
      const active = b.current_queue_id
        ? queue.find((q) => q.id === b.current_queue_id && ['called', 'in_chair'].includes(q.status))
        : null
      return {
        barber_name: b.name,
        barber_status: b.status,
        current_token: active ? active.token_number : null,
        token_status: active ? active.status : null
      }
    })

  const waitingSorted = queue
    .filter((q) => q.status === 'waiting')
    .sort(compareQueueEntriesFcfs)

  const nextTokens = waitingSorted.slice(0, 5).map((q) => q.token_number)

  return {
    success: true,
    salonNameEn: settings.salon_name_en || 'Royal Crown Salon',
    salonNameGu: settings.salon_name_gu || 'રોયલ ક્રાઉન સલૂન',
    chairs,
    nextTokens,
    waitingCount: waitingSorted.length,
    isLiveSupabase: false
  }
}

// ==============================================================================
// STAGE 6: OWNER SETTINGS (/admin) SERVICES & STATISTICS
// ==============================================================================

function getIstCalendarDateKey(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)
}

function normalizeTimeValue(timeStr) {
  const parts = String(timeStr || '').trim().split(':')
  if (parts.length < 2) return null
  const hh = Number(parts[0])
  const mm = Number(parts[1])
  const ss = parts[2] !== undefined ? Number(parts[2]) : 0
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || !Number.isInteger(ss)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/**
 * Staff Session Logout (Admin & Reception exception)
 * Strictly validates that p_session_token belongs to p_role and invalidates only that token.
 */
export async function logoutStaffSession(sessionToken, role) {
  if (!sessionToken || !['reception', 'admin'].includes(role)) {
    clearStaffSession(role)
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('logout_staff_session', {
        p_session_token: sessionToken,
        p_role: role
      })
      clearStaffSession(role)
      if (error) {
        return { success: false, error: error.message || 'Logout failed.' }
      }
      if (!data || data.success === false) {
        return {
          success: false,
          unauthorized: true,
          error: data?.error || 'Unauthorized: Invalid or expired staff session'
        }
      }
      return { success: true, message: data.message }
    } catch (err) {
      clearStaffSession(role)
      return { success: false, error: err.message || 'Connection error logging out.' }
    }
  }

  const sessions = getLocalStore('staff_sessions', [])
  const idx = sessions.findIndex(
    (s) =>
      s.session_token === sessionToken &&
      s.role === role &&
      new Date(s.expires_at).getTime() > Date.now()
  )
  clearStaffSession(role)
  if (idx === -1) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired staff session' }
  }
  sessions.splice(idx, 1)
  setLocalStore('staff_sessions', sessions)
  return { success: true, message: 'Staff session locked successfully.' }
}

/**
 * Fetch Owner/Admin Dashboard (settings, all services, all barbers with has_pin, IST stats)
 */
export async function fetchAdminDashboard(sessionToken) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_admin_dashboard', {
        p_session_token: sessionToken
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to load admin dashboard.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to load admin dashboard.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return {
        success: true,
        settings: data.settings,
        services: data.services || [],
        barbers: data.barbers || [],
        stats: data.stats || {},
        isLiveSupabase: true
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error loading admin dashboard.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const settings = getLocalStore('settings', INITIAL_SALON_SETTINGS)
  const services = [...getLocalStore('services', INITIAL_SERVICES)].sort(
    (a, b) => (a.display_order || 0) - (b.display_order || 0)
  )
  const queue = getLocalStore('queue_entries', [])
  const barbersRaw = getReconciledLocalBarbers(queue)
  const barberSecurity = getLocalStore('barber_security', [])

  const barbers = barbersRaw.map((b) => ({
    id: b.id,
    name: b.name,
    is_on_duty: b.is_on_duty,
    status: b.status,
    current_queue_id: b.current_queue_id || null,
    has_pin: barberSecurity.some((sec) => sec.barber_id === b.id)
  }))

  const todayIst = getIstCalendarDateKey(new Date())
  const todayEntries = queue.filter((q) => getIstCalendarDateKey(q.created_at) === todayIst)
  const doneToday = todayEntries.filter((q) => q.status === 'done')
  const calledToday = todayEntries.filter((q) => Boolean(q.called_at))

  const avgWaitMinutesToday =
    calledToday.length > 0
      ? Math.round(
          calledToday.reduce((sum, q) => {
            const diffMin = Math.max(0, (new Date(q.called_at).getTime() - new Date(q.created_at).getTime()) / 60000)
            return sum + diffMin
          }, 0) / calledToday.length
        )
      : 0

  const stats = {
    total_today: todayEntries.length,
    waiting_count: queue.filter((q) => q.status === 'waiting').length,
    called_count: queue.filter((q) => q.status === 'called').length,
    in_chair_count: queue.filter((q) => q.status === 'in_chair').length,
    completed_today: doneToday.length,
    cancelled_today: todayEntries.filter((q) => q.status === 'cancelled').length,
    no_show_today: todayEntries.filter((q) => q.status === 'no_show').length,
    walk_in_today: todayEntries.filter((q) => q.is_walk_in === true).length,
    online_today: todayEntries.filter((q) => !q.is_walk_in).length,
    estimated_revenue_today: doneToday.reduce((sum, q) => sum + (Number(q.total_price) || 0), 0),
    avg_wait_minutes_today: avgWaitMinutesToday,
    salon_date_ist: todayIst
  }

  return {
    success: true,
    settings,
    services,
    barbers,
    stats,
    isLiveSupabase: false
  }
}

/**
 * Create or Update a Salon Service (Admin only)
 */
export async function upsertServiceByAdmin(
  sessionToken,
  { id = null, nameEn, nameGu, durationMinutes, price, isActive = true, displayOrder = null }
) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const trimmedEn = (nameEn || '').trim()
  const trimmedGu = (nameGu || '').trim()
  const parsedDuration = Number(durationMinutes)
  const parsedPrice = Number(price)

  if (!trimmedEn || trimmedEn.length > 100) {
    return { success: false, error: 'English service name must be between 1 and 100 characters' }
  }
  if (!trimmedGu || trimmedGu.length > 100) {
    return { success: false, error: 'Gujarati service name must be between 1 and 100 characters' }
  }
  if (!Number.isInteger(parsedDuration) || parsedDuration <= 0 || parsedDuration > 480) {
    return { success: false, error: 'Service duration must be between 1 and 480 minutes' }
  }
  if (Number.isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 100000) {
    return { success: false, error: 'Service price must be between 0 and 100000' }
  }
  if (displayOrder !== null && (!Number.isInteger(Number(displayOrder)) || Number(displayOrder) < 0)) {
    return { success: false, error: 'Display order must be 0 or greater' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('admin_upsert_service', {
        p_session_token: sessionToken,
        p_service_id: id || null,
        p_name_en: trimmedEn,
        p_name_gu: trimmedGu,
        p_duration_minutes: parsedDuration,
        p_price: parsedPrice,
        p_is_active: Boolean(isActive),
        p_display_order: displayOrder !== null ? Number(displayOrder) : null
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to save service.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to save service.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, service: data.service }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error saving service.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const services = getLocalStore('services', INITIAL_SERVICES)
  let savedService = null

  if (!id) {
    const nextOrder =
      displayOrder !== null
        ? Number(displayOrder)
        : services.reduce((max, s) => Math.max(max, s.display_order || 0), 0) + 1
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `svc-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`
    savedService = {
      id: newId,
      name_en: trimmedEn,
      name_gu: trimmedGu,
      duration_minutes: parsedDuration,
      price: parsedPrice,
      is_active: Boolean(isActive),
      display_order: nextOrder
    }
    services.push(savedService)
  } else {
    const existing = services.find((s) => s.id === id)
    if (!existing) {
      return { success: false, error: 'Service not found' }
    }
    const nextActive = isActive !== undefined ? Boolean(isActive) : existing.is_active
    if (!nextActive && !services.some((s) => s.is_active && s.id !== id)) {
      return { success: false, error: 'At least one active service must remain available' }
    }
    existing.name_en = trimmedEn
    existing.name_gu = trimmedGu
    existing.duration_minutes = parsedDuration
    existing.price = parsedPrice
    existing.is_active = nextActive
    if (displayOrder !== null) existing.display_order = Number(displayOrder)
    savedService = { ...existing }
  }

  setLocalStore('services', services)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, service: savedService }
}

/**
 * Activate / Deactivate a Service (Admin only)
 */
export async function toggleServiceStatusByAdmin(sessionToken, serviceId, isActive) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }
  if (!serviceId || typeof isActive !== 'boolean') {
    return { success: false, error: 'Service ID and active status are required' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('admin_toggle_service_status', {
        p_session_token: sessionToken,
        p_service_id: serviceId,
        p_is_active: isActive
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to update service status.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to update service status.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, isActive: data.is_active }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error updating service status.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const services = getLocalStore('services', INITIAL_SERVICES)
  const target = services.find((s) => s.id === serviceId)
  if (!target) {
    return { success: false, error: 'Service not found' }
  }
  if (!isActive && !services.some((s) => s.is_active && s.id !== serviceId)) {
    return { success: false, error: 'At least one active service must remain available' }
  }

  target.is_active = isActive
  setLocalStore('services', services)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, isActive }
}

/**
 * Update Barber On-Duty / Availability Status (Admin only)
 * While a barber has an active customer, preserves status = 'serving' and allows toggling is_on_duty.
 */
export async function updateBarberByAdmin(sessionToken, barberId, { isOnDuty, status }) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }
  if (!barberId || typeof isOnDuty !== 'boolean' || !['available', 'on_break', 'serving'].includes(status)) {
    return { success: false, error: 'Invalid barber update parameters' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('admin_update_barber', {
        p_session_token: sessionToken,
        p_barber_id: barberId,
        p_is_on_duty: isOnDuty,
        p_status: status
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to update barber.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to update barber.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return {
        success: true,
        barberId: data.barber_id,
        isOnDuty: data.is_on_duty,
        status: data.status
      }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error updating barber.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const barbers = getReconciledLocalBarbers()
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) {
    return { success: false, error: 'Barber not found' }
  }

  if ((barber.current_queue_id || barber.status === 'serving') && status !== 'serving') {
    return { success: false, error: 'Cannot change barber availability while an active customer is assigned' }
  }
  if (!barber.current_queue_id && barber.status !== 'serving' && status === 'serving') {
    return { success: false, error: 'Cannot set barber status to serving without an assigned customer' }
  }

  barber.is_on_duty = isOnDuty
  barber.status = status
  barber.updated_at = new Date().toISOString()
  setLocalStore('barbers', barbers)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, barberId, isOnDuty, status }
}

/**
 * Update Salon Settings & Online Queue Open/Close Control (Admin only)
 */
export async function updateSalonSettingsByAdmin(
  sessionToken,
  { salonNameEn, salonNameGu, isOnlineQueueOpen: queueOpen, openingTime, closingTime, autoCloseBufferMinutes = 30 }
) {
  if (!sessionToken) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const trimmedEn = (salonNameEn || '').trim()
  const trimmedGu = (salonNameGu || '').trim()
  const normOpen = normalizeTimeValue(openingTime)
  const normClose = normalizeTimeValue(closingTime)
  const bufferMins = Number(autoCloseBufferMinutes)

  if (!trimmedEn || trimmedEn.length > 100) {
    return { success: false, error: 'English salon name must be between 1 and 100 characters' }
  }
  if (!trimmedGu || trimmedGu.length > 100) {
    return { success: false, error: 'Gujarati salon name must be between 1 and 100 characters' }
  }
  if (typeof queueOpen !== 'boolean') {
    return { success: false, error: 'Online queue open flag is required' }
  }
  if (!normOpen || !normClose || normOpen >= normClose) {
    return { success: false, error: 'Opening time must be earlier than closing time' }
  }
  if (!Number.isInteger(bufferMins) || bufferMins < 0 || bufferMins > 180) {
    return { success: false, error: 'Auto-close buffer must be between 0 and 180 minutes' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('admin_update_salon_settings', {
        p_session_token: sessionToken,
        p_salon_name_en: trimmedEn,
        p_salon_name_gu: trimmedGu,
        p_is_online_queue_open: queueOpen,
        p_opening_time: normOpen,
        p_closing_time: normClose,
        p_auto_close_buffer_minutes: bufferMins
      })
      if (error) {
        return { success: false, error: error.message || 'Failed to update salon settings.' }
      }
      if (!data || data.success === false) {
        const msg = data?.error || 'Failed to update salon settings.'
        return {
          success: false,
          unauthorized: msg.toLowerCase().includes('unauthorized'),
          error: msg
        }
      }
      return { success: true, settings: data.settings }
    } catch (err) {
      return { success: false, error: err.message || 'Connection error updating salon settings.' }
    }
  }

  const auth = validateLocalStaffSession(sessionToken, ['admin'])
  if (!auth.valid) {
    return { success: false, unauthorized: true, error: 'Unauthorized: Invalid or expired admin session' }
  }

  const updatedSettings = {
    id: 1,
    salon_name_en: trimmedEn,
    salon_name_gu: trimmedGu,
    is_online_queue_open: queueOpen,
    opening_time: normOpen,
    closing_time: normClose,
    auto_close_buffer_minutes: bufferMins,
    updated_at: new Date().toISOString()
  }
  setLocalStore('settings', updatedSettings)
  try {
    window.dispatchEvent(new Event('salon_local_queue_change'))
  } catch {}

  return { success: true, settings: updatedSettings }
}
