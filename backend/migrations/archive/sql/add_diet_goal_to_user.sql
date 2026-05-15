-- Add diet_goal column to weapp_user table
ALTER TABLE weapp_user 
ADD COLUMN IF NOT EXISTS diet_goal VARCHAR(50);

COMMENT ON COLUMN weapp_user.diet_goal IS '用户目标：fat_loss(减重), muscle_gain(增重), maintain(保持)';
