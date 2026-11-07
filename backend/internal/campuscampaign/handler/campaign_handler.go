package handler

import (
	"log/slog"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/campuscampaign/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type CampaignHandler struct {
	svc *service.CampaignService
}

func NewCampaignHandler(svc *service.CampaignService) *CampaignHandler {
	return &CampaignHandler{svc: svc}
}

func badBody(c *gin.Context) {
	response.Error(c, &commonerrors.AppError{Code: 10002, Message: "提交内容格式不正确", HTTPStatus: 400})
}

// GET /api/campus-campaigns/by-code/:code (guests allowed)
func (h *CampaignHandler) Landing(c *gin.Context) {
	view, err := h.svc.Landing(c.Request.Context(), c.Param("code"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"campaign": view})
}

// GET /api/campus-campaigns/by-code/:code/board (guests allowed)
func (h *CampaignHandler) MembersBoard(c *gin.Context) {
	board, err := h.svc.MembersBoard(c.Request.Context(), c.Param("code"), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": board})
}

// GET /api/campus-campaigns/board (guests allowed)
func (h *CampaignHandler) CampaignsBoard(c *gin.Context) {
	board, err := h.svc.CampaignsBoard(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": board})
}

// POST /api/campus-campaigns/by-code/:code/join
func (h *CampaignHandler) Join(c *gin.Context) {
	var body service.JoinInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	mine, err := h.svc.Join(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("code"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"mine": mine, "message": "已加入活动"})
}

// GET /api/campus-campaigns/mine
func (h *CampaignHandler) Mine(c *gin.Context) {
	mine, err := h.svc.Mine(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"mine": mine})
}

// POST /api/campus-campaigns/records
func (h *CampaignHandler) LinkRecord(c *gin.Context) {
	var body service.RecordLinkInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	linked, err := h.svc.LinkRecord(c.Request.Context(), userID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "高校共建拍照记录关联完成", slog.String("user_id", userID), slog.Bool("linked", linked))
	response.Success(c, gin.H{"linked": linked})
}

// GET /api/campus-campaigns/:campaign_id/leader
func (h *CampaignHandler) Leader(c *gin.Context) {
	view, err := h.svc.Leader(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("campaign_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"leader": view})
}

type coreBody struct {
	Core bool `json:"core"`
}

// PUT /api/campus-campaigns/:campaign_id/members/:user_id/core
func (h *CampaignHandler) SetCore(c *gin.Context) {
	var body coreBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	view, err := h.svc.SetCore(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("campaign_id"), c.Param("user_id"), body.Core)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"leader": view})
}

// POST /api/campus-campaigns/:campaign_id/stations
func (h *CampaignHandler) CreateStation(c *gin.Context) {
	var body service.StationInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	station, err := h.svc.CreateStation(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("campaign_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"station": station, "message": "称重日已创建"})
}

// --- administration ---

// GET /api/admin/campus-orgs
func (h *CampaignHandler) AdminListOrgs(c *gin.Context) {
	orgs, err := h.svc.ListOrgs(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": orgs})
}

// POST /api/admin/campus-orgs
func (h *CampaignHandler) AdminCreateOrg(c *gin.Context) {
	var body service.OrgInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	org, err := h.svc.CreateOrg(c.Request.Context(), c.GetString("admin_account_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": org})
}

// GET /api/admin/campus-campaigns
func (h *CampaignHandler) AdminListCampaigns(c *gin.Context) {
	items, err := h.svc.ListCampaigns(c.Request.Context(), c.Query("status"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// POST /api/admin/campus-campaigns
func (h *CampaignHandler) AdminCreateCampaign(c *gin.Context) {
	var body service.CampaignInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	view, err := h.svc.CreateCampaign(c.Request.Context(), c.GetString("admin_account_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": view})
}

// PUT /api/admin/campus-campaigns/:campaign_id
func (h *CampaignHandler) AdminUpdateCampaign(c *gin.Context) {
	var body service.CampaignInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	view, err := h.svc.UpdateCampaign(c.Request.Context(), c.Param("campaign_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": view})
}

type leaderBody struct {
	UserID string `json:"user_id"`
}

// POST /api/admin/campus-campaigns/:campaign_id/leaders
func (h *CampaignHandler) AdminAddLeader(c *gin.Context) {
	var body leaderBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badBody(c)
		return
	}
	if err := h.svc.AddLeader(c.Request.Context(), c.Param("campaign_id"), body.UserID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已设为负责人"})
}
