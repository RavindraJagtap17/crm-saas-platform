ALTER TABLE payments
  DROP FOREIGN KEY fk_payments_subscription,
  DROP KEY idx_payments_tenant_subscription;

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_subscription FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE;
