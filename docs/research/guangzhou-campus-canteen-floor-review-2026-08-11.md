# 广州市普通高校校区—食堂—楼层首轮核验

> 核验日期：2026-08-11
> 范围：教育部《全国普通高等学校名单（截至 2026 年 6 月 17 日）》中所在地为“广州市”的普通高校。
> 结论口径：学校、校区、食堂与楼层必须能在学校官网、后勤官网、官方招生资料或官方招采资料中闭环对应；搜索摘要、地图平台、百科、自媒体不作为确定记录。

## 一、范围与结论

- 教育部官方主表中，广州共有 **85 所**普通高校：本科 **40 所**、专科 **45 所**。完整候选表见 [guangzhou-university-candidates-2026-08-11.csv](guangzhou-university-candidates-2026-08-11.csv)。
- 本轮在学校官方站点中找到 **17 所**具有“校区—食堂—楼层”证据的高校；其中 **13 所**资料仍可视为当前有效或有近年官方材料相互印证，**4 所**只有较早官方资料，暂列“时效复核”，不能直接上传为 active。
- 其余 **68 所**并不是“没有食堂”，而是本轮尚未找到能够同时证明官方校区名、食堂名和楼层的公开一手资料；一律保留为 `candidate_unverified`，不猜测、不用地图平台补齐。
- 现有后台仅有华南师范大学 2 条广州确定记录。本文件用于扩展研究基线，尚未生成数据库种子，也未写入后台。

教育部来源：

- [2026 年全国高等学校名单发布页](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/t20260618_1441074.html)
- [全国普通高等学校名单 XLS](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618416094865984.xls)
- 下载文件 SHA-256：`29c40f083b639888e429cf40b68f9a75782d1ce81131c99aabca65b65b36eaea`

## 二、当前可保留的确定记录

下表只保留官方资料可以明确对应校区和楼层的记录。一个食堂跨多层时合并为一条，避免把楼层误当成多个食堂。

