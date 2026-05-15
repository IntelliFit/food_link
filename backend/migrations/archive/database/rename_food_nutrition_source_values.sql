update public.food_nutrition_library
set source = '项目内置初始营养数据'
where source in ('seed_v1', 'project_seed_nutrition_v1');

update public.food_nutrition_library
set source = '美国农业部食物数据中心（Foundation）'
where source like 'usda_foundation_%';

update public.food_nutrition_library
set source = '美国农业部食物数据中心（SR Legacy）'
where source like 'usda_sr_legacy_%';

update public.food_nutrition_library
set source = '美国农业部食物数据中心（Survey/FNDDS）'
where source like 'usda_survey_fndds_%';

update public.food_nutrition_library
set source = '美国农业部食物数据中心（Experimental）'
where source like 'usda_experimental_%';

update public.food_nutrition_library
set source = '美国农业部食物数据中心（Branded Foods）'
where source like 'usda_branded_%'
   or source like 'usda_branded_foods_%';

update public.food_nutrition_library
set source = '中国营养学会/中国疾控中心食物营养成分查询平台'
where source like 'nlc_chinanutri_%';
