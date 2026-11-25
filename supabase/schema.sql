-- ==============================================================================
-- SALON QUEUE MANAGEMENT SYSTEM — SUPABASE DATABASE SCHEMA
-- Multi-device real-time synchronization, concurrency control, and security hardening.
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Clean Existing Schema (Safe Initial Setup)
DROP VIEW IF EXISTS tv_queue_display;
DROP TABLE IF EXISTS queue_entries CASCADE;
DROP TABLE IF EXISTS barber_security CASCADE;
DROP TABLE IF EXISTS barbers CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS staff_sessions CASCADE;
DROP TABLE IF EXISTS pin_attempt_log CASCADE;
DROP TABLE IF EXISTS salon_security CASCADE;
DROP TABLE IF EXISTS salon_settings CASCADE;
DROP SEQUENCE IF EXISTS queue_token_seq CASCADE;

-- 3. Token Generation Sequence (Thread-safe sequential token generator)
CREATE SEQUENCE queue_token_seq START WITH 101 INCREMENT BY 1 NO MAXVALUE CACHE 1;

CREATE OR REPLACE FUNCTION generate_next_token()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN 'T-' || nextval('queue_token_seq')::TEXT;
END;
$$;

-- 4. Salon Settings Table (Singleton)
CREATE TABLE salon_settings (
    id INT PRIMARY KEY DEFAULT 1,
    salon_name_en TEXT NOT NULL DEFAULT 'Royal Crown Salon',
    salon_name_gu TEXT NOT NULL DEFAULT 'રોયલ ક્રાઉન સલૂન',
    is_online_queue_open BOOLEAN NOT NULL DEFAULT true,
    opening_time TIME NOT NULL DEFAULT '09:00:00',
    closing_time TIME NOT NULL DEFAULT '21:00:00',
    auto_close_buffer_minutes INT NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_salon_settings CHECK (id = 1)
);

-- 5. Salon Security Table (Private: Hashed PINs, never plaintext, no public read)
CREATE TABLE salon_security (
    id INT PRIMARY KEY DEFAULT 1,
    reception_pin_hash TEXT NOT NULL,
    admin_pin_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_salon_security CHECK (id = 1)
);

-- Seed Initial PIN hashes (Default reception: '1234', default admin: '9999')
INSERT INTO salon_security (id, reception_pin_hash, admin_pin_hash)
VALUES (
    1,
    crypt('1234', gen_salt('bf')),
    crypt('9999', gen_salt('bf'))
);

-- 6. PIN Rate-Limiting Log
CREATE TABLE pin_attempt_log (
    id BIGSERIAL PRIMARY KEY,
    role TEXT NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    success BOOLEAN NOT NULL
);

CREATE INDEX idx_pin_attempts ON pin_attempt_log (role, success, attempted_at);

-- 7. Staff Sessions Table (Ephemeral 12-hour sessions for verified PINs)
CREATE TABLE staff_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    role TEXT NOT NULL, -- 'reception', 'admin', or 'barber'
    barber_id UUID, -- Bound barber station ID when role = 'barber'
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_sessions_token ON staff_sessions (session_token, expires_at);
CREATE INDEX idx_staff_sessions_barber ON staff_sessions (session_token, role, barber_id, expires_at);

-- 8. Services Catalog Table
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_en TEXT NOT NULL,
    name_gu TEXT NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Barbers Table
CREATE TABLE barbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_on_duty BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_break', 'serving')),
    current_queue_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9b. Private Barber Security Table (Bcrypt hashes only, no public read, no predictable seeds)
CREATE TABLE barber_security (
    barber_id UUID PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE staff_sessions
    ADD CONSTRAINT fk_staff_sessions_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE;

-- 10. Unified Queue Entries Table (Online + Walk-in customers)
CREATE TABLE queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_number TEXT NOT NULL UNIQUE DEFAULT generate_next_token(),
    customer_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    selected_services JSONB NOT NULL DEFAULT '[]'::JSONB,
    total_duration INT NOT NULL CHECK (total_duration > 0),
    total_price NUMERIC(10, 2) NOT NULL CHECK (total_price >= 0),
    preferred_barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    assigned_barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'in_chair', 'done', 'cancelled', 'no_show')),
    is_walk_in BOOLEAN NOT NULL DEFAULT false,
    called_at TIMESTAMPTZ,
    service_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partial Unique Index: Prevent duplicate active phone numbers
CREATE UNIQUE INDEX idx_unique_active_phone 
ON queue_entries (phone_number) 
WHERE status IN ('waiting', 'called', 'in_chair');

-- Index for deterministic FCFS queue ordering
CREATE INDEX idx_queue_waiting_order 
ON queue_entries (status, created_at ASC, id ASC);

-- 11. Legacy tv_queue_display view removed in Stage 7 (replaced by get_tv_display() RPC)

-- 12. Row Level Security (RLS) Configuration
ALTER TABLE salon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_attempt_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;

-- Public read policies for static catalogs and status
CREATE POLICY "Public read salon_settings" ON salon_settings FOR SELECT USING (true);
CREATE POLICY "Public read services" ON services FOR SELECT USING (is_active = true);
CREATE POLICY "Public read barbers" ON barbers FOR SELECT USING (true);

-- Deny direct public access to salon_security and staff_sessions
-- (No policies for anon on salon_security or staff_sessions)

-- Deny direct INSERT/UPDATE/DELETE on queue_entries for anon
-- Public mutations must occur exclusively through validated RPC functions below.

-- 13. Hardened SECURITY DEFINER RPC Functions

