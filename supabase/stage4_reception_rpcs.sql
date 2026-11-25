-- ==============================================================================
-- STAGE 4 ADDITIVE MIGRATION: RECEPTION DASHBOARD RPCs
-- Non-destructive migration (preserves all existing tables and queue records).
-- Synchronized with supabase/schema.sql.
-- ==============================================================================

-- Ensure explicit execution permissions on existing Stage 1-3 reception/staff RPCs
REVOKE EXECUTE ON FUNCTION verify_staff_pin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_staff_pin(TEXT, TEXT) TO anon, authenticated;

-- E. Atomic Call Next Customer (Updated with deterministic id ASC tie-breaker)
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

    SELECT * INTO v_entry
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Queue entry not found');
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
