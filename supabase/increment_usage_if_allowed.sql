-- Run this once in Supabase SQL Editor.
-- Atomically checks free limit and increments usage in a single transaction.
-- Eliminates the race condition from the previous check-then-increment pattern.

CREATE OR REPLACE FUNCTION increment_usage_if_allowed(p_user_id uuid, p_free_limit int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row users_usage%ROWTYPE;
BEGIN
  -- Ensure row exists
  INSERT INTO users_usage (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Atomic check + increment: only succeeds if under limit
  UPDATE users_usage
  SET total_requests = total_requests + 1
  WHERE user_id = p_user_id
    AND (plan != 'free' OR total_requests < p_free_limit)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM users_usage WHERE user_id = p_user_id;
    RETURN json_build_object('allowed', false, 'plan', v_row.plan, 'total', v_row.total_requests);
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'plan', v_row.plan,
    'remaining', CASE WHEN v_row.plan = 'free' THEN p_free_limit - v_row.total_requests ELSE NULL END
  );
END;
$$;