-- A. PIN Verification with 5-attempt / 15-minute Lockout
CREATE OR REPLACE FUNCTION verify_staff_pin(p_role TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_hash TEXT;
    v_valid BOOLEAN := FALSE;
    v_recent_failures INT;
    v_session_token UUID;
BEGIN
    IF p_role NOT IN ('reception', 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid role requested');
    END IF;

    -- Check for lockout (5 failures in past 15 mins)
    SELECT COUNT(*) INTO v_recent_failures
    FROM pin_attempt_log
    WHERE role = p_role 
      AND success = false 
      AND attempted_at > NOW() - INTERVAL '15 minutes';

    IF v_recent_failures >= 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Too many failed attempts. Locked out for 15 minutes.');
    END IF;

    -- Fetch hash from private table
    IF p_role = 'reception' THEN
        SELECT reception_pin_hash INTO v_hash FROM salon_security WHERE id = 1;
    ELSIF p_role = 'admin' THEN
        SELECT admin_pin_hash INTO v_hash FROM salon_security WHERE id = 1;
    END IF;

    -- Constant-time verification
    v_valid := (v_hash = crypt(p_pin, v_hash));

    -- Log attempt
    INSERT INTO pin_attempt_log (role, success) VALUES (p_role, v_valid);

    IF NOT v_valid THEN
        RETURN jsonb_build_object('success', false, 'error', 'Incorrect PIN');
    END IF;

    -- Issue 12-hour session
    v_session_token := gen_random_uuid();
    INSERT INTO staff_sessions (session_token, role, expires_at)
    VALUES (v_session_token, p_role, NOW() + INTERVAL '12 hours');

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'role', p_role
    );
END;
$$;

-- B. Validated Public Queue Joining
CREATE OR REPLACE FUNCTION join_queue(
    p_customer_name TEXT,
    p_phone_number TEXT,
    p_service_ids UUID[],
    p_preferred_barber_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_settings salon_settings%ROWTYPE;
    v_current_time TIME;
    v_buffer_minutes INT;
    v_unique_service_ids UUID[];
    v_total_duration INT := 0;
    v_total_price NUMERIC := 0;
    v_services_snapshot JSONB := '[]'::JSONB;
    v_service RECORD;
    v_new_id UUID;
    v_token TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_ahead_count INT;
BEGIN
    SELECT * INTO v_settings FROM salon_settings WHERE id = 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Salon settings not configured');
    END IF;

    IF NOT v_settings.is_online_queue_open THEN
        RETURN jsonb_build_object('success', false, 'error', 'Online queue is currently closed');
    END IF;

    v_current_time := (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME;
    v_buffer_minutes := COALESCE(v_settings.auto_close_buffer_minutes, 30);

    IF v_current_time < v_settings.opening_time THEN
        RETURN jsonb_build_object('success', false, 'error', 'Online queue is not open yet (before opening hours)');
    END IF;

    IF v_current_time >= (v_settings.closing_time - (v_buffer_minutes || ' minutes')::INTERVAL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Online queue is closed for the day (30 mins before closing)');
    END IF;

    IF p_customer_name IS NULL OR TRIM(p_customer_name) = '' OR LENGTH(TRIM(p_customer_name)) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please provide a valid customer name');
    END IF;

    IF p_phone_number IS NULL OR NOT (p_phone_number ~ '^[6-9][0-9]{9}$') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please provide a valid 10-digit mobile number');
    END IF;

    IF EXISTS (
        SELECT 1 FROM queue_entries 
        WHERE phone_number = p_phone_number 
          AND status IN ('waiting', 'called', 'in_chair')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'An active queue entry already exists for this mobile number');
    END IF;

    IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL
       OR array_length(p_service_ids, 1) < 1 OR array_length(p_service_ids, 1) > 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'You must select between 1 and 3 services');
    END IF;

    SELECT ARRAY(SELECT DISTINCT x FROM unnest(p_service_ids) AS x)
    INTO v_unique_service_ids;

    IF array_length(v_unique_service_ids, 1) != array_length(p_service_ids, 1) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Duplicate services are not allowed');
    END IF;

    FOR v_service IN 
        SELECT id, name_en, name_gu, duration_minutes, price 
        FROM services 
        WHERE id = ANY(v_unique_service_ids) AND is_active = true
        ORDER BY display_order ASC, id ASC
    LOOP
        v_total_duration := v_total_duration + v_service.duration_minutes;
        v_total_price := v_total_price + v_service.price;
        v_services_snapshot := v_services_snapshot || jsonb_build_object(
            'id', v_service.id,
            'name_en', v_service.name_en,
            'name_gu', v_service.name_gu,
            'duration', v_service.duration_minutes,
            'price', v_service.price
        );
    END LOOP;

    IF jsonb_array_length(v_services_snapshot) != array_length(v_unique_service_ids, 1) THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more selected services are unavailable');
    END IF;

    IF p_preferred_barber_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM barbers 
            WHERE id = p_preferred_barber_id AND is_on_duty = true AND status != 'on_break'
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Selected barber is currently unavailable');
        END IF;
    END IF;

    v_token := generate_next_token();
    v_new_id := gen_random_uuid();

    BEGIN
        INSERT INTO queue_entries (
            id, token_number, customer_name, phone_number, selected_services,
            total_duration, total_price, preferred_barber_id, assigned_barber_id,
            status, is_walk_in, called_at, service_started_at, completed_at,
            created_at, updated_at
        ) VALUES (
            v_new_id, v_token, TRIM(p_customer_name), p_phone_number, v_services_snapshot,
            v_total_duration, v_total_price, p_preferred_barber_id, NULL,
            'waiting', false, NULL, NULL, NULL, v_now, v_now
        );
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'An active queue entry already exists for this mobile number');
    END;

    IF p_preferred_barber_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_ahead_count
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_now OR (created_at = v_now AND id < v_new_id))
          AND (preferred_barber_id = p_preferred_barber_id OR preferred_barber_id IS NULL);
    ELSE
        SELECT COUNT(*) INTO v_ahead_count
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_now OR (created_at = v_now AND id < v_new_id));
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'queue_id', v_new_id,
        'token_number', v_token,
        'position', v_ahead_count + 1,
        'total_duration', v_total_duration,
        'total_price', v_total_price
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION join_queue(TEXT, TEXT, UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_queue(TEXT, TEXT, UUID[], UUID) TO anon, authenticated;

-- C. Scoped Customer Status Getter (Privacy-preserving, barber-eligibility aware)
CREATE OR REPLACE FUNCTION get_my_queue_status(p_queue_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entry queue_entries%ROWTYPE;
    v_ahead_count INT;
    v_barber_name TEXT := NULL;
    v_barbers_data JSONB := '[]'::JSONB;
    v_ahead_entries JSONB := '[]'::JSONB;
BEGIN
    SELECT * INTO v_entry FROM queue_entries WHERE id = p_queue_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Token not found');
    END IF;

    IF v_entry.assigned_barber_id IS NOT NULL THEN
        SELECT name INTO v_barber_name FROM barbers WHERE id = v_entry.assigned_barber_id;
    END IF;

    -- Calculate barber-eligible position with deterministic (created_at, id) tie-breaking
    IF v_entry.preferred_barber_id IS NOT NULL THEN
        -- Specific Barber: count only customers ahead who chose this barber OR Any Barber
        SELECT COUNT(*) INTO v_ahead_count
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_entry.created_at OR (created_at = v_entry.created_at AND id < v_entry.id))
          AND (preferred_barber_id = v_entry.preferred_barber_id OR preferred_barber_id IS NULL);

        -- Collect non-PII durations of ahead entries for wait calculation
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', id,
                'total_duration', total_duration,
                'preferred_barber_id', preferred_barber_id
            )
            ORDER BY created_at ASC, id ASC
        ), '[]'::JSONB) INTO v_ahead_entries
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_entry.created_at OR (created_at = v_entry.created_at AND id < v_entry.id))
          AND (preferred_barber_id = v_entry.preferred_barber_id OR preferred_barber_id IS NULL);
    ELSE
        -- Any Barber: count all waiting customers ahead
        SELECT COUNT(*) INTO v_ahead_count
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_entry.created_at OR (created_at = v_entry.created_at AND id < v_entry.id));

        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', id,
                'total_duration', total_duration,
                'preferred_barber_id', preferred_barber_id
            )
            ORDER BY created_at ASC, id ASC
        ), '[]'::JSONB) INTO v_ahead_entries
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_entry.created_at OR (created_at = v_entry.created_at AND id < v_entry.id));
    END IF;

    -- Collect active working barbers info (status, service duration for serving barbers)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'is_on_duty', b.is_on_duty,
            'status', b.status,
            'service_started_at', q.service_started_at,
            'active_service_duration', q.total_duration
        )
        ORDER BY b.created_at ASC, b.name ASC
    ), '[]'::JSONB) INTO v_barbers_data
    FROM barbers b
    LEFT JOIN queue_entries q ON b.current_queue_id = q.id
    WHERE b.is_on_duty = true AND b.status != 'on_break';

    RETURN jsonb_build_object(
        'success', true,
        'id', v_entry.id,
        'token_number', v_entry.token_number,
        'customer_name', v_entry.customer_name,
        'status', v_entry.status,
        'selected_services', v_entry.selected_services,
        'total_duration', v_entry.total_duration,
        'total_price', v_entry.total_price,
        'position', v_ahead_count + 1,
        'preferred_barber_id', v_entry.preferred_barber_id,
        'assigned_barber_id', v_entry.assigned_barber_id,
        'assigned_barber_name', v_barber_name,
        'called_at', v_entry.called_at,
        'created_at', v_entry.created_at,
        'waiting_entries_ahead', v_ahead_entries,
        'working_barbers', v_barbers_data
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_my_queue_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_queue_status(UUID) TO anon, authenticated;

-- C2. Privacy-safe Home Screen Queue Stats Getter (Zero PII)
CREATE OR REPLACE FUNCTION get_home_queue_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_waiting_entries JSONB := '[]'::JSONB;
    v_working_barbers JSONB := '[]'::JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'total_duration', q.total_duration,
            'preferred_barber_id', q.preferred_barber_id,
            'created_at', q.created_at
        )
        ORDER BY q.created_at ASC, q.id ASC
    ), '[]'::JSONB) INTO v_waiting_entries
    FROM queue_entries q
    WHERE q.status = 'waiting';

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'is_on_duty', b.is_on_duty,
            'status', b.status,
            'service_started_at', q.service_started_at,
            'active_service_duration', q.total_duration
        )
        ORDER BY b.created_at ASC, b.name ASC
    ), '[]'::JSONB) INTO v_working_barbers
    FROM barbers b
    LEFT JOIN queue_entries q ON b.current_queue_id = q.id
    WHERE b.is_on_duty = true AND b.status != 'on_break';

    RETURN jsonb_build_object(
        'success', true,
        'waiting_entries', v_waiting_entries,
        'working_barbers', v_working_barbers
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_home_queue_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_home_queue_stats() TO anon, authenticated;

-- D. Customer Cancellation Function (Hardened: FOR UPDATE lock, in_chair check, safe search_path)
CREATE OR REPLACE FUNCTION cancel_my_queue_spot(p_queue_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entry queue_entries%ROWTYPE;
BEGIN
    -- 1. Exclusively lock the row
    SELECT * INTO v_entry
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    -- 2. Reject cancellation for non-waiting entries
    IF v_entry.status = 'called' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel spot: your turn has already been called.');
    ELSIF v_entry.status = 'in_chair' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel spot: service is currently in progress.');
    ELSIF v_entry.status = 'done' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel spot: service is already completed.');
    ELSIF v_entry.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This queue spot has already been cancelled.');
    ELSIF v_entry.status = 'no_show' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel spot: entry was marked as no-show.');
    ELSIF v_entry.status != 'waiting' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel spot: entry is not in waiting status.');
    END IF;

    -- 3. Atomic transition to cancelled
    UPDATE queue_entries
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_queue_id;

    RETURN jsonb_build_object('success', true, 'message', 'Your queue spot has been cancelled successfully.');
END;
$$;

-- Explicitly revoke and grant execution permissions
REVOKE EXECUTE ON FUNCTION cancel_my_queue_spot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_my_queue_spot(UUID) TO anon, authenticated;

-- E. Atomic Call Next Customer (Protected by Session & Row Locks)
CREATE OR REPLACE FUNCTION call_next_customer(
    p_session_token UUID,
    p_barber_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barber barbers%ROWTYPE;
    v_customer queue_entries%ROWTYPE;
BEGIN
    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token 
      AND role IN ('reception', 'admin') 
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    -- Exclusive lock on barber record
    SELECT * INTO v_barber
    FROM barbers
    WHERE id = p_barber_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    IF NOT v_barber.is_on_duty THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber is off duty');
    END IF;

    IF v_barber.status != 'available' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber is currently ' || v_barber.status);
    END IF;

    -- Exclusive lock on earliest eligible customer (first-come, first-served)
    SELECT * INTO v_customer
    FROM queue_entries
    WHERE status = 'waiting'
      AND (preferred_barber_id = p_barber_id OR preferred_barber_id IS NULL)
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No eligible customers waiting');
    END IF;

    -- Transition customer to called
    UPDATE queue_entries
    SET status = 'called',
        assigned_barber_id = p_barber_id,
        called_at = NOW(),
        updated_at = NOW()
    WHERE id = v_customer.id;

    -- Transition barber to serving
    UPDATE barbers
    SET status = 'serving',
        current_queue_id = v_customer.id,
        updated_at = NOW()
    WHERE id = p_barber_id;

    RETURN jsonb_build_object(
        'success', true,
        'customer_id', v_customer.id,
        'token_number', v_customer.token_number,
        'customer_name', v_customer.customer_name,
        'barber_name', v_barber.name
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_staff_pin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_staff_pin(TEXT, TEXT) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION call_next_customer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION call_next_customer(UUID, UUID) TO anon, authenticated;

-- F. Reception Dashboard Getter (Protected by Staff Session)
CREATE OR REPLACE FUNCTION get_reception_dashboard(p_session_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barbers JSONB := '[]'::JSONB;
    v_waiting JSONB := '[]'::JSONB;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role IN ('reception', 'admin')
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'is_on_duty', b.is_on_duty,
            'status', b.status,
            'current_queue_id', b.current_queue_id,
            'current_customer', CASE
                WHEN q.id IS NOT NULL THEN jsonb_build_object(
                    'id', q.id,
                    'token_number', q.token_number,
                    'customer_name', q.customer_name,
                    'phone_number', q.phone_number,
                    'selected_services', q.selected_services,
                    'total_duration', q.total_duration,
                    'total_price', q.total_price,
                    'status', q.status,
                    'is_walk_in', q.is_walk_in,
                    'called_at', q.called_at,
                    'service_started_at', q.service_started_at,
                    'created_at', q.created_at
                )
                ELSE NULL
            END
        )
        ORDER BY b.created_at ASC, b.name ASC
    ), '[]'::JSONB) INTO v_barbers
    FROM barbers b
    LEFT JOIN queue_entries q ON b.current_queue_id = q.id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'token_number', q.token_number,
            'customer_name', q.customer_name,
            'phone_number', q.phone_number,
            'selected_services', q.selected_services,
            'total_duration', q.total_duration,
            'total_price', q.total_price,
            'preferred_barber_id', q.preferred_barber_id,
            'status', q.status,
            'is_walk_in', q.is_walk_in,
            'created_at', q.created_at
        )
        ORDER BY q.created_at ASC, q.id ASC
    ), '[]'::JSONB) INTO v_waiting
    FROM queue_entries q
    WHERE q.status = 'waiting';

    RETURN jsonb_build_object(
        'success', true,
        'barbers', v_barbers,
        'waiting_queue', v_waiting,
        'server_now', NOW()
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_reception_dashboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_reception_dashboard(UUID) TO anon, authenticated;

-- G. Reception Walk-in Customer Addition (Protected by Staff Session; ignores online queue closure)
CREATE OR REPLACE FUNCTION add_walkin_customer(
    p_session_token UUID,
    p_customer_name TEXT,
    p_phone_number TEXT,
    p_service_ids UUID[],
    p_preferred_barber_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_total_duration INT := 0;
    v_total_price NUMERIC := 0;
    v_services_snapshot JSONB := '[]'::JSONB;
    v_service RECORD;
    v_new_id UUID;
    v_token TEXT;
    v_ahead_count INT;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role IN ('reception', 'admin')
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    IF p_customer_name IS NULL OR TRIM(p_customer_name) = '' OR LENGTH(TRIM(p_customer_name)) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please provide a valid customer name');
    END IF;

    IF p_phone_number IS NULL OR NOT (p_phone_number ~ '^[6-9][0-9]{9}$') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please provide a valid 10-digit mobile number');
    END IF;

    IF EXISTS (
        SELECT 1 FROM queue_entries
        WHERE phone_number = p_phone_number
          AND status IN ('waiting', 'called', 'in_chair')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'An active queue entry already exists for this mobile number');
    END IF;

    IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL
       OR array_length(p_service_ids, 1) < 1 OR array_length(p_service_ids, 1) > 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'You must select between 1 and 3 services');
    END IF;

    -- Always compute duration and price strictly from the database services table
    FOR v_service IN
        SELECT id, name_en, name_gu, duration_minutes, price
        FROM services
        WHERE id = ANY(p_service_ids) AND is_active = true
    LOOP
        v_total_duration := v_total_duration + v_service.duration_minutes;
        v_total_price := v_total_price + v_service.price;
        v_services_snapshot := v_services_snapshot || jsonb_build_object(
            'id', v_service.id,
            'name_en', v_service.name_en,
            'name_gu', v_service.name_gu,
            'duration', v_service.duration_minutes,
            'price', v_service.price
        );
    END LOOP;

    IF jsonb_array_length(v_services_snapshot) != array_length(p_service_ids, 1) THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more selected services are unavailable or duplicated');
    END IF;

    IF p_preferred_barber_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM barbers
            WHERE id = p_preferred_barber_id AND is_on_duty = true AND status != 'on_break'
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Selected barber is currently unavailable');
        END IF;
    END IF;

    v_token := generate_next_token();
    v_new_id := gen_random_uuid();

    BEGIN
        INSERT INTO queue_entries (
            id, token_number, customer_name, phone_number, selected_services,
            total_duration, total_price, preferred_barber_id, assigned_barber_id,
            status, is_walk_in, called_at, service_started_at, completed_at,
            created_at, updated_at
        ) VALUES (
            v_new_id, v_token, TRIM(p_customer_name), p_phone_number, v_services_snapshot,
            v_total_duration, v_total_price, p_preferred_barber_id, NULL,
            'waiting', true, NULL, NULL, NULL, NOW(), NOW()
        );
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'An active queue entry already exists for this mobile number');
    END;

    SELECT COUNT(*) INTO v_ahead_count
    FROM queue_entries
    WHERE status = 'waiting' AND created_at < NOW();

    RETURN jsonb_build_object(
        'success', true,
        'queue_id', v_new_id,
        'token_number', v_token,
        'position', v_ahead_count + 1,
        'total_duration', v_total_duration,
        'total_price', v_total_price
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION add_walkin_customer(UUID, TEXT, TEXT, UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_walkin_customer(UUID, TEXT, TEXT, UUID[], UUID) TO anon, authenticated;

-- H. Reception Cancel Waiting Entry (Protected by Staff Session & Row Lock)
CREATE OR REPLACE FUNCTION reception_cancel_entry(
    p_session_token UUID,
    p_queue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_assigned_barber_id UUID;
    v_entry queue_entries%ROWTYPE;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role IN ('reception', 'admin')
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    -- Global locking order: lock barbers FOR UPDATE first, then queue_entries FOR UPDATE
    SELECT assigned_barber_id INTO v_assigned_barber_id
    FROM queue_entries
    WHERE id = p_queue_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    IF v_assigned_barber_id IS NOT NULL THEN
        PERFORM 1
        FROM barbers
        WHERE id = v_assigned_barber_id
        FOR UPDATE;
    END IF;

    SELECT * INTO v_entry
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    IF v_entry.assigned_barber_id IS DISTINCT FROM v_assigned_barber_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue assignment changed concurrently. Please retry.');
    END IF;

    IF v_entry.status != 'waiting' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only waiting queue entries can be cancelled.');
    END IF;

    UPDATE queue_entries
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_queue_id;

    RETURN jsonb_build_object('success', true, 'message', 'Queue entry cancelled successfully.');
END;
$$;

REVOKE EXECUTE ON FUNCTION reception_cancel_entry(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reception_cancel_entry(UUID, UUID) TO anon, authenticated;

-- I. Reception Mark No-Show (Protected by Staff Session, Row Lock, and 10-Minute Rule)
CREATE OR REPLACE FUNCTION reception_mark_noshow(
    p_session_token UUID,
    p_queue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_assigned_barber_id UUID;
    v_entry queue_entries%ROWTYPE;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role IN ('reception', 'admin')
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    -- Global locking order: lock barbers FOR UPDATE first, then queue_entries FOR UPDATE
    SELECT assigned_barber_id INTO v_assigned_barber_id
    FROM queue_entries
    WHERE id = p_queue_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    IF v_assigned_barber_id IS NOT NULL THEN
        PERFORM 1
        FROM barbers
        WHERE id = v_assigned_barber_id
        FOR UPDATE;
    END IF;

    SELECT * INTO v_entry
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    IF v_entry.assigned_barber_id IS DISTINCT FROM v_assigned_barber_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue assignment changed concurrently. Please retry.');
    END IF;

    IF v_entry.status != 'called' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only called customers can be marked as no-show.');
    END IF;

    IF v_entry.called_at IS NULL OR v_entry.called_at > NOW() - INTERVAL '10 minutes' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer can only be marked as no-show after 10 minutes of being called.');
    END IF;

    UPDATE queue_entries
    SET status = 'no_show',
        updated_at = NOW()
    WHERE id = p_queue_id;

    -- Only free the assigned barber if current_queue_id still points to this no-show customer
    IF v_entry.assigned_barber_id IS NOT NULL THEN
        UPDATE barbers
        SET status = 'available',
            current_queue_id = NULL,
            updated_at = NOW()
        WHERE id = v_entry.assigned_barber_id
          AND current_queue_id = p_queue_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Customer marked as no-show and barber freed.');
END;
$$;

REVOKE EXECUTE ON FUNCTION reception_mark_noshow(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reception_mark_noshow(UUID, UUID) TO anon, authenticated;

-- J. Owner/Admin Barber PIN Provisioning (Strict admin session, 4-6 digits, bcrypt only)
CREATE OR REPLACE FUNCTION admin_set_barber_pin(
    p_session_token UUID,
    p_barber_id UUID,
    p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barber barbers%ROWTYPE;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'admin'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    IF p_barber_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber ID is required');
    END IF;

    SELECT * INTO v_barber
    FROM barbers
    WHERE id = p_barber_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    IF p_pin IS NULL OR NOT (p_pin ~ '^[0-9]{4,6}$') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber PIN must be 4 to 6 numeric digits');
    END IF;

    INSERT INTO barber_security (barber_id, pin_hash, updated_at)
    VALUES (p_barber_id, crypt(p_pin, gen_salt('bf')), NOW())
    ON CONFLICT (barber_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        updated_at = NOW();

    -- Revoke active barber sessions for this barber after PIN rotation
    DELETE FROM staff_sessions
    WHERE role = 'barber'
      AND barber_id = p_barber_id;

    RETURN jsonb_build_object(
        'success', true,
        'barber_id', p_barber_id,
        'message', 'Barber PIN updated successfully.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_barber_pin(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_barber_pin(UUID, UUID, TEXT) TO anon, authenticated;

-- K. Barber PIN Verification (Issues 12-hour barber-bound staff_sessions token)
CREATE OR REPLACE FUNCTION verify_barber_pin(
    p_barber_name TEXT,
    p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_barber barbers%ROWTYPE;
    v_hash TEXT;
    v_valid BOOLEAN := FALSE;
    v_recent_failures INT;
    v_rate_key TEXT;
    v_session_token UUID;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_barber_name IS NULL OR TRIM(p_barber_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber name is required');
    END IF;

    IF p_pin IS NULL OR TRIM(p_pin) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please enter your PIN');
    END IF;

    SELECT * INTO v_barber
    FROM barbers
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_barber_name))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    v_rate_key := 'barber:' || v_barber.id::TEXT;

    SELECT COUNT(*) INTO v_recent_failures
    FROM pin_attempt_log
    WHERE role = v_rate_key
      AND success = false
      AND attempted_at > NOW() - INTERVAL '15 minutes';

    IF v_recent_failures >= 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Too many failed attempts. Locked out for 15 minutes.');
    END IF;

    SELECT pin_hash INTO v_hash
    FROM barber_security
    WHERE barber_id = v_barber.id;

    IF NOT FOUND OR v_hash IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber PIN is not configured. Please contact the salon owner.');
    END IF;

    v_valid := (v_hash = crypt(p_pin, v_hash));

    INSERT INTO pin_attempt_log (role, success) VALUES (v_rate_key, v_valid);

    IF NOT v_valid THEN
        RETURN jsonb_build_object('success', false, 'error', 'Incorrect PIN');
    END IF;

    v_session_token := gen_random_uuid();
    v_expires_at := NOW() + INTERVAL '12 hours';

    INSERT INTO staff_sessions (session_token, role, barber_id, expires_at)
    VALUES (v_session_token, 'barber', v_barber.id, v_expires_at);

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'role', 'barber',
        'barber_id', v_barber.id,
        'barber_name', v_barber.name,
        'expires_at', v_expires_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_barber_pin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_barber_pin(TEXT, TEXT) TO anon, authenticated;

-- L. Barber Station Logout / Server-Side Session Invalidation
CREATE OR REPLACE FUNCTION logout_barber_session(
    p_session_token UUID,
    p_barber_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_session_token IS NULL OR p_barber_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    DELETE FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'barber'
      AND barber_id = p_barber_id
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Barber station locked successfully.');
END;
$$;

REVOKE EXECUTE ON FUNCTION logout_barber_session(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION logout_barber_session(UUID, UUID) TO anon, authenticated;

-- M. Authorized Barber View Getter (Customer details returned only to authorized barber session)
CREATE OR REPLACE FUNCTION get_barber_view(
    p_session_token UUID,
    p_barber_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_barber barbers%ROWTYPE;
    v_session staff_sessions%ROWTYPE;
    v_current_customer JSONB := NULL;
    v_next_customer JSONB := NULL;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    IF p_barber_name IS NULL OR TRIM(p_barber_name) = '' THEN
        SELECT * INTO v_barber
        FROM barbers
        ORDER BY created_at ASC, name ASC
        LIMIT 1;
    ELSE
        SELECT * INTO v_barber
        FROM barbers
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_barber_name))
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'barber'
      AND barber_id = v_barber.id
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    -- Fetch currently assigned active customer (never expose phone_number)
    IF v_barber.current_queue_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'id', q.id,
            'token_number', q.token_number,
            'customer_name', q.customer_name,
            'selected_services', q.selected_services,
            'total_duration', q.total_duration,
            'status', q.status,
            'called_at', q.called_at,
            'service_started_at', q.service_started_at,
            'created_at', q.created_at
        ) INTO v_current_customer
        FROM queue_entries q
        WHERE q.id = v_barber.current_queue_id
          AND q.assigned_barber_id = v_barber.id
          AND q.status IN ('called', 'in_chair');
    END IF;

    -- Fetch earliest eligible next waiting customer preview (never expose phone_number)
    SELECT jsonb_build_object(
        'token_number', q.token_number,
        'customer_name', q.customer_name,
        'total_duration', q.total_duration
    ) INTO v_next_customer
    FROM queue_entries q
    WHERE q.status = 'waiting'
      AND (q.preferred_barber_id = v_barber.id OR q.preferred_barber_id IS NULL)
    ORDER BY q.created_at ASC, q.id ASC
    LIMIT 1;

    RETURN jsonb_build_object(
        'success', true,
        'barber', jsonb_build_object(
            'id', v_barber.id,
            'name', v_barber.name,
            'is_on_duty', v_barber.is_on_duty,
            'status', v_barber.status,
            'current_queue_id', v_barber.current_queue_id
        ),
        'current_customer', v_current_customer,
        'next_customer', v_next_customer,
        'server_now', NOW()
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_barber_view(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_barber_view(UUID, TEXT) TO anon, authenticated;

-- N. Barber Start Service (Strict session + global lock order: barbers -> queue_entries)
CREATE OR REPLACE FUNCTION barber_start_service(
    p_session_token UUID,
    p_barber_id UUID,
    p_queue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barber barbers%ROWTYPE;
    v_entry queue_entries%ROWTYPE;
BEGIN
    IF p_session_token IS NULL OR p_barber_id IS NULL OR p_queue_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'barber'
      AND barber_id = p_barber_id
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    -- Global lock order 1: lock barbers row FOR UPDATE
    SELECT * INTO v_barber
    FROM barbers
    WHERE id = p_barber_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    IF NOT v_barber.is_on_duty THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber is currently off duty');
    END IF;

    IF v_barber.current_queue_id IS DISTINCT FROM p_queue_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'This customer is not currently assigned to the barber');
    END IF;

    -- Global lock order 2: lock queue_entries row FOR UPDATE
    SELECT * INTO v_entry
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    IF v_entry.assigned_barber_id IS DISTINCT FROM p_barber_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer is assigned to a different barber');
    END IF;

    IF v_entry.status != 'called' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only a called customer can be started in chair');
    END IF;

    IF EXISTS (
        SELECT 1 FROM queue_entries
        WHERE assigned_barber_id = p_barber_id
          AND status = 'in_chair'
          AND id != p_queue_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber is already serving another customer');
    END IF;

    UPDATE queue_entries
    SET status = 'in_chair',
        service_started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_queue_id;

    UPDATE barbers
    SET status = 'serving',
        updated_at = NOW()
    WHERE id = p_barber_id;

    RETURN jsonb_build_object('success', true, 'status', 'in_chair', 'service_started_at', NOW());
END;
$$;

REVOKE EXECUTE ON FUNCTION barber_start_service(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION barber_start_service(UUID, UUID, UUID) TO anon, authenticated;

-- O. Barber Complete Service (Strict session + global lock order + off-duty preservation)
CREATE OR REPLACE FUNCTION barber_complete_service(
    p_session_token UUID,
    p_barber_id UUID,
    p_queue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barber barbers%ROWTYPE;
    v_entry queue_entries%ROWTYPE;
BEGIN
    IF p_session_token IS NULL OR p_barber_id IS NULL OR p_queue_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'barber'
      AND barber_id = p_barber_id
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    -- Global lock order 1: lock barbers row FOR UPDATE
    SELECT * INTO v_barber
    FROM barbers
    WHERE id = p_barber_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    IF v_barber.current_queue_id IS DISTINCT FROM p_queue_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'This customer is not currently assigned to the barber');
    END IF;

    -- Global lock order 2: lock queue_entries row FOR UPDATE
    SELECT * INTO v_entry
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
    END IF;

    IF v_entry.assigned_barber_id IS DISTINCT FROM p_barber_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer is assigned to a different barber');
    END IF;

    IF v_entry.status != 'in_chair' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only a customer currently in chair can be marked as done');
    END IF;

    UPDATE queue_entries
    SET status = 'done',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_queue_id;

    -- Restore available ONLY if still on duty; preserve off-duty state otherwise.
    UPDATE barbers
    SET status = CASE WHEN is_on_duty THEN 'available' ELSE 'on_break' END,
        current_queue_id = NULL,
        updated_at = NOW()
    WHERE id = p_barber_id
      AND current_queue_id = p_queue_id;

    RETURN jsonb_build_object('success', true, 'status', 'done', 'completed_at', NOW());
END;
$$;

REVOKE EXECUTE ON FUNCTION barber_complete_service(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION barber_complete_service(UUID, UUID, UUID) TO anon, authenticated;

-- P. Barber Availability Toggle (Strict session; blocked while serving)
CREATE OR REPLACE FUNCTION barber_set_availability(
    p_session_token UUID,
    p_barber_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barber barbers%ROWTYPE;
BEGIN
    IF p_session_token IS NULL OR p_barber_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    IF p_new_status NOT IN ('available', 'on_break') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid availability status requested');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'barber'
      AND barber_id = p_barber_id
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired barber session');
    END IF;

    SELECT * INTO v_barber
    FROM barbers
    WHERE id = p_barber_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    IF NOT v_barber.is_on_duty THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber is currently off duty');
    END IF;

    IF v_barber.status = 'serving' OR v_barber.current_queue_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot change break status while an active customer is assigned');
    END IF;

    UPDATE barbers
    SET status = p_new_status,
        updated_at = NOW()
    WHERE id = p_barber_id;

    RETURN jsonb_build_object('success', true, 'status', p_new_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION barber_set_availability(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION barber_set_availability(UUID, UUID, TEXT) TO anon, authenticated;

-- Q. Public Minimum-Data Waiting Area TV Display Feed
-- Never returns customer names, phone numbers, queue IDs, or personal data.
CREATE OR REPLACE FUNCTION get_tv_display()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_settings salon_settings%ROWTYPE;
    v_chairs JSONB := '[]'::JSONB;
    v_next_tokens JSONB := '[]'::JSONB;
    v_waiting_count INT := 0;
BEGIN
    SELECT * INTO v_settings FROM salon_settings WHERE id = 1;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'barber_name', b.name,
            'barber_status', b.status,
            'current_token', CASE WHEN q.status IN ('called', 'in_chair') THEN q.token_number ELSE NULL END,
            'token_status', CASE WHEN q.status IN ('called', 'in_chair') THEN q.status ELSE NULL END
        )
        ORDER BY b.created_at ASC, b.name ASC
    ), '[]'::JSONB) INTO v_chairs
    FROM barbers b
    LEFT JOIN queue_entries q ON b.current_queue_id = q.id
    WHERE b.is_on_duty = true;

    SELECT COALESCE(jsonb_agg(t.token_number), '[]'::JSONB) INTO v_next_tokens
    FROM (
        SELECT q.token_number
        FROM queue_entries q
        WHERE q.status = 'waiting'
        ORDER BY q.created_at ASC, q.id ASC
        LIMIT 5
    ) t;

    SELECT COUNT(*) INTO v_waiting_count
    FROM queue_entries
    WHERE status = 'waiting';

    RETURN jsonb_build_object(
        'success', true,
        'salon_name_en', COALESCE(v_settings.salon_name_en, 'Royal Crown Salon'),
        'salon_name_gu', COALESCE(v_settings.salon_name_gu, 'રોયલ ક્રાઉન સલૂન'),
        'chairs', v_chairs,
        'next_tokens', v_next_tokens,
        'waiting_count', v_waiting_count
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_tv_display() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_tv_display() TO anon, authenticated;

-- R. Staff Session Logout / Server-Side Invalidation (Admin & Reception Exception)
CREATE OR REPLACE FUNCTION logout_staff_session(
    p_session_token UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_session_token IS NULL OR p_role NOT IN ('reception', 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    DELETE FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = p_role
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired staff session');
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Staff session locked successfully.');
END;
$$;

REVOKE EXECUTE ON FUNCTION logout_staff_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION logout_staff_session(UUID, TEXT) TO anon, authenticated;

-- S. Owner/Admin Dashboard Getter (Strict role = 'admin', Asia/Kolkata statistics, no PII/hashes)
CREATE OR REPLACE FUNCTION get_admin_dashboard(p_session_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_settings salon_settings%ROWTYPE;
    v_services JSONB := '[]'::JSONB;
    v_barbers JSONB := '[]'::JSONB;
    v_ist_today_start TIMESTAMPTZ;
    v_ist_tomorrow_start TIMESTAMPTZ;
    v_stats JSONB;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'admin'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_settings FROM salon_settings WHERE id = 1;

    -- All services (both active and deactivated) for owner management
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', s.id,
            'name_en', s.name_en,
            'name_gu', s.name_gu,
            'duration_minutes', s.duration_minutes,
            'price', s.price,
            'is_active', s.is_active,
            'display_order', s.display_order
        )
        ORDER BY s.display_order ASC, s.created_at ASC
    ), '[]'::JSONB) INTO v_services
    FROM services s;

    -- All barbers with has_pin flag only (never expose pin_hash or plain-text PIN)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'is_on_duty', b.is_on_duty,
            'status', b.status,
            'current_queue_id', b.current_queue_id,
            'has_pin', EXISTS (SELECT 1 FROM barber_security bs WHERE bs.barber_id = b.id)
        )
        ORDER BY b.created_at ASC, b.name ASC
    ), '[]'::JSONB) INTO v_barbers
    FROM barbers b;

    -- Today's statistics strictly aligned to Asia/Kolkata local calendar-day boundary
    v_ist_today_start := (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');
    v_ist_tomorrow_start := v_ist_today_start + INTERVAL '1 day';

    SELECT jsonb_build_object(
        'total_today', COUNT(*) FILTER (WHERE created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start),
        'waiting_count', COUNT(*) FILTER (WHERE status = 'waiting'),
        'called_count', COUNT(*) FILTER (WHERE status = 'called'),
        'in_chair_count', COUNT(*) FILTER (WHERE status = 'in_chair'),
        'completed_today', COUNT(*) FILTER (WHERE status = 'done' AND created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start),
        'cancelled_today', COUNT(*) FILTER (WHERE status = 'cancelled' AND created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start),
        'no_show_today', COUNT(*) FILTER (WHERE status = 'no_show' AND created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start),
        'walk_in_today', COUNT(*) FILTER (WHERE is_walk_in = true AND created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start),
        'online_today', COUNT(*) FILTER (WHERE is_walk_in = false AND created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start),
        'estimated_revenue_today', COALESCE(SUM(total_price) FILTER (WHERE status = 'done' AND created_at >= v_ist_today_start AND created_at < v_ist_tomorrow_start), 0),
        'avg_wait_minutes_today', COALESCE(
            ROUND(AVG(
                GREATEST(0, EXTRACT(EPOCH FROM (called_at - created_at)) / 60.0)
            ) FILTER (
                WHERE created_at >= v_ist_today_start
                  AND created_at < v_ist_tomorrow_start
                  AND called_at IS NOT NULL
            ))::INT,
            0
        ),
        'salon_date_ist', TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
    ) INTO v_stats
    FROM queue_entries;

    RETURN jsonb_build_object(
        'success', true,
        'settings', jsonb_build_object(
            'id', v_settings.id,
            'salon_name_en', v_settings.salon_name_en,
            'salon_name_gu', v_settings.salon_name_gu,
            'is_online_queue_open', v_settings.is_online_queue_open,
            'opening_time', v_settings.opening_time,
            'closing_time', v_settings.closing_time,
            'auto_close_buffer_minutes', v_settings.auto_close_buffer_minutes
        ),
        'services', v_services,
        'barbers', v_barbers,
        'stats', v_stats
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_admin_dashboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_dashboard(UUID) TO anon, authenticated;

-- T. Admin Service Create / Edit (Strict role = 'admin', advisory lock for last-active-service)
CREATE OR REPLACE FUNCTION admin_upsert_service(
    p_session_token UUID,
    p_service_id UUID,
    p_name_en TEXT,
    p_name_gu TEXT,
    p_duration_minutes INT,
    p_price NUMERIC,
    p_is_active BOOLEAN DEFAULT true,
    p_display_order INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_name_en TEXT;
    v_name_gu TEXT;
    v_order INT;
    v_existing services%ROWTYPE;
    v_other_active_count INT;
    v_result services%ROWTYPE;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'admin'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    v_name_en := TRIM(COALESCE(p_name_en, ''));
    v_name_gu := TRIM(COALESCE(p_name_gu, ''));

    IF LENGTH(v_name_en) < 1 OR LENGTH(v_name_en) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'English service name must be between 1 and 100 characters');
    END IF;

    IF LENGTH(v_name_gu) < 1 OR LENGTH(v_name_gu) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Gujarati service name must be between 1 and 100 characters');
    END IF;

    IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 OR p_duration_minutes > 480 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Service duration must be between 1 and 480 minutes');
    END IF;

    IF p_price IS NULL OR p_price < 0 OR p_price > 100000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Service price must be between 0 and 100000');
    END IF;

    IF p_display_order IS NOT NULL AND p_display_order < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Display order must be 0 or greater');
    END IF;

    -- Serialize service active-count mutations across concurrent transactions
    PERFORM pg_advisory_xact_lock(hashtext('services_active_guard'));

    IF p_service_id IS NULL THEN
        IF p_display_order IS NULL THEN
            SELECT COALESCE(MAX(display_order), 0) + 1 INTO v_order FROM services;
        ELSE
            v_order := p_display_order;
        END IF;

        INSERT INTO services (
            name_en, name_gu, duration_minutes, price, is_active, display_order, created_at, updated_at
        ) VALUES (
            v_name_en, v_name_gu, p_duration_minutes, p_price, COALESCE(p_is_active, true), v_order, NOW(), NOW()
        )
        RETURNING * INTO v_result;
    ELSE
        SELECT * INTO v_existing FROM services WHERE id = p_service_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Service not found');
        END IF;

        IF NOT COALESCE(p_is_active, v_existing.is_active) THEN
            SELECT COUNT(*) INTO v_other_active_count
            FROM services
            WHERE is_active = true AND id != p_service_id;

            IF v_other_active_count = 0 THEN
                RETURN jsonb_build_object('success', false, 'error', 'At least one active service must remain available');
            END IF;
        END IF;

        UPDATE services
        SET name_en = v_name_en,
            name_gu = v_name_gu,
            duration_minutes = p_duration_minutes,
            price = p_price,
            is_active = COALESCE(p_is_active, v_existing.is_active),
            display_order = COALESCE(p_display_order, v_existing.display_order),
            updated_at = NOW()
        WHERE id = p_service_id
        RETURNING * INTO v_result;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'service', jsonb_build_object(
            'id', v_result.id,
            'name_en', v_result.name_en,
            'name_gu', v_result.name_gu,
            'duration_minutes', v_result.duration_minutes,
            'price', v_result.price,
            'is_active', v_result.is_active,
            'display_order', v_result.display_order
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_upsert_service(UUID, UUID, TEXT, TEXT, INT, NUMERIC, BOOLEAN, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_upsert_service(UUID, UUID, TEXT, TEXT, INT, NUMERIC, BOOLEAN, INT) TO anon, authenticated;

-- U. Admin Service Activation / Deactivation Toggle (Advisory lock + recheck before deactivation)
CREATE OR REPLACE FUNCTION admin_toggle_service_status(
    p_session_token UUID,
    p_service_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_service services%ROWTYPE;
    v_other_active_count INT;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'admin'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    IF p_service_id IS NULL OR p_is_active IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Service ID and active status are required');
    END IF;

    -- Serialize service active-count mutations across concurrent transactions
    PERFORM pg_advisory_xact_lock(hashtext('services_active_guard'));

    SELECT * INTO v_service FROM services WHERE id = p_service_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Service not found');
    END IF;

    IF NOT p_is_active THEN
        SELECT COUNT(*) INTO v_other_active_count
        FROM services
        WHERE is_active = true AND id != p_service_id;

        IF v_other_active_count = 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'At least one active service must remain available');
        END IF;
    END IF;

    UPDATE services
    SET is_active = p_is_active,
        updated_at = NOW()
    WHERE id = p_service_id;

    RETURN jsonb_build_object('success', true, 'is_active', p_is_active);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_toggle_service_status(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_toggle_service_status(UUID, UUID, BOOLEAN) TO anon, authenticated;

-- V. Admin Barber Duty & Availability Update (Active-customer safety guards)
CREATE OR REPLACE FUNCTION admin_update_barber(
    p_session_token UUID,
    p_barber_id UUID,
    p_is_on_duty BOOLEAN,
    p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_barber barbers%ROWTYPE;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'admin'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    IF p_barber_id IS NULL OR p_is_on_duty IS NULL OR p_status NOT IN ('available', 'on_break', 'serving') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid barber update parameters');
    END IF;

    SELECT * INTO v_barber
    FROM barbers
    WHERE id = p_barber_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barber not found');
    END IF;

    -- While serving an active customer, owner may set is_on_duty = false without interrupting,
    -- but must preserve status = 'serving'.
    IF (v_barber.current_queue_id IS NOT NULL OR v_barber.status = 'serving') AND p_status != 'serving' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot change barber availability while an active customer is assigned');
    END IF;

    IF v_barber.current_queue_id IS NULL AND v_barber.status != 'serving' AND p_status = 'serving' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot set barber status to serving without an assigned customer');
    END IF;

    UPDATE barbers
    SET is_on_duty = p_is_on_duty,
        status = p_status,
        updated_at = NOW()
    WHERE id = p_barber_id;

    RETURN jsonb_build_object(
        'success', true,
        'barber_id', p_barber_id,
        'is_on_duty', p_is_on_duty,
        'status', p_status
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_update_barber(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_barber(UUID, UUID, BOOLEAN, TEXT) TO anon, authenticated;

-- W. Admin Salon Settings & Online Queue Toggle (Preserves 30-min auto-close & walk-ins)
CREATE OR REPLACE FUNCTION admin_update_salon_settings(
    p_session_token UUID,
    p_salon_name_en TEXT,
    p_salon_name_gu TEXT,
    p_is_online_queue_open BOOLEAN,
    p_opening_time TIME,
    p_closing_time TIME,
    p_auto_close_buffer_minutes INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session staff_sessions%ROWTYPE;
    v_name_en TEXT;
    v_name_gu TEXT;
    v_updated salon_settings%ROWTYPE;
BEGIN
    IF p_session_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    SELECT * INTO v_session
    FROM staff_sessions
    WHERE session_token = p_session_token
      AND role = 'admin'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Invalid or expired admin session');
    END IF;

    v_name_en := TRIM(COALESCE(p_salon_name_en, ''));
    v_name_gu := TRIM(COALESCE(p_salon_name_gu, ''));

    IF LENGTH(v_name_en) < 1 OR LENGTH(v_name_en) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'English salon name must be between 1 and 100 characters');
    END IF;

    IF LENGTH(v_name_gu) < 1 OR LENGTH(v_name_gu) > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Gujarati salon name must be between 1 and 100 characters');
    END IF;

    IF p_is_online_queue_open IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Online queue open flag is required');
    END IF;

    IF p_opening_time IS NULL OR p_closing_time IS NULL OR p_opening_time >= p_closing_time THEN
        RETURN jsonb_build_object('success', false, 'error', 'Opening time must be earlier than closing time');
    END IF;

    IF p_auto_close_buffer_minutes IS NULL OR p_auto_close_buffer_minutes < 0 OR p_auto_close_buffer_minutes > 180 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Auto-close buffer must be between 0 and 180 minutes');
    END IF;

    UPDATE salon_settings
    SET salon_name_en = v_name_en,
        salon_name_gu = v_name_gu,
        is_online_queue_open = p_is_online_queue_open,
        opening_time = p_opening_time,
        closing_time = p_closing_time,
        auto_close_buffer_minutes = p_auto_close_buffer_minutes,
        updated_at = NOW()
    WHERE id = 1
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object(
        'success', true,
        'settings', jsonb_build_object(
            'id', v_updated.id,
            'salon_name_en', v_updated.salon_name_en,
            'salon_name_gu', v_updated.salon_name_gu,
            'is_online_queue_open', v_updated.is_online_queue_open,
            'opening_time', v_updated.opening_time,
            'closing_time', v_updated.closing_time,
            'auto_close_buffer_minutes', v_updated.auto_close_buffer_minutes
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_update_salon_settings(UUID, TEXT, TEXT, BOOLEAN, TIME, TIME, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_salon_settings(UUID, TEXT, TEXT, BOOLEAN, TIME, TIME, INT) TO anon, authenticated;

-- 14. Realtime Publication & Zero-Data Broadcast Notification Trigger
ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries, barbers, salon_settings, services;

CREATE OR REPLACE FUNCTION notify_salon_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Dispatches an empty '{}' payload over the public broadcast topic
    -- Anonymous clients listen using public anon key without receiving any customer or barber records
    PERFORM realtime.send(
        '{}'::jsonb,
        'salon_changed',
        'salon-public-updates',
        false
    );
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_entries_notify ON queue_entries;
CREATE TRIGGER trg_queue_entries_notify
AFTER INSERT OR UPDATE OR DELETE ON queue_entries
FOR EACH STATEMENT
EXECUTE FUNCTION notify_salon_event();

DROP TRIGGER IF EXISTS trg_barbers_notify ON barbers;
CREATE TRIGGER trg_barbers_notify
AFTER INSERT OR UPDATE OR DELETE ON barbers
FOR EACH STATEMENT
EXECUTE FUNCTION notify_salon_event();

DROP TRIGGER IF EXISTS trg_salon_settings_notify ON salon_settings;
CREATE TRIGGER trg_salon_settings_notify
AFTER INSERT OR UPDATE OR DELETE ON salon_settings
FOR EACH STATEMENT
EXECUTE FUNCTION notify_salon_event();

DROP TRIGGER IF EXISTS trg_services_notify ON services;
CREATE TRIGGER trg_services_notify
AFTER INSERT OR UPDATE OR DELETE ON services
FOR EACH STATEMENT
EXECUTE FUNCTION notify_salon_event();

-- 15. Initial Seed Data
INSERT INTO salon_settings (id, salon_name_en, salon_name_gu, is_online_queue_open, opening_time, closing_time)
VALUES (1, 'Royal Crown Salon', 'રોયલ ક્રાઉન સલૂન', true, '09:00:00', '21:00:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO barbers (name, is_on_duty, status) VALUES
('Amit', true, 'available'),
('Rahul', true, 'available'),
('Priya', true, 'available');

INSERT INTO services (name_en, name_gu, duration_minutes, price, display_order) VALUES
('Haircut & Styling', 'હેરકટ અને સ્ટાઇલ', 30, 250, 1),
('Beard Trim & Shape', 'દાઢી ટ્રીમ અને શેપ', 20, 150, 2),
('Head Massage', 'હેડ મસાજ', 25, 200, 3),
('Facial & Cleansing', 'ફેશિયલ અને ક્લીન્સિંગ', 45, 500, 4),
('Hair Color / Dye', 'હેર કલર / ડાઇ', 40, 400, 5);
