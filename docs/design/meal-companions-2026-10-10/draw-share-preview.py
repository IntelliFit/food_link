from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Static, fictional flow illustration. Not a WeChat runtime screenshot.
ROOT = Path(__file__).parent
im = Image.new('RGB', (1480, 1450), '#f7f8f5')
d = ImageDraw.Draw(im)
INK, GREEN, MUTED = '#243d31', '#21543e', '#778079'
def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc', size)
def text(x,y,s,size=26,color=INK,bold=False):
    d.text((x,y),s,font=font(size,bold),fill=color)
def box(x,y,w,h,fill,r=16,outline=None):
    d.rounded_rectangle((x,y,x+w,y+h),r,fill=fill,outline=outline,width=2)
def centered(x,y,w,s,size=26,color=INK,bold=False):
    f=font(size,bold)
    d.text((x+(w-d.textlength(s,font=f))/2,y),s,font=f,fill=color)
def button(x,y,w,s):
    box(x,y,w,62,GREEN,15)
    centered(x,y+13,w,s,25,'#ffffff',True)

text(65,44,'一张卡片，把这顿饭约起来',44,bold=True)
text(68,112,'微信群分享 → 约饭详情 → 申请加入',26,MUTED)
box(1130,54,280,47,'#e8ede5',23)
centered(1130,63,280,'示意图 · 非真机截图',20,GREEN)

text(76,190,'01  群里收到的卡片',30,bold=True)
text(819,190,'02  点开后的约饭详情',30,bold=True)

# Left: WeChat group shell (schematic; native styling depends on WeChat).
box(62,250,610,1040,'#ededed',30,'#d8ded8')
text(88,276,'‹',43,'#202820')
centered(115,290,500,'午饭搭子群（8）',27,'#202820',True)
text(613,284,'···',32,'#202820',True)
d.line((63,347,671,347),fill='#dddddd',width=2)
centered(62,375,610,'11:42',20,'#919791')
box(87,433,64,64,'#dedbc7',14)
centered(87,445,64,'宁',30,GREEN,True)
text(170,430,'阿宁',22,MUTED)
box(167,469,477,615,'#ffffff',15)
d.polygon([(167,493),(156,502),(168,513)],fill='#ffffff')
text(187,487,'还差2位！10-12 12:10，',27,'#222b25')
text(187,529,'二食堂一起吃饭',27,'#222b25')

# Match the proportions, colors and information of drawMealInvitation.
card=Image.new('RGB',(500,400),'#f6f5ed')
c=ImageDraw.Draw(card)
c.rectangle((0,0,500,78),fill=GREEN)
def ct(x,baseline,s,size,color=INK,bold=False):
    c.text((x,baseline),s,font=font(size,bold),fill=color,anchor='ls')
ct(34,49,'约饭邀请单',25,'#ffffff',True)
ct(34,128,'午休一起去二食堂',30,INK,True)
ct(34,183,'10-12 12:10 · 北京时间',24)
ct(34,230,'二食堂',28,INK,True)
ct(34,272,'人均 30 元以内 · AA',21,'#626f65')
c.rectangle((26,297,474,369),fill='#e5eddf')
ct(42,329,'还差 2 位 · 共 4 人',23,GREEN,True)
ct(42,354,'点开申请 · 名额以详情页为准',17,'#626f65')
im.paste(card.resize((437,350),Image.Resampling.LANCZOS),(187,588))
d.line((187,966,624,966),fill='#eeeeee',width=2)
box(188,987,35,35,'#e8eee5',9)
centered(188,989,35,'食',21,GREEN,True)
text(236,987,'食探',23,'#656d66')
text(520,990,'小程序',21,'#929892')
text(191,1040,'点击整张卡片，打开这场约饭',18,MUTED)
centered(62,1137,610,'时间、地点、预算、缺几人，一眼能看到',22,MUTED)
d.line((63,1201,671,1201),fill='#dadeda',width=2)
d.ellipse((86,1225,127,1266),outline='#6f7770',width=2)
box(143,1219,397,55,'#ffffff',9)
d.ellipse((558,1225,599,1266),outline='#6f7770',width=2)
text(612,1215,'+',42,'#6f7770')

# Transition arrow between the screens.
d.line((690,727,782,727),fill=GREEN,width=4)
d.polygon([(782,727),(767,717),(767,737)],fill=GREEN)
centered(683,749,112,'点开',23,GREEN,True)

# Right: condensed detail page, with current fields and application flow.
box(808,250,610,1040,'#f6f5ed',30,'#d8ded8')
text(834,276,'‹',43)
centered(852,290,490,'约饭详情',27,INK,True)
box(1286,285,106,38,'#ffffff',19,'#e4e7df')
text(1303,282,'···',23,INK,True)
d.ellipse((1352,295,1374,317),outline=INK,width=3)
d.ellipse((1359,302,1367,310),fill=INK)
text(836,367,'午休一起去二食堂',34,bold=True)
box(833,426,560,477,'#ffffff',20,'#e4e7dc')
d.rounded_rectangle((834,427,1392,437),5,fill=GREEN)
text(859,458,'约饭邀请单',23,GREEN,True)
text(859,507,'10-12 12:10 · 北京时间',27,bold=True)
text(859,553,'二食堂',29,bold=True)
text(859,597,'校园东门旁',22,MUTED)
text(859,641,'人均 30 元以内 · AA',24)
text(859,683,'正在找搭子 · 2/4人（含发起人）',23)
d.line((859,729,1366,729),fill='#dfe5da',width=2)
text(859,747,'还差 2 位 · 共 4 人',23,GREEN,True)
button(859,791,507,'邀请好友 / 群聊')
centered(859,865,507,'复制邀请文案',20,GREEN)

text(845,928,'阿宁 发起',23,bold=True)
text(845,968,'一起吃个午饭，吃完各自回去上班～',22,MUTED)
box(833,1022,560,238,'#ffffff',20,'#e4e7dc')
text(859,1043,'给发起人留句话（可选）',23,bold=True)
box(859,1086,507,65,'#f2f3ed',13)
text(877,1104,'如：同校同学，午休想一起吃',21,'#8c948a')
button(859,1175,507,'申请一起吃')

centered(62,1321,1356,'群友点开卡片 → 查看详情并申请 → 发起人同意后加入',29,GREEN,True)
centered(62,1380,1356,'虚构示例，详情布局作压缩展示；名额以打开时的实时状态为准。',21,MUTED)
im.save(ROOT/'group-share-preview.png',optimize=True)
print(ROOT/'group-share-preview.png')
print('bytes:',(ROOT/'group-share-preview.png').stat().st_size)
