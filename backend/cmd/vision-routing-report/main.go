// vision-routing-report summarizes sanitized routing JSON logs from stdin or a file.
// It does not connect to production, write business data, or approve a provider.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
)

type event struct {
	Message       string  `json:"msg"`
	Mode          string  `json:"execution_mode"`
	Stage         string  `json:"stage"`
	Upstream      string  `json:"upstream"`
	Model         string  `json:"model"`
	Status        string  `json:"status"`
	Reason        string  `json:"reason"`
	Shadow        bool    `json:"shadow"`
	Duration      float64 `json:"duration_ms"`
	InputTokens   int64   `json:"input_tokens"`
	OutputTokens  int64   `json:"output_tokens"`
	UsageReported bool    `json:"usage_reported"`
	Comparison    string  `json:"name_comparison"`
	EvaluationID  string  `json:"evaluation_id"`
}

type summary struct {
	Mode         string         `json:"execution_mode"`
	Stage        string         `json:"stage"`
	Upstream     string         `json:"upstream"`
	Model        string         `json:"model"`
	Shadow       bool           `json:"shadow"`
	Attempts     int            `json:"attempts"`
	Valid        int            `json:"business_valid"`
	Canceled     int            `json:"canceled"`
	Timeouts     int            `json:"timeouts"`
	Failures     map[string]int `json:"failures"`
	ValidRate    float64        `json:"valid_rate_among_terminal"`
	P50          float64        `json:"valid_p50_ms"`
	P95          float64        `json:"valid_p95_ms"`
	InputTokens  int64          `json:"input_tokens"`
	OutputTokens int64          `json:"output_tokens"`
	UsageUnknown int            `json:"usage_unknown_attempts"`
	durations    []float64
}

func main() {
	path := flag.String("input", "-", "JSONL log file; - reads stdin")
	flag.Parse()
	var reader io.Reader = os.Stdin
	if *path != "-" {
		file, err := os.Open(*path)
		if err != nil {
			fatal(err)
		}
		defer file.Close()
		reader = file
	}
	rows := map[string]*summary{}
	comparisons := map[string]map[string]int{}
	skipped := map[string]map[string]int{}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		var e event
		if json.Unmarshal(scanner.Bytes(), &e) != nil {
			continue
		}
		if e.Message == "餐照渠道请求已跳过" {
			key := fmt.Sprintf("%s/%s/%s/%s/%t", e.Mode, e.Stage, e.Upstream, e.Model, e.Shadow)
			if skipped[key] == nil {
				skipped[key] = map[string]int{}
			}
			skipped[key][e.Reason]++
		}
		if e.Message == "A6 餐照影子评估完成" {
			key := e.Mode + "/" + e.Stage + "/" + e.Model
			if comparisons[key] == nil {
				comparisons[key] = map[string]int{}
			}
			comparisons[key][e.Comparison]++
		}
		if e.Message != "餐照渠道请求完成" {
			continue
		}
		key := fmt.Sprintf("%s/%s/%s/%s/%t", e.Mode, e.Stage, e.Upstream, e.Model, e.Shadow)
		s := rows[key]
		if s == nil {
			s = &summary{Mode: e.Mode, Stage: e.Stage, Upstream: e.Upstream, Model: e.Model, Shadow: e.Shadow, Failures: map[string]int{}}
			rows[key] = s
		}
		s.Attempts++
		s.InputTokens += e.InputTokens
		s.OutputTokens += e.OutputTokens
		if !e.UsageReported {
			s.UsageUnknown++
		}
		switch e.Status {
		case "valid":
			s.Valid++
			s.durations = append(s.durations, e.Duration)
		case "canceled":
			s.Canceled++
		default:
			s.Failures[e.Status]++
			if e.Status == "timeout" {
				s.Timeouts++
			}
		}
	}
	if err := scanner.Err(); err != nil {
		fatal(err)
	}
	keys := []string{}
	for key := range rows {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := []*summary{}
	for _, key := range keys {
		s := rows[key]
		terminal := s.Attempts - s.Canceled
		if terminal > 0 {
			s.ValidRate = float64(s.Valid) / float64(terminal)
		}
		sort.Float64s(s.durations)
		s.P50 = percentile(s.durations, .5)
		s.P95 = percentile(s.durations, .95)
		out = append(out, s)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(map[string]any{"channels": out, "name_comparisons": comparisons, "skipped": skipped, "notes": []string{
		"名称一致率不是准确率，需结合人工盲评。",
		"已取消的慢请求没有完整耗时，在线竞速样本P95存在截尾偏差；评估A6看独立影子样本。",
		"取消请求仍可能收费；usage_unknown_attempts不能按零成本计算。",
		"未自动批准或切换任何渠道；500条样本和人工质量验收仍需完成。",
	}}); err != nil {
		fatal(err)
	}
}

func percentile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	return values[int(math.Ceil(float64(len(values))*p))-1]
}

func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
