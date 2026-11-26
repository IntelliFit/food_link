package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"

	"food_link/backend/pkg/logger"
)

// The pet chat runs on DeepSeek's official API when its key is configured. Everything
// else in this package keeps using preferredTextLLM. The pet chat tools, validators and
// rule fallbacks are unchanged: only the model behind them and its request options are.
const (
	petChatDeepSeekModel    = "deepseek-flash"
	petChatDeepSeekProvider = "deepseek_official"
	// petChatDeepSeekThinkingHeadroom is added to max_tokens when thinking is on: the
	// official API counts reasoning toward max_tokens, so a cap sized for the answer
	// alone would come back cut off. Only tokens actually used are billed.
	petChatDeepSeekThinkingHeadroom = 16000
	// petChatSafetyRefusalText replaces an answer DeepSeek's safety check refused.
	petChatSafetyRefusalText = "这个问题我没法回答。我们换个和吃饭、运动或身体有关的话题吧。"
)

// errPetChatSafetyRefused marks a request DeepSeek's safety check blocked, on the way in
// (HTTP 400 "Content Exists Risk") or on the way out (finish_reason content_filter). A
// refusal is final for the turn: it must never be retried on another model.
var errPetChatSafetyRefused = errors.New("宠物对话内容未通过模型安全审核")

// petChatStreamOutcome is written by a stream reader before it closes its channel, so the
// consumer reads it once the channel is drained.
type petChatStreamOutcome struct {
	safetyRefused atomic.Bool
}

func (o *petChatStreamOutcome) refused() bool {
	return o != nil && o.safetyRefused.Load()
}

func isPetChatSafetyRefusal(err error) bool {
	return errors.Is(err, errPetChatSafetyRefused)
}

// deepSeekContentRiskResponse reports whether an error response is DeepSeek refusing the
// request input.
func deepSeekContentRiskResponse(status int, body []byte) bool {
	return status == 400 && strings.Contains(strings.ToLower(string(body)), "content exists risk")
}

func isContentFilterFinish(reason string) bool {
	return strings.EqualFold(strings.TrimSpace(reason), "content_filter")
}

// petChatDeepSeekLLM returns the official DeepSeek config when the pet chat should use it.
func (s *StatsService) petChatDeepSeekLLM() (textLLMRuntimeConfig, bool) {
	if s == nil || s.cfg == nil {
		return textLLMRuntimeConfig{}, false
	}
	external := s.cfg.External
	apiKey := strings.TrimSpace(external.DeepSeekOfficialAPIKey)
	provider := strings.ToLower(strings.TrimSpace(external.PetChatLLMProvider))
	if apiKey == "" || (provider != "" && provider != "deepseek") {
		return textLLMRuntimeConfig{}, false
	}
	baseURL := strings.TrimRight(strings.TrimSpace(external.DeepSeekOfficialBaseURL), "/")
	if baseURL == "" {
		baseURL = defaultDeepSeekBaseURL
	}
	return textLLMRuntimeConfig{BaseURL: baseURL, APIKey: apiKey, Model: petChatDeepSeekModel, Provider: petChatDeepSeekProvider}, true
}

// petChatFallbackLLM is the model a pet chat turn retries on when DeepSeek fails for a
// reason other than its safety check: the Qwen setup the chat used before.
func (s *StatsService) petChatFallbackLLM(llm textLLMRuntimeConfig) (textLLMRuntimeConfig, bool) {
	if llm.Provider != petChatDeepSeekProvider {
		return textLLMRuntimeConfig{}, false
	}
	fallback := s.preferredTextLLM()
	if fallback.Provider != "qwen" || strings.TrimSpace(fallback.APIKey) == "" {
		return textLLMRuntimeConfig{}, false
	}
	return fallback, true
}

