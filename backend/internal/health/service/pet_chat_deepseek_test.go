package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// petChatModelServer records each request body and answers with respond.
type petChatModelServer struct {
	*httptest.Server
	mu     sync.Mutex
	bodies []map[string]any
	calls  int32
}

func newPetChatModelServer(t *testing.T, respond func(w http.ResponseWriter, body map[string]any)) *petChatModelServer {
	t.Helper()
	server := &petChatModelServer{}
	server.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&server.calls, 1)
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		require.NoError(t, json.Unmarshal(raw, &body))
		server.mu.Lock()
		server.bodies = append(server.bodies, body)
		server.mu.Unlock()
		respond(w, body)
	}))
	t.Cleanup(server.Close)
	return server
}

func (s *petChatModelServer) lastBody() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.bodies) == 0 {
		return nil
	}
	return s.bodies[len(s.bodies)-1]
}

func writePetChatSSE(w http.ResponseWriter, events ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, event := range events {
		_, _ = io.WriteString(w, "data: "+event+"\n\n")
	}
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
}

func writePetChatCompletion(w http.ResponseWriter, content, finishReason string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"choices": []map[string]any{{
		"message": map[string]any{"role": "assistant", "content": content}, "finish_reason": finishReason,
	}}})
}

func writeDeepSeekContentRisk(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_, _ = io.WriteString(w, `{"error":{"message":"Content Exists Risk","type":"invalid_request_error"}}`)
}

func newPetChatDeepSeekTestService(repo *mockStatsRepo, deepSeekURL, qwenURL string) *StatsService {
	cfg := &config.Config{}
	cfg.External.DeepSeekOfficialAPIKey, cfg.External.DeepSeekOfficialBaseURL = "official-key", deepSeekURL
	if qwenURL != "" {
		cfg.External.DashScopeAPIKey, cfg.External.DashScopeBaseURL = "qwen-key", qwenURL
	}
	svc := NewStatsService(repo, nil, cfg)
	svc.client = &http.Client{}
	svc.mealRouterOff = true
	return svc
}

func collectPetChatStream(t *testing.T, svc *StatsService, question string) (types []string, text, errText string, meta *PetChatStreamMeta) {
	t.Helper()
	chunks, err := svc.GeneratePetChatStream(context.Background(), "user-1", PetChatInput{Question: question, Range: "week", SessionID: "session-1"})
	require.NoError(t, err)
	var out strings.Builder
	for chunk := range chunks {
		types = append(types, chunk.Type)
		out.WriteString(chunk.Text)
		if chunk.Error != "" {
			errText = chunk.Error
		}
		if chunk.Meta != nil {
			meta = chunk.Meta
		}
	}
	return types, out.String(), errText, meta
}

