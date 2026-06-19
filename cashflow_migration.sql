-- ─────────────────────────────────────────────────────────────
-- Migration: CashFlow support
-- 1. Add mat_amount + profit_amount to transfer_status
-- 2. Create cashbook_entries table
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add amount columns to transfer_status
ALTER TABLE transfer_status
  ADD COLUMN IF NOT EXISTS mat_amount    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_amount numeric DEFAULT 0;

-- 2. cashbook_entries table
CREATE TABLE IF NOT EXISTS cashbook_entries (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  book        text        NOT NULL CHECK (book IN ('mat', 'profit')),
  date        date        NOT NULL,
  description text        NOT NULL,
  category    text        NOT NULL DEFAULT 'อื่นๆ',
  amount      numeric     NOT NULL DEFAULT 0 CHECK (amount > 0),
  notes       text,
  created_at  timestamptz DEFAULT now(),
  created_by  uuid        REFERENCES profiles(id)
);

ALTER TABLE cashbook_entries ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view entries
CREATE POLICY "cashbook_select"
  ON cashbook_entries FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert / update / delete
CREATE POLICY "cashbook_admin_write"
  ON cashbook_entries FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
