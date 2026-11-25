-- ==============================================================================
-- STAGE 5 ADDITIVE MIGRATION: BARBER AUTH, ADMIN PIN PROVISIONING, BARBER VIEW & TV DISPLAY
-- Non-destructive migration (preserves all existing tables and queue records).
-- Synchronized with supabase/schema.sql.
-- NOTE: No predictable default barber PINs are seeded here; production barber
-- PINs must be provisioned securely via admin_set_barber_pin() before use.
-- ==============================================================================

-- 1. Extend staff_sessions to bind barber sessions to a specific barber_id
ALTER TABLE staff_sessions
    ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES barbers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_staff_sessions_barber
    ON staff_sessions (session_token, role, barber_id, expires_at);

-- 2. Private Barber Security Table (Bcrypt hashes only, RLS enabled, no public read)
CREATE TABLE IF NOT EXISTS barber_security (
    barber_id UUID PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE barber_security ENABLE ROW LEVEL SECURITY;

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