// petChatRepoWithMeal holds one meal this week; the chat answers nothing without one.
func petChatRepoWithMeal() *mockStatsRepo {
	now := time.Now()
	return &mockStatsRepo{records: []domain.FoodRecord{
		{UserID: "user-1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &now},
	}}
}

func lastAssistantMessage(repo *mockStatsRepo) string {
	for i := len(repo.petChatMessages) - 1; i >= 0; i-- {
		if repo.petChatMessages[i].Role == "assistant" {
			return repo.petChatMessages[i].Content
		}
	}
	return ""
}

func TestPetChatUsesOfficialDeepSeekOnlyForThePetChat(t *testing.T) {
	svc := newPetChatDeepSeekTestService(&mockStatsRepo{}, "https://deepseek.test", "https://qwen.test")
	for _, hasImages := range []bool{false, true} {
		llm := svc.preferredPetChatLLM(hasImages)
		assert.Equal(t, petChatDeepSeekModel, llm.Model)
		assert.Equal(t, petChatDeepSeekProvider, llm.Provider)
		assert.Equal(t, "https://deepseek.test", llm.BaseURL)
		assert.Equal(t, "official-key", llm.APIKey)
	}
	// Stats insights, the home meal card and the rest keep their model.
	assert.Equal(t, "qwen", svc.preferredTextLLM().Provider)

	svc.cfg.External.PetChatLLMProvider = "qwen"
	assert.Equal(t, statsInsightPreferredModel, svc.preferredPetChatLLM(false).Model, "the rollback switch keeps Qwen")

	svc.cfg.External.PetChatLLMProvider = ""
	svc.cfg.External.DeepSeekOfficialAPIKey = ""
	assert.Equal(t, statsInsightPreferredModel, svc.preferredPetChatLLM(false).Model, "no official key keeps Qwen")
}

func TestApplyDeepSeekPetChatOptionsReplacesQwenFields(t *testing.T) {
	newBody := func() map[string]any {
		return map[string]any{
			"model": petChatDeepSeekModel, "max_tokens": 1200,
			"enable_thinking": true, "preserve_thinking": false, "reasoning_effort": "medium",
			"vl_high_resolution_images": true, "parallel_tool_calls": true,
			"response_format": map[string]any{"type": "json_object"},
			"messages": []map[string]any{{"role": "user", "content": []map[string]any{
				{"type": "image_url", "image_url": map[string]any{"url": "https://img.test/a.jpg"}},
				{"type": "text", "text": "看看"},
			}}},
		}
	}

	body := newBody()
	applyDeepSeekPetChatOptions(body, false)
	for _, key := range []string{"enable_thinking", "preserve_thinking", "reasoning_effort", "vl_high_resolution_images", "parallel_tool_calls", "response_format"} {
		assert.NotContains(t, body, key, "the safety check only allows text output")
	}
	assert.Equal(t, map[string]any{"type": "disabled"}, body["thinking"])
	assert.Equal(t, map[string]any{"level": "high"}, body["safety_check"])
	assert.Equal(t, 1200, body["max_tokens"])
	image := body["messages"].([]map[string]any)[0]["content"].([]map[string]any)[0]["image_url"].(map[string]any)
	assert.Equal(t, "high", image["detail"])

	body = newBody()
	applyDeepSeekPetChatOptions(body, true)
	assert.Equal(t, map[string]any{"type": "enabled"}, body["thinking"])
	assert.Equal(t, 1200+petChatDeepSeekThinkingHeadroom, body["max_tokens"], "reasoning counts toward max_tokens")
}

func TestDeepSeekAgentRoundsNeverThink(t *testing.T) {
	server := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatCompletion(w, `{"answer":"ok"}`, "stop")
	})
	svc := newPetChatDeepSeekTestService(&mockStatsRepo{}, server.URL, "")
	llm := svc.preferredPetChatLLM(false)
	tools := campusDietAgentToolDefinitions()
	messages := []map[string]any{{"role": "user", "content": "今天吃什么，用json回答"}}
	named := map[string]any{"type": "function", "function": map[string]any{"name": "get_meal_context"}}

	for _, tc := range []struct {
		name   string
		choice any
	}{
		{"required tool round", "required"},
		{"named tool round", named},
		{"auto tool round", "auto"},
		{"final round without tools", "none"},
	} {
		roundTools := tools
		if tc.choice == "none" {
			roundTools = nil
		}
		// Even with the user's thinking switch on: DeepSeek rejects forced tools while thinking.
		_, err := svc.requestCampusDietAgentCompletion(context.Background(), llm, messages, roundTools, tc.choice, true)
		require.NoError(t, err, tc.name)
		body := server.lastBody()
		assert.Equal(t, petChatDeepSeekModel, body["model"], tc.name)
		assert.Equal(t, map[string]any{"type": "disabled"}, body["thinking"], tc.name)
		assert.NotContains(t, body, "parallel_tool_calls", tc.name)
		assert.NotContains(t, body, "enable_thinking", tc.name)
		if roundTools == nil {
			assert.NotContains(t, body, "tool_choice", tc.name+": no tool_choice without tools")
			assert.Equal(t, map[string]any{"level": "high"}, body["safety_check"], tc.name)
			assert.NotContains(t, body, "response_format", tc.name+": the safety check only allows text")
		} else {
			// DeepSeek accepts safety_check with client tools only while thinking, and
			// thinking rejects the agent's forced tool choices (verified on the real API).
			assert.Contains(t, body, "tool_choice", tc.name)
			assert.NotContains(t, body, "safety_check", tc.name)
		}
	}
}