// petChatRetryLLM returns Qwen when err is a DeepSeek failure worth retrying there: not a
// safety refusal and not the caller giving up.
func (s *StatsService) petChatRetryLLM(ctx context.Context, llm textLLMRuntimeConfig, err error) (textLLMRuntimeConfig, bool) {
	if err == nil || isPetChatSafetyRefusal(err) || ctx.Err() != nil {
		return textLLMRuntimeConfig{}, false
	}
	fallback, ok := s.petChatFallbackLLM(llm)
	if ok {
		logger.Warn(ctx, "宠物对话 DeepSeek 调用失败，本轮改用 Qwen", slog.String("model", llm.Model), logger.Err(err))
	}
	return fallback, ok
}

// requestPetChatCompletion sends one tool-protocol round. When DeepSeek fails for a reason
// other than its safety check, it switches *llm to Qwen and retries, so the rest of the
// turn stays on Qwen too.
func (s *StatsService) requestPetChatCompletion(ctx context.Context, llm *textLLMRuntimeConfig, messages, tools []map[string]any, toolChoice any, thinking ...bool) (campusDietAgentCompletion, error) {
	completion, err := s.requestCampusDietAgentCompletion(ctx, *llm, messages, tools, toolChoice, thinking...)
	fallback, ok := s.petChatRetryLLM(ctx, *llm, err)
	if !ok {
		return completion, err
	}
	*llm = fallback
	return s.requestCampusDietAgentCompletion(ctx, *llm, messages, tools, toolChoice, thinking...)
}

func isPetChatDeepSeekModel(model string) bool {
	return strings.EqualFold(strings.TrimSpace(model), petChatDeepSeekModel)
}

// applyDeepSeekPetChatOptions turns a request body built for Qwen into one for DeepSeek's
// official API: Qwen-only fields go, thinking is set explicitly (it defaults to on), the
// safety check is on, and images are read at high detail.
func applyDeepSeekPetChatOptions(body map[string]any, thinking bool) {
	for _, key := range []string{"enable_thinking", "preserve_thinking", "reasoning_effort", "vl_high_resolution_images", "parallel_tool_calls"} {
		delete(body, key)
	}
	tools, _ := body["tools"].([]map[string]any)
	if len(tools) == 0 {
		// OpenAI-style APIs reject tool_choice without tools; "none" is the default anyway.
		delete(body, "tools")
		delete(body, "tool_choice")
		// The safety check only allows text output (HTTP 400 with json_object). The prompts
		// already ask for JSON and the parsers strip code fences, so text mode is enough.
		delete(body, "response_format")
		body["safety_check"] = map[string]any{"level": "high"}
	}
	// With client tools DeepSeek accepts safety_check only in thinking mode, and thinking
	// mode rejects the forced tool choices the meal agent relies on. Tool rounds therefore
	// run without it, as they did on Qwen; every round without tools is checked, which
	// includes the free chat, image reading and the agent's final answer round.
	if thinking {
		body["thinking"] = map[string]any{"type": "enabled"}
		if maxTokens, ok := body["max_tokens"].(int); ok && maxTokens > 0 {
			body["max_tokens"] = maxTokens + petChatDeepSeekThinkingHeadroom
		}
	} else {
		body["thinking"] = map[string]any{"type": "disabled"}
	}
	if messages, ok := body["messages"].([]map[string]any); ok {
		for _, message := range messages {
			parts, ok := message["content"].([]map[string]any)
			if !ok {
				continue
			}
			for _, part := range parts {
				if image, ok := part["image_url"].(map[string]any); ok {
					image["detail"] = "high"
				}
			}
		}
	}
}

// petChatAgentRefusal ends a meal agent turn DeepSeek's safety check refused. The same
// conversation would be refused again, so there is no repair call and no rule-picked meal
// list; the result is free because it carries no recommendation.
func petChatAgentRefusal(ctx context.Context, state *campusDietAgentRunState) *CampusDietAgentResult {
	logger.Warn(ctx, "餐食Agent内容未通过模型安全审核", logger.UserID(state.UserID), slog.String("agent_run_id", state.RunID))
	result := mealHarnessEmptyResult(state, "safety_refused")
	result.Answer = petChatSafetyRefusalText
	result.Recommendation.Title = "换个问题试试"
	result.Recommendation.Summary = petChatSafetyRefusalText
	return result
}
