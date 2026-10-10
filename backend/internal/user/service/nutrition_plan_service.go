package service

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/nutrition"
	"food_link/backend/internal/user/domain"
	userrepo "food_link/backend/internal/user/repo"
	"food_link/backend/pkg/logger"
	"gorm.io/gorm"
)

var planTZ = time.FixedZone("Asia/Shanghai", 8*3600)

type NutritionPlanService struct {
	repo  *userrepo.NutritionPlanRepo
	ready bool
}

func NewNutritionPlanService(repo *userrepo.NutritionPlanRepo) *NutritionPlanService {
	return &NutritionPlanService{repo: repo, ready: repo.SchemaReady()}
}
func (s *NutritionPlanService) SchemaReady() bool { return s.ready }

// Profile updates and the next default version share the owner transaction.
// Applied days and today's existing default version remain immutable.
func (s *NutritionPlanService) UpdateProfileFields(ctx context.Context, userID string, updates map[string]any) (*authrepo.User, error) {
	var updated *authrepo.User
	err := s.repo.WithOwner(ctx, userID, func(r *userrepo.NutritionPlanRepo, previousUser *authrepo.User) error {
		var err error
		updated, err = r.UpdateOwnerFields(ctx, userID, updates)
		if err != nil {
			return err
		}
		defaults, err := r.Defaults(ctx, userID, "2200-12-31")
		if err != nil {
			return err
		}
		latest := planBase(previousUser)
		if len(defaults) == 0 {
			if err := r.SetDefault(ctx, userID, planToday(), latest, false); err != nil {
				return err
			}
		} else {
			latest = defaults[len(defaults)-1].Snapshot
		}
		snapshot := planBase(updated)
		if latest.PlanID != "base" {
			p, err := r.Plan(ctx, userID, latest.PlanID)
			if err != nil {
				return err
			}
			snapshot = makePlanSnapshot(rowPlan(p), snapshot)
		}
		tomorrow := time.Now().In(planTZ).AddDate(0, 0, 1).Format("2006-01-02")
		return r.SetDefault(ctx, userID, tomorrow, snapshot, false)
	})
	if err != nil {
		logger.Error(ctx, "基础目标与默认方案同步失败", err, slog.String("user_id", userID))
		return nil, err
	}
	logger.Info(ctx, "基础目标已保存，后续默认方案已同步", slog.String("user_id", userID))
	return updated, nil
}
func planError(message string, status int) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: status}
}
func logPlanFailure(ctx context.Context, message string, err error, attrs ...slog.Attr) {
	var appErr *commonerrors.AppError
	if errors.As(err, &appErr) && appErr.HTTPStatus < 500 || errors.Is(err, gorm.ErrRecordNotFound) {
		logger.Warn(ctx, message, append(attrs, slog.String("error", err.Error()))...)
	} else {
		logger.Error(ctx, message, err, attrs...)
	}
}
func planToday() string { return time.Now().In(planTZ).Format("2006-01-02") }
func planDate(date string) error {
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Year() < 1900 || d.Year() > 2200 {
		return planError("请选择有效日期", 400)
	}
	return nil
}
func planCopy(targets map[string]float64) map[string]float64 {
	out := map[string]float64{}
	for k, v := range targets {
		out[k] = v
	}
	return out
}
func planBase(user *authrepo.User) domain.NutritionPlanSnapshot {
	targets := ResolveDashboardNutritionTargets(user.TDEE, user.HealthCondition)
	keys := nutrition.MicroNutrientTargetKeyMap()
	for key, value := range nutrition.MicroNutrientDefaultTargets() {
		if k := keys[key]; k != "" {
			if _, ok := targets[k]; !ok {
				targets[k] = value
			}
		}
	}
	fat := targets["fat_target"]
	return domain.NutritionPlanSnapshot{PlanID: "base", NutritionPlanValues: domain.NutritionPlanValues{Name: "基础日", Targets: targets, MicroMode: "profile", AutoCarb: true, FatMin: math.Max(0, math.Round(fat*.85)), FatMax: math.Round(fat * 1.15)}}
}