func TestMealAgentStopsOnASafetyRefusalWithoutChargingOrRetrying(t *testing.T) {
	for name, respond := range map[string]func(http.ResponseWriter, map[string]any){
		"blocked question": func(w http.ResponseWriter, _ map[string]any) { writeDeepSeekContentRisk(w) },
		"blocked answer":   func(w http.ResponseWriter, _ map[string]any) { writePetChatCompletion(w, "", "content_filter") },
	} {
		deepSeek := newPetChatModelServer(t, respond)
		qwen := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
			writePetChatCompletion(w, `{"answer":"qwen"}`, "stop")
		})
		repo := &mockStatsRepo{
			candidates:     campusDietAgentTestCandidates(6),
			resolvedSchool: &domain.DietRecommendationSchool{ID: "school-tsinghua", Name: "清华大学"},
		}
		svc := newPetChatDeepSeekTestService(repo, deepSeek.URL, qwen.URL)
		state := newCampusDietAgentTestState("initial", nil)
		state.Question = "我是清华学生，今天推荐午餐"
		applyCampusDietAgentQuestionConstraints(&state.Constraints, state.Question)

		result := svc.runCampusDietAgent(context.Background(), state)
		require.NotNil(t, result, name)
		assert.Equal(t, petChatSafetyRefusalText, result.Answer, name)
		assert.False(t, result.AgentUsed, name)
		assert.Empty(t, result.Recommendation.Recommendations, name)
		assert.EqualValues(t, 1, atomic.LoadInt32(&deepSeek.calls), name+": no repair call after a refusal")
		assert.Zero(t, atomic.LoadInt32(&qwen.calls), name)
		credits, _, _ := svc.chargeCampusDietAgent(context.Background(), "user-1", "session-1", result, false, campusDietAgentMealContext{})
		assert.Zero(t, credits, name)
	}
}

func TestPetChatCompletionFallsBackToQwenWhenDeepSeekFails(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		http.Error(w, `{"error":{"message":"Authentication Fails"}}`, http.StatusUnauthorized)
	})
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatCompletion(w, `{"answer":"qwen"}`, "stop")
	})
	svc := newPetChatDeepSeekTestService(&mockStatsRepo{}, deepSeek.URL, qwen.URL)
	llm := svc.preferredPetChatLLM(false)

	completion, err := svc.requestPetChatCompletion(context.Background(), &llm, []map[string]any{{"role": "user", "content": "json"}}, nil, "none")
	require.NoError(t, err)
	assert.Equal(t, `{"answer":"qwen"}`, completion.Message.Content)
	assert.Equal(t, "qwen", llm.Provider, "the rest of the turn stays on Qwen")
	assert.EqualValues(t, 1, atomic.LoadInt32(&deepSeek.calls))
	assert.EqualValues(t, 1, atomic.LoadInt32(&qwen.calls))
	assert.Equal(t, statsInsightPreferredModel, qwen.lastBody()["model"])
	assert.NotContains(t, qwen.lastBody(), "safety_check")
}

