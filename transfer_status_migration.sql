-- ============================================================
-- Transfer Status Table
-- ติดตามสถานะการโอนเงิน (Mat Cost + กำไรสุทธิ) ต่อวัน/Platform
-- ============================================================

CREATE TABLE IF NOT EXISTS transfer_status (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_date             DATE        NOT NULL,
  platform              TEXT        NOT NULL,
  mat_transferred       BOOLEAN     NOT NULL DEFAULT FALSE,
  mat_transferred_at    TIMESTAMPTZ,
  profit_transferred    BOOLEAN     NOT NULL DEFAULT FALSE,
  profit_transferred_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_date, platform)
);

ALTER TABLE transfer_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage transfer_status"
  ON transfer_status FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
