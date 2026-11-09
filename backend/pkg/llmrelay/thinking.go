package llmrelay

import (
	"encoding/json"
	"strconv"
	"strings"
)

// qwenThinkingHeadroom is added to max_tokens for qwen3.8 calls the relay
// moves off Wanjie. Wanjie keeps thinking tokens out of max_tokens; OpenLux
// counts them, so a cap sized for the answer alone (320 for exercise, 900 for
// campus recommendations, 1200 for pet chat) came back as HTTP 200 with empty
// content after the model spent the whole budget thinking.
const qwenThinkingHeadroom = 1500

// withThinkingHeadroom returns body with qwenThinkingHeadroom added to
// max_tokens when it is an OpenAI-style qwen3.8 request that sets a cap. Any
// other body, or one it cannot parse, is returned unchanged. Other fields keep
// their original bytes.
func withThinkingHeadroom(body []byte) []byte {
	if len(body) == 0 {
		return body
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return body
	}
	var model string
	if err := json.Unmarshal(fields["model"], &model); err != nil || !isQwen38(model) {
		return body
	}
	rawMax, ok := fields["max_tokens"]
	if !ok {
		return body
	}
	var maxTokens float64
	if err := json.Unmarshal(rawMax, &maxTokens); err != nil || maxTokens <= 0 {
		return body
	}
	fields["max_tokens"] = json.RawMessage(strconv.Itoa(int(maxTokens) + qwenThinkingHeadroom))
	out, err := json.Marshal(fields)
	if err != nil {
		return body
	}
	return out
}

func isQwen38(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "qwen3.8")
}