func TestPetChatSafetyRefusalIsNeverRetriedOnQwen(t *testing.T) {
	for name, respond := range map[string]func(http.ResponseWriter, map[string]any){
		"blocked question": func(w http.ResponseWriter, _ map[string]any) { writeDeepSeekContentRisk(w) },
		"blocked answer":   func(w http.ResponseWriter, _ map[string]any) { writePetChatCompletion(w, "", "content_filter") },
	} {
		deepSeek := newPetChatModelServer(t, respond)
		qwen := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
			writePetChatCompletion(w, `{"answer":"qwen"}`, "stop")
		})
		svc := newPetChatDeepSeekTestService(&mockStatsRepo{}, deepSeek.URL, qwen.URL)
		llm := svc.preferredPetChatLLM(false)

		_, err := svc.requestPetChatCompletion(context.Background(), &llm, []map[string]any{{"role": "user", "content": "json"}}, nil, "none")
		assert.ErrorIs(t, err, errPetChatSafetyRefused, name)
		assert.Zero(t, atomic.LoadInt32(&qwen.calls), name)

		_, err = svc.requestNutritionInsightOnce(context.Background(), deepSeek.URL, "official-key", petChatDeepSeekModel, "prompt", "", petChatMaxTokens)
		assert.ErrorIs(t, err, errPetChatSafetyRefused, name)
	}
}

func TestPetChatStreamReplacesAnAnswerTheSafetyCheckCutOff(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatSSE(w,
			`{"choices":[{"delta":{"content":"先说半句"},"finish_reason":null}]}`,
			`{"choices":[{"delta":{"content":""},"finish_reason":"content_filter"}]}`,
		)
	})
	repo := petChatRepoWithMeal()
	svc := newPetChatDeepSeekTestService(repo, deepSeek.URL, "")
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)

	types, text, errText, _ := collectPetChatStream(t, svc, "最近睡眠不好怎么办")
	assert.Equal(t, []string{"start", "chunk", "error"}, types)
	assert.Equal(t, "先说半句", text)
	assert.Equal(t, petChatSafetyRefusalText, errText)
	assert.Equal(t, petChatSafetyRefusalText, lastAssistantMessage(repo), "the client reloads this in place of the partial answer")
	assert.Zero(t, guard.consumeCalls, "a refused turn is free")

	body := deepSeek.lastBody()
	assert.Equal(t, petChatDeepSeekModel, body["model"])
	assert.Equal(t, map[string]any{"type": "disabled"}, body["thinking"])
	assert.Equal(t, map[string]any{"level": "high"}, body["safety_check"])
	assert.NotContains(t, body, "enable_thinking")
}

func TestPetChatStreamAnswersABlockedQuestionWithTheRefusal(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) { writeDeepSeekContentRisk(w) })
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatSSE(w, `{"choices":[{"delta":{"content":"不该出现"},"finish_reason":null}]}`)
	})
	repo := petChatRepoWithMeal()
	svc := newPetChatDeepSeekTestService(repo, deepSeek.URL, qwen.URL)
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)

	types, text, _, meta := collectPetChatStream(t, svc, "最近睡眠不好怎么办")
	assert.Equal(t, []string{"start", "chunk", "done"}, types)
	assert.Equal(t, petChatSafetyRefusalText, text)
	require.NotNil(t, meta)
	assert.Equal(t, "safety_refused", meta.BillingStatus)
	assert.Zero(t, meta.CreditsCharged)
	assert.Zero(t, guard.consumeCalls)
	assert.Zero(t, atomic.LoadInt32(&qwen.calls), "a refusal is not retried on Qwen")
	assert.Equal(t, petChatSafetyRefusalText, lastAssistantMessage(repo))
}

func TestPetChatStreamFallsBackToQwenWhenDeepSeekIsDown(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		http.Error(w, `{"error":{"message":"Insufficient Balance"}}`, http.StatusPaymentRequired)
	})
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatSSE(w, `{"choices":[{"delta":{"content":"早点睡，晚饭别太晚"},"finish_reason":null}]}`)
	})
	svc := newPetChatDeepSeekTestService(petChatRepoWithMeal(), deepSeek.URL, qwen.URL)
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)

	types, text, _, meta := collectPetChatStream(t, svc, "最近睡眠不好怎么办")
	assert.Equal(t, []string{"start", "chunk", "done"}, types)
	assert.Equal(t, "早点睡，晚饭别太晚", text)
	require.NotNil(t, meta)
	assert.Equal(t, 1, guard.consumeCalls, "an answered turn is charged as before")
	assert.EqualValues(t, 1, atomic.LoadInt32(&deepSeek.calls))
	assert.EqualValues(t, 1, atomic.LoadInt32(&qwen.calls))
	assert.Equal(t, statsInsightPreferredModel, qwen.lastBody()["model"])
}

