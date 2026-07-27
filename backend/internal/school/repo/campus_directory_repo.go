package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/school/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CampusDirectoryRepo struct {
	db *gorm.DB
}

func NewCampusDirectoryRepo(db *gorm.DB) *CampusDirectoryRepo {
	return &CampusDirectoryRepo{db: db}
}

type ListCampusesInput struct {
	SchoolID string
	Status   string
}

type ListCanteensInput struct {
	SchoolID string
	CampusID string
	Status   string
	Query    string
	Limit    int
}

type ListWindowsInput struct {
	CanteenID string
	Floor     string
	Status    string
	Query     string
	Limit     int
}

type CreateApplicationInput struct {
	UserID               string
	SchoolID             string
	CampusID             *string
	RequestedSchoolName  string
	RequestedCampusName  *string
	RequestedCanteenName string
	LocationText         *string
	EvidenceURL          *string
	ApplicantNote        *string
}

func (r *CampusDirectoryRepo) GetSchool(ctx context.Context, schoolID string) (*domain.School, error) {
	var row domain.School
	err := r.db.WithContext(ctx).Where("id = ? AND status = ?", strings.TrimSpace(schoolID), "active").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *CampusDirectoryRepo) GetCampus(ctx context.Context, campusID string) (*domain.SchoolCampus, error) {
	var row domain.SchoolCampus
	err := r.db.WithContext(ctx).Where("id = ? AND status <> ?", strings.TrimSpace(campusID), "deleted").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *CampusDirectoryRepo) GetCanteen(ctx context.Context, canteenID string) (*domain.SchoolCanteen, error) {
	var row domain.SchoolCanteen
	err := r.db.WithContext(ctx).
		Table("school_canteens AS c").
		Select("c.*, COALESCE(sc.name, '') AS campus_name").
		Joins("LEFT JOIN school_campuses sc ON sc.id = c.campus_id").
		Where("c.id = ? AND c.status <> ?", strings.TrimSpace(canteenID), "deleted").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *CampusDirectoryRepo) GetWindow(ctx context.Context, windowID string) (*domain.CanteenWindow, error) {
	var row domain.CanteenWindow
	err := r.db.WithContext(ctx).Where("id = ? AND status <> ?", strings.TrimSpace(windowID), "deleted").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *CampusDirectoryRepo) ListCampuses(ctx context.Context, input ListCampusesInput) ([]domain.SchoolCampus, error) {
	var rows []domain.SchoolCampus
	status := normalizeStatus(input.Status, "active")
	q := r.db.WithContext(ctx).Where("school_id = ?", strings.TrimSpace(input.SchoolID))
	if status != "all" {
		q = q.Where("status = ?", status)
	} else {
		q = q.Where("status <> ?", "deleted")
	}
	err := q.Order("sort_order ASC, name ASC").Find(&rows).Error
	return rows, err
}

func (r *CampusDirectoryRepo) ListCanteens(ctx context.Context, input ListCanteensInput) ([]domain.SchoolCanteen, error) {
	var rows []domain.SchoolCanteen
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	status := normalizeStatus(input.Status, "active")
	q := r.db.WithContext(ctx).
		Table("school_canteens AS c").
		Select("c.*, COALESCE(sc.name, '') AS campus_name").
		Joins("LEFT JOIN school_campuses sc ON sc.id = c.campus_id").
		Where("c.school_id = ?", strings.TrimSpace(input.SchoolID))
	if strings.TrimSpace(input.CampusID) != "" {
		q = q.Where("c.campus_id = ?", strings.TrimSpace(input.CampusID))
	}
	if status != "all" {
		q = q.Where("c.status = ?", status)
	} else {
		q = q.Where("c.status <> ?", "deleted")
	}
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		q = q.Where("c.name ILIKE ? OR c.location_text ILIKE ? OR CAST(c.aliases AS TEXT) ILIKE ?", like, like, like)
	}
	err := q.Order("COALESCE(sc.sort_order, 9999) ASC, c.sort_order ASC, c.name ASC").Limit(limit).Scan(&rows).Error
	return rows, err
}

func (r *CampusDirectoryRepo) ListWindows(ctx context.Context, input ListWindowsInput) ([]domain.CanteenWindow, error) {
	var rows []domain.CanteenWindow
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	status := normalizeStatus(input.Status, "active")
	q := r.db.WithContext(ctx).Where("canteen_id = ?", strings.TrimSpace(input.CanteenID))
	if floor := strings.TrimSpace(input.Floor); floor != "" {
		q = q.Where("TRIM(floor) = ?", floor)
	}
	if status != "all" {
		q = q.Where("status = ?", status)
	} else {
		q = q.Where("status <> ?", "deleted")
	}
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		q = q.Where("name ILIKE ? OR floor ILIKE ? OR CAST(aliases AS TEXT) ILIKE ?", like, like, like)
	}
	err := q.Order("sort_order ASC, floor ASC, name ASC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *CampusDirectoryRepo) CreateApplication(ctx context.Context, input CreateApplicationInput) (*domain.CampusCanteenApplication, error) {
	row := domain.CampusCanteenApplication{
		ID:                   uuid.New().String(),
		UserID:               strings.TrimSpace(input.UserID),
		SchoolID:             strings.TrimSpace(input.SchoolID),
		CampusID:             input.CampusID,
		RequestedSchoolName:  strings.TrimSpace(input.RequestedSchoolName),
		RequestedCampusName:  derefString(input.RequestedCampusName),
		RequestedCanteenName: strings.TrimSpace(input.RequestedCanteenName),
		LocationText:         derefString(input.LocationText),
		EvidenceURL:          derefString(input.EvidenceURL),
		ApplicantNote:        derefString(input.ApplicantNote),
		Status:               "pending",
	}
	now := time.Now()
	row.CreatedAt = &now
	row.UpdatedAt = &now
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
	return &row, err
}

func normalizeStatus(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
