package service

import (
	"regexp"
	"strings"
)

// After a recommendation the user often answers it rather than asking anew:
// "我都说了食堂不是外卖", "你还在推荐这个店", "我就是需要附近商家的呀，你给我点呗".
// Those turns are about the meal on screen and belong to the meal conversation.
// The rule needs a correcting/demanding cue AND a word about where to eat or the
// recommendation itself, so questions about the user's own eating ("我一直吃不胖怎么办",
// "我需要多吃蛋白质吗") stay with the ordinary chat. Generic words such as 需要, 一直,
// 还是, 别 only count right before 推荐 / 给我.
var (
	mealFeedbackCue  = regexp.MustCompile(`不是|我都说了|我说了|说了多少遍|不对|不行|不要|别再|怎么还|怎么又|还在|又在|老是|我就是|我要的是|我要的|我想要|我就要|你给我|(?:给我|帮我)(?:点|推荐|找|选)|能不能给我|可不可以给我|麻烦你|(?:需要|一直|总是|还是|别)(?:再)?(?:给我)?(?:推荐|推)`)
	mealFeedbackNoun = regexp.MustCompile(`食堂|商家|外卖|店|餐厅|餐馆|推荐|附近|这家|那家`)
)

func mealFeedbackOnRecommendation(question string) bool {
	q := strings.Join(strings.Fields(question), "")
	return mealFeedbackCue.MatchString(q) && mealFeedbackNoun.MatchString(q) && !campusDietAgentExplicitTopicSwitch(q)
}

// Follow-ups the strict whole-sentence patterns miss: two requests in one message
// ("便宜一点，20元以内", "我一会要去健身，再推荐一下"), or a short question about the dishes
// on screen ("有汤吗", "能打包吗", "这个菜辣吗"). Questions about the user's own eating
// ("我需要多吃蛋白质吗", "我吃肉会胖吗") are not.
var (
	mealFollowUpAdjust   = regexp.MustCompile(`(?:便宜|实惠|清淡|少油|低脂|高蛋白|减脂|增肌|辣|不辣|甜|咸|量大|管饱)(?:一点|一些|点|些)|太贵|贵了|再推荐|重新推荐|再来一份|再选|换一个|换一份|换几个`)
	mealFollowUpShortAsk = regexp.MustCompile(`^(?:有没有|有|能不能|能|可以|可不可以|这个|那个|这份|这道|它|那)[^，。？！,;!?]{0,6}(?:汤|饭|面|菜|粥|主食|素|辣|甜|咸|打包|外带|堂食|饮料|配菜)[^，。？！,;!?]{0,4}(?:吗|么|嘛|呢)[?？]*$`)
)

func mealCompoundFollowUp(question string) bool {
	q := strings.Join(strings.Fields(question), "")
	if campusDietAgentExplicitTopicSwitch(q) {
		return false
	}
	if campusDietAgentExplicitPriceLimit(q) != nil || campusDietAgentExplicitCalorieLimit(q) != nil || mealFollowUpAdjust.MatchString(q) || mealFollowUpShortAsk.MatchString(q) {
		return true
	}
	timing, _ := mealTrainingTiming(q)
	return timing != ""
}