func TestOtherFeaturesStayOffDeepSeekWithTheOfficialKey(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatCompletion(w, "不该调用到这里", "stop")
	})
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, body map[string]any) {
		writePetChatCompletion(w, "这周记录了一餐午饭，蛋白质偏少。明天午饭可以加一份鸡蛋或豆腐，晚饭多一份绿叶菜，慢慢把三餐记完整。", "stop")
	})
	svc := newPetChatDeepSeekTestService(petChatRepoWithMeal(), deepSeek.URL, qwen.URL)

	result, err := svc.GenerateInsight(context.Background(), "user-1", "week", 2000, 5)
	require.NoError(t, err)
	assert.NotEmpty(t, result["analysis_summary"])
	assert.Zero(t, atomic.LoadInt32(&deepSeek.calls), "stats insights keep their model")
	assert.Positive(t, atomic.LoadInt32(&qwen.calls))
}

func TestRefusalDetectionIsOnlyForTheDeepSeekPetChatModel(t *testing.T) {
	ctx := context.Background()
	svc := NewStatsService(&mockStatsRepo{}, nil, &config.Config{})
	svc.client = &http.Client{}
	risky := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) { writeDeepSeekContentRisk(w) })
	filtered := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) { writePetChatCompletion(w, "", "content_filter") })

	for _, model := range []string{statsInsightPreferredModel, statsInsightDeepSeekModel} {
		for name, server := range map[string]*petChatModelServer{"400": risky, "content_filter": filtered} {
			_, err := svc.requestNutritionInsightOnce(ctx, server.URL, "k", model, "p", "", 100)
			require.Error(t, err, model+" "+name)
			assert.False(t, isPetChatSafetyRefusal(err), model+" "+name+": other features keep their old errors")
			assert.NotContains(t, server.lastBody(), "safety_check", model)
			assert.NotContains(t, server.lastBody(), "thinking", model)

			llm := textLLMRuntimeConfig{BaseURL: server.URL, APIKey: "k", Model: model, Provider: "qwen"}
			_, err = svc.requestCampusDietAgentCompletion(ctx, llm, []map[string]any{{"role": "user", "content": "json"}}, nil, "none")
			if err != nil {
				assert.False(t, isPetChatSafetyRefusal(err), model+" "+name+": agent request")
			}
		}
	}
}

func TestNonStreamPetChatRefusalIsFreeAndLabelled(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) { writeDeepSeekContentRisk(w) })
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) { writePetChatCompletion(w, "不该出现", "stop") })
	svc := newPetChatDeepSeekTestService(petChatRepoWithMeal(), deepSeek.URL, qwen.URL)
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)

	result, err := svc.GeneratePetChat(context.Background(), "user-1", PetChatInput{Range: "week", Question: "最近睡眠不好怎么办"})
	require.NoError(t, err)
	assert.Equal(t, petChatSafetyRefusalText, result.Answer)
	assert.Equal(t, "safety_refused", result.BillingStatus)
	assert.Zero(t, result.CreditsCharged)
	assert.Zero(t, guard.consumeCalls)
	assert.Zero(t, atomic.LoadInt32(&qwen.calls))
}

func TestNonStreamPetChatFallsBackToQwenWhenDeepSeekIsDown(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		http.Error(w, `{"error":{"message":"Insufficient Balance"}}`, http.StatusPaymentRequired)
	})
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		writePetChatCompletion(w, "我们今晚早点睡，晚饭别吃太晚，睡前少喝浓茶。", "stop")
	})
	svc := newPetChatDeepSeekTestService(petChatRepoWithMeal(), deepSeek.URL, qwen.URL)

	result, err := svc.GeneratePetChat(context.Background(), "user-1", PetChatInput{Range: "week", Question: "最近睡眠不好怎么办"})
	require.NoError(t, err)
	assert.Equal(t, "我们今晚早点睡，晚饭别吃太晚，睡前少喝浓茶。", result.Answer)
	assert.EqualValues(t, 1, atomic.LoadInt32(&deepSeek.calls))
	assert.EqualValues(t, 1, atomic.LoadInt32(&qwen.calls))
}