// Limits here are input bounds, not recommended dietary doses or clinical ULs.
func validatePlanTargets(targets map[string]float64) error {
	allowed := map[string]float64{"calorie_target": 6000, "protein_target": 500, "carbs_target": 1000, "fat_target": 300}
	for _, key := range dashboardMicroTargetKeys {
		allowed[key] = 100000
	}
	for k, v := range targets {
		max, ok := allowed[k]
		if !ok || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > max {
			return planError("请检查营养目标数值与单位", 400)
		}
	}
	for _, k := range []string{"calorie_target", "protein_target", "carbs_target", "fat_target"} {
		if _, ok := targets[k]; !ok {
			return planError("请填写完整的热量与三大营养素", 400)
		}
	}
	if targets["calorie_target"] < 500 {
		return planError("热量目标需在500–6000 kcal之间", 400)
	}
	return nil
}
func NormalizeNutritionPlan(v domain.NutritionPlanValues) (domain.NutritionPlanValues, error) {
	v.Name = strings.TrimSpace(v.Name)
	v.Targets = planCopy(v.Targets)
	if v.Name == "" || utf8.RuneCountInString(v.Name) > 20 {
		return v, planError("方案名称需为1–20个字", 400)
	}
	if v.MicroMode == "" {
		v.MicroMode = "profile"
	}
	if v.MicroMode != "profile" && v.MicroMode != "custom" {
		return v, planError("微量目标继承方式无效", 400)
	}
	switch v.Style {
	case "", "balanced", "protein", "cycle", "mediterranean", "dash":
	default:
		return v, planError("饮食风格无效", 400)
	}
	if math.IsNaN(v.FatMin) || math.IsInf(v.FatMin, 0) || math.IsNaN(v.FatMax) || math.IsInf(v.FatMax, 0) || v.FatMin < 0 || v.FatMax < v.FatMin || v.FatMax > 300 || v.Targets["fat_target"] < v.FatMin || v.Targets["fat_target"] > v.FatMax {
		return v, planError("脂肪参考值须在所设范围内", 400)
	}
	if err := validatePlanTargets(v.Targets); err != nil {
		return v, err
	}
	if v.AutoCarb {
		carbs := (v.Targets["calorie_target"] - 4*v.Targets["protein_target"] - 9*v.Targets["fat_target"]) / 4
		if carbs < 0 {
			return v, planError("热量不足以容纳当前蛋白质与脂肪", 400)
		}
		v.Targets["carbs_target"] = carbs
	} else {
		v.Targets["calorie_target"] = 4*v.Targets["protein_target"] + 4*v.Targets["carbs_target"] + 9*v.Targets["fat_target"]
	}
	for _, k := range dashboardMicroTargetKeys {
		if v.MicroMode == "profile" {
			delete(v.Targets, k)
		} else if x, ok := v.Targets[k]; ok && x <= 0 {
			return v, planError("微量参考值不能为零", 400)
		}
	}
	for k, x := range v.Targets {
		v.Targets[k] = math.Round(x*10) / 10
	}
	return v, validatePlanTargets(v.Targets)
}
func makePlanSnapshot(p domain.NutritionPlan, base domain.NutritionPlanSnapshot) domain.NutritionPlanSnapshot {
	targets := planCopy(base.Targets)
	for k, v := range p.Targets {
		targets[k] = v
	}
	v := p.NutritionPlanValues
	v.Targets = targets
	return domain.NutritionPlanSnapshot{NutritionPlanValues: v, PlanID: p.ID, Revision: p.Revision}
}
func rowPlan(row *userrepo.NutritionPlanRow) domain.NutritionPlan {
	return domain.NutritionPlan{NutritionPlanValues: row.Values, ID: row.ID, Revision: row.Revision}
}
func dayToken(row *domain.DailyNutritionTarget) string {
	if row == nil || row.UpdatedAt == nil {
		return ""
	}
	return row.UpdatedAt.UTC().Format(time.RFC3339Nano)
}
func legacySnapshot(row *domain.DailyNutritionTarget, base domain.NutritionPlanSnapshot) domain.NutritionPlanSnapshot {
	if row.PlanSnapshot != nil {
		return *row.PlanSnapshot
	}
	base.Name = "历史参考目标"
	base.PlanID = ""
	base.Targets = planCopy(base.Targets)
	base.Targets["calorie_target"] = row.CalorieTarget
	base.Targets["protein_target"] = row.ProteinTarget
	base.Targets["carbs_target"] = row.CarbsTarget
	base.Targets["fat_target"] = row.FatTarget
	base.FatMin = row.FatTarget * .85
	base.FatMax = row.FatTarget * 1.15
	return base
}

