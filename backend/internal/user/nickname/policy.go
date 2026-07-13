package nickname

import (
	"strings"
	"unicode"

	commonerrors "food_link/backend/internal/common/errors"
)

const maxLength = 30

var prohibitedTerms = []string{
	"色情", "淫秽", "淫荡", "黄色", "黄图", "约炮", "卖淫", "嫖娼", "强奸", "轮奸", "裸聊", "裸照",
	"暴力", "血腥", "虐杀", "杀人", "砍头", "爆头", "肢解", "自杀",
}

func Normalize(value string) string {
	return strings.TrimSpace(value)
}

func Key(value string) string {
	return strings.ToLower(Normalize(value))
}

func Validate(value string) (string, error) {
	value = Normalize(value)
	if value == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "昵称不能为空", HTTPStatus: 400}
	}
	if len([]rune(value)) > maxLength {
		return "", &commonerrors.AppError{Code: 10002, Message: "昵称不能超过30个字符", HTTPStatus: 400}
	}
	if containsProhibitedTerm(value) {
		return "", &commonerrors.AppError{Code: 10002, Message: "昵称包含违规内容，请修改后重试", HTTPStatus: 400}
	}
	return value, nil
}

func DuplicateError() error {
	return &commonerrors.AppError{Code: 10002, Message: "该昵称已被使用，请更换后重试", HTTPStatus: 409}
}

func containsProhibitedTerm(value string) bool {
	var builder strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) || r == '\u200b' || r == '\ufeff' {
			continue
		}
		builder.WriteRune(r)
	}
	compact := builder.String()
	for _, term := range prohibitedTerms {
		if strings.Contains(compact, term) {
			return true
		}
	}
	return false
}
