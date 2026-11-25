-- ==============================================================================
-- STAGE 7: FINAL QUEUE RULES, SECURITY & SYNC POLISH (INCREMENTAL MIGRATION)
-- Additive and idempotent updates on top of Stages 1–6.
-- Safe to run after schema.sql or Stage 4 + Stage 5 + Stage 6 migrations.
-- ==============================================================================

-- 1. B1: Safely remove unused legacy tv_queue_display view (replaced by get_tv_display() RPC)
DROP VIEW IF EXISTS tv_queue_display;

-- 2. A2: Deterministic (created_at, id) index for FCFS queue ordering
CREATE INDEX IF NOT EXISTS idx_queue_waiting_order_id
ON queue_entries (status, created_at ASC, id ASC);

-- 3. A1: Hardened join_queue with Asia/Kolkata operating hours, zero-buffer safety, and unique_violation guard
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

    -- Evaluate operating hours in Asia/Kolkata local salon timezone
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

-- 4. A2: Deterministic (created_at, id) tie-breaking in get_my_queue_status
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

    IF v_entry.preferred_barber_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_ahead_count
        FROM queue_entries
        WHERE status = 'waiting'
          AND (created_at < v_entry.created_at OR (created_at = v_entry.created_at AND id < v_entry.id))
          AND (preferred_barber_id = v_entry.preferred_barber_id OR preferred_barber_id IS NULL);

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

-- 5. B2: Privacy-safe live Home Screen queue stats (zero customer PII)
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
