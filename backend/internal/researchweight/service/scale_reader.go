package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/researchweight/domain"
)

// VisionClient is the multimodal JSON call shared by the analyze clients.
type VisionClient interface {
	AnalyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, map[string]any, error)
}

// ScaleReader reads a kitchen scale display with two models from different
// vendors, in parallel, so a reading can be confirmed independently.
type ScaleReader struct {
	primary  VisionClient
	verifier VisionClient
	timeout  time.Duration
}

const defaultScaleReadTimeout = 25 * time.Second

// NewScaleReader returns nil when no model is configured, which turns the
// automatic reading and review off.
func NewScaleReader(primary, verifier VisionClient) *ScaleReader {
	primary, verifier = presentClient(primary), presentClient(verifier)
	if primary == nil {
		primary, verifier = verifier, nil
	}
	if primary == nil {
		return nil
	}
	return &ScaleReader{primary: primary, verifier: verifier, timeout: defaultScaleReadTimeout}
}

// presentClient turns a typed nil (an interface holding a nil pointer, as an
// unconfigured optional client is) into a plain nil.
func presentClient(client VisionClient) VisionClient {
	if client == nil {
		return nil
	}
	if value := reflect.ValueOf(client); value.Kind() == reflect.Pointer && value.IsNil() {
		return nil
	}
	return client
}

// Read returns one reading per configured model. A failed model call becomes
// an unreadable reading with the error kept, never an error for the caller.
func (r *ScaleReader) Read(ctx context.Context, imageURL string) []domain.ScaleReading {
	clients := []VisionClient{r.primary}
	if r.verifier != nil {
		clients = append(clients, r.verifier)
	}
	return r.readWith(ctx, clients, scaleReadingPrompt, imageURL)
}

// ReadPrimary asks only the first model; used to check that an evaluation
// photo does not show the scale display.
func (r *ScaleReader) ReadPrimary(ctx context.Context, imageURL string) domain.ScaleReading {
	return r.readWith(ctx, []VisionClient{r.primary}, scaleReadingPrompt, imageURL)[0]
}

func (r *ScaleReader) readWith(ctx context.Context, clients []VisionClient, prompt, imageURL string) []domain.ScaleReading {
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	readings := make([]domain.ScaleReading, len(clients))
	var wg sync.WaitGroup
	for index, client := range clients {
		wg.Add(1)
		go func(index int, client VisionClient) {
			defer wg.Done()
			raw, meta, err := client.AnalyzeWithImagesAndTemperatureMeta(ctx, prompt, []string{imageURL}, 0)
			if err != nil {
				readings[index] = domain.ScaleReading{Error: truncateRunes(err.Error(), 200)}
				return
			}
			reading := ParseScaleReading(raw)
			if meta != nil {
				reading.Model = strings.TrimSpace(fmt.Sprint(meta["model"]))
			}
			readings[index] = reading
		}(index, client)
	}
	wg.Wait()
	return readings
}

const scaleReadingPrompt = `你在读一张照片里的电子秤（厨房秤、食物秤）显示屏。只读屏幕上显示的数字，不要估计食物重量。
返回 JSON：
{
  "is_scale_display": 照片里是否能看到电子秤的显示屏（true/false）,
  "readable": 显示屏上的数字是否清楚到能逐位读出（true/false）,
  "value": 屏幕上显示的数字，原样照抄成字符串，保留小数位（例如 "452"、"0.452"、"12.5"），读不出时为 "",
  "unit": 屏幕上显示或点亮的单位，取值 g、kg、jin（斤）、liang（两）、oz、lb、lb_oz、ml、unknown 之一,
  "pounds": 仅当单位是 lb_oz（同时显示磅和盎司）时填磅数，否则为 null,
  "ounces": 仅当单位是 lb_oz 时填盎司数，否则为 null,
  "negative": 是否显示负号,
  "tare_indicator": 是否点亮了 TARE、ZERO、去皮或归零标志,
  "reason": 读不出来时简短说明原因（反光、模糊、太暗、被遮挡、不是秤），否则为 ""
}
如果照片里没有秤的显示屏（例如只是一盘菜），is_scale_display 为 false，readable 为 false。不要猜测看不清的位数。`

// unitGrams converts one unit of each display unit into grams.
var unitGrams = map[string]float64{
	"g": 1, "kg": 1000, "jin": 500, "liang": 50, "oz": 28.349523125, "lb": 453.59237,
}

