package service

import (
	"context"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/school/domain"
	"food_link/backend/internal/school/repo"
)

type CampusDirectoryRepo interface {
	GetSchool(ctx context.Context, schoolID string) (*domain.School, error)
	GetCampus(ctx context.Context, campusID string) (*domain.SchoolCampus, error)
	ListCampuses(ctx context.Context, input repo.ListCampusesInput) ([]domain.SchoolCampus, error)
	ListCanteens(ctx context.Context, input repo.ListCanteensInput) ([]domain.SchoolCanteen, error)
	ListWindows(ctx context.Context, input repo.ListWindowsInput) ([]domain.CanteenWindow, error)
	CreateApplication(ctx context.Context, input repo.CreateApplicationInput) (*domain.CampusCanteenApplication, error)
}

type CampusDirectoryService struct {
	repo CampusDirectoryRepo
}

func NewCampusDirectoryService(repo CampusDirectoryRepo) *CampusDirectoryService {
	return &CampusDirectoryService{repo: repo}
}

type ListCampusesInput struct {
	SchoolID string
}

type ListCanteensInput struct {
	SchoolID string
	CampusID string
	Query    string
	Limit    int
}

type ListWindowsInput struct {
	CanteenID string
	Query     string
	Limit     int
}

type CreateCanteenApplicationInput struct {
	UserID               string
	SchoolID             string  `json:"school_id"`
	CampusID             *string `json:"campus_id"`
	RequestedSchoolName  string  `json:"requested_school_name"`
	RequestedCampusName  *string `json:"requested_campus_name"`
	RequestedCanteenName string  `json:"requested_canteen_name"`
	LocationText         *string `json:"location_text"`
	EvidenceURL          *string `json:"evidence_url"`
	ApplicantNote        *string `json:"applicant_note"`
}

func (s *CampusDirectoryService) ListCampuses(ctx context.Context, input ListCampusesInput) ([]domain.SchoolCampus, error) {
	schoolID := strings.TrimSpace(input.SchoolID)
	if schoolID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "学校 ID 不能为空", HTTPStatus: 400}
	}
	return s.repo.ListCampuses(ctx, repo.ListCampusesInput{SchoolID: schoolID, Status: "active"})
}

func (s *CampusDirectoryService) ListCanteens(ctx context.Context, input ListCanteensInput) ([]domain.SchoolCanteen, error) {
	schoolID := strings.TrimSpace(input.SchoolID)
	if schoolID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "学校 ID 不能为空", HTTPStatus: 400}
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.repo.ListCanteens(ctx, repo.ListCanteensInput{
		SchoolID: schoolID,
		CampusID: strings.TrimSpace(input.CampusID),
		Query:    strings.TrimSpace(input.Query),
		Limit:    limit,
		Status:   "active",
	})
}

func (s *CampusDirectoryService) ListWindows(ctx context.Context, input ListWindowsInput) ([]domain.CanteenWindow, error) {
	canteenID := strings.TrimSpace(input.CanteenID)
	if canteenID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食堂 ID 不能为空", HTTPStatus: 400}
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.repo.ListWindows(ctx, repo.ListWindowsInput{
		CanteenID: canteenID,
		Query:     strings.TrimSpace(input.Query),
		Limit:     limit,
		Status:    "active",
	})
}

func (s *CampusDirectoryService) CreateApplication(ctx context.Context, input CreateCanteenApplicationInput) (*domain.CampusCanteenApplication, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.SchoolID = strings.TrimSpace(input.SchoolID)
	input.RequestedSchoolName = strings.TrimSpace(input.RequestedSchoolName)
	input.RequestedCanteenName = strings.TrimSpace(input.RequestedCanteenName)
	if input.UserID == "" {
		return nil, &commonerrors.AppError{Code: 10001, Message: "请先登录", HTTPStatus: 401}
	}
	if input.SchoolID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请选择学校", HTTPStatus: 400}
	}
	if input.RequestedSchoolName == "" {
		school, err := s.repo.GetSchool(ctx, input.SchoolID)
		if err != nil {
			return nil, err
		}
		if school == nil {
			return nil, &commonerrors.AppError{Code: 10002, Message: "学校不存在", HTTPStatus: 400}
		}
		input.RequestedSchoolName = school.Name
	}
	if input.RequestedCanteenName == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请填写要申请的食堂名称", HTTPStatus: 400}
	}
	if len([]rune(input.RequestedCanteenName)) > 80 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食堂名称不能超过 80 字", HTTPStatus: 400}
	}
	return s.repo.CreateApplication(ctx, repo.CreateApplicationInput{
		UserID:               input.UserID,
		SchoolID:             input.SchoolID,
		CampusID:             trimStringPtr(input.CampusID),
		RequestedSchoolName:  input.RequestedSchoolName,
		RequestedCampusName:  trimStringPtr(input.RequestedCampusName),
		RequestedCanteenName: input.RequestedCanteenName,
		LocationText:         trimStringPtr(input.LocationText),
		EvidenceURL:          trimStringPtr(input.EvidenceURL),
		ApplicantNote:        trimStringPtr(input.ApplicantNote),
	})
}

func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
