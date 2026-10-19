package service

import "regexp"

// The user's own words about training around this meal. Only timing that the
// user states counts: a history of workouts, a gym nearby or a liking for sport
// says nothing about this meal.
const mealTrainingActivity = `健身|撸铁|练腿|练胸|练背|练肩|练手|练臀|训练|力量|有氧|跑步|慢跑|游泳|打球|篮球|足球|羽毛球|乒乓球|网球|瑜伽|骑行|爬山|HIIT|运动`

var (
	mealTrainingPost = regexp.MustCompile(`(?:刚|刚刚|才|已经)[^，。；！？,;!?]{0,4}(?:` + mealTrainingActivity + `|练|跑|游|打)[^，。；！？,;!?]{0,3}完|(?:` + mealTrainingActivity + `|练|跑|游)完了?|健完身|(?:打|踢)完(?:篮球|足球|羽毛球|乒乓球|网球|排球|球)|(?:` + mealTrainingActivity + `|锻炼|练)后`)
	// "soon" words may stand without a verb ("半小时后训练"); day-part words may not
	// ("昨天下午训练了" is about the past, "下午要去训练" is about this meal).
	mealTrainingSoon    = regexp.MustCompile(`(?:一会儿?|等会儿?|待会儿?|等下|等一下|马上|稍后|(?:半|一|两|1|2)个?小时后)[^，。；！？,;!?]{0,6}?(?:要|去|准备|打算|想去|得去|会)?[^，。；！？,;!?]{0,4}?(?:` + mealTrainingActivity + `|练)`)
	mealTrainingDayPart = regexp.MustCompile(`(?:下午|晚上|今晚|中午)[^，。；！？,;!?]{0,6}?(?:要|去|准备|打算|想去|得去)[^，。；！？,;!?]{0,4}?(?:` + mealTrainingActivity + `|练)`)
	mealTrainingBefore  = regexp.MustCompile(`(?:` + mealTrainingActivity + `)前`)
	mealTrainingIntent  = regexp.MustCompile(`(?:准备|打算|马上要|就要|正要|要去|得去|想去)[^，。；！？,;!?]{0,2}(?:` + mealTrainingActivity + `|练)`)
	// Places, gear and everyday errands that merely contain a training word ("刚打完饭",
	// "刚旅游完", "练车"), and saying there is no time to train.
	mealTrainingNoise = regexp.MustCompile(`健身房|健身馆|健身中心|运动场|运动馆|运动中心|体育馆|体育场|游泳馆|游泳池|篮球场|足球场|羽毛球馆|训练营|运动鞋|运动服|运动裤|运动饮料|运动员|运动手环|运动会|打完?饭|打完?卡|打完?电话|打完?游戏|游戏|打完?针|旅游|练车|练字|练琴|练习|练歌|练舞|没(?:时间|空)(?:去)?(?:运动|健身|训练|锻炼|练)`)
	mealTrainingPast  = regexp.MustCompile(`昨天|昨晚|昨日|前天|上周|上个月`)
	// A session on a later day says nothing about this meal.
	mealTrainingLater = regexp.MustCompile(`(?:明早|明天|明晚|明日|后天|下周|周末|周[一二三四五六日]|星期[一二三四五六日天]|礼拜[一二三四五六日天])[^，。；！？,;!?]{0,8}`)
	mealTrainingClear = regexp.MustCompile(`不(?:去)?(?:健身|训练|运动|练)了|今天不练|不练了|取消(?:训练|健身)`)
)

// mealTrainingTiming returns "pre" (about to train), "post" (just trained) or ""
// when the question says nothing; clear reports that the user dropped the plan.
func mealTrainingTiming(question string) (timing string, clear bool) {
	question = mealTrainingNoise.ReplaceAllString(question, "")
	question = mealTrainingLater.ReplaceAllString(question, "")
	switch {
	case mealTrainingClear.MatchString(question):
		return "", true
	case mealTrainingPast.MatchString(question):
		return "", false
	case mealTrainingPost.MatchString(question):
		return "post", false
	case mealTrainingSoon.MatchString(question), mealTrainingDayPart.MatchString(question), mealTrainingBefore.MatchString(question), mealTrainingIntent.MatchString(question):
		return "pre", false
	}
	return "", false
}

// v3MacroBand is where the macro targets of one meal are considered met, as a
// share of the meal target. These are versioned engineering tolerances, not a
// sports-nutrition prescription: they only decide how this meal is ranked.
type v3MacroBand struct {
	calLo, calHi, proLo, proHi, carbLo, carbHi, fatLo, fatHi float64
	// fatCapScale tightens the per-meal share of a plan's daily fat ceiling.
	fatCapScale float64
}

func v3MacroBandFor(training string) v3MacroBand {
	switch training {
	case "pre":
		// Carbohydrate-led, little fat, and not a heavy portion.
		return v3MacroBand{calLo: .6, calHi: 1.05, proLo: .6, proHi: 1.2, carbLo: .8, carbHi: 1.5, fatLo: .25, fatHi: .9, fatCapScale: .75}
	case "post":
		// Protein and carbohydrate both matter; the portion is not capped further.
		return v3MacroBand{calLo: .75, calHi: 1.2, proLo: 1.0, proHi: 1.8, carbLo: .8, carbHi: 1.5, fatLo: .4, fatHi: 1.3, fatCapScale: 1}
	}
	return v3MacroBand{calLo: .75, calHi: 1.2, proLo: .75, proHi: 1.6, carbLo: .55, carbHi: 1.35, fatLo: .4, fatHi: 1.3, fatCapScale: 1}
}
