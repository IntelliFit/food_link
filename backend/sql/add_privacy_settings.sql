-- Add privacy settings columns to weapp_user table
ALTER TABLE weapp_user 
    ADD COLUMN searchable BOOLEAN DEFAULT TRUE,
    ADD COLUMN public_records BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN weapp_user.searchable IS '隐私设置：是否允许在圈子中被搜索到';
COMMENT ON COLUMN weapp_user.public_records IS '隐私设置：是否允许圈子里的其他用户查看自己的饮食记录';
