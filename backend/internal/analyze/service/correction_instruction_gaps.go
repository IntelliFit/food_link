package service

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// 用户口语常写“二两、半斤、三两半”。纠错数字校验只认阿拉伯数字，
// 这里把中文重量改写成等价的阿拉伯数字，再交给同一套校验。
var chineseWeightPattern = regexp.MustCompile(`([一二两三四五六七八九十半])(斤|两|公斤|千克)(半)?`)

var chineseWeightDigits = map[string]float64{
	"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "半": 0.5,
}

// 紧跟量词时是“个数”（如“一两个鸡蛋”），不是重量。
var chineseCountClassifiers = "个只块片碗份杯根条盘位人天次口颗粒勺"

func normalizeChineseWeightWords(text string) string {
	matches := chineseWeightPattern.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 0 {
		return text
	}
	var out strings.Builder
	last := 0
	for _, match := range matches {
		end := match[1]
		if next := []rune(text[end:]); len(next) > 0 && strings.ContainsRune(chineseCountClassifiers, next[0]) {
			continue
		}
		value := chineseWeightDigits[text[match[2]:match[3]]]
		if match[6] >= 0 {
			value += 0.5
		}
		out.WriteString(text[last:match[0]])
		out.WriteString(strconv.FormatFloat(value, 'f', -1, 64))
		out.WriteString(text[match[4]:match[5]])
		last = end
	}
	out.WriteString(text[last:])
	return out.String()
}

// 千焦换算后模型常取整到千卡，热量允许 1 千卡误差；重量仍按 0.01 克严格比对。
func correctionAmountMatches(actual, expected float64, energy bool) bool {
	tolerance := 0.01
	if energy {
		tolerance = 1
	}
	return math.Abs(actual-expected) <= tolerance
}

// “这个锅/那碗饭”没写全名时，用菜名末字（菜的形态）绑定数字，
// 但只在恰好对应一道菜时才绑定，存在多道同形态的菜时不猜。
func correctionDishFormTargets(clause string, items, resolved []map[string]any) map[int]bool {
	matched := map[int]bool{}
	for index, item := range items {
		names := []string{stringFromAny(item["name"]), stringFromAny(item["sourceName"])}
		if index < len(resolved) {
			names = append(names, stringFromAny(resolved[index]["name"]))
		}
		for _, name := range names {
			runes := []rune(strings.TrimSpace(name))
			if name == "<nil>" || len(runes) < 2 {
				continue
			}
			if strings.Contains(clause, string(runes[len(runes)-1:])) {
				matched[index] = true
			}
		}
	}
	if len(matched) != 1 {
		return nil
	}
	return matched
}

// 重试后模型计划仍无效时，提示用户补充说明，而不是暴露“parse llm json failed”。
func userFacingCorrectionError(err error) error {
	var parseErr *LLMJSONParseError
	if errors.As(err, &parseErr) {
		return ErrCorrectionInstructionsUnclear
	}
	return err
}