// ParseScaleReading turns a model reply into a reading with grams computed
// by the server. Anything ambiguous comes back unreadable.
func ParseScaleReading(raw map[string]any) domain.ScaleReading {
	reading := domain.ScaleReading{
		IsScaleDisplay: boolField(raw, "is_scale_display"),
		Readable:       boolField(raw, "readable"),
		RawValue:       strings.TrimSpace(stringField(raw, "value")),
		Unit:           strings.ToLower(strings.TrimSpace(stringField(raw, "unit"))),
		Negative:       boolField(raw, "negative"),
		TareIndicator:  boolField(raw, "tare_indicator"),
		Reason:         truncateRunes(strings.TrimSpace(stringField(raw, "reason")), 60),
	}
	if !reading.IsScaleDisplay {
		reading.Readable = false
	}
	if !reading.Readable {
		return reading
	}
	grams, resolution, ok := readingGrams(reading.RawValue, reading.Unit, raw)
	if !ok || reading.Negative {
		reading.Readable = false
		if reading.Reason == "" {
			reading.Reason = "单位或数字无法换算成克"
		}
		return reading
	}
	reading.Grams = &grams
	reading.ResolutionGrams = resolution
	return reading
}

func readingGrams(value, unit string, raw map[string]any) (float64, float64, bool) {
	if unit == "lb_oz" {
		pounds, okPounds := numberField(raw, "pounds")
		ounces, okOunces := numberField(raw, "ounces")
		if !okPounds || !okOunces || pounds < 0 || ounces < 0 {
			return 0, 0, false
		}
		return round1(pounds*unitGrams["lb"] + ounces*unitGrams["oz"]), round1(0.1 * unitGrams["oz"]), true
	}
	factor, known := unitGrams[unit]
	if !known {
		// ml (liquid mode) assumes water density, so it is not a weight.
		return 0, 0, false
	}
	number, err := strconv.ParseFloat(strings.ReplaceAll(value, ",", ""), 64)
	if err != nil || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) {
		return 0, 0, false
	}
	return round1(number * factor), displayResolution(value) * factor, true
}

// displayResolution is the last shown decimal place: "0.45" can only show
// steps of 0.01, "452" steps of 1.
func displayResolution(value string) float64 {
	dot := strings.IndexByte(value, '.')
	if dot < 0 {
		return 1
	}
	return math.Pow(10, -float64(len(value)-dot-1))
}

// ReadingAgreement summarises the readings for the mini program: whether the
// models agree, and which value to prefill.
func ReadingAgreement(readings []domain.ScaleReading, precision float64) (string, *domain.ScaleReading) {
	readable := make([]domain.ScaleReading, 0, len(readings))
	for _, reading := range readings {
		if reading.Readable && reading.Grams != nil {
			readable = append(readable, reading)
		}
	}
	switch {
	case len(readable) == 0:
		return domain.AgreementUnreadable, nil
	case len(readable) == 1:
		return domain.AgreementSingle, &readable[0]
	}
	first := readable[0]
	for _, other := range readable[1:] {
		if !readingMatches(other, *first.Grams, precision) {
			return domain.AgreementDisagree, &first
		}
	}
	return domain.AgreementAgree, &first
}

// readingMatches allows the larger of the scale precision, the display step
// and 1 g: a 0.01 kg display can only ever be within 10 g of the truth.
func readingMatches(reading domain.ScaleReading, grams, precision float64) bool {
	if !reading.Readable || reading.Grams == nil {
		return false
	}
	tolerance := math.Max(math.Max(precision, reading.ResolutionGrams), 1)
	return math.Abs(*reading.Grams-grams) <= tolerance+1e-9
}

func boolField(raw map[string]any, key string) bool {
	switch value := raw[key].(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(strings.TrimSpace(value), "true")
	}
	return false
}

func stringField(raw map[string]any, key string) string {
	switch value := raw[key].(type) {
	case string:
		return value
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case json.Number:
		return value.String()
	}
	return ""
}

func numberField(raw map[string]any, key string) (float64, bool) {
	switch value := raw[key].(type) {
	case float64:
		return value, true
	case json.Number:
		parsed, err := value.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return parsed, err == nil
	}
	return 0, false
}