func (s *NutritionPlanService) ResolveRange(ctx context.Context, userID, start, end string) (map[string]domain.NutritionDay, error) {
	return resolveNutritionRange(ctx, s.repo, userID, start, end)
}
func resolveNutritionRange(ctx context.Context, r *userrepo.NutritionPlanRepo, userID, start, end string) (map[string]domain.NutritionDay, error) {
	if err := planDate(start); err != nil {
		return nil, err
	}
	if err := planDate(end); err != nil {
		return nil, err
	}
	a, _ := time.Parse("2006-01-02", start)
	b, _ := time.Parse("2006-01-02", end)
	if b.Before(a) || b.Sub(a) > 367*24*time.Hour {
		return nil, planError("日期范围过大", 400)
	}
	user, err := r.Owner(ctx, userID)
	if err != nil {
		return nil, err
	}
	base := planBase(user)
	rows, err := r.Days(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}
	defaults, err := r.Defaults(ctx, userID, end)
	if err != nil {
		return nil, err
	}
	byDate := map[string]*domain.DailyNutritionTarget{}
	for i := range rows {
		byDate[rows[i].TargetDate.Format("2006-01-02")] = &rows[i]
	}
	out := map[string]domain.NutritionDay{}
	index := 0
	current := base
	hasDefault := false
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		date := d.Format("2006-01-02")
		for index < len(defaults) && !defaults[index].EffectiveDate.After(d) {
			current = defaults[index].Snapshot
			hasDefault = true
			index++
		}
		day := domain.NutritionDay{Date: date, Snapshot: current, Source: "base", HistoricalReference: !hasDefault && date < planToday()}
		if hasDefault {
			day.Source = "default_plan"
		}
		if row := byDate[date]; row != nil {
			day.Snapshot = legacySnapshot(row, base)
			day.Source = row.Source
			day.HistoricalReference = row.PlanSnapshot == nil
			day.ChangeToken = dayToken(row)
		}
		out[date] = day
	}
	return out, nil
}
func (s *NutritionPlanService) Resolve(ctx context.Context, userID, date string) (domain.NutritionDay, error) {
	days, err := s.ResolveRange(ctx, userID, date, date)
	return days[date], err
}
func (s *NutritionPlanService) ResolveTargets(ctx context.Context, userID, date string) (map[string]float64, error) {
	day, err := s.Resolve(ctx, userID, date)
	return day.Snapshot.Targets, err
}
func (s *NutritionPlanService) Library(ctx context.Context, userID string) (domain.NutritionPlanLibrary, error) {
	user, err := s.repo.Owner(ctx, userID)
	if err != nil {
		return domain.NutritionPlanLibrary{}, err
	}
	base := planBase(user)
	rows, err := s.repo.Plans(ctx, userID)
	if err != nil {
		return domain.NutritionPlanLibrary{}, err
	}
	defaults, err := s.repo.Defaults(ctx, userID, planToday())
	if err != nil {
		return domain.NutritionPlanLibrary{}, err
	}
	result := domain.NutritionPlanLibrary{Plans: []domain.NutritionPlan{{ID: "base", NutritionPlanValues: base.NutritionPlanValues}}, DefaultID: "base", BaseTargets: base.Targets}
	for i := range rows {
		result.Plans = append(result.Plans, rowPlan(&rows[i]))
	}
	if len(defaults) > 0 {
		result.DefaultID = defaults[len(defaults)-1].Snapshot.PlanID
	}
	return result, nil
}
func (s *NutritionPlanService) Create(ctx context.Context, userID string, values []domain.NutritionPlanValues) (domain.NutritionPlanLibrary, error) {
	if len(values) < 1 || len(values) > 2 {
		return domain.NutritionPlanLibrary{}, planError("每次可添加一套方案或一组训练／休息方案", 400)
	}
	normalized := make([]domain.NutritionPlanValues, len(values))
	for i, v := range values {
		n, err := NormalizeNutritionPlan(v)
		if err != nil {
			return domain.NutritionPlanLibrary{}, err
		}
		normalized[i] = n
	}
	err := s.repo.WithOwner(ctx, userID, func(r *userrepo.NutritionPlanRepo, _ *authrepo.User) error {
		plans, err := r.Plans(ctx, userID)
		if err != nil {
			return err
		}
		if len(plans)+len(values) > 20 {
			return planError("最多保存20套方案，请先整理已有方案", 409)
		}
		return r.Create(ctx, userID, normalized)
	})
	if err != nil {
		logPlanFailure(ctx, "创建饮食方案失败", err, slog.String("user_id", userID))
		return domain.NutritionPlanLibrary{}, err
	}
	logger.Info(ctx, "饮食方案已创建", slog.String("user_id", userID), slog.Int("count", len(values)))
	return s.Library(ctx, userID)
}
func (s *NutritionPlanService) Update(ctx context.Context, userID, id string, revision int, values domain.NutritionPlanValues) (domain.NutritionPlanLibrary, error) {
	v, err := NormalizeNutritionPlan(values)
	if err != nil {
		return domain.NutritionPlanLibrary{}, err
	}
	err = s.repo.WithOwner(ctx, userID, func(r *userrepo.NutritionPlanRepo, user *authrepo.User) error {
		p, err := r.Plan(ctx, userID, id)
		if err != nil {
			return err
		}
		if p.Revision != revision {
			return planError("方案已被更新，请刷新后再编辑", 409)
		}
		if err = r.Update(ctx, userID, id, revision+1, v); err != nil {
			return err
		}
		defaults, err := r.Defaults(ctx, userID, "2200-12-31")
		if err != nil {
			return err
		}
		if len(defaults) > 0 && defaults[len(defaults)-1].Snapshot.PlanID == id {
			tomorrow := time.Now().In(planTZ).AddDate(0, 0, 1).Format("2006-01-02")
			return r.SetDefault(ctx, userID, tomorrow, makePlanSnapshot(domain.NutritionPlan{ID: id, Revision: revision + 1, NutritionPlanValues: v}, planBase(user)), false)
		}
		return nil
	})
	if err != nil {
		logPlanFailure(ctx, "修改饮食方案未完成", err, slog.String("user_id", userID), slog.String("plan_id", id))
		return domain.NutritionPlanLibrary{}, err
	}
	logger.Info(ctx, "饮食方案已更新，已保存日期保持原目标", slog.String("user_id", userID), slog.String("plan_id", id))
	return s.Library(ctx, userID)
}
func (s *NutritionPlanService) SetDefault(ctx context.Context, userID, id string) (domain.NutritionPlanLibrary, error) {
	err := s.repo.WithOwner(ctx, userID, func(r *userrepo.NutritionPlanRepo, user *authrepo.User) error {
		snapshot := planBase(user)
		if id != "base" {
			p, err := r.Plan(ctx, userID, id)
			if err != nil {
				return err
			}
			snapshot = makePlanSnapshot(rowPlan(p), snapshot)
		}
		return r.SetDefault(ctx, userID, planToday(), snapshot, true)
	})
	if err != nil {
		logPlanFailure(ctx, "设置默认饮食方案未完成", err, slog.String("user_id", userID), slog.String("plan_id", id))
		return domain.NutritionPlanLibrary{}, err
	}
	logger.Info(ctx, "默认饮食方案已切换", slog.String("user_id", userID), slog.String("plan_id", id))
	return s.Library(ctx, userID)
}
func (s *NutritionPlanService) Delete(ctx context.Context, userID, id string) (domain.NutritionPlanLibrary, error) {
	err := s.repo.WithOwner(ctx, userID, func(r *userrepo.NutritionPlanRepo, _ *authrepo.User) error {
		if _, err := r.Plan(ctx, userID, id); err != nil {
			return err
		}
		for _, end := range []string{planToday(), "2200-12-31"} {
			defaults, err := r.Defaults(ctx, userID, end)
			if err != nil {
				return err
			}
			if len(defaults) > 0 && defaults[len(defaults)-1].Snapshot.PlanID == id {
				return planError("请先设置其他默认方案，再删除这套方案", 409)
			}
		}
		return r.Archive(ctx, userID, id)
	})
	if err != nil {
		logPlanFailure(ctx, "删除饮食方案未完成", err, slog.String("user_id", userID), slog.String("plan_id", id))
		return domain.NutritionPlanLibrary{}, err
	}
	logger.Info(ctx, "饮食方案已归档，日期快照保留", slog.String("user_id", userID), slog.String("plan_id", id))
	return s.Library(ctx, userID)
}
func (s *NutritionPlanService) ChangeDay(ctx context.Context, userID, date string, input domain.ChangeNutritionDayInput) (domain.NutritionDayChange, error) {
	if err := planDate(date); err != nil {
		return domain.NutritionDayChange{}, err
	}
	if input.ExpectedToken == nil {
		return domain.NutritionDayChange{}, planError("请刷新当前日期后再操作", 409)
	}
	actions := 0
	for _, yes := range []bool{input.PlanID != "", input.Values != nil, input.Restore != nil, input.Clear} {
		if yes {
			actions++
		}
	}
	if actions != 1 {
		return domain.NutritionDayChange{}, planError("请选择一项日期目标操作", 400)
	}
	var previous *domain.NutritionDayBackup
	var day domain.NutritionDay
	err := s.repo.WithOwner(ctx, userID, func(r *userrepo.NutritionPlanRepo, user *authrepo.User) error {
		base := planBase(user)
		old, err := r.Day(ctx, userID, date)
		if err != nil {
			return err
		}
		if dayToken(old) != *input.ExpectedToken {
			return planError("当天目标已发生变化，请刷新后重试", 409)
		}
		if old != nil {
			previous = &domain.NutritionDayBackup{Snapshot: legacySnapshot(old, base), Source: old.Source}
		} else {
			days, err := resolveNutritionRange(ctx, r, userID, date, date)
			if err != nil {
				return err
			}
			before := days[date]
			previous = &domain.NutritionDayBackup{Snapshot: before.Snapshot, Source: before.Source}
		}
		if input.Clear {
			if err := r.ClearDay(ctx, userID, date); err != nil {
				return err
			}
			days, err := resolveNutritionRange(ctx, r, userID, date, date)
			day = days[date]
			return err
		}
		snapshot := base
		source := "selected_plan"
		if input.PlanID != "" && input.PlanID != "base" {
			p, err := r.Plan(ctx, userID, input.PlanID)
			if err != nil {
				return err
			}
			snapshot = makePlanSnapshot(rowPlan(p), base)
		}
		if input.Values != nil {
			v, err := NormalizeNutritionPlan(*input.Values)
			if err != nil {
				return err
			}
			source = "temporary_plan"
			snapshot = makePlanSnapshot(domain.NutritionPlan{NutritionPlanValues: v}, base)
			if v.MicroMode == "profile" && previous.Snapshot.MicroMode == "profile" {
				for _, key := range dashboardMicroTargetKeys {
					snapshot.Targets[key] = previous.Snapshot.Targets[key]
				}
			}
		}
		if input.Restore != nil {
			snapshot = input.Restore.Snapshot
			source = input.Restore.Source
			if err := validatePlanTargets(snapshot.Targets); err != nil {
				return err
			}
			for _, key := range dashboardMicroTargetKeys {
				if _, ok := snapshot.Targets[key]; !ok {
					return planError("撤销需要完整的微量目标快照", 400)
				}
			}
			if math.IsNaN(snapshot.FatMin) || math.IsInf(snapshot.FatMin, 0) || math.IsNaN(snapshot.FatMax) || math.IsInf(snapshot.FatMax, 0) || snapshot.Targets["fat_target"] < snapshot.FatMin || snapshot.Targets["fat_target"] > snapshot.FatMax {
				return planError("撤销脂肪范围无效", 400)
			}
			if snapshot.MicroMode != "profile" && snapshot.MicroMode != "custom" {
				return planError("撤销继承方式无效", 400)
			}
			if snapshot.Name == "" || utf8.RuneCountInString(snapshot.Name) > 30 || snapshot.Revision < 0 || snapshot.FatMin < 0 || snapshot.FatMax < snapshot.FatMin || snapshot.FatMax > 300 {
				return planError("撤销数据无效", 400)
			}
			switch source {
			case "selected_plan", "temporary_plan", "user_manual", "legacy_daily", "base", "default_plan":
			default:
				return planError("撤销来源无效", 400)
			}
		}
		if err := r.PutDay(ctx, userID, date, source, snapshot); err != nil {
			return err
		}
		days, err := resolveNutritionRange(ctx, r, userID, date, date)
		day = days[date]
		return err
	})
	if err != nil {
		logPlanFailure(ctx, "按日切换饮食目标未完成", err, slog.String("user_id", userID), slog.String("date", date))
		return domain.NutritionDayChange{}, err
	}
	logger.Info(ctx, "按日饮食目标已保存", slog.String("user_id", userID), slog.String("date", date), slog.String("source", day.Source))
	return domain.NutritionDayChange{Day: day, Previous: previous}, nil
}

// A missing row should have the same public result as an ID owned by someone else.
func NutritionPlanPublicError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return commonerrors.ErrNotFound
	}
	return err
}
