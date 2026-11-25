import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

// ============================================================================
// 1. ISOLATION GUARDS: Block network fetch & ensure no live .env credentials
// ============================================================================
globalThis.fetch = async () => {
  throw new Error('SECURITY VIOLATION: Network fetch is blocked in isolated Stage 7 tests.')
}

delete process.env.VITE_SUPABASE_URL
delete process.env.VITE_SUPABASE_ANON_KEY

// Mock browser globals (localStorage, sessionStorage, window, CustomEvent/Event)
function createStorageMock() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      store.set(String(k), String(v))
    },
    removeItem: (k) => {
      store.delete(String(k))
    },
    clear: () => {
      store.clear()
    },
    _dump: () => Object.fromEntries(store.entries())
  }
}

const listeners = new Map()
globalThis.localStorage = createStorageMock()
globalThis.sessionStorage = createStorageMock()
globalThis.Event = class MockEvent {
  constructor(type) {
    this.type = type
  }
}
globalThis.window = {
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
  },
  removeEventListener: (type, fn) => {
    listeners.get(type)?.delete(fn)
  },
  dispatchEvent: (evt) => {
    const set = listeners.get(evt?.type)
    if (set) {
      for (const fn of set) fn(evt)
    }
    return true
  }
}

// Controllable Clock (defaults to 12:00 PM IST on 2026-11-25)
const RealDate = globalThis.Date
let mockedNowMs = RealDate.parse('2026-11-25T12:00:00+05:30')

globalThis.Date = class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(mockedNowMs)
    } else {
      super(...args)
    }
  }
  static now() {
    return mockedNowMs
  }
  static parse(str) {
    return RealDate.parse(str)
  }
  static UTC(...args) {
    return RealDate.UTC(...args)
  }
}

function setIstTime(isoString) {
  mockedNowMs = RealDate.parse(isoString)
}

function advanceMinutes(mins) {
  mockedNowMs += mins * 60 * 1000
}

function resetSandbox() {
  localStorage.clear()
  sessionStorage.clear()
  setIstTime('2026-11-25T12:00:00+05:30')
}

// Dynamic imports AFTER mocks are installed
const { isSupabaseConfigured } = await import('../src/lib/supabaseClient.js')
const svc = await import('../src/services/supabaseService.js')
const { en } = await import('../src/i18n/en.js')
const { gu } = await import('../src/i18n/gu.js')

assert.equal(isSupabaseConfigured(), false, 'Live Supabase must NOT be configured in isolated tests')

// ============================================================================
// TEST RUNNER HARNESS
// ============================================================================
const results = []

