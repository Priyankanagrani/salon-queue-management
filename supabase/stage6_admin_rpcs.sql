-- ==============================================================================
-- STAGE 6 ADDITIVE MIGRATION: OWNER SETTINGS (/admin) RPCs & BROADCAST TRIGGERS
-- Non-destructive migration (preserves all existing tables and queue records).
-- Synchronized with canonical Stage 6 sections in supabase/schema.sql.
-- Note: salon_settings and services realtime publication membership is already
-- configured in schema.sql and is intentionally omitted from this migration.
-- ==============================================================================

-- R. Staff Session Logout / Server-Side Invalidation (Admin & Reception Exception)
-- Verifies supplied token belongs strictly to p_role and invalidates only that token.
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

-- X. Broadcast Triggers for salon_settings and services
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
