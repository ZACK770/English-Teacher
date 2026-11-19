CREATE INDEX IF NOT EXISTS idx_usage_allocations_active_customer
  ON usage_allocations(customer_id, created_at)
  WHERE billed_seconds IS NULL;
