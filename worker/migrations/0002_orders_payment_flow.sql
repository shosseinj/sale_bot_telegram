ALTER TABLE orders ADD COLUMN order_code TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE orders ADD COLUMN payment_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code_unique ON orders(order_code) WHERE order_code <> '';
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code);