func TestPetChatLabelReadingFallsBackToQwen(t *testing.T) {
	// DeepSeek answers the label read with something that is not the required JSON.
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		writePetChatCompletion(w, "图片有点糊，看不清", "stop")
	})
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		writePetChatCompletion(w, `{"images":[{"image_index":1,"serving_basis":"每100克","items":[`+
			`{"name":"蛋白质","value":8.5,"unit":"克","raw_text":"蛋白质 8.5克"},`+
			`{"name":"钠","value":420,"unit":"毫克","raw_text":"钠 420毫克"}]}]}`, "stop")
	})
	svc := newPetChatDeepSeekTestService(petChatRepoWithMeal(), deepSeek.URL, qwen.URL)
	images := petChatImageContext{URLs: []string{"https://img.test/label.jpg"}, CurrentCount: 1}

	answer, err := svc.streamPetChatAnswer(context.Background(), svc.preferredPetChatLLM(true), &statsComputation{}, "这个营养成分表里蛋白质和钠多少", nil, false, images)
	require.NoError(t, err)
	require.True(t, answer.LabelOnly)
	assert.Equal(t, "qwen", answer.LLM.Provider)
	var text strings.Builder
	for chunk := range answer.Chunks {
		text.WriteString(chunk)
	}
	assert.Contains(t, text.String(), "钠 420毫克")
	assert.Contains(t, text.String(), "蛋白质 8.5克")
	assert.EqualValues(t, 1, atomic.LoadInt32(&deepSeek.calls))
}

func TestEmptyDeepSeekAnswerFailsTheTurnWithoutCharging(t *testing.T) {
	// Thinking used the whole budget: reasoning streamed, no answer text.
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		writePetChatSSE(w,
			`{"choices":[{"delta":{"reasoning_content":"先想想晚饭"},"finish_reason":null}]}`,
			`{"choices":[{"delta":{"content":""},"finish_reason":"length"}]}`,
		)
	})
	repo := petChatRepoWithMeal()
	svc := newPetChatDeepSeekTestService(repo, deepSeek.URL, "")
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)

	types, text, errText, _ := collectPetChatStream(t, svc, "最近睡眠不好怎么办")
	assert.Equal(t, []string{"start", "error"}, types)
	assert.Empty(t, text)
	assert.NotEmpty(t, errText)
	assert.Zero(t, guard.consumeCalls)
	assert.Empty(t, lastAssistantMessage(repo), "an empty answer is not saved")
}

func TestAcknowledgementFallsBackToQwenWhenDeepSeekFails(t *testing.T) {
	deepSeek := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		http.Error(w, `{"error":{"message":"Authentication Fails"}}`, http.StatusUnauthorized)
	})
	qwen := newPetChatModelServer(t, func(w http.ResponseWriter, _ map[string]any) {
		writePetChatCompletion(w, "好嘞，那就番茄牛腩饭，去桃李园买就行～", "stop")
	})
	svc := newPetChatDeepSeekTestService(withCardOnScreen(), deepSeek.URL, qwen.URL)
	svc.mealRouterOff = false // the acknowledgement asks a model only when model calls are on

	text, meta := acknowledgementReply(t, svc, "就这个吧")
	assert.Equal(t, "好嘞，那就番茄牛腩饭，去桃李园买就行～", text, "worded by Qwen, not the fixed reply")
	require.NotNil(t, meta)
	assert.Equal(t, petChatFreeAcknowledgement, meta.BillingStatus)
	assert.Positive(t, atomic.LoadInt32(&deepSeek.calls))
	assert.Positive(t, atomic.LoadInt32(&qwen.calls))
}
