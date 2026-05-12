-- 调试：查看 weapp_user 实际有哪些列
SELECT
  ordinal_position,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'weapp_user'
ORDER BY ordinal_position;

