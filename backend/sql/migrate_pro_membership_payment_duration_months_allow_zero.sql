-- 积分充值等非订阅订单使用 plan_code=points_recharge，duration_months 语义为「不适用」，写入 0。
-- 原表上 pro_membership_payment_records_duration_months_check 往往限制为 >=1，导致 INSERT 23514。
-- 在 PostgreSQL ????/SQL ???? 中整段执行一次即可。

ALTER TABLE public.pro_membership_payment_records
  DROP CONSTRAINT IF EXISTS pro_membership_payment_records_duration_months_check;

ALTER TABLE public.pro_membership_payment_records
  ADD CONSTRAINT pro_membership_payment_records_duration_months_check
  CHECK (duration_months >= 0);