| 学校 | 官方校区名称 | 食堂／餐厅 | 楼层 | 证据状态 | 官方来源 |
|---|---|---|---|---|---|
| 中山大学 | 广州校区北校园 | 学一食堂 | 学生宿舍区综合楼一、二、三楼 | current_official | [校园生活](https://www.sysu.edu.cn/zdkd1/xysh.htm) |
| 中山大学 | 广州校区北校园 | 杏林阁教工餐厅 | 护理学院首层 | current_official | [校园生活](https://www.sysu.edu.cn/zdkd1/xysh.htm) |
| 中山大学 | 广州校区东校园 | 学一食堂 | 明德园 11 号楼首层 | current_official | [校园生活](https://www.sysu.edu.cn/zdkd1/xysh.htm) |
| 中山大学 | 广州校区东校园 | 学二食堂 | 明德园 11 号楼二层 | current_official | [校园生活](https://www.sysu.edu.cn/zdkd1/xysh.htm) |
| 中山大学 | 广州校区东校园 | 学三食堂 | 至善园 11 号楼首层 | current_official | [校园生活](https://www.sysu.edu.cn/zdkd1/xysh.htm) |
| 中山大学 | 广州校区东校园 | 学四食堂 | 至善园 11 号楼二层 | current_official | [校园生活](https://www.sysu.edu.cn/zdkd1/xysh.htm) |
| 暨南大学 | 石牌校区（校本部） | 第一学生饭堂 | 膳堂大楼首层 | current_official | [校内餐厅](https://jnedp.jnu.edu.cn/xnct/list.htm)、[校区地址](https://www.jnu.edu.cn/yybb/list.htm) |
| 暨南大学 | 石牌校区（校本部） | 第五学生饭堂 | 膳堂大楼二楼 | current_official | [校内餐厅](https://jnedp.jnu.edu.cn/xnct/list.htm)、[校区地址](https://www.jnu.edu.cn/yybb/list.htm) |
| 暨南大学 | 石牌校区（校本部） | 第三学生饭堂 | 膳堂大楼三楼 | current_official | [校内餐厅](https://jnedp.jnu.edu.cn/xnct/list.htm)、[校区地址](https://www.jnu.edu.cn/yybb/list.htm) |
| 华南理工大学 | 五山校区 | 校园咖啡屋 | 逸夫人文馆一楼 | current_official | [Dining](https://sie.scut.edu.cn/2021/0608/c29524a432354/page.htm) |
| 华南理工大学 | 五山校区 | 西湖苑宾馆餐厅 | 西湖苑宾馆一楼 | current_official | [Dining](https://sie.scut.edu.cn/2021/0608/c29524a432354/page.htm) |
| 华南理工大学 | 大学城校区 | 学生第一饭堂清真餐饮区 | 三楼 | current_official | [Dining](https://sie.scut.edu.cn/2021/0608/c29524a432354/page.htm) |
| 华南农业大学 | 五山校部 | 莘园食堂 | 二楼 | current_official | [学校简介](https://www.scau.edu.cn/17623/list.htm)、[食堂技能比赛](https://www.scau.edu.cn/2026/0101/c17646a426088/page.htm) |
| 广州医科大学 | 番禺校区 | 番禺校区食堂 | 一楼、二楼、四楼 | current_official | [餐饮](https://www.gzhmu.edu.cn/xyfw/syxx/shfw/cy.htm) |
| 广州医科大学 | 越秀校区 | 越秀校区食堂 | 二楼餐饮区 | current_official | [餐饮](https://www.gzhmu.edu.cn/xyfw/syxx/shfw/cy.htm) |
| 广州中医药大学 | 大学城校区 | 第一食堂 | 一楼、二楼、三楼 | confirmed_official | [校区简介](https://www.gzucm.edu.cn/xxgk/xxjj.htm)、[食堂活动](https://hqglc.gzucm.edu.cn/info/1004/2227.htm) |
| 广州中医药大学 | 大学城校区 | 第二食堂 | 一楼、二楼 | confirmed_official | [便民通讯录](https://xxgk.gzucm.edu.cn/__local/C/71/38/B89F2EFFB9AF053366274F17AFB_FD586B2A_3A4A1.pdf)、[食堂活动](https://hqglc.gzucm.edu.cn/info/1004/2227.htm) |
| 广州中医药大学 | 三元里校区 | 学生食堂 | 北栋首层、二层 | confirmed_official | [新学生宿舍楼说明](https://hqglc.gzucm.edu.cn/info/1004/2021.htm) |
| 华南师范大学 | 广州校区大学城校园 | 翰园 | 二楼校友用餐专区 | current_official | [饭堂开放日](https://youth.scnu.edu.cn/news/2025/0304/18326.html)、[校友返校餐饮](https://news.scnu.edu.cn/20277) |
| 华南师范大学 | 广州校区石牌校园 | 沁园 | 二楼校友用餐专区 | current_official | [饭堂开放日](https://youth.scnu.edu.cn/news/2025/0304/18326.html)、[校友返校餐饮](https://news.scnu.edu.cn/20277) |
| 广东外语外贸大学 | 白云山校区 | 清雅园 | 一楼、二楼、三楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东外语外贸大学 | 白云山校区 | 学生第一食堂 | 一楼、二楼、三楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东外语外贸大学 | 白云山校区 | 学生第二食堂 | 一楼、二楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东外语外贸大学 | 白云山校区 | 学生第三食堂 | 一楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东外语外贸大学 | 大学城校区 | 学生第一食堂（文采园） | 一楼、二楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东外语外贸大学 | 大学城校区 | 学生第二食堂（博雅园） | 一楼、二楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东外语外贸大学 | 大学城校区 | 学生第三食堂（风采园） | 一楼、二楼 | current_official | [饮食服务](https://hqc.gdufs.edu.cn/info/1002/1444.htm) |
| 广东技术师范大学 | 白云校区 | 学生第一食堂 | 一楼、二楼、三楼 | current_official | [开学保障检查](https://www.gpnu.edu.cn/info/1071/34134.htm)、[档口招采](https://www.gpnu.edu.cn/info/1040/21299.htm) |
| 广东技术师范大学 | 白云校区 | 第三食堂 | 一楼就餐区 | current_official | [食品安全检查](https://www.gpnu.edu.cn/info/1037/63391.htm) |
| 广东工业大学 | 大学城校区 | 东一食堂 | 一楼 | current_official | [后勤改造](https://www.gdut.edu.cn/info/1709/16567.htm) |
| 广东工业大学 | 大学城校区 | 西三食堂 | 一楼、二楼 | current_official | [后勤改造](https://www.gdut.edu.cn/info/1709/16567.htm) |
| 广东工业大学 | 龙洞校区 | 一期学生公寓食堂 | 二楼 | current_official | [后勤改造](https://www.gdut.edu.cn/info/1709/16567.htm) |
| 广东工业大学 | 东风路校区 | 北院食堂 | 一楼 | current_official | [校园卡服务点](https://yx.gdut.edu.cn/guangdonggongyedaxuexiaoyuankahuiyintongxinshengshiyongzhiyin20240709.pdf) |
| 广州南方学院 | 广州从化校区 | 西区食堂 | 西区一、二层 | current_official | [生活服务](https://www.nfu.edu.cn/xyfw/syxx/shfw.htm) |
| 广州南方学院 | 广州从化校区 | 第三食堂 | 东区一层 | current_official | [生活服务](https://www.nfu.edu.cn/xyfw/syxx/shfw.htm) |
| 广州南方学院 | 广州从化校区 | 第四食堂 | 东区二层 | current_official | [生活服务](https://www.nfu.edu.cn/xyfw/syxx/shfw.htm) |
| 广州南方学院 | 广州从化校区 | 第五食堂 | 中区一层 | current_official | [生活服务](https://www.nfu.edu.cn/xyfw/syxx/shfw.htm) |
| 广州南方学院 | 广州从化校区 | 第六食堂 | 中区二、三层 | current_official | [生活服务](https://www.nfu.edu.cn/xyfw/syxx/shfw.htm) |
| 南方医科大学 | 校本部（广州） | 学生一食堂 | 17 栋西侧对面一楼 | confirmed_official | [院内饮食服务](https://portal.smu.edu.cn/twh/info/1046/1601.htm)、[本科招生生活问答](https://portal.smu.edu.cn/bkzs/info/1294/2494.htm) |
| 南方医科大学 | 校本部（广州） | 学生二食堂 | 17 栋西侧对面二楼 | confirmed_official | [院内饮食服务](https://portal.smu.edu.cn/twh/info/1046/1601.htm) |
| 南方医科大学 | 校本部（广州） | 学生三食堂 | 17 栋西侧对面三楼 | confirmed_official | [院内饮食服务](https://portal.smu.edu.cn/twh/info/1046/1601.htm) |
| 南方医科大学 | 校本部（广州） | 学生四食堂 | 17 栋西侧对面四楼 | confirmed_official | [院内饮食服务](https://portal.smu.edu.cn/twh/info/1046/1601.htm) |
| 广州美术学院 | 昌岗校区 | 师生食堂 | 一、二层 | current_official | [2025 食堂经营招标](https://cgzx2.gzarts.edu.cn/portalwebController.do?goArticleDetail=&id=8a8a86da9470f1430194986ef44968e1) |

## 三、官方资料存在，但暂不作为当前确定记录

| 学校 | 校区／食堂 | 官方资料 | 暂缓原因 |
|---|---|---|---|
| 广州大学 | 大学城校区梅苑、兰苑、菊苑；桂花岗校区食堂 | [学校章程](https://www.gzhu.edu.cn/info/1255/10225.htm)、[2012 饮食地图](https://gupa.gzhu.edu.cn/info/1126/9596.htm)、[桂花岗生活指南](https://zsjy.gzhu.edu.cn/info/2021/48551.htm) | 食堂楼层资料分别为 2012、2019 年，学校现已增加黄埔校区；需取得近年后勤或招采资料后再设为 active。 |
| 广东金融学院 | 广州校本部南苑、北苑各层食堂 | [校区说明](https://xxgk.gduf.edu.cn/info/1010/1011.htm)、[2017 饭堂介绍](https://hq.gduf.edu.cn/info/1087/1733.htm) | 楼层资料较旧，且近年学校校区结构发生扩展，需确认广州校本部当前经营状态。 |
| 广东轻工职业技术大学 | 广州／新港校区第一食堂（宿舍 1 栋、7 栋一楼） | [食堂承包文件](https://www.gdqy.edu.cn/__local/9/FB/00/1B14FB1CCEE56AC46C0D857F3E8_7D2197F4_9022D.pdf?e=.pdf)、[新港校区地址](https://wyxy.gdqy.edu.cn/info/1045/2327.htm) | 招标文件沿用升本前校名且年代较早；需确认学校升本后的食堂命名与校区称谓。 |
| 广州体育学院 | 校内学生食堂一、二、三楼 | [校园后勤服务指引](https://hqb.gzsport.edu.cn/info/14907) | 官方页面没有给该食堂的正式名称，也没有明确将单一地址称为哪个校区；暂不满足“精确到校区名称”。 |
| 广州城市理工学院 | 4 个食堂、共 2.93 万平方米 | [后勤处简介](https://hq.gcu.edu.cn/hqcjj/list.htm) | 官方资料只有数量，没有逐个食堂名称和楼层。 |
| 广州城建职业学院 | 广州校区 2 个食堂、合计 5 层 | [食堂经营招标](https://www.gzccc.edu.cn/info/1058/7936.htm) | 官方资料没有把 5 层分配到具体食堂，不能自行拆分。 |

## 四、下一轮核验顺序

1. 优先补齐其余本科院校，逐校查找后勤服务手册、食堂招标文件、校园地图和近两年新生指南；
2. 再核验 45 所专科院校，特别处理学校升格、更名、异地校区和合并后的旧资料；
3. 对本文件“时效复核”记录，只要找到 2024 年以后同名食堂的官方运营、招采或食品安全材料，即可升级为 `confirmed_official_source`；
4. 最终上传文件必须同时保留教育部学校标识码、校区来源、食堂来源、楼层原文、来源日期和审查状态。