async function runTest(name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS: ${name}`)
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err })
    console.error(`FAIL: ${name}\n  -> ${err?.stack || err}`)
  }
}

// Helper IDs from initial sandbox seed
const SVC_HAIRCUT = 's1111111-1111-1111-1111-111111111111' // 30m, 250
const SVC_BEARD = 's2222222-2222-2222-2222-222222222222' // 20m, 150
const SVC_MASSAGE = 's3333333-3333-3333-3333-333333333333' // 25m, 200
const SVC_FACIAL = 's4444444-4444-4444-4444-444444444444' // 45m, 500
const BARBER_AMIT = 'b1111111-1111-1111-1111-111111111111'
const BARBER_RAHUL = 'b2222222-2222-2222-2222-222222222222'
const BARBER_PRIYA = 'b3333333-3333-3333-3333-333333333333'

// ============================================================================
// STAGE 7 CHECKLIST & REGRESSION TESTS
// ============================================================================

// 1. Checklist #1, #4, #5: Valid queue join, 1-3 services limit, duplicate service rejection, duration & price
await runTest('Checklist 1, 4 & 5: Valid join, 1-3 service limits, duplicate service rejection & totals', async () => {
  resetSandbox()

  const emptyName = await svc.joinQueue({
    customerName: '   ',
    phoneNumber: '9876543210',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(emptyName.success, false)

  const zeroSvc = await svc.joinQueue({
    customerName: 'Aarav',
    phoneNumber: '9876543210',
    serviceIds: [],
    preferredBarberId: null
  })
  assert.equal(zeroSvc.success, false)

  const dupSvc = await svc.joinQueue({
    customerName: 'Aarav',
    phoneNumber: '9876543210',
    serviceIds: [SVC_HAIRCUT, SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(dupSvc.success, false)

  const fourSvc = await svc.joinQueue({
    customerName: 'Aarav',
    phoneNumber: '9876543210',
    serviceIds: [SVC_HAIRCUT, SVC_BEARD, SVC_MASSAGE, SVC_FACIAL],
    preferredBarberId: null
  })
  assert.equal(fourSvc.success, false)

  const valid = await svc.joinQueue({
    customerName: 'Aarav Patel',
    phoneNumber: '9876543210',
    serviceIds: [SVC_HAIRCUT, SVC_BEARD, SVC_MASSAGE],
    preferredBarberId: null
  })
  assert.equal(valid.success, true)
  assert.equal(valid.tokenNumber, 'T-101')
  assert.equal(valid.position, 1)
  assert.equal(valid.totalDuration, 75) // 30 + 20 + 25
  assert.equal(valid.totalPrice, 600) // 250 + 150 + 200
})

// 2. Checklist #2 & #3: Invalid phone numbers rejected & duplicate active phone prevented
await runTest('Checklist 2 & 3: Invalid phone rejection & duplicate active phone guard', async () => {
  resetSandbox()

  for (const badPhone of ['', '1234567890', '5999999999', '987654321', '98765432101', '98765abc10']) {
    const res = await svc.joinQueue({
      customerName: 'Tester',
      phoneNumber: badPhone,
      serviceIds: [SVC_HAIRCUT],
      preferredBarberId: null
    })
    assert.equal(res.success, false, `Expected phone "${badPhone}" to be rejected`)
  }

  const first = await svc.joinQueue({
    customerName: 'Kiran',
    phoneNumber: '9898989898',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(first.success, true)

  const dup = await svc.joinQueue({
    customerName: 'Kiran Again',
    phoneNumber: '9898989898',
    serviceIds: [SVC_BEARD],
    preferredBarberId: null
  })
  assert.equal(dup.success, false)

  // Cancel first spot -> same phone can now rejoin
  const cancelRes = await svc.cancelQueueSpot(first.queueId)
  assert.equal(cancelRes.success, true)

  const rejoin = await svc.joinQueue({
    customerName: 'Kiran Rejoin',
    phoneNumber: '9898989898',
    serviceIds: [SVC_BEARD],
    preferredBarberId: null
  })
  assert.equal(rejoin.success, true)
  assert.notEqual(rejoin.tokenNumber, first.tokenNumber)
})

// 3. Checklist #6, #7, #8, #9: Preferred barber, Any barber, Walk-ins & deterministic FCFS (created_at, id)
await runTest('Checklist 6, 7, 8 & 9: Barber preference, Any Barber, Walk-in & deterministic FCFS tie-breaking', async () => {
  resetSandbox()

  // Seed two waiting entries with IDENTICAL created_at timestamp to test id ASC tie-breaking
  const sameTs = '2026-11-25T12:00:00.000Z'
  const entries = [
    {
      id: 'q-zzz-second',
      token_number: 'T-102',
      customer_name: 'Zara (Second by ID)',
      phone_number: '9111111112',
      selected_services: [{ id: SVC_BEARD, name_en: 'Beard', name_gu: 'દાઢી', duration: 20, price: 150 }],
      total_duration: 20,
      total_price: 150,
      preferred_barber_id: BARBER_AMIT,
      assigned_barber_id: null,
      status: 'waiting',
      is_walk_in: false,
      called_at: null,
      service_started_at: null,
      completed_at: null,
      created_at: sameTs,
      updated_at: sameTs
    },
    {
      id: 'q-aaa-first',
      token_number: 'T-101',
      customer_name: 'Asha (First by ID)',
      phone_number: '9111111111',
      selected_services: [{ id: SVC_HAIRCUT, name_en: 'Haircut', name_gu: 'હેરકટ', duration: 30, price: 250 }],
      total_duration: 30,
      total_price: 250,
      preferred_barber_id: BARBER_AMIT,
      assigned_barber_id: null,
      status: 'waiting',
      is_walk_in: false,
      called_at: null,
      service_started_at: null,
      completed_at: null,
      created_at: sameTs,
      updated_at: sameTs
    }
  ]
  localStorage.setItem('salon_queue_entries', JSON.stringify(entries))
  localStorage.setItem('salon_token_counter', '103')

  // Check My Status deterministic positions
  const s1 = await svc.fetchCustomerStatus('q-aaa-first')
  const s2 = await svc.fetchCustomerStatus('q-zzz-second')
  assert.equal(s1.data.position, 1)
  assert.equal(s2.data.position, 2)

  // Reception login & dashboard order
  const recLogin = await svc.verifyStaffPin('reception', '1234')
  assert.equal(recLogin.success, true)

  const dash = await svc.fetchReceptionDashboard(recLogin.sessionToken)
  assert.equal(dash.success, true)
  assert.deepEqual(
    dash.waitingQueue.map((q) => q.id),
    ['q-aaa-first', 'q-zzz-second']
  )

  // TV Display next tokens order matches FCFS
  const tv = await svc.fetchTVDisplay()
  assert.equal(tv.success, true)
  assert.deepEqual(tv.nextTokens, ['T-101', 'T-102'])

  // Add Walk-in with Any Barber -> joins same queue at position 3
  advanceMinutes(1)
  const walkIn = await svc.addWalkInCustomer(recLogin.sessionToken, {
    customerName: 'WalkIn Dev',
    phoneNumber: '9222222222',
    serviceIds: [SVC_BEARD],
    preferredBarberId: null
  })
  assert.equal(walkIn.success, true)
  assert.equal(walkIn.tokenNumber, 'T-103')

  // Rahul calls next -> must skip Amit-only customers (T-101, T-102) and pick Walk-in Any-Barber (T-103)!
  const rahulCall = await svc.callNextCustomer(recLogin.sessionToken, BARBER_RAHUL)
  assert.equal(rahulCall.success, true)
  assert.equal(rahulCall.tokenNumber, 'T-103')

  // Amit calls next -> must pick earliest by (created_at, id), which is T-101
  const amitCall = await svc.callNextCustomer(recLogin.sessionToken, BARBER_AMIT)
  assert.equal(amitCall.success, true)
  assert.equal(amitCall.tokenNumber, 'T-101')
})

// 4. Checklist #10 & #11: Called -> In Chair -> Done lifecycle, cancel blocked after called, off-duty preservation
await runTest('Checklist 10 & 11: Barber Start/Done lifecycle, self-cancel guard & off-duty preservation', async () => {
  resetSandbox()

  const joined = await svc.joinQueue({
    customerName: 'Meera',
    phoneNumber: '9333333333',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: BARBER_PRIYA
  })
  assert.equal(joined.success, true)

  const rec = await svc.verifyStaffPin('reception', '1234')
  const admin = await svc.verifyStaffPin('admin', '9999')
  const priyaLogin = await svc.verifyBarberPin('Priya', '3333')
  assert.equal(priyaLogin.success, true)

  // Call Next for Priya
  const called = await svc.callNextCustomer(rec.sessionToken, BARBER_PRIYA)
  assert.equal(called.success, true)

  // Customer status is 'called' and self-cancel MUST fail
  const statusCalled = await svc.fetchCustomerStatus(joined.queueId)
  assert.equal(statusCalled.data.status, 'called')
  assert.equal(statusCalled.data.assigned_barber_name, 'Priya')
  const cancelBlocked = await svc.cancelQueueSpot(joined.queueId)
  assert.equal(cancelBlocked.success, false)

  // Priya starts service
  const started = await svc.startBarberService(priyaLogin.sessionToken, BARBER_PRIYA, joined.queueId)
  assert.equal(started.success, true)
  assert.equal(started.status, 'in_chair')

  // Admin marks Priya off duty while she is serving -> serving status must be preserved
  const offDutyWhileServing = await svc.updateBarberByAdmin(admin.sessionToken, BARBER_PRIYA, {
    isOnDuty: false,
    status: 'serving'
  })
  assert.equal(offDutyWhileServing.success, true)

  // Priya completes service -> customer becomes done, Priya transitions to on_break (preserving off-duty)
  const done = await svc.completeBarberService(priyaLogin.sessionToken, BARBER_PRIYA, joined.queueId)
  assert.equal(done.success, true)
  assert.equal(done.status, 'done')

  const statusDone = await svc.fetchCustomerStatus(joined.queueId)
  assert.equal(statusDone.data.status, 'done')

  const adminDash = await svc.fetchAdminDashboard(admin.sessionToken)
  const priyaAfter = adminDash.barbers.find((b) => b.id === BARBER_PRIYA)
  assert.equal(priyaAfter.is_on_duty, false)
  assert.equal(priyaAfter.status, 'on_break')
  assert.equal(priyaAfter.current_queue_id, null)
})

// 5. Checklist #12: No-show after 10 minutes & rejoin only with new token at end
await runTest('Checklist 12: 10-minute No-Show guard & rejoin with new token at end', async () => {
  resetSandbox()

  const c1 = await svc.joinQueue({
    customerName: 'Nikhil',
    phoneNumber: '9444444441',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  advanceMinutes(1)
  const c2 = await svc.joinQueue({
    customerName: 'Rohan',
    phoneNumber: '9444444442',
    serviceIds: [SVC_BEARD],
    preferredBarberId: null
  })

  const rec = await svc.verifyStaffPin('reception', '1234')
  await svc.callNextCustomer(rec.sessionToken, BARBER_AMIT)

  // After 9 minutes -> No-Show must be blocked
  advanceMinutes(9)
  const earlyNoShow = await svc.markCustomerNoShow(rec.sessionToken, c1.queueId)
  assert.equal(earlyNoShow.success, false)

  // After 10+ minutes -> No-Show succeeds and frees Amit
  advanceMinutes(2)
  const validNoShow = await svc.markCustomerNoShow(rec.sessionToken, c1.queueId)
  assert.equal(validNoShow.success, true)

  const c1Status = await svc.fetchCustomerStatus(c1.queueId)
  assert.equal(c1Status.data.status, 'no_show')

  // Nikhil rejoins -> gets a brand new token at the end behind Rohan (T-102)
  const c1Rejoin = await svc.joinQueue({
    customerName: 'Nikhil',
    phoneNumber: '9444444441',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(c1Rejoin.success, true)
  assert.equal(c1Rejoin.tokenNumber, 'T-103')
  assert.equal(c1Rejoin.position, 2)
  assert.notEqual(c1Rejoin.queueId, c1.queueId)
  assert.ok(c2.queueId)
})

// 6. Checklist #13 & #14 + Change 1: IST Business Hours, Zero-Buffer, Manual Closure, Break Barber & Walk-in after closure
await runTest('Checklist 13 & 14 + Change 1: IST hours, 0-min buffer, manual closure, break barber & walk-in', async () => {
  resetSandbox()

  // Before opening (08:59 IST) -> closed
  setIstTime('2026-11-25T08:59:00+05:30')
  const beforeOpen = await svc.joinQueue({
    customerName: 'Early Bird',
    phoneNumber: '9555555551',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(beforeOpen.success, false)

  // Within auto-close buffer (20:30 IST with 21:00 close & 30m buffer) -> closed
  setIstTime('2026-11-25T20:30:00+05:30')
  const inBuffer = await svc.joinQueue({
    customerName: 'Late Joiner',
    phoneNumber: '9555555552',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(inBuffer.success, false)

  // Walk-in MUST still work after online queue auto-closes (Checklist #14)
  const rec = await svc.verifyStaffPin('reception', '1234')
  const walkInAfterClose = await svc.addWalkInCustomer(rec.sessionToken, {
    customerName: 'WalkIn Late',
    phoneNumber: '9555555553',
    serviceIds: [SVC_BEARD],
    preferredBarberId: null
  })
  assert.equal(walkInAfterClose.success, true)

  // Admin sets 0-minute auto-close buffer -> 20:45 IST is now OPEN, 21:00 IST is CLOSED
  const admin = await svc.verifyStaffPin('admin', '9999')
  const zeroBufferSave = await svc.updateSalonSettingsByAdmin(admin.sessionToken, {
    salonNameEn: 'Royal Crown Salon',
    salonNameGu: 'રોયલ ક્રાઉન સલૂન',
    isOnlineQueueOpen: true,
    openingTime: '09:00:00',
    closingTime: '21:00:00',
    autoCloseBufferMinutes: 0
  })
  assert.equal(zeroBufferSave.success, true)
  assert.equal(zeroBufferSave.settings.auto_close_buffer_minutes, 0)

  setIstTime('2026-11-25T20:45:00+05:30')
  const openWithZeroBuffer = await svc.joinQueue({
    customerName: 'Zero Buffer Ok',
    phoneNumber: '9555555554',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(openWithZeroBuffer.success, true)

  // Put Rahul on break -> selecting Rahul must fail
  await svc.updateBarberByAdmin(admin.sessionToken, BARBER_RAHUL, {
    isOnDuty: true,
    status: 'on_break'
  })
  const breakJoin = await svc.joinQueue({
    customerName: 'Wants Break Barber',
    phoneNumber: '9555555555',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: BARBER_RAHUL
  })
  assert.equal(breakJoin.success, false)

  // Manual closure cannot be bypassed even when Dev Testing Mode is enabled
  await svc.updateSalonSettingsByAdmin(admin.sessionToken, {
    salonNameEn: 'Royal Crown Salon',
    salonNameGu: 'રોયલ ક્રાઉન સલૂન',
    isOnlineQueueOpen: false,
    openingTime: '09:00:00',
    closingTime: '21:00:00',
    autoCloseBufferMinutes: 30
  })
  svc.setDevTestingMode(true)
  setIstTime('2026-11-25T12:00:00+05:30')
  const manualClosed = await svc.joinQueue({
    customerName: 'Bypass Attempt',
    phoneNumber: '9555555556',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.equal(manualClosed.success, false)
  svc.setDevTestingMode(false)
})

// 7. Checklist #15: Bilingual EN / GU completeness & parity
await runTest('Checklist 15: Complete English & Gujarati translation key parity and non-empty values', async () => {
  const enKeys = Object.keys(en).sort()
  const guKeys = Object.keys(gu).sort()
  assert.deepEqual(enKeys, guKeys, 'en.js and gu.js must have identical translation keys')

  for (const key of enKeys) {
    assert.equal(typeof en[key], 'string', `en.${key} must be a string`)
    assert.equal(typeof gu[key], 'string', `gu.${key} must be a string`)
    assert.ok(en[key].trim().length > 0, `en.${key} must not be empty`)
    assert.ok(gu[key].trim().length > 0, `gu.${key} must not be empty`)
  }
})

// 8. Checklist #16 & B2: Live Wait-Time Estimates & Remaining Chair Time
await runTest('Checklist 16 & B2: Wait-time updates on queue changes and includes serving chair remaining minutes', async () => {
  resetSandbox()

  // Initially 0 wait
  let stats = await svc.fetchQueueStats()
  assert.equal(stats.waitingCount, 0)
  assert.equal(stats.estimatedWaitMinutes, 0)

  // Add customer 1 (30m), call & start in chair with Amit -> 10m elapsed -> 20m remaining
  const c1 = await svc.joinQueue({
    customerName: 'In Chair',
    phoneNumber: '9666666661',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: BARBER_AMIT
  })
  const rec = await svc.verifyStaffPin('reception', '1234')
  await svc.callNextCustomer(rec.sessionToken, BARBER_AMIT)
  const amitLogin = await svc.verifyBarberPin('Amit', '1111')
  await svc.startBarberService(amitLogin.sessionToken, BARBER_AMIT, c1.queueId)
  advanceMinutes(10)

  // Add customer 2 (30m) waiting -> total workload = 20m chair remaining + 30m waiting = 50m across 3 working barbers => ceil(50/3) = 17m
  await svc.joinQueue({
    customerName: 'Waiting One',
    phoneNumber: '9666666662',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })

  stats = await svc.fetchQueueStats()
  assert.equal(stats.waitingCount, 1)
  assert.equal(stats.workingBarbersCount, 3)
  assert.equal(stats.estimatedWaitMinutes, 17)
})

// 9. Checklist #17 & Change 5: Realtime subscription notifications & 5-second fallback
await runTest('Checklist 17 & Change 5: Realtime sync notifications fire on queue/settings mutations', async () => {
  resetSandbox()

  let updateCount = 0
  let statusReported = null
  const unsub = svc.subscribeToSalonUpdates(
    () => {
      updateCount += 1
    },
    (status) => {
      statusReported = status
    }
  )

  assert.equal(statusReported, 'LOCAL')

  await svc.joinQueue({
    customerName: 'Sync Tester',
    phoneNumber: '9777777771',
    serviceIds: [SVC_HAIRCUT],
    preferredBarberId: null
  })
  assert.ok(updateCount >= 1, 'Expected subscribeToSalonUpdates callback after joinQueue')

  const prevCount = updateCount
  const admin = await svc.verifyStaffPin('admin', '9999')
  await svc.toggleServiceStatusByAdmin(admin.sessionToken, SVC_BEARD, false)
  assert.ok(updateCount > prevCount, 'Expected subscribeToSalonUpdates callback after admin service update')

  unsub()
})

// 10. Change 3 & Security: Reception server-side logout, barber isolation, PIN rotation & lockout
await runTest('Change 3 & Security: Scoped Reception logout, barber isolation, PIN rotation & lockout', async () => {
  resetSandbox()

  const rec = await svc.verifyStaffPin('reception', '1234')
  const admin = await svc.verifyStaffPin('admin', '9999')
  const amit = await svc.verifyBarberPin('Amit', '1111')
  assert.ok(rec.sessionToken && admin.sessionToken && amit.sessionToken)

  // Reception logout revokes ONLY reception token; admin & Amit stay valid
  const logoutRes = await svc.logoutStaffSession(rec.sessionToken, 'reception')
  assert.equal(logoutRes.success, true)

  const recAfter = await svc.fetchReceptionDashboard(rec.sessionToken)
  assert.equal(recAfter.unauthorized, true)

  const adminAfter = await svc.fetchAdminDashboard(admin.sessionToken)
  assert.equal(adminAfter.success, true)

  const amitAfter = await svc.fetchBarberView(amit.sessionToken, 'Amit')
  assert.equal(amitAfter.success, true)

  // Amit's token must NOT access Rahul's barber view
  const crossStation = await svc.fetchBarberView(amit.sessionToken, 'Rahul')
  assert.equal(crossStation.unauthorized, true)

  // Admin rotates Amit's PIN -> old Amit session invalidated, old PIN fails, new PIN succeeds
  const rotate = await svc.setBarberPinByAdmin(admin.sessionToken, BARBER_AMIT, '4567')
  assert.equal(rotate.success, true)
  const amitRevoked = await svc.fetchBarberView(amit.sessionToken, 'Amit')
  assert.equal(amitRevoked.unauthorized, true)
  const oldPinFail = await svc.verifyBarberPin('Amit', '1111')
  assert.equal(oldPinFail.success, false)
  const newPinOk = await svc.verifyBarberPin('Amit', '4567')
  assert.equal(newPinOk.success, true)

  // Lockout after 5 failed reception attempts
  for (let i = 0; i < 5; i++) {
    const bad = await svc.verifyStaffPin('reception', '0000')
    assert.equal(bad.success, false)
  }
  const locked = await svc.verifyStaffPin('reception', '1234')
  assert.equal(locked.success, false)
  assert.match(locked.error, /locked out/i)
})

// 11. Stage 6 & Stage 7 Polish: Service catalog protection, Rahul initial status, TV privacy & IST stats
await runTest('Stage 6 & 7 Polish: Last active service guard, Rahul initial status, TV privacy & IST stats', async () => {
  resetSandbox()

  // All 3 barbers start available (Rahul bug regression check)
  const initialBarbers = await svc.fetchBarbers()
  assert.equal(initialBarbers.data.length, 3)
  for (const b of initialBarbers.data) {
    assert.equal(b.status, 'available', `${b.name} must start available`)
  }

  const admin = await svc.verifyStaffPin('admin', '9999')
  const dash = await svc.fetchAdminDashboard(admin.sessionToken)
  assert.equal(dash.services.length, 5)

  // Deactivate 4 services -> 5th (last active) must be protected
  for (let i = 0; i < 4; i++) {
    const res = await svc.toggleServiceStatusByAdmin(admin.sessionToken, dash.services[i].id, false)
    assert.equal(res.success, true)
  }
  const lastGuard = await svc.toggleServiceStatusByAdmin(admin.sessionToken, dash.services[4].id, false)
  assert.equal(lastGuard.success, false)

  // Re-enable first service, create & complete a customer, check IST stats & TV privacy
  await svc.toggleServiceStatusByAdmin(admin.sessionToken, dash.services[0].id, true)
  const joined = await svc.joinQueue({
    customerName: 'Private Customer',
    phoneNumber: '9888888881',
    serviceIds: [dash.services[0].id],
    preferredBarberId: BARBER_RAHUL
  })
  const rec = await svc.verifyStaffPin('reception', '1234')
  await svc.callNextCustomer(rec.sessionToken, BARBER_RAHUL)

  // TV Display must NEVER expose customer_name, phone_number, or queue UUID
  const tv = await svc.fetchTVDisplay()
  const tvJson = JSON.stringify(tv)
  assert.equal(tvJson.includes('Private Customer'), false)
  assert.equal(tvJson.includes('9888888881'), false)
  assert.equal(tvJson.includes(joined.queueId), false)

  const rahul = await svc.verifyBarberPin('Rahul', '2222')
  await svc.startBarberService(rahul.sessionToken, BARBER_RAHUL, joined.queueId)
  await svc.completeBarberService(rahul.sessionToken, BARBER_RAHUL, joined.queueId)

  const statsDash = await svc.fetchAdminDashboard(admin.sessionToken)
  assert.equal(statsDash.stats.salon_date_ist, '2026-11-25')
  assert.equal(statsDash.stats.total_today, 1)
  assert.equal(statsDash.stats.completed_today, 1)
  assert.equal(statsDash.stats.estimated_revenue_today, 250)
})

// 12. Stage 7 SQL, Component & Security Invariants (Static Verification)
await runTest('Stage 7 SQL, Component & Security Invariants (static file checks)', async () => {
  const stage7Sql = fs.readFileSync(path.join(ROOT_DIR, 'supabase', 'stage7_final_polish.sql'), 'utf8')
  const schemaSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase', 'schema.sql'), 'utf8')
  const joinPage = fs.readFileSync(path.join(ROOT_DIR, 'src', 'pages', 'JoinQueuePage.jsx'), 'utf8')
  const homePage = fs.readFileSync(path.join(ROOT_DIR, 'src', 'pages', 'HomePage.jsx'), 'utf8')
  const receptionPage = fs.readFileSync(path.join(ROOT_DIR, 'src', 'pages', 'ReceptionPage.jsx'), 'utf8')

  for (const sql of [stage7Sql, schemaSql]) {
    assert.match(sql, /DROP VIEW IF EXISTS tv_queue_display/i)
    assert.match(sql, /AT TIME ZONE 'Asia\/Kolkata'/)
    assert.match(sql, /COALESCE\(v_settings\.auto_close_buffer_minutes,\s*30\)/)
    assert.match(sql, /ORDER BY .*created_at ASC,\s*.*id ASC/i)
    assert.match(sql, /CREATE OR REPLACE FUNCTION get_home_queue_stats\(\)/)
    assert.match(sql, /Duplicate services are not allowed/)
  }

  assert.match(joinPage, /subscribeToSalonUpdates/)
  assert.match(joinPage, /no_services_available/)
  assert.doesNotMatch(homePage, /setInterval/)
  assert.match(receptionPage, /logoutStaffSession\(session\.sessionToken,\s*'reception'\)/)

  // Ensure no runtime reference to legacy tv_queue_display view or service_role in src/
  function walkFiles(dir) {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walkFiles(full))
      else if (entry.isFile()) out.push(full)
    }
    return out
  }
  // Strip JS/JSX comments while preserving string/template literals so actual code references are still detected
  function stripJsComments(source) {
    let out = ''
    let i = 0
    let quote = null
    while (i < source.length) {
      const ch = source[i]
      const next = source[i + 1]
      if (quote) {
        out += ch
        if (ch === '\\' && i + 1 < source.length) {
          out += next
          i += 2
          continue
        }
        if (ch === quote) quote = null
        i += 1
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
        out += ch
        i += 1
        continue
      }
      if (ch === '/' && next === '/') {
        while (i < source.length && source[i] !== '\n') i += 1
        continue
      }
      if (ch === '/' && next === '*') {
        i += 2
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
        i += 2
        continue
      }
      out += ch
      i += 1
    }
    return out
  }

  for (const full of walkFiles(path.join(ROOT_DIR, 'src'))) {
    const content = fs.readFileSync(full, 'utf8')
    const codeOnly = stripJsComments(content)
    assert.equal(codeOnly.includes('tv_queue_display'), false, `Legacy view found in ${full}`)
    assert.equal(codeOnly.includes('service_role'), false, `service_role reference found in ${full}`)
  }
})

// ============================================================================
// SUMMARY
// ============================================================================
const passed = results.filter((r) => r.status === 'PASS').length
const failed = results.filter((r) => r.status === 'FAIL').length
console.log(`\nStage 7 Checklist & Regression Summary: ${passed}/${results.length} passed, ${failed} failed.`)
if (failed > 0) {
  process.exitCode = 1
}
